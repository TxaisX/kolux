//! spec/20 P0 boxes (the command line): CLI-012, CLI-011, CLI-030, CLI-031, CLI-032, CLI-033, CLI-034, CLI-035, CLI-036,
//! plus CLI-018 box 3 (DT-CLI-018).
//! Safety: every child is `kolux-dev` with every inherited KOLUX_* variable removed and KOLUX_APP_DIR set to a folder under the
//! scratch root, so it can only reach the stand-in app a test starts there on an ephemeral 127.0.0.1 port. Nothing connects to a
//! real Kolux; the stand-in answers newline-delimited JSON the way `call_within` expects (cli.rs:926-945).

mod scratch_root;

use kolux_lib::cli::{dispatch, envelope, parse, Ctx, Fail, Request};
use kolux_lib::git::Git;
use kolux_lib::orchestration::{self as o, Mail, Mode, Peer};
use kolux_lib::state::Store;
use kolux_lib::terminal::Terminals;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A fresh folder under the scratch root (refuses to run when the agent homes are not redirected there).
fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("cli20").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-scratch"), "").unwrap();
    d
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn words(line: &str) -> Vec<String> {
    line.split_whitespace().map(String::from).collect()
}

/// The `--flag value` words of a typed command line as the arguments the app receives.
fn typed(line: &str) -> (String, Value) {
    let p = parse(&words(line)).1.unwrap().unwrap();
    (p.command, Value::Object(p.args))
}

/// One command line sent through the real `dispatch` (no calling pane), against a store in `dir`.
fn run_line(dir: &Path, store: &Mutex<Store>, line: &str) -> Result<Value, Fail> {
    let (command, args) = typed(line);
    let git = Git::detect().unwrap();
    let terminals = Terminals::default();
    let notify = |_v: Value| {};
    let ctx = Ctx { claude_config: dir.join("claude.json"), git: &git, store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    let req = Request { id: "r".into(), token: String::new(), command, cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
    dispatch(&ctx, &req)
}

fn store_with(dir: &Path, tasks: &[Value], dispatches: &[Value]) -> Mutex<Store> {
    let store = Store::open(dir).unwrap();
    store.set(o::TASKS_KEY, &Value::Array(tasks.to_vec()).to_string()).unwrap();
    store.set(o::DISPATCHES_KEY, &Value::Array(dispatches.to_vec()).to_string()).unwrap();
    Mutex::new(store)
}

fn stored(store: &Mutex<Store>, key: &str) -> String {
    store.lock().unwrap().get(key).unwrap().unwrap_or_default()
}

// ---------------------------------------------------------------- the stand-in app and the command-line child

/// Answers one request line with an envelope, the way the app's listener does; counts connections.
fn serve(listener: TcpListener, handler: impl Fn(&Value) -> Result<Value, Fail> + Send + 'static) -> Arc<AtomicUsize> {
    let hits = Arc::new(AtomicUsize::new(0));
    let seen = hits.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            seen.fetch_add(1, Ordering::SeqCst);
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).ok();
            let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
            let id = req["id"].as_str().unwrap_or_default().to_string();
            let out = if req["token"] != "tok" { Err(Fail::new("unauthorized", "that token is from another run of the app")) } else { handler(&req) };
            let mut w = &stream;
            let _ = w.write_all(format!("{}\n", envelope(&id, "cards", out)).as_bytes());
        }
    });
    hits
}

fn endpoint(dir: &Path, port: u16, token: &str) {
    std::fs::write(dir.join("cli.json"), json!({ "port": port, "token": token, "pid": std::process::id() }).to_string()).unwrap();
}

/// A stand-in app in a fresh folder: its startup file names the listener.
fn app(tag: &str, handler: impl Fn(&Value) -> Result<Value, Fail> + Send + 'static) -> (PathBuf, Arc<AtomicUsize>) {
    let dir = scratch(tag);
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    endpoint(&dir, listener.local_addr().unwrap().port(), "tok");
    (dir.clone(), serve(listener, handler))
}

