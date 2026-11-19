//! Orchestration mail and tasks (ORCH-001..006, ORCH-010, ORCH-011, ORCH-013): Runs, which pane is tied to which
//! Run, typed messages, and the batches `check` hands out until they are acknowledged. All of it
//! is one JSON value in the store; the command line reaches it through `cli::dispatch`.

use crate::cli::Fail;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// ORCH-055 (T-174-b): prompts typed into agents land exactly once.
pub mod sendonce;
/// ORCH-007 (T-030-b): the one-line mail pointer typed into an idle agent.
pub mod pointer;
/// ORCH-017 (T-172-d): worker-start waits for the window to run the trust question and the setup once.
pub mod setup_gate;
/// ORCH-038 (T-173-d): workers cut short by a quit or crash come back with an unknown outcome.
pub mod restart;
/// ORCH-034 (T-173-c): the orchestration store upgrades in place from every earlier layout of its own.
pub mod upgrade;
/// ORCH-062..064 (T-312): the runtime commands agents call for files, git and GitHub, past sessions
/// and automations.
pub mod runtime;
/// ORCH-042 (T-255): Agent Teams teammate panes, the host-neutral half. Nothing calls it yet:
/// Claude Code documents split panes only through tmux or iTerm2 (T-255 and T-191-c stay open).
#[allow(dead_code)]
pub mod teams;

const KEY: &str = "orchestration.mail";
pub const KINDS: &[&str] = &["status", "dispatch", "worker_done", "merge_ready", "escalation", "handoff", "decision_gate", "question", "heartbeat"];

/// ORCH-004: an open terminal as a group send sees it: the agent Kolux detected in it (none for
/// a shell or an agent of unknown kind), whether it is quiet, and the folder it runs in.
#[derive(Clone, Debug)]
pub struct Peer {
    pub handle: String,
    pub agent: Option<String>,
    pub idle: bool,
    pub dir: String,
}

/// Do two folder spellings name the same place (slashes, a trailing slash and letter case aside)?
// ponytail: text compare, no disk lookup; links and short names count as different folders.
fn same_path(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim().replace('\\', "/").trim_end_matches('/').to_ascii_lowercase();
    n(a) == n(b)
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Mail {
    pub runs: Vec<Run>,
    pub bindings: BTreeMap<String, Binding>,
    pub messages: Vec<Message>,
    pub deliveries: Vec<Delivery>,
    pub answers: BTreeMap<String, Value>,
    pub seq: u64,
    pub gates: Vec<Gate>,
    /// ORCH-030: when each receipt in `answers` was written, so old ones can be pruned.
    pub stamps: BTreeMap<String, u64>,
    /// ORCH-030: requests that take a while (a worker start) and have not finished, with when they
    /// began and the process that runs them.
    pub pending: BTreeMap<String, Value>,
    /// Row 193: the store could not be read when this was loaded, so it is not what is saved there
    /// and a save would wipe it. Saves refuse while this is set.
    #[serde(skip)]
    pub unread: bool,
    /// Row 874: fields a newer build wrote that this one does not know, carried through a save.
    /// Flatten also makes a non-object blob (`[]`) a decode failure, so it is kept aside.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

/// ORCH-030: how long a finished request's receipt is kept for a retry to find.
pub const RECEIPT_TTL_MS: u64 = 7 * 24 * 3_600_000;
/// ORCH-030: unfinished requests the ledger tracks before it turns new changes away.
pub const MAX_PENDING: usize = 32;

fn wall_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// ORCH-028: a decision the coordinator still has to make, holding one task blocked meanwhile.
#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Gate {
    pub id: String,
    pub run: Option<String>,
    pub task: String,
    pub question: String,
    pub options: Vec<String>,
    pub status: String,
    pub resolution: Option<String>,
    pub created: u64,
    pub resolved: Option<u64>,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub objective: String,
    pub home: String,
    pub created: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Binding {
    pub run: Option<String>,
    pub epoch: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub to: String,
    pub run: Option<String>,
    pub from: String,
    pub subject: String,
    pub body: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub priority: String,
    pub extras: Map<String, Value>,
    pub at: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub reader: String,
    pub messages: Vec<String>,
    pub acked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Next,
    Peek,
    Unread,
    All,
}

/// Dispatch states after which a worker gets no more mail (ORCH-003).
const FINISHED: &[&str] = &["completed", "failed", "stopped", "abandoned", "released"];

fn args(message: impl Into<String>) -> Fail {
    Fail::new("invalid_arguments", message)
}

/// Who is calling (ORCH-001, CLI-039): the handle and secret pane key every Kolux terminal carries
/// must match a pane the runtime started itself. A shell outside Kolux (or a guessed key) is
/// nobody: `None`. The pane key decides: a handle the environment still names after it went stale
/// is worked out again from the key (CLI-034); a key the runtime never gave is no one.
/// `--from` may only name the calling terminal itself: another handle is refused, and so is any
/// handle from a shell whose own identity cannot be proven (fail closed).
pub fn caller_of(from: Option<&str>, pane: Option<(&str, &str)>, by_key: &dyn Fn(&str) -> Option<String>) -> Result<Option<String>, Fail> {
    let me = pane.and_then(|(_, k)| by_key(k));
    let Some(h) = from.map(str::trim).filter(|h| !h.is_empty()) else { return Ok(me) };
    match me {
        Some(me) if me == h => Ok(Some(me)),
        Some(me) => Err(Fail::new("caller_mismatch", format!("this command runs in {me}, so it cannot act as {h}: drop --from {h}, or run the command in {h} itself"))),
        None => Err(Fail {
            code: "unbound_caller",
            message: format!("--from {h} cannot be proven here: this shell is not a terminal Kolux started, so it has no identity to check it against"),
            data: json!({ "hint": "run the command inside a Kolux terminal; its KOLUX_TERMINAL_HANDLE and KOLUX_PANE_KEY say who is calling" }),
        }),
    }
}

pub(crate) fn finished(d: &Value) -> bool {
    FINISHED.contains(&d["status"].as_str().unwrap_or_default())
}

/// The handle of a dispatch's terminal, while it can still be that terminal: handles count up
/// again from term-1 when Kolux restarts, so one stamped by an earlier run of the app is no one.
pub(crate) fn terminal_of(d: &Value) -> Option<String> {
    if d["runtime"].as_u64().is_some_and(|r| r != u64::from(std::process::id())) {
        return None;
    }
    d["terminal"].as_u64().map(|t| crate::terminal::handle_of(t as u32))
}

/// The open dispatch whose worker runs in `pane`, if any.
fn own_dispatch<'a>(pane: &str, dispatches: &'a [Value]) -> Option<&'a Value> {
    dispatches.iter().rev().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(pane))
}

/// ORCH-032: the nesting cap when nothing raises it: the coordinator plus one level of workers.
pub const DEFAULT_MAX_DEPTH: u32 = 1;

/// ORCH-032: the depth and cap a worker started from `pane` gets, or the refusal that tells the
/// caller to do the work itself. A coordinator (no dispatch of its own) takes the cap asked for
/// (`--max-depth`), else the configured one, else 1. A worker keeps the cap its coordinator gave it
/// and can only lower it. A dispatch stored before depth was recorded counts as one level down.
pub fn nest(pane: Option<&str>, dispatches: &[Value], asked: Option<u32>, configured: Option<u32>) -> Result<(u32, u32), Fail> {
    let own = pane.and_then(|p| own_dispatch(p, dispatches));
    let depth = own.map(|d| d["depth"].as_u64().unwrap_or(1) as u32).unwrap_or(0);
    let cap = match own {
        Some(d) => {
            let given = d["maxDepth"].as_u64().map(|c| c as u32).unwrap_or(DEFAULT_MAX_DEPTH);
            asked.map_or(given, |a| a.min(given))
        }
        None => asked.or(configured).unwrap_or(DEFAULT_MAX_DEPTH),
    };
    if depth + 1 > cap {
        return Err(Fail {
            code: "nesting_limit",
            message: format!("you are a worker {depth} level{} down and the nesting cap is {cap} level{} of workers: do this task yourself instead of starting another worker", if depth == 1 { "" } else { "s" }, if cap == 1 { "" } else { "s" }),
            data: json!({ "depth": depth, "maxDepth": cap }),
        });
    }
    Ok((depth + 1, cap))
}

/// ORCH-033: task `id` as Run `run` sees it. A task of another Run reads exactly as a missing one,
/// so Runs cannot be mapped from outside.
pub fn task_in(tasks: &[Value], id: &str, run: Option<&str>) -> Result<usize, Fail> {
    tasks.iter().position(|t| t["id"] == id && t["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no task {id}")))
}

/// ORCH-016 / ORCH-017: whether worker-start may hand task `id` to a new worker: a task that still
/// has a worker, or is done, is turned away. A failed start's way out (stop, then start again)
/// goes through this same check, so the offered commands are ones that work.
pub fn start_check(tasks: &[Value], id: &str, run: Option<&str>) -> Result<usize, Fail> {
    let i = task_in(tasks, id, run)?;
    match tasks[i]["status"].as_str().unwrap_or_default() {
        "dispatched" => Err(Fail::new("failed", format!("{id} already has a worker ({})", tasks[i]["dispatchId"].as_str().unwrap_or("?")))),
        "completed" => Err(Fail::new("failed", format!("{id} is already completed"))),
        _ => Ok(i),
    }
}

/// ORCH-023: fences dispatch `id` off. Its worker can no longer report on it, and its task can be
/// handed on again; no process is stopped, no pane closes and nothing on disk changes. A dispatch
/// of another Run reads as missing. Abandoning twice answers the same.
pub fn abandon(tasks: &mut [Value], dispatches: &mut [Value], id: &str, run: Option<&str>, now: u64) -> Result<Value, Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let was = d["status"].as_str().unwrap_or_default().to_string();
    if was != "abandoned" {
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{id} is already {was}; there is nothing to abandon")));
        }
        d["status"] = json!("abandoned");
        d["abandonedAt"] = json!(now);
    }
    let task = d["taskId"].as_str().unwrap_or_default().to_string();
    if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["dispatchId"] == id && status(t) == "dispatched") {
        t["status"] = json!("ready");
        if let Some(o) = t.as_object_mut() {
            o.remove("dispatchId");
        }
    }
    let task_status = tasks.iter().find(|t| t["id"] == task.as_str()).map(|t| t["status"].clone()).unwrap_or(Value::Null);
    Ok(json!({ "dispatchId": id, "taskId": task, "status": "abandoned", "terminal": terminal_of(d), "terminalKept": true, "taskStatus": task_status, "mode": d["mode"] }))
}

/// ORCH-012: moves task `id` to `to`, its dispatch with it. Completing or failing a dispatched
/// task settles its worker the same way, which frees the slot it held; any other move fences the
/// worker off, so a task is never dispatched with no worker or with two. Only dispatch and
/// worker-start make a task dispatched. A worker whose dispatch was fenced off, or whose process
/// already ended, cannot settle the task from its terminal (`caller`).
#[allow(clippy::too_many_arguments)]
pub fn task_update(tasks: &mut [Value], dispatches: &mut [Value], id: &str, to: &str, result: Option<&str>, run: Option<&str>, caller: Option<&str>, now: u64) -> Result<Value, Fail> {
    if !TASK_STATES.contains(&to) {
        return Err(args(format!("--status takes one of {}", TASK_STATES.join(", "))));
    }
    if result.is_some_and(|r| r.len() > SPEC_MAX) {
        return Err(Fail::new("too_large", format!("the result is longer than the {SPEC_MAX} bytes Kolux stores")));
    }
    let i = task_in(tasks, id, run)?;
    if let Some(d) = dispatches.iter().rev().find(|d| d["taskId"] == id && d["runId"].as_str() == run && caller.is_some() && terminal_of(d).as_deref() == caller) {
        let did = d["id"].as_str().unwrap_or_default();
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{did} was {}: its worker can no longer change {id}", d["status"].as_str().unwrap_or_default())));
        }
        if !d["exitedAt"].is_null() {
            return Err(Fail::new("worker_exited", format!("{did}'s agent had already ended, so it cannot report {id} {to}; its Run was told and its terminal is kept to read")));
        }
    }
    let was = status(&tasks[i]).to_string();
    // The first finished report wins; a task may still be sent back to pending, ready or blocked.
    if matches!(was.as_str(), "completed" | "failed") && matches!(to, "completed" | "failed") {
        return Err(Fail::new("task_finished", format!("{id} is already {was}; a second report cannot change it")));
    }
    let open = tasks[i]["dispatchId"].as_str().map(str::to_string).filter(|_| was == "dispatched");
    if to == "dispatched" && open.is_none() {
        return Err(Fail::new("invalid_transition", format!("{id} is {was}; a task is dispatched only by orchestration dispatch or worker-start, so it always has one worker")));
    }
    let mut settled = Value::Null;
    if let (Some(did), true) = (&open, to != "dispatched") {
        if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == did.as_str() && !finished(d)) {
            let s = if to == "completed" || to == "failed" { to } else { "abandoned" };
            d["status"] = json!(s);
            d["settledAt"] = json!(now);
            settled = json!(s);
        }
        if to != "completed" && to != "failed" {
            if let Some(o) = tasks[i].as_object_mut() {
                o.remove("dispatchId");
            }
        }
    }
    tasks[i]["status"] = json!(to);
    tasks[i]["updated"] = json!(now);
    if let Some(r) = result {
        tasks[i]["result"] = json!(r);
    }
    Ok(json!({ "taskId": id, "status": to, "previous": was, "result": tasks[i]["result"], "dispatchId": open, "dispatchStatus": settled }))
}

/// ORCH-015: what a done report or heartbeat on a dispatch does beyond being mail. From the terminal
/// the worker runs in, a heartbeat stamps the dispatch with when Kolux got it (never a time the
/// sender gives), and a done report settles its task: succeeded completes it and frees the tasks
/// waiting on it, failed fails it. From any other pane, or for a worker terminal of an earlier
/// start, it settles nothing and says why. A report that cannot be shown to settle its task fails.
/// Anything else is Null.
pub fn report(tasks: &mut [Value], dispatches: &mut [Value], from: &str, a: &Value, now: u64, generation_of: &dyn Fn(u32) -> Option<u64>) -> Result<Value, Fail> {
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    let kind = text("type").unwrap_or("status");
    let (true, Some(id)) = (kind == "worker_done" || kind == "heartbeat", text("dispatchId")) else {
        return Ok(Value::Null);
    };
    let Some(i) = dispatches.iter().position(|d| d["id"] == id) else {
        return Ok(Value::Null);
    };
    match terminal_of(&dispatches[i]) {
        Some(t) if t == from => {}
        Some(t) => return Ok(json!({ "dispatchId": id, "settles": false, "why": format!("{id} runs in {t}; only a report from {t} itself counts, so this one is mail only") })),
        None => return Ok(json!({ "dispatchId": id, "settles": false, "why": format!("{id}'s worker terminal is from an earlier start of Kolux, so this report cannot be vouched for and is mail only") })),
    }
    // ORCH-067: a dispatch with a pass settles only on reports that carry it; the mail still went.
    if let Some(why) = pass_refusal(&dispatches[i], a) {
        return Ok(json!({ "dispatchId": id, "settles": false, "why": format!("{why}, so this report is mail only and {} is unchanged", dispatches[i]["taskId"].as_str().unwrap_or("its task")) }));
    }
    // Row 211: a pass minted for an earlier process of this pane is dead though the handle still matches.
    if let Some(why) = stale_pass(&dispatches[i], generation_of) {
        return Ok(json!({ "dispatchId": id, "settles": false, "code": "stale_pass", "why": format!("{why}, so this report is mail only and {} is unchanged", dispatches[i]["taskId"].as_str().unwrap_or("its task")) }));
    }
    if kind == "heartbeat" {
        dispatches[i]["lastBeatAt"] = json!(now);
        return Ok(json!({ "dispatchId": id, "lastBeatAt": now }));
    }
    let task = dispatches[i]["taskId"].as_str().unwrap_or_default().to_string();
    let run = dispatches[i]["runId"].as_str().map(str::to_string);
    let unknown = |why: String| Fail::new("outcome_unknown", format!("Kolux could not settle {task} from this report, so its outcome is unknown: {why}"));
    let t = task_in(tasks, &task, run.as_deref()).map_err(|e| unknown(e.message))?;
    if tasks[t]["dispatchId"] != id {
        return Err(unknown(format!("{task} is no longer on {id}")));
    }
    let to = if text("outcome") == Some("succeeded") { "completed" } else { "failed" };
    let out = task_update(tasks, dispatches, &task, to, text("body").or(text("subject")), run.as_deref(), Some(from), now).map_err(|e| unknown(e.message))?;
    promote(tasks);
    Ok(out)
}

/// ORCH-022: fences dispatch `id` off as stopped and hands back the terminal to end, when Kolux
/// still holds it. The worktree and every other terminal stay, and its task can be handed on
/// again. A terminal from an earlier start of Kolux reads as unverifiable, never as ended.
/// Stopping twice answers the same.
/// Council FIX-1 S2: a terminal that is not the worker's own (see keep_open) is left running,
/// and the receipt says why; the process then reads as unverifiable, since Kolux did not end it.
// ponytail: a terminal the user has typed into is ended like any other; ORCH-036 keeps it open.
// Test-only since the CLI calls stop_with (cli FIX-3 AFTER): the tests use it for the plain case.
#[cfg(test)]
pub fn stop(tasks: &mut [Value], dispatches: &mut [Value], id: &str, run: Option<&str>, now: u64) -> Result<(Value, Option<u32>), Fail> {
    stop_with(tasks, dispatches, id, run, now, &|_| None)
}

/// ORCH-022 as stop, told what each terminal runs now (`agent_of`, as keep_open reads it), so a
/// terminal that runs another agent than the worker's, or a plain shell, is never ended.
pub fn stop_with(tasks: &mut [Value], dispatches: &mut [Value], id: &str, run: Option<&str>, now: u64, agent_of: &dyn Fn(&str) -> Option<Option<String>>) -> Result<(Value, Option<u32>), Fail> {
    let i = dispatches.iter().position(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let left_open = keep_open(dispatches, &dispatches[i], agent_of);
    let d = &mut dispatches[i];
    let was = d["status"].as_str().unwrap_or_default().to_string();
    let term = terminal_of(d);
    let mut kill = None;
    if was != "stopped" {
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{id} is already {was}; there is no worker to stop")));
        }
        let process = if !d["exitedAt"].is_null() {
            "ended"
        } else if term.is_none() {
            "unverifiable"
        } else if let Some(why) = &left_open {
            d["terminalLeftOpen"] = json!(why);
            "unverifiable"
        } else {
            kill = d["terminal"].as_u64().map(|t| t as u32);
            "ended"
        };
        d["status"] = json!("stopped");
        d["stoppedAt"] = json!(now);
        d["process"] = json!(process);
    }
    let task = d["taskId"].as_str().unwrap_or_default().to_string();
    let receipt = json!({ "dispatchId": id, "taskId": task, "status": "stopped", "terminal": term, "process": d["process"], "worktree": d["worktree"], "worktreeKept": true, "terminalLeftOpen": d["terminalLeftOpen"] });
    if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["dispatchId"] == id && status(t) == "dispatched") {
        t["status"] = json!("ready");
        if let Some(o) = t.as_object_mut() {
            o.remove("dispatchId");
        }
    }
    let mut receipt = receipt;
    receipt["taskStatus"] = tasks.iter().find(|t| t["id"] == task.as_str()).map(|t| t["status"].clone()).unwrap_or(Value::Null);
    stop_warning(&mut receipt);
    Ok((receipt, kill))
}

/// ORCH-026: the terminal states worker-list can filter by. Release pending and release unknown
/// are worker-release's (T-089-c): saving the output, then closing, and a release that did not
/// finish.
pub const TERMINAL_STATES: [&str; 6] = ["active", "reclaimable", "retained", "release_pending", "release_unknown", "released"];

/// ORCH-026: what is left of a worker's terminal, apart from its task status. A kept worker stays
/// kept after its process ends or Kolux restarts (ORCH-025); a settled worker whose terminal is
/// gone has nothing left to clean up.
fn terminal_state(d: &Value, live: &dyn Fn(&str) -> bool) -> &'static str {
    if d["released"] == true {
        "released"
    } else if d["release"] == "pending" {
        "release_pending"
    } else if d["release"] == "unknown" {
        "release_unknown"
    } else if !finished(d) {
        "active"
    } else if d["retained"] == true {
        "retained"
    } else if terminal_of(d).is_some_and(|h| live(&h)) {
        "reclaimable"
    } else {
        "released"
    }
}

/// ORCH-026: the workers in one Run (or every Run), a page at a time. The cursor is opaque and
/// carries the scope it came from, so it cannot page another Run's list.
#[allow(clippy::too_many_arguments)]
pub fn worker_list(tasks: &[Value], dispatches: &[Value], run: Option<&str>, from: &str, state: Option<&str>, cursor: Option<&str>, limit: usize, live: &dyn Fn(&str) -> bool) -> Result<Value, Fail> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let scope = run.unwrap_or("*");
    let start = match cursor {
        None => 0,
        Some(c) => {
            let raw = b64.decode(c.trim()).ok().and_then(|b| String::from_utf8(b).ok()).ok_or_else(|| args("that cursor is not one worker-list gave out"))?;
            let (of, at) = raw.rsplit_once('|').ok_or_else(|| args("that cursor is not one worker-list gave out"))?;
            if of != scope {
                return Err(args("that cursor came from another Run's worker list; start again without --cursor"));
            }
            at.parse::<usize>().map_err(|_| args("that cursor is not one worker-list gave out"))?
        }
    };
    let rows: Vec<Value> = dispatches
        .iter()
        .filter(|d| run.is_none() || d["runId"].as_str() == run)
        .map(|d| {
            let ts = terminal_state(d, live);
            let handle = terminal_of(d);
            let id = d["id"].as_str().unwrap_or_default();
            let next = match (ts, &handle) {
                ("active", _) => Some(format!("{CLI} orchestration worker-stop --dispatch {id}")),
                // ponytail: worker-release (ORCH-024) is not built, so the way to free a settled
                // worker's terminal is closing it by hand; release replaces this once it lands.
                ("reclaimable" | "retained", Some(h)) => Some(format!("{CLI} terminal close --terminal {h}")),
                // ORCH-026: a release that did not finish is tried again by releasing again.
                ("release_pending" | "release_unknown", _) => Some(format!("{CLI} orchestration worker-release --dispatch {id}")),
                _ => None,
            };
            let task = tasks.iter().find(|t| t["id"] == d["taskId"]).map(|t| t["status"].clone()).unwrap_or(Value::Null);
            json!({ "dispatchId": d["id"], "taskId": d["taskId"], "taskStatus": task, "status": d["status"], "terminalState": ts, "terminal": handle, "worktree": d["worktree"], "agent": d["agent"], "runId": d["runId"], "lastBeatAt": d["lastBeatAt"], "archive": d["archive"], "error": d["releaseError"], "terminalLeftOpen": d["terminalLeftOpen"], "next": next })
        })
        .filter(|w| state.is_none_or(|s| w["terminalState"] == s))
        .collect();
    let page: Vec<Value> = rows.iter().skip(start).take(limit).cloned().collect();
    let next = (start + limit < rows.len()).then(|| b64.encode(format!("{scope}|{}", start + limit)));
    // T-129-d: the coordinator's own finished top-level work rides beside the rows (ORCH-037).
    Ok(json!({ "workers": page, "nextCursor": next, "total": rows.len(), "scope": { "run": run, "from": from }, "finishedItems": finished_items(tasks, dispatches, run) }))
}

/// ORCH-025: keep a settled worker's terminal open on purpose. The mark lives on the stored
/// dispatch, so it survives a restart; keeping twice does no harm.
pub fn retain(dispatches: &mut [Value], live: &dyn Fn(&str) -> bool, id: &str, run: Option<&str>) -> Result<Value, Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let already = d["retained"] == true;
    if !already {
        match terminal_state(d, live) {
            "active" => return Err(Fail::new("dispatch_active", format!("{id} is still working; keep its terminal once it has settled, or stop it with worker-stop"))),
            "released" => return Err(Fail::new("terminal_gone", format!("{id}'s terminal is already gone, so there is nothing to keep"))),
            _ => d["retained"] = json!(true),
        }
    }
    Ok(json!({ "dispatchId": id, "taskId": d["taskId"], "terminal": terminal_of(d), "terminalState": "retained", "alreadyRetained": already }))
}

