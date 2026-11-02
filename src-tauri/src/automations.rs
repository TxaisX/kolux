//! Automations (area 09): a saved prompt plus an agent that Kolux launches by itself. The list
//! and every automation's numbered runs live in the state store (`automations`,
//! `automations.runs`) as JSON rows, so the importer and the command line read the same shape.
//! T-086 gives the page its list, Run now, pause / resume and delete (AUTO-016, AUTO-019); T-085-a
//! the create / edit dialog's save and the timetable with its clock (AUTO-001, AUTO-005); event
//! triggers and the self-closing run tab are T-085-b (AUTO-004, AUTO-011), truthful completion
//! T-072 (AUTO-012). T-175: the grace window for a missed run (AUTO-007), the 100-run history cap
//! (AUTO-021) and refusing a target that is not ready (AUTO-022).

use crate::git::{Git, Worktree};
use crate::projects;
use crate::schedule;
use crate::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub mod carry;

pub const KEY: &str = "automations";
pub const RUNS_KEY: &str = "automations.runs";
/// Told to the window whenever an automation or a run changes, so an open page updates itself.
pub const EVENT: &str = "automations-changed";
/// AUTO-007: how late a missed run may still start, in minutes; 0 is no grace.
pub const GRACE_MINUTES: [u64; 7] = [0, 30, 60, 180, 720, 1440, 2880];
/// AUTO-021: the runs each automation keeps.
const KEEP_RUNS: usize = 100;
/// A due time older than this was missed, not merely caught late by the half-minute clock.
const ON_TIME_MS: i64 = 120_000;
/// AUTO-004: what an event trigger can listen for, and how long an automation rests after an
/// event has started a run.
const EVENTS: [&str; 3] = ["pr-opened", "checks-failed", "agent-finished"];
const EVENT_REST_MS: i64 = 5 * 60_000;
/// AUTO-008: how long a precheck may take, in seconds; the first is the default.
pub const PRECHECK_SECONDS: [u64; 4] = [60, 120, 300, 600];
/// The end of a precheck's output kept with its skipped run.
const KEEP_OUTPUT: usize = 4000;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Reads a list. A value that is there but will not parse is an error, never an empty list:
/// AUTO-016 says a failed load must not claim that nothing was created.
fn load(store: &Store, key: &str) -> Result<Vec<Value>, String> {
    match store.get(key).map_err(|e| e.to_string())? {
        None => Ok(Vec::new()),
        Some(text) => serde_json::from_str::<Vec<Value>>(&text).map_err(|e| format!("the saved automations could not be read ({e})")),
    }
}

fn save(store: &Store, key: &str, list: &[Value]) -> Result<(), String> {
    store.set(key, &Value::Array(list.to_vec()).to_string()).map_err(|e| e.to_string())
}

/// T-140-d: a run's saved output (a screen's 16 KB, a precheck's 4 KB) lives in its own key, out of
/// the runs list that every hook status reads and writes; the row only says it has some.
fn output_key(run_id: &str) -> String {
    format!("automations.output.{run_id}")
}

/// Does this run already have saved output (in its own key, or inline from before T-140-d)?
fn has_output(r: &Value) -> bool {
    r["outputSaved"] == true || r.get("output").is_some_and(|o| !o.is_null())
}

/// May this run still take its final output? Yes with none saved, and yes when what it holds is
/// the replay a restart put there (T-085-h): the finish's own text replaces it.
fn output_open(r: &Value) -> bool {
    !has_output(r) || r["outputFrom"] == "replay"
}

/// Moves a row's inline `output` into its own key and leaves `outputSaved` in its place.
fn stash_output(store: &Store, row: &mut Value) -> Result<(), String> {
    let Some(text) = row.get("output").and_then(Value::as_str).map(String::from) else { return Ok(()) };
    let id = row["id"].as_str().unwrap_or_default().to_string();
    store.set(&output_key(&id), &json!(text).to_string()).map_err(|e| e.to_string())?;
    if let Some(r) = row.as_object_mut() {
        r.remove("output");
        r.insert("outputSaved".into(), json!(true));
    }
    Ok(())
}

/// A row with its saved output put back on it, for the page.
fn with_output(store: &Store, mut row: Value) -> Value {
    if row["outputSaved"] == true {
        let text = row["id"].as_str().and_then(|id| store.get(&output_key(id)).ok().flatten()).and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(Value::is_string);
        if let Some(t) = text {
            row["output"] = t;
        }
    }
    row
}

/// The saved output of runs that are gone is cleared with them.
// ponytail: the store has no delete, so a cleared key stays as a 4-byte "null" row; add
// Store::remove if those ever add up.
fn drop_outputs(store: &Store, ids: &[String]) -> Result<(), String> {
    let keys: Vec<String> = ids.iter().map(|id| output_key(id)).collect();
    let pairs: Vec<(&str, &str)> = keys.iter().map(|k| (k.as_str(), "null")).collect();
    store.set_all(&pairs).map_err(|e| e.to_string())
}

/// Every automation and every run, for the page. Each automation also carries its timetable in
/// words, when it goes next in words, and the preset, time and day the dialog opens with.
pub fn list(store: &Store) -> Result<Value, String> {
    let now = now_ms() as i64;
    let autos: Vec<Value> = load(store, KEY)?
        .into_iter()
        .map(|a| {
            let why = problem(store, &a).map(|p| p.1);
            let mut a = decorate(a, now);
            a["problem"] = json!(why);
            a
        })
        .collect();
    Ok(match load(store, RUNS_KEY) {
        Ok(runs) => {
            // AUTO-013: a run whose worktree folder is gone opens its saved output instead.
            let runs: Vec<Value> = runs
                .into_iter()
                .map(|r| {
                    let mut r = with_output(store, r);
                    if r["worktree"].as_str().is_some_and(|w| !Path::new(w).exists()) {
                        r["worktreeGone"] = json!(true);
                    }
                    r
                })
                .collect();
            json!({ "automations": autos, "runs": runs })
        }
        Err(e) => json!({ "automations": autos, "runs": [], "runsError": e.replace("automations", "runs") }),
    })
}

fn decorate(mut a: Value, now: i64) -> Value {
    if a["trigger"]["kind"] != "schedule" {
        return a;
    }
    let line = a["trigger"]["cron"].as_str().unwrap_or_default().to_string();
    let tz = a["trigger"]["timezone"].as_str().unwrap_or_default().to_string();
    a["timetable"] = json!(schedule::describe(&line, &tz));
    if let (Some(at), Ok(zone)) = (a["nextRunAt"].as_i64(), schedule::zone(&tz)) {
        a["nextRunLabel"] = json!(schedule::when(at, now, &zone));
    }
    let (preset, time, day) = schedule::classify(&line).unwrap_or(("custom", String::new(), None));
    a["form"] = json!({ "preset": preset, "time": time, "day": day, "custom": if preset == "custom" { line } else { String::new() } });
    a
}

/// The machine's own zone, for a timetable saved without one.
fn local_zone() -> String {
    jiff::tz::TimeZone::system().iana_name().unwrap_or("UTC").to_string()
}

/// AUTO-001: what the dialog asks for (`preset` hourly, daily, weekdays, weekly or custom, with
/// `time` HH:MM, `day` 0-6 from Sunday, `custom` a cron line or RRULE, and `timezone`), checked
/// and turned into the saved trigger plus its upcoming run. A line that is malformed, too long or
/// can never come true is refused here, so it is refused when saving.
pub fn preview(input: &Value, now: i64) -> Result<Value, String> {
    let tz = input["timezone"].as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from).unwrap_or_else(local_zone);
    let zone = schedule::zone(&tz)?;
    let preset = input["preset"].as_str().unwrap_or("custom");
    let line = match preset {
        "custom" => schedule::normalize(input["custom"].as_str().unwrap_or_default()),
        p => schedule::preset_line(p, input["time"].as_str().unwrap_or_default(), input["day"].as_u64().map(|d| d as u8))?,
    };
    let next = schedule::parse(&line)?.next_after(now, &zone).ok_or("this timetable can never come true; no run falls in the next eight years")?;
    Ok(json!({ "trigger": { "kind": "schedule", "cron": line, "timezone": tz }, "timetable": schedule::describe(&line, &tz), "nextRunAt": next, "nextRunLabel": schedule::when(next, now, &zone) }))
}

/// The upcoming run of a saved automation from `now`, or none when it waits for events or its
/// timetable no longer reads.
fn next_run(a: &Value, now: i64) -> Option<i64> {
    let t = &a["trigger"];
    if t["kind"] != "schedule" {
        return None;
    }
    schedule::parse(t["cron"].as_str()?).ok()?.next_after(now, &schedule::zone(t["timezone"].as_str()?).ok()?)
}

/// After every run, and on resume, the upcoming time is worked out again from now, so an old time
/// is never mistaken for a missed one.
fn reschedule(store: &Store, id: &str, now: i64) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all[i]["nextRunAt"] = json!(next_run(&all[i], now));
    save(store, KEY, &all)
}

/// AUTO-005: creates (no `id`) or edits an automation from the dialog. A create sent twice with
/// one `requestId` leaves one automation. Everything is checked before anything is written.
pub fn save_automation(store: &Store, input: &Value, now: i64) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let request = input["requestId"].as_str().unwrap_or_default();
    if let Some(same) = all.iter().find(|a| !request.is_empty() && a["requestId"] == request) {
        return Ok(decorate(same.clone(), now));
    }
    let text = |k: &str| input[k].as_str().map(str::trim).unwrap_or_default().to_string();
    let name = text("name");
    if name.is_empty() {
        return Err("give the automation a name".into());
    }
    if text("prompt").is_empty() {
        return Err("write the prompt the agent starts with".into());
    }
    let provider = text("provider");
    if !["claude", "codex", "gemini"].contains(&provider.as_str()) {
        return Err("choose the agent: Claude Code, Codex or Gemini".into());
    }
    let project_id = text("projectId");
    let project = projects::load_projects(store).into_iter().find(|p| p.id == project_id).ok_or("choose a project that is in Kolux")?;
    let mode = text("workspaceMode");
    let workspace = match mode.as_str() {
        "existing" => {
            let w = text("workspace");
            let w = if w.is_empty() { project.path.clone() } else { w };
            if !Path::new(&w).is_dir() {
                return Err(format!("the workspace {w} is not there"));
            }
            json!(w)
        }
        "new-per-run" => Value::Null,
        _ => return Err("choose an existing workspace or a new one for every run".into()),
    };
    // AUTO-004: an event trigger has no timetable; going back to Schedule works the run out afresh.
    let timing = match input["trigger"]["kind"].as_str() {
        Some("event") => {
            let event = input["trigger"]["event"].as_str().unwrap_or_default();
            if !EVENTS.contains(&event) {
                return Err("choose the event: a pull request opens, checks fail, or an agent finishes".into());
            }
            json!({ "trigger": { "kind": "event", "event": event }, "nextRunAt": null })
        }
        _ => preview(&input["schedule"], now)?,
    };
    let g = &input["missedRunGraceMinutes"];
    let grace = match g.is_null() {
        true => None,
        false => Some(g.as_u64().or_else(|| g.as_str()?.trim().parse().ok()).filter(|g| GRACE_MINUTES.contains(g)).ok_or("a missed run may start late by none, 30 minutes, or 1, 3, 12, 24 or 48 hours")?),
    };
    let id = text("id");
    let i = if id.is_empty() {
        let n = all.iter().filter_map(|a| a["id"].as_str()?.strip_prefix("auto-")?.parse::<u64>().ok()).max().unwrap_or(0) + 1;
        all.push(json!({ "id": format!("auto-{n}"), "enabled": true, "requestId": request }));
        all.len() - 1
    } else {
        position(&all, &id)?
    };
    let grace = grace.unwrap_or_else(|| all[i]["missedRunGraceMinutes"].as_u64().unwrap_or(0));
    let t = &input["precheckTimeoutSeconds"];
    let limit = match t.is_null() {
        true => all[i]["precheckTimeoutSeconds"].as_u64().unwrap_or(PRECHECK_SECONDS[0]),
        false => t.as_u64().or_else(|| t.as_str()?.trim().parse().ok()).filter(|t| PRECHECK_SECONDS.contains(t)).ok_or("a precheck may take 1, 2, 5 or 10 minutes")?,
    };
    // Empty clears the precheck; left out on an edit keeps the old one.
    let precheck = match input["precheck"].is_null() {
        true => all[i]["precheck"].as_str().unwrap_or_default().to_string(),
        false => text("precheck"),
    };
    let reuse = input["reuseSession"].as_bool().unwrap_or(mode == "existing" && all[i]["reuseSession"] == true);
    if reuse && mode != "existing" {
        return Err("a session can only be kept across runs in an existing worktree".into());
    }
    let row = &mut all[i];
    let enabled = input["enabled"].as_bool().unwrap_or(row["enabled"].as_bool().unwrap_or(true));
    for (k, v) in [
        ("name", json!(name)),
        ("prompt", input["prompt"].clone()),
        ("provider", json!(provider)),
        ("projectId", json!(project_id)),
        ("workspaceMode", json!(mode)),
        ("workspace", workspace),
        // Empty means the project's default branch (AUTO-005).
        ("baseBranch", json!(text("baseBranch"))),
        // AUTO-010: only a new worktree runs the project setup, and only when chosen.
        ("runSetup", json!(mode == "new-per-run" && input["runSetup"].as_bool().unwrap_or(false))),
        // AUTO-009: continuing in the last run's session is only for an existing worktree; left out
        // on an edit keeps the old choice.
        ("reuseSession", json!(reuse)),
        ("trigger", timing["trigger"].clone()),
        ("nextRunAt", timing["nextRunAt"].clone()),
        ("missedRunGraceMinutes", json!(grace)),
        ("precheck", json!(precheck)),
        ("precheckTimeoutSeconds", json!(limit)),
        ("enabled", json!(enabled)),
    ] {
        row[k] = v;
    }
    let out = row.clone();
    save(store, KEY, &all)?;
    Ok(decorate(out, now))
}

/// The clock (AUTO-001): starts every switched-on timed automation whose time has come. A paused
/// automation, or one waiting for events, is never started by it. AUTO-007: when Kolux was away
/// at the due time, the run still starts if the most recent due time is inside its grace window;
/// past it, one skipped entry says Kolux was not available and the timetable moves on, so a pile
/// of missed runs is never replayed. Returns the runs it began or logged.
pub fn tick(l: &Launch, now: i64) -> Result<Vec<Value>, String> {
    let due: Vec<Value> = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        load(&store, KEY)?.into_iter().filter(|a| a["enabled"] == true && a["trigger"]["kind"] == "schedule" && a["nextRunAt"].as_i64().is_some_and(|at| at <= now)).collect()
    };
    let mut started = Vec::new();
    for a in due {
        let id = a["id"].as_str().unwrap_or_default().to_string();
        let window = (a["missedRunGraceMinutes"].as_u64().unwrap_or(0) as i64 * 60_000).max(ON_TIME_MS);
        // Is there a due time between the window's start and now? Then the latest one is in it.
        if next_run(&a, now - window - 1).is_some_and(|t| t <= now) {
            started.push(run(l, &id, "schedule")?);
        } else {
            let store = l.store.lock().map_err(|e| e.to_string())?;
            started.push(skip(&store, &id, "schedule", "missed", "Kolux was not available at the due time, and the grace window has passed")?);
            reschedule(&store, &id, now)?;
            (l.notify)(EVENT, json!({ "id": id }));
        }
    }
    Ok(started)
}

/// AUTO-004: the folders whose pull request went from none to open since the last poll, drafts
/// included. The first state learned about a folder is only a starting point, so opening Kolux
/// never sets off a burst of runs; a failed lookup is no news, and a hand-linked pull request
/// (GIT-025) is not one opened from the branch.
pub fn pr_opened(seen: &mut std::collections::HashMap<String, bool>, polled: &[crate::scm::PolledPr]) -> Vec<(String, crate::scm::Pr)> {
    let mut out = Vec::new();
    for p in polled.iter().filter(|p| p.error.is_none() && !p.linked) {
        let open = p.pr.as_ref().filter(|pr| pr.state.eq_ignore_ascii_case("open"));
        if seen.insert(projects::name_key(&p.path), open.is_some()) == Some(false) {
            out.extend(open.map(|pr| (p.path.clone(), pr.clone())));
        }
    }
    out
}

/// AUTO-004: a happening in the worktree at `path` starts every switched-on automation of that
/// repo that listens for it, with `line` on the end of its prompt. Once an event has started a
/// run the automation ignores further events for five minutes, and a worktree an automation made
/// never sets one off, so no automation triggers itself. The run lands in the workspace the
/// automation names, not where the event came from. Returns the runs it began.
pub fn on_event(l: &Launch, event: &str, path: &str, line: &str, now: i64) -> Result<Vec<Value>, String> {
    let ids: Vec<String> = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        let mut all = load(&store, KEY)?;
        let projects = projects::load_projects(&store);
        let from_here = |a: &Value| {
            let Some(project) = projects.iter().find(|p| a["projectId"] == p.id.as_str()) else { return false };
            let listed = projects::list_workspaces(l.git, &store, project).unwrap_or_default();
            listed.iter().any(|w| projects::same_folder(Path::new(&w.path), Path::new(path)) && w.made_by.as_deref() != Some("automation"))
        };
        let ids: Vec<String> = all
            .iter()
            .filter(|a| a["enabled"] == true && a["trigger"]["kind"] == "event" && a["trigger"]["event"] == event)
            .filter(|a| a["lastEventAt"].as_i64().is_none_or(|t| now - t >= EVENT_REST_MS))
            .filter(|a| from_here(a))
            .filter_map(|a| a["id"].as_str().map(String::from))
            .collect();
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        for a in all.iter_mut().filter(|a| ids.iter().any(|id| a["id"] == id.as_str())) {
            a["lastEventAt"] = json!(now);
        }
        save(&store, KEY, &all)?;
        ids
    };
    ids.iter().map(|id| run_with(l, id, "event", Some(line))).collect()
}