/// The development command line, run from `pane` (handle, key) when given, against the app folder `dir`.
fn kolux(dir: &Path, pane: Option<(&str, &str)>, line: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_kolux-dev"));
    for (k, _) in std::env::vars() {
        if k.starts_with("KOLUX_") {
            cmd.env_remove(k);
        }
    }
    cmd.args(line).env("KOLUX_APP_DIR", dir);
    if let Some((h, k)) = pane {
        cmd.env("KOLUX_TERMINAL_HANDLE", h).env("KOLUX_PANE_KEY", k);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

fn go(dir: &Path, pane: Option<(&str, &str)>, line: &[&str]) -> Output {
    kolux(dir, pane, line).output().expect("the development command line starts")
}

fn said(out: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))
}

fn json_of(out: &Output) -> Value {
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("stdout is JSON ({e}): {}", said(out)))
}

fn keepalives(stderr: &str) -> Vec<Value> {
    stderr.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(|v| v["_keepalive"] == true).collect()
}

// ---------------------------------------------------------------- CLI-012

#[test]
fn cli012_box1_app_closed_reports_not_running() {
    let dir = scratch("s1");
    let out = go(&dir, None, &["status", "--json"]);
    let env = json_of(&out);
    assert_eq!(env["result"]["state"], "not-running", "{env}");
    assert_eq!(out.status.code(), Some(1), "only a running app exits 0");
    let text = go(&dir, None, &["status"]);
    assert!(said(&text).contains("not-running: Kolux is not running"), "{}", said(&text));
    assert_eq!(text.status.code(), Some(1));
}

#[test]
fn cli012_box2_startup_files_left_behind_report_stale() {
    // The app was killed hard: its startup file names a port nothing listens on any more.
    let dir = scratch("s2");
    let gone = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    endpoint(&dir, gone, "tok");
    let out = go(&dir, None, &["status", "--json"]);
    assert_eq!(json_of(&out)["result"]["state"], "stale", "{}", said(&out));
    assert_eq!(out.status.code(), Some(1));
    let text = said(&go(&dir, None, &["status"]));
    assert!(text.contains("stale: Kolux left its startup file behind but nothing answers") && text.contains("open to start it again"), "{text}");
    // The same file outliving the run it came from: something else now answers on the port and does not know the token.
    let other = scratch("s2b");
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    endpoint(&other, listener.local_addr().unwrap().port(), "an-old-token");
    serve(listener, |_| Ok(json!({})));
    let out = go(&other, None, &["status", "--json"]);
    assert_eq!(json_of(&out)["result"]["state"], "stale", "{}", said(&out));
}

#[test]
fn cli012_box3_app_up_reports_running_and_exits_zero() {
    // MIRROR cli.rs:1043-1045 (status_answer): the shape the app answers a status question with.
    let (dir, hits) = app("s3", |req| {
        assert_eq!(req["command"], "app.status");
        Ok(json!({ "pid": std::process::id(), "version": "9.9.9", "graphReady": true }))
    });
    let out = go(&dir, None, &["status", "--json"]);
    let env = json_of(&out);
    assert_eq!((env["result"]["state"].as_str(), env["result"]["graphReady"].as_bool()), (Some("running"), Some(true)), "{env}");
    assert_eq!(env["result"]["pid"], std::process::id());
    assert_eq!(out.status.code(), Some(0));
    let text = said(&go(&dir, None, &["status"]));
    assert!(text.contains("running: Kolux is up and ready"), "{text}");
    assert_eq!(hits.load(Ordering::SeqCst), 2, "each question reached the stand-in");
    // An app that answers but is still loading its workspaces is not "running".
    let (loading, _) = app("s3b", |_| Ok(json!({ "pid": 1, "version": "9.9.9", "graphReady": false })));
    let out = go(&loading, None, &["status", "--json"]);
    assert_eq!(json_of(&out)["result"]["state"], "graph-not-ready");
    assert_eq!(out.status.code(), Some(1));
}

// ---------------------------------------------------------------- CLI-011

/// A program that only writes `marker`, standing in for the app executable.
#[cfg(windows)]
fn launcher_writing(dir: &Path, marker: &Path) -> PathBuf {
    let p = dir.join("launch.cmd");
    std::fs::write(&p, format!("@echo off\r\necho started> \"{}\"\r\n", marker.display())).unwrap();
    p
}

