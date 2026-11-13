//! spec/08 P0 boxes ORCH-001, 002, 003, 005, 006, 007: Runs, typed mail, check batches, replies, and the
//! idle-agent pointer. Every call goes through the crate's pub API; no agent is started.

use kolux_lib::cli::{dispatch, parse, serve_loop, Ctx, Fail, Pane, Request};
use kolux_lib::git::Git;
use kolux_lib::orchestration::pointer::{pump, readers, Arrival, PaneLook, Pointers, POLL};
use kolux_lib::orchestration::{self as o, Mail, Mode, Peer};
use kolux_lib::state::Store;
use kolux_lib::terminal::Terminals;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-cards08-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The `--flag value` words of a typed command line as the arguments the app receives.
fn typed(line: &str) -> (String, Value) {
    let words: Vec<String> = line.split_whitespace().map(String::from).collect();
    let (_, parsed) = parse(&words);
    let p = parsed.unwrap().unwrap();
    (p.command, Value::Object(p.args))
}

/// One command line sent through the real `dispatch`, from `pane` when given.
fn run_line(store: &Mutex<Store>, line: &str, pane: Option<Pane>) -> Result<Value, Fail> {
    let (command, args) = typed(line);
    let git = Git::detect().unwrap();
    let terminals = Terminals::default();
    let notify = |_v: Value| {};
    let ctx = Ctx { claude_config: std::env::temp_dir().join("cards08-claude.json"), git: &git, store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    let req = Request { id: "r".into(), token: String::new(), command, cwd: std::env::temp_dir().display().to_string(), args, pane, cli: String::new(), arrived: None };
    dispatch(&ctx, &req)
}

fn peer(handle: &str, agent: Option<&str>) -> Peer {
    Peer { handle: handle.into(), agent: agent.map(String::from), idle: true, dir: "C:/work".into() }
}

fn ids_of(v: &Value) -> Vec<String> {
    v["messageIds"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

fn subjects(check: &Value) -> Vec<String> {
    check["messages"].as_array().unwrap().iter().map(|m| m["subject"].as_str().unwrap().to_string()).collect()
}

fn send(m: &mut Mail, from: &str, line: &str, peers: &[Peer]) -> Result<Value, Fail> {
    let (_, args) = typed(line);
    m.post(from, &args, &[], peers, 100)
}

// ---------------------------------------------------------------- ORCH-001

#[test]
fn orch001_box1_run_create_in_a_known_pane_replies_with_a_run_id_and_run_current_prints_the_same_id() {
    // The calling pane is one the runtime vouches for: its secret key maps to term-1.
    let by_key = |k: &str| (k == "secret-1").then(|| "term-1".to_string());
    let pane = o::caller_of(None, Some(("term-1", "secret-1")), &by_key).unwrap().expect("a known pane is somebody");
    assert_eq!(pane, "term-1");
    let mut m = Mail::default();
    let reply = m.run_create(&pane, "ship the release", 5);
    let id = reply["run"]["id"].as_str().expect("the JSON reply holds a Run id").to_string();
    assert!(!id.is_empty());
    assert_eq!(reply["run"]["objective"], "ship the release");
    assert_eq!(reply["binding"], json!({ "terminal": "term-1", "runId": id }));
    // Saved and read back, the way the next command from the same pane sees it.
    let dir = scratch("o1b1");
    let store = Store::open(&dir).unwrap();
    m.save(&store).unwrap();
    let again = Mail::load(&store);
    assert_eq!(again.run_current("term-1")["runId"], json!(id));
    assert_eq!(m.run_current("term-1")["runId"], json!(id));
    // A Run schedules nothing and places no workers.
    assert!(again.messages.is_empty() && again.deliveries.is_empty());
}

#[test]
fn orch001_box2_run_create_from_a_shell_the_runtime_does_not_know_is_turned_away_and_no_run_exists() {
    let dir = scratch("o1b2");
    let store = Mutex::new(Store::open(&dir).unwrap());
    for pane in [None, Some(Pane { handle: "term-1".into(), key: "guessed-key".into() })] {
        let err = run_line(&store, "orchestration run-create --objective ship", pane).expect_err("a plain shell is turned away");
        assert_eq!(err.code, "unbound_caller", "{}", err.message);
    }
    let err = run_line(&store, "orchestration run-create --objective ship --from term-1", None).expect_err("--from cannot stand in for an identity");
    assert_eq!(err.code, "unbound_caller", "{}", err.message);
    let after = Mail::load(&store.lock().unwrap());
    assert!(after.runs.is_empty() && after.bindings.is_empty(), "no Run exists afterwards: {:?}", after.runs);
    let listed = run_line(&store, "orchestration run-list", None).unwrap();
    assert_eq!(listed["total"], 0);
}

#[test]
fn orch001_box3_run_create_twice_with_the_same_retry_request_id_makes_one_run() {
    let (command, args) = typed("orchestration run-create --objective ship --retry-request 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a");
    assert_eq!(command, "orchestration.run-create");
    assert_eq!(args["retryRequest"], "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a");
    // The app keys a retry by command, pane and request id (cli.rs `mail`); the repeat logic is `Mail::once`.
    let key = Some(format!("{command}|term-1|1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a"));
    let mut m = Mail::default();
    let first = m.once(key.clone(), |m| Ok(m.run_create("term-1", "ship", 5))).unwrap();
    let second = m.once(key, |m| Ok(m.run_create("term-1", "ship", 6))).unwrap();
    assert_eq!(first["run"]["id"], second["run"]["id"], "one Run id both times");
    assert_eq!(first, second, "the same id hands back the first answer");
    assert_eq!(m.runs.len(), 1, "the number of Runs does not change");
    // Without a retry id a repeat does make another Run, so the id is what protects it.
    m.once(None, |m| Ok(m.run_create("term-1", "ship", 7))).unwrap();
    assert_eq!(m.runs.len(), 2);
}

// ---------------------------------------------------------------- ORCH-002

#[test]
fn orch002_box1_run_use_points_the_pane_at_the_first_run_and_task_list_shows_only_its_tasks() {
    let mut m = Mail::default();
    let first = m.run_create("term-1", "first", 1)["run"]["id"].as_str().unwrap().to_string();
    let second = m.run_create("term-1", "second", 2)["run"]["id"].as_str().unwrap().to_string();
    assert_eq!(m.run_current("term-1")["runId"], json!(second), "the newest Run is the home until run-use moves it");
    let mut tasks = Vec::new();
    o::task_create(&mut tasks, &json!({ "spec": "alpha work" }), Some(first.clone()), 3).unwrap();
    o::task_create(&mut tasks, &json!({ "spec": "beta work" }), Some(second.clone()), 4).unwrap();
    let used = m.run_use("term-1", &first).unwrap();
    assert_eq!(used["binding"]["runId"], json!(first));
    assert_eq!(m.run_current("term-1")["runId"], json!(first), "run-current prints the first");
    // `task-list` acts in the pane's own Run (cli.rs `tasks`: `m.run_of(pane)`).
    let run = m.run_of("term-1", &[]);
    let list = o::task_list(&tasks, &[], run.as_deref(), &json!({}), &|_| false).unwrap();
    let specs: Vec<&str> = list["tasks"].as_array().unwrap().iter().map(|t| t["spec"].as_str().unwrap()).collect();
    assert_eq!(specs, vec!["alpha work"]);
    // Through the real command with the Run named, the same filter holds on the wire.
    let dir = scratch("o2b1");
    let store = Mutex::new(Store::open(&dir).unwrap());
    m.save(&store.lock().unwrap()).unwrap();
    store.lock().unwrap().set(o::TASKS_KEY, &Value::Array(tasks).to_string()).unwrap();
    let a = run_line(&store, &format!("orchestration task-list --run {first}"), None).unwrap();
    let b = run_line(&store, &format!("orchestration task-list --run {second}"), None).unwrap();
    assert_eq!(a["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(a["tasks"][0]["spec"], "alpha work");
    assert_eq!(b["tasks"][0]["spec"], "beta work");
    // An unknown Run cannot be used.
    assert_eq!(m.run_use("term-1", "run-99").unwrap_err().code, "not_found");
}

#[test]
fn orch002_box2_run_list_with_a_page_size_of_one_gives_one_run_and_a_cursor_that_returns_the_next() {
    let dir = scratch("o2b2");
    let store = Mutex::new(Store::open(&dir).unwrap());
    let mut m = Mail::default();
    let first = m.run_create("term-1", "first", 1)["run"]["id"].as_str().unwrap().to_string();
    let second = m.run_create("term-2", "second", 2)["run"]["id"].as_str().unwrap().to_string();
    m.save(&store.lock().unwrap()).unwrap();
    let page = run_line(&store, "orchestration run-list --limit 1", None).unwrap();
    let runs = page["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1, "one Run");
    assert_eq!(runs[0]["id"], json!(second), "newest first");
    let cursor = page["nextCursor"].as_str().expect("and a cursor").to_string();
    let next = run_line(&store, &format!("orchestration run-list --limit 1 --cursor {cursor}"), None).unwrap();
    let runs = next["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["id"], json!(first), "handing the cursor back returns the next Run");
    assert!(next["nextCursor"].is_null(), "and no cursor after the last");
    let shown = run_line(&store, &format!("orchestration run-show --id {first}"), None).unwrap();
    assert_eq!(shown["objective"], "first");
}

// ---------------------------------------------------------------- ORCH-003

fn two_panes() -> (Mail, String, Vec<Peer>) {
    let mut m = Mail::default();
    let run = m.run_create("term-1", "ship", 1)["run"]["id"].as_str().unwrap().to_string();
    (m, run, vec![peer("term-1", Some("claude")), peer("term-2", Some("claude"))])
}

#[test]
fn orch003_box1_send_to_a_run_gives_one_message_id_and_the_coordinators_check_returns_it() {
    let (mut m, run, peers) = two_panes();
    let receipt = send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject hello"), &peers).unwrap();
    let ids = ids_of(&receipt);
    assert_eq!(ids.len(), 1, "a receipt with one message id");
    assert_eq!(receipt["to"], json!(format!("run:{run}")));
    let boxes = m.boxes_of("term-1", &[]);
    let got = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&got), vec!["hello"]);
    assert_eq!(got["messages"][0]["id"], json!(ids[0]));
    assert_eq!(got["messages"][0]["from"], "term-2");
}

#[test]
fn orch003_box2_a_done_report_with_no_outcome_is_turned_away_and_nothing_is_stored() {
    let (mut m, run, peers) = two_panes();
    let (seq, runs) = (m.messages.len(), m.runs.len());
    let err = send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject finished --type worker_done"), &peers).unwrap_err();
    assert_eq!(err.code, "invalid_arguments");
    assert!(err.message.contains("--outcome"), "{}", err.message);
    assert_eq!((m.messages.len(), m.deliveries.len(), m.runs.len()), (seq, 0, runs), "nothing is stored");
    // With an outcome the same report is accepted, so the outcome is what was missing.
    let ok = send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject finished --type worker_done --outcome succeeded"), &peers).unwrap();
    assert_eq!(ids_of(&ok).len(), 1);
}

#[test]
fn orch003_box3_a_heartbeat_to_a_group_is_turned_away() {
    // The command line itself refuses it before the app is asked.
    let words: Vec<String> = "orchestration send --to @all --subject alive --type heartbeat".split_whitespace().map(String::from).collect();
    let refused = parse(&words).1.expect_err("the parser turns a group heartbeat away");
    assert_eq!(refused.code, "invalid_arguments");
    assert!(refused.message.contains("never to a group"), "{}", refused.message);
    // And the app refuses it too when the words reach it by another road.
    let (mut m, _run, peers) = two_panes();
    let args = json!({ "to": "@all", "subject": "alive", "type": "heartbeat" });
    let err = m.post("term-2", &args, &[], &peers, 100).unwrap_err();
    assert_eq!(err.code, "invalid_arguments");
    assert!(err.message.contains("never go to a group"), "{}", err.message);
    assert!(m.messages.is_empty(), "nothing is stored");
    // A status to the same group is not turned away for that reason: it reaches the other agent.
    let ok = send(&mut m, "term-2", "orchestration send --to @all --subject hi", &peers).unwrap();
    assert_eq!(ids_of(&ok).len(), 1);
}

// ---------------------------------------------------------------- ORCH-005

fn mail_with_two() -> (Mail, Vec<String>) {
    let (mut m, run, peers) = two_panes();
    let a = ids_of(&send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject first"), &peers).unwrap());
    let b = ids_of(&send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject second"), &peers).unwrap());
    (m, vec![a[0].clone(), b[0].clone()])
}

#[test]
fn orch005_box1_two_messages_come_back_in_order_under_one_delivery_id_and_again_until_acknowledged() {
    let (mut m, ids) = mail_with_two();
    let boxes = m.boxes_of("term-1", &[]);
    let one = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&one), vec!["first", "second"], "both, in order");
    assert_eq!(one["messages"][0]["id"], json!(ids[0]));
    let delivery = one["deliveryId"].as_str().expect("under one delivery id").to_string();
    let two = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&two), vec!["first", "second"], "the same two again");
    assert_eq!(two["deliveryId"], json!(delivery), "under the same delivery id");
    // Peek reads without touching delivery state.
    let before = m.deliveries.clone();
    let peek = m.check("term-1", "term-1", &boxes, Mode::Peek, None, None, None).unwrap();
    assert_eq!(subjects(&peek), vec!["first", "second"]);
    assert_eq!(m.deliveries, before);
}

#[test]
fn orch005_box2_acknowledging_the_delivery_id_then_check_returns_nothing() {
    let (mut m, _ids) = mail_with_two();
    let boxes = m.boxes_of("term-1", &[]);
    let one = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    let delivery = one["deliveryId"].as_str().unwrap().to_string();
    let acked = m.check("term-1", "term-1", &boxes, Mode::Next, None, Some(&delivery), None).unwrap();
    assert!(acked["messages"].as_array().unwrap().is_empty(), "{acked}");
    let after = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert!(after["messages"].as_array().unwrap().is_empty(), "nothing");
    assert!(after["deliveryId"].is_null());
    // The acknowledged mail stays in the box for `all`.
    let all = m.check("term-1", "term-1", &boxes, Mode::All, None, None, None).unwrap();
    assert_eq!(subjects(&all), vec!["first", "second"]);
}

/// A stand-in for the app on a local port: `orchestration.check` answers from a real `Mail` for the
/// pane `term-1`, the way cli.rs `mail` does; everything else is refused. Returns the CLI's folder.
fn app_on_a_port(tag: &str, mail: Arc<Mutex<Mail>>) -> PathBuf {
    let dir = scratch(tag);
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    std::fs::write(dir.join("cli.json"), json!({ "port": port, "token": "tok" }).to_string()).unwrap();
    std::thread::spawn(move || {
        serve_loop(listener, "tok", "cards", move |req: &Request| {
            if req.command != "orchestration.check" {
                return Err(Fail::new("invalid_arguments", format!("unknown command {}", req.command)));
            }
            let pane = req.pane.as_ref().map(|p| p.handle.clone()).ok_or_else(|| Fail::new("unbound_caller", "no pane"))?;
            let mut m = mail.lock().unwrap();
            let boxes = m.boxes_of(&pane, &[]);
            let a = &req.args;
            let mode = if a["peek"] == true { Mode::Peek } else { Mode::Next };
            m.check(&pane, &pane, &boxes, mode, None, a["ack"].as_str(), a["fence"].as_u64())
        });
    });
    dir
}

/// The development command line (`kolux-dev`) run as `term-1` against the stand-in app.
fn cli_child(dir: &PathBuf, words: &[&str]) -> std::process::Child {
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_kolux-dev"));
    cmd.args(words).env("KOLUX_APP_DIR", dir).env("KOLUX_TERMINAL_HANDLE", "term-1").env("KOLUX_PANE_KEY", "secret-1");
    for k in ["KOLUX_USER_DATA_PATH", "KOLUX_KEEPALIVE_INTERVAL_MS", "KOLUX_HEARTBEAT_INTERVAL_MS"] {
        cmd.env_remove(k);
    }
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().expect("the development command line starts")
}

fn keepalives(stderr: &str) -> Vec<Value> {
    stderr.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(|v| v["_keepalive"] == true).collect()
}

#[test]
fn orch005_box3_check_wait_with_no_mail_writes_two_keepalive_lines_to_stderr_then_times_out() {
    let mail = Arc::new(Mutex::new(Mail::default()));
    mail.lock().unwrap().run_create("term-1", "ship", 1);
    let dir = app_on_a_port("o5b3", mail);
    let started = Instant::now();
    let out = cli_child(&dir, &["orchestration", "check", "--wait", "--timeout-ms", "40000", "--json"]).wait_with_output().unwrap();
    let waited = started.elapsed();
    let (stdout, stderr) = (String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let lines = keepalives(&stderr);
    assert!(lines.len() >= 2, "at least two keepalive lines on standard error: {stderr}");
    assert!(lines.iter().all(|v| v["_heartbeat"] == true), "the older alias rides along");
    assert!(lines[0]["elapsedMs"].as_u64().unwrap() >= 14_000 && lines[0]["elapsedMs"].as_u64().unwrap() < 17_000, "roughly every 15 seconds: {:?}", lines[0]);
    assert_eq!(lines[0]["deadlineMs"], 40_000);
    let env: Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("stdout is the JSON result ({e}): {stdout}"));
    assert_eq!(env["success"], true);
    assert_eq!(env["result"]["timedOut"], true, "then a timeout result");
    assert!(env["result"]["messages"].as_array().unwrap().is_empty());
    assert!(waited >= Duration::from_secs(39) && waited < Duration::from_secs(50), "{waited:?}");
}

// ---------------------------------------------------------------- ORCH-006

#[test]
fn orch006_box1_a_workers_reply_reaches_the_coordinators_check_on_the_same_thread() {
    let (mut m, run, peers) = two_panes();
    // The coordinator writes to the worker's handle on thread T-1; the worker answers it by id.
    let sent = ids_of(&send(&mut m, "term-1", "orchestration send --to term-2 --subject plan --body go --thread-id T-1", &peers).unwrap());
    let worker_boxes = m.boxes_of("term-2", &[]);
    let seen = m.check("term-2", "term-2", &worker_boxes, Mode::Peek, None, None, None).unwrap();
    assert!(seen["messages"][0]["reply"].as_str().unwrap().contains(&format!("orchestration reply --id {}", sent[0])), "a ready-made reply command rides on every message");
    let mine = m.run_of("term-2", &[]);
    let answered = m.reply("term-2", &sent[0], "done it", None, &worker_boxes, mine.as_deref(), 200).unwrap();
    assert_eq!(answered["threadId"], "T-1");
    let boxes = m.boxes_of("term-1", &[]);
    let got = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&got), vec!["Re: plan"]);
    assert_eq!(got["messages"][0]["body"], "done it");
    assert_eq!(got["messages"][0]["from"], "term-2");
    assert_eq!(got["messages"][0]["threadId"], "T-1", "the coordinator's check shows the reply on the same thread id");
    // A message with no thread starts one: the reply carries that message's id as its thread.
    let plain = ids_of(&send(&mut m, "term-1", &format!("orchestration send --to run:{run} --subject ping"), &peers).unwrap());
    let bx = m.boxes_of("term-1", &[]);
    let r = m.reply("term-1", &plain[0], "self", None, &bx, Some(&run), 300).unwrap();
    assert_eq!(r["threadId"], json!(plain[0]));
}

#[test]
fn orch006_box2_inbox_with_a_limit_of_five_shows_five_rows_and_full_shows_whole_bodies() {
    let (mut m, run, peers) = two_panes();
    let long = "x".repeat(400);
    for i in 0..8 {
        let (_, mut args) = typed(&format!("orchestration send --to run:{run} --subject note{i}"));
        args["body"] = json!(long);
        m.post("term-2", &args, &[], &peers, 100 + i).unwrap();
    }
    let boxes = m.boxes_of("term-1", &[]);
    let (_, args) = typed("orchestration inbox --limit 5");
    assert_eq!(args["limit"], "5");
    let five = m.inbox("term-1", &boxes, 5, false);
    let rows = five["messages"].as_array().unwrap();
    assert_eq!(rows.len(), 5, "five rows at most");
    assert_eq!(rows[0]["subject"], "note7", "the newest first");
    assert!(rows.iter().all(|r| r["body"].as_str().unwrap().len() < 400), "shortened without the full option");
    let (_, args) = typed("orchestration inbox --limit 5 --full");
    assert_eq!(args["full"], true);
    let full = m.inbox("term-1", &boxes, 5, true);
    let rows = full["messages"].as_array().unwrap();
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().all(|r| r["body"] == json!(long)), "with the full option the bodies are shown whole");
    assert!(m.deliveries.is_empty(), "inbox acknowledges nothing and reads nothing into a delivery");
    let still = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(still["messages"].as_array().unwrap().len(), 8, "all eight are still unread");
}