/// AUTO-004: fed every round of the window's pull request poll (GIT-027), so a new pull request
/// is spotted only while Kolux is already polling that branch.
pub fn on_poll(app: &tauri::AppHandle, polled: &[crate::scm::PolledPr]) {
    static SEEN: std::sync::OnceLock<Mutex<std::collections::HashMap<String, bool>>> = std::sync::OnceLock::new();
    let opened = pr_opened(&mut SEEN.get_or_init(Default::default).lock().unwrap_or_else(std::sync::PoisonError::into_inner), polled);
    for (path, pr) in opened {
        let line = format!("Event: pull request #{} opened from {}: {} {}", pr.number, pr.head.as_deref().unwrap_or("its branch"), pr.title.as_deref().unwrap_or("(no title)"), pr.url);
        if let Err(e) = launch_for(app, |l| on_event(l, "pr-opened", &path, &line, now_ms() as i64)) {
            eprintln!("automations event: {e}");
        }
    }
}

/// AUTO-004 (T-085-d): the saved checks state of each open pull request, `<folder>#<number>` to the
/// checks word (GIT-043: passing, running or failing). It lives in the store so that a restart
/// does not see "failing" as a new state and fire a second time.
const CHECKS_SEEN_KEY: &str = "automations.checksSeen";

/// AUTO-004 (T-085-d): the open pull requests whose checks went from pending (or passing) to
/// failing since the last round. `checks` is the poll round's checks word per folder (GIT-043's
/// words, from the scm module). The first state learned about a pull request is only a starting
/// point; an unresolved or missing reading is no news and keeps the last known state; red checks
/// that stay red do not fire again; a pull request that closed or was replaced is forgotten.
pub fn checks_failed(seen: &mut std::collections::HashMap<String, String>, polled: &[crate::scm::PolledPr], checks: &std::collections::HashMap<String, String>) -> Vec<(String, crate::scm::Pr)> {
    let mut out = Vec::new();
    for p in polled.iter().filter(|p| p.error.is_none()) {
        let folder = projects::name_key(&p.path);
        let open = p.pr.as_ref().filter(|pr| pr.state.eq_ignore_ascii_case("open"));
        let current = open.map(|pr| format!("{folder}#{}", pr.number));
        seen.retain(|k, _| !(k.rsplit_once('#').is_some_and(|(f, _)| f == folder) && Some(k) != current.as_ref()));
        let (Some(pr), Some(key)) = (open, current) else { continue };
        let Some(word) = checks.get(&p.path).map(String::as_str).filter(|w| matches!(*w, "passing" | "running" | "failing")) else { continue };
        if seen.insert(key, word.to_string()).is_some_and(|before| before != "failing") && word == "failing" {
            out.push((p.path.clone(), pr.clone()));
        }
    }
    out
}

/// AUTO-004 (T-085-d): one round's checks readings through the saved state; returns what to fire.
pub fn checks_round(store: &Store, polled: &[crate::scm::PolledPr], checks: &std::collections::HashMap<String, String>) -> Result<Vec<(String, crate::scm::Pr)>, String> {
    let mut seen: std::collections::HashMap<String, String> = crate::orchestration::kept::load(store, CHECKS_SEEN_KEY)?;
    let before = seen.clone();
    let fired = checks_failed(&mut seen, polled, checks);
    if seen != before {
        store.set(CHECKS_SEEN_KEY, &serde_json::to_string(&seen).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(fired)
}

/// AUTO-004 (T-085-d): is any switched-on automation listening for this event? The poll looks up
/// checks only while one is, so no automation means no extra GitHub calls.
pub fn listens(app: &tauri::AppHandle, event: &str) -> bool {
    launch_for(app, |l| {
        let store = l.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        load(&store, KEY).unwrap_or_default().iter().any(|a| a["enabled"] == true && a["trigger"]["kind"] == "event" && a["trigger"]["event"] == event)
    })
}

/// AUTO-004 (T-085-d): fed every poll round with the checks word of each open pull request, so a
/// pull request whose checks just failed starts the automations listening for "checks failed".
pub fn on_checks(app: &tauri::AppHandle, polled: &[crate::scm::PolledPr], checks: &std::collections::HashMap<String, String>) {
    let fired = launch_for(app, |l| {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        checks_round(&store, polled, checks)
    });
    match fired {
        Ok(list) => {
            for (path, pr) in list {
                let line = format!("Event: checks failed on pull request #{} from {}: {} {}", pr.number, pr.head.as_deref().unwrap_or("its branch"), pr.title.as_deref().unwrap_or("(no title)"), pr.url);
                if let Err(e) = launch_for(app, |l| on_event(l, "checks-failed", &path, &line, now_ms() as i64)) {
                    eprintln!("automations event: {e}");
                }
            }
        }
        Err(e) => eprintln!("automations event: {e}"),
    }
}

/// AUTO-004 (T-085-e): does this pane's agent status count as "agent finished"? Only an ordinary
/// completion counts: the lead agent reached done after it was seen at work in this process. A
/// done reported at a session boundary (start, resume, clear), an interrupted turn, a sub-agent's
/// finish, and a done with no work seen first (a restored pane never confirmed by its hooks, or
/// a ready prompt already on screen) never count. Fires once: the work seen is spent by the
/// finish, so the same done reported again, or a later done with no new work, does not fire.
/// `seen` holds, per pane, whether work has been seen since the last finish or boundary.
pub fn agent_finished(seen: &mut std::collections::HashMap<u32, bool>, pane_key: u32, state: &str, boundary: bool, child: bool, interrupted: bool) -> bool {
    if child {
        return false;
    }
    if boundary {
        seen.remove(&pane_key);
        return false;
    }
    match state {
        "working" | "permission" | "waiting" => {
            seen.insert(pane_key, true);
            false
        }
        "done" if !interrupted => seen.insert(pane_key, false) == Some(true),
        "done" | "interrupted" => {
            seen.insert(pane_key, false);
            false
        }
        _ => false,
    }
}

/// AUTO-004: a pane an automation run opened (followed as its terminal or hook pane, now or
/// earlier) never sets off an automation, so no automation can trigger itself.
pub fn own_pane(runs: &[Value], terminal: Option<u32>, pane_key: u32) -> bool {
    runs.iter().any(|r| terminal.is_some_and(|t| r["terminal"] == t || r["lastTerminal"] == t) || r["paneKey"] == pane_key || r["lastPaneKey"] == pane_key)
}

/// AUTO-004: fed with every status the panes' hooks report (hooks.rs hands `on_status` the same
/// readings). When the reading is an ordinary finish in a pane no automation opened, the
/// automations of that worktree's project listening for "agent finished" start.
// Called from the hooks listener in hooks.rs (since MERGE 181), beside the AUTO-012 on_status feed.
pub fn on_finish(app: &tauri::AppHandle, pane_key: u32, terminal: Option<u32>, state: &str, boundary: bool, child: bool, interrupted: bool) {
    use tauri::Manager;
    static SEEN: std::sync::OnceLock<Mutex<std::collections::HashMap<u32, bool>>> = std::sync::OnceLock::new();
    let fired = agent_finished(&mut SEEN.get_or_init(Default::default).lock().unwrap_or_else(std::sync::PoisonError::into_inner), pane_key, state, boundary, child, interrupted);
    if !fired {
        return;
    }
    let Some(pane) = app.try_state::<crate::terminal::Terminals>().and_then(|ts| ts.of_pane(pane_key)) else { return };
    let Some(cwd) = pane.cwd else { return };
    let agent = pane.agent.unwrap_or("The agent");
    let line = format!("Event: {agent} finished its work in {}", folder_name(&cwd));
    // T-583: the runs start on a thread of their own (a precheck may take minutes), so the caller (the hooks'
    // after-reply queue, the window's in-band status) goes on; which panes finished was decided above, in order.
    let app = app.clone();
    std::thread::spawn(move || {
        let outcome = launch_for(&app, |l| {
            let own = {
                let store = l.store.lock().map_err(|e| e.to_string())?;
                own_pane(&load(&store, RUNS_KEY)?, terminal, pane_key)
            };
            if own {
                return Ok(Vec::new());
            }
            on_event(l, "agent-finished", &cwd, &line, now_ms() as i64)
        });
        if let Err(e) = outcome {
            eprintln!("automations event: {e}");
        }
    });
}

/// A run that never started, logged so the gap shows (AUTO-007, AUTO-022). AUTO-012: when the
/// automation's newest run was skipped for the same reason, that entry counts one more instead,
/// so an hour of five-minute refusals is one line, not twelve. A missed time is already one entry
/// per absence (AUTO-007), so two absences stay two.
fn skip(store: &Store, id: &str, trigger: &str, cause: &str, detail: &str) -> Result<Value, String> {
    let newest = load(store, RUNS_KEY)?.into_iter().filter(|r| r["automationId"] == id).max_by_key(|r| r["number"].as_u64().unwrap_or(0));
    if let Some(last) = newest.filter(|r| cause != "missed" && r["status"] == "skipped" && r["cause"] == cause && r["detail"] == detail && r["trigger"] == trigger) {
        let repeats = last["repeats"].as_u64().unwrap_or(1) + 1;
        return patch_run(store, last["id"].as_str().unwrap_or_default(), json!({ "repeats": repeats, "lastAt": now_ms() }));
    }
    let run = new_run(store, id, trigger)?;
    patch_run(store, run["id"].as_str().unwrap_or_default(), json!({ "status": "skipped", "cause": cause, "detail": detail }))
}

/// CLI-028: the host that owns an automation. Every automation made here is owned by this
/// computer (no `ownerHost` saved); one saved with another host's name came from a Kolux that had
/// hosts, and this one has none.
pub const LOCAL_HOST: &str = "local";
pub fn owner_of(a: &Value) -> &str {
    a["ownerHost"].as_str().map(str::trim).filter(|h| !h.is_empty()).unwrap_or(LOCAL_HOST)
}

/// AUTO-022: what keeps an automation from running, as `(cause, reason)`, or none when it is
/// ready. The reason names the project, the worktree or the account that needs signing in.
fn problem(store: &Store, a: &Value) -> Option<(&'static str, String)> {
    if owner_of(a) != LOCAL_HOST {
        return Some(("unavailable", format!("its host {} is not part of this Kolux, so nothing here can run it", owner_of(a))));
    }
    let Some(project) = projects::load_projects(store).into_iter().find(|p| a["projectId"] == p.id.as_str()) else {
        return Some(("unavailable", "its project is no longer in Kolux".into()));
    };
    if a["workspaceMode"] != "new-per-run" {
        let path = a["workspace"].as_str().filter(|s| !s.is_empty()).unwrap_or(&project.path);
        if !Path::new(path).is_dir() {
            return Some(("unavailable", format!("its worktree {path} is gone")));
        }
    }
    let accounts = crate::cli_accounts::list(store);
    let stale = accounts["accounts"].as_array()?.iter().find(|x| x["agent"] == a["provider"] && x["active"] == true && x["needsSignIn"] == true)?;
    let agent = if a["provider"] == "codex" { "Codex" } else { "Claude" };
    Some(("signin", format!("the {agent} account {} needs signing in again", stale["email"].as_str().unwrap_or("in use"))))
}

fn in_progress(r: &Value) -> bool {
    ["pending", "dispatching", "dispatched"].contains(&r["status"].as_str().unwrap_or_default())
}

/// AUTO-021: keeps an automation's newest 100 runs; a run still in progress is never dropped.
fn prune(runs: &mut Vec<Value>, id: &str) -> Vec<String> {
    let extra = runs.iter().filter(|r| r["automationId"] == id).count().saturating_sub(KEEP_RUNS);
    let mut old: Vec<usize> = (0..runs.len()).filter(|&i| runs[i]["automationId"] == id && !in_progress(&runs[i])).collect();
    old.sort_by_key(|&i| runs[i]["number"].as_u64().unwrap_or(0));
    let gone: std::collections::HashSet<usize> = old.into_iter().take(extra).collect();
    let ids = gone.iter().filter_map(|&i| runs[i]["id"].as_str().map(String::from)).collect();
    let mut i = 0;
    runs.retain(|_| {
        i += 1;
        !gone.contains(&(i - 1))
    });
    ids
}

/// AUTO-021 on load: an old run without a number is given the next one, and a history saved too
/// large is cut down to each automation's newest 100.
pub fn tidy(store: &Store, now: u64) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let mut runs = load(store, RUNS_KEY)?;
    let mut bare: Vec<usize> = (0..runs.len()).filter(|&i| runs[i]["number"].as_u64().is_none()).collect();
    bare.sort_by_key(|&i| runs[i]["at"].as_u64().unwrap_or(0));
    for i in bare {
        let id = runs[i]["automationId"].clone();
        let seen = runs.iter().filter(|r| r["automationId"] == id).filter_map(|r| r["number"].as_u64()).max().unwrap_or(0);
        let auto = all.iter_mut().find(|a| a["id"] == id);
        let number = seen.max(auto.as_ref().and_then(|a| a["lastRunNumber"].as_u64()).unwrap_or(0)) + 1;
        if let Some(a) = auto {
            a["lastRunNumber"] = json!(number);
        }
        runs[i]["number"] = json!(number);
    }
    // AUTO-012: a run an earlier start left queued or starting was never handed to an agent, so it
    // cannot finish now; one already dispatched stays, since Kolux cannot tell its agent was lost.
    for r in runs.iter_mut().filter(|r| r["status"] == "pending" || r["status"] == "dispatching") {
        r["status"] = json!("failed");
        r["detail"] = json!("Kolux closed before this run was handed to its agent");
    }
    // AUTO-012 (T-072-b): a dispatched run's terminal number belonged to the last process; it waits
    // for its pane to open again in its worktree and is closed by `settle` if none does in time.
    // T-085-h: the old numbers are kept aside, so `reconnect` can ask the terminal service for them.
    for r in runs.iter_mut().filter(|r| tracked(r)) {
        if let Some(row) = r.as_object_mut() {
            if let Some(t) = row.remove("terminal").filter(|t| !t.is_null()) {
                row.insert("lastTerminal".into(), t);
            }
            if let Some(p) = row.remove("paneKey").filter(|p| !p.is_null()) {
                row.insert("lastPaneKey".into(), p);
            }
            row.insert("settleBy".into(), json!(now + SETTLE_MS));
        }
    }
    // T-140-d: output saved inline before it had its own key moves there.
    for r in runs.iter_mut() {
        stash_output(store, r)?;
    }
    let ids: std::collections::BTreeSet<String> = runs.iter().filter_map(|r| r["automationId"].as_str().map(String::from)).collect();
    let mut gone = Vec::new();
    for id in &ids {
        gone.extend(prune(&mut runs, id));
    }
    save(store, RUNS_KEY, &runs)?;
    drop_outputs(store, &gone)?;
    save(store, KEY, &all)
}

// ---------------------------------------------------------------- AUTO-012: following a run to its end

/// How long after a restart a run still dispatched may take to find its pane again before it is
/// closed as lost (a resumed Claude pane reports within seconds; two minutes covers a slow start).
pub const SETTLE_MS: u64 = 120_000;
/// The agents that report their state through Kolux's hooks (STAT-001); any other agent's run
/// ends with its process: a clean exit is its finish.
const HOOKED: [&str; 2] = ["claude", "codex"];
/// Set when Kolux ends every pane on its way out (quit, update restart): those panes did not stop
/// by themselves, so their runs stay dispatched and reconnect after the restart.
pub static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn tracked(r: &Value) -> bool {
    r["status"] == "dispatched"
}

/// The same folder however it is spelled (separators, a trailing slash, case on Windows).
fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let c = Path::new(s).canonicalize().map(|c| c.to_string_lossy().into_owned()).unwrap_or_else(|_| s.to_string());
        let c = c.replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(windows) {
            c.to_lowercase()
        } else {
            c
        }
    };
    norm(a) == norm(b)
}

fn finish(r: &mut Value, status: &str, detail: Option<&str>, now: u64) {
    if let Some(row) = r.as_object_mut() {
        row.insert("status".into(), json!(status));
        row.insert("finishedAt".into(), json!(now));
        if let Some(d) = detail {
            row.insert("detail".into(), json!(d));
        }
    }
}

/// A pane `terminal` (hook pane `pane_key`) just started `agent` in `cwd`: the oldest dispatched run
/// of that agent in that worktree with no pane yet is followed through it. Shells and other agents
/// are never a run's pane. Returns the run picked up.
pub fn claim(store: &Store, terminal: u32, pane_key: Option<u32>, cwd: &str, agent: Option<&str>) -> Result<Option<String>, String> {
    let Some(agent) = agent else { return Ok(None) };
    let mut runs = load(store, RUNS_KEY)?;
    let free = |r: &Value| tracked(r) && r.get("terminal").is_none_or(Value::is_null) && r["provider"].as_str().is_none_or(|p| p == agent) && r["worktree"].as_str().is_some_and(|w| same_dir(w, cwd));
    let Some(i) = (0..runs.len()).filter(|&i| free(&runs[i])).min_by_key(|&i| runs[i]["at"].as_u64().unwrap_or(0)) else { return Ok(None) };
    if let Some(row) = runs[i].as_object_mut() {
        row.insert("terminal".into(), json!(terminal));
        row.insert("paneKey".into(), json!(pane_key));
        row.remove("settleBy");
    }
    let id = runs[i]["id"].as_str().map(String::from);
    save(store, RUNS_KEY, &runs)?;
    Ok(id)
}

