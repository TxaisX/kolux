//! spec/09 P0 boxes AUTO-001, AUTO-004, AUTO-005: timetables, event triggers and the dialog's save.
//! Every call goes through the crate's pub API; the window is a recording closure and no agent starts.

use kolux_rs_lib::automations::{self as auto, Launch, KEY, RUNS_KEY};
use kolux_rs_lib::git::Git;
use kolux_rs_lib::projects;
use kolux_rs_lib::scm::{PolledPr, Pr};
use kolux_rs_lib::state::Store;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Friday 9 October 2026, 12:00 UTC.
const FRI_NOON: i64 = 1_791_547_200_000;
const HOUR: i64 = 3_600_000;

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-cards09-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn seed_project(store: &Store, path: &Path) {
    store.set("projects", &json!([{ "id": "p1", "name": "repo", "path": path.to_string_lossy() }]).to_string()).unwrap();
}

fn form(ws: &Path, request: &str, schedule: Value) -> Value {
    json!({ "requestId": request, "name": "Morning", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "schedule": schedule })
}

fn count(store: &Store) -> usize {
    auto::list(store).unwrap()["automations"].as_array().unwrap().len()
}

fn git_ok(dir: &Path, args: &[&str]) {
    assert!(std::process::Command::new("git").args(args).current_dir(dir).status().unwrap().success(), "git {args:?}");
}

/// A repository with one commit and a worktree `feat` beside it.
fn repo_with_branch(dir: &Path) -> (PathBuf, PathBuf) {
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
        git_ok(&repo, args);
    }
    let wt = dir.join("feat");
    git_ok(&repo, &["worktree", "add", "-q", "-b", "feat", &wt.to_string_lossy()]);
    (repo, wt)
}

fn pr(state: Option<&str>, draft: bool) -> Option<Pr> {
    state.map(|s| Pr { number: 7, url: "https://github.com/o/r/pull/7".into(), state: s.into(), title: Some("Fix".into()), head: Some("feat".into()), draft })
}

fn polled(path: &str, pr: Option<Pr>) -> PolledPr {
    PolledPr { path: path.into(), linked: false, pr, error: None }
}

/// The line `on_poll` builds for an opened pull request (automations.rs on_poll).
fn opened_line(p: &Pr) -> String {
    format!("Event: pull request #{} opened from {}: {} {}", p.number, p.head.as_deref().unwrap_or("its branch"), p.title.as_deref().unwrap_or("(no title)"), p.url)
}

fn event_row(id: &str, event: &str, ws: &Path) -> Value {
    json!({ "id": id, "name": id, "prompt": "review it", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": { "kind": "event", "event": event }, "enabled": true })
}

// ---------------------------------------------------------------- AUTO-001

#[test]
fn auto001_box1_a_weekday_automation_saved_on_friday_afternoon_shows_monday_0900() {
    let dir = scratch("a001b1");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "America/Chicago" });
    // Friday 9 October 2026, 15:30 in Chicago (CDT, UTC-5) is 20:30 UTC.
    let fri_afternoon = FRI_NOON + 8 * HOUR + HOUR / 2;
    let made = auto::save_automation(&store, &form(&dir, "r1", weekdays.clone()), fri_afternoon).unwrap();
    assert_eq!(made["nextRunLabel"], json!("Monday 09:00"));
    // Monday 12 October 09:00 CDT is 14:00 UTC.
    assert_eq!(made["nextRunAt"], json!(FRI_NOON + 3 * 24 * HOUR + 2 * HOUR));
    assert_eq!(made["trigger"]["cron"], json!("0 9 * * 1-5"));
    // Saturday and Sunday never run: saved late on Saturday it still reads Monday 09:00.
    let saturday = FRI_NOON + 24 * HOUR + 10 * HOUR;
    let again = auto::save_automation(&store, &form(&dir, "r2", weekdays), saturday).unwrap();
    assert_eq!(again["nextRunLabel"], json!("Monday 09:00"));
}

#[test]
fn auto001_box2_a_cron_line_with_61_in_the_minute_field_is_refused_when_saving() {
    let dir = scratch("a001b2");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let bad = json!({ "preset": "custom", "custom": "61 * * * *", "timezone": "UTC" });
    let said = auto::preview(&bad, FRI_NOON).unwrap_err();
    assert!(said.contains("minute field has 61; it takes 0 to 59"), "{said}");
    let refused = auto::save_automation(&store, &form(&dir, "r1", bad), FRI_NOON).unwrap_err();
    assert!(refused.contains("minute field has 61"), "{refused}");
    assert_eq!(count(&store), 0, "nothing written by the refused save");
}