/// ORCH-024 / CLI-036 (T-089-c): start releasing a settled worker. The dispatch is marked release
/// pending before anything is closed, so a crash between saving and closing leaves a row that says
/// so; the handle that comes back is the terminal whose output is saved first and then closed
/// (none when its terminal is already gone, which releases it at once). A worker still working is
/// turned away to worker-stop; releasing twice answers the same. Releasing a kept worker is the
/// way to let it go, so a kept mark does not block it.
// Test-only since the CLI calls release_with (cli FIX-3 AFTER): the tests use it for the plain case.
#[cfg(test)]
pub fn release(dispatches: &mut [Value], live: &dyn Fn(&str) -> bool, id: &str, run: Option<&str>, now: u64) -> Result<(Value, Option<String>), Fail> {
    release_with(dispatches, live, id, run, now, &|_| None)
}

/// ORCH-024 as release, told what each terminal runs now (`agent_of`, as keep_open reads it), so a
/// terminal that runs another agent than the worker's, or a plain shell, is left open (FIX-1 S1).
pub fn release_with(dispatches: &mut [Value], live: &dyn Fn(&str) -> bool, id: &str, run: Option<&str>, now: u64, agent_of: &dyn Fn(&str) -> Option<Option<String>>) -> Result<(Value, Option<String>), Fail> {
    let i = dispatches.iter().position(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    if dispatches[i]["released"] == true {
        return Ok((release_receipt(&dispatches[i], true), None));
    }
    if !finished(&dispatches[i]) {
        return Err(Fail::new("dispatch_active", format!("{id} is still working; stop it first with {CLI} orchestration worker-stop --dispatch {id}")));
    }
    let handle = terminal_of(&dispatches[i]).filter(|h| live(h));
    // ORCH-024 (T-172-c): only the worker's own terminal is closed; one it was handed, or one
    // another dispatch still claims, is left open and the receipt says why.
    let left_open = handle.as_ref().and_then(|_| keep_open(dispatches, &dispatches[i], agent_of));
    let d = &mut dispatches[i];
    d["releaseAt"] = json!(now);
    if let Some(why) = &left_open {
        d["terminalLeftOpen"] = json!(why);
    }
    let handle = handle.filter(|_| left_open.is_none());
    match handle {
        Some(_) => d["release"] = json!("pending"),
        None => {
            d["released"] = json!(true);
            if let Some(o) = d.as_object_mut() {
                o.remove("release");
                o.remove("retained");
            }
        }
    }
    Ok((release_receipt(d, false), handle))
}

/// ORCH-024: settle a pending release once the caller has tried to save the terminal's output
/// (`saved`: where the archive went, or why it could not be written) and, only after a save, to
/// close the terminal (`closed`). A failed save never closes anything and leaves the release
/// unknown, with the reason; so does a close that did not happen. Either way the next command is
/// another worker-release.
pub fn release_done(dispatches: &mut [Value], id: &str, run: Option<&str>, saved: Result<String, String>, closed: bool, now: u64) -> Result<Value, Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    if d["release"] != "pending" && d["release"] != "unknown" {
        return Ok(release_receipt(d, d["released"] == true));
    }
    match (&saved, closed) {
        (Ok(path), true) => {
            d["released"] = json!(true);
            d["archive"] = json!(path);
            d["releasedAt"] = json!(now);
            if let Some(o) = d.as_object_mut() {
                o.remove("release");
                o.remove("releaseError");
                o.remove("retained");
            }
        }
        (Ok(path), false) => {
            d["release"] = json!("unknown");
            d["archive"] = json!(path);
            d["releaseError"] = json!("the output was saved but the terminal could not be closed");
        }
        (Err(why), _) => {
            d["release"] = json!("unknown");
            d["releaseError"] = json!(format!("the output could not be saved, so the terminal was left open: {why}"));
        }
    }
    Ok(release_receipt(d, false))
}

fn release_receipt(d: &Value, already: bool) -> Value {
    let id = d["id"].as_str().unwrap_or_default();
    let state = if d["released"] == true { "released" } else { d["release"].as_str().map_or("released", |r| if r == "pending" { "release_pending" } else { "release_unknown" }) };
    let next = (state == "release_unknown").then(|| format!("{CLI} orchestration worker-release --dispatch {id}"));
    json!({ "dispatchId": d["id"], "taskId": d["taskId"], "terminal": terminal_of(d), "terminalState": state, "archive": d["archive"], "error": d["releaseError"], "terminalLeftOpen": d["terminalLeftOpen"], "worktree": d["worktree"], "worktreeKept": true, "alreadyReleased": already, "next": next })
}

/// ORCH-024 (T-172-c): why a release must leave the worker's terminal open, if it must. The
/// terminal is not the worker's own when the worker was handed a terminal that was already open
/// (a dispatch to it, which records how the brief went in); and Kolux's records may show another
/// dispatch, still working or kept on purpose, naming the very same terminal. Closing it then
/// could close someone else's work, so it stays. A claim already released does not count.
/// FIX-1 S1: and what the terminal runs now must be the worker's own agent. `agent_of` answers
/// None when Kolux cannot tell (then its records decide), Some(None) for a shell or a program that
/// is no agent, Some(Some(id)) for an agent; anything but the worker's agent stays open.
fn keep_open(dispatches: &[Value], d: &Value, agent_of: &dyn Fn(&str) -> Option<Option<String>>) -> Option<String> {
    let h = terminal_of(d)?;
    if !d["mode"].is_null() {
        return Some(format!("{h} was already open when the worker was handed it, so it is not the worker's own to close"));
    }
    // ORCH-036 (T-155-b): typing into the worker's terminal makes it the user's; stop and release
    // then leave it open and say so. The window's terminal_write reports the user's keystrokes to
    // sendonce::other_writer; Kolux's own sends go through sendonce::claim and never count.
    if d["terminal"].as_u64().and_then(|t| u32::try_from(t).ok()).is_some_and(|t| sendonce::taken_over_since(t, d["created"].as_u64().unwrap_or(0))) {
        return Some(format!("the user typed into {h} after the worker started, so it was taken over and is theirs now, not the worker's to close"));
    }
    let agent = d["agent"].as_str().unwrap_or("its agent");
    match agent_of(&h) {
        Some(Some(now)) if now != agent => return Some(format!("{h} now runs {now}, not the worker's {agent}, so it is not the worker's own to close")),
        Some(None) => return Some(format!("{h} runs no agent now (a shell or another program), so it is not the worker's own to close")),
        _ => {}
    }
    dispatches
        .iter()
        .find(|o| o["id"] != d["id"] && o["released"] != true && (!finished(o) || o["retained"] == true) && terminal_of(o).as_deref() == Some(h.as_str()))
        .map(|o| format!("{h} is also claimed by {}, so closing it could close that worker's terminal", o["id"].as_str().unwrap_or("another dispatch")))
}

/// ORCH-017 (T-172-c): the receipt of a worker start that did not come up. `stage` is the step it
/// reached ("setup" when the setup script failed, "worker" when the agent did not answer in time)
/// and `setup` the setup script's result (the CLI records a failed setup's task as failed first). A failed setup is a failure and a worker that did not
/// answer is an unknown outcome; the CLI exits 1 for both. Every terminal the start opened is
/// listed as left over, never closed, and so is a worktree it made; `next` says how to clean up
/// (release a failed worker, stop one that may still be starting, remove the new worktree) and how
/// to try again: a retry names the task and makes its own placement.
pub fn start_failed(receipt: &mut Value, stage: &str, setup: Value) {
    let id = receipt["dispatchId"].as_str().unwrap_or_default().to_string();
    let task = receipt["taskId"].as_str().unwrap_or_default().to_string();
    let failed = stage == "setup";
    let terminals: Vec<String> = receipt["terminals"].as_array().into_iter().flatten().filter_map(|t| t["id"].as_u64()).map(|t| crate::terminal::handle_of(t as u32)).collect();
    let made = (receipt["worktree"]["created"] == true).then(|| receipt["worktree"]["path"].as_str().unwrap_or_default().to_string());
    let mut effects = vec![format!("{task} was handed to {id}")];
    effects.extend(made.iter().map(|p| format!("worktree {p} was made")));
    effects.extend(terminals.iter().map(|t| format!("terminal {t} was opened")));
    // FIX-1 B1: in this order, each runnable after the one before. A worker that did not answer is
    // still working as far as Kolux knows, and its task still dispatched, so it is stopped first
    // (which frees the task) whether or not a terminal was seen. A failed setup is recorded failed
    // by the CLI, which settles the worker, so a terminal it left is released. The retry is a plain
    // worker-start of the same task (start_check), which makes its own placement.
    let mut next = Vec::new();
    if !failed {
        next.push(format!("{CLI} orchestration worker-stop --dispatch {id}"));
    } else if !terminals.is_empty() {
        next.push(format!("{CLI} orchestration worker-release --dispatch {id}"));
    }
    next.push(format!("{CLI} orchestration worker-start --task {task}"));
    // Council AFTER A2: the path is quoted, so a folder with a space pastes as one word.
    next.extend(made.iter().map(|p| format!("{CLI} worktree rm --worktree \"path:{p}\" --force")));
    receipt["status"] = json!(if failed { "failed" } else { "unknown" });
    receipt["stage"] = json!(stage);
    receipt["setup"] = setup;
    receipt["effects"] = json!(effects);
    receipt["leftovers"] = json!({ "terminals": terminals, "worktree": made });
    receipt["next"] = json!(next);
}

// ---------------------------------------------------------------- the dispatch pass (ORCH-067, T-155-b)

/// The option the brief's ready-made commands carry the pass in (COMPAT: the owner's skill passes it).
pub const PASS_OPTION: &str = "--dispatch-capability";
/// What stands in for a pass in every read of worker output.
// The callers live in cli.rs (evidence/orchestration-T-155-b-cli.patch); drop this allow once it lands.
pub const PASS_HIDDEN: &str = "[dispatch pass hidden]";

/// Why dispatch `d`'s pass turns the command with arguments `a` away, if it does: the dispatch has
/// a pass (worker-start gave it one) and `a` carries none or another one. The text names the option,
/// since the reader is usually an agent that sees only the error. A dispatch without a pass (the
/// low-level dispatch command) is never turned away here: its reports are tied to its pane instead.
pub fn pass_refusal(d: &Value, a: &Value) -> Option<String> {
    let want = d["pass"].as_str()?;
    let id = d["id"].as_str().unwrap_or("this dispatch");
    match a["dispatchCapability"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(got) if got == want => None,
        Some(_) => Some(format!("the {PASS_OPTION} given is not {id}'s pass (another worker's, another dispatch's, or an earlier process's); use the one in {id}'s brief")),
        None => Some(format!("{id} reports with its dispatch pass: add {PASS_OPTION} <pass> from the ready-made commands in its brief")),
    }
}

/// Row 211: the field a dispatch stores the pane's process generation in when its pass is minted.
pub const PASS_GENERATION: &str = "passGeneration";

/// Row 211 seam: how many processes terminal `terminal` has had in its pane (bumps on every
/// spawn/respawn), or None for a terminal Kolux does not know.
pub fn process_generation(terminals: &crate::terminal::Terminals, terminal: u32) -> Option<u64> {
    terminals.process_generation(terminal)
}

/// Why dispatch `d`'s pass is dead: it was minted for an earlier process of the pane than the one
/// running there now (`generation_of` reads the current one). A dispatch without a stamp, or a
/// pane that cannot say, is not turned away: not knowing is no evidence of a restart.
pub fn stale_pass(d: &Value, generation_of: &dyn Fn(u32) -> Option<u64>) -> Option<String> {
    let minted = d[PASS_GENERATION].as_u64()?;
    let now = generation_of(d["terminal"].as_u64()? as u32)?;
    let id = d["id"].as_str().unwrap_or("this dispatch");
    (now != minted).then(|| format!("{id}'s pass was minted for an earlier process in this pane (process {minted}; the pane now runs process {now}), so it is no longer valid; ask the coordinator to dispatch the work again"))
}

/// Every pass on record, for the reads that must hide them.
// The callers live in cli.rs (evidence/orchestration-T-155-b-cli.patch); drop this allow once it lands.
pub fn passes(dispatches: &[Value]) -> Vec<String> {
    dispatches.iter().filter_map(|d| d["pass"].as_str()).filter(|p| !p.is_empty()).map(str::to_string).collect()
}

/// Hides every pass in every string of `v` (keys stay): live lines, a screen with text typed but not
/// submitted, transcript payloads alike. Returns whether anything was hidden.
// The callers live in cli.rs (evidence/orchestration-T-155-b-cli.patch); drop this allow once it lands.
pub fn redact(v: &mut Value, passes: &[String]) -> bool {
    match v {
        Value::String(s) => {
            let mut hit = false;
            for p in passes.iter().filter(|p| !p.is_empty()) {
                if s.contains(p.as_str()) {
                    *s = s.replace(p, PASS_HIDDEN);
                    hit = true;
                }
            }
            hit
        }
        Value::Array(items) => items.iter_mut().fold(false, |hit, i| redact(i, passes) | hit),
        Value::Object(map) => map.values_mut().fold(false, |hit, i| redact(i, passes) | hit),
        _ => false,
    }
}

/// A `terminal read` answer with its passes hidden and, when one was, a warning that says so.
// The callers live in cli.rs (evidence/orchestration-T-155-b-cli.patch); drop this allow once it lands.
pub fn redact_read(out: &mut Value, passes: &[String]) {
    if passes.is_empty() || !redact(out, passes) {
        return;
    }
    let warning = json!(format!("a dispatch pass was hidden from this output ({PASS_HIDDEN})"));
    match out["warnings"].as_array_mut() {
        Some(w) => w.push(warning),
        None => out["warnings"] = json!([warning]),
    }
}

/// Archive lines with their passes hidden; a marker line says when one was.
// The callers live in cli.rs (evidence/orchestration-T-155-b-cli.patch); drop this allow once it lands.
pub fn redact_lines(mut lines: Vec<String>, passes: &[String]) -> Vec<String> {
    let mut hit = false;
    for l in &mut lines {
        for p in passes.iter().filter(|p| !p.is_empty()) {
            if l.contains(p.as_str()) {
                *l = l.replace(p, PASS_HIDDEN);
                hit = true;
            }
        }
    }
    if hit {
        lines.push(format!("[Kolux: a dispatch pass was hidden from this archive ({PASS_HIDDEN})]"));
    }
    lines
}