// ---------------------------------------------------------------- ORCH-007

fn idle_look(now_ms: u64) -> PaneLook {
    PaneLook { now_ms, live: true, hooks_state: Some("idle".into()), quiet_ms: Some(5_000), ..PaneLook::default() }
}

/// A coordinator tied to a Run and a worker's message to `run:<id>`; returns what a pointer queues.
fn worker_writes_to_the_run() -> (Mail, String, Arrival) {
    let (mut m, run, peers) = two_panes();
    let id = ids_of(&send(&mut m, "term-2", &format!("orchestration send --to run:{run} --subject hello"), &peers).unwrap()).remove(0);
    let to = m.messages.iter().find(|x| x.id == id).unwrap().to.clone();
    assert_eq!(readers(&m, &to, &[], "term-2"), vec!["term-1".to_string()], "the coordinator reads the Run's box, the sender is left out");
    (m, run.clone(), Arrival { id, run: Some(run) })
}

fn bound_runs(m: &Mail) -> Vec<(String, String)> {
    m.bindings.iter().filter_map(|(h, b)| b.run.clone().map(|r| (h.clone(), r))).collect()
}

#[test]
fn orch007_box1_parts_an_idle_coordinator_is_shown_one_line_naming_the_exact_check_command_within_seconds() {
    let (m, run, arrival) = worker_writes_to_the_run();
    let mut p = Pointers::default();
    p.rebind(bound_runs(&m));
    assert!(p.arrive("term-1", arrival), "a runner starts for the pane");
    let (p, typed_lines) = (Mutex::new(p), RefCell::new(Vec::new()));
    let started = Instant::now();
    pump(&p, "term-1", false, || idle_look(started.elapsed().as_millis() as u64), |line, enter| { typed_lines.borrow_mut().push((line.to_string(), enter)); true }, std::thread::sleep);
    assert!(started.elapsed() < Duration::from_secs(3), "within a few seconds");
    let lines = typed_lines.into_inner();
    assert_eq!(lines.len(), 1, "one line");
    assert_eq!(lines[0].0, format!("1 orchestration message is waiting for you in {run}; read them with: {} orchestration check --run {run}", o::CLI));
    assert!(lines[0].1, "Enter follows the line");
    // The typed command is a real one: it parses to `check` for that Run, and it reads the message.
    let cmd = lines[0].0.split("read them with: ").nth(1).unwrap();
    let words: Vec<String> = cmd.split_whitespace().skip(1).map(String::from).collect();
    let (_, parsed) = parse(&words);
    let parsed = parsed.unwrap().unwrap();
    assert_eq!((parsed.command.as_str(), parsed.args["run"].as_str()), ("orchestration.check", Some(run.as_str())));
    let mut m = m;
    let got = m.check("term-1", &format!("run:{run}"), &[format!("run:{run}")], Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&got), vec!["hello"]);
}

