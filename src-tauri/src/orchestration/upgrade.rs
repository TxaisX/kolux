//! ORCH-034 (T-173-c): the orchestration store upgrades in place from every earlier layout that
//! Kolux itself has written, so Runs, tasks, dispatches, messages, gates and request receipts
//! carry over after an upgrade. Our own layouts only: the carry-over from the old app's store is an
//! importer contract (COMPAT 5.7, T-213) and never read here.
//!
//! Layouts (the number is kept under `orchestration.version`; a store with data and no number is 0):
//! - 0: Runs, pane bindings, messages, deliveries, request answers and the id counter. Messages had
//!   no thread; a reply named the message it answered.
//! - 1: messages carry their thread identity; decision gates exist.
//! - 2: request receipts are stamped and unfinished requests are tracked (retry never does the work twice).
//! - 3: every dispatch names its status and the Kolux process that made it.
//!
//! Rules: the raw text of every blob is copied to `<key>.v<n>` before layout `n` is left behind,
//! so a bad upgrade loses nothing; all writes land in one transaction or none do; a blob that will
//! not read stops the whole upgrade with the store untouched; a store written by a newer Kolux is
//! never downgraded or edited; running the upgrade again changes nothing.

use serde_json::{json, Map, Value};

use crate::state::Store;

pub const VERSION_KEY: &str = "orchestration.version";
/// The layout this Kolux writes.
pub const CURRENT: u32 = 3;

/// What an upgrade did, for the diagnostics log and the tests.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct Report {
    pub from: u32,
    pub to: u32,
    /// One line per layout step, saying what changed.
    pub steps: Vec<String>,
    /// The keys the pre-upgrade copies were written under.
    pub backups: Vec<String>,
    /// Why nothing was done, when nothing was.
    pub skipped: Option<String>,
}

fn blobs() -> [&'static str; 3] {
    [super::KEY, super::TASKS_KEY, super::DISPATCHES_KEY]
}

/// The layout number the store names, if any.
pub fn version_of(store: &Store) -> Result<Option<u32>, String> {
    match store.get(VERSION_KEY).map_err(|e| e.to_string())? {
        None => Ok(None),
        Some(t) => t.trim().parse::<u32>().map(Some).map_err(|_| format!("{VERSION_KEY} holds {t:?}, not a layout number; the orchestration store was left as it is")),
    }
}

/// A blob read leniently: absent, or cleared to `null`, counts as absent; anything else must be
/// JSON of the expected kind, or the upgrade refuses to touch the store.
fn read(store: &Store, key: &str, array: bool) -> Result<Option<(String, Value)>, String> {
    let Some(raw) = store.get(key).map_err(|e| e.to_string())? else { return Ok(None) };
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("{key} could not be read ({e}); the orchestration store was left as it is and nothing was upgraded"))?;
    if v.is_null() {
        return Ok(None);
    }
    if array != v.is_array() || (!array && !v.is_object()) {
        return Err(format!("{key} is not {}; the orchestration store was left as it is and nothing was upgraded", if array { "a list" } else { "a record" }));
    }
    Ok(Some((raw, v)))
}