/// One agent status for a pane (STAT-001). A run completes only on its lead's own finish after the
/// agent was seen at work since launch: a finish at a session boundary (start, resume, clear), an
/// old idle state or a ready prompt already on screen never counts, nor does a sub-agent's finish.
/// Returns the run that completed.
/// T-140-e: `session` is the agent's own session id as the hook status carries it (SESS-030); the
/// run keeps it as `sessionId` so T-140-c can match the run's usage by id. The newest id wins (a
/// clear starts a new session in the same pane); a sub-agent's event never sets it.
#[allow(clippy::too_many_arguments)] // one more field of the same status; a struct would only rename the call
pub fn on_status(store: &Store, terminal: Option<u32>, pane_key: u32, state: &str, boundary: bool, child: bool, session: Option<&str>, now: u64) -> Result<Option<String>, String> {
    if child {
        return Ok(None);
    }
    let mut runs = load(store, RUNS_KEY)?;
    let mine = |r: &Value| tracked(r) && !r["terminal"].is_null() && terminal.map_or(r["paneKey"] == pane_key, |t| r["terminal"] == t);
    let Some(i) = runs.iter().position(mine) else { return Ok(None) };
    let noted = match session {
        Some(s) if runs[i]["sessionId"] != s => {
            runs[i]["sessionId"] = json!(s);
            true
        }
        _ => false,
    };
    match state {
        _ if boundary => {
            if noted {
                save(store, RUNS_KEY, &runs)?;
            }
            Ok(None)
        }
        "working" | "permission" | "waiting" if runs[i]["worked"] != true => {
            runs[i]["worked"] = json!(true);
            save(store, RUNS_KEY, &runs)?;
            Ok(None)
        }
        "done" if runs[i]["worked"] == true => {
            finish(&mut runs[i], "completed", None, now);
            let id = runs[i]["id"].as_str().map(String::from);
            save(store, RUNS_KEY, &runs)?;
            Ok(id)
        }
        _ => {
            if noted {
                save(store, RUNS_KEY, &runs)?;
            }
            Ok(None)
        }
    }
}

/// Pane `terminal` closed (its agent exited or was killed). A run still dispatched there is over:
/// failed when its agent never began working or stopped before it finished; an agent without
/// hooks completes on a clean exit. Returns the run closed.
pub fn pane_ended(store: &Store, terminal: u32, code: Option<u32>, now: u64) -> Result<Option<String>, String> {
    if QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(None);
    }
    let mut runs = load(store, RUNS_KEY)?;
    let Some(i) = runs.iter().position(|r| tracked(r) && r["terminal"] == terminal) else { return Ok(None) };
    let hooked = runs[i]["provider"].as_str().is_none_or(|p| HOOKED.contains(&p));
    let exit = code.map(|c| format!(" (exit code {c})")).unwrap_or_default();
    match (hooked, runs[i]["worked"] == true) {
        (false, _) if code == Some(0) => finish(&mut runs[i], "completed", None, now),
        (false, _) => finish(&mut runs[i], "failed", Some(&format!("The agent exited without finishing{exit}")), now),
        (true, true) => finish(&mut runs[i], "failed", Some(&format!("The agent stopped before it finished{exit}")), now),
        (true, false) => finish(&mut runs[i], "failed", Some(&format!("The agent stopped before it began working{exit}")), now),
    }
    // T-140-d: only a run its closing pane ended may say its terminal had closed before it ended.
    runs[i]["paneEnded"] = json!(true);
    let id = runs[i]["id"].as_str().map(String::from);
    save(store, RUNS_KEY, &runs)?;
    Ok(id)
}

/// T-085-h: what the terminal service knows about a terminal a run was following before the
/// restart: whether it is still running there, and what it has shown so far (text, cut flag).
pub struct Held {
    pub alive: bool,
    pub output: Option<(String, bool)>,
}

/// AUTO-011 / AUTO-012 (T-085-h): right after `tidy`, every run still dispatched is looked for
/// at the terminal service by the terminal and hook pane it had before the restart. One the
/// service still holds alive is reconnected at once: it is followed through that terminal again,
/// its settling period is over, and what the terminal has shown so far is replayed onto the run
/// so the Runs page shows it. One the service knows ended while Kolux was away is closed as
/// failed with that reason, with the terminal's last text. One the service does not know (the
/// usual case today: a new process starts its terminal numbers over) is left to `claim` and
/// `settle`. Returns the runs that moved.
pub fn reconnect(store: &Store, held: &dyn Fn(u32, Option<u32>) -> Option<Held>, now: u64) -> Result<Vec<String>, String> {
    let mut runs = load(store, RUNS_KEY)?;
    let mut moved = Vec::new();
    for r in runs.iter_mut().filter(|r| tracked(r) && r["terminal"].is_null()) {
        let Some(terminal) = r["lastTerminal"].as_u64().and_then(|t| u32::try_from(t).ok()) else { continue };
        let pane_key = r["lastPaneKey"].as_u64().and_then(|p| u32::try_from(p).ok());
        let Some(found) = held(terminal, pane_key) else { continue };
        let Some(row) = r.as_object_mut() else { continue };
        if found.alive {
            row.insert("terminal".into(), json!(terminal));
            row.insert("paneKey".into(), json!(pane_key));
            row.remove("settleBy");
            row.insert("reconnected".into(), json!(true));
            row.insert("detail".into(), json!("Reconnected to its terminal after Kolux restarted"));
            if let Some((text, cut)) = found.output.filter(|(t, _)| !t.trim().is_empty()) {
                row.insert("output".into(), json!(text));
                row.insert("outputFrom".into(), json!("replay"));
                row.insert("outputCut".into(), json!(cut));
            }
        } else {
            row.remove("settleBy");
            if let Some((text, cut)) = found.output.filter(|(t, _)| !t.trim().is_empty()) {
                row.insert("output".into(), json!(text));
                row.insert("outputFrom".into(), json!("screen"));
                row.insert("outputCut".into(), json!(cut));
            }
            row.insert("paneEnded".into(), json!(true));
            finish(r, "failed", Some("Kolux restarted and this run's terminal had already ended"), now);
        }
        stash_output(store, r)?;
        moved.extend(r["id"].as_str().map(String::from));
    }
    if !moved.is_empty() {
        save(store, RUNS_KEY, &runs)?;
    }
    Ok(moved)
}

/// T-085-h: the app's terminal service asked about a terminal from before the restart, through
/// what it already tells: a session it still runs is alive and its log is the replay; a pane whose
/// newest program is over is ended; anything else is unknown.
fn held_in(ts: &crate::terminal::Terminals, terminal: u32, pane_key: Option<u32>) -> Option<Held> {
    if ts.started(terminal).is_some() {
        return Some(Held { alive: true, output: ts.read(terminal, None, Some(RUN_OUTPUT_LINES)).map(|r| screen_text(&r)) });
    }
    pane_key.and_then(|p| ts.of_pane(p)).filter(|run| !run.alive).map(|_| Held { alive: false, output: None })
}

/// After a restart, the dispatched runs whose pane has not come back by the end of the settling
/// period are closed as failed. Returns the runs closed.
pub fn settle(store: &Store, now: u64) -> Result<Vec<String>, String> {
    let mut runs = load(store, RUNS_KEY)?;
    let mut closed = Vec::new();
    for r in runs.iter_mut().filter(|r| tracked(r) && r["settleBy"].as_u64().is_some_and(|t| t < now)) {
        if let Some(row) = r.as_object_mut() {
            row.remove("settleBy");
        }
        finish(r, "failed", Some("Kolux restarted and this run's agent could not be found again"), now);
        closed.extend(r["id"].as_str().map(String::from));
    }
    if !closed.is_empty() {
        save(store, RUNS_KEY, &runs)?;
    }
    Ok(closed)
}

/// The app's side of the hooks above: the store is locked, the change saved, and the Automations
/// page told when a run moved. T-583: what a finished run keeps (the pane's text, then up to 8 MB of
/// transcript) is read on a thread of its own, so no caller (the hook line, the window's in-band
/// status, a terminal's exit) waits on it.
pub fn follow(app: &tauri::AppHandle, f: impl FnOnce(&Store) -> Result<Option<String>, String>) {
    use tauri::{Emitter, Manager};
    let Some(state) = app.try_state::<Mutex<Store>>() else { return };
    let moved = match state.lock() {
        Ok(store) => f(&store),
        Err(e) => Err(e.to_string()),
    };
    match moved {
        Ok(Some(id)) => {
            let app = app.clone();
            std::thread::spawn(move || {
                let Some(state) = app.try_state::<Mutex<Store>>() else { return };
                keep_screen(&app, &state, &id);
                keep_said(&state, &id);
                drop(app.emit(EVENT, json!({ "runId": id })))
            });
        }
        Ok(None) => {}
        Err(e) => eprintln!("automation run tracking: {e}"),
    }
}

/// AUTO-014: a finished run keeps the end of what its pane showed, this many characters at most.
const RUN_OUTPUT_CHARS: usize = 16_000;
/// The pane lines read for it; the character cap trims what is left over.
pub const RUN_OUTPUT_LINES: usize = 600;

/// AUTO-014: a pane's text the way a run keeps it: escape codes gone (the log strips them; this
/// catches anything it let through), carriage-return redraws such as progress bars already down to
/// their last version, blank stretches squeezed to one line, and past the size limit only the most
/// recent text, from a whole line. Returns the text and whether anything older was left out.
pub fn screen_text(read: &crate::terminal::Read) -> (String, bool) {
    let mut lines: Vec<String> = read.lines.iter().map(|l| crate::terminal::strip_ansi(&l.text).trim_end().to_string()).collect();
    if !read.pending.trim().is_empty() {
        lines.push(crate::terminal::strip_ansi(&read.pending).trim_end().to_string());
    }
    let mut kept: Vec<String> = Vec::with_capacity(lines.len());
    for l in lines {
        if l.is_empty() && kept.last().is_none_or(String::is_empty) {
            continue;
        }
        kept.push(l);
    }
    while kept.last().is_some_and(String::is_empty) {
        kept.pop();
    }
    let (text, cut) = cap_tail(kept.join("\n"));
    (text, cut || read.dropped || read.more)
}

/// The size limit: past it only the most recent text is kept, from a whole line. Returns the text
/// and whether anything was left out.
fn cap_tail(text: String) -> (String, bool) {
    let n = text.chars().count();
    if n <= RUN_OUTPUT_CHARS {
        return (text, false);
    }
    let tail: String = text.chars().skip(n - RUN_OUTPUT_CHARS).collect();
    let tail = match tail.find('\n') {
        Some(i) => tail[i + 1..].to_string(),
        None => tail,
    };
    (tail, true)
}

/// T-140-b: what the agent itself said, from its transcript lines (Claude's JSON lines, Codex's
/// rollout): the assistant's text blocks in order, a repeat of the block just before it dropped,
/// tool calls, thinking, side chains and the user's own turns left out, under the same size limit.
pub fn transcript_text(agent: &str, lines: &[String]) -> (String, bool) {
    let mut said: Vec<String> = Vec::new();
    for v in lines.iter().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        let (content, kinds) = match agent {
            "codex" if v["type"] == "response_item" && v["payload"]["type"] == "message" && v["payload"]["role"] == "assistant" => (&v["payload"]["content"], ["output_text", "text"]),
            "claude" | "openclaude" if v["type"] == "assistant" && v["isSidechain"] != true && v["isMeta"] != true => (&v["message"]["content"], ["text", "text"]),
            _ => continue,
        };
        let blocks: Vec<&str> = match content {
            Value::String(t) => vec![t.as_str()],
            Value::Array(a) => a.iter().filter(|b| b["type"].as_str().is_some_and(|t| kinds.contains(&t))).filter_map(|b| b["text"].as_str()).collect(),
            _ => Vec::new(),
        };
        for t in blocks.into_iter().map(str::trim).filter(|t| !t.is_empty()) {
            if said.last().is_none_or(|p| p != t) {
                said.push(t.to_string());
            }
        }
    }
    cap_tail(said.join("\n\n"))
}

/// AUTO-014: run `run_id`, now over, keeps `text` as its saved output, once: a run that already
/// has output (a precheck's, or an earlier save) or is still going keeps what it has.
pub fn keep_output(store: &Store, run_id: &str, text: &str, cut: bool) -> Result<Option<String>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let mut runs = load(store, RUNS_KEY)?;
    let Some(r) = runs.iter_mut().find(|r| r["id"] == run_id && !in_progress(r) && output_open(r)) else { return Ok(None) };
    if let Some(row) = r.as_object_mut() {
        row.insert("output".into(), json!(text));
        row.insert("outputFrom".into(), json!("screen"));
        row.insert("outputCut".into(), json!(cut));
    }
    stash_output(store, r)?;
    save(store, RUNS_KEY, &runs)?;
    Ok(Some(run_id.to_string()))
}

/// The run that just moved, if it is over and has a pane still open, saves that pane's text. A pane
/// that already closed has nothing left to read (the exit keeps its text through `keep_output`).
fn keep_screen(app: &tauri::AppHandle, state: &Mutex<Store>, run_id: &str) {
    use tauri::Manager;
    let pane = state
        .lock()
        .ok()
        .and_then(|s| load(&s, RUNS_KEY).ok())
        .and_then(|runs| runs.into_iter().find(|r| r["id"] == run_id))
        .filter(|r| !in_progress(r) && output_open(r))
        .and_then(|r| r["terminal"].as_u64())
        .and_then(|t| u32::try_from(t).ok());
    let Some(pane) = pane else { return };
    let Some(read) = app.try_state::<crate::terminal::Terminals>().and_then(|ts| ts.read(pane, None, Some(RUN_OUTPUT_LINES))) else { return };
    let (text, cut) = screen_text(&read);
    if let Ok(s) = state.lock() {
        if let Err(e) = keep_output(&s, run_id, &text, cut) {
            eprintln!("automation run output: {e}");
        }
    }
}

/// T-140-b: run `run_id`, now over, keeps what the agent said (its transcript) in place of the
/// pane's text, which stands in only when there is no transcript. A precheck's output or text that
/// is already the transcript is left alone.
pub fn keep_transcript(store: &Store, run_id: &str, text: &str, cut: bool) -> Result<Option<String>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let mut runs = load(store, RUNS_KEY)?;
    let open = |r: &Value| output_open(r) || r["outputFrom"] == "screen";
    let Some(r) = runs.iter_mut().find(|r| r["id"] == run_id && !in_progress(r) && open(r)) else { return Ok(None) };
    if let Some(row) = r.as_object_mut() {
        row.insert("output".into(), json!(text));
        row.insert("outputFrom".into(), json!("transcript"));
        row.insert("outputCut".into(), json!(cut));
    }
    stash_output(store, r)?;
    save(store, RUNS_KEY, &runs)?;
    Ok(Some(run_id.to_string()))
}

/// Where a finished run's agent wrote its transcript: the file its hooks last reported while the
/// pane lived, else the newest one its agent started in the run's folder since the run began.
fn transcript_path(run: &Value) -> Option<std::path::PathBuf> {
    let agent = run["provider"].as_str()?;
    let pane = ["paneKey", "lastPaneKey"].iter().find_map(|k| run[*k].as_u64()).and_then(|p| u32::try_from(p).ok());
    if let Some(p) = pane.and_then(crate::status::transcript_of) {
        return Some(p.into());
    }
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(run["dispatchedAt"].as_u64()?);
    let user_home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(std::path::PathBuf::from);
    let homes = crate::chat::homes(agent, &[], |k| std::env::var(k).ok(), user_home);
    crate::chat::find(agent, &homes, run["worktree"].as_str()?, since)
}

/// The run that just moved, if it is over, saves what its agent said when the transcript can be
/// found and read. Runs after the pane's text was kept, which it then replaces.
fn keep_said(state: &Mutex<Store>, run_id: &str) {
    let run = state
        .lock()
        .ok()
        .and_then(|s| load(&s, RUNS_KEY).ok())
        .and_then(|runs| runs.into_iter().find(|r| r["id"] == run_id))
        .filter(|r| !in_progress(r) && (output_open(r) || r["outputFrom"] == "screen"));
    let Some(run) = run else { return };
    let Some(path) = transcript_path(&run) else { return };
    let Ok((lines, _)) = crate::chat::Tail::new(path).read() else { return };
    let (text, cut) = transcript_text(run["provider"].as_str().unwrap_or_default(), &lines);
    if let Ok(s) = state.lock() {
        if let Err(e) = keep_transcript(&s, run_id, &text, cut) {
            eprintln!("automation run transcript: {e}");
        }
    }
}

fn position(list: &[Value], id: &str) -> Result<usize, String> {
    list.iter().position(|a| a["id"] == id).ok_or_else(|| format!("no automation {id}"))
}

/// AUTO-019: pausing stops future runs until resumed (the clock, `tick`, reads `enabled`).
pub fn set_enabled(store: &Store, id: &str, enabled: bool) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all[i]["enabled"] = json!(enabled);
    if enabled {
        let next = next_run(&all[i], now_ms() as i64);
        all[i]["nextRunAt"] = json!(next);
    }
    save(store, KEY, &all)?;
    Ok(all[i].clone())
}

/// AUTO-019: an automation goes together with its run history.
pub fn delete(store: &Store, id: &str) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all.remove(i);
    let (gone, runs): (Vec<Value>, Vec<Value>) = load(store, RUNS_KEY)?.into_iter().partition(|r| r["automationId"] == id);
    save(store, KEY, &all)?;
    save(store, RUNS_KEY, &runs)?;
    drop_outputs(store, &gone.iter().filter_map(|r| r["id"].as_str().map(String::from)).collect::<Vec<_>>())
}