#[test]
fn orch007_box2_a_coordinator_in_the_middle_of_a_turn_gets_no_line_until_the_turn_ends() {
    let (m, _run, arrival) = worker_writes_to_the_run();
    let mut p = Pointers::default();
    p.rebind(bound_runs(&m));
    p.arrive("term-1", arrival);
    let p = Mutex::new(p);
    let holds = Cell::new(0u32);
    let typed_at = RefCell::new(Vec::new());
    let look = || PaneLook { now_ms: 1_000 * u64::from(holds.get()), live: true, hooks_state: Some(if holds.get() < 4 { "working" } else { "done" }.into()), quiet_ms: Some(0), ..PaneLook::default() };
    pump(&p, "term-1", false, look, |line, _| { typed_at.borrow_mut().push((holds.get(), line.to_string())); true }, |d| {
        assert_eq!(d, POLL);
        holds.set(holds.get() + 1);
    });
    let typed_at = typed_at.into_inner();
    assert_eq!(typed_at.len(), 1);
    assert_eq!(typed_at[0].0, 4, "the line waited through four looks at a working agent and went in when it said done");
    // Also while the turn is still on, the decision itself is a hold and queues nothing for later.
    let mut q = Pointers::default();
    q.rebind(bound_runs(&m));
    q.arrive("term-1", Arrival { id: "msg-x".into(), run: None });
    let working = PaneLook { now_ms: 10, live: true, hooks_state: Some("working".into()), ..PaneLook::default() };
    assert!(matches!(q.decide("term-1", &working, false), kolux_lib::orchestration::pointer::Decision::Hold(_)));
}