/// Brings the store up to [`CURRENT`]. `now` stamps what the older layouts never dated.
pub fn run(store: &Store, now: u64) -> Result<Report, String> {
    let mail = read(store, super::KEY, false)?;
    let tasks = read(store, super::TASKS_KEY, true)?;
    let dispatches = read(store, super::DISPATCHES_KEY, true)?;
    let from = match version_of(store)? {
        Some(v) => v,
        None if mail.is_none() && tasks.is_none() && dispatches.is_none() => {
            // A fresh store: it is born in today's layout.
            store.set(VERSION_KEY, &CURRENT.to_string()).map_err(|e| e.to_string())?;
            return Ok(Report { from: CURRENT, to: CURRENT, ..Report::default() });
        }
        None => 0,
    };
    if from > CURRENT {
        return Ok(Report { from, to: from, skipped: Some(format!("the orchestration store was written by a newer Kolux (layout {from}; this one writes layout {CURRENT}), so it is left as it is")), ..Report::default() });
    }
    if from == CURRENT {
        return Ok(Report { from, to: from, ..Report::default() });
    }
    let mut report = Report { from, to: CURRENT, ..Report::default() };
    let mut writes: Vec<(String, String)> = Vec::new();
    for (key, blob) in blobs().iter().zip([&mail, &tasks, &dispatches]) {
        if let Some((raw, _)) = blob {
            let bak = format!("{key}.v{from}");
            writes.push((bak.clone(), raw.clone()));
            report.backups.push(bak);
        }
    }
    let mut mail = mail.map(|(_, v)| v).unwrap_or_else(|| json!({}));
    let mut tasks = tasks.map(|(_, v)| v).unwrap_or_else(|| json!([]));
    let mut dispatches = dispatches.map(|(_, v)| v).unwrap_or_else(|| json!([]));
    for v in from..CURRENT {
        let line = match v {
            0 => threads_and_gates(&mut mail),
            1 => stamps_and_pending(&mut mail, now),
            _ => dispatch_shape(&mut dispatches, &mut tasks, now),
        };
        report.steps.push(format!("layout {v} -> {}: {line}", v + 1));
    }
    writes.push((super::KEY.to_string(), mail.to_string()));
    writes.push((super::TASKS_KEY.to_string(), tasks.to_string()));
    writes.push((super::DISPATCHES_KEY.to_string(), dispatches.to_string()));
    writes.push((VERSION_KEY.to_string(), CURRENT.to_string()));
    let pairs: Vec<(&str, &str)> = writes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    store.set_all(&pairs).map_err(|e| e.to_string())?;
    Ok(report)
}

fn messages(mail: &mut Value) -> &mut Vec<Value> {
    if !mail["messages"].is_array() {
        mail["messages"] = json!([]);
    }
    mail["messages"].as_array_mut().expect("just made a list")
}

fn extras(m: &mut Value) -> &mut Map<String, Value> {
    if !m["extras"].is_object() {
        m["extras"] = json!({});
    }
    m["extras"].as_object_mut().expect("just made a record")
}

fn thread_of(m: &Value) -> Option<String> {
    m["extras"]["threadId"].as_str().filter(|s| !s.trim().is_empty()).map(str::to_string)
}

/// Layout 0 -> 1: every message gets its thread identity. A question, a report or any first message
/// is its own thread; a reply joins the thread of the message it answered (walking a chain of
/// replies), and only when that message is gone does it start a thread of its own. Gates appear.
fn threads_and_gates(mail: &mut Value) -> String {
    let list = messages(mail);
    let mut threaded = 0;
    // Pass 1: messages that answer nothing are their own thread.
    for m in list.iter_mut() {
        if thread_of(m).is_none() && m["extras"]["inReplyTo"].as_str().is_none() {
            let id = m["id"].as_str().unwrap_or_default().to_string();
            extras(m).insert("threadId".into(), json!(id));
            threaded += 1;
        }
    }
    // Pass 2: replies follow their chain, as many rounds as the longest chain is deep.
    loop {
        let known: Vec<(String, String)> = list.iter().filter_map(|m| Some((m["id"].as_str()?.to_string(), thread_of(m)?))).collect();
        let mut moved = 0;
        for m in list.iter_mut().filter(|m| thread_of(m).is_none()) {
            let parent = m["extras"]["inReplyTo"].as_str().unwrap_or_default();
            if let Some((_, thread)) = known.iter().find(|(id, _)| id == parent) {
                let thread = thread.clone();
                extras(m).insert("threadId".into(), json!(thread));
                moved += 1;
            }
        }
        threaded += moved;
        if moved == 0 {
            break;
        }
    }
    // Pass 3: a reply to a message that is gone keeps itself as the thread.
    let mut orphans = 0;
    for m in list.iter_mut().filter(|m| thread_of(m).is_none()) {
        let id = m["id"].as_str().unwrap_or_default().to_string();
        extras(m).insert("threadId".into(), json!(id));
        orphans += 1;
    }
    threaded += orphans;
    let mut line = format!("{threaded} message(s) given their thread identity");
    if orphans > 0 {
        line.push_str(&format!(" ({orphans} answered a message that is gone and became a thread of their own)"));
    }
    if !mail["gates"].is_array() {
        mail["gates"] = json!([]);
        line.push_str("; gates list added");
    }
    line
}