/// ORCH-024: where a released worker's terminal output is kept: one plain text file per dispatch
/// under the app's data folder, written whole before the terminal is closed.
pub fn write_archive(dir: &std::path::Path, id: &str, lines: &[String]) -> Result<String, String> {
    let safe: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let folder = dir.join("worker-archives");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{safe}.txt"));
    let mut text = lines.join("\n");
    text.push('\n');
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// CLI-036: worker-stop's warning when the worker's process may outlive the stop (Kolux does not
/// hold its terminal, or ending it failed). Called on every stop receipt, and again by the CLI
/// after a failed kill turns the process verdict to unverifiable.
pub fn stop_warning(receipt: &mut Value) {
    if let Some(why) = receipt["terminalLeftOpen"].as_str().filter(|_| receipt["process"] == "unverifiable") {
        receipt["warning"] = json!(format!("the worker's process was left running: {why}; close it by hand if it should stop"));
    } else if receipt["process"] == "unverifiable" {
        let term = receipt["terminal"].as_str().unwrap_or("its terminal").to_string();
        receipt["warning"] = json!(format!("the worker's process was kept alive: Kolux could not end {term}, so it may still be running; close it by hand if it is"));
    }
}

/// CLI-036: a terminal command aimed at a worker that has no terminal is refused by name, with
/// the way to read it instead. `handle` is what the command was given: a dispatch id or a
/// terminal handle; a handle that is no worker's passes through unchanged.
pub fn terminal_for(dispatches: &[Value], handle: &str) -> Result<String, Fail> {
    match dispatches.iter().find(|d| d["id"] == handle) {
        Some(d) => terminal_of(d).ok_or_else(|| Fail::new("no_terminal", format!("{handle} has no terminal, so terminal commands cannot reach it; read it with {CLI} orchestration worker-read --dispatch {handle} --source transcript"))),
        None => Ok(handle.to_string()),
    }
}

/// CLI-036 worker-show: one worker's row and whether it waits on a person. `attention` is the
/// pane's own hook state when it has one ("input" or "approval" mean a person is needed). It says
/// nothing is waiting only when it could tell: the terminal has ended, or the worker has settled
/// with no terminal left. Otherwise it says unknown: reading prompts off the screen is not built
/// (T-129-c), so a quiet pane is never reported as waiting on nobody.
pub fn worker_show(tasks: &[Value], dispatches: &[Value], id: &str, run: Option<&str>, live: &dyn Fn(&str) -> bool, attention: Option<&str>) -> Result<Value, Fail> {
    let d = dispatches.iter().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let handle = terminal_of(d);
    let open = handle.as_deref().is_some_and(live);
    // Council FIX-SOON: "no" only when Kolux could tell: the worker has settled, or it had a
    // terminal and that terminal has ended. A running worker with no terminal at all is unknown.
    let (waiting, why) = match attention {
        Some(a @ ("input" | "approval")) if open => ("yes", format!("its agent is waiting for {a}")),
        _ if handle.is_some() && !open => ("no", "its terminal has ended, so nothing in it can wait".to_string()),
        _ if handle.is_none() && finished(d) => ("no", "it has settled and has no terminal, so nothing can wait".to_string()),
        _ if handle.is_none() => ("unknown", "Kolux holds no terminal for it, so it cannot say nothing is waiting".to_string()),
        _ => ("unknown", "Kolux has not read a prompt off its screen, so it cannot say nothing is waiting".to_string()),
    };
    let flag = self::attention(d, live, attention, wall_ms());
    let task = tasks.iter().find(|t| t["id"] == d["taskId"]).map(|t| t["status"].clone()).unwrap_or(Value::Null);
    Ok(json!({ "dispatchId": d["id"], "taskId": d["taskId"], "taskStatus": task, "status": d["status"], "terminalState": terminal_state(d, live), "terminal": handle, "worktree": d["worktree"], "agent": d["agent"], "waiting": waiting, "waitingWhy": why, "archive": d["archive"], "cutShort": d["cutShort"], "attention": flag.as_ref().map(|f| f.0), "attentionWhy": flag.map(|f| f.1) }))
}

/// ORCH-037: how long a working worker may stay quiet (no heartbeat) before it is flagged stale.
// ponytail: one fixed window; the brief asks for a beat about every five minutes, so ten
// minutes is two missed beats. A setting can replace it when someone needs another window.
pub const STALE_MS: u64 = 600_000;

/// ORCH-037: what about this worker needs a person, and why, or None when nothing does:
/// failure, interruption (its terminal ended, its process ended before a done report, or Kolux
/// restarted under it), input or approval (its pane's own hook state while the terminal is open),
/// then stale (quiet past STALE_MS). A settled worker raises nothing; a dead one never looks healthy.
pub fn attention(d: &Value, live: &dyn Fn(&str) -> bool, hook: Option<&str>, now: u64) -> Option<(&'static str, String)> {
    if d["status"] == "failed" {
        return Some(("failure", "its task failed".into()));
    }
    if finished(d) {
        return None;
    }
    let handle = terminal_of(d);
    if !d["exitedAt"].is_null() {
        return Some(("interruption", "its agent ended before it reported done".into()));
    }
    if !d["terminal"].is_null() && !handle.as_deref().is_some_and(live) {
        let why = if handle.is_none() { "Kolux restarted under it, so its terminal is gone" } else { "its terminal has ended" };
        return Some(("interruption", why.into()));
    }
    match hook {
        Some("input") => return Some(("input", "its agent is waiting for input".into())),
        Some("approval") => return Some(("approval", "its agent is waiting for approval".into())),
        _ => {}
    }
    // A made-at below 1e12 is no wall clock time (worker-start stores elapsed ms), so it proves nothing.
    let last = d["lastBeatAt"].as_u64().or_else(|| d["created"].as_u64().filter(|c| *c >= 1_000_000_000_000))?;
    (now.saturating_sub(last) > STALE_MS).then(|| ("stale", format!("no heartbeat for over {} minutes", STALE_MS / 60_000)))
}

/// ORCH-037 (T-129-d): the coordinator's own top-level work that finished well, each a finished
/// item that needs nothing: a task of `run` with no parent that is completed and was never
/// dispatched to a worker (the coordinator did it itself). A worker's task finishing well is no
/// item: its dispatch carries it, and `attention` raises nothing for it.
pub fn finished_items(tasks: &[Value], dispatches: &[Value], run: Option<&str>) -> Vec<Value> {
    tasks
        .iter()
        .filter(|t| run.is_none() || t["runId"].as_str() == run)
        .filter(|t| t["status"] == "completed" && t["parent"].is_null())
        .filter(|t| !dispatches.iter().any(|d| d["taskId"] == t["id"]))
        .map(|t| json!({ "taskId": t["id"], "label": t["displayName"].as_str().or(t["title"].as_str()), "attention": "finished", "attentionWhy": "the coordinator's own work finished well; nothing is needed", "completedAt": t["updated"] }))
        .collect()
}

#[cfg(test)]
mod finished_items_tests {
    use super::*;

    #[test]
    fn orch037_only_the_coordinators_own_top_level_work_finishing_well_is_a_finished_item() {
        let tasks = vec![
            json!({ "id": "task-own", "runId": "run-1", "status": "completed", "parent": null, "title": "Write the plan", "updated": 5 }),
            json!({ "id": "task-worker", "runId": "run-1", "status": "completed", "parent": null, "title": "Build the page" }),
            json!({ "id": "task-child", "runId": "run-1", "status": "completed", "parent": "task-own", "title": "A sub-step" }),
            json!({ "id": "task-open", "runId": "run-1", "status": "dispatched", "parent": null }),
            json!({ "id": "task-other-run", "runId": "run-2", "status": "completed", "parent": null, "displayName": "Elsewhere" }),
        ];
        let dispatches = vec![json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-worker", "status": "completed", "terminal": 4 })];
        let items = finished_items(&tasks, &dispatches, Some("run-1"));
        assert_eq!(items.len(), 1, "the worker's task, the sub-step, the open task and another Run's task are no items: {items:?}");
        assert_eq!((items[0]["taskId"].as_str(), items[0]["label"].as_str(), items[0]["attention"].as_str(), items[0]["completedAt"].as_u64()), (Some("task-own"), Some("Write the plan"), Some("finished"), Some(5)));
        // The worker finishing well raises no attention flag of its own.
        assert_eq!(attention(&dispatches[0], &|_| true, None, 1_700_000_000_000), None);
        // Every Run: the other Run's own work shows too, labelled by its display name.
        let all = finished_items(&tasks, &dispatches, None);
        assert_eq!(all.iter().map(|i| i["label"].as_str().unwrap_or_default()).collect::<Vec<_>>(), ["Write the plan", "Elsewhere"]);
        // worker-list carries the items beside its rows, so a coordinator reading its workers sees them.
        let listed = worker_list(&tasks, &dispatches, Some("run-1"), "term-1", None, None, 10, &|_| true).unwrap();
        assert_eq!(listed["finishedItems"][0]["taskId"], "task-own");
        assert_eq!(listed["workers"].as_array().map(Vec::len), Some(1));
    }
}

/// ORCH-066: what a worker's row reads as: the task's display name, else its title, else a one-line
/// preview of its text. Before the task is known, the preview comes from the brief's task section
/// (after the first divider, so task text imitating it changes nothing); never the wrapper text.
pub fn worker_label(tasks: &[Value], d: &Value) -> Option<String> {
    let field = |t: &Value, k: &str| one_line(t[k].as_str().unwrap_or_default());
    match tasks.iter().find(|t| t["id"] == d["taskId"]) {
        Some(t) => field(t, "displayName").or_else(|| field(t, "title")).or_else(|| field(t, "spec")),
        None => one_line(d["brief"].as_str()?.split_once(DIVIDER)?.1),
    }
}

/// ORCH-066 (council FIX-1 S4): a name as one short line fit for a tab title: colour and cursor
/// codes dropped, every other control character and invisible direction or width mark turned to
/// a space, whitespace folded, at most 60 characters; None when nothing is left.
fn one_line(s: &str) -> Option<String> {
    let invisible = |c: char| c.is_control() || ('\u{200b}'..='\u{200f}').contains(&c) || ('\u{202a}'..='\u{202e}').contains(&c) || ('\u{2066}'..='\u{2069}').contains(&c) || c == '\u{feff}';
    // Line breaks and other control characters become spaces first (the code stripper drops them,
    // which would glue words together); the escape that starts a code is kept for it to find.
    let spaced: String = s.chars().map(|c| if c != '\u{1b}' && invisible(c) { ' ' } else { c }).collect();
    let plain: String = crate::terminal::strip_ansi(&spaced).chars().map(|c| if invisible(c) { ' ' } else { c }).collect();
    Some(cut(&plain.split_whitespace().collect::<Vec<_>>().join(" "), 60)).filter(|s| !s.is_empty())
}

/// ORCH-066: the label for each terminal a worker of this start of Kolux is on, by handle; the
/// newest unreleased dispatch wins, and a terminal with no worker is left out.
pub fn labels_by_terminal(tasks: &[Value], dispatches: &[Value]) -> Value {
    let mut out = serde_json::Map::new();
    for d in dispatches.iter().filter(|d| d["released"] != true) {
        if let (Some(h), Some(l)) = (terminal_of(d), worker_label(tasks, d)) {
            out.insert(h, json!(l));
        }
    }
    Value::Object(out)
}

/// ORCH-066: the task name for each worker's terminal, for the Agents view and Board (T-129-d).
#[tauri::command]
pub fn worker_labels(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>) -> Result<Value, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let load = |k: &str| crate::state::kept::load::<Vec<Value>>(&store, k);
    Ok(labels_by_terminal(&load(TASKS_KEY)?, &load(DISPATCHES_KEY)?))
}

/// ORCH-040: the open dispatches tied to one worktree, by the folder they were started in or by a
/// live terminal that sits there.
pub fn workers_in(dispatches: &[Value], here: &dyn Fn(&str) -> bool, homed: &dyn Fn(&str) -> bool) -> Vec<Value> {
    dispatches
        .iter()
        .filter(|d| !finished(d))
        .filter_map(|d| {
            let t = terminal_of(d);
            let mine = d["worktree"].as_str().is_some_and(here) || t.as_deref().is_some_and(homed);
            mine.then(|| json!({ "dispatchId": d["id"], "taskId": d["taskId"], "runId": d["runId"], "status": d["status"], "agent": d["agent"], "terminal": t }))
        })
        .collect()
}

impl Mail {
    /// The saved mail. A blob that does not read is kept aside first (row 193, `kept`); a store that
    /// cannot be read at all loads empty but marked `unread`, so it is never saved over.
    pub fn load(store: &crate::state::Store) -> Mail {
        crate::state::kept::load(store, KEY).unwrap_or_else(|why| {
            eprintln!("kolux: {why}");
            Mail { unread: true, ..Mail::default() }
        })
    }

    /// Refuses while the stored mail is unread (row 193); callers that change other state first ask this
    /// before changing anything, so a refused save never leaves half a change behind.
    pub fn ensure_readable(&self) -> Result<(), Fail> {
        if self.unread {
            return Err(Fail::new("failed", format!("the orchestration mail ({KEY}) could not be read, so nothing was saved over it; try again")));
        }
        Ok(())
    }

    pub fn save(&self, store: &crate::state::Store) -> Result<(), Fail> {
        self.ensure_readable()?;
        let text = serde_json::to_string(self).map_err(|e| Fail::new("failed", e.to_string()))?;
        store.set(KEY, &text).map_err(|e| Fail::new("failed", e.to_string()))
    }

    fn next(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{prefix}-{}", self.seq)
    }

    pub fn bound(&self, pane: &str) -> Option<&str> {
        self.bindings.get(pane).and_then(|b| b.run.as_deref())
    }

    /// ORCH-033: the Run a pane acts in: the one it is tied to, else the Run of the dispatch its
    /// worker is on. A worker that makes a Run of its own acts in that one from then on.
    pub fn run_of(&self, pane: &str, dispatches: &[Value]) -> Option<String> {
        self.bound(pane).map(str::to_string).or_else(|| own_dispatch(pane, dispatches).and_then(|d| d["runId"].as_str().map(str::to_string)))
    }

    /// Goes up every time the pane is tied to a Run, so a check that started waiting before can
    /// tell it was fenced off.
    pub fn epoch(&self, pane: &str) -> u64 {
        self.bindings.get(pane).map(|b| b.epoch).unwrap_or(0)
    }

    fn bind(&mut self, pane: &str, run: &str) {
        let b = self.bindings.entry(pane.to_string()).or_default();
        b.run = Some(run.to_string());
        b.epoch += 1;
    }

    /// A retry request id makes a change safe to repeat: the same id hands back the first answer
    /// (ORCH-030). A change that fails leaves no receipt, so the same id later runs fresh.
    pub fn once(&mut self, key: Option<String>, f: impl FnOnce(&mut Mail) -> Result<Value, Fail>) -> Result<Value, Fail> {
        if let Some(v) = key.as_ref().and_then(|k| self.answers.get(k)) {
            return Ok(v.clone());
        }
        if key.is_some() {
            self.room()?;
        }
        let v = f(self)?;
        if let Some(k) = key {
            self.finish(&k, Some(v.clone()));
        }
        Ok(v)
    }

    fn room(&self) -> Result<(), Fail> {
        if self.pending.len() >= MAX_PENDING {
            return Err(Fail::new("busy", format!("{MAX_PENDING} earlier requests have not finished yet, so Kolux takes no new change until one does; ask about one with request-show")));
        }
        Ok(())
    }

    /// ORCH-030: a long request is under way; a retry with its id waits for it.
    pub fn begin(&mut self, key: &str, runtime: u64) -> Result<(), Fail> {
        self.room()?;
        self.pending.insert(key.to_string(), json!({ "at": wall_ms(), "runtime": runtime }));
        Ok(())
    }

    /// ORCH-030: the request is over: its receipt is kept (`Some`) or it left none, and finished
    /// receipts older than `RECEIPT_TTL_MS` are dropped.
    pub fn finish(&mut self, key: &str, answer: Option<Value>) {
        let now = wall_ms();
        self.pending.remove(key);
        if let Some(v) = answer {
            self.answers.insert(key.to_string(), v);
            self.stamps.insert(key.to_string(), now);
        }
        for k in self.answers.keys() {
            self.stamps.entry(k.clone()).or_insert(now);
        }
        let old: Vec<String> = self.stamps.iter().filter(|(_, at)| now.saturating_sub(**at) > RECEIPT_TTL_MS).map(|(k, _)| k.clone()).collect();
        for k in old {
            self.answers.remove(&k);
            self.stamps.remove(&k);
        }
    }

    /// ORCH-030: what became of the request this terminal sent with `--retry-request <id>`:
    /// completed (with its result), pending, or absent. It changes nothing. A pending request left
    /// by an earlier start of Kolux (`runtime` is this one's process id) is marked interrupted.
    pub fn request_show(&self, pane: &str, id: &str, runtime: u64) -> Value {
        let tail = format!("|{pane}|{id}");
        let command = |k: &str| k.strip_suffix(&tail).unwrap_or_default().to_string();
        if let Some((k, v)) = self.answers.iter().find(|(k, _)| k.ends_with(&tail)) {
            return json!({ "request": id, "state": "completed", "command": command(k), "result": v });
        }
        if let Some((k, p)) = self.pending.iter().find(|(k, _)| k.ends_with(&tail)) {
            let interrupted = p["runtime"].as_u64() != Some(runtime);
            return json!({ "request": id, "state": "pending", "command": command(k), "since": p["at"], "interrupted": interrupted });
        }
        json!({ "request": id, "state": "absent" })
    }

    fn run_view(&self, id: &str) -> Value {
        match self.runs.iter().find(|r| r.id == id) {
            Some(r) => json!({ "id": r.id, "objective": r.objective, "home": r.home, "created": r.created }),
            None => Value::Null,
        }
    }

    /// ORCH-001: a Run is a namespace with a home mailbox; making one schedules nothing.
    // ORCH-032: a worker's depth comes from its dispatch, so a Run made here leaves it as it was.
    pub fn run_create(&mut self, pane: &str, objective: &str, now: u64) -> Value {
        let id = self.next("run");
        self.runs.push(Run { id: id.clone(), objective: objective.to_string(), home: pane.to_string(), created: now });
        self.bind(pane, &id);
        json!({ "run": self.run_view(&id), "binding": { "terminal": pane, "runId": id } })
    }

    /// ORCH-002: points the pane at another Run; any waiter parked on the old one is fenced.
    // Runs left by an older install (ORCH-048) are a skip in DECISIONS.md, so none can be legacy;
    // --takeover-legacy is accepted for scripts that pass it and changes nothing.
    pub fn run_use(&mut self, pane: &str, id: &str) -> Result<Value, Fail> {
        if !self.runs.iter().any(|r| r.id == id) {
            return Err(Fail::new("not_found", format!("no Run {id}")));
        }
        self.bind(pane, id);
        Ok(json!({ "run": self.run_view(id), "binding": { "terminal": pane, "runId": id } }))
    }

    pub fn run_current(&self, pane: &str) -> Value {
        let run = self.bound(pane);
        json!({ "terminal": pane, "runId": run, "run": run.map(|r| self.run_view(r)) })
    }

    /// Newest first, `limit` at a time; the cursor is where the next page starts.
    pub fn run_list(&self, limit: usize, cursor: Option<&str>) -> Result<Value, Fail> {
        let start = match cursor {
            Some(c) => c.parse::<usize>().map_err(|_| args("that cursor is not one run-list gave out"))?,
            None => 0,
        };
        let runs: Vec<Value> = self.runs.iter().rev().skip(start).take(limit).map(|r| self.run_view(&r.id)).collect();
        let next = (start + limit < self.runs.len()).then(|| (start + limit).to_string());
        Ok(json!({ "runs": runs, "nextCursor": next, "total": self.runs.len() }))
    }

    pub fn run_show(&self, id: &str) -> Result<Value, Fail> {
        let mut v = self.run_view(id);
        let obj = v.as_object_mut().ok_or_else(|| Fail::new("not_found", format!("no Run {id}")))?;
        let terminals: Vec<&String> = self.bindings.iter().filter(|(_, b)| b.run.as_deref() == Some(id)).map(|(h, _)| h).collect();
        let mail: Vec<&Message> = self.messages.iter().filter(|m| m.run.as_deref() == Some(id)).collect();
        let acked = self.acked();
        obj.insert("terminals".into(), json!(terminals));
        obj.insert("messages".into(), json!(mail.len()));
        obj.insert("unacknowledged".into(), json!(mail.iter().filter(|m| !acked.contains(&m.id)).count()));
        Ok(v)
    }

    /// The mailboxes a pane reads: its own terminal box, its Run when it is tied to one, and the
    /// box of any active dispatch it is the worker of.
    pub fn boxes_of(&self, pane: &str, dispatches: &[Value]) -> Vec<String> {
        let mut boxes = vec![format!("term:{pane}")];
        if let Some(r) = self.bound(pane) {
            boxes.push(format!("run:{r}"));
        }
        for d in dispatches.iter().filter(|d| !finished(d) && terminal_of(d).as_deref() == Some(pane)) {
            boxes.push(format!("dispatch:{}", d["id"].as_str().unwrap_or_default()));
        }
        boxes
    }

    /// ORCH-003: one typed message, routed by its recipient field only, or refused whole.
    pub fn send(&mut self, from: &str, a: &Value, dispatches: &[Value], live: &dyn Fn(&str) -> bool, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let subject = text("subject").ok_or_else(|| args("--subject is required"))?;
        let kind = text("type").unwrap_or_else(|| "status".into());
        if !KINDS.contains(&kind.as_str()) {
            return Err(args(format!("--type takes one of {}", KINDS.join(", "))));
        }
        let priority = text("priority").unwrap_or_else(|| "normal".into());
        if !["normal", "high", "urgent"].contains(&priority.as_str()) {
            return Err(args("--priority takes normal, high or urgent"));
        }
        let outcome = text("outcome");
        if outcome.as_deref().is_some_and(|o| o != "succeeded" && o != "failed") {
            return Err(args("--outcome takes succeeded or failed"));
        }
        if kind == "worker_done" && outcome.is_none() {
            return Err(args("a done report must say how it ended: --outcome succeeded or failed"));
        }
        // ORCH-023: a dispatch that was abandoned (or has otherwise finished) takes no more reports.
        if kind == "worker_done" || kind == "heartbeat" {
            if let Some(d) = text("dispatchId").and_then(|id| dispatches.iter().find(|d| d["id"] == id.as_str())).filter(|d| finished(d)) {
                let id = d["id"].as_str().unwrap_or_default();
                return Err(Fail::new("dispatch_finished", format!("{id} was {}: Kolux takes no more reports on it", d["status"].as_str().unwrap_or_default())));
            }
            // CLI-039, ORCH-015: a report from any other pane is still delivered as mail; only
            // `report` decides whether it settles anything.
        }
        let payload = text("payload").map(|p| serde_json::from_str::<Value>(&p)).transpose().map_err(|_| args("--payload takes JSON"))?;
        let named = text("run");
        if let Some(r) = &named {
            if !self.runs.iter().any(|x| &x.id == r) {
                return Err(Fail::new("not_found", format!("no Run {r}")));
            }
        }
        let run_exists = |id: &str| self.runs.iter().any(|x| x.id == id);
        let (to, run) = match text("to") {
            Some(t) if t.starts_with('@') => {
                if kind == "worker_done" || kind == "heartbeat" {
                    return Err(args("done reports and heartbeats never go to a group; send them to run:<id>"));
                }
                // ORCH-004: groups fan out in `post`, which hands each copy here with one handle.
                return Err(Fail::new("unsupported", format!("{t} is a group address; send it through post")));
            }
            Some(t) if t.starts_with("run:") => {
                let id = &t[4..];
                if !run_exists(id) {
                    return Err(Fail::new("not_found", format!("no Run {id}")));
                }
                (t.clone(), Some(id.to_string()))
            }
            Some(t) if t.starts_with("dispatch:") => {
                let id = &t[9..];
                let d = dispatches.iter().find(|d| d["id"] == id).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
                let run = d["runId"].as_str().map(str::to_string);
                if finished(d) {
                    let home = run.as_ref().map(|r| format!("run:{r}")).unwrap_or_else(|| "its Run".into());
                    return Err(Fail { code: "dispatch_finished", message: format!("{id} has finished; write to {home} instead"), data: json!({ "hint": format!("--to {home}") }) });
                }
                (t.clone(), run)
            }
            Some(h) => {
                if !live(&h) {
                    return Err(Fail::new("not_found", format!("no open Kolux terminal is called {h}")));
                }
                (format!("term:{h}"), self.bound(&h).map(str::to_string))
            }
            None => {
                let own = dispatches.iter().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(from)).and_then(|d| d["runId"].as_str());
                match named.as_deref().or(own) {
                    Some(r) => (format!("run:{r}"), Some(r.to_string())),
                    None => return Err(args("say who gets it: --to run:<id>, dispatch:<id> or a terminal handle")),
                }
            }
        };
        if let (Some(n), Some(r)) = (&named, &run) {
            if n != r {
                return Err(Fail::new("run_mismatch", format!("{to} belongs to {r}, not to the Run named with --run ({n})")));
            }
        }
        let mut extras = Map::new();
        for k in ["threadId", "taskId", "dispatchId", "outcome", "reportPath", "phase", "fromAgent"] {
            if let Some(v) = text(k) {
                extras.insert(k.into(), json!(v));
            }
        }
        if let Some(p) = payload {
            extras.insert("payload".into(), p);
        }
        if let Some(f) = text("filesModified") {
            extras.insert("filesModified".into(), json!(f.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()));
        }
        let id = self.next("msg");
        let body = a["body"].as_str().unwrap_or_default().to_string();
        self.messages.push(Message { id: id.clone(), to: to.clone(), run: run.clone(), from: from.to_string(), subject, body, kind, priority, extras, at: now });
        Ok(json!({ "messageIds": [id], "to": to, "runId": run }))
    }

    /// ORCH-004: a group address (@all, @idle, @worktree:<id>, @claude, @codex, @cursor, @droid)
    /// becomes one copy per matching agent terminal, never the sender's own, all on one thread, or
    /// nothing at all; any other address is one ordinary send to the open terminals in `peers`.
    pub fn post(&mut self, from: &str, a: &Value, dispatches: &[Value], peers: &[Peer], now: u64) -> Result<Value, Fail> {
        let live = |h: &str| peers.iter().any(|p| p.handle == h);
        let mut a = a.clone();
        // ORCH-009: the sender's agent, as Kolux detected it, names it in the banner.
        let sender = peers.iter().find(|p| p.handle == from).and_then(|p| p.agent.as_deref());
        match sender.and_then(|id| crate::agents::CATALOGUE.iter().find(|e| e.0 == id)) {
            Some(e) => a["fromAgent"] = json!(e.1),
            None => {
                if let Some(o) = a.as_object_mut() {
                    o.remove("fromAgent");
                }
            }
        }
        let Some(group) = a["to"].as_str().map(str::trim).filter(|t| t.starts_with('@')).map(str::to_string) else {
            return self.send(from, &a, dispatches, &live, now);
        };
        let kind = a["type"].as_str().map(str::trim).unwrap_or("status");
        if kind == "worker_done" || kind == "heartbeat" {
            return Err(args("done reports and heartbeats never go to a group; send them to run:<id>"));
        }
        if kind == "question" {
            return Err(args(format!("a question goes to exactly one recipient, not to the group {group}")));
        }
        let name = group[1..].to_ascii_lowercase();
        let agents = peers.iter().filter(|p| p.handle != from && p.agent.is_some());
        let to: Vec<&Peer> = match name.as_str() {
            "all" => agents.collect(),
            "idle" => agents.filter(|p| p.idle).collect(),
            "claude" | "codex" | "cursor" | "droid" => agents.filter(|p| p.agent.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(&name))).collect(),
            w if w.starts_with("worktree:") && w.len() > 9 => {
                // A worktree id is "<project id>::<path>"; the bare path is taken too.
                let id = &group[10..];
                let path = id.rsplit_once("::").map_or(id, |(_, p)| p);
                agents.filter(|p| same_path(&p.dir, path)).collect()
            }
            _ => return Err(args(format!("Kolux knows no group {group}; use @all, @idle, @worktree:<id>, @claude, @codex, @cursor or @droid"))),
        };
        if to.is_empty() {
            return Err(Fail::new("not_found", format!("{group} matches no agent terminal right now")));
        }
        let thread = a["threadId"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| self.next("thread"));
        a["threadId"] = json!(thread);
        let keep = self.messages.len();
        let mut made = Vec::new();
        for p in to {
            a["to"] = json!(p.handle);
            match self.send(from, &a, dispatches, &live, now) {
                Ok(r) => made.push(json!({ "id": r["messageIds"][0], "to": r["to"] })),
                Err(e) => {
                    self.messages.truncate(keep);
                    return Err(e);
                }
            }
        }
        let ids: Vec<Value> = made.iter().map(|m| m["id"].clone()).collect();
        Ok(json!({ "messageIds": ids, "messages": made, "threadId": thread, "to": group }))
    }

    fn acked(&self) -> std::collections::HashSet<String> {
        self.deliveries.iter().filter(|d| d.acked).flat_map(|d| d.messages.iter().cloned()).collect()
    }

    fn view(m: &Message) -> Value {
        let mut v = json!({ "id": m.id, "from": m.from, "to": m.to, "runId": m.run, "subject": m.subject, "body": m.body, "type": m.kind, "priority": m.priority, "at": m.at });
        if let Some(o) = v.as_object_mut() {
            o.extend(m.extras.clone());
        }
        // ORCH-006: every delivered message carries the command that answers it.
        v["reply"] = json!(format!("{CLI} orchestration reply --id {} --body \"<your answer>\"", m.id));
        v
    }

    /// ORCH-005: the oldest batch not yet acknowledged, the same batch again until its delivery id
    /// is acknowledged; peek, unread and all only look.
    #[allow(clippy::too_many_arguments)]
    pub fn check(&mut self, pane: &str, reader: &str, boxes: &[String], mode: Mode, types: Option<&[String]>, ack: Option<&str>, fence: Option<u64>) -> Result<Value, Fail> {
        if fence.is_some_and(|e| e != self.epoch(pane)) {
            return Err(Fail::new("fenced", "this terminal was tied to another Run while the check waited; check again"));
        }
        if let Some(id) = ack {
            let d = self.deliveries.iter_mut().find(|d| d.id == id && d.reader == reader).ok_or_else(|| Fail::new("not_found", format!("no delivery {id} for {reader}")))?;
            d.acked = true;
        }
        let wanted = |m: &Message| boxes.contains(&m.to) && types.is_none_or(|t| t.contains(&m.kind));
        let acked = self.acked();
        let taken: std::collections::HashSet<&String> = self.deliveries.iter().flat_map(|d| d.messages.iter()).collect();
        let open = self.deliveries.iter().find(|d| !d.acked && d.reader == reader && d.messages.iter().all(|id| self.messages.iter().any(|m| &m.id == id && wanted(m))));
        let fresh: Vec<&Message> = self.messages.iter().filter(|m| wanted(m) && !taken.contains(&m.id)).collect();
        let pick = |ids: &[String]| -> Vec<Value> { self.messages.iter().filter(|m| ids.contains(&m.id)).map(Self::view).collect() };
        let (delivery, shown): (Option<String>, Vec<Value>) = match mode {
            Mode::Peek => {
                let mut v = open.map(|d| pick(&d.messages)).unwrap_or_default();
                v.extend(fresh.iter().map(|m| Self::view(m)));
                (None, v)
            }
            Mode::Unread => (None, self.messages.iter().filter(|m| wanted(m) && !acked.contains(&m.id)).map(Self::view).collect()),
            Mode::All => (None, self.messages.iter().filter(|m| wanted(m)).map(Self::view).collect()),
            Mode::Next => match open {
                Some(d) => (Some(d.id.clone()), pick(&d.messages)),
                None if fresh.is_empty() => (None, Vec::new()),
                None => {
                    let ids: Vec<String> = fresh.iter().map(|m| m.id.clone()).collect();
                    let shown = pick(&ids);
                    let id = self.next("dlv");
                    self.deliveries.push(Delivery { id: id.clone(), reader: reader.to_string(), messages: ids, acked: false });
                    (Some(id), shown)
                }
            },
        };
        let mode = format!("{mode:?}").to_lowercase();
        Ok(json!({ "deliveryId": delivery, "messages": shown, "terminal": reader, "mailboxes": boxes, "mode": mode, "epoch": self.epoch(pane), "acknowledged": ack }))
    }
}

/// ORCH-006: bodies longer than this are cut in `inbox` unless `--full` is given.
const SHORT_BODY: usize = 120;
/// ORCH-010: a task text bigger than this is turned away before anything is touched.
pub const SPEC_MAX: usize = 4 * 1024 * 1024;
/// ORCH-011: the compact form cuts each task text here.
const BRIEF_CHARS: usize = 160;
pub const TASK_STATES: &[&str] = &["pending", "ready", "dispatched", "completed", "failed", "blocked"];

/// `s` cut to at most `n` characters, an ellipsis marking the cut.
fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}\u{2026}", s.chars().take(n - 1).collect::<String>())
    }
}

impl Mail {
    /// ORCH-006: the answer goes to whoever sent `id`, on the thread of the message it answers.
    /// ORCH-033: only a message the caller could read (in its mailboxes, its Run, or its own) can be
    /// answered; any other reads as missing.
    #[allow(clippy::too_many_arguments)]
    pub fn reply(&mut self, from: &str, id: &str, body: &str, run: Option<&str>, boxes: &[String], mine: Option<&str>, now: u64) -> Result<Value, Fail> {
        let seen = |m: &Message| boxes.contains(&m.to) || m.from == from || (m.run.is_some() && m.run.as_deref() == mine);
        let m = self.messages.iter().find(|m| m.id == id && seen(m)).cloned().ok_or_else(|| Fail::new("not_found", format!("no message {id}")))?;
        if let Some(n) = run.filter(|n| m.run.as_deref() != Some(*n)) {
            return Err(Fail::new("run_mismatch", format!("{id} does not belong to the Run named with --run ({n})")));
        }
        let thread = m.extras.get("threadId").and_then(Value::as_str).unwrap_or(&m.id).to_string();
        let to = format!("term:{}", m.from);
        let subject = if m.subject.starts_with("Re: ") { m.subject.clone() } else { format!("Re: {}", m.subject) };
        let mut extras = Map::new();
        extras.insert("threadId".into(), json!(thread));
        extras.insert("inReplyTo".into(), json!(m.id));
        let new = self.next("msg");
        self.messages.push(Message { id: new.clone(), to: to.clone(), run: m.run.clone(), from: from.to_string(), subject, body: body.to_string(), kind: "status".into(), priority: "normal".into(), extras, at: now });
        Ok(json!({ "messageIds": [new], "to": to, "runId": m.run, "threadId": thread }))
    }

