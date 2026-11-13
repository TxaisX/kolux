//! ORCH-038 (T-173-d, coordinator default under DT-C27): quitting stops every pane and a crash takes
//! them with it, so a worker still starting, running or stopping when an earlier Kolux process ended
//! cannot be picked up again. At start every such dispatch becomes "cut short, outcome unknown",
//! never a quiet success, with the commands to stop it (which frees its task) and start the task
//! again. Re-attaching a running worker without a second brief, settled tabs that survive a restart
//! and a background terminal service with an instance lock stay deferred under DT-C27.

use super::{finished, CLI, DISPATCHES_KEY};
use crate::state::Store;
use serde_json::{json, Value};

/// Marks every unfinished dispatch stamped by another Kolux process than `me` as cut short. Returns
/// the ids it marked; a dispatch marked once is left as it is.
pub fn cut_short(dispatches: &mut [Value], me: u64, now: u64) -> Vec<String> {
    let mut marked = Vec::new();
    for d in dispatches.iter_mut().filter(|d| d.is_object() && !finished(d) && d["runtime"].as_u64() != Some(me) && d["cutShort"].is_null()) {
        let id = d["id"].as_str().unwrap_or_default().to_string();
        let was = d["status"].as_str().unwrap_or("running").to_string();
        let run = d["runId"].as_str().map(|r| format!(" --run {r}")).unwrap_or_default();
        let task = d["taskId"].as_str().unwrap_or_default();
        let agent = d["agent"].as_str().filter(|a| a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).map(|a| format!(" --agent {a}")).unwrap_or_default();
        let kept = d["worktree"].as_str().map(|w| format!("; whatever it changed is still in {w}")).unwrap_or_default();
        d["cutShort"] = json!({
            "at": now,
            "was": was,
            "outcome": "unknown",
            "why": format!("Kolux ended while this worker was {was}; quitting stops every pane, so its agent is gone and how far it got is unknown{kept}"),
            "next": [
                format!("{CLI} orchestration worker-stop --dispatch {id}{run}"),
                format!("{CLI} orchestration worker-start --task {task}{agent}{run}"),
            ],
        });
        d["status"] = json!("unknown");
        marked.push(id);
    }
    marked
}

/// At start, before anything reads the store: marks the cut-short dispatches. Best effort: an
/// unreadable or unwritable list is reported and left alone.
pub fn at_start(store: &Store, now: u64) {
    let raw = match store.get(DISPATCHES_KEY) {
        Ok(Some(raw)) => raw,
        Ok(None) => return,
        Err(e) => return eprintln!("orchestration: dispatches not read at start: {e}"),
    };
    let Ok(mut dispatches) = serde_json::from_str::<Vec<Value>>(&raw) else { return eprintln!("orchestration: dispatches unreadable at start; left as they are") };
    let marked = cut_short(&mut dispatches, u64::from(std::process::id()), now);
    if marked.is_empty() {
        return;
    }
    match serde_json::to_string(&dispatches).map_err(|e| e.to_string()).and_then(|t| store.set(DISPATCHES_KEY, &t).map_err(|e| e.to_string())) {
        Ok(()) => eprintln!("orchestration: {} worker(s) cut short by the last quit or crash: {}", marked.len(), marked.join(", ")),
        Err(e) => eprintln!("orchestration: cut-short workers not recorded: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workers_live_at_a_quit_come_back_cut_short_with_an_unknown_outcome_and_recovery_steps() {
        let me = 500;
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "runtime": 7, "agent": "claude", "worktree": "C:/w/a" }),
            json!({ "id": "dispatch-2", "runId": null, "taskId": "task-2", "status": "starting", "runtime": 7 }),
            json!({ "id": "dispatch-3", "taskId": "task-3", "status": "completed", "runtime": 7 }),
            json!({ "id": "dispatch-4", "taskId": "task-4", "status": "running", "runtime": me }),
            json!({ "id": "dispatch-5", "taskId": "task-5", "status": "stopping" }),
        ];
        assert_eq!(cut_short(&mut d, me, 99), ["dispatch-1", "dispatch-2", "dispatch-5"]);
        assert_eq!((d[0]["status"].as_str(), d[0]["cutShort"]["outcome"].as_str(), d[0]["cutShort"]["was"].as_str()), (Some("unknown"), Some("unknown"), Some("running")));
        assert_eq!(d[0]["cutShort"]["next"], json!([format!("{CLI} orchestration worker-stop --dispatch dispatch-1 --run run-1"), format!("{CLI} orchestration worker-start --task task-1 --agent claude --run run-1")]));
        assert!(d[0]["cutShort"]["why"].as_str().unwrap().contains("C:/w/a"), "the worktree with its work is named");
        assert_eq!(d[1]["cutShort"]["next"][0], format!("{CLI} orchestration worker-stop --dispatch dispatch-2"));
        assert_eq!(d[1]["cutShort"]["was"], "starting", "a start cut short is unknown, never a quiet success");
        assert!(d[2]["cutShort"].is_null() && d[2]["status"] == "completed", "a settled worker is left alone");
        assert!(d[3]["cutShort"].is_null() && d[3]["status"] == "running", "this process's own worker is left alone");
        assert_eq!(d[4]["cutShort"]["was"], "stopping");
        assert!(cut_short(&mut d, me, 100).is_empty(), "marked once; an unknown row is not marked again at the next start");
    }

    #[test]
    fn the_start_hook_records_them_in_the_store_and_worker_show_says_so() {
        let dir = std::env::temp_dir().join(format!("kolux-orch-restart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        at_start(&store, 1);
        assert_eq!(store.get(DISPATCHES_KEY).unwrap(), None, "no list, nothing written");
        let rows = json!([{ "id": "dispatch-1", "taskId": "task-1", "status": "running", "runtime": 1, "terminal": 3 }]);
        store.set(DISPATCHES_KEY, &rows.to_string()).unwrap();
        at_start(&store, 5);
        let d: Vec<Value> = serde_json::from_str(&store.get(DISPATCHES_KEY).unwrap().unwrap()).unwrap();
        assert_eq!(d[0]["status"], "unknown");
        let tasks = vec![json!({ "id": "task-1", "status": "dispatched", "dispatchId": "dispatch-1" })];
        let shown = super::super::worker_show(&tasks, &d, "dispatch-1", None, &|_| true, None).unwrap();
        assert_eq!(shown["cutShort"]["outcome"], "unknown");
        assert_eq!(shown["attention"], "interruption", "{shown}");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
