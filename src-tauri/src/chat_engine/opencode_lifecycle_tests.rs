//! Lifecycle tests of the shared OpenCode server (review 1, 2026-11-24): a cut turn, permission
//! questions, one session in two chats, quit, the server's start, its environment, the model list,
//! a refused event stream, the stream being open before a send, and the server's own job. A small
//! stand-in HTTP server plays OpenCode; nothing here starts the real `opencode`.
use super::super::{Chat, Engines};
use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

const SES: &str = "ses_parent0000000000000000001";

type Seen = Arc<Mutex<Vec<(String, ChatEvent)>>>;
type Calls = Arc<Mutex<Vec<(String, String, String)>>>;
type Answer = Arc<dyn Fn(&str, &str) -> Reply + Send + Sync>;
type Envs = Arc<Mutex<Vec<Vec<(String, String)>>>>;

enum Reply {
    Json(u16, String),
    /// An event stream: wait, then send these frames and hold the connection open.
    Events(Duration, Vec<String>),
    /// Answer after a wait.
    Late(Duration, String),
    /// An event stream that sends these frames and closes at once.
    Dropped(Vec<String>),
}

struct Fake {
    base: String,
    calls: Calls,
}

impl Fake {
    fn count(&self, method: &str, path: &str) -> usize {
        self.calls.lock().unwrap().iter().filter(|(m, p, _)| m == method && p.starts_with(path)).count()
    }
    fn any(&self, needle: &str) -> bool {
        self.calls.lock().unwrap().iter().any(|(_, p, _)| p.contains(needle))
    }
}

const CONNECTED: &str = "data: {\"type\":\"server.connected\",\"data\":{}}\n\n";

fn plain(method: &str, path: &str) -> Reply {
    match (method, path) {
        ("GET", "/api/event") => Reply::Events(Duration::ZERO, vec![CONNECTED.to_string()]),
        _ => Reply::Json(200, "{}".to_string()),
    }
}

fn serve_one(mut s: TcpStream, calls: Calls, answer: Answer) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while !buf.ends_with(b"\r\n\r\n") {
        match s.read(&mut byte) {
            Ok(1) => buf.push(byte[0]),
            _ => return,
        }
    }
    let head = String::from_utf8_lossy(&buf).to_string();
    let mut first = head.lines().next().unwrap_or_default().split(' ');
    let (method, path) = (first.next().unwrap_or_default().to_string(), first.next().unwrap_or_default().to_string());
    let len = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
    let mut body = vec![0u8; len];
    let _ = s.read_exact(&mut body);
    calls.lock().unwrap().push((method.clone(), path.clone(), String::from_utf8_lossy(&body).to_string()));
    let json = |s: &mut TcpStream, status: u16, text: &str| {
        let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{text}", text.len());
    };
    match answer(&method, &path) {
        Reply::Json(status, text) => json(&mut s, status, &text),
        Reply::Late(wait, text) => {
            std::thread::sleep(wait);
            json(&mut s, 200, &text);
        }
        Reply::Events(wait, frames) => {
            std::thread::sleep(wait);
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n");
            for f in frames {
                let _ = s.write_all(f.as_bytes());
            }
            let _ = s.flush();
            std::thread::sleep(Duration::from_secs(30));
        }
        Reply::Dropped(frames) => {
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n");
            for f in frames {
                let _ = s.write_all(f.as_bytes());
            }
            let _ = s.flush();
        }
    }
}

fn fake(answer: impl Fn(&str, &str) -> Reply + Send + Sync + 'static) -> Fake {
    let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base = format!("http://{}", l.local_addr().unwrap());
    let calls: Calls = Arc::default();
    let answer: Answer = Arc::new(answer);
    let c = Arc::clone(&calls);
    std::thread::spawn(move || {
        for s in l.incoming().map_while(Result::ok) {
            let (c, a) = (Arc::clone(&c), Arc::clone(&answer));
            std::thread::spawn(move || serve_one(s, c, a));
        }
    });
    Fake { base, calls }
}