/// AUTO-013: numbering is per automation, starts at 1 and only goes up (the highest number ever
/// handed out is kept on the automation, so deleting runs never reuses a number).
fn new_run(store: &Store, id: &str, trigger: &str) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    let mut runs = load(store, RUNS_KEY)?;
    let seen = runs.iter().filter(|r| r["automationId"] == id).filter_map(|r| r["number"].as_u64()).max().unwrap_or(0);
    let number = seen.max(all[i]["lastRunNumber"].as_u64().unwrap_or(0)) + 1;
    let n = runs.iter().filter_map(|r| r["id"].as_str()?.strip_prefix("run-")?.parse::<u64>().ok()).max().unwrap_or(0) + 1;
    let run = json!({ "id": format!("run-{n}"), "automationId": id, "number": number, "trigger": trigger, "status": "pending", "at": now_ms() });
    runs.push(run.clone());
    let gone = prune(&mut runs, id);
    all[i]["lastRunNumber"] = json!(number);
    save(store, RUNS_KEY, &runs)?;
    save(store, KEY, &all)?;
    drop_outputs(store, &gone)?;
    Ok(run)
}

fn patch_run(store: &Store, run_id: &str, fields: Value) -> Result<Value, String> {
    let mut runs = load(store, RUNS_KEY)?;
    let i = runs.iter().position(|r| r["id"] == run_id).ok_or_else(|| format!("no run {run_id}"))?;
    if let (Some(row), Some(add)) = (runs[i].as_object_mut(), fields.as_object()) {
        for (k, v) in add {
            row.insert(k.clone(), v.clone());
        }
    }
    stash_output(store, &mut runs[i])?;
    save(store, RUNS_KEY, &runs)?;
    Ok(with_output(store, runs[i].clone()))
}

/// What a run needs from the app to start its agent.
pub struct Launch<'a> {
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    pub claude_config: PathBuf,
    /// Is this agent id installed? (the catalogue's detection; injected so tests need no agent)
    pub installed: &'a dyn Fn(&str) -> bool,
    /// `(event, payload)` to the window: the start of a background tab, or a list change.
    pub notify: &'a dyn Fn(&str, Value),
}

/// What a run needs from the open terminals to continue in a session an earlier run left behind.
pub trait Panes {
    /// Is `terminal` open, still the very same pane `pane_key`, with its agent idle as its hooks tell?
    fn idle(&self, terminal: u32, pane_key: Option<u32>) -> bool;
    /// Types `text` into the agent in `terminal` and presses Enter.
    fn send(&self, terminal: u32, text: &str) -> Result<(), String>;
}

/// The terminals the app runs, set when the clock starts; a run that cannot reach them (a test, or
/// the app not up yet) opens its own session.
static PANES: Mutex<Option<std::sync::Arc<dyn Panes + Send + Sync>>> = Mutex::new(None);

pub fn use_panes(p: std::sync::Arc<dyn Panes + Send + Sync>) {
    if let Ok(mut g) = PANES.lock() {
        *g = Some(p);
    }
}

fn panes() -> Option<std::sync::Arc<dyn Panes + Send + Sync>> {
    PANES.lock().ok().and_then(|g| g.clone())
}

impl Panes for tauri::AppHandle {
    fn idle(&self, terminal: u32, pane_key: Option<u32>) -> bool {
        tauri::Manager::try_state::<crate::terminal::Terminals>(self).is_some_and(|t| t.idle(terminal, pane_key))
    }
    fn send(&self, terminal: u32, text: &str) -> Result<(), String> {
        tauri::Manager::try_state::<crate::terminal::Terminals>(self).ok_or("no terminals")?.send(terminal, text)
    }
}

impl Panes for crate::terminal::Terminals {
    fn idle(&self, terminal: u32, pane_key: Option<u32>) -> bool {
        pane_key.is_some_and(|p| self.attached(p) == Some(terminal)) && crate::status::state_of(terminal) == Some("done")
    }
    // ponytail: the pause between the pasted prompt and Enter blocks the caller for a quarter of a
    // second; a thread if sends ever come in bunches.
    fn send(&self, terminal: u32, text: &str) -> Result<(), String> {
        self.write(terminal, &bracketed(text))?;
        std::thread::sleep(std::time::Duration::from_millis(250));
        self.write(terminal, "\r")
    }
}

/// A prompt as one bracketed paste for a reused session (AUTO-009), with ESC and every control
/// character except line feed and tab dropped first (`sendonce::paste_safe`), so its text (a
/// pull-request title, say) cannot end the paste early.
fn bracketed(text: &str) -> String {
    format!("\u{1b}[200~{}\u{1b}[201~", crate::orchestration::sendonce::paste_safe(text))
}

/// AUTO-009: the session this run may continue in: the automation asks for reuse (existing
/// worktree only), its newest run that had a pane was in this same worktree with this same agent,
/// is over, no live run holds that pane, and the pane is still open, still the same pane and idle.
fn reusable(store: &Store, auto: &Value, folder: &str, panes: &dyn Panes) -> Option<(u32, u32)> {
    if auto["reuseSession"] != true || auto["workspaceMode"] != "existing" {
        return None;
    }
    let runs = load(store, RUNS_KEY).ok()?;
    let last = runs.iter().filter(|r| r["automationId"] == auto["id"] && r["terminal"].is_u64()).max_by_key(|r| r["at"].as_u64().unwrap_or(0))?;
    let (terminal, pane) = (u32::try_from(last["terminal"].as_u64()?).ok()?, u32::try_from(last["paneKey"].as_u64()?).ok()?);
    let same = !in_progress(last) && last["provider"] == auto["provider"] && last["worktree"].as_str().is_some_and(|w| same_dir(w, folder));
    let held = runs.iter().any(|r| in_progress(r) && r["terminal"] == terminal);
    (same && !held && panes.idle(terminal, Some(pane))).then_some((terminal, pane))
}

/// AUTO-019 Run now: begins a run at once whatever the timetable or the switch says (a paused
/// automation runs too) and logs it as a manual run. The run is queued (`pending`) first, then
/// placed and handed to the window as a background tab (`dispatched`, AUTO-011), or ends as
/// skipped (`unavailable`) when its project or worktree vanishes on the way, or failed to dispatch
/// when the agent cannot start. AUTO-022: a target that is not ready refuses Run now with the
/// reason and leaves no run behind; a timed run is logged as skipped with it instead. AUTO-008: a
/// timed or event-started run first runs the automation's precheck in its target folder and is
/// skipped with the exit code and output when it fails; Run now never runs it.
pub fn run(l: &Launch, id: &str, trigger: &str) -> Result<Value, String> {
    run_with(l, id, trigger, None)
}

/// AUTO-004: an event-started run carries the happening's line (`eventDetail`, the marker's
/// tooltip) and has it on the end of the agent's prompt.
fn run_with(l: &Launch, id: &str, trigger: &str, event: Option<&str>) -> Result<Value, String> {
    let marked = |store: &Store, run: Value| match event {
        Some(line) => patch_run(store, run["id"].as_str().unwrap_or_default(), json!({ "eventDetail": line })),
        None => Ok(run),
    };
    let (mut auto, run) = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        let all = load(&store, KEY)?;
        let auto = all[position(&all, id)?].clone();
        if let Some((cause, why)) = problem(&store, &auto) {
            if trigger == "manual" {
                return Err(format!("Run now is blocked: {why}"));
            }
            let out = marked(&store, skip(&store, id, trigger, cause, &why)?)?;
            reschedule(&store, id, now_ms() as i64)?;
            drop(store);
            (l.notify)(EVENT, json!({ "runId": out["id"] }));
            return Ok(out);
        }
        let run = marked(&store, new_run(&store, id, trigger)?)?;
        (auto, run)
    };
    if let Some(line) = event {
        auto["prompt"] = json!(format!("{}

{line}", auto["prompt"].as_str().unwrap_or_default()));
    }
    let check = auto["precheck"].as_str().map(str::trim).unwrap_or_default();
    if trigger != "manual" && !check.is_empty() {
        let dir = match auto["workspaceMode"] == "new-per-run" {
            true => {
                let store = l.store.lock().map_err(|e| e.to_string())?;
                projects::load_projects(&store).into_iter().find(|p| auto["projectId"] == p.id.as_str()).map(|p| p.path).unwrap_or_default()
            }
            false => auto["workspace"].as_str().unwrap_or_default().to_string(),
        };
        let limit = std::time::Duration::from_secs(auto["precheckTimeoutSeconds"].as_u64().unwrap_or(PRECHECK_SECONDS[0]));
        // ponytail: the clock runs automations one after another, so a slow precheck holds up the
        // next due run by up to its limit; give each run its own thread if that ever matters. An
        // agent-finished run already has its own (T-583), off the hook line.
        if let Some(fields) = run_precheck(check, Path::new(&dir), limit) {
            let store = l.store.lock().map_err(|e| e.to_string())?;
            reschedule(&store, id, now_ms() as i64)?;
            let out = patch_run(&store, run["id"].as_str().unwrap_or_default(), fields)?;
            drop(store);
            (l.notify)(EVENT, json!({ "runId": out["id"] }));
            return Ok(out);
        }
    }
    let run_id = run["id"].as_str().unwrap_or_default().to_string();
    (l.notify)(EVENT, json!({ "runId": run_id }));
    let outcome = place_and_start(l, &auto, &run_id);
    let fields = match outcome {
        Ok((wt, project_id, session)) => {
            let mut fields = json!({ "status": "dispatched", "provider": auto["provider"], "dispatchedAt": now_ms(), "worktree": wt.path, "worktreeName": wt.name.clone().or(wt.branch.clone()).unwrap_or_else(|| folder_name(&wt.path)), "projectId": project_id });
            // AUTO-009: a run that went into the earlier session holds that pane from the start.
            if let Some((terminal, pane)) = session {
                fields["terminal"] = json!(terminal);
                fields["paneKey"] = json!(pane);
                fields["reused"] = json!(true);
            }
            fields
        }
        Err(Stop::Skipped(why)) => json!({ "status": "skipped", "cause": "unavailable", "detail": why }),
        Err(Stop::Failed(why)) => json!({ "status": "failed", "detail": why }),
    };
    let done = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        reschedule(&store, id, now_ms() as i64)?;
        patch_run(&store, &run_id, fields)?
    };
    (l.notify)(EVENT, json!({ "runId": run_id }));
    Ok(done)
}

/// AUTO-008: runs a precheck command in `dir` (PowerShell on Windows, `sh` elsewhere, never a
/// window on screen) and stops it, with everything it started, at `limit`. None when it exits 0;
/// otherwise the skipped run's fields, with the exit code and the end of what it printed.
fn run_precheck(cmd: &str, dir: &Path, limit: std::time::Duration) -> Option<Value> {
    use std::process::{Command, Stdio};
    let log = std::env::temp_dir().join(format!("kolux-precheck-{}-{}.log", std::process::id(), now_ms()));
    let skipped = |exit: Value, timed_out: bool, output: String, detail: String| Some(json!({ "status": "skipped", "cause": "precheck", "exitCode": exit, "timedOut": timed_out, "output": output, "detail": detail }));
    let file = match std::fs::File::create(&log) {
        Ok(f) => f,
        Err(e) => return skipped(Value::Null, false, String::new(), format!("the precheck could not start: {e}")),
    };
    let mut c = if cfg!(windows) { Command::new("powershell.exe") } else { Command::new("sh") };
    if cfg!(windows) {
        c.args(["-NoProfile", "-NonInteractive", "-Command", cmd]);
    } else {
        c.args(["-c", cmd]);
    }
    // GIT-063: a precheck runs unattended too, so git fails rather than waits on a password.
    c.current_dir(dir).stdin(Stdio::null()).envs(crate::git::NO_PROMPT);
    if let Ok(copy) = file.try_clone() {
        c.stdout(copy).stderr(file);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            let _ = std::fs::remove_file(&log);
            return skipped(Value::Null, false, String::new(), format!("the precheck could not start in {}: {e}", dir.display()));
        }
    };
    let began = std::time::Instant::now();
    let status = loop {
        if let Ok(Some(s)) = child.try_wait() {
            break Some(s);
        }
        if began.elapsed() >= limit {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).output();
            }
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    let output = keep_tail(&String::from_utf8_lossy(&std::fs::read(&log).unwrap_or_default()));
    let _ = std::fs::remove_file(&log);
    match status {
        Some(s) if s.success() => None,
        Some(s) => {
            let code = s.code();
            let said = code.map(|c| format!("the precheck ended with exit code {c}, so the run was skipped")).unwrap_or_else(|| "the precheck was stopped, so the run was skipped".into());
            skipped(json!(code), false, output, said)
        }
        None => {
            let secs = limit.as_secs();
            let words = if secs >= 60 { format!("{} minute{}", secs / 60, if secs >= 120 { "s" } else { "" }) } else { format!("{secs} second{}", if secs == 1 { "" } else { "s" }) };
            skipped(Value::Null, true, output, format!("the precheck passed its {words} limit and was stopped, so the run was skipped"))
        }
    }
}

/// The last 4,000 characters, where a failing command's error usually is.
fn keep_tail(s: &str) -> String {
    let n = s.chars().count();
    s.chars().skip(n.saturating_sub(KEEP_OUTPUT)).collect()
}

enum Stop {
    Skipped(String),
    Failed(String),
}

fn folder_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// The window's notice that a run made its worktree. AUTO-010: it runs the project setup only when
/// the automation chose that; one saved before the choice existed skips it.
fn created_event(project_id: &str, wt: &Worktree, auto: &Value) -> Value {
    let setup = if auto["runSetup"].as_bool() == Some(true) { "run" } else { "skip" };
    json!({ "kind": "created", "projectId": project_id, "worktree": { "path": wt.path, "branch": wt.branch, "name": wt.name, "isMain": false }, "agent": Value::Null, "prompt": "", "activate": false, "setup": setup })
}

/// Where a run was placed: its worktree, its project, and the open session (terminal, pane) it went into, if any.
type Placed = (Worktree, String, Option<(u32, u32)>);

/// Finds or makes the run's workspace and asks the window to start the agent there.
/// AUTO-009: when the automation keeps one session and the last run's is free, the prompt is typed
/// into it instead.
fn place_and_start(l: &Launch, auto: &Value, run_id: &str) -> Result<Placed, Stop> {
    let agent = auto["provider"].as_str().unwrap_or_default().to_string();
    if !(l.installed)(&agent) {
        return Err(Stop::Failed(format!("{agent} is not installed")));
    }
    let project_id = auto["projectId"].as_str().unwrap_or_default().to_string();
    let project = {
        let store = l.store.lock().map_err(|e| Stop::Failed(e.to_string()))?;
        projects::load_projects(&store).into_iter().find(|p| p.id == project_id)
    }
    .ok_or_else(|| Stop::Skipped("its project is no longer in Kolux".into()))?;
    let new_per_run = auto["workspaceMode"] == "new-per-run";
    let wt = if new_per_run {
        // AUTO-005: cut from the chosen base; empty means the project's default branch.
        let base = auto["baseBranch"].as_str().map(str::trim).filter(|b| !b.is_empty());
        let wt = projects::create_fresh_from(l.git, l.store, &project.id, base).map_err(Stop::Failed)?;
        // AUTO-024: marked as made by an automation, so the sidebar can hide or tag it. A failed
        // record costs only the marker, never the run.
        if let Ok(store) = l.store.lock() {
            let _ = projects::set_origin(&store, &wt.path, Some(&json!({ "madeBy": "automation", "automationId": auto["id"] })));
        }
        wt
    } else {
        let path = auto["workspace"].as_str().filter(|s| !s.is_empty()).unwrap_or(&project.path).to_string();
        if !Path::new(&path).is_dir() {
            return Err(Stop::Skipped(format!("its worktree {path} is gone")));
        }
        Worktree { name: None, branch: None, head: String::new(), is_main: path == project.path, path, parent: None, locked: None, hidden: false, kind: String::new(), source: None, made_by: None, number: None, comment: None }
    };
    // SAFE-023 (T-443): only a worktree Kolux made is trusted ahead of time, never the main checkout.
    let _ = crate::trust::trust_folders(&l.claude_config, &agent, &crate::trust::made_by_kolux(l.store, &[PathBuf::from(&wt.path)]));
    if new_per_run {
        (l.notify)(crate::cli::EVENT, created_event(&project.id, &wt, auto));
    }
    // AUTO-009: the last run's session, when it is free, takes the prompt instead of a new tab.
    let prompt = auto["prompt"].as_str().unwrap_or_default();
    let panes = panes();
    let session = panes.as_deref().and_then(|ps| l.store.lock().ok().and_then(|store| reusable(&store, auto, &wt.path, ps)).filter(|(t, _)| ps.send(*t, prompt).is_ok()));
    if session.is_none() {
        (l.notify)(crate::cli::EVENT, json!({ "kind": "start", "path": wt.path, "branch": wt.branch, "agent": agent, "prompt": auto["prompt"], "extra": [], "title": auto["name"], "runId": run_id }));
    }
    Ok((wt, project.id, session))
}

// ---------------------------------------------------------------- the window's commands

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