#[test]
fn orch007_box3_a_coordinator_blocked_in_a_waiting_check_gets_nothing_typed_and_the_wait_returns_the_message() {
    let (mut m, run, arrival) = worker_writes_to_the_run();
    let mut p = Pointers::default();
    p.rebind(bound_runs(&m));
    // The waiting check asked again a moment ago (`check --wait` asks every half second).
    p.checked("term-1", true, 9_800);
    assert!(p.arrive("term-1", arrival), "the mail arrives for a pane that is waiting");
    let p = Mutex::new(p);
    let typed_lines = RefCell::new(Vec::new());
    pump(&p, "term-1", false, || idle_look(10_000), |line, _| { typed_lines.borrow_mut().push(line.to_string()); true }, |_| {});
    assert!(typed_lines.into_inner().is_empty(), "nothing typed");
    // The wait returns the message: the next ask of the same waiting check carries it.
    let boxes = m.boxes_of("term-1", &[]);
    assert!(boxes.contains(&format!("run:{run}")));
    let got = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!(subjects(&got), vec!["hello"]);
}

#[test]
fn orch007_box3_over_the_wire_a_waiting_check_returns_the_message_the_moment_it_arrives() {
    let mail = Arc::new(Mutex::new(Mail::default()));
    let run = mail.lock().unwrap().run_create("term-1", "ship", 1)["run"]["id"].as_str().unwrap().to_string();
    let dir = app_on_a_port("o7b3", mail.clone());
    let child = cli_child(&dir, &["orchestration", "check", "--wait", "--timeout-ms", "30000", "--json"]);
    std::thread::sleep(Duration::from_millis(2_500));
    let peers = [peer("term-1", Some("claude")), peer("term-2", Some("claude"))];
    let (_, mut args) = typed(&format!("orchestration send --to run:{run} --subject arrived"));
    args["body"] = json!("while you waited");
    let started = Instant::now();
    mail.lock().unwrap().post("term-2", &args, &[], &peers, 50).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(started.elapsed() < Duration::from_secs(5), "returned promptly after the send: {:?}", started.elapsed());
    let env: Value = serde_json::from_str(&String::from_utf8_lossy(&out.stdout)).unwrap();
    assert_eq!(env["success"], true);
    assert!(env["result"]["timedOut"].is_null());
    assert_eq!(env["result"]["messages"][0]["subject"], "arrived");
}

// ---------------------------------------------------------------- ORCH-010 .. ORCH-014

fn make_task(tasks: &mut Vec<Value>, line: &str, now: u64) -> Result<Value, Fail> {
    let (_, args) = typed(line);
    o::task_create(tasks, &args, None, now)
}

fn store_with(tag: &str, tasks: &[Value], dispatches: &[Value]) -> Mutex<Store> {
    let store = Store::open(&scratch(tag)).unwrap();
    store.set(o::TASKS_KEY, &Value::Array(tasks.to_vec()).to_string()).unwrap();
    store.set(o::DISPATCHES_KEY, &Value::Array(dispatches.to_vec()).to_string()).unwrap();
    Mutex::new(store)
}

fn stored(store: &Mutex<Store>, key: &str) -> Vec<Value> {
    let raw = store.lock().unwrap().get(key).unwrap().unwrap_or_else(|| "[]".into());
    serde_json::from_str::<Vec<Value>>(&raw).unwrap()
}