fn cfg() -> Config {
    Config { idle: Duration::from_secs(120), busy_idle: Duration::from_secs(120), stop_grace: Duration::from_millis(200), ..Config::default() }
}

/// A server whose every start is the stand-in at `fake`; the environments it was started with are kept.
fn server_on(fake: &Fake) -> (Arc<Server>, Envs) {
    let envs: Envs = Arc::default();
    let (base, e) = (fake.base.clone(), Arc::clone(&envs));
    let start: Starter = Arc::new(move |env: &[(String, String)]| {
        e.lock().unwrap().push(env.to_vec());
        Ok(Up::fake(Api::local(&base, "pw")))
    });
    (Arc::new(Server::with_starter(cfg(), start)), envs)
}

fn spec(env: Vec<(String, String)>) -> Spec {
    Spec { agent: AGENT.to_string(), cwd: std::env::temp_dir(), model: None, effort: None, env, handoff_at: 0, handoff_note: None }
}

fn sink() -> (Seen, Sink) {
    let seen: Seen = Arc::default();
    let s = Arc::clone(&seen);
    (seen, Arc::new(move |id: &str, ev: &ChatEvent| s.lock().unwrap().push((id.to_string(), ev.clone()))))
}

fn kinds_of(seen: &Seen, id: &str) -> Vec<String> {
    seen.lock().unwrap().iter().filter(|(c, _)| c == id).map(|(_, e)| serde_json::to_value(e).unwrap()["kind"].as_str().unwrap_or_default().to_string()).collect()
}

fn ev(kind: &str, extra: Value) -> (String, Value) {
    let mut data = json!({ "sessionID": SES });
    if let (Some(d), Some(x)) = (data.as_object_mut(), extra.as_object()) {
        d.extend(x.clone());
    }
    (kind.to_string(), data)
}

fn wait_until(what: &str, limit: Duration, mut ok: impl FnMut() -> bool) {
    let end = Instant::now() + limit;
    while !ok() {
        assert!(Instant::now() < end, "timed out waiting for: {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

// Finding 1: a turn the page was told is over must not come back on late events.
#[test]
fn a_cut_turn_ignores_late_events_until_the_next_run() {
    let now = Instant::now();
    let mut tr = Translator::new(SES);
    for (k, d) in [ev("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "hi" } } })), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
        tr.on_event(&k, &d, now);
    }
    assert_eq!(tr.cut(now).len(), 1, "the cut ends the turn on the page");
    let (k, d) = ev("session.text.delta", json!({ "assistantMessageID": "a1", "ordinal": 0, "delta": "late" }));
    assert!(tr.on_event(&k, &d, now).is_empty(), "a late reply of the cut run is not shown");
    let (k, d) = ev("session.tool.called", json!({ "assistantMessageID": "a1", "id": "call_1", "name": "bash", "input": {} }));
    assert!(tr.on_event(&k, &d, now).is_empty(), "nor a late tool call");
    let (k, d) = ev("session.execution.succeeded", json!({}));
    assert!(tr.on_event(&k, &d, now).is_empty(), "the cut run's own end sends nothing more");
    assert!(!tr.busy());
    // The next run is shown as usual.
    let mut out = Vec::new();
    for (k, d) in [ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "again" } } })), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.text.ended", json!({ "assistantMessageID": "a2", "ordinal": 0, "text": "ok" })), ev("session.execution.succeeded", json!({}))] {
        out.extend(tr.on_event(&k, &d, now));
    }
    let kinds: Vec<String> = out.iter().map(|e| serde_json::to_value(e).unwrap()["kind"].as_str().unwrap().to_string()).collect();
    assert_eq!(kinds, ["user", "assistant", "result"]);
}