/// Layout 1 -> 2: every request answer gets a stamp so it can age out (dated now: it is kept the
/// full week from the upgrade, never dropped at once), and the ledger of unfinished requests appears.
fn stamps_and_pending(mail: &mut Value, now: u64) -> String {
    if !mail["stamps"].is_object() {
        mail["stamps"] = json!({});
    }
    let keys: Vec<String> = mail["answers"].as_object().map(|a| a.keys().cloned().collect()).unwrap_or_default();
    let mut stamped = 0;
    for k in keys {
        if mail["stamps"][&k].as_u64().is_none() {
            mail["stamps"][&k] = json!(now);
            stamped += 1;
        }
    }
    let mut line = format!("{stamped} request receipt(s) stamped");
    if !mail["pending"].is_object() {
        mail["pending"] = json!({});
        line.push_str("; unfinished-request ledger added");
    }
    line
}

/// Layout 2 -> 3: a dispatch recorded before dispatches named their status or their Kolux process
/// gets `runtime` 0 (no live process: its terminal is treated as gone, ORCH-038) and, with no
/// status at all, counts as abandoned with an unknown outcome, never as running or done. A task
/// with no status is pending.
fn dispatch_shape(dispatches: &mut Value, tasks: &mut Value, now: u64) -> String {
    let (mut runtimes, mut statuses, mut created, mut task_statuses) = (0, 0, 0, 0);
    for d in dispatches.as_array_mut().into_iter().flatten().filter(|d| d.is_object()) {
        if d["runtime"].as_u64().is_none() {
            d["runtime"] = json!(0);
            runtimes += 1;
        }
        if d["status"].as_str().is_none() {
            d["status"] = json!("abandoned");
            d["outcome"] = json!("unknown");
            d["detail"] = json!("recorded before Kolux kept a worker's status; what became of it is unknown");
            statuses += 1;
        }
        if d["created"].as_u64().is_none() {
            d["created"] = json!(now);
            created += 1;
        }
    }
    for t in tasks.as_array_mut().into_iter().flatten().filter(|t| t.is_object()) {
        if t["status"].as_str().is_none() {
            t["status"] = json!("pending");
            task_statuses += 1;
        }
    }
    format!("{runtimes} dispatch(es) tied to no live process, {statuses} given an unknown outcome, {created} dated; {task_statuses} task(s) made pending")
}