#[test]
fn auto001_box3_a_cron_line_that_only_matches_29_february_shows_the_next_leap_year() {
    let dir = scratch("a001b3");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let leap = json!({ "preset": "custom", "custom": "0 0 29 2 *", "timezone": "UTC" });
    let made = auto::save_automation(&store, &form(&dir, "r1", leap), FRI_NOON).unwrap();
    // 29 February 2028, 00:00 UTC.
    let expected = jiff::civil::date(2028, 2, 29).at(0, 0, 0, 0).to_zoned(jiff::tz::TimeZone::UTC).unwrap().timestamp().as_millisecond();
    assert_eq!(made["nextRunAt"], json!(expected));
    assert_eq!(made["nextRunLabel"], json!("29 Feb 2028 00:00"));
}

#[test]
fn auto001_box4_pausing_stops_the_launch_and_resuming_fires_the_following_due_time() {
    let dir = scratch("a001b4");
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let hourly = json!({ "preset": "hourly", "time": "00:00", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", hourly), FRI_NOON).unwrap();
    let id = made["id"].as_str().unwrap().to_string();
    let due = made["nextRunAt"].as_i64().unwrap();
    assert_eq!(due, FRI_NOON + HOUR);

    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let starts = || said.borrow().iter().filter(|(_, v)| v["kind"] == "start").count();

    // Paused: its due time passes and nothing launches.
    assert_eq!(auto::set_enabled(&store.lock().unwrap(), &id, false).unwrap()["enabled"], json!(false));
    assert!(auto::tick(&l, due + 1_000).unwrap().is_empty());
    assert_eq!(starts(), 0);
    assert!(auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().is_empty());

    // Resumed: the upcoming time is worked out afresh; the old due time is not replayed, the next one fires.
    let resumed = auto::set_enabled(&store.lock().unwrap(), &id, true).unwrap();
    let next = resumed["nextRunAt"].as_i64().unwrap();
    assert_eq!(resumed["enabled"], json!(true));
    assert!(auto::tick(&l, next - 1).unwrap().is_empty(), "nothing before the following due time");
    assert_eq!(starts(), 0);
    let fired = auto::tick(&l, next + 1_000).unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!((fired[0]["automationId"].as_str(), fired[0]["trigger"].as_str(), fired[0]["status"].as_str()), (Some(id.as_str()), Some("schedule"), Some("dispatched")));
    assert_eq!(starts(), 1);
}

// ---------------------------------------------------------------- AUTO-004

#[test]
fn auto004_box1_a_draft_pull_request_opened_from_a_workspace_branch_starts_one_run_ending_with_its_line() {
    let dir = scratch("a004b1");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-1", "pr-opened", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

    // Two poll rounds, as the window feeds on_poll: no pull request yet, then a draft one open.
    let path = wt.to_string_lossy().to_string();
    let mut seen = HashMap::new();
    assert!(auto::pr_opened(&mut seen, &[polled(&path, None)]).is_empty());
    let opened = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), true))]);
    assert_eq!(opened.len(), 1, "a draft counts as opened");
    let mut runs = Vec::new();
    for (folder, p) in &opened {
        runs.extend(auto::on_event(&l, "pr-opened", folder, &opened_line(p), FRI_NOON).unwrap());
    }
    assert_eq!(runs.len(), 1);
    let line = "Event: pull request #7 opened from feat: Fix https://github.com/o/r/pull/7";
    assert_eq!(runs[0]["eventDetail"], json!(line), "the run's marker carries the description");
    let start = said.borrow().iter().find(|(_, v)| v["kind"] == "start").cloned().expect("the agent start");
    let prompt = start.1["prompt"].as_str().unwrap();
    assert!(prompt.starts_with("review it") && prompt.ends_with(line), "{prompt}");
    assert_eq!(said.borrow().iter().filter(|(_, v)| v["kind"] == "start").count(), 1);
    // The run lands in the workspace the automation names, not in the worktree the event came from.
    assert_eq!(start.1["path"], json!(repo.to_string_lossy()));
    // Staying open is no new event.
    assert!(auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), true))]).is_empty());
}