#[tauri::command]
pub fn automations_list(store: StoreState<'_>) -> Result<Value, String> {
    list(&*store.lock().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn automation_set_enabled(app: tauri::AppHandle, store: StoreState<'_>, id: String, enabled: bool) -> Result<Value, String> {
    use tauri::Emitter;
    let out = set_enabled(&*store.lock().map_err(|e| e.to_string())?, &id, enabled)?;
    let _ = app.emit(EVENT, json!({ "id": id }));
    Ok(out)
}

#[tauri::command]
pub fn automation_preview(input: Value) -> Result<Value, String> {
    preview(&input, now_ms() as i64)
}

#[tauri::command]
pub fn automation_save(app: tauri::AppHandle, store: StoreState<'_>, input: Value) -> Result<Value, String> {
    use tauri::Emitter;
    let out = save_automation(&*store.lock().map_err(|e| e.to_string())?, &input, now_ms() as i64)?;
    let _ = app.emit(EVENT, json!({ "id": out["id"] }));
    Ok(out)
}

fn launch_for<R>(app: &tauri::AppHandle, f: impl FnOnce(&Launch) -> R) -> R {
    use tauri::{Emitter, Manager};
    let store = app.state::<Mutex<Store>>();
    let git = app.state::<Git>();
    let notify = |event: &str, v: Value| {
        let _ = app.emit(event, v);
    };
    let installed = |id: &str| crate::agents::agent_list().iter().any(|a| a.id == id && a.installed);
    f(&Launch { git: &git, store: &store, claude_config: crate::claude_accounts::trust_config_file(&store), installed: &installed, notify: &notify })
}

/// Starts the clock: it looks for due automations about once a minute (every 30 seconds, so a run
/// begins within its minute) for as long as the app runs.
pub fn start_clock(app: tauri::AppHandle) {
    use_panes(std::sync::Arc::new(app.clone()));
    std::thread::spawn(move || {
        // AUTO-021: a history saved too large is cut down as Kolux loads it.
        if let Err(e) = launch_for(&app, |l| tidy(&*l.store.lock().map_err(|e| e.to_string())?, now_ms())) {
            eprintln!("automations history: {e}");
        }
        // T-085-h: runs still going at the last quit are found again at the terminal service.
        if let Some(ts) = tauri::Manager::try_state::<crate::terminal::Terminals>(&app) {
            match launch_for(&app, |l| reconnect(&*l.store.lock().map_err(|e| e.to_string())?, &|t, p| held_in(&ts, t, p), now_ms())) {
                Ok(moved) => moved.iter().for_each(|id| drop(tauri::Emitter::emit(&app, EVENT, json!({ "runId": id })))),
                Err(e) => eprintln!("automations reconnect: {e}"),
            }
        }
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            if let Err(e) = launch_for(&app, |l| tick(l, now_ms() as i64)) {
                eprintln!("automations clock: {e}");
            }
            // AUTO-012: runs whose pane did not come back after a restart are closed once settled.
            match launch_for(&app, |l| settle(&*l.store.lock().map_err(|e| e.to_string())?, now_ms())) {
                Ok(closed) => closed.iter().for_each(|id| drop(tauri::Emitter::emit(&app, EVENT, json!({ "runId": id })))),
                Err(e) => eprintln!("automations settle: {e}"),
            }
        }
    });
}

#[tauri::command]
pub fn automation_delete(app: tauri::AppHandle, store: StoreState<'_>, id: String) -> Result<(), String> {
    use tauri::Emitter;
    delete(&*store.lock().map_err(|e| e.to_string())?, &id)?;
    let _ = app.emit(EVENT, json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn automation_run_now(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    // Git may take a moment for a new-per-run worktree; off the window's thread.
    tauri::async_runtime::spawn_blocking(move || launch_for(&app, |l| run(l, &id, "manual")))
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-605 re-review of PR #15: a reused session's prompt (it can carry a pull-request title) goes
    /// in as one bracketed paste with ESC and every control character except line feed and tab
    /// dropped, so it cannot end the paste early and press Enter on a command of its own.
    #[test]
    fn t605_a_reused_sessions_prompt_cannot_end_its_paste_early() {
        assert_eq!(bracketed("Fix: title\u{1b}[201~\rrm -rf ~\r\nnext\tline\u{7}"), "\u{1b}[200~Fix: title[201~rm -rf ~\nnext\tline\u{1b}[201~");
    }
    use std::cell::RefCell;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-auto-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn seed(store: &Store, ws: &Path) {
        let projects = json!([{ "id": "p1", "name": "repo", "path": ws.to_string_lossy() }]);
        store.set("projects", &projects.to_string()).unwrap();
        let autos = json!([
            { "id": "auto-1", "name": "Nightly", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "enabled": false },
            { "id": "auto-2", "name": "Gone", "prompt": "x", "provider": "claude", "projectId": "nope", "workspaceMode": "existing", "enabled": true },
        ]);
        store.set(KEY, &autos.to_string()).unwrap();
    }

    fn polled(path: &str, state: Option<&str>) -> crate::scm::PolledPr {
        let pr = state.map(|st| crate::scm::Pr { number: 7, url: "https://github.com/o/r/pull/7".into(), state: st.into(), title: Some("Fix".into()), head: Some("feat".into()), draft: true });
        crate::scm::PolledPr { path: path.into(), linked: false, pr, error: None }
    }

    #[test]
    fn auto004_a_pull_request_counts_as_opened_only_on_the_step_from_none_to_open() {
        let mut seen = std::collections::HashMap::new();
        // The first state Kolux learns is a starting point: an open one at start-up never fires.
        assert!(pr_opened(&mut seen, &[polled("C:/a", Some("OPEN")), polled("C:/b", None)]).is_empty());
        assert!(pr_opened(&mut seen, &[polled("C:/a", Some("OPEN"))]).is_empty());
        // None to open fires once, drafts included; staying open does not fire again.
        let fired = pr_opened(&mut seen, &[polled("c:/B/", Some("OPEN"))]);
        assert_eq!(fired.iter().map(|(p, pr)| (p.as_str(), pr.number)).collect::<Vec<_>>(), [("c:/B/", 7)]);
        assert!(pr_opened(&mut seen, &[polled("C:/b", Some("OPEN"))]).is_empty());
        // A failed lookup is no news; a hand-linked pull request is not one opened from the branch.
        let mut e = polled("C:/c", None);
        e.error = Some("rate limited".into());
        assert!(pr_opened(&mut seen, &[polled("C:/c", None), e, polled("C:/c", Some("OPEN"))]).len() == 1);
        let mut l = polled("C:/d", None);
        assert!(pr_opened(&mut seen, std::slice::from_ref(&l)).is_empty());
        l.linked = true;
        l.pr = polled("C:/d", Some("OPEN")).pr;
        assert!(pr_opened(&mut seen, &[l]).is_empty());
    }

    #[test]
    fn auto004_an_event_starts_one_run_with_its_line_on_the_prompt_then_rests_five_minutes() {
        let dir = temp("a004");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let wt = dir.join("feat");
        assert!(std::process::Command::new("git").args(["worktree", "add", "-q", "-b", "feat"]).arg(&wt).current_dir(&repo).status().unwrap().success());
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let ev = json!({ "kind": "event", "event": "pr-opened" });
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy() }, { "id": "p2", "name": "other", "path": dir.to_string_lossy() }]).to_string()).unwrap();
            let row = |id: &str, project: &str, trigger: &Value, on: bool| json!({ "id": id, "name": id, "prompt": "review it", "provider": "claude", "projectId": project, "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": trigger, "enabled": on });
            s.set(KEY, &json!([row("auto-1", "p1", &ev, true), row("auto-2", "p1", &ev, false), row("auto-3", "p2", &ev, true), row("auto-4", "p1", &json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" }), true), row("auto-5", "p1", &json!({ "kind": "event", "event": "checks-failed" }), true)]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let line = "Event: pull request #7 opened from feat: Fix https://github.com/o/r/pull/7";
        let path = wt.to_string_lossy().to_string();
        let started = on_event(&l, "pr-opened", &path, line, FRI_NOON).unwrap();
        // Only the switched-on automation of that repo listening for that event runs.
        assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-1"]);
        assert_eq!((started[0]["trigger"].as_str(), started[0]["status"].as_str(), started[0]["eventDetail"].as_str()), (Some("event"), Some("dispatched"), Some(line)));
        let start = said.borrow().iter().find(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").cloned().expect("a start");
        assert!(start.1["prompt"].as_str().unwrap().ends_with(line), "{}", start.1["prompt"]);
        // AUTO-013: the window learns which run the pane belongs to, so View run finds it.
        assert_eq!(start.1["runId"], started[0]["id"]);
        assert!(start.1["prompt"].as_str().unwrap().starts_with("review it"));
        // Another event inside five minutes is ignored; after that it runs again.
        assert!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 4 * 60_000).unwrap().is_empty());
        assert_eq!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 5 * 60_000 + 1).unwrap().len(), 1);
        // A folder that is not one of the project's worktrees starts nothing.
        assert!(on_event(&l, "pr-opened", &dir.join("elsewhere").to_string_lossy(), line, FRI_NOON + 20 * 60_000).unwrap().is_empty());
        // A worktree an automation made never sets off an automation (no automation triggers itself).
        projects::set_origin(&store.lock().unwrap(), &path, Some(&json!({ "madeBy": "automation", "automationId": "auto-9" }))).unwrap();
        assert!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 40 * 60_000).unwrap().is_empty());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t085e_agent_finished_fires_once_on_an_ordinary_finish_and_never_on_the_rest() {
        let mut seen = std::collections::HashMap::new();
        let step = |seen: &mut std::collections::HashMap<u32, bool>, state: &str, boundary: bool, child: bool, interrupted: bool| agent_finished(seen, 7, state, boundary, child, interrupted);
        // A session start reports done at its boundary: a starting point, not a finish.
        assert!(!step(&mut seen, "done", true, false, false));
        // Work, then an ordinary finish: fires exactly once.
        assert!(!step(&mut seen, "working", false, false, false));
        assert!(!step(&mut seen, "permission", false, false, false));
        assert!(step(&mut seen, "done", false, false, false));
        assert!(!step(&mut seen, "done", false, false, false), "the same finish reported again does not fire twice");
        // A restored or idle pane with no work seen in this process: its done never counts.
        assert!(!step(&mut seen, "done", false, false, false));
        // A sub-agent's finish inside a turn that goes on is not the lead's finish.
        assert!(!step(&mut seen, "working", false, false, false));
        assert!(!step(&mut seen, "done", false, true, false));
        // Ctrl+C: an interrupted turn ends without firing and spends the work seen.
        assert!(!step(&mut seen, "done", false, false, true));
        assert!(!step(&mut seen, "done", false, false, false));
        // /clear right after work forgets it: the boundary's done and the next idle done are no finish.
        assert!(!step(&mut seen, "working", false, false, false));
        assert!(!step(&mut seen, "done", true, false, false));
        assert!(!step(&mut seen, "done", false, false, false));
        // Another pane's work never counts for this one.
        assert!(!agent_finished(&mut seen, 8, "working", false, false, false));
        assert!(!step(&mut seen, "done", false, false, false));
        assert!(agent_finished(&mut seen, 8, "done", false, false, false));
        // A pane an automation run opened, by terminal or by hook pane, is its own and never fires.
        let runs = vec![json!({ "id": "run-1", "terminal": 3, "paneKey": 30 }), json!({ "id": "run-2", "lastTerminal": 4, "lastPaneKey": 40 })];
        assert!(own_pane(&runs, Some(3), 99) && own_pane(&runs, None, 30) && own_pane(&runs, Some(4), 99) && own_pane(&runs, None, 40));
        assert!(!own_pane(&runs, Some(5), 50) && !own_pane(&runs, None, 50));
    }

    #[test]
    fn t085e_an_agent_finish_in_a_watched_worktree_starts_the_listening_automation_only() {
        let dir = temp("t085e");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let wt = dir.join("feat");
        assert!(std::process::Command::new("git").args(["worktree", "add", "-q", "-b", "feat"]).arg(&wt).current_dir(&repo).status().unwrap().success());
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy() }]).to_string()).unwrap();
            let row = |id: &str, event: &str| json!({ "id": id, "name": id, "prompt": "tidy up", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": { "kind": "event", "event": event }, "enabled": true });
            s.set(KEY, &json!([row("auto-fin", "agent-finished"), row("auto-pr", "pr-opened")]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let line = "Event: claude finished its work in feat";
        // An unwatched session: a folder that is no worktree of any project starts nothing.
        assert!(on_event(&l, "agent-finished", &dir.join("elsewhere").to_string_lossy(), line, FRI_NOON).unwrap().is_empty());
        // A finish in the project's worktree starts only the automation listening for it.
        let started = on_event(&l, "agent-finished", &wt.to_string_lossy(), line, FRI_NOON).unwrap();
        assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-fin"]);
        assert_eq!((started[0]["trigger"].as_str(), started[0]["status"].as_str(), started[0]["eventDetail"].as_str()), (Some("event"), Some("dispatched"), Some(line)));
        let start = said.borrow().iter().find(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").cloned().expect("a start");
        assert!(start.1["prompt"].as_str().unwrap().ends_with(line), "{}", start.1["prompt"]);
        // The run it started is this automation's own pane once a terminal claims it: no self-trigger.
        let s = store.lock().unwrap();
        claim(&s, 11, Some(110), &repo.to_string_lossy(), Some("claude")).unwrap();
        assert!(own_pane(&load(&s, RUNS_KEY).unwrap(), Some(11), 110));
        drop(s);
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn checked(pairs: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        pairs.iter().map(|(p, w)| (p.to_string(), w.to_string())).collect()
    }

    #[test]
    fn t085d_checks_failed_fires_once_on_the_step_into_failing_and_never_on_the_rest() {
        let mut seen = std::collections::HashMap::new();
        let round = |seen: &mut std::collections::HashMap<String, String>, word: Option<&str>| {
            let checks = word.map(|w| checked(&[("C:/a", w)])).unwrap_or_default();
            checks_failed(seen, &[polled("C:/a", Some("OPEN"))], &checks).len()
        };
        // The first state learned is a starting point, even a red one.
        assert_eq!(round(&mut seen, Some("running")), 0);
        // Pending to failing fires once; red checks that stay red do not fire again.
        assert_eq!(round(&mut seen, Some("failing")), 1);
        assert_eq!(round(&mut seen, Some("failing")), 0);
        // An unknown or absent reading is no news: it neither fires nor forgets the red state.
        assert_eq!(round(&mut seen, Some("unresolved")), 0);
        assert_eq!(round(&mut seen, None), 0);
        assert_eq!(round(&mut seen, Some("failing")), 0);
        // Red to running to red (a new push failing again) fires again; running to passing never does.
        assert_eq!(round(&mut seen, Some("running")), 0);
        assert_eq!(round(&mut seen, Some("failing")), 1);
        assert_eq!(round(&mut seen, Some("running")), 0);
        assert_eq!(round(&mut seen, Some("passing")), 0);
        // Passing to failing fires.
        assert_eq!(round(&mut seen, Some("failing")), 1);
        // Starting on red never fires; a closed pull request is forgotten, and a failed lookup is no news.
        let mut fresh = std::collections::HashMap::new();
        assert_eq!(round(&mut fresh, Some("failing")), 0);
        assert_eq!(checks_failed(&mut seen, &[polled("C:/a", Some("CLOSED"))], &checked(&[("C:/a", "failing")])).len(), 0);
        assert!(seen.is_empty());
        let mut e = polled("C:/a", Some("OPEN"));
        e.error = Some("rate limited".into());
        assert_eq!(checks_failed(&mut seen, &[e], &checked(&[("C:/a", "failing")])).len(), 0);
        assert!(seen.is_empty());
        // The fired pull request is the one the poll found, under the folder the poll named.
        let mut s2 = std::collections::HashMap::new();
        checks_failed(&mut s2, &[polled("C:/b", Some("OPEN"))], &checked(&[("C:/b", "passing")]));
        let fired = checks_failed(&mut s2, &[polled("C:/b", Some("OPEN"))], &checked(&[("C:/b", "failing")]));
        assert_eq!(fired.iter().map(|(p, pr)| (p.as_str(), pr.number)).collect::<Vec<_>>(), [("C:/b", 7)]);
    }

    #[test]
    fn t085d_a_restart_keeps_the_last_checks_state_so_red_checks_do_not_fire_again() {
        let dir = temp("t085d");
        let store = Store::open(&dir.join("db")).unwrap();
        let open = [polled("C:/a", Some("OPEN"))];
        assert!(checks_round(&store, &open, &checked(&[("C:/a", "running")])).unwrap().is_empty());
        assert_eq!(checks_round(&store, &open, &checked(&[("C:/a", "failing")])).unwrap().len(), 1);
        drop(store);
        // Kolux restarts: the saved state is read back, so the same red state is no news.
        let store = Store::open(&dir.join("db")).unwrap();
        assert!(checks_round(&store, &open, &checked(&[("C:/a", "failing")])).unwrap().is_empty());
        // A pull request that moved on while Kolux was shut, red again after green, still fires.
        assert!(checks_round(&store, &open, &checked(&[("C:/a", "passing")])).unwrap().is_empty());
        drop(store);
        let store = Store::open(&dir.join("db")).unwrap();
        assert_eq!(checks_round(&store, &open, &checked(&[("C:/a", "failing")])).unwrap().len(), 1);
        // A different pull request on the same folder starts afresh.
        let mut next = polled("C:/a", Some("OPEN"));
        next.pr.as_mut().unwrap().number = 8;
        assert!(checks_round(&store, &[next], &checked(&[("C:/a", "failing")])).unwrap().is_empty());
        assert_eq!(crate::orchestration::kept::load::<std::collections::HashMap<String, String>>(&store, CHECKS_SEEN_KEY).unwrap().len(), 1);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t085d_a_checks_failure_in_a_watched_worktree_starts_the_listening_automation_only() {
        let dir = temp("t085dr");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let wt = dir.join("feat");
        assert!(std::process::Command::new("git").args(["worktree", "add", "-q", "-b", "feat"]).arg(&wt).current_dir(&repo).status().unwrap().success());
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy() }]).to_string()).unwrap();
            let row = |id: &str, event: &str| json!({ "id": id, "name": id, "prompt": "fix the build", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": { "kind": "event", "event": event }, "enabled": true });
            s.set(KEY, &json!([row("auto-red", "checks-failed"), row("auto-fin", "agent-finished")]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let path = wt.to_string_lossy().to_string();
        let line = "Event: checks failed on pull request #7 from feat: Fix https://github.com/o/r/pull/7";
        let started = on_event(&l, "checks-failed", &path, line, FRI_NOON).unwrap();
        assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-red"]);
        assert_eq!((started[0]["trigger"].as_str(), started[0]["eventDetail"].as_str()), (Some("event"), Some(line)));
        assert!(on_event(&l, "checks-failed", &dir.join("elsewhere").to_string_lossy(), line, FRI_NOON + 600_000).unwrap().is_empty());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto004_saving_an_event_drops_the_timetable_and_going_back_works_it_out_afresh() {
        let dir = temp("a004s");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let base = json!({ "name": "Review", "prompt": "look", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": dir.to_string_lossy(), "schedule": { "preset": "hourly", "time": "00:15", "timezone": "UTC" } });
        let mut ev = base.clone();
        ev["trigger"] = json!({ "kind": "event", "event": "pr-opened" });
        let saved = save_automation(&store, &ev, FRI_NOON).unwrap();
        assert_eq!((saved["trigger"].clone(), saved["nextRunAt"].clone()), (json!({ "kind": "event", "event": "pr-opened" }), Value::Null));
        let mut back = base.clone();
        back["id"] = saved["id"].clone();
        let timed = save_automation(&store, &back, FRI_NOON).unwrap();
        assert_eq!((timed["trigger"]["kind"].as_str(), timed["nextRunAt"].as_i64()), (Some("schedule"), Some(FRI_NOON + 15 * 60_000)));
        ev["trigger"]["event"] = json!("lunch");
        assert!(save_automation(&store, &ev, FRI_NOON).unwrap_err().contains("event"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_saved_list_is_an_error_not_an_empty_one() {
        let dir = temp("broken");
        let store = Store::open(&dir).unwrap();
        assert_eq!(list(&store).unwrap()["automations"], json!([]));
        store.set(KEY, "{not json").unwrap();
        assert!(list(&store).unwrap_err().contains("could not be read"));
        // AUTO-018: history that cannot be read leaves the automations readable and says so,
        // so the page shows the run count as unknown rather than 0.
        store.set(KEY, "[]").unwrap();
        store.set(RUNS_KEY, "{not json").unwrap();
        let out = list(&store).unwrap();
        assert_eq!((out["automations"].clone(), out["runs"].clone()), (json!([]), json!([])));
        assert!(out["runsError"].as_str().unwrap().contains("could not be read"));
        // AUTO-013: a run whose worktree folder is gone says so, so the page opens its saved output.
        let here = dir.to_string_lossy().to_string();
        store.set(RUNS_KEY, &json!([{ "id": "r1", "worktree": here }, { "id": "r2", "worktree": dir.join("gone").to_string_lossy() }, { "id": "r3" }]).to_string()).unwrap();
        let runs = list(&store).unwrap()["runs"].clone();
        assert_eq!((runs[0].get("worktreeGone"), &runs[1]["worktreeGone"], runs[2].get("worktreeGone")), (None, &json!(true), None));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto024_a_run_that_makes_its_own_worktree_marks_it_made_by_an_automation() {
        let dir = temp("a024");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy(), "workspacesDir": dir.join("wts").to_string_lossy() }]).to_string()).unwrap();
            s.set(KEY, &json!([{ "id": "auto-9", "name": "Sweep", "prompt": "tidy", "provider": "claude", "projectId": "p1", "workspaceMode": "new-per-run", "enabled": false }]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        assert_eq!(run(&l, "auto-9", "manual").unwrap()["status"], json!("dispatched"));
        let s = store.lock().unwrap();
        let project = projects::load_projects(&s)[0].clone();
        let listed = projects::list_workspaces(&git, &s, &project).unwrap();
        let made = listed.iter().find(|w| !w.is_main).expect("the run's worktree");
        assert_eq!(made.made_by.as_deref(), Some("automation"));
        // A worktree made by hand is not tagged.
        assert_eq!(listed.iter().find(|w| w.is_main).unwrap().made_by.as_deref(), None);
        drop(s);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_now_on_a_paused_automation_starts_a_manual_run_and_numbers_only_go_up() {
        let dir = temp("run");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        let first = run(&l, "auto-1", "manual").unwrap();
        assert_eq!((first["number"].as_u64(), first["status"].as_str(), first["trigger"].as_str()), (Some(1), Some("dispatched"), Some("manual")));
        let start = said.borrow().iter().find(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").cloned().expect("a start for the window");
        assert_eq!((start.1["agent"].as_str(), start.1["prompt"].as_str(), start.1["title"].as_str()), (Some("claude"), Some("check"), Some("Nightly")));
        // The paused automation stays paused.
        assert_eq!(list(&store.lock().unwrap()).unwrap()["automations"][0]["enabled"], json!(false));

        // Deleting history never hands a number out twice.
        store.lock().unwrap().set(RUNS_KEY, "[]").unwrap();
        assert_eq!(run(&l, "auto-1", "manual").unwrap()["number"], json!(2));

        // A project that is gone: Run now is refused with the reason, never a launch (AUTO-022).
        let before = said.borrow().len();
        assert!(run(&l, "auto-2", "manual").unwrap_err().contains("project"));
        assert_eq!(said.borrow().len(), before);

        // An agent that is not installed: failed to dispatch.
        let no = |_: &str| false;
        let l2 = Launch { installed: &no, ..l };
        assert_eq!(run(&l2, "auto-1", "manual").unwrap()["status"], json!("failed"));
        drop(l2);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pause_and_delete_take_their_runs_with_them() {
        let dir = temp("del");
        let store = Store::open(&dir).unwrap();
        seed(&store, &dir);
        new_run(&store, "auto-1", "manual").unwrap();
        new_run(&store, "auto-2", "manual").unwrap();
        assert_eq!(set_enabled(&store, "auto-2", false).unwrap()["enabled"], json!(false));
        delete(&store, "auto-1").unwrap();
        let after = list(&store).unwrap();
        assert_eq!(after["automations"].as_array().unwrap().len(), 1);
        assert!(after["runs"].as_array().unwrap().iter().all(|r| r["automationId"] == "auto-2"));
        assert!(delete(&store, "auto-1").is_err());
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Friday 9 October 2026, 12:00 UTC.
    const FRI_NOON: i64 = 1_791_547_200_000;

    fn form(ws: &Path, schedule: Value) -> Value {
        json!({ "requestId": "r1", "name": "Morning", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "schedule": schedule })
    }

    #[test]
    fn auto010_a_new_per_run_worktree_runs_the_setup_only_when_chosen_and_old_ones_skip() {
        let dir = temp("auto010");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let schedule = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
        let mut f = form(&dir, schedule.clone());
        f["workspaceMode"] = json!("new-per-run");
        f["runSetup"] = json!(true);
        assert_eq!(save_automation(&store, &f, FRI_NOON).unwrap()["runSetup"], json!(true));
        let mut f = form(&dir, schedule.clone());
        f["requestId"] = json!("r2");
        f["runSetup"] = json!(true);
        assert_eq!(save_automation(&store, &f, FRI_NOON).unwrap()["runSetup"], json!(false), "an existing worktree never runs setup again");
        let mut f = form(&dir, schedule);
        f["requestId"] = json!("r3");
        f["workspaceMode"] = json!("new-per-run");
        assert_eq!(save_automation(&store, &f, FRI_NOON).unwrap()["runSetup"], json!(false), "no choice sent is skip");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);

        let wt = Worktree { name: Some("run-1".into()), branch: Some("b".into()), head: String::new(), is_main: false, path: "C:/w/run-1".into(), parent: None, locked: None, hidden: false, kind: String::new(), source: None, made_by: None, number: None, comment: None };
        assert_eq!(created_event("p1", &wt, &json!({ "runSetup": true }))["setup"], json!("run"));
        assert_eq!(created_event("p1", &wt, &json!({ "runSetup": false }))["setup"], json!("skip"));
        let old = created_event("p1", &wt, &json!({ "name": "made before the choice existed" }));
        assert_eq!((old["setup"].as_str(), old["kind"].as_str(), old["worktree"]["path"].as_str()), (Some("skip"), Some("created"), Some("C:/w/run-1")));
    }

    #[test]
    fn saving_checks_everything_and_a_doubled_create_makes_one_automation() {
        let dir = temp("save");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
        let mut bad = form(&dir, weekdays.clone());
        bad["name"] = json!("  ");
        assert!(save_automation(&store, &bad, FRI_NOON).unwrap_err().contains("name"));
        bad = form(&dir, json!({ "preset": "custom", "custom": "61 * * * *", "timezone": "UTC" }));
        assert!(save_automation(&store, &bad, FRI_NOON).is_err());
        bad = form(&dir, json!({ "preset": "custom", "custom": "0 0 30 2 *", "timezone": "UTC" }));
        assert!(save_automation(&store, &bad, FRI_NOON).unwrap_err().contains("never"));
        bad = form(&dir, weekdays.clone());
        bad["projectId"] = json!("nope");
        assert!(save_automation(&store, &bad, FRI_NOON).is_err());
        assert_eq!(list(&store).unwrap()["automations"].as_array().unwrap().len(), 2, "nothing written by a refused save");

        let made = save_automation(&store, &form(&dir, weekdays.clone()), FRI_NOON).unwrap();
        assert_eq!((made["id"].as_str(), made["enabled"].as_bool()), (Some("auto-3"), Some(true)));
        assert_eq!(made["nextRunLabel"], json!("Monday 09:00"));
        assert_eq!(made["form"]["preset"], json!("weekdays"));
        let again = save_automation(&store, &form(&dir, weekdays), FRI_NOON).unwrap();
        assert_eq!(again["id"], made["id"]);
        assert_eq!(list(&store).unwrap()["automations"].as_array().unwrap().len(), 3);

        let mut edit = form(&dir, json!({ "preset": "custom", "custom": "0 0 29 2 *", "timezone": "UTC" }));
        edit["id"] = json!("auto-3");
        edit["requestId"] = json!("r2");
        let leap = save_automation(&store, &edit, FRI_NOON).unwrap();
        assert_eq!(leap["nextRunLabel"], json!("29 Feb 2028 00:00"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_clock_starts_what_is_due_leaves_paused_ones_and_moves_a_missed_time_on() {
        let dir = temp("tick");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let every = json!({ "kind": "schedule", "cron": "* * * * *", "timezone": "UTC" });
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let base = json!({ "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": every });
            let row = |id: &str, enabled: bool, at: i64| {
                let mut r = base.clone();
                r["id"] = json!(id);
                r["name"] = json!(id);
                r["enabled"] = json!(enabled);
                r["nextRunAt"] = json!(at);
                r
            };
            let mut autos = json!([row("due", true, FRI_NOON), row("paused", false, FRI_NOON), row("missed", true, FRI_NOON - 5_400_000), row("later", true, FRI_NOON + 60_000)]);
            // Half past every hour: 11:30 was missed and nothing has fallen due since.
            autos[2]["trigger"]["cron"] = json!("30 * * * *");
            s.set(KEY, &autos.to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let started = tick(&l, FRI_NOON + 5_000).unwrap();
        assert_eq!(started.iter().filter(|r| r["status"] == "dispatched").count(), 1);
        assert_eq!((started[0]["automationId"].as_str(), started[0]["trigger"].as_str()), (Some("due"), Some("schedule")));
        let after = list(&store.lock().unwrap()).unwrap();
        let next = |id: &str| after["automations"].as_array().unwrap().iter().find(|a| a["id"] == id).unwrap()["nextRunAt"].as_i64();
        assert!(next("due").unwrap() > FRI_NOON + 5_000, "a run moves the time on");
        assert!(next("missed").unwrap() > FRI_NOON + 5_000, "a missed time is moved on, not run");
        assert_eq!(next("paused"), Some(FRI_NOON));
        let runs = after["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 2, "the run that began and one skipped entry for the missed time");
        assert!(runs.iter().any(|r| r["automationId"] == "missed" && r["cause"] == "missed"));
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_precheck_gates_timed_runs_never_run_now_and_has_a_limit() {
        let dir = temp("precheck");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let mut f = form(&ws, json!({ "preset": "hourly", "time": "00:15", "timezone": "UTC" }));
            f["precheck"] = json!("echo x > ran.txt; echo nope; exit 1");
            f["precheckTimeoutSeconds"] = json!(90);
            assert!(save_automation(&s, &f, FRI_NOON).unwrap_err().contains("10 minutes"));
            f["precheckTimeoutSeconds"] = Value::Null;
            let made = save_automation(&s, &f, FRI_NOON).unwrap();
            assert_eq!((made["id"].as_str(), made["precheckTimeoutSeconds"].as_u64()), (Some("auto-3"), Some(60)), "60 seconds when none is chosen");
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        // A timed run: the precheck runs in the worktree, exits 1, and the run is skipped with its output.
        let skipped = run(&l, "auto-3", "schedule").unwrap();
        assert_eq!((skipped["status"].as_str(), skipped["cause"].as_str(), skipped["exitCode"].as_i64()), (Some("skipped"), Some("precheck"), Some(1)), "{skipped}");
        assert!(skipped["output"].as_str().unwrap().contains("nope"));
        assert!(ws.join("ran.txt").exists(), "it ran in the target worktree");
        std::fs::remove_file(ws.join("ran.txt")).unwrap();

        // Run now never runs the precheck: the agent launches.
        assert_eq!(run(&l, "auto-3", "manual").unwrap()["status"], json!("dispatched"));
        assert!(!ws.join("ran.txt").exists());

        // Exit 0 lets the timed run go on.
        {
            let s = store.lock().unwrap();
            let mut autos = load(&s, KEY).unwrap();
            autos[2]["precheck"] = json!("exit 0");
            save(&s, KEY, &autos).unwrap();
        }
        assert_eq!(run(&l, "auto-3", "schedule").unwrap()["status"], json!("dispatched"));

        // Past its limit it is stopped and the run reads timed out.
        let began = std::time::Instant::now();
        let out = run_precheck("sleep 20", &ws, std::time::Duration::from_millis(1500)).unwrap();
        assert!(began.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit");
        assert_eq!((out["timedOut"].as_bool(), out["cause"].as_str()), (Some(true), Some("precheck")));
        assert!(out["detail"].as_str().unwrap().contains("limit"));
        assert!(run_precheck("exit 0", &ws, std::time::Duration::from_secs(30)).is_none());

        // Up to 4,000 characters of what it printed are kept: the end, where the error is.
        let long = format!("{}END", "x".repeat(5000));
        let kept = keep_tail(&long);
        assert_eq!(kept.chars().count(), 4000);
        assert!(kept.ends_with("END"));
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn runs_of(store: &Mutex<Store>, id: &str) -> Vec<Value> {
        let all = list(&store.lock().unwrap()).unwrap();
        all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == id).cloned().collect()
    }

    #[test]
    fn a_missed_time_runs_late_inside_its_grace_window_and_is_logged_once_past_it() {
        let dir = temp("grace");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let hourly = json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" });
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let mut f = form(&ws, json!({ "preset": "hourly", "time": "09:00", "timezone": "UTC" }));
            f["missedRunGraceMinutes"] = json!(45);
            assert!(save_automation(&s, &f, FRI_NOON).unwrap_err().contains("30 minutes"));
            f["missedRunGraceMinutes"] = json!(180);
            assert_eq!(save_automation(&s, &f, FRI_NOON).unwrap()["missedRunGraceMinutes"], json!(180));
            let row = |id: &str, grace: u64| json!({ "id": id, "name": id, "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": hourly, "enabled": true, "nextRunAt": FRI_NOON, "missedRunGraceMinutes": grace });
            s.set(KEY, &json!([row("late", 30), row("strict", 0)]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        // Kolux shut over noon and back at 12:20: 30 minutes of grace runs late, none skips.
        let started = tick(&l, FRI_NOON + 20 * 60_000).unwrap();
        assert_eq!(started.iter().filter(|r| r["status"] == "dispatched").map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["late"]);
        let strict = runs_of(&store, "strict");
        assert_eq!(strict.len(), 1);
        assert_eq!((strict[0]["status"].as_str(), strict[0]["cause"].as_str()), (Some("skipped"), Some("missed")));
        assert!(strict[0]["detail"].as_str().unwrap().contains("not available"));

        // Shut for three hours more with no grace: a single skipped entry, never one per hour.
        tick(&l, FRI_NOON + 200 * 60_000).unwrap();
        tick(&l, FRI_NOON + 200 * 60_000 + 30_000).unwrap();
        let strict = runs_of(&store, "strict");
        assert_eq!(strict.len(), 2);
        assert!(strict.iter().all(|r| r["status"] == "skipped"));
        let next = list(&store.lock().unwrap()).unwrap()["automations"][1]["nextRunAt"].as_i64();
        assert_eq!(next, Some(FRI_NOON + 4 * 3_600_000), "the timetable carries on");
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_keeps_the_newest_100_runs_and_never_drops_one_in_progress() {
        let dir = temp("cap");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        // Not installed: every run fails to start, so it is finished at once.
        let no = |_: &str| false;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &no, notify: &notify };
        new_run(&store.lock().unwrap(), "auto-1", "manual").unwrap(); // #1 stays queued: in progress
        for _ in 0..104 {
            run(&l, "auto-1", "manual").unwrap();
        }
        let numbers = || {
            let mut n: Vec<u64> = runs_of(&store, "auto-1").iter().map(|r| r["number"].as_u64().unwrap()).collect();
            n.sort();
            n
        };
        let mut want: Vec<u64> = vec![1];
        want.extend(7..=105);
        assert_eq!(numbers(), want, "the run in progress stays past the cap");
        patch_run(&store.lock().unwrap(), "run-1", json!({ "status": "completed" })).unwrap();
        assert!(numbers().contains(&1), "it finishes and stays listed");
        assert_eq!(run(&l, "auto-1", "manual").unwrap()["number"], json!(106));
        assert_eq!(numbers(), (7..=106).collect::<Vec<u64>>());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn loading_numbers_old_runs_and_cuts_an_oversized_history() {
        let dir = temp("tidy");
        let store = Store::open(&dir).unwrap();
        seed(&store, &dir);
        let mut runs: Vec<Value> = (1..=120u64).map(|i| json!({ "id": format!("run-{i}"), "automationId": "auto-1", "number": i, "status": "failed", "at": i })).collect();
        runs.push(json!({ "id": "run-121", "automationId": "auto-2", "status": "skipped", "at": 5 }));
        store.set(RUNS_KEY, &Value::Array(runs).to_string()).unwrap();
        tidy(&store, 0).unwrap();
        let all = list(&store).unwrap();
        let mine: Vec<u64> = all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == "auto-1").map(|r| r["number"].as_u64().unwrap()).collect();
        assert_eq!(mine, (21..=120).collect::<Vec<u64>>());
        let other: Vec<&Value> = all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == "auto-2").collect();
        assert_eq!(other[0]["number"], json!(1), "an old run without a number is given one");
        assert_eq!(new_run(&store, "auto-2", "manual").unwrap()["number"], json!(2));
        assert_eq!(new_run(&store, "auto-1", "manual").unwrap()["number"], json!(121));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_the_same_refusal_again_and_again_is_one_entry_with_a_count() {
        let dir = temp("repeat");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        // Every five minutes for an hour, with auto-2's project gone.
        for k in 0..12 {
            {
                let s = store.lock().unwrap();
                let mut autos = load(&s, KEY).unwrap();
                autos[1]["trigger"] = json!({ "kind": "schedule", "cron": "*/5 * * * *", "timezone": "UTC" });
                autos[1]["nextRunAt"] = json!(FRI_NOON + k * 300_000);
                save(&s, KEY, &autos).unwrap();
            }
            tick(&l, FRI_NOON + k * 300_000 + 5_000).unwrap();
        }
        let gone = runs_of(&store, "auto-2");
        assert_eq!(gone.len(), 1, "{gone:?}");
        assert_eq!((gone[0]["status"].as_str(), gone[0]["cause"].as_str(), gone[0]["repeats"].as_u64()), (Some("skipped"), Some("unavailable"), Some(12)));
        // A different reason starts a new entry.
        {
            let s = store.lock().unwrap();
            skip(&s, "auto-2", "schedule", "missed", "Kolux was not available").unwrap();
        }
        assert_eq!(runs_of(&store, "auto-2").len(), 2);
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_after_a_restart_a_run_never_handed_on_is_closed_and_a_running_one_is_kept() {
        let dir = temp("restart");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let runs = json!([
            { "id": "run-1", "automationId": "auto-1", "number": 1, "status": "pending", "at": 1 },
            { "id": "run-2", "automationId": "auto-1", "number": 2, "status": "dispatching", "at": 2 },
            { "id": "run-3", "automationId": "auto-1", "number": 3, "status": "dispatched", "at": 3 },
        ]);
        store.set(RUNS_KEY, &runs.to_string()).unwrap();
        tidy(&store, 0).unwrap();
        let got = load(&store, RUNS_KEY).unwrap();
        let st: Vec<&str> = got.iter().map(|r| r["status"].as_str().unwrap()).collect();
        assert_eq!(st, ["failed", "failed", "dispatched"], "Kolux cannot tell a running agent was lost, so it stays dispatched");
        assert!(got[0]["detail"].as_str().unwrap().contains("closed before"), "{}", got[0]);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_now_refuses_a_target_that_is_not_ready_and_the_clock_logs_it_skipped() {
        let dir = temp("ready");
        let ws = dir.join("gone-ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        std::fs::remove_dir_all(&ws).unwrap();
        let why = run(&l, "auto-1", "manual").unwrap_err();
        assert!(why.contains("worktree") && why.contains("gone-ws"), "{why}");
        assert!(runs_of(&store, "auto-1").is_empty(), "a refused Run now leaves no run behind");
        let shown = list(&store.lock().unwrap()).unwrap();
        assert!(shown["automations"][0]["problem"].as_str().unwrap().contains("worktree"));
        assert!(shown["automations"][1]["problem"].as_str().unwrap().contains("project"));

        // A due time passes with the project removed: one skipped entry marked unavailable.
        {
            let s = store.lock().unwrap();
            let mut autos = load(&s, KEY).unwrap();
            autos[1]["trigger"] = json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" });
            autos[1]["nextRunAt"] = json!(FRI_NOON);
            save(&s, KEY, &autos).unwrap();
        }
        tick(&l, FRI_NOON + 5_000).unwrap();
        let gone = runs_of(&store, "auto-2");
        assert_eq!(gone.len(), 1);
        assert_eq!((gone[0]["status"].as_str(), gone[0]["cause"].as_str()), (Some("skipped"), Some("unavailable")));

        // The agent's account needs signing in again: named, and Run now is blocked.
        std::fs::create_dir_all(&ws).unwrap();
        {
            let s = store.lock().unwrap();
            let acct = json!([{ "id": "a1", "email": "me@example.com", "organization": null, "configDir": "c", "lastSignIn": 0, "stale": true }]);
            s.set(crate::claude_accounts::LIST_KEY, &acct.to_string()).unwrap();
            s.set(crate::claude_accounts::ACTIVE_KEY, "a1").unwrap();
        }
        let why = run(&l, "auto-1", "manual").unwrap_err();
        assert!(why.contains("me@example.com") && why.contains("sign"), "{why}");
        assert!(runs_of(&store, "auto-1").is_empty());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn dispatched(store: &Store, ws: &Path, n: u64, provider: &str) {
        let mut runs = load(store, RUNS_KEY).unwrap();
        runs.push(json!({ "id": format!("run-{n}"), "automationId": "auto-1", "number": n, "status": "dispatched", "at": n, "worktree": ws.to_string_lossy(), "provider": provider }));
        save(store, RUNS_KEY, &runs).unwrap();
    }

    fn status_of(store: &Store, id: &str) -> (String, String) {
        let r = load(store, RUNS_KEY).unwrap().into_iter().find(|r| r["id"] == id).unwrap();
        (r["status"].as_str().unwrap().to_string(), r["detail"].as_str().unwrap_or_default().to_string())
    }

    #[test]
    fn t140e_the_agent_session_id_reaches_the_run_and_the_newest_one_wins() {
        let dir = temp("t140e");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        claim(&store, 6, Some(60), &ws.to_string_lossy(), Some("claude")).unwrap();
        let session = || load(&store, RUNS_KEY).unwrap().into_iter().find(|r| r["id"] == "run-1").unwrap()["sessionId"].clone();
        // The session start reports at its boundary and carries the id: kept, nothing finished.
        assert_eq!(on_status(&store, Some(6), 60, "done", true, false, Some("sess-a"), 10).unwrap(), None);
        assert_eq!(session(), json!("sess-a"));
        assert_eq!(status_of(&store, "run-1").0, "dispatched");
        // A sub-agent's event never sets it; an event without an id leaves it.
        on_status(&store, Some(6), 60, "working", false, true, Some("sess-child"), 11).unwrap();
        on_status(&store, Some(6), 60, "working", false, false, None, 12).unwrap();
        assert_eq!(session(), json!("sess-a"));
        // A new session in the same pane (a clear) replaces it, on a boundary or a plain status.
        on_status(&store, Some(6), 60, "done", true, false, Some("sess-b"), 13).unwrap();
        assert_eq!(session(), json!("sess-b"));
        on_status(&store, Some(6), 60, "permission", false, false, Some("sess-c"), 14).unwrap();
        assert_eq!(session(), json!("sess-c"));
        // The finish still completes the run, and the id stays on it.
        assert_eq!(on_status(&store, Some(6), 60, "done", false, false, Some("sess-c"), 15).unwrap().as_deref(), Some("run-1"));
        assert_eq!(status_of(&store, "run-1").0, "completed");
        assert_eq!(session(), json!("sess-c"));
        // Another pane's status never writes on this run.
        dispatched(&store, &ws, 2, "claude");
        on_status(&store, Some(7), 70, "working", false, false, Some("sess-x"), 16).unwrap();
        assert_eq!(session(), json!("sess-c"));
    }

    #[test]
    fn auto014_a_finished_run_keeps_its_pane_text_clean_once_and_only_the_latest_past_the_limit() {
        // A Codex-style progress bar redrawn with carriage returns, colours, a title change and blank lines.
        let mut log = crate::terminal::OutputLog::default();
        log.push(b"\x1b[1mWorking\x1b[0m\r\n\x1b[32m[##   ] 10%\r\x1b[32m[#### ] 80%\r[#####] 100%\x1b[0m\r\n\r\n\r\n\x1b]0;codex\x07Done: 3 files changed\r\n\r\n");
        let (text, cut) = screen_text(&log.read(None, Some(RUN_OUTPUT_LINES)));
        assert_eq!(text, "Working\n[#####] 100%\n\nDone: 3 files changed");
        assert!(!cut);
        assert!(!text.contains('\x1b') && !text.contains('\r'), "{text:?}");
        // Past the size limit the most recent text stays, starting at a whole line.
        let mut big = crate::terminal::OutputLog::default();
        for i in 0..2000 {
            big.push(format!("line {i:04} {}\n", "x".repeat(40)).as_bytes());
        }
        let (text, cut) = screen_text(&big.read(None, Some(RUN_OUTPUT_LINES)));
        assert!(cut);
        assert!(text.chars().count() <= RUN_OUTPUT_CHARS);
        assert!(text.starts_with("line ") && text.ends_with(&format!("line 1999 {}", "x".repeat(40))), "{}", &text[..40]);

        let dir = temp("output");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "codex");
        // Still going: nothing is saved yet.
        assert_eq!(keep_output(&store, "run-1", "partial", false).unwrap(), None);
        claim(&store, 6, Some(60), &ws.to_string_lossy(), Some("codex")).unwrap();
        on_status(&store, Some(6), 60, "working", false, false, None, 10).unwrap();
        on_status(&store, Some(6), 60, "done", false, false, None, 11).unwrap();
        // Nothing on screen saves nothing; then the text is kept, once.
        assert_eq!(keep_output(&store, "run-1", "  \n", false).unwrap(), None);
        assert_eq!(keep_output(&store, "run-1", "Done: 3 files changed", false).unwrap().as_deref(), Some("run-1"));
        assert_eq!(keep_output(&store, "run-1", "later text", true).unwrap(), None);
        let r = list(&store).unwrap()["runs"][0].clone();
        assert_eq!((r["output"].as_str(), r["outputFrom"].as_str(), r["outputCut"].as_bool()), (Some("Done: 3 files changed"), Some("screen"), Some(false)));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    struct FakePanes {
        /// The only terminal that is open, the same pane and idle.
        idle: Mutex<Option<(u32, u32)>>,
        sent: Mutex<Vec<(u32, String)>>,
    }

    impl Panes for FakePanes {
        fn idle(&self, terminal: u32, pane_key: Option<u32>) -> bool {
            *self.idle.lock().unwrap() == pane_key.map(|p| (terminal, p))
        }
        fn send(&self, terminal: u32, text: &str) -> Result<(), String> {
            self.sent.lock().unwrap().push((terminal, text.to_string()));
            Ok(())
        }
    }

    #[test]
    fn t192c_reuse_is_for_an_existing_worktree_and_an_edit_that_leaves_it_out_keeps_it() {
        let dir = temp("t192s");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let base = json!({ "name": "Review", "prompt": "look", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": dir.to_string_lossy(), "schedule": { "preset": "hourly", "time": "00:15", "timezone": "UTC" } });
        let plain = save_automation(&store, &base, FRI_NOON).unwrap();
        assert_eq!(plain["reuseSession"], json!(false));
        let mut on = base.clone();
        on["reuseSession"] = json!(true);
        on["id"] = plain["id"].clone();
        assert_eq!(save_automation(&store, &on, FRI_NOON).unwrap()["reuseSession"], json!(true));
        // An edit that does not mention it keeps it; saying false (--fresh-session) turns it off.
        let mut quiet = base.clone();
        quiet["id"] = plain["id"].clone();
        assert_eq!(save_automation(&store, &quiet, FRI_NOON).unwrap()["reuseSession"], json!(true));
        quiet["reuseSession"] = json!(false);
        assert_eq!(save_automation(&store, &quiet, FRI_NOON).unwrap()["reuseSession"], json!(false));
        // A new worktree for every run always opens a new session: asking to reuse is refused, and an
        // edit into that mode that says nothing drops a reuse it held.
        let mut fresh = base.clone();
        fresh["workspaceMode"] = json!("new-per-run");
        fresh["workspace"] = Value::Null;
        fresh["reuseSession"] = json!(true);
        assert!(save_automation(&store, &fresh, FRI_NOON).unwrap_err().contains("existing worktree"));
        fresh["id"] = plain["id"].clone();
        fresh["reuseSession"] = Value::Null;
        on["reuseSession"] = json!(true);
        save_automation(&store, &on, FRI_NOON).unwrap();
        assert_eq!(save_automation(&store, &fresh, FRI_NOON).unwrap()["reuseSession"], json!(false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t192c_a_run_continues_in_the_last_runs_session_only_while_it_is_open_idle_and_the_same_pane() {
        let dir = temp("t192r");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let panes = std::sync::Arc::new(FakePanes { idle: Mutex::new(None), sent: Mutex::new(Vec::new()) });
        use_panes(panes.clone());
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let starts = || said.borrow().iter().filter(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").count();
        let finish = |terminal: u32, pane: u32| {
            let s = store.lock().unwrap();
            claim(&s, terminal, Some(pane), &ws.to_string_lossy(), Some("claude")).unwrap();
            on_status(&s, Some(terminal), pane, "working", false, false, None, 10).unwrap();
            assert!(on_status(&s, Some(terminal), pane, "done", false, false, None, 11).unwrap().is_some());
        };
        let reuse = |on: bool| {
            let s = store.lock().unwrap();
            let mut autos = load(&s, KEY).unwrap();
            autos[0]["reuseSession"] = json!(on);
            save(&s, KEY, &autos).unwrap();
        };

        // Reuse off: every run opens a tab, even with an idle session around.
        let first = run(&l, "auto-1", "manual").unwrap();
        assert_eq!((starts(), first["reused"].is_null()), (1, true));
        finish(6, 60);
        *panes.idle.lock().unwrap() = Some((6, 60));
        assert_eq!(run(&l, "auto-1", "manual").unwrap()["status"], "dispatched");
        assert_eq!((starts(), panes.sent.lock().unwrap().len()), (2, 0));
        finish(7, 70);

        // Reuse on, the newest run's session (7) idle: the prompt goes into it, no new tab, and the new
        // run holds that pane from the start, so the hooks' next finish completes it.
        reuse(true);
        *panes.idle.lock().unwrap() = Some((7, 70));
        let third = run(&l, "auto-1", "manual").unwrap();
        assert_eq!((third["terminal"].as_u64(), third["paneKey"].as_u64(), third["reused"].as_bool(), third["status"].as_str()), (Some(7), Some(70), Some(true), Some("dispatched")));
        assert_eq!((starts(), panes.sent.lock().unwrap().clone()), (2, vec![(7, "check".to_string())]));
        {
            let s = store.lock().unwrap();
            assert_eq!(on_status(&s, Some(7), 70, "done", false, false, None, 20).unwrap(), None, "the earlier done does not count before the agent worked");
            on_status(&s, Some(7), 70, "working", false, false, None, 21).unwrap();
            assert_eq!(on_status(&s, Some(7), 70, "done", false, false, None, 22).unwrap().as_deref(), third["id"].as_str());
        }

        // The agent is busy (or the tab was closed or is another pane): a new session opens.
        *panes.idle.lock().unwrap() = None;
        let fourth = run(&l, "auto-1", "manual").unwrap();
        assert_eq!((starts(), fourth["reused"].is_null(), fourth["terminal"].is_null()), (3, true, true));
        // A run still going holds the pane: even an idle report does not hand it to a second run.
        finish(8, 80);
        *panes.idle.lock().unwrap() = Some((8, 80));
        let fifth = run(&l, "auto-1", "manual").unwrap();
        assert_eq!(fifth["reused"], json!(true));
        let sixth = run(&l, "auto-1", "manual").unwrap();
        assert!(sixth["reused"].is_null() && starts() == 4, "{sixth}");
        *panes.idle.lock().unwrap() = None;
        drop(l);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn jl(vs: &[Value]) -> Vec<String> {
        vs.iter().map(Value::to_string).collect()
    }

    #[test]
    fn t140b_the_transcript_text_is_what_the_agent_said_and_nothing_else() {
        let said = |t: &str| json!({ "type": "assistant", "message": { "content": [{ "type": "thinking", "thinking": "hmm" }, { "type": "text", "text": t }, { "type": "tool_use", "name": "Bash" }] } });
        let claude = jl(&[
            json!({ "type": "user", "message": { "content": "please look" } }),
            said("First part."),
            said("First part."),
            json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "a helper said this" }] } }),
            json!({ "type": "assistant", "isMeta": true, "message": { "content": [{ "type": "text", "text": "meta" }] } }),
            json!({ "type": "assistant", "message": { "content": "A plain string reply." } }),
            said("  Done: 3 files changed.  "),
        ]);
        let mut with_junk = claude.clone();
        with_junk.insert(2, "not json at all".to_string());
        for lines in [&claude, &with_junk] {
            let (text, cut) = transcript_text("claude", lines);
            assert_eq!(text, "First part.\n\nA plain string reply.\n\nDone: 3 files changed.");
            assert!(!cut);
        }
        let codex = jl(&[
            json!({ "type": "session_meta", "payload": { "cwd": "x" } }),
            json!({ "type": "response_item", "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "do it" }] } }),
            json!({ "type": "response_item", "payload": { "type": "function_call", "name": "shell" } }),
            json!({ "type": "response_item", "payload": { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "All green." }] } }),
        ]);
        assert_eq!(transcript_text("codex", &codex), ("All green.".to_string(), false));
        // The wrong agent's format, an agent with no transcript and an empty one read as nothing.
        assert_eq!(transcript_text("claude", &codex).0, "");
        assert_eq!(transcript_text("gemini", &claude).0, "");
        assert_eq!(transcript_text("claude", &[]).0, "");
        // A long session keeps the newest part from a whole block's line and says so.
        let long: Vec<String> = (0..40).map(|i| said(&format!("{i:02} {}", "z".repeat(900))).to_string()).collect();
        let (text, cut) = transcript_text("claude", &long);
        assert!(cut && text.chars().count() <= RUN_OUTPUT_CHARS && text.contains("39 zzz") && !text.contains("00 zzz"), "{}", text.len());
    }

    #[test]
    fn t140b_a_finished_run_swaps_the_pane_text_for_the_transcript_and_nothing_else_is_touched() {
        let dir = temp("transcript");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        claim(&store, 6, Some(60), &ws.to_string_lossy(), Some("claude")).unwrap();
        // Still going: nothing is kept.
        assert_eq!(keep_transcript(&store, "run-1", "said", false).unwrap(), None);
        on_status(&store, Some(6), 60, "working", false, false, None, 10).unwrap();
        on_status(&store, Some(6), 60, "done", false, false, None, 11).unwrap();
        // The pane's text first, as the exit keeps it; then the transcript replaces it, once.
        keep_output(&store, "run-1", "$ claude\nscreen noise", false).unwrap();
        assert_eq!(list(&store).unwrap()["runs"][0]["outputFrom"], "screen");
        assert_eq!(keep_transcript(&store, "run-1", "   ", false).unwrap(), None);
        assert_eq!(keep_transcript(&store, "run-1", "The agent's words.", true).unwrap(), Some("run-1".to_string()));
        let r = list(&store).unwrap()["runs"][0].clone();
        assert_eq!((r["output"].as_str(), r["outputFrom"].as_str(), r["outputCut"].as_bool()), (Some("The agent's words."), Some("transcript"), Some(true)));
        assert_eq!(store.get(&output_key("run-1")).unwrap().unwrap(), json!("The agent's words.").to_string());
        // A second look, or a later pane text, cannot take it back.
        assert_eq!(keep_transcript(&store, "run-1", "again", false).unwrap(), None);
        assert_eq!(keep_output(&store, "run-1", "late screen", false).unwrap(), None);
        // A run with no pane text yet takes the transcript too, and a precheck's own output stays.
        dispatched(&store, &ws, 2, "claude");
        claim(&store, 7, Some(70), &ws.to_string_lossy(), Some("claude")).unwrap();
        pane_ended(&store, 7, Some(1), 20).unwrap();
        assert!(keep_transcript(&store, "run-2", "from the transcript", false).unwrap().is_some());
        dispatched(&store, &ws, 3, "claude");
        let mut rows = load(&store, RUNS_KEY).unwrap();
        let r3 = rows.iter_mut().find(|r| r["id"] == "run-3").unwrap();
        r3["status"] = json!("skipped");
        r3["output"] = json!("precheck said no");
        save(&store, RUNS_KEY, &rows).unwrap();
        assert_eq!(keep_transcript(&store, "run-3", "ignored", false).unwrap(), None);
        // The file read the app does: a transcript on disk through Tail, then the same text.
        let file = dir.join("session.jsonl");
        std::fs::write(&file, jl(&[json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "From disk." }] } })]).join("\n") + "\n").unwrap();
        let (lines, _) = crate::chat::Tail::new(file).read().unwrap();
        assert_eq!(transcript_text("claude", &lines).0, "From disk.");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t140d_run_output_lives_in_its_own_key_and_only_a_closed_pane_says_so() {
        let dir = temp("outkey");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "codex");
        claim(&store, 6, Some(60), &ws.to_string_lossy(), Some("codex")).unwrap();
        on_status(&store, Some(6), 60, "working", false, false, None, 10).unwrap();
        on_status(&store, Some(6), 60, "done", false, false, None, 11).unwrap();
        let big = "y".repeat(RUN_OUTPUT_CHARS);
        keep_output(&store, "run-1", &big, true).unwrap();
        // The runs list every hook status reads stays small; the text sits under the run's own key.
        let blob = store.get(RUNS_KEY).unwrap().unwrap();
        assert!(blob.len() < 1000 && !blob.contains("yyyy"), "{} bytes", blob.len());
        assert_eq!(store.get(&output_key("run-1")).unwrap().unwrap(), json!(big).to_string());
        // The page still gets it, and a second save is still refused.
        assert_eq!(list(&store).unwrap()["runs"][0]["output"].as_str().map(str::len), Some(RUN_OUTPUT_CHARS));
        assert_eq!(keep_output(&store, "run-1", "later", false).unwrap(), None);
        // A run that finished on its own never says its terminal closed; one its pane ended does.
        assert!(list(&store).unwrap()["runs"][0].get("paneEnded").is_none());
        dispatched(&store, &ws, 2, "codex");
        claim(&store, 7, Some(70), &ws.to_string_lossy(), Some("codex")).unwrap();
        pane_ended(&store, 7, Some(1), 20).unwrap();
        let runs = list(&store).unwrap()["runs"].clone();
        assert_eq!(runs.as_array().unwrap().iter().find(|r| r["id"] == "run-2").unwrap()["paneEnded"], json!(true));
        // Output saved inline before T-140-d moves to its own key on load.
        let mut rows = load(&store, RUNS_KEY).unwrap();
        rows[1]["output"] = json!("old inline text");
        save(&store, RUNS_KEY, &rows).unwrap();
        tidy(&store, 30).unwrap();
        assert!(!store.get(RUNS_KEY).unwrap().unwrap().contains("old inline"));
        assert_eq!(store.get(&output_key("run-2")).unwrap().unwrap(), json!("old inline text").to_string());
        // Deleting the automation clears its runs' output with it.
        delete(&store, "auto-1").unwrap();
        assert_eq!(store.get(&output_key("run-1")).unwrap().as_deref(), Some("null"));
        assert_eq!(store.get(&output_key("run-2")).unwrap().as_deref(), Some("null"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_a_run_completes_only_when_its_agent_really_finishes() {
        let dir = temp("finish");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        // A shell or another agent opened in the same folder is not the run's pane.
        assert_eq!(claim(&store, 4, Some(40), &ws.to_string_lossy(), None).unwrap(), None);
        assert_eq!(claim(&store, 5, Some(50), &ws.to_string_lossy(), Some("codex")).unwrap(), None);
        // The run's agent opens in its worktree (spelled with a trailing slash) and is picked up.
        let spelled = format!("{}/", ws.to_string_lossy());
        assert_eq!(claim(&store, 6, Some(60), &spelled, Some("claude")).unwrap().as_deref(), Some("run-1"));
        // A second claude pane in the same folder takes nothing: the run already has its pane.
        assert_eq!(claim(&store, 7, Some(70), &ws.to_string_lossy(), Some("claude")).unwrap(), None);
        // The session boundary (start, resume, clear) and an idle prompt at launch never finish it.
        on_status(&store, Some(6), 60, "working", true, false, None, 10).unwrap();
        on_status(&store, Some(6), 60, "done", false, false, None, 11).unwrap();
        assert_eq!(status_of(&store, "run-1").0, "dispatched", "a ready prompt already on screen is not a finish");
        on_status(&store, Some(6), 60, "done", true, false, None, 12).unwrap();
        assert_eq!(status_of(&store, "run-1").0, "dispatched", "a finish at a session boundary is not a finish");
        // Real work, a sub-agent finishing on the way, then the lead's own finish.
        on_status(&store, Some(6), 60, "working", false, false, None, 13).unwrap();
        on_status(&store, Some(6), 60, "done", false, true, None, 14).unwrap();
        assert_eq!(status_of(&store, "run-1").0, "dispatched", "a sub-agent finishing is not the run finishing");
        assert_eq!(on_status(&store, Some(6), 60, "done", false, false, None, 15).unwrap().as_deref(), Some("run-1"));
        let r = load(&store, RUNS_KEY).unwrap().remove(0);
        assert_eq!((r["status"].as_str(), r["finishedAt"].as_u64()), (Some("completed"), Some(15)));
        // Closing the pane afterwards leaves the finished run alone.
        assert_eq!(pane_ended(&store, 6, Some(1), 16).unwrap(), None);
        assert_eq!(status_of(&store, "run-1").0, "completed");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_an_agent_killed_before_it_starts_working_reads_failed() {
        let dir = temp("killed");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        dispatched(&store, &ws, 2, "claude");
        claim(&store, 3, Some(30), &ws.to_string_lossy(), Some("claude")).unwrap();
        claim(&store, 4, Some(40), &ws.to_string_lossy(), Some("claude")).unwrap();
        on_status(&store, Some(3), 30, "working", true, false, None, 5).unwrap();
        assert_eq!(pane_ended(&store, 3, None, 6).unwrap().as_deref(), Some("run-1"));
        let (st, why) = status_of(&store, "run-1");
        assert_eq!(st, "failed");
        assert!(why.contains("before it began working"), "{why}");
        // One that had started working and was stopped mid-way failed too, with its own reason.
        on_status(&store, Some(4), 40, "working", false, false, None, 7).unwrap();
        pane_ended(&store, 4, None, 8).unwrap();
        let (st, why) = status_of(&store, "run-2");
        assert_eq!(st, "failed");
        assert!(why.contains("before it finished"), "{why}");
        // An agent without status hooks: a clean exit is its finish, anything else a failure.
        dispatched(&store, &ws, 3, "gemini");
        dispatched(&store, &ws, 4, "gemini");
        claim(&store, 8, None, &ws.to_string_lossy(), Some("gemini")).unwrap();
        claim(&store, 9, None, &ws.to_string_lossy(), Some("gemini")).unwrap();
        pane_ended(&store, 8, Some(0), 9).unwrap();
        pane_ended(&store, 9, Some(1), 9).unwrap();
        assert_eq!((status_of(&store, "run-3").0.as_str(), status_of(&store, "run-4").0.as_str()), ("completed", "failed"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t085h_after_a_restart_a_run_the_terminal_service_still_holds_is_reconnected_with_its_output_replayed() {
        let dir = temp("t085h-held");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        claim(&store, 3, Some(30), &ws.to_string_lossy(), Some("claude")).unwrap();
        on_status(&store, Some(3), 30, "working", false, false, None, 4).unwrap();
        tidy(&store, 1_000).unwrap();
        let after_tidy = load(&store, RUNS_KEY).unwrap()[0].clone();
        assert!(after_tidy["terminal"].is_null() && after_tidy["lastTerminal"] == 3 && after_tidy["lastPaneKey"] == 30 && after_tidy["settleBy"].is_u64(), "{after_tidy}");
        // The fake terminal service still runs terminal 3 and has what it printed so far.
        let asked = RefCell::new(Vec::<(u32, Option<u32>)>::new());
        let service = |t: u32, p: Option<u32>| {
            asked.borrow_mut().push((t, p));
            (t == 3).then(|| Held { alive: true, output: Some(("$ claude\nWorking on it...".to_string(), false)) })
        };
        assert_eq!(reconnect(&store, &service, 1_001).unwrap(), vec!["run-1".to_string()]);
        assert_eq!(*asked.borrow(), vec![(3, Some(30))]);
        let r = load(&store, RUNS_KEY).unwrap()[0].clone();
        assert_eq!((r["status"].as_str(), r["terminal"].as_u64(), r["paneKey"].as_u64(), r["reconnected"].as_bool()), (Some("dispatched"), Some(3), Some(30), Some(true)));
        assert!(r["settleBy"].is_null(), "no settling for a run found again: {r}");
        assert!(r["detail"].as_str().unwrap().contains("Reconnected"), "{r}");
        // The replay is on the run for the page, under its own key like any saved output.
        let shown = with_output(&store, r.clone());
        assert_eq!((shown["output"].as_str(), shown["outputFrom"].as_str()), (Some("$ claude\nWorking on it..."), Some("replay")));
        // Asking again does nothing: the run is followed, not waiting.
        assert!(reconnect(&store, &service, 1_002).unwrap().is_empty());
        // Nothing closes it at settling time, its old terminal still ends it, and its finish
        // completes it with the real end text replacing the replay.
        assert!(settle(&store, 1_000 + SETTLE_MS + 1).unwrap().is_empty());
        on_status(&store, Some(3), 30, "working", false, false, None, 2_000).unwrap();
        on_status(&store, Some(3), 30, "done", false, false, None, 2_001).unwrap();
        assert_eq!(status_of(&store, "run-1").0, "completed");
        assert_eq!(keep_output(&store, "run-1", "all done", false).unwrap().as_deref(), Some("run-1"));
        let shown = with_output(&store, load(&store, RUNS_KEY).unwrap()[0].clone());
        assert_eq!((shown["output"].as_str(), shown["outputFrom"].as_str()), (Some("all done"), Some("screen")));
        // Saved once, the end text stays: a second save does not replace it.
        assert_eq!(keep_output(&store, "run-1", "later", false).unwrap(), None);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t085h_after_a_restart_a_run_whose_terminal_is_gone_ends_with_the_reason_and_an_unknown_one_waits() {
        let dir = temp("t085h-gone");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        dispatched(&store, &ws, 2, "claude");
        dispatched(&store, &ws, 3, "claude");
        claim(&store, 5, Some(50), &ws.to_string_lossy(), Some("claude")).unwrap();
        claim(&store, 6, Some(60), &ws.to_string_lossy(), Some("claude")).unwrap();
        // run-3 was dispatched but no pane ever claimed it: nothing to ask the service about.
        tidy(&store, 1_000).unwrap();
        // The service knows terminal 5 ended while Kolux was away, and nothing of terminal 6.
        let service = |t: u32, _: Option<u32>| (t == 5).then(|| Held { alive: false, output: Some(("bye".to_string(), true)) });
        assert_eq!(reconnect(&store, &service, 1_001).unwrap(), vec!["run-1".to_string()]);
        let (st, why) = status_of(&store, "run-1");
        assert_eq!(st, "failed");
        assert!(why.contains("restarted") && why.contains("already ended"), "{why}");
        let r = with_output(&store, load(&store, RUNS_KEY).unwrap()[0].clone());
        assert_eq!((r["output"].as_str(), r["outputFrom"].as_str(), r["outputCut"].as_bool(), r["paneEnded"].as_bool(), r["finishedAt"].as_u64()), (Some("bye"), Some("screen"), Some(true), Some(true), Some(1_001)));
        // The unknown one keeps waiting for its pane: still dispatched, still settling.
        let r2 = load(&store, RUNS_KEY).unwrap()[1].clone();
        assert_eq!((r2["status"].as_str(), r2["settleBy"].is_u64(), r2["terminal"].is_null()), (Some("dispatched"), true, true));
        // Its pane coming back claims it; the other unknown one closes at settling with the usual reason.
        assert_eq!(claim(&store, 1, Some(10), &ws.to_string_lossy(), Some("claude")).unwrap().as_deref(), Some("run-2"));
        assert_eq!(settle(&store, 1_000 + SETTLE_MS + 1).unwrap(), vec!["run-3".to_string()]);
        assert!(status_of(&store, "run-3").1.contains("could not be found again"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_after_a_restart_runs_reconnect_and_unfound_ones_close_after_settling() {
        let dir = temp("reconnect");
        let ws = dir.join("ws");
        let other = dir.join("other");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &ws);
        dispatched(&store, &ws, 1, "claude");
        dispatched(&store, &other, 2, "claude");
        // Before the restart run-1 had its pane and its agent was at work.
        claim(&store, 3, Some(30), &ws.to_string_lossy(), Some("claude")).unwrap();
        on_status(&store, Some(3), 30, "working", false, false, None, 4).unwrap();
        tidy(&store, 1_000).unwrap();
        // The old terminal number means nothing in the new process.
        assert_eq!(pane_ended(&store, 3, None, 1_001).unwrap(), None);
        assert_eq!(status_of(&store, "run-1").0, "dispatched");
        // Inside the settling period nothing is closed; the resumed pane is picked up again.
        assert!(settle(&store, 1_000 + SETTLE_MS - 1).unwrap().is_empty());
        assert_eq!(claim(&store, 1, Some(10), &ws.to_string_lossy(), Some("claude")).unwrap().as_deref(), Some("run-1"));
        // Past it, the run whose pane never came back is closed; the reconnected one is kept.
        assert_eq!(settle(&store, 1_000 + SETTLE_MS + 1).unwrap(), vec!["run-2".to_string()]);
        let (st, why) = status_of(&store, "run-2");
        assert_eq!(st, "failed");
        assert!(why.contains("restarted"), "{why}");
        // Tracking carried on: the work seen before the restart counts, and its finish completes it.
        on_status(&store, Some(1), 10, "working", true, false, None, 2_000).unwrap();
        on_status(&store, Some(1), 10, "done", false, false, None, 2_001).unwrap();
        assert_eq!(status_of(&store, "run-1").0, "completed");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card13_a_checks_state_that_could_not_be_kept_aside_is_never_saved_over() {
        let dir = temp("c13");
        let db = dir.join("db");
        let store = Store::open(&db).unwrap();
        let broken = "{\"c:/a#1\": \"running";
        store.set(CHECKS_SEEN_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&db);
        let open = [polled("C:/a", Some("OPEN"))];
        let err = checks_round(&store, &open, &checked(&[("C:/a", "failing")])).unwrap_err();
        assert!(err.contains(CHECKS_SEEN_KEY), "{err}");
        assert_eq!(store.get(CHECKS_SEEN_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