/// At launch, before anything reads the orchestration keys: upgrades, and logs what happened. A
/// failure is logged and leaves the store as it was; the app goes on with what it can read.
pub fn at_start(store: &Store) {
    match run(store, super::wall_ms()) {
        Ok(r) if r.from == r.to => {}
        Ok(r) => eprintln!("orchestration store upgraded from layout {} to {}: {}", r.from, r.to, r.steps.join(" / ")),
        Err(e) => eprintln!("orchestration store not upgraded: {e}"),
    }
    // ORCH-038 (T-173-d): workers an earlier Kolux process left live come back cut short.
    super::restart::at_start(store, super::wall_ms());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestration::Mail;

    fn fresh(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-orch-upgrade-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    fn v0_mail() -> Value {
        json!({
            "runs": [{ "id": "run-1", "objective": "ship", "home": "C:/w", "created": 5 }],
            "bindings": { "term-1": { "run": "run-1", "epoch": 1 } },
            "messages": [
                { "id": "msg-1", "to": "term:term-2", "run": "run-1", "from": "term-1", "subject": "Which API?", "body": "a or b", "type": "question", "priority": "normal", "extras": {}, "at": 10 },
                { "id": "msg-2", "to": "term:term-1", "run": "run-1", "from": "term-2", "subject": "Re: Which API?", "body": "b", "type": "status", "priority": "normal", "extras": { "inReplyTo": "msg-1" }, "at": 11 },
                { "id": "msg-3", "to": "term:term-2", "run": "run-1", "from": "term-1", "subject": "Re: Which API?", "body": "sure?", "type": "status", "priority": "normal", "extras": { "inReplyTo": "msg-2" }, "at": 12 },
                { "id": "msg-4", "to": "term:term-1", "run": "run-1", "from": "term-3", "subject": "Re: gone", "body": "x", "type": "status", "priority": "normal", "extras": { "inReplyTo": "msg-0" }, "at": 13 }
            ],
            "deliveries": [{ "id": "delivery-1", "reader": "term-2", "messages": ["msg-1"], "acked": false }],
            "answers": { "orchestration.run-create|term-1|r1": { "runId": "run-1" } },
            "seq": 7
        })
    }

    #[test]
    fn orch034_a_layout_0_store_upgrades_to_today_with_its_threads_receipts_and_dispatches_kept() {
        let (store, dir) = fresh("v0");
        let tasks = json!([{ "id": "task-1", "title": "old", "spec": "do" }, { "id": "task-2", "status": "completed" }]);
        let dispatches = json!([{ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1" }, { "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "runtime": 44, "created": 9 }]);
        store.set_all(&[(super::super::KEY, &v0_mail().to_string()), (super::super::TASKS_KEY, &tasks.to_string()), (super::super::DISPATCHES_KEY, &dispatches.to_string())]).unwrap();
        assert_eq!(version_of(&store).unwrap(), None, "a store with data and no number is layout 0");

        let r = run(&store, 1_000).unwrap();
        assert_eq!((r.from, r.to, r.skipped), (0, CURRENT, None));
        assert_eq!(r.steps.len(), 3, "{:?}", r.steps);
        assert!(r.steps[0].contains("4 message(s)") && r.steps[0].contains("1 answered a message that is gone") && r.steps[0].contains("gates list added"), "{}", r.steps[0]);
        assert!(r.steps[1].contains("1 request receipt(s) stamped") && r.steps[1].contains("ledger added"), "{}", r.steps[1]);
        assert!(r.steps[2].starts_with("layout 2 -> 3: 1 dispatch(es) tied to no live process, 1 given an unknown outcome, 1 dated; 1 task(s) made pending"), "{}", r.steps[2]);
        assert_eq!(version_of(&store).unwrap(), Some(CURRENT));

        // Threads: the question is its own thread, both replies join it, the orphan reply stands alone.
        let m = Mail::load(&store);
        let thread = |id: &str| m.messages.iter().find(|x| x.id == id).unwrap().extras["threadId"].as_str().unwrap().to_string();
        assert_eq!((thread("msg-1"), thread("msg-2"), thread("msg-3"), thread("msg-4")), ("msg-1".into(), "msg-1".into(), "msg-1".into(), "msg-4".into()));
        assert_eq!(m.messages[1].extras["inReplyTo"], "msg-1", "what was there stays");
        // Receipts, runs, bindings, deliveries and the counter carried over; the receipt is stamped now.
        assert_eq!((m.runs.len(), m.bindings["term-1"].run.as_deref(), m.deliveries.len(), m.seq), (1, Some("run-1"), 1, 7));
        assert_eq!(m.stamps["orchestration.run-create|term-1|r1"], 1_000);
        assert!(m.answers.contains_key("orchestration.run-create|term-1|r1") && m.pending.is_empty() && m.gates.is_empty());
        // Dispatches and tasks in today's shape; the one from before statuses is no quiet success.
        let d: Vec<Value> = serde_json::from_str(&store.get(super::super::DISPATCHES_KEY).unwrap().unwrap()).unwrap();
        assert_eq!((d[0]["runtime"].as_u64(), d[0]["status"].as_str(), d[0]["outcome"].as_str(), d[0]["created"].as_u64()), (Some(0), Some("abandoned"), Some("unknown"), Some(1_000)));
        assert_eq!((d[1]["runtime"].as_u64(), d[1]["status"].as_str(), d[1]["created"].as_u64(), d[1].get("outcome")), (Some(44), Some("completed"), Some(9), None));
        assert!(super::super::terminal_of(&d[0]).is_none(), "a dispatch of no live process has no terminal here");
        let t: Vec<Value> = serde_json::from_str(&store.get(super::super::TASKS_KEY).unwrap().unwrap()).unwrap();
        assert_eq!((t[0]["status"].as_str(), t[1]["status"].as_str()), (Some("pending"), Some("completed")));
        // The layout-0 text is kept word for word under the backup keys.
        assert_eq!(r.backups, ["orchestration.mail.v0", "orchestration.tasks.v0", "orchestration.dispatches.v0"]);
        assert_eq!(store.get("orchestration.mail.v0").unwrap().unwrap(), v0_mail().to_string());
        assert_eq!(store.get("orchestration.dispatches.v0").unwrap().unwrap(), dispatches.to_string());

        // Running it again changes nothing and writes no second backup.
        let again = run(&store, 2_000).unwrap();
        assert_eq!(again, Report { from: CURRENT, to: CURRENT, ..Report::default() });
        assert_eq!(Mail::load(&store), m);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn orch034_a_fresh_store_is_born_in_todays_layout_and_a_layout_2_store_takes_only_the_last_step() {
        let (store, dir) = fresh("fresh");
        assert_eq!(run(&store, 1).unwrap(), Report { from: CURRENT, to: CURRENT, ..Report::default() });
        assert_eq!(version_of(&store).unwrap(), Some(CURRENT));
        assert!(store.get(super::super::KEY).unwrap().is_none(), "nothing else is written for a fresh store");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);

        let (store, dir) = fresh("v2");
        let mut mail = v0_mail();
        mail["messages"][1]["extras"]["threadId"] = json!("elsewhere");
        mail["gates"] = json!([]);
        mail["stamps"] = json!({});
        mail["pending"] = json!({});
        store.set_all(&[(super::super::KEY, &mail.to_string()), (VERSION_KEY, "2")]).unwrap();
        let r = run(&store, 5).unwrap();
        assert_eq!((r.from, r.to), (2, 3));
        assert_eq!(r.steps, ["layout 2 -> 3: 0 dispatch(es) tied to no live process, 0 given an unknown outcome, 0 dated; 0 task(s) made pending"]);
        assert_eq!(r.backups, ["orchestration.mail.v2"], "only the blobs that were there are backed up");
        let m = Mail::load(&store);
        assert!(m.messages[0].extras.get("threadId").is_none() && m.messages[1].extras["threadId"] == "elsewhere", "layout 1 and 2 steps are not rerun on a layout 2 store");
        assert!(m.stamps.is_empty(), "a layout 2 store's unstamped receipts are its own business");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn orch034_a_newer_or_unreadable_store_is_left_exactly_as_it_is() {
        let (store, dir) = fresh("newer");
        store.set_all(&[(super::super::KEY, &v0_mail().to_string()), (VERSION_KEY, "9")]).unwrap();
        let r = run(&store, 1).unwrap();
        assert_eq!((r.from, r.to, r.steps.len(), r.backups.len()), (9, 9, 0, 0));
        assert!(r.skipped.as_deref().unwrap().contains("newer Kolux"), "{:?}", r.skipped);
        assert_eq!(store.get(VERSION_KEY).unwrap().as_deref(), Some("9"));
        assert_eq!(store.get(super::super::KEY).unwrap().unwrap(), v0_mail().to_string());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);

        let (store, dir) = fresh("broken");
        store.set_all(&[(super::super::KEY, "{\"runs\": [tru"), (super::super::TASKS_KEY, "[]")]).unwrap();
        let e = run(&store, 1).unwrap_err();
        assert!(e.contains("orchestration.mail could not be read") && e.contains("nothing was upgraded"), "{e}");
        assert_eq!(store.get(super::super::KEY).unwrap().as_deref(), Some("{\"runs\": [tru"));
        assert_eq!(version_of(&store).unwrap(), None, "no number is written for a store that did not upgrade");
        assert!(store.get("orchestration.mail.v0").unwrap().is_none() && store.get("orchestration.tasks.v0").unwrap().is_none());
        // A blob of the wrong kind is refused the same way; a cleared (`null`) blob counts as absent.
        store.set_all(&[(super::super::KEY, "null"), (super::super::TASKS_KEY, "{}")]).unwrap();
        assert!(run(&store, 1).unwrap_err().contains("orchestration.tasks is not a list"));
        store.set(super::super::TASKS_KEY, "null").unwrap();
        assert_eq!(run(&store, 1).unwrap(), Report { from: CURRENT, to: CURRENT, ..Report::default() }, "nothing but cleared blobs is a fresh store");
        store.set(VERSION_KEY, "two").unwrap();
        assert!(run(&store, 1).unwrap_err().contains("not a layout number"));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