#[test]
fn a_turn_lost_with_the_stream_ignores_late_events() {
    let server = Arc::new(Server::default());
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
        chat.heard(&k, &d);
    }
    chat.stream_lost();
    assert_eq!(kinds_of(&seen, "c1"), ["result"]);
    let (k, d) = ev("session.text.delta", json!({ "assistantMessageID": "a1", "ordinal": 0, "delta": "late" }));
    chat.heard(&k, &d);
    let (k, d) = ev("session.execution.succeeded", json!({}));
    chat.heard(&k, &d);
    assert_eq!(kinds_of(&seen, "c1"), ["result"], "the lost turn does not reopen");
    assert!(!chat.busy());
}

// Finding 13: a stop or a failure forgets the messages that were still waiting.
#[test]
fn a_stopped_or_failed_run_forgets_messages_still_waiting() {
    for end in ["session.execution.interrupted", "session.execution.failed"] {
        let now = Instant::now();
        let mut tr = Translator::new(SES);
        let mut out = Vec::new();
        for (k, d) in [
            ev("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "one" } } })),
            ev("session.execution.started", json!({})),
            ev("session.inbox.delivered", json!({ "inboxID": "m1" })),
            ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } })),
            ev(end, json!({})),
        ] {
            out.extend(tr.on_event(&k, &d, now));
        }
        assert!(matches!(out.last(), Some(ChatEvent::Result(_))), "{end}: {out:?}");
        assert!(!tr.busy(), "{end}: a waiting message does not keep the chat busy");
    }
}

// Finding 2: every permission question on this private server is answered, whatever its session.
#[test]
fn a_permission_question_from_any_session_is_allowed_once() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (_, sink) = sink();
    let _parent = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    // A subagent's own session: no chat has it open.
    server.route(gen, "permission.asked", &json!({ "sessionID": "ses_child000000000000000000001", "id": "per_child1", "parentID": SES }));
    wait_until("the child's question is allowed", Duration::from_secs(5), || fake.any("/api/session/ses_child000000000000000000001/permission/per_child1/reply"));
    // The chat's own session: answered exactly once.
    server.route(gen, "permission.asked", &json!({ "sessionID": SES, "id": "per_own1" }));
    wait_until("the chat's question is allowed", Duration::from_secs(5), || fake.any("/permission/per_own1/reply"));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/permission/per_own1/reply")), 1, "answered once, not twice");
    let body = fake.calls.lock().unwrap().iter().find(|(_, p, _)| p.contains("per_child1")).map(|(_, _, b)| b.clone()).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), json!({ "decision": "once" }));
    server.shutdown();
}

// Finding 3: one session open in two chats.
#[test]
fn one_session_in_two_chats_reaches_both_and_closing_one_keeps_the_other() {
    let server = Arc::new(Server::default());
    let (seen, sink) = sink();
    let a = OpenChat::attach(&server, "a", spec(Vec::new()), SES, None, 0, Arc::clone(&sink));
    let _b = OpenChat::attach(&server, "b", spec(Vec::new()), SES, None, 0, sink);
    server.route(0, "session.something.new", &json!({ "sessionID": SES }));
    assert_eq!((kinds_of(&seen, "a"), kinds_of(&seen, "b")), (vec!["raw".to_string()], vec!["raw".to_string()]), "both chats hear their session");
    a.close();
    server.route(0, "session.something.else", &json!({ "sessionID": SES }));
    assert_eq!(kinds_of(&seen, "b"), ["raw", "raw"], "closing one chat leaves the other listening");
    assert_eq!(kinds_of(&seen, "a"), ["raw"], "the closed chat hears nothing more");
}

// Finding 4: quit never waits on a chat's interrupt.
#[test]
fn quitting_skips_the_interrupts_and_ends_the_server_at_once() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/interrupt") { Reply::Late(Duration::from_secs(4), "{}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let engines = Engines { map: Arc::default(), cfg: cfg(), open: Arc::clone(&server) };
    let (_, _, gen) = server.wake().unwrap();
    let (_, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
        chat.heard(&k, &d);
    }
    assert!(chat.busy());
    engines.map.lock().unwrap().insert("c1".to_string(), Chat::Open(chat));
    let t = Instant::now();
    engines.close_all();
    assert!(t.elapsed() < Duration::from_millis(1500), "quit took {:?}", t.elapsed());
    std::thread::sleep(Duration::from_millis(300));
    assert!(!fake.any("/interrupt"), "no interrupt is posted on quit");
    assert!(!server.is_running());
}