fn status_of(list: &Value, id: &str) -> String {
    list["tasks"].as_array().unwrap().iter().find(|t| t["id"] == id).map(|t| t["status"].as_str().unwrap().to_string()).unwrap_or_default()
}

#[test]
fn orch010_box1_a_task_without_deps_is_ready_one_with_deps_is_pending_and_turns_ready_when_its_dependency_completes() {
    let mut tasks = Vec::new();
    let a = make_task(&mut tasks, "orchestration task-create --spec a", 1).unwrap();
    let a_id = a["id"].as_str().unwrap().to_string();
    assert_eq!(a["status"], "ready", "no dependencies: ready at once");
    let b = make_task(&mut tasks, &format!("orchestration task-create --spec b --deps [\"{a_id}\"]"), 2).unwrap();
    let b_id = b["id"].as_str().unwrap().to_string();
    assert_eq!(b["status"], "pending", "waits on A");
    assert_eq!(b["deps"], json!([a_id]));
    // The same two tasks through the real task-list / task-update commands: A completes, B turns ready.
    let store = store_with("o10b1", &tasks, &[]);
    let before = run_line(&store, "orchestration task-list", None).unwrap();
    assert_eq!((status_of(&before, &a_id), status_of(&before, &b_id)), ("ready".into(), "pending".into()));
    let done = run_line(&store, &format!("orchestration task-update --id {a_id} --status completed"), None).unwrap();
    assert_eq!(done["status"], "completed");
    let after = run_line(&store, "orchestration task-list", None).unwrap();
    assert_eq!((status_of(&after, &a_id), status_of(&after, &b_id)), ("completed".into(), "ready".into()));
}

#[test]
fn orch010_box2_a_dependency_that_names_no_task_is_turned_away_and_no_task_is_made() {
    let mut tasks = Vec::new();
    let e = make_task(&mut tasks, "orchestration task-create --spec x --deps [\"missing\"]", 1).unwrap_err();
    assert_eq!(e.code, "not_found");
    assert!(e.message.contains("missing"), "{}", e.message);
    assert!(tasks.is_empty(), "nothing made");
    // Also with one real task present, and for a badly formed list.
    make_task(&mut tasks, "orchestration task-create --spec real", 2).unwrap();
    assert!(make_task(&mut tasks, "orchestration task-create --spec x --deps [\"task-1\",\"missing\"]", 3).is_err());
    assert!(make_task(&mut tasks, "orchestration task-create --spec x --deps notjson{", 4).is_err());
    assert_eq!(tasks.len(), 1, "still only the real task");
}

#[test]
fn orch011_box1_compact_listing_of_a_2000_character_task_is_one_line_of_about_160_characters() {
    let spec = format!("line one\n\n   {}\n\twith   gaps", "word ".repeat(400));
    assert!(spec.chars().count() > 2000);
    let task = json!({ "id": "task-1", "runId": null, "spec": spec, "status": "ready", "deps": [] });
    let store = store_with("o11b1", &[task], &[]);
    let brief = run_line(&store, "orchestration task-list --brief", None).unwrap();
    let shown = brief["tasks"][0]["spec"].as_str().unwrap();
    assert_eq!(shown.chars().count(), 160, "cut at 160 characters: {shown}");
    assert!(!shown.contains('\n') && !shown.contains('\t') && !shown.contains("  "), "one line, whitespace folded");
    assert!(shown.starts_with("line one word word"));
    let full = run_line(&store, "orchestration task-list", None).unwrap();
    assert!(full["tasks"][0]["spec"].as_str().unwrap().chars().count() > 2000, "without --brief the whole text shows");
}

fn running_worker(runtime: u32, status: &str) -> Value {
    json!({ "id": "dispatch-1", "runtime": runtime, "runId": null, "taskId": "task-1", "status": status, "terminal": 2 })
}