    /// ORCH-028: a gate on a task of Run `run`, which turns the task blocked. Choices are a JSON
    /// list of strings; a task with a supervised worker still at work, or one that has finished,
    /// cannot be held, and then nothing is made.
    pub fn gate_create(&mut self, run: Option<&str>, tasks: &mut [Value], dispatches: &[Value], a: &Value, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let task = text("task").ok_or_else(|| args("--task is required"))?;
        let question = text("question").ok_or_else(|| args("--question is required: say what needs deciding"))?;
        let options = match text("options") {
            Some(o) => parse_deps(&o).ok_or_else(|| args("--options takes a JSON list of strings, like [\"yes\",\"no\"]"))?,
            None => Vec::new(),
        };
        // CLI-037: a gate is the coordinator's, so it needs the Run this terminal is attached to.
        if run.is_none() {
            return Err(Fail::new("no_run", "no Run is attached to this terminal, so there is no coordinator to hold the gate: attach one with orchestration run-create --objective <text> or run-use --id <run>, or name it with --run"));
        }
        let i = task_in(tasks, &task, run)?;
        if let Some(d) = dispatches.iter().find(|d| d["taskId"] == task.as_str() && !finished(d)) {
            let id = d["id"].as_str().unwrap_or_default();
            return Err(Fail::new("worker_active", format!("{task} has a supervised worker at work ({id}); a gate cannot hold it until that worker finishes or is abandoned")));
        }
        let was = status(&tasks[i]).to_string();
        if !["pending", "ready", "blocked"].contains(&was.as_str()) {
            return Err(Fail::new("invalid_state", format!("{task} is {was}; only a pending or ready task can be held by a gate")));
        }
        tasks[i]["status"] = json!("blocked");
        let g = Gate { id: self.next("gate"), run: run.map(str::to_string), task, question, options, status: "pending".into(), resolution: None, created: now, resolved: None };
        let mut v = json!(g);
        v["taskStatus"] = json!("blocked");
        self.gates.push(g);
        Ok(v)
    }

    /// ORCH-028: settles an open gate of Run `run`; a gate of another Run reads as missing. Once no
    /// open gate holds the task any more it goes back to pending, and so on to ready when nothing
    /// else holds it.
    pub fn gate_resolve(&mut self, run: Option<&str>, tasks: &mut [Value], a: &Value, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let id = text("id").ok_or_else(|| args("--id is required"))?;
        let resolution = text("resolution").ok_or_else(|| args("--resolution is required: say what was decided"))?;
        let g = self.gates.iter_mut().find(|g| g.id == id && g.run.as_deref() == run).ok_or_else(|| Fail::new("not_found", format!("no gate {id}")))?;
        if g.status != "pending" {
            return Err(Fail::new("gate_closed", format!("{id} is already {}", g.status)));
        }
        g.status = "resolved".into();
        g.resolution = Some(resolution);
        g.resolved = Some(now);
        let mut v = json!(g);
        let task = g.task.clone();
        if !self.gates.iter().any(|g| g.task == task && g.run.as_deref() == run && g.status == "pending") {
            if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["runId"].as_str() == run && status(t) == "blocked") {
                t["status"] = json!("pending");
            }
            promote(tasks);
        }
        v["taskStatus"] = tasks.iter().find(|t| t["id"] == task.as_str() && t["runId"].as_str() == run).map(|t| t["status"].clone()).unwrap_or(Value::Null);
        Ok(v)
    }

    /// ORCH-028: the gates of Run `run`, oldest first, narrowed by task and state.
    // ponytail: no gate times out yet (gate-create takes no deadline), so "timeout" lists nothing
    // until one does.
    pub fn gate_list(&self, run: Option<&str>, a: &Value) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
        let want = text("status");
        if want.is_some_and(|s| !["pending", "resolved", "timeout"].contains(&s)) {
            return Err(args("--status takes pending, resolved or timeout"));
        }
        let gates: Vec<Value> = self.gates.iter().filter(|g| g.run.as_deref() == run && want.is_none_or(|s| g.status == s) && text("task").is_none_or(|t| g.task == t)).map(|g| json!(g)).collect();
        Ok(json!({ "runId": run, "gates": gates }))
    }

    /// ORCH-029: a question to one recipient (by default the caller's Run), or, with `resume`, the
    /// state of one this terminal already asked: still open, or answered by the first reply to it.
    /// A group address is refused and nothing is made.
    pub fn ask(&mut self, from: &str, a: &Value, dispatches: &[Value], peers: &[Peer], now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let id = match (text("question"), text("resume")) {
            (Some(_), Some(_)) => return Err(args("give --question or --resume, not both")),
            (None, None) => return Err(args("--question is required (or --resume <message> to wait on one already asked)")),
            (Some(q), None) => {
                // ORCH-067: a worker with a pass asks only with it; a wrong or missing pass makes no question.
                if let Some(why) = dispatches.iter().rev().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(from) && d["pass"].is_string()).and_then(|d| pass_refusal(d, a)) {
                    return Err(Fail::new("forbidden", format!("{why}, so no question was made")));
                }
                let options: Vec<String> = text("options").map(|o| o.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default();
                let to = text("to").or_else(|| self.run_of(from, dispatches).map(|r| format!("run:{r}")));
                let mut q = json!({ "to": to, "run": a["run"], "subject": q, "type": "question" });
                if !options.is_empty() {
                    q["payload"] = json!(json!({ "options": options }).to_string());
                }
                let r = self.post(from, &q, dispatches, peers, now)?;
                return Ok(json!({ "status": "open", "messageId": r["messageIds"][0], "to": r["to"], "runId": r["runId"], "options": options }));
            }
            (None, Some(id)) if text("options").is_some() => return Err(args(format!("--options goes with --question; {id} keeps the choices it was asked with"))),
            (None, Some(id)) => id,
        };
        let q = self.messages.iter().find(|m| m.id == id && m.from == from && m.kind == "question").ok_or_else(|| Fail::new("not_found", format!("no question {id} was asked from this terminal")))?;
        Ok(match self.messages.iter().find(|m| m.extras.get("inReplyTo").and_then(Value::as_str) == Some(id.as_str())) {
            Some(r) => json!({ "status": "answered", "messageId": id, "answer": r.body, "answeredBy": r.from, "answerId": r.id }),
            None => json!({ "status": "open", "messageId": id, "to": q.to, "runId": q.run }),
        })
    }

    /// ORCH-031: clears one scope. "tasks" drops the gates (the caller drops tasks and workers),
    /// "messages" the mail but not the delivery positions, so nothing is handed out again; "all"
    /// everything. Ids keep counting up, so nothing cleared is ever named again.
    pub fn reset(&mut self, scope: &str) -> Result<(), Fail> {
        match scope {
            "tasks" => self.gates.clear(),
            "messages" => self.messages.clear(),
            "all" => *self = Mail { seq: self.seq, unread: self.unread, ..Mail::default() },
            _ => return Err(args("give exactly one of --all, --tasks or --messages")),
        }
        Ok(())
    }

    /// ORCH-006: the newest mail in `boxes`, newest first, bodies cut unless `full`; it only reads.
    pub fn inbox(&self, reader: &str, boxes: &[String], limit: usize, full: bool) -> Value {
        let shown: Vec<Value> = self
            .messages
            .iter()
            .rev()
            .filter(|m| boxes.contains(&m.to))
            .take(limit)
            .map(|m| {
                let mut v = Self::view(m);
                if !full {
                    v["body"] = json!(cut(&m.body, SHORT_BODY));
                }
                v
            })
            .collect();
        json!({ "terminal": reader, "mailboxes": boxes, "messages": shown, "full": full })
    }
}

// ---------------------------------------------------------------- tasks (ORCH-010, ORCH-011, ORCH-013)

fn status(t: &Value) -> &str {
    t["status"].as_str().unwrap_or_default()
}

/// ORCH-010: every pending task whose dependencies have all completed turns ready.
pub fn promote(tasks: &mut [Value]) {
    let done: std::collections::HashSet<String> = tasks.iter().filter(|t| status(t) == "completed").filter_map(|t| t["id"].as_str().map(str::to_string)).collect();
    for t in tasks.iter_mut() {
        let free = t["deps"].as_array().into_iter().flatten().all(|d| d.as_str().is_some_and(|d| done.contains(d)));
        if status(t) == "pending" && free {
            t["status"] = json!("ready");
        }
    }
}

/// ORCH-010: a new task in `run`; ready at once unless it waits on unfinished tasks. Bad or
/// unknown dependencies, an unknown parent and an oversized text are refused with nothing made.
/// A list of task ids, as JSON or as PowerShell leaves it with the quotes stripped (`[a, b]`).
pub fn parse_deps(s: &str) -> Option<Vec<String>> {
    if let Ok(v) = serde_json::from_str::<Vec<String>>(s) {
        return Some(v);
    }
    let inner = s.trim().strip_prefix('[')?.strip_suffix(']')?;
    Some(inner.split(',').map(|d| d.trim().trim_matches('"').to_string()).filter(|d| !d.is_empty()).collect())
}


pub fn task_create(tasks: &mut Vec<Value>, a: &Value, run: Option<String>, now: u64) -> Result<Value, Fail> {
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let spec = a["spec"].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| args("--spec is required"))?;
    if spec.len() > SPEC_MAX {
        return Err(Fail::new("too_large", format!("the task text is {} bytes; Kolux stores at most {SPEC_MAX}", spec.len())));
    }
    let deps: Vec<String> = match text("deps") {
        None => Vec::new(),
        Some(d) => parse_deps(&d).ok_or_else(|| args("--deps takes a JSON list of task ids, like [\"task-1\"]"))?,
    };
    let known = |id: &str| tasks.iter().any(|t| t["id"] == id);
    if let Some(bad) = deps.iter().find(|d| !known(d)) {
        return Err(Fail::new("not_found", format!("no task {bad} to wait on")));
    }
    if let Some(p) = text("parent").filter(|p| !known(p)) {
        return Err(Fail::new("not_found", format!("no parent task {p}")));
    }
    let id = crate::cli::next_id(tasks, "task-");
    tasks.push(json!({ "id": id, "runId": run, "title": text("taskTitle"), "displayName": text("displayName"), "spec": spec, "status": "pending", "deps": deps, "parent": text("parent"), "created": now }));
    promote(tasks);
    Ok(tasks.last().cloned().unwrap_or_default())
}

/// ORCH-011: the tasks of `run` (or of no Run), filtered, with the worker holding each one while
/// that worker's terminal is still open.
/// ORCH-035 (T-279-c): a ready task whose breaker is open lists as `held` (its stored status stays
/// ready), with its failure count, and `--ready` / `--status ready` leave it out, so a coordinator
/// choosing work never picks it; `--status held` lists only those. `breaker_reset` hands it back.
pub fn task_list(tasks: &[Value], dispatches: &[Value], run: Option<&str>, a: &Value, live: &dyn Fn(&str) -> bool) -> Result<Value, Fail> {
    let want = a["status"].as_str();
    if want.is_some_and(|s| s != HELD && !TASK_STATES.contains(&s)) {
        return Err(args(format!("--status takes one of {}, {HELD}", TASK_STATES.join(", "))));
    }
    let (ready, brief) = (a["ready"] == true, a["brief"] == true);
    let failures = |t: &Value| failed_dispatches(dispatches, t["id"].as_str().unwrap_or_default(), t["runId"].as_str());
    let shown = |t: &Value| -> String { if status(t) == "ready" && failures(t) >= BREAKER_TRIPS { HELD.into() } else { status(t).into() } };
    let rows: Vec<Value> = tasks
        .iter()
        .filter(|t| t["runId"].as_str() == run && want.is_none_or(|s| shown(t) == s) && (!ready || shown(t) == "ready"))
        .map(|t| {
            let n = failures(t);
            let spec = t["spec"].as_str().unwrap_or_default();
            let folded = spec.split_whitespace().collect::<Vec<_>>().join(" ");
            let name = t["displayName"].as_str().or(t["title"].as_str()).map(str::to_string).unwrap_or_else(|| cut(&folded, 60));
            let holder = dispatches.iter().rev().find(|d| d["taskId"] == t["id"] && !finished(d) && terminal_of(d).is_some_and(|h| live(&h)));
            json!({
                "id": t["id"], "name": name, "title": t["title"], "status": shown(t), "deps": t["deps"], "parent": t["parent"], "runId": t["runId"],
                "failures": n, "held": (shown(t) == HELD).then(|| held_label(n)),
                "spec": if brief { cut(&folded, BRIEF_CHARS) } else { spec.to_string() },
                "worker": holder.map(|d| json!({ "dispatchId": d["id"], "terminal": terminal_of(d) })),
            })
        })
        .collect();
    Ok(json!({ "runId": run, "tasks": rows, "brief": brief }))
}

/// ORCH-035: failed dispatches of one task after which it is no longer handed out.
pub const BREAKER_TRIPS: usize = 3;
/// ORCH-035 (T-279-c): how a task list shows a ready task whose breaker is open.
pub const HELD: &str = "held";
/// Where the CLI keeps tasks and dispatches in the profile store (the same keys cli.rs reads).
pub const TASKS_KEY: &str = "orchestration.tasks";
pub const DISPATCHES_KEY: &str = "orchestration.dispatches";

/// "held (3 failures)": the mark a held task carries in a task list.
pub fn held_label(failures: usize) -> String {
    format!("{HELD} ({failures} failure{})", if failures == 1 { "" } else { "s" })
}

/// ORCH-035: how many dispatches of `task` in `run` ended failed since its breaker was last reset.
// ponytail: a success does not reset the count (the card resets nothing); only a reset does
// (breaker_reset), and the failed records stay, stamped, so the history is kept.
pub fn failed_dispatches(dispatches: &[Value], task: &str, run: Option<&str>) -> usize {
    dispatches.iter().filter(|d| d["taskId"] == task && d["runId"].as_str() == run && d["status"] == "failed" && d["breakerReset"].is_null()).count()
}

/// ORCH-035 (T-279-c): closes the breaker of `task` in `run`: its failed dispatches are stamped
/// with the time of the reset so they no longer count, and a ready task lists as ready again.
/// Resetting a task with no counted failures changes nothing (a retried reset is harmless).
pub fn breaker_reset(tasks: &[Value], dispatches: &mut [Value], task: &str, run: Option<&str>, now: u64) -> Result<Value, Fail> {
    let i = task_in(tasks, task, run)?;
    let mut cleared = 0;
    for d in dispatches.iter_mut().filter(|d| d["taskId"] == task && d["runId"].as_str() == run && d["status"] == "failed" && d["breakerReset"].is_null()) {
        d["breakerReset"] = json!(now);
        cleared += 1;
    }
    Ok(json!({ "id": task, "runId": run, "status": tasks[i]["status"], "failures": 0, "cleared": cleared }))
}

/// ORCH-013: may `task` go to the agent in terminal `to`? Gives the task index and the agent.
/// ORCH-035: a task whose dispatches failed `BREAKER_TRIPS` times is turned away (breaker_open),
/// and so is a terminal that already holds an unfinished dispatch (busy).
/// The codes and messages are fixed so scripts can match on them.
/// The task is looked up in `run` only (ORCH-033). A context-only dispatch to the caller's own pane
/// is allowed when `own_ok`: the caller still has nesting budget (ORCH-032).
#[allow(clippy::too_many_arguments)]
pub fn dispatch_check(tasks: &[Value], dispatches: &[Value], task: &str, to: &str, caller: Option<&str>, run: Option<&str>, own_ok: bool, agent_of: &dyn Fn(&str) -> Option<String>) -> Result<(usize, String), Fail> {
    let i = task_in(tasks, task, run)?;
    match status(&tasks[i]) {
        "ready" => {}
        "pending" => return Err(Fail::new("task_waiting", format!("{task} is still waiting on its dependencies"))),
        "dispatched" => return Err(Fail::new("task_taken", format!("{task} already has a worker ({})", tasks[i]["dispatchId"].as_str().unwrap_or("?")))),
        s => return Err(Fail::new("task_not_ready", format!("{task} is {s}, not ready"))),
    }
    let failures = failed_dispatches(dispatches, task, run);
    if failures >= BREAKER_TRIPS {
        return Err(Fail::new("breaker_open", format!("{task} failed {failures} times, so Kolux holds it back instead of handing it out again")));
    }
    if caller == Some(to) && !own_ok {
        return Err(Fail::new("own_pane", "a coordinator cannot hand a task to its own pane"));
    }
    let agent = agent_of(to).ok_or_else(|| Fail::new("not_an_agent", format!("{to} is not running an agent Kolux recognises, or the agent has not finished starting")))?;
    if let Some(d) = dispatches.iter().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(to)) {
        return Err(Fail::new("busy", format!("{to} is already working on {}", d["id"].as_str().unwrap_or("?"))));
    }
    Ok((i, agent))
}

/// The command name a brief tells workers to run (ORCH-014).
// ponytail: WSL workers, who need the exact path instead, do not exist yet (SESS-048 is not in
// the plan); the name is the plain one until they do.
pub const CLI: &str = if cfg!(debug_assertions) { "kolux-dev" } else { "kolux" };
/// Everything after this line in a brief is the task text.
pub const DIVIDER: &str = "---------------- task ----------------";

/// What a worker's brief is tied to (ORCH-014).
pub struct Brief<'a> {
    pub dispatch: &'a str,
    pub run: Option<&'a str>,
    /// Where reports go when there is no Run: the coordinator's pane.
    pub coordinator: Option<&'a str>,
    /// Commits the worktree is behind its base, and the base's name.
    pub behind: Option<(u32, String)>,
    /// ORCH-032: how many more levels of workers this worker may start (0: none).
    pub levels_left: u32,
}

/// ORCH-014: the text a worker gets: how to report done, beat, ask and look for mail, each a
/// one-line command that runs in any shell, then the task text last. The commands need no
/// `--from`: run in the worker's pane, its KOLUX_TERMINAL_HANDLE ties them to that pane.
// ponytail: questions go out as mail plus `check --wait` until the ask command lands (ORCH-029,
// T-190); the dispatch pass joins these commands with ORCH-067 (T-155-b). Every worker
// is an agent: dispatch turns shells away and a reused terminal must run the coordinator's own
// agent (ORCH-016), so the bare-shell "exit after reporting" line has no worker to go to.
pub fn brief(task: &Value, b: &Brief) -> String {
    brief_tied(task, b, None)
}

/// ORCH-067 (T-155-b): the brief with the worker's dispatch pass inside its ready-made done, failed,
/// heartbeat and question commands (`--dispatch-capability`, the option name COMPAT keeps), never as
/// a field of its own. worker-start gives every dispatch a fresh pass (`cli::secret`); the low-level
/// dispatch command gives none, so its workers are tied to the pane's process instead.
pub fn brief_tied(task: &Value, b: &Brief, pass: Option<&str>) -> String {
    let id = task["id"].as_str().unwrap_or_default();
    let to = b.run.map(|r| format!(" --to run:{r}")).or_else(|| b.coordinator.map(|c| format!(" --to {c}"))).unwrap_or_default();
    let pass = pass.map(|p| format!(" {PASS_OPTION} {p}")).unwrap_or_default();
    let tie = format!("{to} --task-id {id} --dispatch-id {}{pass}", b.dispatch);
    let send = |kind: &str, subject: &str, body: &str| format!("  {CLI} orchestration send --type {kind} --subject \"{id} {subject}\" --body \"{body}\"{tie}\n");
    let run = b.run.map(|r| format!(", Run {r}")).unwrap_or_default();
    let mut s = format!("Kolux task {id} ({}{run}). You are a Kolux worker; a coordinator handed you this task.\n\n", b.dispatch);
    s += "When you finish, report it with one of these, then stop and wait at your prompt:\n";
    s += &send("worker_done --outcome succeeded", "done", "what you did");
    s += &send("worker_done --outcome failed", "failed", "what went wrong");
    s += "About every five minutes while you work, send a heartbeat:\n";
    s += &send("heartbeat", "working", "what you are doing now");
    s += "To ask the coordinator something, use Kolux, not your own question tool, then wait for the answer:\n";
    s += &send("question", "question", "your question");
    s += &format!("  {CLI} orchestration check --wait\n");
    s += &format!("Look for new mail between steps, at least every few minutes:\n  {CLI} orchestration check\n");
    if b.levels_left > 0 {
        let more = if b.levels_left == 1 { "one more level".to_string() } else { format!("{} more levels", b.levels_left) };
        s += &format!("\nYou may hand a separate part of this task to a sub-worker ({more} allowed below you); it reports to you:\n  {CLI} orchestration worker-start --spec \"<that part>\" --tier build --worktree new-child\n");
    }
    if let Some((n, base)) = b.behind.as_ref().filter(|(n, _)| *n > 0) {
        let commits = if *n == 1 { "commit" } else { "commits" };
        s += &format!("\nBase drift: this worktree is {n} {commits} behind {base}. Bring {base} in before you build on it, or say in your report why you did not.\n");
    }
    format!("{s}\n{DIVIDER}\n{}", task["spec"].as_str().unwrap_or_default())
}