#[test]
fn a_starting_server_does_not_hold_the_lock_and_a_quit_meanwhile_ends_it() {
    let fake = fake(plain);
    let base = fake.base.clone();
    let start: Starter = Arc::new(move |_: &[(String, String)]| {
        std::thread::sleep(Duration::from_millis(1500));
        Ok(Up::fake(Api::local(&base, "pw")))
    });
    let server = Arc::new(Server::with_starter(cfg(), start));
    let s = Arc::clone(&server);
    let waking = std::thread::spawn(move || s.wake().map(|_| ()));
    std::thread::sleep(Duration::from_millis(200));
    let t = Instant::now();
    let _ = server.is_running();
    assert!(t.elapsed() < Duration::from_millis(500), "the lock was held while the server started: {:?}", t.elapsed());
    let t = Instant::now();
    server.shutdown();
    assert!(t.elapsed() < Duration::from_millis(500), "shutdown waited for the start: {:?}", t.elapsed());
    assert!(waking.join().unwrap().is_err(), "a start that finishes after the quit is ended, not used");
    assert!(!server.is_running());
}

// Finding 5: Kolux picks the password and the port is the one the server says.
#[test]
fn the_server_gets_a_fresh_random_password_and_port_zero() {
    let (a, b) = (new_password().unwrap(), new_password().unwrap());
    assert!(a.len() >= 64 && a.chars().all(|c| c.is_ascii_hexdigit()), "{} chars", a.len());
    assert_ne!(a, b);
    let env = vec![("KEEP".to_string(), "1".to_string()), ("OPENCODE_SERVER_PASSWORD".to_string(), "theirs".to_string()), ("OPENCODE_PASSWORD".to_string(), "theirs".to_string())];
    let cmd = serve_command(std::path::Path::new("opencode.exe"), &env, &a).unwrap();
    let args: Vec<String> = cmd.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
    assert_eq!(args, ["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    let envs: HashMap<String, Option<String>> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
    assert_eq!(envs.get("OPENCODE_PASSWORD"), Some(&Some(a.clone())), "Kolux's own password wins");
    assert_eq!(envs.get("OPENCODE_SERVER_PASSWORD"), Some(&None), "the other password variable is removed");
    assert_eq!(envs.get("KEEP"), Some(&Some("1".to_string())));
    // The line opencode 2.4.1 prints with `--port 0` and a password set (checked 2026-11-24).
    assert_eq!(listening("server listening on http://127.0.0.1:58584").as_deref(), Some("http://127.0.0.1:58584"));
    assert_eq!(listening("something else"), None);
}

// Finding 6: the shared server always starts with the server's own environment, not a chat's.
#[test]
fn a_chat_wakes_the_server_with_the_servers_environment() {
    let fake = fake(plain);
    let (server, envs) = server_on(&fake);
    let fixed = vec![("OPENCODE_SIGN_IN".to_string(), "app".to_string())];
    server.set_env(fixed.clone());
    let (_, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(vec![("PANE_ONLY".to_string(), "x".to_string())]), SES, None, 0, sink);
    chat.send("hi", &[]).unwrap();
    assert_eq!(envs.lock().unwrap().clone(), vec![fixed]);
    server.shutdown();
}

// Finding 11: one model-list read at a time, shared by every caller.
#[test]
fn callers_share_one_model_list_read() {
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let r = Arc::clone(&reads);
    let fake = fake(move |m: &str, p: &str| {
        if p.starts_with("/api/model") {
            let n = r.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let list = if n < 2 { "{\"data\":[]}" } else { "{\"data\":[{\"id\":\"big-pickle\",\"providerID\":\"opencode\",\"name\":\"P\",\"variants\":[]}]}" };
            return Reply::Json(200, list.to_string());
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    let mut server_mut = Arc::try_unwrap(server).ok().unwrap();
    server_mut.model_poll = Duration::from_millis(100);
    let server = Arc::new(server_mut);
    let all: Vec<_> = (0..5)
        .map(|_| {
            let s = Arc::clone(&server);
            std::thread::spawn(move || s.models(&[]))
        })
        .collect();
    for h in all {
        assert_eq!(h.join().unwrap().unwrap().len(), 1);
    }
    assert_eq!(fake.count("GET", "/api/model"), 3, "one reader polled; the others waited for it");
    server.shutdown();
}

// Finding 12: a refused event stream backs off and is given up.
#[test]
fn a_refused_event_stream_backs_off_and_gives_up() {
    let fake = fake(|m: &str, p: &str| if p == "/api/event" { Reply::Json(401, "{}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let mut s = Arc::try_unwrap(server).ok().unwrap();
    s.retry_base = Duration::from_millis(20);
    s.retry_tries = 3;
    let server = Arc::new(s);
    let (seen, sink) = sink();
    let _chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 1, sink);
    let w = Arc::clone(&server);
    std::thread::spawn(move || {
        let _ = w.wake();
    });
    std::thread::sleep(Duration::from_millis(2000));
    let tries = fake.count("GET", "/api/event");
    assert!(tries <= 4, "tried {tries} times");
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(fake.count("GET", "/api/event"), tries, "no more tries once given up");
    let kinds = kinds_of(&seen, "c1");
    assert!(kinds.contains(&"stderr".to_string()) && kinds.contains(&"exit".to_string()), "the chat is told: {kinds:?}");
    assert!(!server.is_running());
}

// Finding 14: no chat sends before the event stream is open.
#[test]
fn a_second_waker_waits_for_the_event_stream() {
    let fake = fake(|m: &str, p: &str| if p == "/api/event" { Reply::Events(Duration::from_millis(1200), vec![CONNECTED.to_string()]) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let t0 = Instant::now();
    let s = Arc::clone(&server);
    let first = std::thread::spawn(move || s.wake().map(|_| ()));
    std::thread::sleep(Duration::from_millis(200));
    server.wake().unwrap();
    assert!(t0.elapsed() >= Duration::from_millis(1000), "the second wake returned before the stream was open: {:?}", t0.elapsed());
    first.join().unwrap().unwrap();
    server.shutdown();
}

/// A fresh empty folder under the system temp folder for one test.
fn temp_folder(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-oc-{name}-{}-{}", std::process::id(), new_password().unwrap().get(..8).unwrap_or("x")));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// Finding 16 / review 2 P2-1: the server is in its job from its start, so a program it starts before it
// prints its address (an MCP or language server) ends with the job too.
#[cfg(windows)]
#[test]
fn a_program_the_server_starts_before_it_is_ready_ends_with_its_job() {
    let dir = temp_folder("job");
    // The "server" waits a moment, starts a helper in the background, then says it is ready and stays.
    // The helper writes a marker a few seconds later unless it was ended first.
    std::fs::write(dir.join("late.bat"), "@echo off\r\nping -n 5 127.0.0.1 >nul\r\necho late>\"%~dp0marker.txt\"\r\n").unwrap();
    std::fs::write(dir.join("serve.bat"), "@echo off\r\nping -n 2 127.0.0.1 >nul\r\nstart \"\" /b cmd /d /c \"%~dp0late.bat\"\r\necho server listening on http://127.0.0.1:1\r\nping -n 60 127.0.0.1 >nul\r\n").unwrap();
    let mut up = launch(&dir.join("serve.bat"), &[], "pw").unwrap();
    let p = up.proc.as_mut().unwrap();
    let has_job = p.job.is_some();
    drop(p.job.take());
    std::thread::sleep(Duration::from_secs(7));
    let marker = dir.join("marker.txt").exists();
    // Only the process this test started, and its own tree.
    crate::procs::kill_tree(p.pid);
    let _ = p.child.kill();
    let _ = p.child.wait();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(has_job, "the server is put in a job of its own");
    assert!(!marker, "the helper the server started before it was ready was not ended with the job");
}

// Review 2 P2-1: OpenCode's npm shim is not run through cmd.exe; the program it names is started.
#[cfg(windows)]
#[test]
fn the_npm_shim_of_opencode_starts_its_own_program() {
    let dir = temp_folder("shim");
    let bin = dir.join("node_modules").join("@opencode").join("cli").join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("opencode.exe"), b"").unwrap();
    let shim = dir.join("opencode.cmd");
    std::fs::write(&shim, "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe\"   %*\r\n").unwrap();
    let cmd = serve_command(&shim, &[], "pw").unwrap();
    let program = std::path::PathBuf::from(cmd.get_program());
    let args: Vec<String> = cmd.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(program, bin.join("opencode.exe"), "the server is OpenCode's own program, not cmd.exe");
    assert_eq!(args, ["serve", "--hostname", "127.0.0.1", "--port", "0"]);
}

// Review 2 P1-1: a message still waiting when a run fails or is stopped gets a result of its own, so
// the page never keeps waiting for it.
#[test]
fn a_failed_or_stopped_run_answers_every_waiting_message() {
    for end in ["session.execution.interrupted", "session.execution.failed"] {
        let now = Instant::now();
        let mut tr = Translator::new(SES);
        let mut out = Vec::new();
        for (k, d) in [
            ev("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "one" } } })),
            ev("session.execution.started", json!({})),
            ev("session.inbox.delivered", json!({ "inboxID": "m1" })),
            ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } })),
            ev(end, json!({})),
        ] {
            out.extend(tr.on_event(&k, &d, now));
        }
        let results = out.iter().filter(|e| matches!(e, ChatEvent::Result(_))).count();
        assert_eq!(results, 2, "{end}: one result for the run, one for the message still waiting: {out:?}");
        assert!(!tr.busy());
    }
}

// Review 2 P1-1: Stop with nothing running still tells the page, so its Stop never fails.
#[test]
fn stop_with_nothing_running_still_tells_the_page() {
    let server = Arc::new(Server::default());
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    assert_eq!(chat.stop(), Some(StopHow::Ended));
    assert_eq!(kinds_of(&seen, "c1"), ["stopped"]);
}

// Review 2 P2-2: a run the page lost track of is still stopped by Stop.
#[test]
fn stop_after_a_lost_stream_still_interrupts_the_run() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
        chat.heard(&k, &d);
    }
    chat.stream_lost();
    assert!(!chat.busy());
    assert!(chat.stop().is_some(), "the run OpenCode may still have is stopped");
    assert!(fake.any(&format!("/api/session/{SES}/interrupt")), "an interrupt is posted");
    assert_eq!(kinds_of(&seen, "c1").last().map(String::as_str), Some("stopped"));
    server.shutdown();
}

// Review 2 P1-2: a lost stream does not forget a waiting message: OpenCode still runs it, and the page
// sees it as a turn of its own.
#[test]
fn a_lost_stream_keeps_the_waiting_message_for_its_own_turn() {
    let now = Instant::now();
    let mut tr = Translator::new(SES);
    for (k, d) in [
        ev("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "one" } } })),
        ev("session.execution.started", json!({})),
        ev("session.inbox.delivered", json!({ "inboxID": "m1" })),
        ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } })),
    ] {
        tr.on_event(&k, &d, now);
    }
    assert_eq!(tr.lost(Vec::new(), now).len(), 1);
    let mut out = Vec::new();
    for (k, d) in [ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.text.ended", json!({ "assistantMessageID": "a2", "ordinal": 0, "text": "ok" })), ev("session.execution.succeeded", json!({}))] {
        out.extend(tr.on_event(&k, &d, now));
    }
    let kinds: Vec<String> = out.iter().map(|e| serde_json::to_value(e).unwrap()["kind"].as_str().unwrap().to_string()).collect();
    assert_eq!(kinds, ["user", "assistant", "result"]);
}

// Review 2 P1-2: a Stop OpenCode did not take leaves the waiting message to run, and it is shown.
#[test]
fn a_stop_opencode_did_not_take_keeps_the_waiting_message() {
    // No server is up, so the interrupt cannot be asked.
    let server = Arc::new(Server::default());
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    for (k, d) in [
        ev("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "one" } } })),
        ev("session.execution.started", json!({})),
        ev("session.inbox.delivered", json!({ "inboxID": "m1" })),
        ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } })),
    ] {
        chat.heard(&k, &d);
    }
    assert_eq!(chat.stop(), Some(StopHow::Ended));
    let before = kinds_of(&seen, "c1").len();
    for (k, d) in [ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.text.ended", json!({ "assistantMessageID": "a2", "ordinal": 0, "text": "ok" })), ev("session.execution.succeeded", json!({}))] {
        chat.heard(&k, &d);
    }
    assert_eq!(kinds_of(&seen, "c1")[before..], ["user", "assistant", "result"]);
}