#[cfg(not(windows))]
fn launcher_writing(dir: &Path, marker: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let p = dir.join("launch.sh");
    std::fs::write(&p, format!("#!/bin/sh\necho started > '{}'\n", marker.display())).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}

#[test]
fn cli011_box1_app_closed_open_launches_it_and_exits_zero_once_ready() {
    let dir = scratch("o1");
    let marker = dir.join("launched.txt");
    let launcher = launcher_writing(&dir, &marker);
    // No startup file exists: the app is closed until the launcher has run.
    assert!(!dir.join("cli.json").exists());
    let child = kolux(&dir, None, &["open"]).env("KOLUX_APP_EXECUTABLE", &launcher).spawn().expect("the development command line starts");
    let until = Instant::now() + Duration::from_secs(30);
    while !marker.exists() {
        assert!(Instant::now() < until, "the command line never started the launcher");
        std::thread::sleep(Duration::from_millis(100));
    }
    // The "app" comes up a moment after it was started.
    std::thread::sleep(Duration::from_millis(800));
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    endpoint(&dir, listener.local_addr().unwrap().port(), "tok");
    serve(listener, |req| {
        assert_eq!(req["command"], "app.open");
        Ok(json!({ "ready": true, "started": false, "pid": std::process::id() }))
    });
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", said(&out));
    assert!(said(&out).contains("Kolux started and is ready"), "{}", said(&out));
}

// ---------------------------------------------------------------- CLI-018 box 3 (DT-CLI-018: the prompt falls back to the default agent)