/// ORCH-018: the agent a tier runs on: the coordinator's own when Kolux knows it, else the one
/// named, else the default. Naming another agent than the coordinator's is turned away.
pub fn tier_agent(named: Option<&str>, coordinator: Option<&str>, default: &str) -> Result<String, Fail> {
    match (named, coordinator) {
        (Some(n), Some(c)) if n != c => Err(args(format!("a tier runs on the coordinator's own agent ({c}); drop --agent {n}, or name a model instead of a tier"))),
        (Some(n), _) => Ok(n.to_string()),
        (None, Some(c)) => Ok(c.to_string()),
        (None, None) => Ok(default.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(h: &str) -> bool {
        h.starts_with("term-")
    }

    fn ids(v: &Value) -> Vec<String> {
        v["messages"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap().to_string()).collect()
    }

    /// ORCH-034: the store (state.db and the companion files SQLite adds beside it) opens to the
    /// current user alone, the way the app folder is set at every launch.
    #[cfg(windows)]
    #[test]
    fn the_orchestration_store_opens_to_the_current_user_only() {
        let dir = std::env::temp_dir().join(format!("kolux-orch-private-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = crate::state::Store::open(&dir).unwrap();
        crate::secrets::restrict_to_user(&dir, &dir);
        let mut m = Mail::default();
        m.begin("orchestration.worker-start||r1", 1).unwrap();
        m.save(&store).unwrap();
        let user = std::env::var("USERNAME").unwrap().to_lowercase();
        let files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.to_string_lossy().contains("state.db")).collect();
        assert!(!files.is_empty());
        for path in std::iter::once(dir.clone()).chain(files) {
            let out = std::process::Command::new("icacls").arg(&path).output().unwrap();
            let text = String::from_utf8_lossy(&out.stdout).replace(&path.to_string_lossy().to_string(), "").to_lowercase();
            let aces: Vec<&str> = text.lines().map(str::trim).filter(|l| l.contains(":(")).collect();
            // A Windows runner's Administrators group is part of the signed-in user's effective
            // access; the test's point is that other, non-admin users cannot open the store. The
            // owner's PC has only the user's own ACE, which still passes.
            assert!(
                !aces.is_empty() && aces.iter().all(|a| a.contains(&format!("\\{user}:")) || a.contains("\\administrators:")),
                "{} is open to more than {user} and Administrators: {aces:?}",
                path.display()
            );
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pane_is_tied_only_when_the_runtime_knows_it() {
        let by_key = |k: &str| (k == "s3cret").then(|| "term-1".to_string());
        assert_eq!(caller_of(None, Some(("term-1", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        // CLI-034: a stale handle is worked out again from the pane key.
        assert_eq!(caller_of(None, Some(("term-5", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        assert_eq!(caller_of(None, Some(("term-1", "guess")), &by_key).unwrap(), None);
        assert_eq!(caller_of(None, None, &by_key).unwrap(), None);
        // CLI-039: --from may name the calling terminal itself, never another one, and never
        // from a shell whose identity cannot be proven.
        assert_eq!(caller_of(Some("term-1"), Some(("term-1", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        let other = caller_of(Some("term-4"), Some(("term-1", "s3cret")), &by_key).unwrap_err();
        assert_eq!(other.code, "caller_mismatch");
        assert!(other.message.contains("term-1") && other.message.contains("term-4"), "{}", other.message);
        assert_eq!(caller_of(Some("term-4"), None, &by_key).unwrap_err().code, "unbound_caller");
        assert_eq!(caller_of(Some("term-1"), Some(("term-1", "guess")), &by_key).unwrap_err().code, "unbound_caller");
    }

    #[test]
    fn a_run_binds_its_pane_and_a_retry_hands_back_the_first_answer() {
        let mut m = Mail::default();
        let first = m.once(Some("k1".into()), |m| Ok(m.run_create("term-1", "ship it", 5))).unwrap();
        let again = m.once(Some("k1".into()), |m| Ok(m.run_create("term-1", "ship it", 6))).unwrap();
        assert_eq!(first, again);
        assert_eq!(m.runs.len(), 1);
        let id = first["run"]["id"].as_str().unwrap();
        assert_eq!(m.run_current("term-1")["runId"], id);
        assert_eq!(m.run_current("term-2")["runId"], Value::Null);
        assert_eq!(first["binding"]["terminal"], "term-1");
    }

    #[test]
    fn receipts_answer_retries_say_how_a_request_went_and_expire() {
        let mut m = Mail::default();
        let key = |c: &str, id: &str| Some(format!("{c}|term-1|{id}"));
        let first = m.once(key("orchestration.run-create", "r1"), |m| Ok(m.run_create("term-1", "ship it", 5))).unwrap();
        let shown = m.request_show("term-1", "r1", 7);
        assert_eq!((shown["state"].as_str(), shown["command"].as_str()), (Some("completed"), Some("orchestration.run-create")));
        assert_eq!(shown["result"], first);
        assert_eq!(m.request_show("term-1", "nope", 7)["state"], "absent");
        assert_eq!(m.request_show("term-2", "r1", 7)["state"], "absent", "another terminal's request is not this one's");

        // Turned away before it took effect: no receipt, so the same id runs fresh.
        assert!(m.once(key("orchestration.send", "r2"), |_| Err(args("no such task"))).is_err());
        assert_eq!(m.request_show("term-1", "r2", 7)["state"], "absent");
        assert!(m.once(key("orchestration.send", "r2"), |_| Ok(json!({ "ok": true }))).is_ok());

        // A long request is pending until it finishes; one left by an earlier start says so.
        let w = key("orchestration.worker-start", "w1").unwrap();
        m.begin(&w, 7).unwrap();
        assert_eq!(m.request_show("term-1", "w1", 7)["state"], "pending");
        assert_eq!(m.request_show("term-1", "w1", 8)["interrupted"], true);
        m.finish(&w, Some(json!({ "dispatchId": "dispatch-1" })));
        assert_eq!(m.request_show("term-1", "w1", 7)["result"]["dispatchId"], "dispatch-1");

        // A full ledger of unfinished requests turns new changes away rather than losing track.
        for n in 0..MAX_PENDING {
            m.begin(&format!("orchestration.worker-start|term-1|p{n}"), 7).unwrap();
        }
        assert_eq!(m.once(key("orchestration.send", "r3"), |_| Ok(json!({}))).unwrap_err().code, "busy");
        assert_eq!(m.begin("orchestration.worker-start|term-1|one-more", 7).unwrap_err().code, "busy");
        assert_eq!(m.request_show("term-1", "r3", 7)["state"], "absent");
        for n in 0..MAX_PENDING {
            m.finish(&format!("orchestration.worker-start|term-1|p{n}"), None);
        }

        // Old finished receipts are pruned when the next one is written.
        m.stamps.insert(key("orchestration.run-create", "r1").unwrap(), 1);
        m.once(key("orchestration.send", "r4"), |_| Ok(json!({}))).unwrap();
        assert_eq!(m.request_show("term-1", "r1", 7)["state"], "absent");
        assert_eq!(m.request_show("term-1", "r4", 7)["state"], "completed");
    }

    #[test]
    fn runs_switch_page_newest_first_and_show() {
        let mut m = Mail::default();
        let a = m.run_create("term-1", "one", 1)["run"]["id"].as_str().unwrap().to_string();
        let b = m.run_create("term-1", "two", 2)["run"]["id"].as_str().unwrap().to_string();
        assert_eq!(m.bound("term-1"), Some(b.as_str()));
        m.run_use("term-1", &a).unwrap();
        assert_eq!(m.run_current("term-1")["runId"], a);
        assert_eq!(m.run_use("term-1", "run-99").unwrap_err().code, "not_found");
        let page = m.run_list(1, None).unwrap();
        assert_eq!(page["runs"][0]["id"], b);
        let next = m.run_list(1, page["nextCursor"].as_str()).unwrap();
        assert_eq!(next["runs"][0]["id"], a);
        assert_eq!(next["nextCursor"], Value::Null);
        assert!(m.run_list(1, Some("x")).is_err());
        assert_eq!(m.run_show(&a).unwrap()["objective"], "one");
    }

    #[test]
    fn check_repeats_the_oldest_batch_until_it_is_acknowledged() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let to = format!("run:{run}");
        let s1 = m.send("term-2", &json!({ "to": to, "subject": "first" }), &[], &live, 2).unwrap();
        m.send("term-2", &json!({ "to": to, "subject": "second", "priority": "urgent" }), &[], &live, 3).unwrap();
        assert_eq!(s1["messageIds"].as_array().unwrap().len(), 1);
        let boxes = m.boxes_of("term-1", &[]);
        let peek = m.check("term-1", "term-1", &boxes, Mode::Peek, None, None, None).unwrap();
        assert_eq!(peek["deliveryId"], Value::Null);
        assert_eq!(ids(&peek).len(), 2);
        assert!(m.deliveries.is_empty());
        let one = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(ids(&one).len(), 2);
        assert_eq!(one["messages"][0]["subject"], "first");
        let two = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(one["deliveryId"], two["deliveryId"]);
        assert_eq!(ids(&one), ids(&two));
        m.send("term-2", &json!({ "to": to, "subject": "third", "type": "question" }), &[], &live, 4).unwrap();
        let d = one["deliveryId"].as_str().unwrap().to_string();
        let after = m.check("term-1", "term-1", &boxes, Mode::Next, Some(&["status".to_string()]), Some(&d), None).unwrap();
        assert!(ids(&after).is_empty());
        assert_eq!(ids(&m.check("term-1", "term-1", &boxes, Mode::Unread, None, None, None).unwrap()).len(), 1);
        assert_eq!(ids(&m.check("term-1", "term-1", &boxes, Mode::All, None, None, None).unwrap()).len(), 3);
        assert_eq!(m.check("term-1", "term-1", &boxes, Mode::Next, None, Some("dlv-99"), None).unwrap_err().code, "not_found");
    }

    #[test]
    fn a_waiter_is_fenced_when_its_pane_is_tied_elsewhere() {
        let mut m = Mail::default();
        let before = m.epoch("term-1");
        m.run_create("term-1", "o", 1);
        let boxes = m.boxes_of("term-1", &[]);
        assert_eq!(m.check("term-1", "term-1", &boxes, Mode::Next, None, None, Some(before)).unwrap_err().code, "fenced");
        let now = m.epoch("term-1");
        assert!(m.check("term-1", "term-1", &boxes, Mode::Next, None, None, Some(now)).is_ok());
    }

    #[test]
    fn send_refuses_what_it_cannot_route() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let refused = |m: &mut Mail, a: Value| m.send("term-2", &a, &[], &live, 2).unwrap_err();
        assert!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "done", "type": "worker_done" })).message.contains("--outcome"));
        assert!(refused(&mut m, json!({ "to": "@all", "subject": "beat", "type": "heartbeat" })).message.contains("group"));
        assert_eq!(refused(&mut m, json!({ "to": "run:run-9", "subject": "hi" })).code, "not_found");
        assert_eq!(refused(&mut m, json!({ "subject": "hi" })).code, "invalid_arguments");
        assert_eq!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "hi", "type": "gossip" })).code, "invalid_arguments");
        assert_eq!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "hi", "payload": "{nope" })).code, "invalid_arguments");
        assert!(m.messages.is_empty());
        let d = vec![json!({ "id": "dispatch-1", "status": "completed", "runId": run, "terminal": 7 }), json!({ "id": "dispatch-2", "status": "ready", "runId": run, "terminal": 8 })];
        let gone = m.send("term-2", &json!({ "to": "dispatch:dispatch-1", "subject": "hi" }), &d, &live, 2).unwrap_err();
        assert_eq!(gone.code, "dispatch_finished");
        assert!(gone.message.contains(&format!("run:{run}")));
        let other = m.run_create("term-3", "p", 3)["run"]["id"].as_str().unwrap().to_string();
        let mismatch = m.send("term-2", &json!({ "to": "dispatch:dispatch-2", "run": other, "subject": "hi" }), &d, &live, 2).unwrap_err();
        assert_eq!(mismatch.code, "run_mismatch");
        assert!(m.messages.is_empty());
        // A worker inside an active dispatch that names no one writes to its Run.
        let r = m.send("term-8", &json!({ "subject": "progress", "type": "heartbeat" }), &d, &live, 4).unwrap();
        assert_eq!(r["to"], format!("run:{run}"));
        assert_eq!(m.boxes_of("term-8", &d), vec!["term:term-8".to_string(), "dispatch:dispatch-2".to_string()]);
        let ok = m.send("term-2", &json!({ "to": "term-8", "subject": "hi", "filesModified": "a.rs, b.rs", "outcome": "succeeded", "type": "worker_done" }), &d, &live, 5).unwrap();
        assert_eq!(ok["to"], "term:term-8");
        assert_eq!(m.messages.last().unwrap().extras["filesModified"], json!(["a.rs", "b.rs"]));
    }

    #[test]
    fn a_reply_goes_back_on_the_thread_and_inbox_only_reads() {
        let mut m = Mail::default();
        m.run_create("term-1", "o", 1);
        let sent = m.send("term-1", &json!({ "to": "term-8", "subject": "go", "body": "start" }), &[], &live, 2).unwrap();
        let id = sent["messageIds"][0].as_str().unwrap().to_string();
        let boxes8 = m.boxes_of("term-8", &[]);
        let got = m.check("term-8", "term-8", &boxes8, Mode::Next, None, None, None).unwrap();
        assert_eq!(got["messages"][0]["reply"], format!("{CLI} orchestration reply --id {id} --body \"<your answer>\""));
        let r = m.reply("term-8", &id, "on it", None, &boxes8, None, 3).unwrap();
        assert_eq!(r["to"], "term:term-1");
        let boxes1 = m.boxes_of("term-1", &[]);
        let back = m.check("term-1", "term-1", &boxes1, Mode::Next, None, None, None).unwrap();
        assert_eq!(back["messages"][0]["threadId"], id.as_str());
        assert_eq!(back["messages"][0]["subject"], "Re: go");
        assert_eq!(back["messages"][0]["body"], "on it");
        assert_eq!(m.reply("term-8", "msg-99", "x", None, &boxes8, None, 4).unwrap_err().code, "not_found");
        assert_eq!(m.reply("term-8", &id, "x", Some("run-9"), &boxes8, None, 4).unwrap_err().code, "run_mismatch");
        for i in 0..7 {
            m.send("term-1", &json!({ "to": "term-8", "subject": format!("n{i}"), "body": "x".repeat(300) }), &[], &live, 10 + i).unwrap();
        }
        let before = m.deliveries.clone();
        let five = m.inbox("term-8", &boxes8, 5, false);
        assert_eq!(five["messages"].as_array().unwrap().len(), 5);
        assert_eq!(five["messages"][0]["subject"], "n6");
        assert!(five["messages"][0]["body"].as_str().unwrap().chars().count() <= 120);
        assert_eq!(m.inbox("term-8", &boxes8, 5, true)["messages"][0]["body"].as_str().unwrap().len(), 300);
        assert_eq!(m.deliveries, before);
    }

    #[test]
    fn tasks_wait_on_their_dependencies_and_list_per_run() {
        let mut tasks = Vec::new();
        let a = task_create(&mut tasks, &json!({ "spec": "build a" }), Some("run-1".into()), 1).unwrap();
        let aid = a["id"].as_str().unwrap().to_string();
        assert_eq!(a["status"], "ready");
        let b = task_create(&mut tasks, &json!({ "spec": "b", "deps": format!("[\"{aid}\"]") }), Some("run-1".into()), 2).unwrap();
        assert_eq!(b["status"], "pending");
        // CLI-034: PowerShell strips the quotes out of a JSON list; the ids still arrive.
        assert_eq!(parse_deps(&format!("[{aid}, task-9]")), Some(vec![aid.clone(), "task-9".to_string()]));
        assert_eq!(parse_deps("[]"), Some(vec![]));
        assert_eq!(parse_deps("task-1"), None);
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x", "deps": "[\"missing\"]" }), None, 3).unwrap_err().code, "not_found");
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x", "deps": "nope" }), None, 3).unwrap_err().code, "invalid_arguments");
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x".repeat(SPEC_MAX + 1) }), None, 3).unwrap_err().code, "too_large");
        assert_eq!(tasks.len(), 2);
        tasks[0]["status"] = json!("completed");
        promote(&mut tasks);
        assert_eq!(tasks[1]["status"], "ready");
        let long = format!("word  {}\n\tend", "y ".repeat(1000));
        task_create(&mut tasks, &json!({ "spec": long, "displayName": "Long one" }), Some("run-1".into()), 4).unwrap();
        task_create(&mut tasks, &json!({ "spec": "elsewhere" }), Some("run-2".into()), 5).unwrap();
        let none = |_: &str| false;
        let all = task_list(&tasks, &[], Some("run-1"), &json!({ "brief": true }), &none).unwrap();
        let rows = all["tasks"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        let compact = rows[2]["spec"].as_str().unwrap();
        assert!(compact.chars().count() <= 160 && compact.chars().count() > 150, "{compact}");
        assert!(!compact.contains('\n') && !compact.contains("  "));
        assert_eq!(rows[2]["name"], "Long one");
        assert_eq!(rows[1]["name"], "b");
        let ready = task_list(&tasks, &[], Some("run-1"), &json!({ "ready": true }), &none).unwrap();
        assert_eq!(ready["tasks"].as_array().unwrap().len(), 2);
        assert!(task_list(&tasks, &[], None, &json!({ "status": "odd" }), &none).is_err());
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "running", "terminal": 8 })];
        let held = task_list(&tasks, &d, Some("run-1"), &json!({}), &live).unwrap();
        assert_eq!(held["tasks"][1]["worker"]["terminal"], "term-8");
        assert_eq!(held["tasks"][1]["worker"]["dispatchId"], "dispatch-1");
        let gone = task_list(&tasks, &d, Some("run-1"), &json!({}), &none).unwrap();
        assert_eq!(gone["tasks"][1]["worker"], Value::Null);
        let before_restart = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "running", "terminal": 8, "runtime": u64::from(std::process::id()) + 1 })];
        assert_eq!(task_list(&tasks, &before_restart, Some("run-1"), &json!({}), &live).unwrap()["tasks"][1]["worker"], Value::Null);
    }

    #[test]
    fn dispatch_turns_away_what_it_must() {
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b", "deps": "[\"task-1\"]" }), None, 2).unwrap();
        let agent = |h: &str| (h == "term-5" || h == "term-6").then(|| "claude".to_string());
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-9", "status": "running", "terminal": 6 })];
        let code = |t: &str, to: &str| dispatch_check(&tasks, &d, t, to, Some("term-1"), None, false, &agent).unwrap_err().code;
        assert_eq!(code("task-2", "term-5"), "task_waiting");
        assert_eq!(code("task-1", "term-1"), "own_pane");
        assert_eq!(code("task-1", "term-4"), "not_an_agent");
        assert_eq!(code("task-1", "term-6"), "busy");
        assert_eq!(code("task-7", "term-5"), "not_found");
        assert_eq!(dispatch_check(&tasks, &d, "task-1", "term-5", Some("term-1"), None, false, &agent).unwrap(), (0, "claude".to_string()));
        let b = brief(&tasks[0], &Brief { dispatch: "dispatch-2", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        assert!(b.contains("task-1") && b.contains("dispatch-2") && b.ends_with('a'), "{b}");
    }

    /// ORCH-035: after three failed dispatches of the same task the next one is turned away, a
    /// success in between does not reset the count, and another Run's failures do not count.
    #[test]
    fn orch035_the_breaker_turns_a_task_away_after_three_failed_dispatches() {
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        let agent = |h: &str| (h == "term-5").then(|| "claude".to_string());
        let failed = |n: u32| json!({ "id": format!("dispatch-{n}"), "taskId": "task-1", "status": "failed", "terminal": 5 });
        let check = |d: &[Value]| dispatch_check(&tasks, d, "task-1", "term-5", Some("term-1"), None, false, &agent);
        let mut d = vec![failed(1), failed(2)];
        assert!(check(&d).is_ok(), "two failures: still handed out");
        d.push(json!({ "id": "dispatch-3", "taskId": "task-1", "status": "completed", "terminal": 5 }));
        d.push(json!({ "id": "dispatch-4", "taskId": "task-1", "runId": "run-2", "status": "failed", "terminal": 5 }));
        d.push(json!({ "id": "dispatch-5", "taskId": "task-2", "status": "failed", "terminal": 5 }));
        assert!(check(&d).is_ok(), "a success, another Run's failure and another task's failure leave the count at two");
        d.push(failed(6));
        let e = check(&d).unwrap_err();
        assert_eq!(e.code, "breaker_open");
        assert_eq!(e.message, "task-1 failed 3 times, so Kolux holds it back instead of handing it out again");
        assert_eq!(failed_dispatches(&d, "task-1", None), 3);
        assert_eq!(failed_dispatches(&d, "task-1", Some("run-2")), 1);
    }

    /// ORCH-035 (T-279-c): a ready task whose breaker is open lists as held with its count, the
    /// ready lists leave it out, and a reset closes the breaker: it lists and dispatches as ready
    /// again, the failed records stay (stamped), and a later failure counts from one.
    #[test]
    fn orch035_a_held_task_lists_as_held_with_its_count_and_a_reset_frees_it() {
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b" }), None, 2).unwrap();
        let failed = |n: u32, t: &str| json!({ "id": format!("dispatch-{n}"), "taskId": t, "status": "failed", "terminal": 5 });
        let mut d = vec![failed(1, "task-1"), failed(2, "task-1"), failed(3, "task-2"), failed(4, "task-1")];
        let none = |_: &str| false;
        let list = |d: &[Value], a: Value| task_list(&tasks, d, None, &a, &none).unwrap()["tasks"].as_array().unwrap().clone();
        let ids = |rows: Vec<Value>| rows.iter().map(|r| r["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let all = list(&d, json!({}));
        assert_eq!((&all[0]["status"], &all[0]["held"], &all[0]["failures"]), (&json!("held"), &json!("held (3 failures)"), &json!(3)));
        assert_eq!((&all[1]["status"], &all[1]["held"], &all[1]["failures"]), (&json!("ready"), &Value::Null, &json!(1)));
        assert_eq!(ids(list(&d, json!({ "ready": true }))), ["task-2"]);
        assert_eq!(ids(list(&d, json!({ "status": "ready" }))), ["task-2"]);
        assert_eq!(ids(list(&d, json!({ "status": "held" }))), ["task-1"]);
        assert_eq!(tasks[0]["status"], "ready", "the stored status is untouched");
        let agent = |h: &str| (h == "term-5").then(|| "claude".to_string());
        let check = |d: &[Value]| dispatch_check(&tasks, d, "task-1", "term-5", Some("term-1"), None, false, &agent);
        assert_eq!(check(&d).unwrap_err().code, "breaker_open");
        assert_eq!(breaker_reset(&tasks, &mut d, "task-7", None, 9).unwrap_err().code, "not_found");
        assert_eq!(breaker_reset(&tasks, &mut d, "task-1", Some("run-2"), 9).unwrap_err().code, "not_found");
        let r = breaker_reset(&tasks, &mut d, "task-1", None, 9).unwrap();
        assert_eq!((&r["status"], &r["failures"], &r["cleared"]), (&json!("ready"), &json!(0), &json!(3)));
        let all = list(&d, json!({}));
        assert_eq!((&all[0]["status"], &all[0]["held"], &all[0]["failures"]), (&json!("ready"), &Value::Null, &json!(0)));
        assert_eq!(ids(list(&d, json!({ "ready": true }))), ["task-1", "task-2"]);
        assert!(check(&d).is_ok(), "reset: handed out again");
        assert_eq!(d.iter().filter(|x| x["status"] == "failed" && x["breakerReset"] == 9).count(), 3, "the failed records stay, stamped");
        assert_eq!(d[2]["breakerReset"], Value::Null, "another task's failure is not touched");
        assert_eq!(breaker_reset(&tasks, &mut d, "task-1", None, 10).unwrap()["cleared"], 0, "a retried reset changes nothing");
        d.push(failed(5, "task-1"));
        assert_eq!(failed_dispatches(&d, "task-1", None), 1);
        assert_eq!(held_label(1), "held (1 failure)");
    }

    /// ORCH-035: a terminal that already holds an unfinished dispatch is turned away; one whose
    /// dispatch has finished is free again.
    #[test]
    fn orch035_a_terminal_already_holding_a_dispatch_is_turned_away() {
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        let agent = |h: &str| (h == "term-5").then(|| "claude".to_string());
        let check = |d: &[Value]| dispatch_check(&tasks, d, "task-1", "term-5", Some("term-1"), None, false, &agent);
        let held = vec![json!({ "id": "dispatch-1", "taskId": "task-7", "status": "running", "terminal": 5 })];
        let e = check(&held).unwrap_err();
        assert_eq!((e.code, e.message.as_str()), ("busy", "term-5 is already working on dispatch-1"));
        let done = vec![json!({ "id": "dispatch-1", "taskId": "task-7", "status": "completed", "terminal": 5 })];
        assert!(check(&done).is_ok());
    }

    #[test]
    fn a_brief_says_how_to_report_ask_and_keep_in_touch() {
        let task = json!({ "id": "task-4", "spec": "Fix the login bug.\nThen run the tests." });
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: Some("run-2"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        let line = |needle: &str| b.lines().find(|l| l.contains(needle)).unwrap_or_else(|| panic!("no {needle} in {b}")).to_string();
        // The done, heartbeat and question commands are one line each and carry this dispatch.
        for kind in ["--type worker_done --outcome succeeded", "--type heartbeat", "--type question"] {
            let l = line(kind);
            assert!(l.trim_start().starts_with(CLI) && l.contains("--dispatch-id dispatch-7") && l.contains("--to run:run-2") && l.contains("--task-id task-4"), "{l}");
            assert_eq!(l.matches('"').count() % 2, 0, "unbalanced quotes: {l}");
        }
        assert!(b.contains("five minutes") && b.contains("orchestration check") && b.contains("not your own question tool"), "{b}");
        assert!(b.contains("wait at your prompt"), "{b}");
        assert!(!b.contains("behind"), "no drift section when the worktree is up to date: {b}");
        // The task text comes last, after the divider.
        let (head, tail) = b.rsplit_once(DIVIDER).expect("divider");
        assert_eq!(tail.trim_start_matches('\n'), "Fix the login bug.\nThen run the tests.");
        assert!(head.contains("worker_done"));
        // Without a Run, reports go to the coordinator's pane; drift names the base and the count.
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: None, coordinator: Some("term-1"), behind: Some((2, "main".into())), levels_left: 0 });
        assert!(line_of(&b, "worker_done").contains("--to term-1"), "{b}");
        assert!(b.contains("2 commits behind main"), "{b}");
        assert!(b.find("behind").unwrap() < b.find(DIVIDER).unwrap());
    }

    fn line_of(b: &str, needle: &str) -> String {
        b.lines().find(|l| l.contains(needle)).unwrap_or_default().to_string()
    }

    #[test]
    fn a_tier_runs_on_the_coordinators_own_agent() {
        assert_eq!(tier_agent(None, Some("codex"), "claude").unwrap(), "codex");
        assert_eq!(tier_agent(None, None, "claude").unwrap(), "claude");
        assert_eq!(tier_agent(Some("codex"), Some("codex"), "claude").unwrap(), "codex");
        assert_eq!(tier_agent(Some("codex"), None, "claude").unwrap(), "codex");
        assert_eq!(tier_agent(Some("codex"), Some("claude"), "claude").unwrap_err().code, "invalid_arguments");
    }
    #[test]
    fn orch032_workers_nest_only_inside_the_cap() {
        // A coordinator (no dispatch of its own) starts level 1 under the default cap of 1.
        assert_eq!(nest(Some("term-1"), &[], None, None).unwrap(), (1, 1));
        let w1 = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2, "depth": 1, "maxDepth": 1 })];
        let no = nest(Some("term-2"), &w1, None, None).unwrap_err();
        assert_eq!(no.code, "nesting_limit");
        assert!(no.message.contains("do this task yourself"), "{}", no.message);
        // A worker cannot raise the cap it was given; a coordinator can, by flag or by setting.
        assert_eq!(nest(Some("term-2"), &w1, Some(5), None).unwrap_err().code, "nesting_limit");
        assert_eq!(nest(Some("term-1"), &[], Some(2), None).unwrap(), (1, 2));
        assert_eq!(nest(Some("term-1"), &[], None, Some(3)).unwrap(), (1, 3));
        let w2 = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2, "depth": 1, "maxDepth": 2 }), json!({ "id": "dispatch-2", "status": "running", "terminal": 3, "depth": 2, "maxDepth": 2 })];
        assert_eq!(nest(Some("term-2"), &w2, None, None).unwrap(), (2, 2));
        assert_eq!(nest(Some("term-3"), &w2, None, None).unwrap_err().code, "nesting_limit");
        // A dispatch stored before depth was recorded counts as one level down, under the default cap.
        let old = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2 })];
        assert_eq!(nest(Some("term-2"), &old, None, None).unwrap_err().code, "nesting_limit");
        // A finished dispatch no longer makes its pane a worker.
        let done = vec![json!({ "id": "dispatch-1", "status": "abandoned", "terminal": 2, "depth": 1, "maxDepth": 1 })];
        assert_eq!(nest(Some("term-2"), &done, None, None).unwrap(), (1, 1));
        // The brief offers sub-workers only while levels remain.
        let task = json!({ "id": "task-1", "spec": "x" });
        let with = brief(&task, &Brief { dispatch: "dispatch-3", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 1 });
        assert!(with.contains("sub-worker") && with.contains("orchestration worker-start"), "{with}");
        let without = brief(&task, &Brief { dispatch: "dispatch-3", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        assert!(!without.contains("sub-worker"), "{without}");
        // ORCH-013: a context-only dispatch to the caller's own pane is allowed inside the budget only.
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        let agent = |_: &str| Some("claude".to_string());
        assert!(dispatch_check(&tasks, &[], "task-1", "term-1", Some("term-1"), None, true, &agent).is_ok());
        assert_eq!(dispatch_check(&tasks, &[], "task-1", "term-1", Some("term-1"), None, false, &agent).unwrap_err().code, "own_pane");
    }

    #[test]
    fn orch012_task_update_keeps_tasks_and_workers_in_step() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let r = Some(run.as_str());
        let me = std::process::id();
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "c" }), Some(run.clone()), 1).unwrap();
        for (i, t) in tasks.iter_mut().take(2).enumerate() {
            t["status"] = json!("dispatched");
            t["dispatchId"] = json!(format!("dispatch-{}", i + 1));
        }
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": me }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-2", "status": "running", "terminal": 3, "runtime": me }),
        ];
        // Unknown states, other Runs' tasks and a hand-made dispatched state are turned away.
        assert!(task_update(&mut tasks, &mut d, "task-1", "done", None, r, None, 5).unwrap_err().message.contains("pending, ready, dispatched, completed, failed, blocked"));
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "completed", None, Some("run-9"), None, 5).unwrap_err().code, "not_found");
        assert_eq!(task_update(&mut tasks, &mut d, "task-3", "dispatched", None, r, None, 5).unwrap_err().code, "invalid_transition");
        // A worker whose process already ended cannot claim the task done.
        d[0]["exitedAt"] = json!(4);
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "completed", None, r, Some("term-2"), 5).unwrap_err().code, "worker_exited");
        assert_eq!((tasks[0]["status"].as_str(), d[0]["status"].as_str()), (Some("dispatched"), Some("running")));
        d[0].as_object_mut().unwrap().remove("exitedAt");
        // Completing a dispatched task settles its worker in the same change.
        let done = task_update(&mut tasks, &mut d, "task-1", "completed", Some("all green"), r, Some("term-1"), 6).unwrap();
        assert_eq!((done["status"].as_str(), done["previous"].as_str(), done["dispatchStatus"].as_str()), (Some("completed"), Some("dispatched"), Some("completed")));
        assert_eq!((tasks[0]["status"].as_str(), tasks[0]["result"].as_str(), d[0]["status"].as_str()), (Some("completed"), Some("all green"), Some("completed")));
        assert!(finished(&d[0]), "its worker slot is free");
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "dispatched", None, r, None, 7).unwrap_err().code, "invalid_transition");
        // Sending a dispatched task back fences its worker, so it never has two.
        let back = task_update(&mut tasks, &mut d, "task-2", "ready", None, r, None, 8).unwrap();
        assert_eq!(back["dispatchStatus"], "abandoned");
        assert_eq!((tasks[1]["status"].as_str(), tasks[1].get("dispatchId")), (Some("ready"), None));
        // ...and that worker can no longer settle it.
        assert_eq!(task_update(&mut tasks, &mut d, "task-2", "completed", None, r, Some("term-3"), 9).unwrap_err().code, "dispatch_finished");
        assert_eq!(tasks[1]["status"], "ready");
        // Every task is still either dispatched to exactly one open worker or held by none.
        for t in &tasks {
            let open = d.iter().filter(|x| x["taskId"] == t["id"] && !finished(x)).count();
            assert_eq!(open, usize::from(t["status"] == "dispatched"), "{t}");
        }
    }

    fn one_dispatched() -> (Vec<Value>, Vec<Value>) {
        let t = json!({ "id": "task-1", "runId": null, "spec": "x", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" });
        let d = json!({ "id": "dispatch-1", "runId": null, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": std::process::id() });
        (vec![t], vec![d])
    }

    #[test]
    fn orch012_b2_the_first_finished_report_wins_and_a_second_is_refused() {
        for (first, second) in [("completed", "failed"), ("failed", "completed"), ("completed", "completed"), ("failed", "failed")] {
            let (mut tasks, mut d) = one_dispatched();
            task_update(&mut tasks, &mut d, "task-1", first, Some("first"), None, None, 5).unwrap();
            let (t0, d0) = (tasks.clone(), d.clone());
            let e = task_update(&mut tasks, &mut d, "task-1", second, Some("second"), None, None, 6).unwrap_err();
            assert_eq!(e.code, "task_finished", "{first} then {second}");
            assert_eq!(e.message, format!("task-1 is already {first}; a second report cannot change it"));
            assert_eq!((&tasks, &d), (&t0, &d0), "{first} then {second}: nothing changed");
            assert_eq!((tasks[0]["status"].as_str(), tasks[0]["result"].as_str(), d[0]["status"].as_str()), (Some(first), Some("first"), Some(first)));
        }
    }

    #[test]
    fn orch012_b2_a_finished_task_can_still_be_sent_back() {
        for first in ["completed", "failed"] {
            for back in ["pending", "ready", "blocked"] {
                let (mut tasks, mut d) = one_dispatched();
                task_update(&mut tasks, &mut d, "task-1", first, None, None, None, 5).unwrap();
                assert_eq!(task_update(&mut tasks, &mut d, "task-1", back, None, None, None, 6).unwrap()["status"], back, "{first} -> {back}");
            }
        }
    }

    #[test]
    fn orch012_b2_two_updates_at_one_moment_exactly_one_wins() {
        for round in 0..8 {
            let (tasks, d) = one_dispatched();
            let store = std::sync::Arc::new(std::sync::Mutex::new((tasks, d)));
            let go = std::sync::Arc::new(std::sync::Barrier::new(2));
            let fire = |to: &'static str| {
                let (store, go) = (store.clone(), go.clone());
                std::thread::spawn(move || {
                    go.wait();
                    let mut g = store.lock().unwrap();
                    let (t, d) = &mut *g;
                    task_update(t, d, "task-1", to, None, None, None, 5)
                })
            };
            let (c, f) = (fire("completed"), fire("failed"));
            let (rc, rf) = (c.join().unwrap(), f.join().unwrap());
            let wins = [&rc, &rf].iter().filter(|r| r.is_ok()).count();
            assert_eq!(wins, 1, "round {round}: exactly one update wins; got completed={rc:?} failed={rf:?}");
            let g = store.lock().unwrap();
            assert_eq!(g.0[0]["status"], g.1[0]["status"], "round {round}: the task and its worker agree");
        }
    }

    #[test]
    fn orch022_stopping_a_worker_ends_its_terminal_and_keeps_its_worktree() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let r = Some(run.as_str());
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b" }), Some(run.clone()), 1).unwrap();
        tasks[0]["status"] = json!("dispatched");
        tasks[0]["dispatchId"] = json!("dispatch-1");
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 4, "runtime": std::process::id(), "worktree": "W" }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-2", "status": "running", "terminal": 5, "runtime": 1, "worktree": "V" }),
        ];
        assert_eq!(stop(&mut tasks, &mut d, "dispatch-1", Some("run-9"), 5).unwrap_err().code, "not_found");
        let (got, kill) = stop(&mut tasks, &mut d, "dispatch-1", r, 5).unwrap();
        assert_eq!(kill, Some(4), "only the worker's own terminal is ended");
        assert_eq!((got["status"].as_str(), got["worktree"].as_str(), got["worktreeKept"].as_bool()), (Some("stopped"), Some("W"), Some(true)));
        assert_eq!((d[0]["status"].as_str(), tasks[0]["status"].as_str()), (Some("stopped"), Some("ready")));
        // Stopping twice answers the same and ends nothing more.
        let (again, kill) = stop(&mut tasks, &mut d, "dispatch-1", r, 6).unwrap();
        assert_eq!((again["status"].as_str(), kill), (Some("stopped"), None));
        // A terminal Kolux has lost touch with is reported as unverifiable, never as ended.
        let (lost, kill) = stop(&mut tasks, &mut d, "dispatch-2", r, 7).unwrap();
        assert_eq!((lost["process"].as_str(), kill), (Some("unverifiable"), None));
        // A worker that already finished has nothing to stop.
        d[0]["status"] = json!("completed");
        assert_eq!(stop(&mut tasks, &mut d, "dispatch-1", r, 8).unwrap_err().code, "dispatch_finished");
    }

    #[test]
    fn orch023_an_abandoned_dispatch_takes_no_more_reports() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        tasks[0]["status"] = json!("dispatched");
        tasks[0]["dispatchId"] = json!("dispatch-1");
        let mut d = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "mode": "context" })];
        // Another Run cannot abandon it: the id reads as missing.
        assert_eq!(abandon(&mut tasks, &mut d, "dispatch-1", Some("run-9"), 5).unwrap_err().code, "not_found");
        let r = abandon(&mut tasks, &mut d, "dispatch-1", Some(&run), 5).unwrap();
        assert_eq!((r["status"].as_str(), r["terminal"].as_str(), r["terminalKept"].as_bool()), (Some("abandoned"), Some("term-2"), Some(true)));
        assert_eq!(d[0]["status"], "abandoned");
        // Its task can be handed on again.
        assert_eq!(tasks[0]["status"], "ready");
        assert!(tasks[0].get("dispatchId").is_none());
        // Abandoning again answers the same; the worker's done report and heartbeat are turned away.
        assert_eq!(abandon(&mut tasks, &mut d, "dispatch-1", Some(&run), 6).unwrap()["status"], "abandoned");
        let to = format!("run:{run}");
        for kind in [json!({ "type": "worker_done", "outcome": "succeeded" }), json!({ "type": "heartbeat" })] {
            let mut a = json!({ "to": to, "subject": "task-1 done", "taskId": "task-1", "dispatchId": "dispatch-1" });
            a.as_object_mut().unwrap().extend(kind.as_object().unwrap().clone());
            let no = m.send("term-2", &a, &d, &live, 7).unwrap_err();
            assert_eq!(no.code, "dispatch_finished", "{}", no.message);
            assert!(no.message.contains("abandoned"), "{}", no.message);
        }
        assert!(m.messages.is_empty());
        // Ordinary mail still goes through.
        assert!(m.send("term-2", &json!({ "to": to, "subject": "note" }), &d, &live, 8).is_ok());
    }

    #[test]
    fn cli039_a_report_on_a_dispatch_comes_only_from_its_worker() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "work", 1)["run"]["id"].as_str().unwrap().to_string();
        let d = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2 })];
        let to = format!("run:{run}");
        for kind in [json!({ "type": "worker_done", "outcome": "succeeded" }), json!({ "type": "heartbeat" })] {
            let mut a = json!({ "to": to, "subject": "task-1 done", "taskId": "task-1", "dispatchId": "dispatch-1" });
            a.as_object_mut().unwrap().extend(kind.as_object().unwrap().clone());
            // ORCH-015: another pane's report is delivered as mail, but it settles nothing.
            let (mut t, mut dd) = (vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })], d.clone());
            assert!(m.send("term-3", &a, &d, &live, 2).is_ok());
            let no = report(&mut t, &mut dd, "term-3", &a, 2, &|_| None).unwrap();
            assert_eq!(no["settles"], false, "{no}");
            assert!(no["why"].as_str().unwrap().contains("term-2"), "{no}");
            assert_eq!((t[0]["status"].as_str(), dd[0].get("lastBeatAt")), (Some("dispatched"), None));
            assert!(m.send("term-2", &a, &d, &live, 3).is_ok(), "its own worker reports");
        }
        // A dispatch whose worker terminal belongs to an earlier start cannot be vouched for.
        let mut old = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": u64::from(std::process::id()) + 1 })];
        let a = json!({ "to": to, "subject": "done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-1" });
        let mut t = vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })];
        assert!(report(&mut t, &mut old, "term-2", &a, 4, &|_| None).unwrap()["why"].as_str().unwrap().contains("earlier start"));
        assert_eq!(t[0]["status"], "dispatched");
    }

    #[test]
    fn orch015_a_done_report_settles_its_task_and_a_heartbeat_keeps_the_worker_alive() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "work", 1)["run"]["id"].as_str().unwrap().to_string();
        let mut tasks = vec![
            json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1", "deps": [] }),
            json!({ "id": "task-2", "runId": run, "status": "pending", "deps": ["task-1"] }),
            json!({ "id": "task-3", "runId": run, "status": "dispatched", "dispatchId": "dispatch-2", "deps": [] }),
        ];
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2 }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-3", "status": "running", "terminal": 3 }),
        ];
        let to = format!("run:{run}");
        // A heartbeat from the worker's own terminal is stamped with when Kolux got it.
        let beat = json!({ "to": to, "subject": "working", "type": "heartbeat", "dispatchId": "dispatch-1" });
        assert_eq!(report(&mut tasks, &mut d, "term-2", &beat, 50, &|_| None).unwrap()["lastBeatAt"], 50);
        assert_eq!(d[0]["lastBeatAt"], 50);
        let rows = worker_list(&tasks, &d, Some(&run), "named", None, None, 50, &live).unwrap();
        assert_eq!(rows["workers"].as_array().unwrap().iter().find(|w| w["dispatchId"] == "dispatch-1").unwrap()["lastBeatAt"], 50);
        // The coordinator writing one on the worker's behalf: delivered as mail, settles nothing.
        let done = json!({ "to": to, "subject": "task-1 done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-1", "filesModified": "a.rs" });
        assert!(m.send("term-1", &done, &d, &live, 60).is_ok());
        assert_eq!(report(&mut tasks, &mut d, "term-1", &done, 60, &|_| None).unwrap()["settles"], false);
        assert_eq!((tasks[0]["status"].as_str(), d[0]["status"].as_str(), tasks[1]["status"].as_str()), (Some("dispatched"), Some("running"), Some("pending")));
        // The worker's own succeeded report completes the task and frees the one waiting on it.
        let own = report(&mut tasks, &mut d, "term-2", &done, 70, &|_| None).unwrap();
        assert_eq!((own["status"].as_str(), own["dispatchStatus"].as_str()), (Some("completed"), Some("completed")), "{own}");
        assert_eq!((tasks[0]["status"].as_str(), tasks[0]["result"].as_str(), tasks[1]["status"].as_str()), (Some("completed"), Some("task-1 done"), Some("ready")));
        // Once settled, a replayed report or a late heartbeat is turned away and changes nothing.
        for again in [&done, &beat] {
            assert_eq!(m.send("term-2", again, &d, &live, 80).unwrap_err().code, "dispatch_finished");
        }
        assert_eq!(d[0]["lastBeatAt"], 50);
        // A failed report fails its task; a report on a task already handed to another dispatch
        // is not taken, never read as success.
        let failed = json!({ "to": to, "subject": "tests red", "body": "two tests fail", "type": "worker_done", "outcome": "failed", "dispatchId": "dispatch-2" });
        tasks[2]["dispatchId"] = json!("dispatch-9");
        assert_eq!(report(&mut tasks, &mut d, "term-3", &failed, 90, &|_| None).unwrap_err().code, "outcome_unknown");
        tasks[2]["dispatchId"] = json!("dispatch-2");
        report(&mut tasks, &mut d, "term-3", &failed, 91, &|_| None).unwrap();
        assert_eq!((tasks[2]["status"].as_str(), tasks[2]["result"].as_str(), d[1]["status"].as_str()), (Some("failed"), Some("two tests fail"), Some("failed")));
        // Ordinary mail, and a report naming no dispatch, settle nothing.
        assert!(report(&mut tasks, &mut d, "term-2", &json!({ "subject": "hi" }), 92, &|_| None).unwrap().is_null());
        assert!(report(&mut tasks, &mut d, "term-2", &json!({ "subject": "x", "type": "worker_done", "outcome": "succeeded" }), 92, &|_| None).unwrap().is_null());
    }

    #[test]
    fn orch033_one_run_cannot_reach_into_another() {
        let mut m = Mail::default();
        let a = m.run_create("term-1", "A", 1)["run"]["id"].as_str().unwrap().to_string();
        let b = m.run_create("term-5", "B", 2)["run"]["id"].as_str().unwrap().to_string();
        // A worker acts in the Run of the dispatch it works on.
        let d = vec![json!({ "id": "dispatch-1", "runId": a, "taskId": "task-1", "status": "running", "terminal": 2 })];
        assert_eq!(m.run_of("term-2", &d).as_deref(), Some(a.as_str()));
        assert_eq!(m.run_of("term-5", &d).as_deref(), Some(b.as_str()));
        assert_eq!(m.run_of("term-7", &d), None);
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "A's" }), Some(a.clone()), 1).unwrap();
        // From Run B, Run A's task reads exactly as a missing one.
        assert_eq!(task_in(&tasks, "task-1", Some(&b)).unwrap_err(), task_in(&[], "task-1", Some(&b)).unwrap_err());
        assert_eq!(task_in(&tasks, "task-1", Some(&a)).unwrap(), 0);
        let agent = |_: &str| Some("claude".to_string());
        assert_eq!(dispatch_check(&tasks, &[], "task-1", "term-6", Some("term-5"), Some(&b), false, &agent).unwrap_err().code, "not_found");
        assert!(dispatch_check(&tasks, &[], "task-1", "term-6", Some("term-1"), Some(&a), false, &agent).is_ok());
        // A message in Run A cannot be answered from Run B, the same as a missing one.
        let sent = m.send("term-2", &json!({ "to": format!("run:{a}"), "subject": "q" }), &d, &live, 3).unwrap();
        let id = sent["messageIds"][0].as_str().unwrap().to_string();
        let boxes_b = m.boxes_of("term-5", &d);
        let no = m.reply("term-5", &id, "x", None, &boxes_b, Some(&b), 4).unwrap_err();
        assert_eq!((no.code, no.message.clone()), ("not_found", format!("no message {id}")));
        let boxes_a = m.boxes_of("term-1", &d);
        assert!(m.reply("term-1", &id, "x", None, &boxes_a, Some(&a), 4).is_ok());
    }

    fn peer(h: &str, agent: Option<&str>, idle: bool, dir: &str) -> Peer {
        Peer { handle: h.into(), agent: agent.map(str::to_string), idle, dir: dir.into() }
    }

    #[test]
    fn a_group_send_fans_out_on_one_thread() {
        let mut m = Mail::default();
        let peers = vec![
            peer("term-1", Some("claude"), true, "G:/r"),
            peer("term-2", Some("codex"), true, "G:/r/wt"),
            peer("term-3", Some("claude"), false, "G:/r"),
            peer("term-4", None, true, "G:/r"),
        ];
        let sent = |m: &mut Mail, to: &str| -> Vec<String> {
            let r = m.post("term-1", &json!({ "to": to, "subject": "hi" }), &[], &peers, 2).unwrap();
            assert!(r.get("deliveryId").is_none() && r.get("deliveries").is_none(), "a receipt carries no delivery bookkeeping");
            let ids: Vec<String> = r["messageIds"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            let thread = r["threadId"].as_str().unwrap();
            let mut to: Vec<String> = m.messages.iter().filter(|x| ids.contains(&x.id)).inspect(|x| assert_eq!(x.extras["threadId"], thread)).map(|x| x.to.clone()).collect();
            to.sort();
            to
        };
        // The sender and the shell are never part of it; titles play no part, only the detected agent.
        assert_eq!(sent(&mut m, "@all"), ["term:term-2", "term:term-3"]);
        assert_eq!(sent(&mut m, "@idle"), ["term:term-2"], "the sender is idle but never gets its own copy");
        assert_eq!(sent(&mut m, "@claude"), ["term:term-3"]);
        assert_eq!(sent(&mut m, "@CODEX"), ["term:term-2"]);
        assert_eq!(sent(&mut m, "@worktree:p-1::G:/r/wt"), ["term:term-2"]);
        assert_eq!(sent(&mut m, "@worktree:G:/r/wt/"), ["term:term-2"]);
        let given = m.post("term-1", &json!({ "to": "@all", "subject": "x", "threadId": "t-9" }), &[], &peers, 3).unwrap();
        assert_eq!(given["threadId"], "t-9");
        let no = |m: &mut Mail, a: Value| m.post("term-1", &a, &[], &peers, 4).unwrap_err();
        let unknown = no(&mut m, json!({ "to": "@nobody", "subject": "x" }));
        assert!(unknown.message.contains("@nobody"), "{}", unknown.message);
        assert!(no(&mut m, json!({ "to": "@cursor", "subject": "x" })).message.contains("no agent"));
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "type": "question" })).message.contains("one recipient"));
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "type": "heartbeat" })).message.contains("group"));
        let before = m.messages.len();
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "priority": "loud" })).message.contains("--priority"));
        assert_eq!(m.messages.len(), before, "a refused group send leaves nothing behind");
        // One-to-one sends still go through post.
        assert!(m.post("term-1", &json!({ "to": "term-4", "subject": "x" }), &[], &peers, 5).is_ok());
        assert_eq!(m.post("term-1", &json!({ "to": "term-7", "subject": "x" }), &[], &peers, 5).unwrap_err().code, "not_found");
    }

    #[test]
    fn a_gate_holds_its_task_until_it_is_resolved() {
        let mut m = Mail::default();
        let mut tasks = vec![
            json!({ "id": "task-1", "status": "ready", "runId": "run-1", "deps": [] }),
            json!({ "id": "task-2", "status": "dispatched", "runId": "run-1", "deps": [] }),
            json!({ "id": "task-3", "status": "ready", "runId": "run-2", "deps": [] }),
            json!({ "id": "task-4", "status": "ready", "deps": [] }),
        ];
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "ready", "runId": "run-1" })];
        let g = m.gate_create(Some("run-1"), &mut tasks, &d, &json!({ "task": "task-1", "question": "ship it?", "options": r#"["yes","no"]"# }), 1).unwrap();
        assert_eq!(tasks[0]["status"], "blocked");
        assert_eq!(g["options"], json!(["yes", "no"]));
        assert_eq!(g["status"], "pending");
        let id = g["id"].as_str().unwrap().to_string();
        let count = |m: &Mail, run: &str, status: &str| m.gate_list(Some(run), &json!({ "status": status })).unwrap()["gates"].as_array().unwrap().len();
        assert_eq!(count(&m, "run-1", "pending"), 1);
        assert_eq!(count(&m, "run-2", "pending"), 0, "a gate belongs to its own Run");
        assert_eq!(m.gate_resolve(Some("run-2"), &mut tasks, &json!({ "id": id, "resolution": "yes" }), 2).unwrap_err().code, "not_found");
        let r = m.gate_resolve(Some("run-1"), &mut tasks, &json!({ "id": id, "resolution": "yes" }), 3).unwrap();
        assert_eq!((r["status"].as_str(), r["resolution"].as_str()), (Some("resolved"), Some("yes")));
        assert_eq!(tasks[0]["status"], "ready");
        assert!(m.gate_resolve(Some("run-1"), &mut tasks, &json!({ "id": id, "resolution": "no" }), 4).unwrap_err().message.contains("already"));
        assert_eq!(count(&m, "run-1", "resolved"), 1);
        assert!(m.gate_list(Some("run-1"), &json!({ "status": "open" })).is_err());
        // Nothing is left behind when the gate cannot be opened.
        let before = (m.gates.len(), tasks.clone());
        let no = |m: &mut Mail, tasks: &mut Vec<Value>, a: Value| m.gate_create(Some("run-1"), tasks, &d, &a, 5).unwrap_err();
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-1", "question": "q", "options": "yes,no" })).message.contains("JSON"));
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-2", "question": "q" })).message.contains("worker"));
        assert_eq!(no(&mut m, &mut tasks, json!({ "task": "task-3", "question": "q" })).code, "not_found");
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-1" })).message.contains("--question"));
        // CLI-037: with no Run attached, even a task that has no Run of its own is not held.
        let lone = m.gate_create(None, &mut tasks, &d, &json!({ "task": "task-4", "question": "q" }), 5).unwrap_err();
        assert_eq!(lone.code, "no_run");
        assert!(lone.message.contains("run-create"), "{}", lone.message);
        assert_eq!((m.gates.len(), tasks.clone()), before);
    }

    #[test]
    fn a_question_waits_for_its_reply_and_can_be_resumed() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let peers = vec![peer("term-1", Some("claude"), true, "G:/r"), peer("term-2", Some("claude"), true, "G:/r/w")];
        let q = m.ask("term-2", &json!({ "question": "tabs or spaces?", "options": "tabs, spaces", "to": format!("run:{run}") }), &[], &peers, 2).unwrap();
        assert_eq!(q["status"], "open");
        let id = q["messageId"].as_str().unwrap().to_string();
        let msg = m.messages.iter().find(|x| x.id == id).unwrap();
        assert_eq!((msg.kind.as_str(), msg.to.clone()), ("question", format!("run:{run}")));
        assert_eq!(msg.extras["payload"]["options"], json!(["tabs", "spaces"]));
        assert_eq!(m.ask("term-2", &json!({ "resume": id }), &[], &peers, 3).unwrap()["status"], "open");
        let boxes = m.boxes_of("term-1", &[]);
        m.reply("term-1", &id, "spaces", None, &boxes, Some(&run), 4).unwrap();
        let a = m.ask("term-2", &json!({ "resume": id }), &[], &peers, 5).unwrap();
        assert_eq!((a["status"].as_str(), a["answer"].as_str(), a["answeredBy"].as_str()), (Some("answered"), Some("spaces"), Some("term-1")));
        let n = m.messages.len();
        assert!(m.ask("term-2", &json!({ "question": "x", "to": "@all" }), &[], &peers, 6).unwrap_err().message.contains("one recipient"));
        assert_eq!(m.messages.len(), n, "no question is made for a group");
        assert!(m.ask("term-2", &json!({ "question": "x", "resume": id }), &[], &peers, 6).unwrap_err().message.contains("not both"));
        assert!(m.ask("term-2", &json!({ "resume": id, "options": "a,b" }), &[], &peers, 6).unwrap_err().message.contains("--options"));
        assert_eq!(m.ask("term-1", &json!({ "resume": id }), &[], &peers, 6).unwrap_err().code, "not_found", "only the asker resumes its question");
    }

    #[test]
    fn a_reset_clears_only_its_scope() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let peers = vec![peer("term-1", Some("claude"), true, "G:/r")];
        let mut tasks = vec![json!({ "id": "task-1", "status": "ready", "runId": run, "deps": [] })];
        m.gate_create(Some(&run), &mut tasks, &[], &json!({ "task": "task-1", "question": "q" }), 2).unwrap();
        m.post("term-1", &json!({ "subject": "hi", "to": format!("run:{run}") }), &[], &peers, 3).unwrap();
        let boxes = m.boxes_of("term-1", &[]);
        let first = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(first["messages"].as_array().unwrap().len(), 1);
        m.reset("tasks").unwrap();
        assert!(m.gates.is_empty());
        assert_eq!((m.runs.len(), m.messages.len()), (1, 1), "the tasks scope keeps Runs and mail");
        m.reset("messages").unwrap();
        assert!(m.messages.is_empty());
        assert_eq!((m.runs.len(), m.deliveries.len()), (1, 1), "the messages scope keeps Runs and delivery positions");
        let seq = m.seq;
        m.reset("all").unwrap();
        assert_eq!((m.runs.len(), m.deliveries.len(), m.bindings.len()), (0, 0, 0));
        assert_eq!(m.seq, seq, "ids keep counting up, so nothing cleared is named again");
        assert!(m.reset("everything").is_err());
    }
    #[test]
    fn orch026_worker_list_shows_terminal_accounting_apart_from_task_status() {
        let me = std::process::id();
        let tasks = vec![json!({ "id": "task-1", "status": "dispatched" }), json!({ "id": "task-2", "status": "completed" })];
        let d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me, "worktree": "W" }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 5, "runtime": me }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-2", "status": "stopped", "terminal": 6, "runtime": me }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 7, "runtime": 1, "retained": true }),
            json!({ "id": "dispatch-5", "runId": "run-2", "taskId": "task-9", "status": "failed", "terminal": 8, "runtime": me }),
            // A very old record, from before dispatches carried a runtime or a status.
            json!({ "id": "dispatch-6", "runId": "run-1", "taskId": "task-1" }),
        ];
        let live = |h: &str| ["term-4", "term-5", "term-8"].contains(&h);
        let all = |run, state, cursor, limit| worker_list(&tasks, &d, run, "named", state, cursor, limit, &live);
        let got = all(Some("run-1"), None, None, 100).unwrap();
        let states: Vec<(&str, &str)> = got["workers"].as_array().unwrap().iter().map(|w| (w["dispatchId"].as_str().unwrap(), w["terminalState"].as_str().unwrap())).collect();
        assert_eq!(states, [("dispatch-1", "active"), ("dispatch-2", "reclaimable"), ("dispatch-3", "released"), ("dispatch-4", "retained"), ("dispatch-6", "active")]);
        assert_eq!((got["scope"]["run"].as_str(), got["scope"]["from"].as_str()), (Some("run-1"), Some("named")));
        let w = &got["workers"][0];
        assert_eq!((w["taskStatus"].as_str(), w["status"].as_str(), w["terminal"].as_str(), w["worktree"].as_str()), (Some("dispatched"), Some("running"), Some("term-4"), Some("W")));
        assert_eq!(w["next"].as_str(), Some(format!("{CLI} orchestration worker-stop --dispatch dispatch-1").as_str()));
        assert_eq!(got["workers"][1]["next"].as_str(), Some(format!("{CLI} terminal close --terminal term-5").as_str()));
        assert!(got["workers"][2]["next"].is_null(), "nothing is left to clean up after a released worker");
        assert!(got["workers"][4]["status"].is_null() && got["workers"][4]["worktree"].is_null(), "an old record lists in the current shape");
        // Only settled workers not yet released are reclaimable.
        let r = all(Some("run-1"), Some("reclaimable"), None, 100).unwrap();
        assert_eq!(r["workers"].as_array().unwrap().len(), 1);
        // No Run in scope: every Run's workers.
        assert_eq!(worker_list(&tasks, &d, None, "all", None, None, 100, &live).unwrap()["workers"].as_array().unwrap().len(), 6);
        // Pages: an opaque cursor carries on, and one from another Run's list is turned away.
        let p1 = all(Some("run-1"), None, None, 2).unwrap();
        let c = p1["nextCursor"].as_str().unwrap().to_string();
        assert!(!c.contains("run-1"), "the cursor is opaque");
        let p2 = all(Some("run-1"), None, Some(&c), 2).unwrap();
        assert_eq!(p2["workers"][0]["dispatchId"], "dispatch-3");
        assert_eq!(all(Some("run-2"), None, Some(&c), 2).unwrap_err().code, "invalid_arguments");
        assert_eq!(all(Some("run-1"), None, Some("nonsense"), 2).unwrap_err().code, "invalid_arguments");
        let last = all(Some("run-1"), None, Some(p2["nextCursor"].as_str().unwrap()), 2).unwrap();
        assert!(last["nextCursor"].is_null());
    }

    #[test]
    fn orch025_keeping_a_settled_worker_lasts_and_lists_apart() {
        let me = std::process::id();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "running", "terminal": 5, "runtime": me }),
        ];
        let live = |h: &str| h == "term-4" || h == "term-5";
        assert_eq!(retain(&mut d, &live, "dispatch-1", Some("run-9")).unwrap_err().code, "not_found");
        assert_eq!(retain(&mut d, &live, "dispatch-2", Some("run-1")).unwrap_err().code, "dispatch_active");
        let r = retain(&mut d, &live, "dispatch-1", Some("run-1")).unwrap();
        assert_eq!((r["terminalState"].as_str(), r["alreadyRetained"].as_bool()), (Some("retained"), Some(false)));
        assert_eq!(d[0]["retained"], true, "the mark is on the stored record, so it outlives a restart");
        assert_eq!(retain(&mut d, &live, "dispatch-1", Some("run-1")).unwrap()["alreadyRetained"], true);
        // After a restart the terminal handle means no one, yet the worker still lists as kept.
        d[0]["runtime"] = json!(1);
        let got = worker_list(&[], &d, Some("run-1"), "tied", Some("retained"), None, 100, &|_| false).unwrap();
        assert_eq!(got["workers"][0]["dispatchId"], "dispatch-1");
        // A worker whose terminal is already gone has nothing to keep.
        d.push(json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "stopped", "terminal": 9, "runtime": 1 }));
        assert_eq!(retain(&mut d, &live, "dispatch-3", Some("run-1")).unwrap_err().code, "terminal_gone");
    }

    #[test]
    fn cli036_release_saves_the_output_before_closing_and_says_pending_or_unknown_on_the_way() {
        let me = std::process::id();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me, "retained": true }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "running", "terminal": 5, "runtime": me }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "failed", "terminal": 6, "runtime": me }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-4", "status": "completed", "terminal": 7, "runtime": me + 1 }),
        ];
        let live = |h: &str| ["term-4", "term-5", "term-6"].contains(&h);
        assert_eq!(release(&mut d, &live, "dispatch-1", Some("run-9"), 1).unwrap_err().code, "not_found");
        let busy = release(&mut d, &live, "dispatch-2", Some("run-1"), 1).unwrap_err();
        assert_eq!(busy.code, "dispatch_active");
        assert!(busy.message.contains("worker-stop --dispatch dispatch-2"), "{}", busy.message);
        // A kept, settled worker with a live terminal: pending first, the handle to save and close.
        let (r, h) = release(&mut d, &live, "dispatch-1", Some("run-1"), 2).unwrap();
        assert_eq!((r["terminalState"].as_str(), h.as_deref()), (Some("release_pending"), Some("term-4")));
        assert_eq!(terminal_state(&d[0], &live), "release_pending");
        // Saved and closed: released, with its archive; the kept mark is gone.
        let done = release_done(&mut d, "dispatch-1", Some("run-1"), Ok("C:/a/dispatch-1.txt".into()), true, 3).unwrap();
        assert_eq!((done["terminalState"].as_str(), done["archive"].as_str()), (Some("released"), Some("C:/a/dispatch-1.txt")));
        assert_eq!(terminal_state(&d[0], &live), "released");
        assert!(d[0].get("retained").is_none());
        // Releasing twice answers the same.
        let (again, h2) = release(&mut d, &live, "dispatch-1", Some("run-1"), 4).unwrap();
        assert_eq!((again["alreadyReleased"].as_bool(), h2), (Some(true), None));
        // A save that failed leaves it open and unknown, with the reason and the retry.
        let (_, h3) = release(&mut d, &live, "dispatch-3", Some("run-1"), 5).unwrap();
        assert_eq!(h3.as_deref(), Some("term-6"));
        let bad = release_done(&mut d, "dispatch-3", Some("run-1"), Err("disk full".into()), false, 6).unwrap();
        assert_eq!(bad["terminalState"], "release_unknown");
        assert!(bad["error"].as_str().unwrap().contains("left open: disk full"));
        assert_eq!(bad["next"], format!("{CLI} orchestration worker-release --dispatch dispatch-3"));
        assert_eq!(terminal_state(&d[2], &live), "release_unknown");
        // The retry goes through once the save works; a saved-but-not-closed one stays unknown.
        let (_, h4) = release(&mut d, &live, "dispatch-3", Some("run-1"), 7).unwrap();
        assert_eq!(h4.as_deref(), Some("term-6"));
        assert_eq!(release_done(&mut d, "dispatch-3", Some("run-1"), Ok("p".into()), false, 8).unwrap()["terminalState"], "release_unknown");
        assert_eq!(release_done(&mut d, "dispatch-3", Some("run-1"), Ok("p".into()), true, 9).unwrap()["terminalState"], "released");
        // A terminal from an earlier start of Kolux is gone already: released at once, no handle.
        let (r4, h5) = release(&mut d, &live, "dispatch-4", Some("run-1"), 10).unwrap();
        assert_eq!((r4["terminalState"].as_str(), h5), (Some("released"), None));
    }

    #[test]
    fn orch024_release_closes_only_a_terminal_the_worker_owns() {
        // T-172-c: a worker handed to a terminal that was already open (a dispatch), or one whose
        // terminal another dispatch still working or kept also names, is released with that
        // terminal left open and the reason said; an old claim already released does not count.
        let me = std::process::id();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me, "mode": "inject" }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 5, "runtime": me }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "running", "terminal": 5, "runtime": me, "mode": "context" }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-4", "status": "completed", "terminal": 6, "runtime": me }),
            json!({ "id": "dispatch-5", "runId": "run-1", "taskId": "task-5", "status": "completed", "terminal": 6, "runtime": me, "released": true }),
            json!({ "id": "dispatch-6", "runId": "run-1", "taskId": "task-6", "status": "failed", "terminal": 7, "runtime": me }),
            json!({ "id": "dispatch-7", "runId": "run-1", "taskId": "task-7", "status": "completed", "terminal": 7, "runtime": me, "retained": true }),
            json!({ "id": "dispatch-8", "runId": "run-1", "taskId": "task-8", "status": "completed", "terminal": 8, "runtime": me + 1 }),
            json!({ "id": "dispatch-9", "runId": "run-1", "taskId": "task-9", "status": "running", "terminal": 8, "runtime": me }),
        ];
        let live = |h: &str| ["term-4", "term-5", "term-6", "term-7", "term-8"].contains(&h);
        // Handed an open terminal: released, nothing to close, and it says why.
        let (r1, h1) = release(&mut d, &live, "dispatch-1", Some("run-1"), 1).unwrap();
        assert_eq!((r1["terminalState"].as_str(), h1), (Some("released"), None));
        assert!(r1["terminalLeftOpen"].as_str().unwrap().contains("term-4 was already open"), "{r1}");
        assert_eq!(terminal_state(&d[0], &live), "released");
        let (again, _) = release(&mut d, &live, "dispatch-1", Some("run-1"), 2).unwrap();
        assert_eq!((again["alreadyReleased"].as_bool(), again["terminalLeftOpen"].is_string()), (Some(true), true));
        // Another dispatch still working names the same terminal: kept open.
        let (r2, h2) = release(&mut d, &live, "dispatch-2", Some("run-1"), 3).unwrap();
        assert_eq!(h2, None);
        assert!(r2["terminalLeftOpen"].as_str().unwrap().contains("dispatch-3"), "{r2}");
        // An old claim already released does not keep it: saved, then closed as usual.
        let (r4, h4) = release(&mut d, &live, "dispatch-4", Some("run-1"), 4).unwrap();
        assert_eq!((r4["terminalState"].as_str(), h4.as_deref()), (Some("release_pending"), Some("term-6")));
        assert!(r4["terminalLeftOpen"].is_null());
        // Another dispatch keeps the same terminal on purpose: kept open.
        let (r6, h6) = release(&mut d, &live, "dispatch-6", Some("run-1"), 5).unwrap();
        assert_eq!(h6, None);
        assert!(r6["terminalLeftOpen"].as_str().unwrap().contains("dispatch-7"), "{r6}");
        assert_eq!(d[6]["retained"], true, "the other dispatch's kept mark is untouched");
        // A handle stamped by an earlier start of Kolux is no one's now, whatever reuses the number.
        let (r8, h8) = release(&mut d, &live, "dispatch-8", Some("run-1"), 6).unwrap();
        assert_eq!((r8["terminalState"].as_str(), h8, r8["terminalLeftOpen"].is_null()), (Some("released"), None, true));
    }

    #[test]
    fn orch017_a_failed_worker_start_names_its_stage_leftovers_and_the_way_out() {
        let timed_out = || json!({ "dispatchId": "dispatch-2", "taskId": "task-1", "status": "unknown", "stage": "worker", "setup": "not_configured", "worktree": { "path": "C:/w/fresh-otter", "created": true }, "terminals": [{ "id": 3, "role": "worker" }] });
        // The agent did not come up in time: an unknown outcome, the terminal left over, a stop.
        let mut r = timed_out();
        start_failed(&mut r, "worker", json!("not_configured"));
        assert_eq!((r["status"].as_str(), r["stage"].as_str(), r["setup"].as_str()), (Some("unknown"), Some("worker"), Some("not_configured")));
        assert_eq!(r["leftovers"]["terminals"], json!(["term-3"]));
        assert_eq!(r["leftovers"]["worktree"], "C:/w/fresh-otter");
        let next: Vec<&str> = r["next"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert_eq!(next[0], format!("{CLI} orchestration worker-stop --dispatch dispatch-2"));
        assert_eq!(next[1], format!("{CLI} orchestration worker-start --task task-1"));
        assert!(next.iter().any(|n| n.contains("worktree rm --worktree \"path:C:/w/fresh-otter\"")), "{next:?}");
        let effects = r["effects"].to_string();
        assert!(effects.contains("task-1") && effects.contains("C:/w/fresh-otter") && effects.contains("term-3"), "{effects}");
        // The setup script failed: a failure, setup named as the stage, a release offered.
        let mut s = timed_out();
        start_failed(&mut s, "setup", json!({ "result": "failed", "exitCode": 1 }));
        assert_eq!((s["status"].as_str(), s["stage"].as_str()), (Some("failed"), Some("setup")));
        assert_eq!(s["setup"]["exitCode"], 1);
        assert_eq!(s["leftovers"]["terminals"], json!(["term-3"]), "a leftover terminal is listed, never closed");
        assert_eq!(s["next"][0], format!("{CLI} orchestration worker-release --dispatch dispatch-2"));
        // No terminal opened in a worktree that was already there: still the stop first, since the
        // task is still dispatched and a retry alone would be turned away; nothing to remove.
        let mut n = json!({ "dispatchId": "dispatch-3", "taskId": "task-2", "status": "unknown", "worktree": { "path": "C:/w/main", "created": false }, "terminals": [] });
        start_failed(&mut n, "worker", json!("not_configured"));
        assert_eq!(n["leftovers"], json!({ "terminals": [], "worktree": null }));
        assert_eq!(n["next"], json!([format!("{CLI} orchestration worker-stop --dispatch dispatch-3"), format!("{CLI} orchestration worker-start --task task-2")]));
    }

    #[test]
    fn cli036_the_archive_is_written_whole_under_the_data_folder() {
        let dir = std::env::temp_dir().join(format!("orch-t089c-{}", std::process::id()));
        let path = write_archive(&dir, "dispatch-1/../x", &["one".into(), "two ü".into()]).unwrap();
        assert!(path.ends_with("dispatch-1____x.txt"), "{path}");
        assert!(std::path::Path::new(&path).starts_with(dir.join("worker-archives")));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo ü\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cli036_worker_stop_warns_when_the_process_is_kept_alive() {
        let me = std::process::id();
        let mut tasks = vec![json!({ "id": "task-1", "status": "dispatched", "dispatchId": "dispatch-1" }), json!({ "id": "task-2", "status": "dispatched", "dispatchId": "dispatch-2" })];
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": null, "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me + 1 }),
            json!({ "id": "dispatch-2", "runId": null, "taskId": "task-2", "status": "running", "terminal": 5, "runtime": me }),
        ];
        let (lost, kill) = stop(&mut tasks, &mut d, "dispatch-1", None, 1).unwrap();
        assert_eq!((lost["process"].as_str(), kill), (Some("unverifiable"), None));
        assert!(lost["warning"].as_str().unwrap().contains("kept alive"), "{lost}");
        let (held, kill) = stop(&mut tasks, &mut d, "dispatch-2", None, 2).unwrap();
        assert_eq!(kill, Some(5));
        assert!(held["warning"].is_null());
        // The CLI's failed kill turns the verdict to unverifiable; the warning follows it.
        let mut after = held.clone();
        after["process"] = json!("unverifiable");
        stop_warning(&mut after);
        assert!(after["warning"].as_str().unwrap().contains("could not end term-5"));
    }

    #[test]
    fn cli036_terminal_commands_refuse_a_worker_with_no_terminal() {
        let me = std::process::id();
        let d = vec![
            json!({ "id": "dispatch-1", "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-2", "taskId": "task-2", "status": "running" }),
        ];
        assert_eq!(terminal_for(&d, "dispatch-1").unwrap(), "term-4");
        let no = terminal_for(&d, "dispatch-2").unwrap_err();
        assert_eq!(no.code, "no_terminal");
        assert!(no.message.contains("worker-read --dispatch dispatch-2 --source transcript"), "{}", no.message);
        assert_eq!(terminal_for(&d, "term-9").unwrap(), "term-9");
    }

    #[test]
    fn cli036_worker_show_says_nothing_waits_only_when_it_could_tell() {
        let me = std::process::id();
        let tasks = vec![json!({ "id": "task-1", "status": "dispatched" })];
        let d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 5, "runtime": me }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-1", "status": "running", "runtime": me }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-1", "status": "failed", "runtime": me }),
        ];
        let live = |h: &str| h == "term-4";
        // Council FIX-SOON: a running worker with no terminal at all is unknown, never "no"; a
        // settled one with no terminal has nothing that can wait.
        let show3 = worker_show(&tasks, &d, "dispatch-3", Some("run-1"), &live, None).unwrap();
        assert_eq!(show3["waiting"], "unknown", "{show3}");
        assert_eq!(worker_show(&tasks, &d, "dispatch-3", Some("run-1"), &live, Some("input")).unwrap()["waiting"], "unknown");
        assert_eq!(worker_show(&tasks, &d, "dispatch-4", Some("run-1"), &live, None).unwrap()["waiting"], "no");
        let show = |id: &str, a: Option<&str>| worker_show(&tasks, &d, id, Some("run-1"), &live, a).unwrap();
        assert_eq!(show("dispatch-1", Some("input"))["waiting"], "yes");
        assert_eq!(show("dispatch-1", Some("approval"))["waiting"], "yes");
        // A quiet live pane is never reported as waiting on nobody.
        assert_eq!(show("dispatch-1", None)["waiting"], "unknown");
        assert_eq!(show("dispatch-1", Some("working"))["waiting"], "unknown");
        let ended = show("dispatch-2", Some("input"));
        assert_eq!((ended["waiting"].as_str(), ended["terminalState"].as_str()), (Some("no"), Some("released")));
        assert_eq!(worker_show(&tasks, &d, "dispatch-1", Some("run-2"), &live, None).unwrap_err().code, "not_found");
    }

    #[test]
    fn orch037_attention_flags_input_approval_failure_interruption_and_stale() {
        let me = std::process::id();
        let now: u64 = 2_000_000_000_000;
        let fresh = now - 1_000;
        let old = now - STALE_MS - 1;
        let d = vec![
            json!({ "id": "dispatch-1", "status": "running", "terminal": 4, "runtime": me, "lastBeatAt": fresh }),
            json!({ "id": "dispatch-2", "status": "failed", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-3", "status": "completed", "terminal": 4, "runtime": me, "lastBeatAt": old }),
            json!({ "id": "dispatch-4", "status": "running", "terminal": 5, "runtime": me, "lastBeatAt": fresh }),
            json!({ "id": "dispatch-5", "status": "running", "terminal": 4, "runtime": me, "lastBeatAt": fresh, "exitedAt": fresh }),
            json!({ "id": "dispatch-6", "status": "running", "terminal": 4, "runtime": me + 1, "lastBeatAt": fresh }),
            json!({ "id": "dispatch-7", "status": "running", "terminal": 4, "runtime": me, "lastBeatAt": old }),
            json!({ "id": "dispatch-8", "status": "unknown", "runtime": me, "created": old }),
            json!({ "id": "dispatch-9", "status": "unknown", "runtime": me, "created": 120 }),
            json!({ "id": "dispatch-10", "status": "stopped", "terminal": 4, "runtime": me }),
        ];
        let live = |h: &str| h == "term-4";
        let kind = |i: usize, hook: Option<&str>| attention(&d[i], &live, hook, now).map(|(k, _)| k);
        // A person is needed: the pane's own hook state says so while the terminal is open.
        assert_eq!(kind(0, Some("approval")), Some("approval"));
        assert_eq!(kind(0, Some("input")), Some("input"));
        assert_eq!((kind(0, None), kind(0, Some("working"))), (None, None));
        // Failure; finishing well raises no flag, however old its last beat; a stop is no flag.
        assert_eq!(kind(1, None), Some("failure"));
        assert_eq!(kind(2, Some("input")), None);
        assert_eq!(kind(9, None), None);
        // A dead worker never looks healthy: its terminal is gone, its process ended before a done
        // report, or Kolux restarted under it. A stale hook record from the old process is ignored.
        assert_eq!(kind(3, Some("input")), Some("interruption"));
        assert_eq!(kind(4, None), Some("interruption"));
        assert_eq!(kind(5, Some("approval")), Some("interruption"));
        // Quiet past the staleness window: stale; a person-needed flag says more and comes first.
        assert_eq!(kind(6, None), Some("stale"));
        assert_eq!(kind(6, Some("approval")), Some("approval"));
        assert_eq!(kind(7, None), Some("stale"), "no beat at all: counted from when it was made");
        assert_eq!(kind(8, None), None, "a made-at that is no wall clock time proves nothing");
        let (_, why) = attention(&d[6], &live, None, now).unwrap();
        assert!(why.contains("10 minutes"), "{why}");
        // worker-show carries the flag.
        let tasks = vec![json!({ "id": "task-1", "status": "failed" })];
        let mut d2 = d.clone();
        d2[1]["runId"] = json!("run-1");
        let show = worker_show(&tasks, &d2, "dispatch-2", Some("run-1"), &live, None).unwrap();
        assert_eq!(show["attention"], "failure", "{show}");
        assert!(show["attentionWhy"].is_string());
        // A release that did not finish lists apart, with its saved output, error and way out.
        let half = vec![
            json!({ "id": "dispatch-1", "status": "completed", "terminal": 4, "runtime": me, "release": "pending", "archive": "a.log" }),
            json!({ "id": "dispatch-2", "status": "completed", "terminal": 4, "runtime": me, "release": "unknown", "releaseError": "close timed out" }),
        ];
        let rows = worker_list(&[], &half, None, "term-1", None, None, 10, &live).unwrap();
        let rows = rows["workers"].as_array().unwrap();
        assert_eq!((rows[0]["terminalState"].as_str(), rows[0]["archive"].as_str()), (Some("release_pending"), Some("a.log")));
        assert_eq!((rows[1]["terminalState"].as_str(), rows[1]["error"].as_str()), (Some("release_unknown"), Some("close timed out")));
        for r in rows {
            assert!(r["next"].as_str().unwrap().ends_with(&format!("worker-release --dispatch {}", r["dispatchId"].as_str().unwrap())), "{r}");
        }
    }

    #[test]
    fn orch066_a_worker_row_reads_as_its_task_never_its_brief() {
        let me = std::process::id();
        let b = |t: &Value| brief(t, &Brief { dispatch: "dispatch-1", run: Some("run-1"), coordinator: None, behind: None, levels_left: 0 });
        let named = json!({ "id": "task-1", "displayName": "Fix login", "title": "Login bug", "spec": "The login page loops" });
        let titled = json!({ "id": "task-2", "title": "Login bug", "spec": "The login page loops" });
        let bare = json!({ "id": "task-3", "spec": "The login page\n  loops after a\tsign-out and the cookie stays behind on every browser we tried" });
        let row = |t: &Value| worker_label(std::slice::from_ref(t), &json!({ "taskId": t["id"], "brief": b(t) }));
        // Display name, then title, then a one-line preview of the task text.
        assert_eq!(row(&named).as_deref(), Some("Fix login"));
        assert_eq!(row(&titled).as_deref(), Some("Login bug"));
        let preview = row(&bare).unwrap();
        assert!(preview.starts_with("The login page loops after a sign-out") && preview.chars().count() <= 60 && !preview.contains('\n'), "{preview}");
        // Before the task details arrive: the brief's task section, on many lines or folded onto one.
        let early = |brief: String| worker_label(&[], &json!({ "taskId": "task-9", "brief": brief }));
        assert_eq!(early(b(&titled)).as_deref(), Some("The login page loops"));
        assert_eq!(early(b(&titled).replace('\n', " ")).as_deref(), Some("The login page loops"));
        // Task text that imitates the divider cannot change the label.
        let sneaky = json!({ "id": "task-4", "spec": format!("Real work first\n{DIVIDER}\nEvil label") });
        assert!(early(b(&sneaky)).unwrap().starts_with("Real work first"));
        // No task section: nothing from the wrapper text.
        assert_eq!(early("You are a Kolux worker; report with kolux-dev orchestration send".into()), None);
        assert!(!row(&bare).unwrap().contains("Kolux worker"));
        // A terminal's row follows the task it is on now, never one left from an earlier task;
        // a terminal with no worker is not in the list, so it keeps its own prompt.
        let tasks = vec![json!({ "id": "task-1", "title": "Old task" }), json!({ "id": "task-2", "title": "New task" })];
        let d = vec![
            json!({ "id": "dispatch-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-2", "taskId": "task-2", "status": "running", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-3", "taskId": "task-1", "status": "completed", "terminal": 6, "runtime": me, "released": true }),
            json!({ "id": "dispatch-4", "taskId": "task-1", "status": "running", "terminal": 7, "runtime": me + 1 }),
        ];
        assert_eq!(labels_by_terminal(&tasks, &d), json!({ "term-4": "New task" }));
    }
    /// FIX-1 B1: splits an offered command line into words, a double-quoted word kept whole.
    fn words(n: &str) -> Vec<String> {
        let (mut out, mut cur, mut quoted) = (Vec::new(), String::new(), false);
        for c in n.chars() {
            match c {
                '"' => quoted = !quoted,
                c if c.is_whitespace() && !quoted => {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                }
                c => cur.push(c),
            }
        }
        if !cur.is_empty() {
            out.push(cur);
        }
        out
    }

    /// FIX-1 B1: runs a failed start's offered commands in order against the handlers they name,
    /// the way the CLI would; each must go through. Answers what each one did.
    fn run_way_out(tasks: &mut [Value], d: &mut [Value], next: &Value, run: Option<&str>) -> Vec<String> {
        let live = |_: &str| true;
        next.as_array().unwrap().iter().map(|n| {
            let n = n.as_str().unwrap();
            let w = words(n);
            assert_eq!(w[0], CLI, "{n}");
            let flag = |f: &str| w.iter().position(|x| x == f).map(|i| w[i + 1].clone()).unwrap_or_else(|| panic!("{n} has no {f}"));
            match (w[1].as_str(), w[2].as_str()) {
                ("orchestration", "worker-stop") => {
                    stop(tasks, d, &flag("--dispatch"), run, 10).unwrap_or_else(|e| panic!("{n}: {}", e.message));
                    "stopped".to_string()
                }
                ("orchestration", "worker-release") => {
                    release(d, &live, &flag("--dispatch"), run, 10).unwrap_or_else(|e| panic!("{n}: {}", e.message));
                    "released".to_string()
                }
                ("orchestration", "worker-start") => {
                    assert!(!n.contains("--retry-of"), "--retry-of is read by nothing: {n}");
                    start_check(tasks, &flag("--task"), run).unwrap_or_else(|e| panic!("{n}: {}", e.message));
                    "restartable".to_string()
                }
                ("worktree", "rm") => format!("rm {}", flag("--worktree")),
                _ => panic!("not a command the CLI has: {n}"),
            }
        }).collect()
    }

    #[test]
    fn orch017_the_way_out_of_a_failed_start_runs_in_order() {
        let me = std::process::id();
        let dispatched = || {
            let mut tasks = Vec::new();
            task_create(&mut tasks, &json!({ "spec": "a" }), Some("run-1".into()), 1).unwrap();
            tasks[0]["status"] = json!("dispatched");
            tasks[0]["dispatchId"] = json!("dispatch-1");
            tasks
        };
        let receipt = |terminals: Value| json!({ "dispatchId": "dispatch-1", "taskId": "task-1", "worktree": { "path": "C:/w/my otter", "created": true }, "terminals": terminals });
        // Timed out with no terminal seen: the task is still dispatched, so a retry on its own is
        // turned away; the stop that comes first frees it, and the worktree path survives a space.
        let mut tasks = dispatched();
        let mut d = vec![json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "unknown", "terminal": null, "runtime": me, "worktree": "C:/w/my otter" })];
        assert_eq!(start_check(&tasks, "task-1", Some("run-1")).unwrap_err().code, "failed");
        let mut r = receipt(json!([]));
        start_failed(&mut r, "worker", json!("not_configured"));
        assert_eq!(run_way_out(&mut tasks, &mut d, &r["next"], Some("run-1")), ["stopped", "restartable", "rm path:C:/w/my otter"]);
        assert_eq!(tasks[0]["status"], "ready");
        // A terminal was seen: the same order.
        let mut tasks = dispatched();
        let mut d = vec![json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "unknown", "terminal": 3, "runtime": me, "worktree": "C:/w/my otter" })];
        let mut r = receipt(json!([{ "id": 3, "role": "worker" }]));
        start_failed(&mut r, "worker", json!("not_configured"));
        assert_eq!(run_way_out(&mut tasks, &mut d, &r["next"], Some("run-1")), ["stopped", "restartable", "rm path:C:/w/my otter"]);
        // The setup script failed: the CLI records the task failed, which settles the worker, so
        // the release and then the retry both go through.
        let mut tasks = dispatched();
        let mut d = vec![json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "terminal": 3, "runtime": me, "worktree": "C:/w/my otter" })];
        task_update(&mut tasks, &mut d, "task-1", "failed", None, Some("run-1"), None, 5).unwrap();
        let mut s = receipt(json!([{ "id": 3, "role": "setup" }]));
        start_failed(&mut s, "setup", json!({ "result": "failed", "exitCode": 1 }));
        assert_eq!(run_way_out(&mut tasks, &mut d, &s["next"], Some("run-1")), ["released", "restartable", "rm path:C:/w/my otter"]);
    }

    #[test]
    fn orch022_a_stop_never_ends_a_terminal_that_is_not_the_workers_own() {
        let me = std::process::id();
        let task = |n: u32| json!({ "id": format!("task-{n}"), "runId": "run-1", "status": "dispatched", "dispatchId": format!("dispatch-{n}") });
        let mut tasks: Vec<Value> = (1..=5).map(task).collect();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me, "mode": "inject", "agent": "claude" }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "running", "terminal": 5, "runtime": me, "agent": "claude" }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "completed", "terminal": 5, "runtime": me, "retained": true, "agent": "claude" }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-4", "status": "running", "terminal": 6, "runtime": me, "agent": "claude" }),
            json!({ "id": "dispatch-5", "runId": "run-1", "taskId": "task-5", "status": "running", "terminal": 7, "runtime": me, "agent": "claude" }),
        ];
        // Handed a terminal that was already open: stopped, the terminal left running, and said so.
        let (r, kill) = stop(&mut tasks, &mut d, "dispatch-1", Some("run-1"), 5).unwrap();
        assert_eq!(kill, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("term-4 was already open"), "{r}");
        assert!(r["warning"].as_str().unwrap_or_default().contains("term-4"), "{r}");
        assert_eq!((r["status"].as_str(), tasks[0]["status"].as_str()), (Some("stopped"), Some("ready")));
        // Another worker keeps the same terminal on purpose: left open.
        let (r, kill) = stop(&mut tasks, &mut d, "dispatch-2", Some("run-1"), 6).unwrap();
        assert_eq!(kill, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("dispatch-3"), "{r}");
        // The terminal now runs another agent than the worker's: not the worker's to end.
        let agent_of = |h: &str| match h {
            "term-6" => Some(Some("codex".to_string())),
            "term-7" => Some(Some("claude".to_string())),
            _ => None,
        };
        let (r, kill) = stop_with(&mut tasks, &mut d, "dispatch-4", Some("run-1"), 7, &agent_of).unwrap();
        assert_eq!(kill, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("codex"), "{r}");
        // Its own terminal, running its own agent, is ended as before.
        let (r, kill) = stop_with(&mut tasks, &mut d, "dispatch-5", Some("run-1"), 8, &agent_of).unwrap();
        assert_eq!((kill, r["terminalLeftOpen"].is_null()), (Some(7), true), "{r}");
    }

    #[test]
    fn orch024_a_release_leaves_open_a_terminal_that_runs_something_else() {
        let me = std::process::id();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me, "agent": "claude" }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 5, "runtime": me, "agent": "claude" }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "completed", "terminal": 6, "runtime": me, "agent": "gemini" }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-4", "status": "completed", "terminal": 8, "runtime": me, "agent": "gemini", "launch": "reused_terminal" }),
        ];
        let live = |_: &str| true;
        let agent_of = |h: &str| match h {
            "term-4" => Some(Some("codex".to_string())),
            "term-5" => Some(Some("claude".to_string())),
            "term-6" => Some(None),
            _ => None,
        };
        // Another agent in it now: left open, and the receipt names what runs there.
        let (r, h) = release_with(&mut d, &live, "dispatch-1", Some("run-1"), 1, &agent_of).unwrap();
        assert_eq!(h, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("codex"), "{r}");
        // Its own agent: saved, then closed as usual.
        let (r, h) = release_with(&mut d, &live, "dispatch-2", Some("run-1"), 2, &agent_of).unwrap();
        assert_eq!((r["terminalState"].as_str(), h.as_deref()), (Some("release_pending"), Some("term-5")));
        // A plain shell where the worker's agent ran: a tab of the user's, left open.
        let (r, h) = release_with(&mut d, &live, "dispatch-3", Some("run-1"), 3, &agent_of).unwrap();
        assert_eq!(h, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("no agent"), "{r}");
        // Kolux cannot tell what runs there: it goes by its records, as before.
        let (_, h) = release_with(&mut d, &live, "dispatch-4", Some("run-1"), 4, &agent_of).unwrap();
        assert_eq!(h.as_deref(), Some("term-8"));
    }

    #[test]
    fn orch066_a_label_is_one_clean_short_line_whatever_the_task_names_hold() {
        let label = |t: Value| worker_label(std::slice::from_ref(&t), &json!({ "taskId": t["id"] })).unwrap();
        let clean = |l: &str| !l.chars().any(|c| c.is_control() || ('\u{200b}'..='\u{200f}').contains(&c) || ('\u{202a}'..='\u{202e}').contains(&c) || ('\u{2066}'..='\u{2069}').contains(&c));
        assert_eq!(label(json!({ "id": "task-1", "displayName": "Fix\nlogin\r\n\t now" })), "Fix login now");
        let esc = label(json!({ "id": "task-1", "displayName": "Fix \u{1b}[31mred\u{1b}[0m login\u{7}" }));
        assert_eq!(esc, "Fix red login");
        let c1 = label(json!({ "id": "task-1", "title": "a\u{9b}b\u{85}c\u{7f}d\u{202e}e\u{200b}f" }));
        assert!(clean(&c1) && c1.contains('a') && c1.contains('f'), "{c1:?}");
        let long = label(json!({ "id": "task-1", "title": "word ".repeat(200) }));
        assert!(long.chars().count() <= 60, "{}", long.chars().count());
        // A name that is nothing but control characters falls through to the next one.
        assert_eq!(label(json!({ "id": "task-1", "displayName": "\u{1b}[0m\n", "title": "Real title" })), "Real title");
    }

    #[test]
    fn orch067_a_brief_carries_one_dispatch_pass_in_every_ready_made_command_and_none_without_one() {
        let task = json!({ "id": "task-4", "spec": "Fix it." });
        let b = Brief { dispatch: "dispatch-7", run: Some("run-2"), coordinator: Some("term-1"), behind: None, levels_left: 1 };
        let with = brief_tied(&task, &b, Some("p4ss-abc"));
        let cmds: Vec<&str> = with.lines().filter(|l| l.contains(" orchestration send ")).collect();
        assert_eq!(cmds.len(), 4, "{with}");
        for l in &cmds {
            assert!(l.contains("--dispatch-capability p4ss-abc") && l.contains("--dispatch-id dispatch-7"), "{l}");
        }
        // Only inside the commands, never as a field or line of its own.
        assert_eq!(with.matches("p4ss-abc").count(), 4, "{with}");
        let without = brief(&task, &b);
        assert!(!without.contains("--dispatch-capability"), "{without}");
        assert_eq!(brief_tied(&task, &b, None), without);
    }

    #[test]
    fn orch067_b_a_report_without_the_pass_is_mail_only_and_the_right_pass_settles() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "work", 1)["run"]["id"].as_str().unwrap().to_string();
        let d = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": std::process::id(), "pass": "secret-1" })];
        let to = format!("run:{run}");
        let tasks = || vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })];
        let live = |_: &str| true;
        for wrong in [json!({}), json!({ "dispatchCapability": "secret-2" }), json!({ "dispatchCapability": "  " })] {
            let mut a = json!({ "to": to, "subject": "task-1 done", "type": "worker_done", "outcome": "succeeded", "taskId": "task-1", "dispatchId": "dispatch-1" });
            a.as_object_mut().unwrap().extend(wrong.as_object().unwrap().clone());
            let (mut t, mut dd) = (tasks(), d.clone());
            // The mail still goes; the task does not move; the reply names the option.
            assert!(m.send("term-2", &a, &d, &live, 2).is_ok());
            let no = report(&mut t, &mut dd, "term-2", &a, 2, &|_| None).unwrap();
            assert_eq!(no["settles"], false, "{no}");
            assert!(no["why"].as_str().unwrap().contains(PASS_OPTION), "{no}");
            assert_eq!(t[0]["status"], "dispatched");
        }
        let beat = json!({ "to": to, "subject": "b", "type": "heartbeat", "dispatchId": "dispatch-1" });
        let (mut t, mut dd) = (tasks(), d.clone());
        assert_eq!(report(&mut t, &mut dd, "term-2", &beat, 3, &|_| None).unwrap()["settles"], false);
        assert!(dd[0].get("lastBeatAt").is_none());
        let ok = json!({ "to": to, "subject": "task-1 done", "type": "worker_done", "outcome": "succeeded", "taskId": "task-1", "dispatchId": "dispatch-1", "dispatchCapability": "secret-1" });
        let (mut t, mut dd) = (tasks(), d.clone());
        let yes = report(&mut t, &mut dd, "term-2", &ok, 4, &|_| None).unwrap();
        assert_eq!(t[0]["status"], "completed", "{yes}");
        // A dispatch without a pass (the low-level dispatch command) is tied to its pane as before.
        let mut plain = d.clone();
        plain[0].as_object_mut().unwrap().remove("pass");
        let (mut t, mut dd) = (tasks(), plain);
        report(&mut t, &mut dd, "term-2", &json!({ "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-1", "subject": "s" }), 5, &|_| None).unwrap();
        assert_eq!(t[0]["status"], "completed");
    }

    /// Row 211: an agent restarted in the same pane keeps the handle but is a new process; the old pass is dead.
    #[test]
    fn orch067_e_a_pass_minted_for_an_earlier_process_of_the_pane_settles_nothing() {
        let run = "run-1";
        let fresh = || vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": std::process::id(), "pass": "secret-1", PASS_GENERATION: 3 })];
        let mut d = fresh();
        let tasks = || vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })];
        let done = json!({ "type": "worker_done", "outcome": "succeeded", "taskId": "task-1", "dispatchId": "dispatch-1", "subject": "s", "dispatchCapability": "secret-1" });
        // The pane has restarted its process (generation 4): the right pass is refused, nothing moves.
        let mut t = tasks();
        let no = report(&mut t, &mut d, "term-2", &done, 2, &|term| (term == 2).then_some(4)).unwrap();
        assert_eq!((no["settles"].clone(), no["code"].clone()), (json!(false), json!("stale_pass")), "{no}");
        let why = no["why"].as_str().unwrap();
        assert!(why.contains("earlier process") && why.contains("dispatch-1"), "{why}");
        assert_eq!(t[0]["status"], "dispatched");
        let beat = json!({ "type": "heartbeat", "dispatchId": "dispatch-1", "subject": "b", "dispatchCapability": "secret-1" });
        assert_eq!(report(&mut t, &mut d, "term-2", &beat, 3, &|_| Some(4)).unwrap()["code"], "stale_pass");
        assert!(d[0].get("lastBeatAt").is_none());
        // The same process still runs: the pass settles.
        let mut t = tasks();
        let mut d = fresh();
        report(&mut t, &mut d, "term-2", &done, 4, &|_| Some(3)).unwrap();
        assert_eq!(t[0]["status"], "completed");
        // A pane that cannot say (or a dispatch from before the stamp) is not turned away.
        let (mut t, mut d) = (tasks(), fresh());
        report(&mut t, &mut d, "term-2", &done, 5,&|_| None).unwrap();
        assert_eq!(t[0]["status"], "completed");
        let mut d = fresh();
        d[0].as_object_mut().unwrap().remove(PASS_GENERATION);
        let mut t = tasks();
        report(&mut t, &mut d, "term-2", &done, 6, &|_| Some(9)).unwrap();
        assert_eq!(t[0]["status"], "completed");
    }

    #[test]
    fn orch067_c_a_question_with_a_wrong_or_missing_pass_is_turned_away_before_it_is_made() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let peers = vec![peer("term-1", Some("claude"), true, "G:/r"), peer("term-2", Some("claude"), true, "G:/r/w"), peer("term-3", Some("claude"), true, "G:/r/v")];
        let me = std::process::id();
        let d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": me, "pass": "secret-1" }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-2", "status": "running", "terminal": 3, "runtime": me }),
        ];
        let to = format!("run:{run}");
        let before = m.messages.len();
        for wrong in [json!({}), json!({ "dispatchCapability": "secret-9" })] {
            let mut a = json!({ "question": "tabs or spaces?", "to": to });
            a.as_object_mut().unwrap().extend(wrong.as_object().unwrap().clone());
            let e = m.ask("term-2", &a, &d, &peers, 2).unwrap_err();
            assert!(e.message.contains(PASS_OPTION) && e.message.contains("no question was made"), "{}", e.message);
        }
        assert_eq!(m.messages.len(), before);
        let q = m.ask("term-2", &json!({ "question": "tabs?", "to": to, "dispatchCapability": "secret-1" }), &d, &peers, 3).unwrap();
        assert_eq!(q["status"], "open", "{q}");
        // A worker without a pass asks as before; a resume needs none.
        assert_eq!(m.ask("term-3", &json!({ "question": "spaces?", "to": to }), &d, &peers, 4).unwrap()["status"], "open");
        let id = q["messageId"].as_str().unwrap().to_string();
        assert_eq!(m.ask("term-2", &json!({ "resume": id }), &d, &peers, 5).unwrap()["status"], "open");
    }

    #[test]
    fn orch067_d_every_read_of_worker_output_hides_the_pass_and_says_so() {
        let passes = passes(&[json!({ "id": "dispatch-1", "pass": "s3cret" }), json!({ "id": "dispatch-2" }), json!({ "id": "dispatch-3", "pass": "" })]);
        assert_eq!(passes, vec!["s3cret".to_string()]);
        let mut out = json!({ "terminal": "term-2", "lines": [{ "cursor": 1, "text": "kolux orchestration send --dispatch-capability s3cret" }], "pending": "> typing s3cret", "rows": ["s3cret s3cret"], "warnings": ["older"] });
        redact_read(&mut out, &passes);
        assert!(!out.to_string().contains("s3cret"), "{out}");
        assert_eq!(out["lines"][0]["text"], format!("kolux orchestration send --dispatch-capability {PASS_HIDDEN}"));
        assert_eq!(out["rows"][0], format!("{PASS_HIDDEN} {PASS_HIDDEN}"));
        assert_eq!(out["warnings"].as_array().unwrap().len(), 2, "{out}");
        assert!(out["warnings"][1].as_str().unwrap().contains("hidden"), "{out}");
        let mut clean = json!({ "lines": [{ "text": "hello" }] });
        redact_read(&mut clean, &passes);
        assert!(clean["warnings"].is_null(), "{clean}");
        let lines = redact_lines(vec!["a".into(), "pass s3cret here".into()], &passes);
        assert_eq!(lines[1], format!("pass {PASS_HIDDEN} here"));
        assert!(lines.len() == 3 && lines[2].contains("hidden"), "{lines:?}");
        assert_eq!(redact_lines(vec!["a".into()], &passes), vec!["a".to_string()]);
    }

    #[test]
    fn orch036_typing_into_a_workers_terminal_takes_it_over_so_release_and_stop_leave_it_open() {
        let me = std::process::id();
        let now = wall_ms();
        // The user typed into terminal 3636 now: dispatch-1 was made before that, dispatch-2 after.
        sendonce::other_writer(3636, "x");
        let typed = wall_ms();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 3636, "runtime": me, "agent": "claude", "created": now.saturating_sub(10_000) }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 3636, "runtime": me, "agent": "claude", "created": typed + 10_000 }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "running", "terminal": 3637, "runtime": me, "agent": "claude", "created": now.saturating_sub(10_000) }),
        ];
        let live = |_: &str| true;
        let agent_of = |_: &str| Some(Some("claude".to_string()));
        let (r, h) = release_with(&mut d, &live, "dispatch-1", Some("run-1"), 1, &agent_of).unwrap();
        assert_eq!(h, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap().contains("taken over"), "{r}");
        assert_eq!(r["terminalState"], "released");
        // Made after the typing, and dispatch-1's claim is released: the worker's own, so it closes.
        let (r, h) = release_with(&mut d, &live, "dispatch-2", Some("run-1"), 2, &agent_of).unwrap();
        assert_eq!(h.as_deref(), Some("term-3636"), "{r}");
        // A stop leaves a taken-over terminal running and says so; the task is freed all the same.
        sendonce::other_writer(3637, "y");
        let mut tasks = vec![json!({ "id": "task-3", "runId": "run-1", "status": "dispatched", "dispatchId": "dispatch-3" })];
        let (r, kill) = stop_with(&mut tasks, &mut d, "dispatch-3", Some("run-1"), 3, &agent_of).unwrap();
        assert_eq!(kill, None, "{r}");
        assert!(r["terminalLeftOpen"].as_str().unwrap().contains("taken over") && r["process"] == "unverifiable", "{r}");
        assert_eq!(tasks[0]["status"], "ready");
        // A terminal nobody typed into is nobody's but the worker's.
        assert!(!sendonce::taken_over_since(3638, 0));
    }
}