// Review 2 P3-1: a cut run that then ends stopped or failed drops the queue, and answers each message.
#[test]
fn a_cut_run_that_ends_stopped_answers_the_messages_sent_after_the_cut() {
    for end in ["session.execution.interrupted", "session.execution.failed"] {
        let now = Instant::now();
        let mut tr = Translator::new(SES);
        for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
            tr.on_event(&k, &d, now);
        }
        tr.cut(now);
        let (k, d) = ev("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } }));
        tr.on_event(&k, &d, now);
        let (k, d) = ev(end, json!({}));
        let out = tr.on_event(&k, &d, now);
        assert_eq!(out.iter().filter(|e| matches!(e, ChatEvent::Result(_))).count(), 1, "{end}: {out:?}");
        assert!(!tr.busy(), "{end}");
    }
}

// Review 2 P3-2: a new server's models are read again, not the old server's list.
#[test]
fn a_new_server_reads_its_model_list_again() {
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let r = Arc::clone(&reads);
    let fake = fake(move |m: &str, p: &str| {
        if p.starts_with("/api/model") {
            let list = if r.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                "{\"data\":[{\"id\":\"a\",\"providerID\":\"opencode\",\"name\":\"A\",\"variants\":[]}]}"
            } else {
                "{\"data\":[{\"id\":\"a\",\"providerID\":\"opencode\",\"name\":\"A\",\"variants\":[]},{\"id\":\"b\",\"providerID\":\"opencode\",\"name\":\"B\",\"variants\":[]}]}"
            };
            return Reply::Json(200, list.to_string());
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    assert_eq!(server.models(&[]).unwrap().len(), 1);
    server.shutdown();
    assert_eq!(server.models(&[]).unwrap().len(), 2, "the second server's own list");
    server.shutdown();
}

// Review 2 P3-3: a caller waiting on a start when the app quits does not start a server of its own.
#[test]
fn a_caller_waiting_on_a_start_does_not_start_again_after_quit() {
    let fake = fake(plain);
    let base = fake.base.clone();
    let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let n = Arc::clone(&starts);
    let start: Starter = Arc::new(move |_: &[(String, String)]| {
        n.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(800));
        Ok(Up::fake(Api::local(&base, "pw")))
    });
    let server = Arc::new(Server::with_starter(cfg(), start));
    let s = Arc::clone(&server);
    let first = std::thread::spawn(move || s.wake().map(|_| ()));
    std::thread::sleep(Duration::from_millis(200));
    let s = Arc::clone(&server);
    let second = std::thread::spawn(move || s.wake().map(|_| ()));
    std::thread::sleep(Duration::from_millis(200));
    server.shutdown();
    let (a, b) = (first.join().unwrap(), second.join().unwrap());
    let count = starts.load(std::sync::atomic::Ordering::SeqCst);
    server.shutdown();
    assert!(a.is_err() && b.is_err(), "neither caller gets a server after the quit: {a:?} {b:?}");
    assert_eq!(count, 1, "the waiting caller started no server of its own");
}

// Review 2 P3-4: a start that panics does not leave every later caller waiting.
#[test]
fn a_start_that_panics_does_not_block_the_next_start() {
    let fake = fake(plain);
    let base = fake.base.clone();
    let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let n = Arc::clone(&starts);
    let start: Starter = Arc::new(move |_: &[(String, String)]| {
        if n.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            panic!("a starter bug");
        }
        Ok(Up::fake(Api::local(&base, "pw")))
    });
    let server = Arc::new(Server::with_starter(cfg(), start));
    let s = Arc::clone(&server);
    let first = std::thread::spawn(move || s.wake().map(|_| ())).join();
    assert!(matches!(first, Ok(Err(_))), "the panic is a plain error to the caller");
    let (tx, rx) = mpsc::channel();
    let s = Arc::clone(&server);
    std::thread::spawn(move || {
        let _ = tx.send(s.wake().map(|_| ()));
    });
    let second = rx.recv_timeout(Duration::from_secs(5)).expect("the next caller is not left waiting");
    assert!(second.is_ok(), "{second:?}");
    server.shutdown();
}