/// Quiet git in a scratch repo: no global or system config, an identity passed on the command line.
fn quiet_git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" })
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args(["-c", "user.name=cards", "-c", "user.email=cards@example.invalid", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn cli018_box3_a_prompt_without_an_agent_goes_to_the_default_agent() {
    use kolux_lib::{agents::agent_list, projects};
    let dir = scratch("cli018-b3");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    quiet_git(&repo, &["init", "-q", "-b", "main"]);
    quiet_git(&repo, &["commit", "-q", "--allow-empty", "-m", "one"]);
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
    projects::add_project(&git, &store.lock().unwrap(), &repo).unwrap();

    // The default agent is the last installed one in menu order, so the pick cannot be the first-installed fallback by luck.
    let installed: Vec<String> = agent_list().into_iter().filter(|a| a.installed).map(|a| a.id).collect();
    let default = installed.last().cloned();
    {
        let s = store.lock().unwrap();
        let mut settings = s.settings();
        settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
        settings["branchPrefix"] = json!("none");
        settings["defaultAgent"] = json!(default.clone().unwrap_or_else(|| "claude".into()));
        s.save_settings(&settings).unwrap();
    }

    let events = Mutex::new(Vec::<Value>::new());
    let notify = |v: Value| events.lock().unwrap().push(v);
    let terminals = Terminals::default();
    let ctx = Ctx { claude_config: dir.join("claude.json"), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    let (command, args) = typed("worktree create --name b --prompt hi");
    assert!(args.get("agent").is_none(), "the line names no agent");
    let req = Request { id: "r".into(), token: String::new(), command, cwd: repo.display().to_string(), args, pane: None, cli: String::new(), arrived: None };

    // Branches on the machine: with no agent installed the same line is refused before any checkout is made.
    let Some(default) = default else {
        let f = dispatch(&ctx, &req).expect_err("no agent is installed, so the prompt has nowhere to go");
        assert!(f.message.contains("no agent is installed to take the prompt"), "{} {}", f.code, f.message);
        assert!(!dir.join("ws").join("b").exists() && std::fs::read_dir(dir.join("ws")).map_or(true, |mut d| d.next().is_none()), "no checkout was made");
        let branches = Command::new("git").current_dir(&repo).args(["branch", "--list", "b"]).output().unwrap();
        assert!(String::from_utf8_lossy(&branches.stdout).trim().is_empty(), "no branch b was made");
        assert!(events.lock().unwrap().is_empty(), "no created event was sent");
        let _ = std::fs::remove_dir_all(&dir);
        return;
    };
    let made = dispatch(&ctx, &req).unwrap_or_else(|f| panic!("refused: {} {}", f.code, f.message));
    let path = PathBuf::from(made["path"].as_str().unwrap());
    assert!(path.join(".git").exists(), "worktree b exists on disk: {}", path.display());
    assert_eq!(made["branch"], "b");
    assert_eq!(made["agent"], json!(default), "the answer names the default agent");

    let events = events.lock().unwrap();
    let created: Vec<&Value> = events.iter().filter(|e| e["kind"] == "created").collect();
    assert_eq!(created.len(), 1, "{events:?}");
    assert_eq!(created[0]["agent"], json!(default), "the window is told to start the default agent");
    assert_eq!(created[0]["prompt"], "hi");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------- the mail stand-in (run-create, send, check, ask)

fn peer(handle: &str) -> Peer {
    Peer { handle: handle.into(), agent: Some("claude".into()), idle: true, dir: "C:/work".into() }
}

/// MIRROR cli.rs:2915-3005 (the `mail()` arms): the pane is vouched for by its key, then the real `Mail` decides.
fn mail_app(mail: Arc<Mutex<Mail>>, dispatches: Vec<Value>) -> impl Fn(&Value) -> Result<Value, Fail> + Send + 'static {
    move |req: &Value| {
        let by_key = |k: &str| match k {
            "secret-1" => Some("term-1".to_string()),
            "secret-2" => Some("term-2".to_string()),
            _ => None,
        };
        let pane = req["pane"]["handle"].as_str().zip(req["pane"]["key"].as_str());
        let p = o::caller_of(None, pane, &by_key)?.ok_or_else(|| Fail::new("unbound_caller", "who is calling cannot be told"))?;
        let a = &req["args"];
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let peers = [peer("term-1"), peer("term-2")];
        let mut m = mail.lock().unwrap();
        match req["command"].as_str().unwrap_or_default() {
            "orchestration.run-create" => Ok(m.run_create(&p, &text("objective").ok_or_else(|| Fail::new("invalid_arguments", "--objective is required"))?, now_ms())),
            "orchestration.run-current" => Ok(m.run_current(&p)),
            "orchestration.send" => m.post(&p, a, &dispatches, &peers, now_ms()),
            "orchestration.check" => {
                let boxes = m.boxes_of(&p, &dispatches);
                let mode = if a["peek"] == true { Mode::Peek } else if a["unread"] == true { Mode::Unread } else if a["all"] == true { Mode::All } else { Mode::Next };
                m.check(&p, &p, &boxes, mode, None, text("ack").as_deref(), a["fence"].as_u64())
            }
            "orchestration.ask" => m.ask(&p, a, &dispatches, &peers, now_ms()),
            other => Err(Fail::new("invalid_arguments", format!("unknown command {other}"))),
        }
    }
}

const ONE: Option<(&str, &str)> = Some(("term-1", "secret-1"));
const TWO: Option<(&str, &str)> = Some(("term-2", "secret-2"));

// ---------------------------------------------------------------- CLI-030

#[test]
fn cli030_box1_run_create_then_run_current_in_the_same_terminal_shows_that_run() {
    let mail = Arc::new(Mutex::new(Mail::default()));
    let (dir, _) = app("r1", mail_app(mail.clone(), vec![]));
    let made = json_of(&go(&dir, ONE, &["orchestration", "run-create", "--objective", "x", "--json"]));
    let id = made["result"]["run"]["id"].as_str().unwrap_or_else(|| panic!("{made}")).to_string();
    assert_eq!(made["result"]["run"]["objective"], "x");
    let current = json_of(&go(&dir, ONE, &["orchestration", "run-current", "--json"]));
    assert_eq!(current["result"]["runId"], json!(id), "{current}");
    let text = said(&go(&dir, ONE, &["orchestration", "run-current"]));
    assert!(text.contains(&id), "the printed line names the run: {text}");
    // A shell the runtime does not know has no current run to show.
    let other = said(&go(&dir, Some(("term-1", "wrong-key")), &["orchestration", "run-current", "--json"]));
    assert!(other.contains("unbound_caller") || other.contains("who is calling"), "{other}");
}

#[test]
fn cli030_box2_run_list_limit_one_gives_one_row_and_a_cursor_for_the_next_page() {
    let dir = scratch("r2");
    let store = Mutex::new(Store::open(&dir).unwrap());
    let mut m = Mail::default();
    let first = m.run_create("term-1", "first", 1)["run"]["id"].as_str().unwrap().to_string();
    let second = m.run_create("term-2", "second", 2)["run"]["id"].as_str().unwrap().to_string();
    m.save(&store.lock().unwrap()).unwrap();
    let page = run_line(&dir, &store, "orchestration run-list --limit 1").unwrap();
    let rows = page["runs"].as_array().unwrap();
    assert_eq!((rows.len(), &rows[0]["id"]), (1, &json!(second)), "{page}");
    let cursor = page["nextCursor"].as_str().expect("and a cursor for the next page").to_string();
    let next = run_line(&dir, &store, &format!("orchestration run-list --limit 1 --cursor {cursor}")).unwrap();
    assert_eq!(next["runs"][0]["id"], json!(first), "{next}");
    assert!(next["nextCursor"].is_null());
}

// ---------------------------------------------------------------- CLI-031

fn run_with_worker() -> (Arc<Mutex<Mail>>, String, Vec<Value>) {
    let mut m = Mail::default();
    let run = m.run_create("term-1", "ship", 1)["run"]["id"].as_str().unwrap().to_string();
    let dispatches = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": std::process::id(), "worktree": "C:/work/w1" })];
    (Arc::new(Mutex::new(m)), run, dispatches)
}

#[test]
fn cli031_box1_a_worker_done_message_with_no_to_lands_in_the_coordinators_run_mailbox() {
    let (mail, run, dispatches) = run_with_worker();
    let (dir, _) = app("m1", mail_app(mail.clone(), dispatches));
    // The very line a dispatched worker is told to use: a done report, no --to.
    let sent = json_of(&go(
        &dir,
        TWO,
        &["orchestration", "send", "--type", "worker_done", "--outcome", "succeeded", "--subject", "task-1 done", "--body", "what you did", "--task-id", "task-1", "--dispatch-id", "dispatch-1", "--json"],
    ));
    assert_eq!(sent["success"], true, "{sent}");
    assert_eq!((sent["result"]["to"].as_str(), sent["result"]["runId"].as_str()), (Some(format!("run:{run}").as_str()), Some(run.as_str())), "{sent}");
    // The coordinator's check (its own pane, over the wire) holds it.
    let got = json_of(&go(&dir, ONE, &["orchestration", "check", "--json"]));
    let msg = &got["result"]["messages"][0];
    assert_eq!((msg["type"].as_str(), msg["from"].as_str(), msg["outcome"].as_str(), msg["subject"].as_str()), (Some("worker_done"), Some("term-2"), Some("succeeded"), Some("task-1 done")), "{got}");
}

#[test]
fn cli031_box2_a_heartbeat_to_all_is_refused_before_the_sender_is_worked_out() {
    let words = ["orchestration", "send", "--type", "heartbeat", "--to", "@all", "--subject", "alive"];
    // In process: the parser itself turns it away.
    let owned: Vec<String> = words.iter().map(|w| w.to_string()).collect();
    let refused = parse(&owned).1.expect_err("a group heartbeat is refused");
    assert_eq!(refused.code, "invalid_arguments");
    assert!(refused.message.contains("never to a group"), "{}", refused.message);
    // The real command line, from a shell Kolux did not start (no terminal handle, no key) and with a
    // stand-in app listening: refused with the heartbeat wording, and the app is never contacted.
    let (dir, hits) = app("m2", |_| Err(Fail::new("failed", "the stand-in must not be asked")));
    let out = go(&dir, None, &words);
    assert_ne!(out.status.code(), Some(0));
    let text = said(&out);
    assert!(text.contains("never to a group"), "{text}");
    assert!(!text.contains("unbound_caller") && !text.contains("who is calling"), "the sender was never looked at: {text}");
    assert_eq!(hits.load(Ordering::SeqCst), 0, "no connection reached the app");
}

// ---------------------------------------------------------------- CLI-032

fn run_with_two_messages() -> (Arc<Mutex<Mail>>, String) {
    let (mail, run, _) = run_with_worker();
    let peers = [peer("term-1"), peer("term-2")];
    for subject in ["first", "second"] {
        let (_, args) = typed(&format!("orchestration send --to run:{run} --subject {subject}"));
        mail.lock().unwrap().post("term-2", &args, &[], &peers, now_ms()).unwrap();
    }
    (mail, run)
}

fn subjects(check: &Value) -> Vec<String> {
    check["result"]["messages"].as_array().unwrap().iter().map(|m| m["subject"].as_str().unwrap().to_string()).collect()
}

#[test]
fn cli032_box1_two_messages_check_returns_both_then_check_with_ack_returns_nothing_new() {
    let (mail, _run) = run_with_two_messages();
    let (dir, _) = app("c1", mail_app(mail, vec![]));
    let one = json_of(&go(&dir, ONE, &["orchestration", "check", "--json"]));
    assert_eq!(subjects(&one), ["first", "second"], "both, in order: {one}");
    let delivery = one["result"]["deliveryId"].as_str().expect("under one delivery id").to_string();
    let acked = json_of(&go(&dir, ONE, &["orchestration", "check", "--ack", &delivery, "--json"]));
    assert!(acked["result"]["messages"].as_array().unwrap().is_empty(), "nothing new after the acknowledgement: {acked}");
    let after = json_of(&go(&dir, ONE, &["orchestration", "check", "--json"]));
    assert!(after["result"]["messages"].as_array().unwrap().is_empty(), "{after}");
}

#[test]
fn cli032_box2_check_wait_prints_keepalives_on_stderr_and_returns_as_soon_as_a_message_arrives() {
    let (mail, run, _) = run_with_worker();
    let (dir, _) = app("c2", mail_app(mail.clone(), vec![]));
    let child = kolux(&dir, ONE, &["orchestration", "check", "--wait", "--timeout-ms", "30000", "--json"]).spawn().unwrap();
    let begun = Instant::now();
    // Past the first fifteen-second keepalive, well inside the 30-second limit.
    std::thread::sleep(Duration::from_millis(16_500));
    let (_, mut args) = typed(&format!("orchestration send --to run:{run} --subject arrived"));
    args["body"] = json!("while you waited");
    let sent = Instant::now();
    mail.lock().unwrap().post("term-2", &args, &[], &[peer("term-1"), peer("term-2")], now_ms()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(sent.elapsed() < Duration::from_secs(5), "returned promptly after the send: {:?}", sent.elapsed());
    assert!(begun.elapsed() < Duration::from_secs(25), "well before the 30 s limit: {:?}", begun.elapsed());
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let beats = keepalives(&stderr);
    assert_eq!(beats.len(), 1, "one keepalive line on standard error before the message: {stderr}");
    let elapsed = beats[0]["elapsedMs"].as_u64().unwrap();
    assert!((14_000..17_000).contains(&elapsed), "about 15 s in: {:?}", beats[0]);
    assert_eq!(beats[0]["deadlineMs"], 30_000);
    let env = json_of(&out);
    assert_eq!(env["success"], true);
    assert!(env["result"]["timedOut"].is_null(), "{env}");
    assert_eq!(env["result"]["messages"][0]["subject"], "arrived");
}

// ---------------------------------------------------------------- CLI-033

#[test]
fn cli033_box1_ask_with_a_short_timeout_prints_a_resume_command_and_running_it_later_returns_the_answer() {
    let mail = Arc::new(Mutex::new(Mail::default()));
    mail.lock().unwrap().run_create("term-1", "ship", 1);
    let (dir, _) = app("a1", mail_app(mail.clone(), vec![]));
    let asked = go(&dir, ONE, &["orchestration", "ask", "--question", "ship it?", "--to", "term-2", "--timeout-ms", "1200"]);
    assert_eq!(asked.status.code(), Some(0), "{}", said(&asked));
    let text = said(&asked);
    let resume = text.split("orchestration ask --resume ").nth(1).unwrap_or_else(|| panic!("no resume command in: {text}"));
    let id = resume.split_whitespace().next().unwrap().to_string();
    assert!(text.contains(&format!("question {id} is still open")), "{text}");
    // Later: the other terminal answers, and the printed command returns the answer.
    {
        let mut m = mail.lock().unwrap();
        let boxes = m.boxes_of("term-2", &[]);
        m.reply("term-2", &id, "yes, ship it", None, &boxes, None, now_ms()).unwrap();
    }
    let later = json_of(&go(&dir, ONE, &["orchestration", "ask", "--resume", &id, "--timeout-ms", "5000", "--json"]));
    assert_eq!((later["result"]["status"].as_str(), later["result"]["answer"].as_str(), later["result"]["messageId"].as_str()), (Some("answered"), Some("yes, ship it"), Some(id.as_str())), "{later}");
}

#[test]
fn cli033_box2_ask_with_an_invalid_timeout_is_refused_before_the_app_is_contacted() {
    let (dir, hits) = app("a2", |_| Err(Fail::new("failed", "the stand-in must not be asked")));
    for bad in ["abc", "0"] {
        let line = ["orchestration", "ask", "--question", "ship it?", "--to", "term-2", "--timeout-ms", bad];
        let owned: Vec<String> = line.iter().map(|w| w.to_string()).collect();
        let refused = parse(&owned).1.expect_err("refused by the parser");
        assert!(refused.message.contains("--timeout-ms takes a number above zero"), "{}", refused.message);
        let out = go(&dir, ONE, &line);
        assert_ne!(out.status.code(), Some(0));
        assert!(said(&out).contains("--timeout-ms takes a number above zero"), "{}", said(&out));
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0, "the app never saw a connection");
}

// ---------------------------------------------------------------- CLI-034

fn task_ids(list: &Value) -> Vec<String> {
    list["tasks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_string()).collect()
}

#[test]
fn cli034_box1_task_list_ready_leaves_b_out_until_a_is_done() {
    let dir = scratch("t1");
    // task-create needs a calling terminal, which only a spawned one has: the tasks come from the real `task_create` (cards_08 does the same).
    let mut tasks = Vec::new();
    let a = o::task_create(&mut tasks, &typed("orchestration task-create --spec a").1, None, 1).unwrap()["id"].as_str().unwrap().to_string();
    let b = o::task_create(&mut tasks, &typed(&format!("orchestration task-create --spec b --deps [\"{a}\"]")).1, None, 2).unwrap()["id"].as_str().unwrap().to_string();
    let store = store_with(&dir, &tasks, &[]);
    let before = run_line(&dir, &store, "orchestration task-list --ready").unwrap();
    assert_eq!(task_ids(&before), vec![a.clone()], "B depends on A and is left out: {before}");
    let all = run_line(&dir, &store, "orchestration task-list").unwrap();
    assert!(task_ids(&all).contains(&b), "B exists, it is only not ready: {all}");
    run_line(&dir, &store, &format!("orchestration task-update --id {a} --status completed")).unwrap();
    let after = run_line(&dir, &store, "orchestration task-list --ready").unwrap();
    assert_eq!(task_ids(&after), vec![b.clone()], "A is done, so B is ready and A is not listed: {after}");
}

#[test]
fn cli034_box2_dispatch_dry_run_prints_the_opening_text_and_changes_nothing() {
    let dir = scratch("t2");
    let task = json!({ "id": "task-1", "runId": null, "spec": "write the parser", "status": "ready", "deps": [] });
    let store = store_with(&dir, &[task], &[]);
    let (tasks_before, dispatches_before) = (stored(&store, o::TASKS_KEY), stored(&store, o::DISPATCHES_KEY));
    let plan = run_line(&dir, &store, "orchestration dispatch --task task-1 --dry-run").unwrap();
    assert_eq!((&plan["dryRun"], &plan["taskId"], &plan["taskStatus"]), (&json!(true), &json!("task-1"), &json!("ready")), "{plan}");
    assert!(plan["preamble"].as_str().unwrap().ends_with("write the parser"), "the opening text carries the task: {plan}");
    assert_eq!((stored(&store, o::TASKS_KEY), stored(&store, o::DISPATCHES_KEY)), (tasks_before, dispatches_before), "nothing in the store changed");
}

// ---------------------------------------------------------------- CLI-035

#[test]
fn cli035_box2_worker_start_with_effort_and_no_model_is_refused() {
    let owned: Vec<String> = words("orchestration worker-start --spec x --effort high");
    let refused = parse(&owned).1.expect_err("refused");
    assert_eq!(refused.code, "invalid_arguments");
    assert!(refused.message.contains("--effort needs --model"), "{}", refused.message);
    // With a model it is accepted.
    assert!(parse(&words("orchestration worker-start --spec x --effort high --model sonnet")).1.is_ok());
    // And the real command line refuses it before any contact.
    let (dir, hits) = app("w2", |_| Err(Fail::new("failed", "the stand-in must not be asked")));
    let out = go(&dir, ONE, &["orchestration", "worker-start", "--spec", "x", "--effort", "high"]);
    assert_ne!(out.status.code(), Some(0));
    assert!(said(&out).contains("--effort needs --model"), "{}", said(&out));
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

// ---------------------------------------------------------------- CLI-036

fn worker_row(id: &str, run: &str, task: &str) -> Value {
    json!({ "id": id, "runtime": std::process::id(), "runId": run, "taskId": task, "status": "running", "agent": "claude", "terminalProgram": "npx", "terminal": 7, "worktree": "C:/work/w", "created": 1 })
}

fn ids_in(list: &Value) -> Vec<String> {
    list["workers"].as_array().unwrap().iter().map(|w| w["dispatchId"].as_str().or(w["id"].as_str()).unwrap().to_string()).collect()
}

#[test]
fn cli036_box1_worker_list_from_a_coordinator_terminal_shows_only_that_runs_workers() {
    let dir = scratch("l1");
    let mut m = Mail::default();
    let r1 = m.run_create("term-1", "one", 1)["run"]["id"].as_str().unwrap().to_string();
    let r2 = m.run_create("term-2", "two", 2)["run"]["id"].as_str().unwrap().to_string();
    let dispatches = vec![worker_row("dispatch-1", &r1, "task-1"), worker_row("dispatch-2", &r2, "task-2")];
    let tasks = vec![
        json!({ "id": "task-1", "runId": r1, "spec": "a", "status": "dispatched", "deps": [], "dispatchId": "dispatch-1" }),
        json!({ "id": "task-2", "runId": r2, "spec": "b", "status": "dispatched", "deps": [], "dispatchId": "dispatch-2" }),
    ];
    let store = store_with(&dir, &tasks, &dispatches);
    m.save(&store.lock().unwrap()).unwrap();
    // MIRROR cli.rs:3094-3095: a pane's Run is `Mail::run_of(pane)`, and the list is filtered to `named.or(own)`.
    let own = m.run_of("term-1", &dispatches);
    assert_eq!(own.as_deref(), Some(r1.as_str()), "the coordinator terminal is tied to its own run");
    let listed = run_line(&dir, &store, &format!("orchestration worker-list --run {}", own.unwrap())).unwrap();
    assert_eq!(ids_in(&listed), ["dispatch-1"], "{listed}");
    let everyone = run_line(&dir, &store, "orchestration worker-list").unwrap();
    let mut all = ids_in(&everyone);
    all.sort();
    assert_eq!(all, ["dispatch-1", "dispatch-2"], "with no run and no terminal, every run: {everyone}");
}

#[test]
fn cli036_box2_worker_read_on_a_released_worker_says_it_is_reading_an_archive() {
    let dir = scratch("l2");
    let archive = dir.join("dispatch-1.txt");
    std::fs::write(&archive, "first line\nsecond line\n").unwrap();
    let mut row = worker_row("dispatch-1", "", "task-1");
    row["runId"] = Value::Null;
    row["status"] = json!("completed");
    row["released"] = json!(true);
    row["archive"] = json!(archive.to_string_lossy());
    let store = store_with(&dir, &[], &[row]);
    let read = run_line(&dir, &store, "orchestration worker-read --dispatch dispatch-1").unwrap();
    assert_eq!((read["source"].as_str(), read["released"].as_bool()), (Some("release archive"), Some(true)), "{read}");
    let warnings = read["warnings"].to_string();
    assert!(warnings.contains("was released: this is the archive saved at") && warnings.contains("not a live worker"), "{warnings}");
    assert!(read["archive"].as_str().unwrap().ends_with("dispatch-1.txt"));
    let lines = read["lines"].to_string();
    assert!(lines.contains("first line") && lines.contains("second line"), "{lines}");
}