#[test]
fn orch011_box2_a_task_held_by_a_running_worker_names_its_terminal_and_dispatch_until_the_worker_finishes() {
    let task = json!({ "id": "task-1", "runId": null, "spec": "do it", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" });
    let live = |h: &str| h == "term-2";
    let me = std::process::id();
    let list = |d: Value, up: &dyn Fn(&str) -> bool| o::task_list(std::slice::from_ref(&task), &[d], None, &json!({}), up).unwrap();
    let held = list(running_worker(me, "running"), &live);
    assert_eq!(held["tasks"][0]["worker"], json!({ "dispatchId": "dispatch-1", "terminal": "term-2" }));
    // Finished dispatches are not listed against the task, whatever the terminal does.
    for done in ["completed", "failed", "abandoned"] {
        let gone = list(running_worker(me, done), &live);
        assert_eq!(gone["tasks"][0]["worker"], Value::Null, "{done}");
    }
    // A worker whose terminal has closed, or one stamped by an earlier start of the app, holds nothing.
    assert_eq!(list(running_worker(me, "running"), &|_| false)["tasks"][0]["worker"], Value::Null);
    assert_eq!(list(running_worker(me.wrapping_add(1), "running"), &live)["tasks"][0]["worker"], Value::Null);
}

fn dispatched_pair(runtime: u32) -> (Vec<Value>, Vec<Value>) {
    let task = json!({ "id": "task-1", "runId": null, "spec": "do it", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" });
    (vec![task], vec![running_worker(runtime, "running")])
}

#[test]
fn orch012_box1_marking_a_dispatched_task_completed_settles_its_worker() {
    let (tasks, dispatches) = dispatched_pair(std::process::id());
    let store = store_with("o12b1", &tasks, &dispatches);
    let reply = run_line(&store, "orchestration task-update --id task-1 --status completed --result shipped", None).unwrap();
    assert_eq!((&reply["status"], &reply["previous"], &reply["dispatchStatus"]), (&json!("completed"), &json!("dispatched"), &json!("completed")));
    let (t, d) = (&stored(&store, o::TASKS_KEY)[0], &stored(&store, o::DISPATCHES_KEY)[0]);
    assert_eq!((&t["status"], &t["result"]), (&json!("completed"), &json!("shipped")));
    assert_eq!(d["status"], "completed", "the worker shows as settled");
    assert!(d["settledAt"].as_u64().is_some());
    let list = run_line(&store, "orchestration task-list", None).unwrap();
    assert_eq!(list["tasks"][0]["worker"], Value::Null, "the worker slot is free");
}

#[test]
fn orch012_box2_parts_two_updates_at_one_moment_never_leave_a_task_dispatched_without_a_worker() {
    for round in 0..8 {
        let (tasks, dispatches) = dispatched_pair(std::process::id());
        let store = Arc::new(store_with(&format!("o12b2-{round}"), &tasks, &dispatches));
        let go = Arc::new(std::sync::Barrier::new(2));
        let fire = |to: &'static str| {
            let (store, go) = (store.clone(), go.clone());
            std::thread::spawn(move || {
                go.wait();
                run_line(&store, &format!("orchestration task-update --id task-1 --status {to}"), None)
            })
        };
        let (c, f) = (fire("completed"), fire("failed"));
        let (rc, rf) = (c.join().unwrap(), f.join().unwrap());
        let (t, d) = (stored(&store, o::TASKS_KEY).remove(0), stored(&store, o::DISPATCHES_KEY).remove(0));
        let settled_as = d["status"].as_str().unwrap();
        assert!(["completed", "failed"].contains(&settled_as), "round {round}: the worker settled exactly once: {d}");
        assert_ne!(t["status"], "dispatched", "round {round}: never left dispatched with no worker");
        assert!(t["dispatchId"].is_null() || t["dispatchId"] == "dispatch-1", "never two workers");
        assert!(rc.is_ok() || rf.is_ok(), "round {round}: at least one update lands");
        let wins = [&rc, &rf].iter().filter(|r| r.is_ok()).count();
        assert_eq!(wins, 1, "round {round}: exactly one update wins; got completed={rc:?} failed={rf:?}");
        assert_eq!(t["status"], d["status"], "round {round}: the task and its worker agree");
    }
}

#[test]
fn orch013_box3_dispatch_with_dry_run_prints_the_plan_and_the_task_is_still_ready() {
    let task = json!({ "id": "task-1", "runId": null, "spec": "write the parser", "status": "ready", "deps": [] });
    let store = store_with("o13b3", &[task], &[]);
    let plan = run_line(&store, "orchestration dispatch --task task-1 --dry-run", None).unwrap();
    assert_eq!((&plan["dryRun"], &plan["taskId"], &plan["taskStatus"]), (&json!(true), &json!("task-1"), &json!("ready")));
    assert!(plan["preamble"].as_str().unwrap().ends_with("write the parser"), "the plan carries the brief");
    assert!(stored(&store, o::DISPATCHES_KEY).is_empty(), "no dispatch recorded");
    assert_eq!(stored(&store, o::TASKS_KEY)[0]["status"], "ready");
    let list = run_line(&store, "orchestration task-list --ready", None).unwrap();
    assert_eq!(status_of(&list, "task-1"), "ready");
}

fn dispatch_to(to: &str, caller: Option<&str>, own_ok: bool) -> Result<(usize, String), Fail> {
    let task = json!({ "id": "task-1", "runId": null, "spec": "x", "status": "ready", "deps": [] });
    o::dispatch_check(&[task], &[], "task-1", to, caller, None, own_ok, &|_| Some("claude".to_string()))
}

#[test]
fn orch013_box2_parts_dispatch_to_the_coordinators_own_pane_with_inject_or_without_budget_is_turned_away() {
    // cli.rs `orchestration.dispatch` passes own_ok = (no --inject && nesting budget remains).
    let nested = o::nest(Some("term-1"), &[], None, None);
    assert!(nested.is_ok(), "a coordinator with no dispatch of its own has budget at the default cap");
    let inject = dispatch_to("term-1", Some("term-1"), false).unwrap_err();
    assert_eq!(inject.code, "own_pane");
    assert_eq!(inject.message, "a coordinator cannot hand a task to its own pane");
    // Another coordinator's pane is not "own".
    assert!(dispatch_to("term-2", Some("term-1"), false).is_ok());
    // The spec rule allows a context-only dispatch to the caller itself inside the budget.
    assert!(dispatch_to("term-1", Some("term-1"), true).is_ok(), "context-only inside the budget is allowed (the card's own exception)");
}

fn behind_brief(n: Option<(u32, String)>) -> String {
    let task = json!({ "id": "task-3", "runId": null, "spec": "Refactor the cache.\nKeep the API.", "status": "ready", "deps": [] });
    o::brief(&task, &o::Brief { dispatch: "dispatch-9", run: Some("run-1"), coordinator: Some("term-1"), behind: n, levels_left: 0 })
}

#[test]
fn orch014_box1_dispatch_show_preamble_has_the_done_command_for_this_dispatch_and_ends_with_the_task_text() {
    let spec = "Refactor the cache.\nKeep the API.";
    let task = json!({ "id": "task-1", "runId": null, "spec": spec, "status": "ready", "deps": [] });
    let store = store_with("o14b1", &[task], &[]);
    // The brief dispatch builds (shown by its dry run), recorded the way dispatch records it.
    let plan = run_line(&store, "orchestration dispatch --task task-1 --dry-run", None).unwrap();
    let (id, brief) = (plan["dispatchId"].as_str().unwrap().to_string(), plan["preamble"].as_str().unwrap().to_string());
    let row = json!({ "id": id, "runtime": std::process::id(), "runId": null, "taskId": "task-1", "status": "running", "terminal": 2, "brief": brief });
    store.lock().unwrap().set(o::DISPATCHES_KEY, &Value::Array(vec![row]).to_string()).unwrap();
    let shown = run_line(&store, "orchestration dispatch-show --task task-1 --preamble", None).unwrap();
    let p = shown["preamble"].as_str().unwrap();
    let done = "orchestration send --type worker_done --outcome succeeded --subject \"task-1 done\" --body \"what you did\"";
    let done_line = p.lines().find(|l| l.contains(done)).expect("a done-report command");
    assert!(done_line.contains(&format!("--task-id task-1 --dispatch-id {id}")), "{done_line}");
    assert!(p.ends_with(spec), "the task text is the last thing the worker reads");
    assert!(p.find(o::DIVIDER).unwrap() < p.find(spec).unwrap());
    // The other instructions the card names, each one line, ahead of the divider.
    let head = p.split(o::DIVIDER).next().unwrap();
    assert!(head.contains("About every five minutes") && head.contains("--type heartbeat"));
    assert!(head.contains("not your own question tool") && head.contains("--type question") && head.contains("orchestration check --wait"));
    assert!(head.contains("orchestration check\n"));
    assert!(head.lines().filter(|l| l.contains("orchestration send")).all(|l| l.starts_with("  ") && !l.contains('\r')));
    // Without --preamble the brief is not shown.
    let plain = run_line(&store, "orchestration dispatch-show --task task-1", None).unwrap();
    assert!(plain.get("preamble").is_none());
}

fn git_ok(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]).args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn orch014_box2_a_worktree_two_commits_behind_its_base_gets_the_base_drift_section() {
    let root = scratch("o14b2");
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git_ok(&repo, &["init", "-q", "-b", "main"]);
    git_ok(&repo, &["commit", "-q", "--allow-empty", "-m", "c1"]);
    let wt = root.join("wt");
    git_ok(&repo, &["worktree", "add", "-q", "-b", "worker", wt.to_str().unwrap()]);
    git_ok(&repo, &["commit", "-q", "--allow-empty", "-m", "c2"]);
    git_ok(&repo, &["commit", "-q", "--allow-empty", "-m", "c3"]);
    let git = Git::detect().unwrap();
    let n = git.behind(&wt, "main");
    assert_eq!(n, Some(2), "two commits behind main");
    let drifted = behind_brief(n.map(|n| (n, "main".to_string())));
    assert!(drifted.contains("Base drift: this worktree is 2 commits behind main."), "{drifted}");
    assert!(drifted.find("Base drift").unwrap() < drifted.find(o::DIVIDER).unwrap(), "ahead of the task text");
    assert!(drifted.ends_with("Keep the API."));
    // A worktree level with its base gets no such section.
    git_ok(&wt, &["merge", "-q", "main"]);
    assert_eq!(git.behind(&wt, "main"), Some(0));
    assert!(!behind_brief(Some((0, "main".into()))).contains("Base drift"));
    assert!(!behind_brief(None).contains("Base drift"));
}

// ---------------------------------------------------------------- ORCH-015, 016, 018, 022

/// A Run with its coordinator (term-1) and one worker (term-2) holding task-1 as dispatch-1.
fn reporting_world() -> (Mail, String, Vec<Peer>, Vec<Value>, Vec<Value>) {
    let (m, run, peers) = two_panes();
    let tasks = vec![json!({ "id": "task-1", "runId": run, "spec": "do it", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" })];
    let dispatches = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": std::process::id(), "worktree": "C:/work/w1" })];
    (m, run, peers, tasks, dispatches)
}

/// MIRROR cli.rs:2926-2937 (the `orchestration send` arm): mail first, then `report` settles what that report may.
fn send_and_settle(m: &mut Mail, tasks: &mut [Value], dispatches: &mut [Value], from: &str, line: &str, peers: &[Peer], now: u64) -> Result<Value, Fail> {
    let (_, args) = typed(line);
    let mut v = m.post(from, &args, dispatches, peers, now)?;
    let settled = o::report(tasks, dispatches, from, &args, now, &|_| None)?;
    if !settled.is_null() {
        v["settled"] = settled;
    }
    Ok(v)
}

#[test]
fn orch015_box1_a_succeeded_done_report_with_one_changed_file_shows_in_check_and_task_list_says_completed() {
    let (mut m, run, peers, mut tasks, mut dispatches) = reporting_world();
    let line = format!("orchestration send --to run:{run} --subject task-1-done --type worker_done --outcome succeeded --files-modified src/a.rs --report-path reports/task-1.md --task-id task-1 --dispatch-id dispatch-1");
    let sent = send_and_settle(&mut m, &mut tasks, &mut dispatches, "term-2", &line, &peers, 500).unwrap();
    assert_eq!(sent["settled"]["status"], "completed", "{sent}");
    // The coordinator's check shows the report with its outcome, the file and the report path.
    let boxes = m.boxes_of("term-1", &dispatches);
    let got = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    let msg = &got["messages"][0];
    assert_eq!((msg["type"].as_str(), msg["from"].as_str(), msg["outcome"].as_str()), (Some("worker_done"), Some("term-2"), Some("succeeded")), "{got}");
    assert!(msg["filesModified"].to_string().contains("src/a.rs"), "{msg}");
    assert_eq!(msg["reportPath"], "reports/task-1.md");
    // The task list, read from the saved store the way the next command sees it, shows it completed.
    let store = store_with("o15b1", &tasks, &dispatches);
    m.save(&store.lock().unwrap()).unwrap();
    let list = run_line(&store, &format!("orchestration task-list --run {run}"), None).unwrap();
    assert_eq!(status_of(&list, "task-1"), "completed", "{list}");
}

#[test]
fn orch015_box2_a_heartbeat_after_the_worker_was_stopped_changes_nothing() {
    let (mut m, run, peers, mut tasks, mut dispatches) = reporting_world();
    let (receipt, _) = o::stop_with(&mut tasks, &mut dispatches, "dispatch-1", Some(&run), 100, &|_| None).unwrap();
    assert_eq!(receipt["status"], "stopped");
    let before = dispatches.clone();
    let messages_before = m.messages.len();
    let beat = format!("orchestration send --to run:{run} --subject alive --type heartbeat --dispatch-id dispatch-1");
    let err = send_and_settle(&mut m, &mut tasks, &mut dispatches, "term-2", &beat, &peers, 900).unwrap_err();
    assert_eq!(err.code, "dispatch_finished", "{}", err.message);
    assert_eq!(dispatches, before, "the worker's state is exactly what it was: still stopped, no beat stamped");
    assert!(dispatches[0].get("lastBeatAt").is_none());
    assert_eq!(m.messages.len(), messages_before, "nothing was recorded either");
}

#[test]
fn orch015_box3_a_done_report_the_coordinator_writes_for_the_worker_arrives_as_mail_and_the_task_stays_dispatched() {
    let (mut m, run, peers, mut tasks, mut dispatches) = reporting_world();
    let line = format!("orchestration send --to run:{run} --subject task-1-done --type worker_done --outcome succeeded --task-id task-1 --dispatch-id dispatch-1");
    let sent = send_and_settle(&mut m, &mut tasks, &mut dispatches, "term-1", &line, &peers, 500).unwrap();
    assert_eq!(sent["settled"]["settles"], false, "{sent}");
    // It is mail: the Run's mailbox holds it.
    let boxes = m.boxes_of("term-1", &dispatches);
    let got = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
    assert_eq!((got["messages"][0]["type"].as_str(), got["messages"][0]["from"].as_str()), (Some("worker_done"), Some("term-1")), "{got}");
    // And the task is still dispatched, its worker still running.
    assert_eq!((tasks[0]["status"].as_str(), dispatches[0]["status"].as_str()), (Some("dispatched"), Some("running")));
    let store = store_with("o15b3", &tasks, &dispatches);
    m.save(&store.lock().unwrap()).unwrap();
    let list = run_line(&store, &format!("orchestration task-list --run {run}"), None).unwrap();
    assert_eq!(status_of(&list, "task-1"), "dispatched", "{list}");
}

// ---------------------------------------------------------------- ORCH-016 / ORCH-018 option checks

fn refused(line: &str) -> Fail {
    let words: Vec<String> = line.split_whitespace().map(String::from).collect();
    parse(&words).1.expect_err("the command line is turned away")
}

fn accepted(line: &str) -> bool {
    let words: Vec<String> = line.split_whitespace().map(String::from).collect();
    parse(&words).1.unwrap().is_some()
}

#[test]
fn orch016_box2_worker_start_on_the_current_worktree_with_a_base_branch_is_turned_away_before_anything_is_made() {
    // Parsing is the whole of the client side: a refusal here means no request reached the app.
    let e = refused("orchestration worker-start --spec x --agent claude --worktree current --base-branch main");
    assert!(e.message.contains("--base-branch") && e.message.contains("new worktree") && e.message.contains("--worktree current"), "{}", e.message);
    // The literal command of the box (no task given) is also turned away.
    refused("orchestration worker-start --worktree current --base-branch main");
    // The same holds for every option that only shapes a new worktree, and for an existing worktree.
    for flag in ["--name n", "--repo r", "--display-name d", "--comment c"] {
        assert!(refused(&format!("orchestration worker-start --spec x --agent claude --worktree current {flag}")).message.contains("shapes a new worktree"), "{flag}");
    }
    assert!(refused("orchestration worker-start --spec x --agent claude --worktree name:feature --base-branch main").message.contains("--base-branch"));
    // A new worktree takes them.
    assert!(accepted("orchestration worker-start --spec x --agent claude --worktree new-child --base-branch main"));
}

#[test]
fn orch018_box2_a_tier_mixed_with_a_model_effort_or_reused_terminal_is_turned_away() {
    let mixed = refused("orchestration worker-start --spec x --tier deep --model opus");
    assert!(mixed.message.contains("a tier picks the model and effort; drop --model and --effort, or drop the tier"), "{}", mixed.message);
    // The box's own wording, with no task text: turned away as well.
    refused("orchestration worker-start --tier deep --model opus");
    assert!(refused("orchestration worker-start --spec x --tier deep --model opus --effort high").message.contains("a tier picks the model and effort"));
    assert!(refused("orchestration worker-start --spec x --tier build --terminal term-3 --worktree current").message.contains("a reused terminal keeps its own model"));
    assert!(refused("orchestration worker-start --spec x --tier huge").message.contains("--tier takes major, deep, build or light"));
    // A tier alone is accepted.
    for t in ["major", "deep", "build", "light"] {
        assert!(accepted(&format!("orchestration worker-start --spec x --tier {t}")), "{t}");
    }
}

#[test]
fn orch018_box1_a_claude_light_tier_worker_starts_on_haiku_with_no_effort_setting() {
    let root = scratch("o18b1");
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git_ok(&repo, &["init", "-q", "-b", "main"]);
    git_ok(&repo, &["commit", "-q", "--allow-empty", "-m", "one"]);
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&root.join("data")).unwrap());
    kolux_lib::projects::add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    {
        // Routing left as shipped: no modelRouting key is saved.
        let s = store.lock().unwrap();
        let mut settings = s.settings();
        settings["workspacesDir"] = json!(root.join("ws").display().to_string());
        settings["branchPrefix"] = json!("none");
        assert!(settings.get("modelRouting").is_none(), "the user never changed a tier");
        s.save_settings(&settings).unwrap();
    }
    // The stand-in window: it records every notice and answers the setup request; it starts nothing.
    let events = Mutex::new(Vec::<Value>::new());
    let notify = |v: Value| {
        if let Some(r) = v["setupRequest"].as_str() {
            kolux_lib::orchestration::setup_gate::settle(r, json!({ "result": "none" }));
        }
        events.lock().unwrap().push(v)
    };
    let terminals = Terminals::default();
    let ctx = Ctx { claude_config: root.join(".claude.json"), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    let claude_installed = kolux_lib::agents::agent_list().iter().any(|a| a.id == "claude" && a.installed);
    if !claude_installed {
        eprintln!("Claude Code is not installed here, so box 1 cannot be shown");
        return;
    }
    let (command, mut args) = typed("orchestration worker-start --spec x --tier light");
    args["timeoutMs"] = json!("1");
    let req = Request { id: "r".into(), token: String::new(), command, cwd: repo.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
    let out = dispatch(&ctx, &req).unwrap_err();
    // No window opens a terminal, so the start times out; the receipt still says what it launched.
    assert_eq!(out.code, "timeout", "{}", out.message);
    assert_eq!((out.data["agent"].as_str(), out.data["tier"].as_str(), out.data["model"].as_str()), (Some("claude"), Some("light"), Some("haiku")), "{}", out.data);
    assert!(out.data["effort"].is_null(), "haiku takes no effort setting: {}", out.data);
    let ev = events.lock().unwrap();
    let start = ev.iter().find(|e| e["kind"] == "start").expect("the window is told to start the agent");
    assert_eq!(start["agent"], "claude");
    assert_eq!(start["extra"], json!(["--model", "haiku"]), "the launch line carries the model and no --effort");
    // A Claude coordinator's own pane picks the same agent for a tier (the pane itself needs a live terminal).
    assert_eq!(o::tier_agent(None, Some("claude"), "codex").unwrap(), "claude");
    assert!(o::tier_agent(Some("codex"), Some("claude"), "claude").is_err(), "naming another agent next to a tier is turned away");
    drop(ev);
    let _ = std::fs::remove_dir_all(&root);
}

// ---------------------------------------------------------------- ORCH-022

#[test]
fn orch022_box2_a_stop_when_kolux_holds_no_live_terminal_for_the_worker_says_unverifiable_and_keeps_the_worktree() {
    let root = scratch("o22b2");
    let worktree = root.join("worktree");
    std::fs::create_dir_all(&worktree).unwrap();
    std::fs::write(worktree.join("work.txt"), "unsaved work").unwrap();
    let wt = worktree.display().to_string();
    // Kolux has lost touch: dispatch-1's terminal (term-7) is not one this process holds.
    let task = json!({ "id": "task-1", "runId": null, "spec": "do it", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" });
    let row = json!({ "id": "dispatch-1", "runtime": std::process::id(), "runId": null, "taskId": "task-1", "status": "running", "terminal": 7, "worktree": wt });
    let store = store_with("o22b2-store", &[task], &[row]);
    let r = run_line(&store, "orchestration worker-stop --dispatch dispatch-1", None).unwrap();
    assert_eq!(r["process"], "unverifiable", "not reported as ended: {r}");
    assert_eq!((r["status"].as_str(), r["worktreeKept"].as_bool()), (Some("stopped"), Some(true)), "{r}");
    let d = &stored(&store, o::DISPATCHES_KEY)[0];
    assert_eq!((d["status"].as_str(), d["process"].as_str()), (Some("stopped"), Some("unverifiable")));
    assert!(worktree.join("work.txt").exists(), "the worktree folder and its files are still on disk");
    assert_eq!(stored(&store, o::TASKS_KEY)[0]["status"], "ready", "the task can be handed on again");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn orch022_box1_stopping_a_running_worker_ends_its_agent_terminal_and_the_worktree_folder_stays_on_disk() {
    let root = std::env::temp_dir().join(format!("kolux-cards08-o22b1-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let worktree = root.join("worktree");
    std::fs::create_dir_all(&worktree).unwrap();
    std::fs::write(worktree.join("work.txt"), "unsaved work").unwrap();
    let wd = worktree.display().to_string();
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&root.join("data")).unwrap());
    let notify = |_v: Value| {};
    let terminals = Terminals::default();
    // 7: the worker (a custom-command agent, marked npx, as the fake session records it); 8: the setup terminal; 9: a tab the user configured.
    for (id, program) in [(7, Some("npx")), (8, None), (9, None)] {
        terminals.fake_session(id, &wd, program);
    }
    let ctx = Ctx { claude_config: root.join(".claude.json"), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    let task = json!({ "id": "task-1", "runId": null, "spec": "do it", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" });
    let row = json!({ "id": "dispatch-1", "runtime": std::process::id(), "runId": null, "taskId": "task-1", "status": "running", "agent": "claude", "terminalProgram": "npx", "terminal": 7, "worktree": wd, "created": 1 });
    store.lock().unwrap().set("orchestration.tasks", &Value::Array(vec![task]).to_string()).unwrap();
    store.lock().unwrap().set("orchestration.dispatches", &Value::Array(vec![row]).to_string()).unwrap();
    let words: Vec<String> = "orchestration worker-stop --dispatch dispatch-1".split_whitespace().map(String::from).collect();
    let p = parse(&words).1.unwrap().unwrap();
    let req = Request { id: "r".into(), token: String::new(), command: p.command, cwd: wd.clone(), args: Value::Object(p.args), pane: None, cli: String::new(), arrived: None };
    assert!(terminals.live("term-7"));
    let r = dispatch(&ctx, &req).unwrap();
    assert_eq!((r["process"].as_str(), r["status"].as_str(), r["worktreeKept"].as_bool()), (Some("ended"), Some("stopped"), Some(true)), "{r}");
    assert!(!terminals.live("term-7"), "the agent terminal ended");
    assert!(terminals.live("term-8") && terminals.live("term-9"), "the setup terminal and the user's tab remain");
    assert!(worktree.join("work.txt").exists(), "the worktree folder is still on disk");
    for t in [8, 9] {
        let _ = terminals.kill(t);
    }
    let _ = std::fs::remove_dir_all(&root);
}