// Review 2 P3-5: a stream that opens and drops at once counts as a failure, so it is given up.
#[test]
fn an_event_stream_that_keeps_dropping_at_once_is_given_up() {
    let fake = fake(|m: &str, p: &str| if p == "/api/event" { Reply::Dropped(vec![CONNECTED.to_string()]) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let mut s = Arc::try_unwrap(server).ok().unwrap();
    s.retry_base = Duration::from_millis(20);
    s.retry_tries = 3;
    let server = Arc::new(s);
    let (seen, sink) = sink();
    let _chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 1, sink);
    let w = Arc::clone(&server);
    std::thread::spawn(move || {
        let _ = w.wake();
    });
    std::thread::sleep(Duration::from_millis(2000));
    let tries = fake.count("GET", "/api/event");
    assert!(tries <= 4, "tried {tries} times");
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(fake.count("GET", "/api/event"), tries, "no more tries once given up");
    assert!(kinds_of(&seen, "c1").contains(&"exit".to_string()));
    assert!(!server.is_running());
}

// Review 2 P3-6: a user name of the user's own does not replace Kolux's sign-in.
#[test]
fn the_server_gets_no_user_name_of_the_users_own() {
    let env = vec![("OPENCODE_SERVER_USERNAME".to_string(), "theirs".to_string())];
    let cmd = serve_command(std::path::Path::new("opencode.exe"), &env, "pw").unwrap();
    let envs: HashMap<String, Option<String>> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
    assert_eq!(envs.get("OPENCODE_SERVER_USERNAME"), Some(&None));
}

// Review 2 P3-8: a model pick made while the server slept that OpenCode then refuses is reported, the
// message is not sent on the old model, and the pick is tried again on the next send.
#[test]
fn a_model_pick_refused_at_send_is_reported_and_kept() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(500, "{\"message\":\"no such model\"}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    let mut pick = spec(Vec::new());
    pick.model = Some("opencode/big-pickle".to_string());
    chat.retarget(pick).unwrap();
    assert!(chat.send("hi", &[]).is_err(), "the message is not sent on the old model");
    assert!(!fake.any("/prompt"), "nothing was sent");
    assert!(kinds_of(&seen, "c1").contains(&"stderr".to_string()), "the page is told why");
    let _ = chat.send("hi", &[]);
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/model")), 2, "the pick is tried again");
    server.shutdown();
}

// Review 2: a chat_start of an OpenCode chat gives the server its own environment; another agent's
// chat leaves it alone.
#[test]
fn starting_an_opencode_chat_sets_the_servers_environment() {
    let server = Server::default();
    let fixed = vec![("OPENCODE_SIGN_IN".to_string(), "app".to_string())];
    super::super::set_open_env(&server, AGENT, || Ok(fixed.clone())).unwrap();
    assert_eq!(server.env(), fixed);
    super::super::set_open_env(&server, "claude", || panic!("not read for another agent")).unwrap();
    assert_eq!(server.env(), fixed);
}