#[test]
fn auto004_box2_the_same_event_twice_inside_five_minutes_is_a_single_run() {
    let dir = scratch("a004b2");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-1", "pr-opened", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let path = wt.to_string_lossy().to_string();

    // The pull request opens, closes and opens again: two real events, two minutes apart.
    let mut seen = HashMap::new();
    let line = opened_line(&pr(Some("OPEN"), false).unwrap());
    auto::pr_opened(&mut seen, &[polled(&path, None)]);
    let first = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), false))]);
    assert_eq!(auto::on_event(&l, "pr-opened", &first[0].0, &line, FRI_NOON).unwrap().len(), 1);
    assert!(auto::pr_opened(&mut seen, &[polled(&path, None)]).is_empty());
    let second = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), false))]);
    assert_eq!(second.len(), 1, "the second event is a real one");
    assert!(auto::on_event(&l, "pr-opened", &second[0].0, &line, FRI_NOON + 2 * 60_000).unwrap().is_empty());
    let runs = auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().clone();
    assert_eq!(runs.len(), 1, "a single run");
    // After the five minutes it listens again.
    assert_eq!(auto::on_event(&l, "pr-opened", &path, &line, FRI_NOON + 5 * 60_000 + 1).unwrap().len(), 1);
}

#[test]
fn auto004_box3_an_agent_an_automation_launched_completing_starts_no_agent_finished_automation() {
    let dir = scratch("a004b3");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    let timed = json!({ "id": "auto-1", "name": "timed", "prompt": "go", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": { "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" }, "enabled": true });
    store.lock().unwrap().set(KEY, &json!([timed, event_row("auto-2", "agent-finished", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

    // The timed automation launches an agent; the window opens terminal 11 (hook pane 110) for it.
    let run = auto::run(&l, "auto-1", "manual").unwrap();
    assert_eq!(run["status"], json!("dispatched"));
    let claimed = auto::claim(&store.lock().unwrap(), 11, Some(110), &repo.to_string_lossy(), Some("claude"), run["id"].as_str(), auto::now_ms()).unwrap();
    assert_eq!(claimed.as_deref(), run["id"].as_str());

    // That agent works, then finishes: an ordinary finish, which on_finish would turn into an event ...
    let mut seen = HashMap::new();
    assert!(!auto::agent_finished(&mut seen, 110, "working", false, false, false));
    assert!(auto::agent_finished(&mut seen, 110, "done", false, false, false));
    // ... except that the pane is a run's own, so on_finish stops before on_event (MIRROR automations.rs on_finish, `if own`).
    let runs: Vec<Value> = serde_json::from_str(&store.lock().unwrap().get(RUNS_KEY).unwrap().unwrap()).unwrap();
    assert!(auto::own_pane(&runs, Some(11), 110));
    // A pane the user opened is not one: its finish does start the listening automation.
    assert!(!auto::own_pane(&runs, Some(12), 120));
    let line = "Event: claude finished its work in feat";
    let started = auto::on_event(&l, "agent-finished", &wt.to_string_lossy(), line, FRI_NOON).unwrap();
    assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-2"]);
}

#[test]
fn auto004_box3b_a_worktree_an_automation_made_never_sets_off_an_automation() {
    let dir = scratch("a004b3b");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-2", "agent-finished", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let path = wt.to_string_lossy().to_string();
    projects::set_origin(&store.lock().unwrap(), &path, Some(&json!({ "madeBy": "automation", "automationId": "auto-1" }))).unwrap();
    assert!(auto::on_event(&l, "agent-finished", &path, "Event: claude finished its work in feat", FRI_NOON).unwrap().is_empty());
}

#[test]
fn auto004_box4_restarting_while_a_pull_request_is_already_open_starts_no_run() {
    // The window's memory of each branch's review state lives in the process, so a restart is an empty map.
    let path = "C:/work/feat";
    let mut before = HashMap::new();
    assert!(auto::pr_opened(&mut before, &[polled(path, None)]).is_empty());
    assert_eq!(auto::pr_opened(&mut before, &[polled(path, pr(Some("OPEN"), false))]).len(), 1, "while running, the step fires");
    // Restart: the first state learned is an open pull request, a starting point only.
    let mut after = HashMap::new();
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), false))]).is_empty());
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), true))]).is_empty());
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), false))]).is_empty());
}

// ---------------------------------------------------------------- AUTO-005

#[test]
fn auto005_box1_a_created_automation_is_listed_at_once_with_its_upcoming_run() {
    let dir = scratch("a005b1");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    assert_eq!(count(&store), 0);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
    let made = auto::save_automation(&store, &form(&dir, "r1", weekdays), FRI_NOON).unwrap();
    let listed = auto::list(&store).unwrap();
    let row = listed["automations"].as_array().unwrap().iter().find(|a| a["id"] == made["id"]).expect("listed straight away");
    assert_eq!((row["name"].as_str(), row["enabled"].as_bool()), (Some("Morning"), Some(true)));
    assert!(row["nextRunAt"].as_i64().is_some(), "with its upcoming run");
}

#[test]
fn auto005_box2_the_same_create_sent_twice_leaves_one_automation() {
    let dir = scratch("a005b2");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
    let first = auto::save_automation(&store, &form(&dir, "req-1", weekdays.clone()), FRI_NOON).unwrap();
    let second = auto::save_automation(&store, &form(&dir, "req-1", weekdays), FRI_NOON + 1_000).unwrap();
    assert_eq!(first["id"], second["id"]);
    assert_eq!(count(&store), 1);
}

// ---------------------------------------------------------------- AUTO-012

/// A store with one existing-workspace claude automation, a launcher that only records, and its run started by hand.
fn started_run(tag: &str) -> (PathBuf, Mutex<Store>, PathBuf, Value) {
    let dir = scratch(tag);
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let hourly = json!({ "preset": "hourly", "time": "00:00", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", hourly), FRI_NOON).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let run = auto::run(&l, made["id"].as_str().unwrap(), "manual").unwrap();
    (dir, store, ws, run)
}

fn run_row(store: &Mutex<Store>, run_id: &str) -> Value {
    let all = auto::list(&store.lock().unwrap()).unwrap();
    all["runs"].as_array().unwrap().iter().find(|r| r["id"] == run_id).cloned().unwrap()
}

#[test]
fn auto012_box1_an_agent_killed_before_it_works_ends_failed_and_a_ready_prompt_never_completes_it() {
    let (_dir, store, ws, run) = started_run("a012b1");
    let id = run["id"].as_str().unwrap();
    assert_eq!(run_row(&store, id)["status"], json!("dispatched"));
    let s = store.lock().unwrap();
    assert_eq!(auto::claim(&s, 7, Some(3), &ws.to_string_lossy(), Some("claude"), Some(id), auto::now_ms()).unwrap().as_deref(), Some(id));
    // The agent's ready prompt already on screen at launch (an idle/done state, never seen working) is not a finish.
    assert_eq!(auto::on_status(&s, Some(7), 3, "done", false, false, None, FRI_NOON as u64).unwrap(), None);
    drop(s);
    assert_eq!(run_row(&store, id)["status"], json!("dispatched"), "a ready prompt is not a completion");
    // The agent is killed before it started working.
    let closed = auto::pane_ended(&store.lock().unwrap(), 7, Some(137), FRI_NOON as u64 + 1_000).unwrap();
    assert_eq!(closed.as_deref(), Some(id));
    let row = run_row(&store, id);
    assert_eq!(row["status"], json!("failed"));
    assert_ne!(row["status"], json!("completed"));
    assert_eq!(row["detail"], json!("The agent stopped before it began working (exit code 137)"));
}

#[test]
fn auto012_box2_a_run_in_progress_survives_a_restart_and_completes_when_the_agent_finishes() {
    let (_dir, store, ws, run) = started_run("a012b2");
    let id = run["id"].as_str().unwrap();
    let t0 = FRI_NOON as u64;
    {
        let s = store.lock().unwrap();
        auto::claim(&s, 7, Some(3), &ws.to_string_lossy(), Some("claude"), Some(id), auto::now_ms()).unwrap();
        assert_eq!(auto::on_status(&s, Some(7), 3, "working", false, false, None, t0).unwrap(), None);
        // Kolux restarts: the run stays dispatched, waiting for its pane.
        auto::tidy(&s, t0 + 5_000).unwrap();
    }
    let waiting = run_row(&store, id);
    assert_eq!(waiting["status"], json!("dispatched"));
    assert!(waiting["terminal"].is_null(), "the old process's terminal number is let go");
    // The terminal service still holds its terminal: tracking continues through it.
    let alive = |t: u32, p: Option<u32>| (t == 7 && p == Some(3)).then_some(auto::Held { alive: true, output: Some(("agent output so far".into(), false)) });
    assert_eq!(auto::reconnect(&store.lock().unwrap(), &alive, t0 + 6_000).unwrap(), vec![id.to_string()]);
    let back = run_row(&store, id);
    assert_eq!((back["status"].as_str(), back["terminal"].as_u64()), (Some("dispatched"), Some(7)));
    // Nothing closes it as lost, and the agent's genuine finish still completes it.
    assert!(auto::settle(&store.lock().unwrap(), t0 + auto::SETTLE_MS + 10_000).unwrap().is_empty());
    assert_eq!(auto::on_status(&store.lock().unwrap(), Some(7), 3, "done", false, false, None, t0 + 60_000).unwrap().as_deref(), Some(id));
    let done = run_row(&store, id);
    assert_eq!(done["status"], json!("completed"));
    assert_eq!(done["finishedAt"], json!(t0 + 60_000));
}

#[test]
fn auto012_box3_twelve_refusals_in_an_hour_for_a_gone_project_collapse_into_one_skipped_entry() {
    let dir = scratch("a012b3");
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let every5 = json!({ "preset": "custom", "custom": "*/5 * * * *", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", every5), auto::now_ms() as i64).unwrap();
    let id = made["id"].as_str().unwrap().to_string();
    let first_due = made["nextRunAt"].as_i64().unwrap();
    // The project is removed from Kolux.
    store.lock().unwrap().set("projects", "[]").unwrap();

    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    for k in 0..12 {
        let out = auto::tick(&l, first_due + k * 300_000 + 1_000).unwrap();
        assert_eq!(out.len(), 1, "due time {k} is looked at");
    }
    let all = auto::list(&store.lock().unwrap()).unwrap();
    let mine: Vec<&Value> = all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == id.as_str()).collect();
    assert_eq!(mine.len(), 1, "one entry, not twelve: {mine:?}");
    assert_eq!((mine[0]["status"].as_str(), mine[0]["cause"].as_str()), (Some("skipped"), Some("unavailable")));
    assert_eq!(mine[0]["detail"], json!("its project is no longer in Kolux"));
    assert_eq!(mine[0]["repeats"], json!(12));
}

// ---------------------------------------------------------------- AUTO-013

#[test]
fn auto013_box1_a_run_whose_worktree_was_deleted_still_lists_with_its_saved_output_and_a_gone_flag() {
    let (_dir, store, ws, run) = started_run("a013b1");
    let id = run["id"].as_str().unwrap();
    let t0 = FRI_NOON as u64;
    {
        let s = store.lock().unwrap();
        auto::claim(&s, 7, Some(3), &ws.to_string_lossy(), Some("claude"), Some(id), auto::now_ms()).unwrap();
        auto::on_status(&s, Some(7), 3, "working", false, false, None, t0).unwrap();
        auto::on_status(&s, Some(7), 3, "done", false, false, None, t0 + 1_000).unwrap();
        assert_eq!(auto::keep_output(&s, id, "all 12 checks passed", false).unwrap().as_deref(), Some(id));
    }
    let live = run_row(&store, id);
    assert_eq!(live["worktree"].as_str().map(|w| w.replace('\u{5c}', "/")), Some(ws.to_string_lossy().replace('\u{5c}', "/")));
    assert!(live["worktreeGone"].is_null(), "the worktree is still there");
    // The run's worktree is deleted: the row is still listed, flagged gone, and carries the output saved when it ended.
    std::fs::remove_dir_all(&ws).unwrap();
    let gone = run_row(&store, id);
    assert_eq!(gone["worktreeGone"], json!(true));
    assert_eq!(gone["output"], json!("all 12 checks passed"));
    assert_eq!(gone["number"], json!(1));
}

#[test]
fn auto013_box2_deleting_an_automation_takes_its_failed_run_with_it_and_leaves_other_histories() {
    let (_dir, store, ws, run) = started_run("a013b2");
    let id = run["id"].as_str().unwrap();
    {
        let s = store.lock().unwrap();
        auto::claim(&s, 7, Some(3), &ws.to_string_lossy(), Some("claude"), Some(id), auto::now_ms()).unwrap();
        auto::pane_ended(&s, 7, Some(1), FRI_NOON as u64).unwrap();
    }
    let failed = run_row(&store, id);
    assert_eq!(failed["status"], json!("failed"));
    let auto_id = failed["automationId"].as_str().unwrap().to_string();
    // A second automation's history must stay.
    let hourly = json!({ "preset": "hourly", "time": "00:00", "timezone": "UTC" });
    let other = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r2", hourly), FRI_NOON).unwrap();
    let other_id = other["id"].as_str().unwrap().to_string();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: PathBuf::new(), installed: &yes, notify: &notify };
    let kept = auto::run(&l, &other_id, "manual").unwrap();

    auto::delete(&store.lock().unwrap(), &auto_id).unwrap();
    let all = auto::list(&store.lock().unwrap()).unwrap();
    let runs = all["runs"].as_array().unwrap();
    assert!(runs.iter().all(|r| r["automationId"] != auto_id.as_str()), "the failed run (and so its Rerun) is gone");
    assert!(runs.iter().any(|r| r["id"] == kept["id"]), "another automation's run stays");
    assert!(all["automations"].as_array().unwrap().iter().all(|a| a["id"] != auto_id.as_str()));
}

#[test]
fn auto013_box3_unreadable_run_history_is_reported_as_an_error_not_as_an_empty_list() {
    let (_dir, store, _ws, _run) = started_run("a013b3");
    store.lock().unwrap().set(RUNS_KEY, "{ not a list").unwrap();
    let all = auto::list(&store.lock().unwrap()).unwrap();
    let err = all["runsError"].as_str().expect("an error is reported with the list");
    assert!(err.starts_with("the saved runs could not be read"), "{err}");
    assert_eq!(all["automations"].as_array().unwrap().len(), 1, "the automations themselves still list");
    assert_eq!(all["runs"], json!([]));
    // A healthy empty history carries no error: the page can tell the two apart.
    store.lock().unwrap().set(RUNS_KEY, "[]").unwrap();
    assert!(auto::list(&store.lock().unwrap()).unwrap()["runsError"].is_null());
}

// ---------------------------------------------------------------- AUTO-019 (backend halves)

#[test]
fn auto019_box1_run_now_on_a_paused_automation_logs_a_manual_run_in_its_history() {
    let dir = scratch("a019b1");
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let daily = json!({ "preset": "daily", "time": "02:00", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", daily), FRI_NOON).unwrap();
    let id = made["id"].as_str().unwrap().to_string();
    assert_eq!(auto::set_enabled(&store.lock().unwrap(), &id, false).unwrap()["enabled"], json!(false));
    assert!(auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().is_empty());

    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let out = auto::run(&l, &id, "manual").unwrap();
    assert_eq!((out["automationId"].as_str(), out["trigger"].as_str(), out["number"].as_u64()), (Some(id.as_str()), Some("manual"), Some(1)));
    let all = auto::list(&store.lock().unwrap()).unwrap();
    let runs = all["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!((runs[0]["id"].as_str(), runs[0]["trigger"].as_str()), (out["id"].as_str(), Some("manual")));
    assert_eq!(said.borrow().iter().filter(|(_, v)| v["kind"] == "start").count(), 1, "the run was handed to the window to start");
    assert_eq!(all["automations"][0]["enabled"], json!(false), "it is still paused afterwards");
}

#[test]
fn auto019_box3_a_paused_automation_runs_nothing_when_its_due_time_comes() {
    let dir = scratch("a019b3");
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let every5 = json!({ "preset": "custom", "custom": "*/5 * * * *", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", every5), FRI_NOON).unwrap();
    let id = made["id"].as_str().unwrap().to_string();
    let due = made["nextRunAt"].as_i64().unwrap();
    auto::set_enabled(&store.lock().unwrap(), &id, false).unwrap();

    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    for k in 0..3 {
        assert!(auto::tick(&l, due + k * 300_000 + 1_000).unwrap().is_empty(), "due time {k} passes with nothing run");
    }
    assert!(said.borrow().is_empty(), "nothing told the window to start anything");
    assert!(auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().is_empty());
}
