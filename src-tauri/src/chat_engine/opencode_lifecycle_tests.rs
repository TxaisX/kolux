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
    /// An event stream that sends each frame after its wait, then holds the connection open.
    Stream(Vec<(Duration, String)>),
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
        Reply::Stream(frames) => {
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n");
            for (wait, f) in frames {
                std::thread::sleep(wait);
                let _ = s.write_all(f.as_bytes());
                let _ = s.flush();
            }
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
    mine(&chat, &[("m1", "one")]);
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

// Review 2 P3-8, changed by review 3 F2: a model pick made while the server slept that OpenCode then
// refuses is reported and the message is not sent on the old model. The refused pick is dropped (a
// pick kept would lock the chat): the next send goes on the session's own model.
#[test]
fn a_model_pick_refused_at_send_is_reported_and_dropped() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(400, "{\"message\":\"no such model\"}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    let mut pick = spec(Vec::new());
    pick.model = Some("opencode/big-pickle".to_string());
    chat.retarget(pick).unwrap();
    assert!(chat.send("hi", &[]).is_err(), "the message is not sent on the old model");
    assert!(!fake.any("/prompt"), "nothing was sent");
    assert!(kinds_of(&seen, "c1").contains(&"stderr".to_string()), "the page is told why");
    chat.send("hi", &[]).unwrap();
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/model")), 1, "the refused pick is not tried again");
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/prompt")), 1, "the next message goes");
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

// Coordinator round 2: only a conversation OpenCode says is gone reads "not in OpenCode anymore"
// (the screen keys on that word); a server that cannot be reached or fails says so instead.
#[test]
fn a_gone_conversation_is_told_apart_from_a_server_that_cannot_be_reached() {
    let answering = |status: u16| {
        let session = format!("/api/session/{SES}");
        fake(move |m: &str, p: &str| {
            if m == "GET" && p.starts_with(&session) {
                let body = if status == 404 { format!("{{\"name\":\"NotFoundError\",\"data\":{{\"message\":\"Session not found: {SES}\"}}}}") } else { "{}".to_string() };
                return Reply::Json(status, body);
            }
            plain(m, p)
        })
    };
    let gone = answering(404);
    let (server, _) = server_on(&gone);
    let e = server.history(&[], SES, 50).unwrap_err();
    assert!(e.contains("anymore"), "a 404 is a gone conversation: {e}");
    let (_, s) = sink();
    let e = OpenChat::open(&server, "c1", spec(vec![]), Some(SES.to_string()), s).err().expect("resume of a gone session fails");
    assert!(e.contains("anymore"), "resume of a gone session: {e}");
    server.shutdown();

    let failing = answering(500);
    let (server, _) = server_on(&failing);
    let e = server.history(&[], SES, 50).unwrap_err();
    assert!(!e.contains("anymore") && e.starts_with("Could not reach OpenCode"), "a 500 is not a gone conversation: {e}");
    let (_, s) = sink();
    let e = OpenChat::open(&server, "c1", spec(vec![]), Some(SES.to_string()), s).err().expect("resume on a failing server fails");
    assert!(!e.contains("anymore") && e.starts_with("Could not reach OpenCode"), "resume on a failing server: {e}");
    server.shutdown();

    // Nothing listens on this port any more.
    let base = {
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        format!("http://{}", l.local_addr().unwrap())
    };
    let start: Starter = Arc::new(move |_: &[(String, String)]| Ok(Up::fake(Api::local(&base, "pw"))));
    let server = Arc::new(Server::with_starter(cfg(), start));
    let e = server.history(&[], SES, 50).unwrap_err();
    assert!(!e.contains("anymore") && e.starts_with("Could not reach OpenCode"), "a closed port is not a gone conversation: {e}");
    server.shutdown();
}

/// One event-stream frame of this session.
fn frame(kind: &str, extra: Value) -> String {
    let (k, d) = ev(kind, extra);
    format!("data: {}\n\n", json!({ "type": k, "data": d }))
}

fn results_of(out: &[ChatEvent]) -> Vec<TurnResult> {
    out.iter().filter_map(|e| if let ChatEvent::Result(r) = e { Some(r.clone()) } else { None }).collect()
}

/// A server like [`server_on`] whose lost streams are tried again quickly.
fn quick_server_on(fake: &Fake, tries: u32) -> Arc<Server> {
    let (server, _) = server_on(fake);
    let mut s = Arc::try_unwrap(server).ok().unwrap();
    s.retry_base = Duration::from_millis(20);
    s.retry_tries = tries;
    Arc::new(s)
}

// Review 3 F2: a refused model pick does not lock the chat: it is dropped, and a later pick and the
// message go through.
#[test]
fn a_refused_model_pick_does_not_lock_the_chat() {
    let fake = refuses_first_model_pick();
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    // Picked while the server sleeps, refused at the send.
    let mut bad = spec(Vec::new());
    bad.model = Some("opencode/bad".to_string());
    chat.retarget(bad).unwrap();
    assert!(chat.send("one", &[]).is_err());
    assert!(kinds_of(&seen, "c1").contains(&"stderr".to_string()), "the page is told why");
    assert_eq!(chat.lock().model.as_ref().and_then(|m| m.get("id")).and_then(Value::as_str), Some("real"), "back on the session's own model");
    // A new pick while the server is up, then a send: only that pick is posted, and the message goes.
    let mut good = spec(Vec::new());
    good.model = Some("opencode/good".to_string());
    chat.retarget(good).unwrap();
    chat.send("two", &[]).unwrap();
    let picks: Vec<String> = fake.calls.lock().unwrap().iter().filter(|(m, p, _)| m == "POST" && p.ends_with("/model")).map(|(_, _, b)| b.clone()).collect();
    assert_eq!(picks.len(), 2, "{picks:?}");
    assert!(picks[0].contains("\"bad\"") && picks[1].contains("\"good\""), "{picks:?}");
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/prompt")), 1);
    server.shutdown();
}

/// A stand-in whose first model pick is refused, and whose session is on model `opencode/real`.
fn refuses_first_model_pick() -> Fake {
    let picks = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    fake(move |m: &str, p: &str| {
        if m == "POST" && p.ends_with("/model") && picks.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            return Reply::Json(400, "{\"message\":\"no such model\"}".to_string());
        }
        if m == "GET" && p == format!("/api/session/{SES}") {
            return Reply::Json(200, format!("{{\"data\":{{\"id\":\"{SES}\",\"model\":{{\"id\":\"real\",\"providerID\":\"opencode\"}}}}}}"));
        }
        plain(m, p)
    })
}

// Review 3 F2: a resumed chat whose model pick is refused still opens, on the session's own model.
#[test]
fn a_refused_model_pick_on_resume_still_opens_the_chat() {
    let fake = refuses_first_model_pick();
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let mut bad = spec(Vec::new());
    bad.model = Some("opencode/bad".to_string());
    let chat = OpenChat::open(&server, "c1", bad, Some(SES.to_string()), sink).expect("the chat opens");
    assert!(kinds_of(&seen, "c1").contains(&"stderr".to_string()), "the page is told the pick was refused");
    assert_eq!(chat.lock().model.as_ref().and_then(|m| m.get("id")).and_then(Value::as_str), Some("real"));
    server.shutdown();
}

// Review 3 F3: a stream that carries events before it drops is never given up, however often.
#[test]
fn an_event_stream_that_carries_events_is_never_given_up() {
    let fake = fake(|m: &str, p: &str| if p == "/api/event" { Reply::Dropped(vec![CONNECTED.to_string(), frame("session.usage.updated", json!({}))]) } else { plain(m, p) });
    let server = quick_server_on(&fake, 3);
    let w = Arc::clone(&server);
    std::thread::spawn(move || {
        let _ = w.wake();
    });
    std::thread::sleep(Duration::from_millis(2000));
    assert!(fake.count("GET", "/api/event") > 4, "still tried again");
    assert!(server.is_running(), "a server whose stream carries events is not ended");
    server.shutdown();
}

// Review 3 F6: a model list read from a server that went away meanwhile is not kept.
#[test]
fn a_model_list_read_across_a_restart_is_not_kept() {
    let fake = fake(|m: &str, p: &str| {
        if p.starts_with("/api/model") {
            return Reply::Late(Duration::from_millis(400), "{\"data\":[{\"id\":\"a\",\"providerID\":\"opencode\",\"name\":\"A\",\"variants\":[]}]}".to_string());
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    let r = Arc::clone(&server);
    let read = std::thread::spawn(move || r.models(&[]));
    wait_until("the model read is under way", Duration::from_secs(5), || fake.count("GET", "/api/model") == 1);
    server.shutdown();
    let _ = read.join().unwrap();
    let _ = server.models(&[]);
    assert_eq!(fake.count("GET", "/api/model"), 2, "the new server's list is read, not the old one's kept");
    server.shutdown();
}

// Review 3 F7: once the app is closing, nothing starts the server again.
#[test]
fn a_closing_app_starts_no_server() {
    let fake = fake(plain);
    let (server, envs) = server_on(&fake);
    server.close();
    assert!(server.wake().is_err());
    assert!(envs.lock().unwrap().is_empty(), "no server was started");
    assert!(!server.is_running());
}

// ---- Inbox rules from OpenCode's own signals (review 4) ----

fn queued(id: &str, text: &str) -> (String, Value) {
    ev("session.inbox.enqueued", json!({ "inboxID": id, "item": { "type": "user", "payload": { "text": text }, "delivery": "steer" } }))
}

fn fed(tr: &mut Translator, events: &[(String, Value)]) -> Vec<ChatEvent> {
    let now = Instant::now();
    events.iter().flat_map(|(k, d)| tr.on_event(k, d, now)).collect()
}

fn kinds_in(out: &[ChatEvent]) -> Vec<String> {
    out.iter().map(|e| serde_json::to_value(e).unwrap()["kind"].as_str().unwrap_or_default().to_string()).collect()
}

/// Marks messages as the chat's own, as OpenCode's answer to its `prompt` call does.
fn mine(chat: &OpenChat, sent: &[(&str, &str)]) {
    let mut i = chat.lock();
    for (id, text) in sent {
        i.tr.admit(id, text);
    }
}

/// The subtypes of the results one chat was sent.
fn results_for(seen: &Seen, chat: &str) -> Vec<String> {
    seen.lock().unwrap().iter().filter(|(c, _)| c == chat).filter_map(|(_, e)| if let ChatEvent::Result(r) = e { Some(r.subtype.clone()) } else { None }).collect()
}

fn results_seen(seen: &Seen) -> Vec<TurnResult> {
    seen.lock().unwrap().iter().filter_map(|(_, e)| if let ChatEvent::Result(r) = e { Some(r.clone()) } else { None }).collect()
}

fn subtypes(results: &[TurnResult]) -> Vec<String> {
    results.iter().map(|r| r.subtype.clone()).collect()
}

fn said(id: &str, text: &str) -> (String, Value) {
    ev("session.text.ended", json!({ "assistantMessageID": id, "ordinal": 0, "text": text }))
}

// (a) Review 4 item 1: a message still waiting when a run ends is not answered on a guess. It gets its
// result from its own run, and its reply is shown.
#[test]
fn each_message_gets_one_result_from_its_own_run() {
    let mut tr = Translator::new(SES);
    let first = fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_of(&first).len(), 1, "only m1 is answered when m1's run ends: {first:?}");
    assert!(tr.busy(), "m2 is still waiting for its run");
    let second = fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), said("a2", "two done"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(kinds_in(&second), ["user", "assistant", "result"], "m2's reply is shown");
    assert_eq!(results_of(&second)[0].result.as_deref(), Some("two done"));
    assert!(!tr.busy());
}

// (b) OpenCode's own word that a waiting message was cancelled is the one "cancelled" result.
#[test]
fn a_message_opencode_cancels_gets_one_cancelled_result() {
    let mut tr = Translator::new(SES);
    fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two")]);
    let out = fed(&mut tr, &[ev("session.inbox.delivery.changed", json!({ "inboxID": "m2", "delivery": "queue" })), ev("session.inbox.cancelled", json!({ "inboxID": "m2" })), ev("session.inbox.cancelled", json!({ "inboxID": "m2" })), ev("session.inbox.cancelled", json!({ "inboxID": "never_heard" }))]);
    assert_eq!(kinds_in(&out), ["result"], "one result, and nothing for a repeat or an unknown message: {out:?}");
    let r = &results_of(&out)[0];
    assert_eq!((r.subtype.as_str(), r.is_error), ("cancelled", true));
    assert!(!r.errors.is_empty(), "the notice says why");
    let end = fed(&mut tr, &[ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_of(&end).len(), 1, "m1's own result");
    assert!(!tr.busy());
}

// (c) OpenCode keeps a waiting message when the run before it fails or is stopped: no "cancelled".
#[test]
fn a_failed_or_stopped_run_keeps_the_waiting_message() {
    for end in ["session.execution.interrupted", "session.execution.failed"] {
        let mut tr = Translator::new(SES);
        let out = fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two"), ev(end, json!({ "reason": "user" }))]);
        let r = results_of(&out);
        assert_eq!(r.len(), 1, "{end}: only the run that ended is answered: {out:?}");
        assert_ne!(r[0].subtype, "cancelled", "{end}");
        assert!(tr.busy(), "{end}: m2 is still waiting in OpenCode");
    }
}

// BUG F (live run of 9861a261): m1 running, m2 queued, Stop. OpenCode keeps m2 and takes it up with
// the next message, so m2 gets one honest result then, and never a "not run" notice.
#[test]
fn a_message_waiting_at_a_stop_runs_with_the_next_one() {
    let mut tr = Translator::new(SES);
    let stopped = fed(&mut tr, &[queued("m1", "count"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "cherry"), ev("session.execution.interrupted", json!({ "reason": "user" }))]);
    assert_eq!(subtypes(&results_of(&stopped)), ["error_during_execution"]);
    let next = fed(&mut tr, &[queued("m3", "ok"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.inbox.delivered", json!({ "inboxID": "m3" })), said("a3", "cherry ok"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(kinds_in(&next), ["user", "user", "assistant", "result", "result"], "m2 and m3 each get one result");
    assert!(results_of(&next).iter().all(|r| r.subtype == "success" && !r.is_error), "{next:?}");
    assert!(!tr.busy());
}

// A cut run (a stop that got no word in time) that then ends keeps the message sent after the cut.
#[test]
fn a_cut_run_that_ends_keeps_the_message_sent_after_the_cut() {
    for end in ["session.execution.interrupted", "session.execution.failed", "session.execution.succeeded"] {
        let now = Instant::now();
        let mut tr = Translator::new(SES);
        fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))]);
        assert_eq!(tr.cut(now).len(), 1);
        let out = fed(&mut tr, &[queued("m2", "two"), ev(end, json!({}))]);
        assert!(out.is_empty(), "{end}: the cut run's end answers nothing: {out:?}");
        assert!(tr.busy(), "{end}: m2 still waits");
        let run = fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.execution.succeeded", json!({}))]);
        assert_eq!(kinds_in(&run), ["user", "result"], "{end}");
    }
}

// OpenCode's own items (a compaction, a synthetic note) are not messages of the page: none adds a result.
#[test]
fn an_item_that_is_not_a_users_message_adds_no_result() {
    let mut tr = Translator::new(SES);
    let out = fed(&mut tr, &[queued("m1", "one"), ev("session.inbox.enqueued", json!({ "inboxID": "s1", "item": { "type": "synthetic", "payload": { "text": "note" } } })), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), ev("session.inbox.delivered", json!({ "inboxID": "s1" })), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_of(&out).len(), 1, "{out:?}");
}

/// A stand-in whose event stream drops once after `first`, then opens again and sends `second` (each
/// frame after its wait); `state` answers the reads Kolux makes to learn what happened in the gap.
fn gap_fake(first: Vec<String>, second: Vec<(Duration, String)>, state: impl Fn(&str) -> Option<Reply> + Send + Sync + 'static) -> Fake {
    let opens = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    fake(move |m: &str, p: &str| {
        if p == "/api/event" {
            if opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                return Reply::Dropped(std::iter::once(CONNECTED.to_string()).chain(first.clone()).collect());
            }
            return Reply::Stream(std::iter::once((Duration::ZERO, CONNECTED.to_string())).chain(second.clone()).collect());
        }
        if m == "GET" {
            if let Some(r) = state(p) {
                return r;
            }
        }
        plain(m, p)
    })
}

fn m1_running_m2_waiting() -> Vec<String> {
    vec![
        frame("session.inbox.enqueued", json!({ "inboxID": "m1", "item": { "type": "user", "payload": { "text": "one" } } })),
        frame("session.execution.started", json!({})),
        frame("session.inbox.delivered", json!({ "inboxID": "m1" })),
        frame("session.inbox.enqueued", json!({ "inboxID": "m2", "item": { "type": "user", "payload": { "text": "two" } } })),
    ]
}

const IDLE_OK: &str = "{\"data\":[{\"id\":\"msg_z\",\"type\":\"idle\",\"outcome\":\"succeeded\"}]}";
const NO_IDLE: &str = "{\"data\":[{\"id\":\"msg_a\",\"type\":\"assistant\"}]}";

/// OpenCode's answers after a gap: is the session running, what still waits, and which messages it has.
fn after_gap(active: bool, waiting: &'static [&'static str], has: &'static [&'static str], last: &'static str) -> impl Fn(&str) -> Option<Reply> + Send + Sync + 'static {
    move |p: &str| {
        if p == "/api/session/active" {
            return Some(Reply::Json(200, if active { format!("{{\"data\":{{\"{SES}\":{{\"type\":\"running\"}}}}}}") } else { "{\"data\":{}}".to_string() }));
        }
        if p == format!("/api/session/{SES}/inbox") {
            let items: Vec<String> = waiting.iter().map(|id| format!("{{\"id\":\"{id}\",\"type\":\"user\"}}")).collect();
            return Some(Reply::Json(200, format!("{{\"data\":[{}]}}", items.join(","))));
        }
        if let Some(id) = p.strip_prefix(&format!("/api/session/{SES}/message/")) {
            return Some(if has.contains(&id) { Reply::Json(200, format!("{{\"data\":{{\"id\":\"{id}\",\"type\":\"user\"}}}}")) } else { Reply::Json(404, "{\"name\":\"NotFoundError\"}".to_string()) });
        }
        if p.starts_with(&format!("/api/session/{SES}/message?")) {
            return Some(Reply::Json(200, last.to_string()));
        }
        None
    }
}

fn chat_on(fake: &Fake) -> (Arc<Server>, Arc<OpenChat>, Seen) {
    chat_that_sent(fake, &[("m1", "one"), ("m2", "two")])
}

/// A chat on a quick server that is being woken, with the messages it sent itself.
fn chat_that_sent(fake: &Fake, sent: &[(&str, &str)]) -> (Arc<Server>, Arc<OpenChat>, Seen) {
    let server = quick_server_on(fake, 8);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 1, sink);
    mine(&chat, sent);
    let w = Arc::clone(&server);
    std::thread::spawn(move || {
        let _ = w.wake();
    });
    (server, chat, seen)
}

// (d) Review 4 item 2: the stream is lost while m2 waits, and OpenCode still lists m2 as waiting when
// the stream is back: m2 is not answered, whatever the last idle message says.
#[test]
fn a_message_still_waiting_after_a_lost_stream_is_not_answered() {
    let fake = gap_fake(m1_running_m2_waiting(), Vec::new(), after_gap(false, &["m2"], &["m1"], IDLE_OK));
    let (server, chat, seen) = chat_on(&fake);
    wait_until("the waiting list is read after the gap", Duration::from_secs(5), || fake.count("GET", &format!("/api/session/{SES}/inbox")) >= 1);
    wait_until("the unseen run is known to be over", Duration::from_secs(5), || !chat.lock().tr.orphaned());
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(subtypes(&results_seen(&seen)), ["connection_lost"], "only m1's lost turn is ended");
    assert!(chat.busy(), "m2 still waits");
    server.shutdown();
}

// (e) The stream is lost and m2 ran to its end in the gap: m2 gets exactly one result.
#[test]
fn a_message_run_in_the_gap_gets_exactly_one_result() {
    let fake = gap_fake(m1_running_m2_waiting(), Vec::new(), after_gap(false, &[], &["m1", "m2"], IDLE_OK));
    let (server, chat, seen) = chat_on(&fake);
    wait_until("a result for m1 and one for m2", Duration::from_secs(5), || results_seen(&seen).len() == 2);
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(subtypes(&results_seen(&seen)), ["connection_lost", "success"]);
    let kinds = kinds_of(&seen, "c1");
    assert_eq!(kinds[kinds.len() - 2..], ["user", "result"], "m2's waiting row is confirmed, then ended: {kinds:?}");
    assert!(!chat.busy());
    assert_eq!(fake.count("GET", &format!("/api/session/{SES}/message/m2")), 1, "OpenCode is asked whether it has m2 as a message");
    server.shutdown();
}

// (e) again, with the run that took m2 up still going: it is followed from here, and ends as m2's turn.
#[test]
fn a_message_taken_up_in_the_gap_is_followed_to_its_end() {
    let later = vec![(Duration::from_millis(1000), frame("session.text.ended", json!({ "assistantMessageID": "a2", "ordinal": 0, "text": "two done" }))), (Duration::ZERO, frame("session.execution.succeeded", json!({})))];
    let fake = gap_fake(m1_running_m2_waiting(), later, after_gap(true, &[], &["m1", "m2"], NO_IDLE));
    let (server, chat, seen) = chat_on(&fake);
    wait_until("a result for m1 and one for m2", Duration::from_secs(5), || results_seen(&seen).len() == 2);
    let kinds = kinds_of(&seen, "c1");
    assert_eq!(kinds[kinds.len() - 3..], ["user", "assistant", "result"], "m2's reply is shown: {kinds:?}");
    assert_eq!(results_seen(&seen)[1].result.as_deref(), Some("two done"));
    assert!(!chat.busy());
    server.shutdown();
}

// (f) The run ended in the gap with a shutdown interrupt, which writes no idle message: the session
// is not running, so the unseen run is no longer waited for.
#[test]
fn a_run_ended_by_a_shutdown_in_the_gap_is_not_waited_for() {
    let first = m1_running_m2_waiting()[..3].to_vec();
    let fake = gap_fake(first, Vec::new(), after_gap(false, &[], &["m1"], NO_IDLE));
    let (server, chat, seen) = chat_that_sent(&fake, &[("m1", "one")]);
    wait_until("the lost turn is ended on the page", Duration::from_secs(5), || results_seen(&seen).len() == 1);
    wait_until("the unseen run is known to be over", Duration::from_secs(5), || !chat.lock().tr.orphaned());
    assert_eq!(results_seen(&seen).len(), 1);
    assert!(!chat.busy());
    server.shutdown();
}

// A message OpenCode neither lists as waiting nor has as a message was cancelled in the gap.
#[test]
fn a_message_cancelled_in_the_gap_is_told_cancelled() {
    let fake = gap_fake(m1_running_m2_waiting(), Vec::new(), after_gap(false, &[], &["m1"], IDLE_OK));
    let (server, chat, seen) = chat_on(&fake);
    wait_until("a result for m1 and one for m2", Duration::from_secs(5), || results_seen(&seen).len() == 2);
    assert_eq!(subtypes(&results_seen(&seen)), ["connection_lost", "cancelled"]);
    assert_eq!(fake.count("GET", &format!("/api/session/{SES}/message/m2")), 1);
    assert!(!chat.busy());
    server.shutdown();
}

// OpenCode gives no answer about the gap: nothing is guessed.
#[test]
fn a_gap_opencode_does_not_explain_answers_nothing() {
    let fake = gap_fake(m1_running_m2_waiting(), Vec::new(), |p: &str| {
        if p == "/api/session/active" {
            Some(Reply::Json(500, "{}".to_string()))
        } else if p.contains("/message?") {
            Some(Reply::Json(200, IDLE_OK.to_string()))
        } else {
            None
        }
    });
    let (server, chat, seen) = chat_on(&fake);
    wait_until("OpenCode is asked", Duration::from_secs(5), || fake.count("GET", "/api/session/active") >= 1);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(results_seen(&seen).len(), 1, "only m1's lost turn");
    assert!(chat.busy() && chat.lock().tr.orphaned());
    server.shutdown();
}

// Review 4 item 7: Stop in a chat that shows nothing running and sent nothing leaves the session alone
// (it may be running in another pane).
#[test]
fn stop_with_nothing_sent_does_not_interrupt_the_session() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    assert_eq!(chat.stop(), Some(StopHow::Ended));
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0);
    assert_eq!(kinds_of(&seen, "c1"), ["stopped"]);
    server.shutdown();
}

// Item 7, the other half: a message on its way to OpenCode, not heard as queued yet, is still stopped.
#[test]
fn stop_while_a_message_is_on_its_way_asks_opencode_to_stop() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(700), "{\"data\":{\"id\":\"msg_1\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    let c = Arc::clone(&chat);
    let sending = std::thread::spawn(move || c.send("hi", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    // Review 7 P3-4: a Stop that posts the interrupt ends like any Stop that did, not as one with
    // nothing of its own to stop. No run is known, so there is nothing to wait for.
    assert_eq!(chat.stop(), Some(StopHow::Interrupt));
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 1);
    assert_eq!(kinds_of(&seen, "c1"), ["stopped"]);
    sending.join().unwrap().unwrap();
    server.shutdown();
}

// A Stop takes back the messages still waiting: OpenCode is asked to cancel each, and only its own
// word (`session.inbox.cancelled`) ends one as "cancelled".
#[test]
fn a_stop_asks_opencode_to_cancel_the_waiting_messages() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one"), ("m2", "two")]);
    for (k, d) in [queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two")] {
        chat.heard(&k, &d);
    }
    assert_eq!(chat.stop(), Some(StopHow::Ended));
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m2")), 1);
    assert_eq!(subtypes(&results_seen(&seen)), ["error_during_execution"], "m2 is not ended on a guess");
    assert!(chat.busy());
    let (k, d) = ev("session.inbox.cancelled", json!({ "inboxID": "m2" }));
    chat.heard(&k, &d);
    assert_eq!(subtypes(&results_seen(&seen)), ["error_during_execution", "cancelled"]);
    assert!(!chat.busy());
    server.shutdown();
}

// A message OpenCode accepted is known as waiting from its answer, before its queueing is heard.
#[test]
fn a_sent_message_waits_from_opencodes_own_answer() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Json(200, "{\"data\":{\"id\":\"msg_1\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    chat.send("hi", &[]).unwrap();
    assert!(chat.busy(), "the message waits in OpenCode");
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "msg_1" })), ev("session.execution.succeeded", json!({}))] {
        chat.heard(&k, &d);
    }
    assert_eq!(kinds_of(&seen, "c1"), ["user", "result"]);
    assert!(!chat.busy());
    server.shutdown();
}

/// A chat with a model pick made while the server slept, and the stand-in's server then up.
fn chat_with_a_waiting_pick(fake: &Fake) -> (Arc<Server>, Arc<OpenChat>, Seen) {
    let (server, _) = server_on(fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, Some(json!({ "id": "old", "providerID": "opencode" })), 0, sink);
    let mut pick = spec(Vec::new());
    pick.model = Some("opencode/first".to_string());
    chat.retarget(pick).unwrap();
    server.wake().unwrap();
    (server, chat, seen)
}

fn waiting_pick(chat: &OpenChat) -> Option<String> {
    chat.lock().pending_model.as_ref().and_then(|m| m.get("id")).and_then(Value::as_str).map(str::to_string)
}

// Review 4 item 3: a pick that fails to post does not lose the pick that was waiting before it.
#[test]
fn a_failed_model_switch_keeps_the_pick_that_was_waiting() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(503, "{}".to_string()) } else { plain(m, p) });
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    let mut next = spec(Vec::new());
    next.model = Some("opencode/second".to_string());
    assert!(chat.retarget(next).is_err());
    assert_eq!(waiting_pick(&chat).as_deref(), Some("first"), "the earlier pick still waits for the next message");
    assert_eq!(chat.lock().spec.model.as_deref(), Some("opencode/first"));
    server.shutdown();
}

// Item 3, the other half: a pick that is applied replaces the one that was waiting.
#[test]
fn an_applied_model_switch_replaces_the_pick_that_was_waiting() {
    let fake = fake(plain);
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    let mut next = spec(Vec::new());
    next.model = Some("opencode/second".to_string());
    chat.retarget(next).unwrap();
    assert_eq!(waiting_pick(&chat), None);
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/model")), 1);
    server.shutdown();
}

// Review 4 item 4: a server error on a model pick is "no answer", not a refusal: the pick stays.
#[test]
fn a_server_error_on_a_model_pick_is_not_a_refusal() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(500, "{\"message\":\"boom\"}".to_string()) } else { plain(m, p) });
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    let e = chat.send("hi", &[]).unwrap_err();
    assert!(e.contains("Send again to retry"), "{e}");
    assert_eq!(waiting_pick(&chat).as_deref(), Some("first"), "the pick is tried again with the next message");
    assert!(!fake.any("/prompt"));
    server.shutdown();
}

// Review 4 item 4: a refused pick whose re-read fails does not wipe the chat's model. What the session
// is on is not known, so the pick stays waiting instead of a guess being shown.
#[test]
fn a_refused_pick_whose_reread_fails_keeps_the_chats_model() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(400, "{\"message\":\"no such model\"}".to_string()) } else if m == "GET" && p == format!("/api/session/{SES}") { Reply::Json(500, "{}".to_string()) } else { plain(m, p) });
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    assert!(chat.send("hi", &[]).is_err());
    assert!(chat.lock().model.is_some(), "the model is only replaced by one OpenCode names");
    assert!(chat.lock().spec.model.is_some());
    assert!(!fake.any("/prompt"));
    server.shutdown();
}

// Review 4 item 6: an answer about the gap that arrives after the chat closed is not sent to the page.
#[test]
fn a_gap_answer_for_a_closed_chat_is_not_sent() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    mine(&chat, &[("m1", "one")]);
    let (k, d) = queued("m1", "one");
    chat.heard(&k, &d);
    chat.lock().closed = true;
    chat.reconciled(&Gap { active: false, fates: vec![("m1".to_string(), Fate::Gone)], failed: false, ends_at_ask: 0 });
    assert!(kinds_of(&seen, "c1").is_empty(), "nothing after the close");
    assert!(chat.busy(), "and nothing was settled for it");
}

// A message heard on the stream while OpenCode was being asked is left to the stream: no second result.
#[test]
fn a_gap_answer_does_not_repeat_what_the_stream_said() {
    let mut tr = Translator::new(SES);
    fed(&mut tr, &[queued("m2", "two"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" }))]);
    let out = tr.reconcile(&Gap { active: false, fates: vec![("m2".to_string(), Fate::Taken)], failed: false, ends_at_ask: 0 }, Instant::now());
    assert!(out.is_empty(), "{out:?}");
    assert_eq!(results_of(&fed(&mut tr, &[ev("session.execution.succeeded", json!({}))])).len(), 1);
}

// A message whose run went unseen and ended badly is told so, once.
#[test]
fn a_message_whose_unseen_run_failed_gets_one_error_result() {
    let mut tr = Translator::new(SES);
    fed(&mut tr, &[queued("m2", "two")]);
    let out = tr.reconcile(&Gap { active: false, fates: vec![("m2".to_string(), Fate::Taken)], failed: true, ends_at_ask: 0 }, Instant::now());
    assert_eq!(kinds_in(&out), ["user", "result"]);
    assert_eq!(subtypes(&results_of(&out)), ["error_during_execution"]);
    assert!(!tr.busy());
}

// The answer to a `prompt` call can come after the stream already said the message was taken up.
#[test]
fn a_late_prompt_answer_does_not_set_a_taken_message_waiting_again() {
    let mut tr = Translator::new(SES);
    fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), ev("session.execution.succeeded", json!({}))]);
    tr.admit("m1", "one");
    assert!(!tr.busy());
}

// ---- Review 5 ----

// P2-1: one session open in two chats. Only the chat that sent a message owns it: the other chat's
// Stop and close leave the run and the waiting message alone, and it gets no result for them.
#[test]
fn a_stop_in_one_chat_leaves_the_other_chats_run_and_waiting_message_alone() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let a = OpenChat::attach(&server, "a", spec(Vec::new()), SES, None, gen, Arc::clone(&sink));
    let b = OpenChat::attach(&server, "b", spec(Vec::new()), SES, None, gen, sink);
    // A sent both messages: OpenCode's answers to A's `prompt` calls named them.
    mine(&a, &[("m1", "one"), ("m2", "two")]);
    let both = |e: (String, Value)| {
        a.heard(&e.0, &e.1);
        b.heard(&e.0, &e.1);
    };
    for e in [queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two")] {
        both(e);
    }
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0, "A's run is not interrupted");
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m2")), 0, "A's waiting message is not cancelled");
    assert_eq!(kinds_of(&seen, "b"), ["user", "stopped"], "B mirrors the message and hears its Stop, with no result");
    assert!(a.lock().tr.running() && a.lock().tr.own_waiting() == ["m2"], "A's run and waiting message are as they were");
    both(ev("session.inbox.cancelled", json!({ "inboxID": "m2" })));
    assert_eq!(results_for(&seen, "a"), ["cancelled"], "the chat that sent m2 is told it was cancelled");
    assert!(results_for(&seen, "b").is_empty(), "the other chat is not");
    b.close();
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0, "closing B does not stop A's run either");
    // A's own Stop does stop it.
    assert!(a.stop().is_some());
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 1);
    server.shutdown();
}

// P2-1: the run's end gives each chat one result per message of its own, and the chat that only
// mirrored the run one result, which closes the turn its page drew.
#[test]
fn a_run_gives_each_chat_results_for_its_own_messages_only() {
    let (mut a, mut b) = (Translator::new(SES).own_only(), Translator::new(SES).own_only());
    a.admit("m1", "one");
    a.admit("m2", "two");
    let events = [queued("m1", "one"), queued("m2", "two"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.execution.succeeded", json!({}))];
    assert_eq!(kinds_in(&fed(&mut a, &events)), ["user", "user", "result", "result"]);
    assert!(!b.busy(), "a message another chat sent does not make this one busy");
    assert_eq!(kinds_in(&fed(&mut b, &events)), ["user", "user", "result"]);
    assert!(!a.busy() && !b.busy());
}

// P2-1: the stream can be ahead of the answer to the `prompt` call. The message is still this chat's.
#[test]
fn a_message_delivered_before_its_prompt_answer_is_still_the_chats_own() {
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[queued("m1", "one"), queued("m2", "two"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), ev("session.inbox.delivered", json!({ "inboxID": "m2" }))]);
    assert!(!tr.engaged(), "nothing of this chat yet");
    tr.admit("m1", "one");
    tr.admit("m2", "two");
    assert!(tr.engaged());
    assert_eq!(kinds_in(&fed(&mut tr, &[ev("session.execution.succeeded", json!({}))])), ["result", "result"]);
}

// P2-2: OpenCode said "running" and "m2 was taken up", and that run's end is heard before the answer
// is applied. The answer is old news: m2 gets its one result, and the chat is not left busy.
#[test]
fn a_run_end_heard_while_opencode_was_asked_gives_one_result_and_leaves_the_chat_idle() {
    let mut tr = Translator::new(SES);
    let now = Instant::now();
    fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two")]);
    tr.lost(Vec::new(), now);
    let asked = tr.ends();
    assert!(fed(&mut tr, &[ev("session.execution.succeeded", json!({}))]).is_empty(), "the unseen run's end");
    let out = tr.reconcile(&Gap { active: true, fates: vec![("m2".to_string(), Fate::Taken)], failed: false, ends_at_ask: asked }, now);
    assert_eq!(kinds_in(&out), ["user", "result"]);
    assert!(!tr.running() && !tr.busy(), "no turn is left running with no end to come");
}

// P3-1: OpenCode's reads were ahead of the stream. m2 got its result from the reads; the stream then
// replays the run that took it up, and that run adds nothing.
#[test]
fn a_run_replayed_after_its_message_was_answered_adds_no_second_result() {
    let mut tr = Translator::new(SES);
    let now = Instant::now();
    fed(&mut tr, &[queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), queued("m2", "two")]);
    tr.lost(Vec::new(), now);
    let out = tr.reconcile(&Gap { active: false, fates: vec![("m2".to_string(), Fate::Taken)], failed: false, ends_at_ask: tr.ends() }, now);
    assert_eq!(subtypes(&results_of(&out)), ["success"]);
    let late = fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m2" })), ev("session.text.delta", json!({ "assistantMessageID": "a2", "ordinal": 0, "delta": "late" })), ev("session.execution.succeeded", json!({}))]);
    assert!(late.is_empty(), "the replayed run adds nothing: {:?}", kinds_in(&late));
    assert!(!tr.busy() && !tr.orphaned());
    // The next message runs as usual.
    assert_eq!(kinds_in(&fed(&mut tr, &[queued("m3", "three"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m3" })), ev("session.execution.succeeded", json!({}))])), ["user", "result"]);
}

// P3-6: a chat closed while an answer about the gap is being sent hears nothing after its `exit`.
#[test]
fn nothing_follows_the_exit_of_a_chat_closed_during_a_gap_answer() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let seen: Seen = Arc::default();
    let (tx, rx) = mpsc::channel::<()>();
    let (s, first) = (Arc::clone(&seen), Mutex::new(Some(tx)));
    // The first event sent tells the closer to go, and takes a while to send.
    let sink: Sink = Arc::new(move |id: &str, ev: &ChatEvent| {
        s.lock().unwrap().push((id.to_string(), ev.clone()));
        if let Some(tx) = first.lock().unwrap().take() {
            let _ = tx.send(());
            std::thread::sleep(Duration::from_millis(300));
        }
    });
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one"), ("m2", "two")]);
    let c = Arc::clone(&chat);
    let closing = std::thread::spawn(move || {
        rx.recv().unwrap();
        c.close();
    });
    chat.reconciled(&Gap { active: false, fates: vec![("m1".to_string(), Fate::Gone), ("m2".to_string(), Fate::Gone)], failed: false, ends_at_ask: 0 });
    closing.join().unwrap();
    assert_eq!(kinds_of(&seen, "c1"), ["result", "result", "exit"], "the exit is the last thing the page hears");
    server.shutdown();
}

// P3-6: the same for a Stop that gave up waiting.
#[test]
fn a_stop_that_ends_after_the_chat_closed_sends_nothing_after_the_exit() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one")]);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))] {
        chat.heard(&k, &d);
    }
    let c = Arc::clone(&chat);
    let stopping = std::thread::spawn(move || c.stop());
    wait_until("the stop asked OpenCode", Duration::from_secs(5), || fake.any(&format!("/api/session/{SES}/interrupt")));
    chat.close();
    stopping.join().unwrap();
    assert_eq!(kinds_of(&seen, "c1").last().map(String::as_str), Some("exit"), "{:?}", kinds_of(&seen, "c1"));
    server.shutdown();
}

// P3-2: the server went away while m2 waited. The next server is asked what became of it; here it
// has it nowhere, so it is told cancelled instead of waiting forever.
#[test]
fn a_new_server_is_asked_about_a_message_that_waited_when_the_old_one_went() {
    let state = after_gap(false, &[], &[], IDLE_OK);
    let fake = fake(move |m: &str, p: &str| {
        if m == "GET" {
            if let Some(r) = state(p) {
                return r;
            }
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 0, sink);
    mine(&chat, &[("m2", "two")]);
    chat.server_gone(1, None, ExitReason::Sleep);
    assert!(chat.busy(), "m2 still waits as far as Kolux knows");
    server.wake().unwrap();
    wait_until("the new server answered for m2", Duration::from_secs(5), || !chat.busy());
    assert_eq!(subtypes(&results_seen(&seen)), ["cancelled"]);
    server.shutdown();
}

// P3-3: a committed revert removes waiting messages with no `inbox.cancelled`: OpenCode is asked.
#[test]
fn a_committed_revert_asks_opencode_about_the_waiting_messages() {
    let state = after_gap(false, &[], &[], IDLE_OK);
    let fake = fake(move |m: &str, p: &str| {
        if p == "/api/event" {
            return Reply::Stream(vec![(Duration::ZERO, CONNECTED.to_string()), (Duration::from_millis(300), frame("session.revert.committed", json!({ "to": "msg_x" })))]);
        }
        if m == "GET" {
            if let Some(r) = state(p) {
                return r;
            }
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, 1, sink);
    mine(&chat, &[("m2", "two")]);
    server.wake().unwrap();
    wait_until("OpenCode answered for m2 after the revert", Duration::from_secs(5), || !chat.busy());
    assert_eq!(subtypes(&results_seen(&seen)), ["cancelled"]);
    server.shutdown();
}

// P3-5: a resume pick that gets a server error is kept for the next message, and the page is told.
#[test]
fn a_resume_pick_that_gets_a_server_error_is_said_and_kept() {
    let fake = fake(|m: &str, p: &str| {
        if m == "POST" && p.ends_with("/model") {
            return Reply::Json(500, "{\"message\":\"boom\"}".to_string());
        }
        if m == "GET" && p == format!("/api/session/{SES}") {
            return Reply::Json(200, format!("{{\"data\":{{\"id\":\"{SES}\",\"model\":{{\"id\":\"real\",\"providerID\":\"opencode\"}}}}}}"));
        }
        plain(m, p)
    });
    let (server, _) = server_on(&fake);
    let (seen, sink) = sink();
    let mut pick = spec(Vec::new());
    pick.model = Some("opencode/next".to_string());
    let chat = OpenChat::open(&server, "c1", pick, Some(SES.to_string()), sink).expect("the chat opens");
    assert_eq!(waiting_pick(&chat).as_deref(), Some("next"), "the pick is tried again with the next message");
    assert!(kinds_of(&seen, "c1").contains(&"stderr".to_string()), "the page is told the chat is not on the pick yet");
    server.shutdown();
}

// ---- Review 6 ----

/// Two chats on one session of a running stand-in server, with one sink for both.
fn two_chats(fake: &Fake) -> (Arc<Server>, Arc<OpenChat>, Arc<OpenChat>, Seen) {
    let (server, _) = server_on(fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let a = OpenChat::attach(&server, "a", spec(Vec::new()), SES, None, gen, Arc::clone(&sink));
    let b = OpenChat::attach(&server, "b", spec(Vec::new()), SES, None, gen, sink);
    (server, a, b, seen)
}

fn both(a: &Arc<OpenChat>, b: &Arc<OpenChat>, events: &[(String, Value)]) {
    for (k, d) in events {
        a.heard(k, d);
        b.heard(k, d);
    }
}

/// The page's count of open turns (`stillWaiting` in src/chat/live/events.ts) after the events `chat`
/// was sent from `skip` on, starting at `count`. A send adds 1 on the page itself.
fn page_count(seen: &Seen, chat: &str, skip: usize, mut count: u32) -> u32 {
    for (_, e) in seen.lock().unwrap().iter().filter(|(c, _)| c == chat).skip(skip) {
        match e {
            ChatEvent::Result(_) => count = count.saturating_sub(1),
            ChatEvent::Stopped { .. } | ChatEvent::Exit { .. } => count = 0,
            ChatEvent::Assistant { parent_tool_use_id: None, .. } if count == 0 => count = 1,
            _ => {}
        }
    }
    count
}

fn sent_to(seen: &Seen, chat: &str) -> usize {
    seen.lock().unwrap().iter().filter(|(c, _)| c == chat).count()
}

// P1-1: B's page drew A's run as a turn (0 to 1), then B sent a message (2) that the same run took
// up. The run's end gives B one result for the drawn turn and one for its message.
#[test]
fn a_message_steered_into_a_mirrored_run_gets_a_result_beside_the_drawn_turns() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" })), said("a1", "hi")]);
    let drawn = page_count(&seen, "b", 0, 0);
    assert_eq!(drawn, 1, "B's page drew the mirrored turn");
    let at = sent_to(&seen, "b");
    // B sends: its page counts 2.
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two"), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success", "success"], "the drawn turn and B's own message");
    assert_eq!(page_count(&seen, "b", at, drawn + 1), 0, "B's page is idle");
    assert_eq!(results_for(&seen, "a"), ["success"], "A sent one message");
    assert!(!b.busy());
    server.shutdown();
}

// P1-1, the other end: the drawn turn's result is not kept back for a message the run did not take up.
#[test]
fn a_message_sent_into_a_drawn_run_that_does_not_take_it_waits_for_its_own_run() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" })), said("a1", "hi")]);
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success"], "the drawn turn is closed; m_b still waits");
    assert!(b.busy());
    both(&a, &b, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), said("a2", "two done"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success", "success"]);
    assert_eq!(results_for(&seen, "a"), ["success", "success"], "A draws B's run from 0 and gets its one result");
    server.shutdown();
}

// P2-1: B sent before the first mirrored reply, so its page counts 1 for its own message and draws
// no turn for A's run. A's run does not take the message up: its end gives B no result (one would be
// taken for the message's). The message's own run gives exactly one.
#[test]
fn a_mirrored_run_that_passes_over_a_waiting_message_gives_its_chat_no_result() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two"), said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
    assert!(results_for(&seen, "b").is_empty(), "A's run is not B's message's run: {:?}", kinds_of(&seen, "b"));
    assert_eq!(page_count(&seen, "b", 0, 1), 1, "B's page still waits for its message");
    assert!(b.busy());
    both(&a, &b, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), said("a2", "two done"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success"], "exactly one result, from the message's own run");
    assert_eq!(page_count(&seen, "b", 0, 1), 0);
    server.shutdown();
}

// P2-1 while the message is still on its way: the `prompt` call has no answer yet when the mirrored
// run draws and ends. The page already counts the message, so the run's end gives no result.
#[test]
fn a_mirrored_run_that_ends_while_a_message_is_on_its_way_gives_no_result() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(500), "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    both(&a, &b, &[said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
    assert!(results_for(&seen, "b").is_empty(), "{:?}", kinds_of(&seen, "b"));
    sending.join().unwrap().unwrap();
    assert!(b.busy(), "the message waits from OpenCode's answer");
    both(&a, &b, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success"]);
    server.shutdown();
}

// A run with nothing of B's in it: B's page drew it from 0, and its end gives B exactly one result.
#[test]
fn a_plain_mirrored_run_gives_exactly_one_result() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one"), ("m_a2", "more")]);
    both(&a, &b, &[queued("m_a", "one"), queued("m_a2", "more"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" })), ev("session.inbox.delivered", json!({ "inboxID": "m_a2" })), said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success"]);
    assert_eq!(page_count(&seen, "b", 0, 0), 0);
    assert_eq!(results_for(&seen, "a"), ["success", "success"]);
    // The next mirrored run is drawn and closed the same way.
    mine(&a, &[("m_a3", "again")]);
    both(&a, &b, &[queued("m_a3", "again"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a3" })), said("a2", "yo"), ev("session.execution.interrupted", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success", "error_during_execution"], "the one result carries the run's outcome");
    server.shutdown();
}

// P2-2: B has only a message of its own waiting while A's run goes on. B's Stop takes its message
// back and leaves A's run alone: no interrupt, no wait, no cut turn. So does B's close.
#[test]
fn a_stop_with_only_a_waiting_message_takes_it_back_and_leaves_the_other_chats_run() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two")]);
    let began = Instant::now();
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert!(began.elapsed() < cfg().stop_grace, "nothing of B runs, so its Stop does not wait");
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0, "A's run is not interrupted");
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m_b")), 1, "B's waiting message is taken back");
    assert_eq!(kinds_of(&seen, "b"), ["user", "stopped"], "no cut turn: A's run is still mirrored");
    assert!(!b.lock().tr.orphaned() && a.lock().tr.running());
    both(&a, &b, &[said("a1", "hi")]);
    assert_eq!(kinds_of(&seen, "b"), ["user", "stopped", "assistant"], "the run's reply is still shown in B");
    b.close();
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0, "closing B with its message still waiting does not stop A's run");
    assert!(a.stop().is_some());
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 1, "A's own Stop does");
    server.shutdown();
}

// A Stop that leaves the other chat's run going sets the page's count to 0, so the turn the page drew
// is no longer owed a result: one would be taken for a message sent after the Stop.
#[test]
fn a_stop_in_a_drawn_run_leaves_no_result_owed_for_the_drawn_turn() {
    let fake = fake(plain);
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" })), said("a1", "hi")]);
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(page_count(&seen, "b", 0, 0), 0, "the Stop set B's page to 0");
    let at = sent_to(&seen, "b");
    // B sends: its page counts 1. The run ends without taking the message up.
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two"), ev("session.execution.succeeded", json!({}))]);
    assert!(results_for(&seen, "b").is_empty(), "{:?}", kinds_of(&seen, "b"));
    assert_eq!(page_count(&seen, "b", at, 1), 1, "B's page still waits for its message");
    assert_eq!(fake.count("POST", &format!("/api/session/{SES}/interrupt")), 0);
    server.shutdown();
}

// The answer to a `prompt` call comes after the message's whole run: it was taken up and its run
// ended as nobody's. The answer gives the chat that sent it its one result.
#[test]
fn a_message_whose_run_ended_before_its_prompt_answer_gets_its_result() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(500), "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    both(&a, &b, &[queued("m_b", "two"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
    assert!(results_for(&seen, "b").is_empty(), "not known as B's yet: {:?}", kinds_of(&seen, "b"));
    sending.join().unwrap().unwrap();
    assert_eq!(results_for(&seen, "b"), ["success"]);
    assert_eq!(page_count(&seen, "b", 0, 1), 0);
    assert_eq!(results_for(&seen, "a"), ["success"], "A drew the run from 0");
    assert!(!b.busy());
    server.shutdown();
}

// P3-1: a chat opened in the middle of a run never heard it start. It drew the reply, so the run's
// end still gives it one result.
#[test]
fn a_chat_opened_in_the_middle_of_a_run_gets_the_runs_result() {
    for mut tr in [Translator::new(SES).own_only(), Translator::new(SES)] {
        let out = fed(&mut tr, &[said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
        assert_eq!(kinds_in(&out), ["assistant", "result"]);
        assert!(!tr.busy());
        // A run's end with nothing shown still adds nothing.
        assert!(fed(&mut tr, &[ev("session.execution.succeeded", json!({}))]).is_empty());
    }
}

// P3-4: a run's end is sent under the chat's lock, so a close that comes while it is being sent waits,
// and its `exit` is the last thing the page hears.
#[test]
fn nothing_follows_the_exit_of_a_chat_closed_while_a_runs_end_is_sent() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let seen: Seen = Arc::default();
    let (tx, rx) = mpsc::channel::<()>();
    let (s, first) = (Arc::clone(&seen), Mutex::new(Some(tx)));
    // The first result sent tells the closer to go, and takes a while to send.
    let sink: Sink = Arc::new(move |id: &str, ev: &ChatEvent| {
        s.lock().unwrap().push((id.to_string(), ev.clone()));
        if matches!(ev, ChatEvent::Result(_)) {
            if let Some(tx) = first.lock().unwrap().take() {
                let _ = tx.send(());
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    });
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one"), ("m2", "two")]);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), ev("session.inbox.delivered", json!({ "inboxID": "m2" }))] {
        chat.heard(&k, &d);
    }
    let c = Arc::clone(&chat);
    let closing = std::thread::spawn(move || {
        rx.recv().unwrap();
        c.close();
    });
    let (k, d) = ev("session.execution.succeeded", json!({}));
    chat.heard(&k, &d);
    closing.join().unwrap();
    assert_eq!(kinds_of(&seen, "c1"), ["user", "user", "result", "result", "exit"], "the exit is the last thing the page hears");
    server.shutdown();
}

// P3-4: every event a chat sends on its own (a stream event, a line from Kolux, a lost stream, the
// server going away) is sent with the chat's lock held, which is what keeps it from following a
// close's `exit`. A closed chat sends nothing.
#[test]
fn a_chats_events_are_sent_under_its_lock_and_never_after_it_closed() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let held: Arc<Mutex<Vec<(String, bool)>>> = Arc::default();
    let slot: Arc<Mutex<Option<Arc<OpenChat>>>> = Arc::default();
    let (h, sl) = (Arc::clone(&held), Arc::clone(&slot));
    let sink: Sink = Arc::new(move |_: &str, ev: &ChatEvent| {
        let locked = sl.lock().unwrap().as_ref().is_some_and(|c| c.inner.try_lock().is_err());
        h.lock().unwrap().push((serde_json::to_value(ev).unwrap()["kind"].as_str().unwrap_or_default().to_string(), locked));
    });
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    *slot.lock().unwrap() = Some(Arc::clone(&chat));
    mine(&chat, &[("m1", "one")]);
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), said("a1", "hi")] {
        chat.heard(&k, &d);
    }
    chat.say("a line");
    chat.stream_lost();
    chat.server_gone(1, None, ExitReason::Sleep);
    let seen = held.lock().unwrap().clone();
    assert_eq!(seen.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["user", "assistant", "stderr", "result", "exit"]);
    assert!(seen.iter().all(|(_, locked)| *locked), "each one is sent with the chat's lock held: {seen:?}");
    // Closed: nothing more is sent.
    chat.lock().closed = true;
    let (k, d) = said("a2", "late");
    chat.heard(&k, &d);
    chat.say("late");
    chat.stream_lost();
    chat.server_gone(1, None, ExitReason::Sleep);
    assert_eq!(held.lock().unwrap().len(), seen.len());
    slot.lock().unwrap().take();
    server.shutdown();
}

// P3-2: a `prompt` call that got no answer makes a message heard queued soon after this chat's own
// only when it carries the text that was sent. Another chat's message heard first is not taken, and
// does not use the claim up.
#[test]
fn an_unanswered_send_claims_only_the_message_with_its_text() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Json(500, "{}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    assert!(b.send("mine", &[]).is_err(), "the call got no answer");
    both(&a, &b, &[queued("x1", "another chat's")]);
    assert!(b.lock().tr.own_waiting().is_empty(), "a message with another text is not B's");
    both(&a, &b, &[queued("x2", "mine")]);
    assert_eq!(b.lock().tr.own_waiting(), ["x2"], "the message with the sent text is");
    both(&a, &b, &[queued("x3", "mine")]);
    assert_eq!(b.lock().tr.own_waiting(), ["x2"], "one send claims one message");
    assert!(a.lock().tr.own_waiting().is_empty());
    both(&a, &b, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "x2" })), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(results_for(&seen, "b"), ["success"]);
    server.shutdown();
}

// P3-5a: OpenCode cancelled a message before the answer to its `prompt` call was applied, so nobody
// was told. The answer then gives the chat that sent it its "cancelled" result.
#[test]
fn a_message_cancelled_before_its_prompt_answer_is_told_cancelled() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(500), "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    both(&a, &b, &[queued("m_b", "two"), ev("session.inbox.cancelled", json!({ "inboxID": "m_b" }))]);
    assert!(results_for(&seen, "b").is_empty(), "not known as B's yet");
    sending.join().unwrap().unwrap();
    assert_eq!(results_for(&seen, "b"), ["cancelled"]);
    assert!(results_for(&seen, "a").is_empty(), "the other chat is told nothing");
    assert!(!b.busy());
    server.shutdown();
}

// ---- Review 7 ----

/// B opened in the middle of A's run: it never heard the run start, and has shown one of its replies.
fn opened_mid_run(fake: &Fake) -> (Arc<Server>, Arc<OpenChat>, Arc<OpenChat>, Seen) {
    let (server, a, b, seen) = two_chats(fake);
    mine(&a, &[("m_a", "one")]);
    for (k, d) in [queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))] {
        a.heard(&k, &d);
    }
    both(&a, &b, &[ev("session.step.started", json!({ "assistantMessageID": "a1" })), said("a1", "hi")]);
    (server, a, b, seen)
}

fn interrupts(fake: &Fake) -> usize {
    fake.count("POST", &format!("/api/session/{SES}/interrupt"))
}

// P2-1: a chat opened in the middle of another pane's run knows a run is going on from the run's own
// activity. A message of its own waiting behind that run is then no reason to interrupt: its Stop
// takes the message back and leaves the run alone.
#[test]
fn a_stop_in_a_chat_opened_mid_run_leaves_the_other_chats_run_alone() {
    let fake = fake(plain);
    let (server, a, b, seen) = opened_mid_run(&fake);
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two")]);
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(interrupts(&fake), 0, "A's run is not interrupted");
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m_b")), 1, "B's waiting message is taken back");
    assert_eq!(kinds_of(&seen, "b"), ["assistant", "stopped"]);
    assert_eq!(page_count(&seen, "b", 0, 0), 0);
    assert!(a.lock().tr.running() && !b.lock().tr.orphaned(), "the run goes on, mirrored in B");
    assert!(a.stop().is_some());
    assert_eq!(interrupts(&fake), 1, "A's own Stop does interrupt it");
    server.shutdown();
}

// P2-1, the close: closing that chat leaves the other pane's run alone too.
#[test]
fn closing_a_chat_opened_mid_run_leaves_the_other_chats_run_alone() {
    let fake = fake(plain);
    let (server, a, b, seen) = opened_mid_run(&fake);
    mine(&b, &[("m_b", "two")]);
    both(&a, &b, &[queued("m_b", "two")]);
    b.close();
    assert_eq!(interrupts(&fake), 0, "A's run is not interrupted");
    assert_eq!(kinds_of(&seen, "b"), ["assistant", "exit"]);
    a.close();
    assert_eq!(interrupts(&fake), 1, "closing A, whose run it is, does interrupt it");
    server.shutdown();
}

// P2-1: any event that starts or carries on a piece of a run's work says a run is going on, whichever
// is heard first (review 8 P3-2: not one that ends a piece; see
// `a_stray_event_after_a_runs_end_starts_no_run`). With none heard, a waiting message of the chat's own
// is still a reason to interrupt (its run may be starting unheard).
#[test]
fn a_run_never_heard_starting_is_known_from_its_own_activity() {
    let heard = [
        ev("session.step.started", json!({ "assistantMessageID": "a1" })),
        ev("session.text.started", json!({ "assistantMessageID": "a1", "ordinal": 0 })),
        ev("session.text.delta", json!({ "assistantMessageID": "a1", "ordinal": 0, "delta": "hi" })),
        ev("session.reasoning.started", json!({ "assistantMessageID": "a1", "ordinal": 0 })),
        ev("session.reasoning.delta", json!({ "assistantMessageID": "a1", "ordinal": 0, "delta": "hm" })),
        ev("session.tool.input.started", json!({ "assistantMessageID": "a1", "id": "t1", "name": "bash" })),
        ev("session.tool.input.delta", json!({ "assistantMessageID": "a1", "id": "t1", "delta": "{" })),
        ev("session.tool.called", json!({ "assistantMessageID": "a1", "id": "t1", "name": "bash", "input": {} })),
        ev("session.tool.progress", json!({ "id": "t1" })),
    ];
    for one in heard {
        let mut tr = Translator::new(SES).own_only();
        fed(&mut tr, std::slice::from_ref(&one));
        tr.admit("m_b", "two");
        assert!(tr.running(), "{} says a run is going on", one.0);
        assert!(!tr.runs_mine() && !tr.engaged(), "{}: the run is not this chat's to stop", one.0);
        assert_eq!(tr.own_waiting(), ["m_b"]);
    }
    // Another chat's message heard queued and then taken up: a run took it.
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[queued("m_a", "one"), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    tr.admit("m_b", "two");
    assert!(tr.running() && !tr.engaged());
    // Nothing heard: no run is known, so the chat's own waiting message keeps the interrupt.
    let mut tr = Translator::new(SES).own_only();
    tr.admit("m1", "one");
    assert!(!tr.running() && tr.engaged());
    // A message heard queued is not a run.
    fed(&mut tr, &[queued("m_a", "one")]);
    assert!(!tr.running() && tr.engaged());
}

// P2-1, the single pane: a Stop right after a send, before anything of its run is heard, still
// interrupts.
#[test]
fn a_stop_right_after_a_send_with_nothing_heard_still_interrupts() {
    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one")]);
    assert_eq!(chat.stop(), Some(StopHow::Interrupt));
    assert_eq!(interrupts(&fake), 1);
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m1")), 1);
    assert_eq!(kinds_of(&seen, "c1"), ["stopped"]);
    server.shutdown();
}

// P2-1: the run a chat opened into is cut like any other when the stream is lost: its late events are
// dropped, and its end adds no second result.
#[test]
fn a_run_a_chat_opened_into_is_dropped_after_a_lost_stream() {
    let fake = fake(plain);
    let (server, a, b, seen) = opened_mid_run(&fake);
    b.stream_lost();
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(interrupts(&fake), 0, "the cut run is A's: B's Stop leaves it alone");
    let at = sent_to(&seen, "b");
    both(&a, &b, &[said("a1", "more"), ev("session.execution.succeeded", json!({}))]);
    assert_eq!(sent_to(&seen, "b"), at, "nothing of the cut run is shown: {:?}", kinds_of(&seen, "b"));
    assert_eq!(results_for(&seen, "b"), ["connection_lost"]);
    server.shutdown();
}

// P3-4: while a run is known to be going on, a message of this chat still on its way to OpenCode is no
// reason to interrupt: the run is another pane's. The page still hears `stopped` at once.
#[test]
fn a_stop_while_a_message_is_on_its_way_leaves_a_run_going_on_alone() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(500), "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(interrupts(&fake), 0, "A's run is not interrupted");
    assert_eq!(kinds_of(&seen, "b"), ["user", "stopped"]);
    assert!(a.lock().tr.running() && b.lock().tr.running() && !b.lock().tr.orphaned(), "the run goes on, mirrored in B");
    sending.join().unwrap().unwrap();
    server.shutdown();
}

// P3-4: the same within the moment after a `prompt` call that ended with no answer.
#[test]
fn a_stop_after_an_unanswered_send_leaves_a_run_going_on_alone() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Json(500, "{}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    mine(&a, &[("m_a", "one")]);
    both(&a, &b, &[queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))]);
    assert!(b.send("two", &[]).is_err(), "the call got no answer");
    assert!(b.lock().tr.starting(Instant::now()));
    assert_eq!(b.stop(), Some(StopHow::Ended));
    assert_eq!(interrupts(&fake), 0, "A's run is not interrupted");
    assert_eq!(kinds_of(&seen, "b"), ["user", "stopped"]);
    // With no run known, the same Stop does interrupt: the message may be starting one unheard.
    both(&a, &b, &[ev("session.execution.succeeded", json!({}))]);
    assert!(b.send("three", &[]).is_err());
    assert_eq!(b.stop(), Some(StopHow::Interrupt));
    assert_eq!(interrupts(&fake), 1);
    server.shutdown();
}

// P3-1: a chat opened in the middle of a run drew its reply as a turn. A lost stream ends that turn on
// the page like any other, so it is not left waiting for a run whose end may be missed.
#[test]
fn a_lost_stream_ends_the_turn_a_chat_opened_mid_run_drew() {
    let fake = fake(plain);
    let (server, _a, b, seen) = opened_mid_run(&fake);
    assert_eq!(page_count(&seen, "b", 0, 0), 1, "B's page drew the turn");
    b.stream_lost();
    assert_eq!(results_for(&seen, "b"), ["connection_lost"]);
    assert_eq!(page_count(&seen, "b", 0, 0), 0);
    server.shutdown();
}

fn slow(wait: Duration, reply: Reply) -> Reply {
    std::thread::sleep(wait);
    reply
}

// P3-2: a send that finds its model pick refused tells the page so (`init`, `stderr`). A chat closed
// while OpenCode was being asked hears none of it after its `exit`.
#[test]
fn nothing_follows_the_exit_of_a_chat_closed_while_its_send_posts_a_model_pick() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { slow(Duration::from_millis(300), Reply::Json(400, "{\"message\":\"no such model\"}".to_string())) } else { plain(m, p) });
    let (server, chat, seen) = chat_with_a_waiting_pick(&fake);
    let c = Arc::clone(&chat);
    let sending = std::thread::spawn(move || c.send("hi", &[]));
    wait_until("the pick is being posted", Duration::from_secs(5), || fake.count("POST", &format!("/api/session/{SES}/model")) == 1);
    chat.close();
    assert!(sending.join().unwrap().is_err());
    assert_eq!(kinds_of(&seen, "c1"), ["init", "started", "exit"], "the exit is the last thing the page hears");
    server.shutdown();
}

// P3-2: the same for a model pick between turns, whose `init` comes after OpenCode's answer.
#[test]
fn nothing_follows_the_exit_of_a_chat_closed_while_a_model_pick_is_posted() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { slow(Duration::from_millis(300), Reply::Json(200, "{}".to_string())) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    let c = Arc::clone(&chat);
    let picking = std::thread::spawn(move || {
        let mut pick = spec(Vec::new());
        pick.model = Some("opencode/first".to_string());
        c.retarget(pick)
    });
    wait_until("the pick is being posted", Duration::from_secs(5), || fake.count("POST", &format!("/api/session/{SES}/model")) == 1);
    chat.close();
    picking.join().unwrap().unwrap();
    assert_eq!(kinds_of(&seen, "c1"), ["exit"], "the exit is the last thing the page hears");
    server.shutdown();
}

// P3-2: what a send and a model pick tell the page is sent with the chat's lock held, like everything
// else a chat sends once it is open.
#[test]
fn a_send_and_a_model_pick_tell_the_page_under_the_chats_lock() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(400, "{\"message\":\"no such model\"}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let held: Arc<Mutex<Vec<(String, bool)>>> = Arc::default();
    let slot: Arc<Mutex<Option<Arc<OpenChat>>>> = Arc::default();
    let (h, sl) = (Arc::clone(&held), Arc::clone(&slot));
    let sink: Sink = Arc::new(move |_: &str, ev: &ChatEvent| {
        let locked = sl.lock().unwrap().as_ref().is_some_and(|c| c.inner.try_lock().is_err());
        h.lock().unwrap().push((serde_json::to_value(ev).unwrap()["kind"].as_str().unwrap_or_default().to_string(), locked));
    });
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, Some(json!({ "id": "old", "providerID": "opencode" })), 0, sink);
    *slot.lock().unwrap() = Some(Arc::clone(&chat));
    let mut pick = spec(Vec::new());
    pick.model = Some("opencode/first".to_string());
    chat.retarget(pick).unwrap();
    server.wake().unwrap();
    assert!(chat.send("hi", &[]).is_err(), "the pick is refused");
    let seen = held.lock().unwrap().clone();
    assert_eq!(seen.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["init", "started", "init", "stderr"]);
    assert!(seen.iter().all(|(_, locked)| *locked), "each one is sent with the chat's lock held: {seen:?}");
    slot.lock().unwrap().take();
    server.shutdown();
}

// P3-3: a run took a message up before the answer to its `prompt` call, and its queueing was never
// heard (the stream missed it), so the delivery named a message nobody knew. The answer still gives
// the chat that sent it its one result.
#[test]
fn a_message_taken_up_unheard_before_its_prompt_answer_gets_its_result() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(500), "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, a, b, seen) = two_chats(&fake);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    both(&a, &b, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), said("a1", "hi"), ev("session.execution.succeeded", json!({}))]);
    assert!(results_for(&seen, "b").is_empty(), "not known as B's yet: {:?}", kinds_of(&seen, "b"));
    sending.join().unwrap().unwrap();
    assert_eq!(results_for(&seen, "b"), ["success"]);
    assert_eq!(page_count(&seen, "b", 0, 1), 0);
    assert!(!b.busy());
    server.shutdown();
}

// P3-3, the answer in the middle of the run: the run is the chat's own from there (its Stop may
// interrupt it), and its end gives the message's one result. A chat with no call on its way keeps
// nothing of a delivery it does not know.
#[test]
fn an_unheard_message_named_by_its_prompt_answer_mid_run_makes_the_run_the_chats_own() {
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))]);
    tr.sent();
    assert!(tr.admit("m1", "one").is_empty());
    assert!(tr.runs_mine() && tr.engaged(), "the run took up this chat's message");
    assert!(tr.own_waiting().is_empty(), "it is not set waiting again");
    assert_eq!(subtypes(&results_of(&fed(&mut tr, &[ev("session.execution.succeeded", json!({}))]))), ["success"]);
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" }))]);
    assert!(tr.foreign.is_empty() && tr.missed.is_empty());
}

// P3-5: the page counts a send from the moment it is made, so the chat does too: a reply of another
// pane's run mirrored while the send still wakes the server draws no turn of its own, and that run's
// end gives no result (it would be taken for the message's).
#[test]
fn a_reply_mirrored_while_a_send_wakes_the_server_draws_no_turn() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Json(200, "{\"data\":{\"id\":\"m_b\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (go, wait) = mpsc::channel::<()>();
    let (wait, waking) = (Mutex::new(wait), Arc::new(Mutex::new(false)));
    let (base, w) = (fake.base.clone(), Arc::clone(&waking));
    let start: Starter = Arc::new(move |_: &[(String, String)]| {
        *w.lock().unwrap() = true;
        let _ = wait.lock().unwrap().recv_timeout(Duration::from_secs(5));
        Ok(Up::fake(Api::local(&base, "pw")))
    });
    let server = Arc::new(Server::with_starter(cfg(), start));
    let (seen, sink) = sink();
    let b = OpenChat::attach(&server, "b", spec(Vec::new()), SES, None, 0, sink);
    let c = Arc::clone(&b);
    let sending = std::thread::spawn(move || c.send("two", &[]));
    wait_until("the send wakes the server", Duration::from_secs(5), || *waking.lock().unwrap());
    let (k, d) = said("a1", "hi");
    b.heard(&k, &d);
    assert!(!b.lock().tr.drawn, "the page already counts the message being sent");
    go.send(()).unwrap();
    sending.join().unwrap().unwrap();
    let (k, d) = ev("session.execution.succeeded", json!({}));
    b.heard(&k, &d);
    assert!(results_for(&seen, "b").is_empty(), "{:?}", kinds_of(&seen, "b"));
    assert_eq!(page_count(&seen, "b", 0, 1), 1, "B's page still waits for its message");
    for (k, d) in [ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_b" })), ev("session.execution.succeeded", json!({}))] {
        b.heard(&k, &d);
    }
    assert_eq!(results_for(&seen, "b"), ["success"]);
    assert_eq!(page_count(&seen, "b", 0, 1), 0);
    server.shutdown();
}

// P3-5: a send that ends before its `prompt` call (the model pick failed, the server did not start, the
// chat is closed) is no longer on its way: the page took that send back.
#[test]
fn a_send_that_ends_before_its_prompt_call_is_not_left_on_its_way() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { Reply::Json(500, "{\"message\":\"boom\"}".to_string()) } else { plain(m, p) });
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    assert!(chat.send("hi", &[]).is_err(), "the pick was not applied");
    assert!(!fake.any("/prompt"));
    assert_eq!(chat.lock().tr.outgoing, 0);
    server.close();
    assert!(chat.send("hi", &[]).is_err(), "a closing app starts no server");
    assert_eq!(chat.lock().tr.outgoing, 0);
    chat.close();
    assert!(chat.send("hi", &[]).is_err(), "the chat is closed");
    assert_eq!(chat.lock().tr.outgoing, 0);
}

// Review 8 P1-1: the stream can be ahead of the answer to a `prompt` call. A run that takes up a
// message while a call of this chat is on its way may be that call's message: until the answer says
// whose it is, the run counts as the chat's own for its Stop and its close.
#[test]
fn a_run_that_takes_up_a_message_while_this_chat_sends_may_be_its_own() {
    let started = || ev("session.execution.started", json!({}));
    let delivered = |id: &str| ev("session.inbox.delivered", json!({ "inboxID": id }));
    let ended = || ev("session.execution.succeeded", json!({}));
    // Heard queued, then taken up, all before the answer.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[queued("m1", "one"), started(), delivered("m1"), said("a1", "hi")]);
    assert!(tr.running() && tr.runs_mine() && tr.engaged(), "the run may be this chat's own");
    tr.sent();
    assert!(tr.admit("m1", "one").is_empty());
    assert!(tr.runs_mine(), "the answer named it: the run is this chat's own");
    assert_eq!(subtypes(&results_of(&fed(&mut tr, &[ended()]))), ["success"]);
    assert!(!tr.runs_mine() && !tr.engaged());
    // Never heard queued.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[started(), delivered("m1")]);
    assert!(tr.runs_mine() && tr.engaged());
    // The answer names another message: the one taken up was another chat's, and the run is too.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[queued("m_a", "one"), started(), delivered("m_a")]);
    assert!(tr.runs_mine());
    tr.sent();
    tr.admit("m_b", "two");
    assert!(tr.running() && !tr.runs_mine() && !tr.engaged(), "the run is another chat's");
    assert_eq!(tr.own_waiting(), ["m_b"]);
    // A call with no answer says nothing of whose it was: the run stays stoppable until it ends.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[started(), delivered("m1")]);
    tr.sent();
    tr.sent_unheard("one", Instant::now());
    assert!(tr.runs_mine());
    fed(&mut tr, &[ended()]);
    assert!(!tr.runs_mine() && !tr.engaged());
    // A message taken up before the send began is another chat's: nothing changes for that run.
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[queued("m_a", "one"), started(), delivered("m_a")]);
    tr.sending();
    assert!(tr.running() && !tr.runs_mine() && !tr.engaged());
    // The next run is nobody's again.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[started(), delivered("m_a"), ended(), started()]);
    assert!(tr.running() && !tr.runs_mine());
    // A send that ended before its `prompt` call sent nothing: the message taken up was not its own.
    let mut tr = Translator::new(SES).own_only();
    tr.sending();
    fed(&mut tr, &[started(), delivered("m_a")]);
    assert!(tr.runs_mine());
    tr.unsent();
    assert!(tr.running() && !tr.runs_mine() && !tr.engaged());
}

// Review 8 P1-1, the two-pane side: a send that fails before its `prompt` call (here the model pick)
// leaves no doubt behind about a run that took up another chat's message meanwhile.
#[test]
fn a_send_that_fails_before_its_prompt_call_leaves_the_other_chats_run_alone() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/model") { slow(Duration::from_millis(300), Reply::Json(500, "{\"message\":\"boom\"}".to_string())) } else { plain(m, p) });
    let (server, chat, _) = chat_with_a_waiting_pick(&fake);
    let c = Arc::clone(&chat);
    let sending = std::thread::spawn(move || c.send("hi", &[]));
    wait_until("the model pick is posted", Duration::from_secs(5), || fake.count("POST", &format!("/api/session/{SES}/model")) == 1);
    for (k, d) in [queued("m_a", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m_a" }))] {
        chat.heard(&k, &d);
    }
    assert!(chat.lock().tr.runs_mine(), "while the send is on its way, the run may be this chat's own");
    assert!(sending.join().unwrap().is_err(), "the pick was not applied");
    assert!(!fake.any("/prompt"));
    assert!(chat.lock().tr.running() && !chat.lock().tr.runs_mine());
    assert_eq!(chat.stop(), Some(StopHow::Ended));
    assert_eq!(interrupts(&fake), 0, "the other chat's run is not interrupted");
    server.shutdown();
}

// Review 8 P1-1, the single pane from end to end: a send, the stream ahead of the `prompt` answer
// (the run starts, takes the message up and replies), then Stop. The run is interrupted once, and the
// page's count is back at 0 once the run has ended and the answer has come.
#[test]
fn a_stop_right_after_a_send_interrupts_the_run_when_the_stream_is_ahead_of_the_answer() {
    let fake = fake(|m: &str, p: &str| if p.ends_with("/prompt") { Reply::Late(Duration::from_millis(600), "{\"data\":{\"id\":\"m1\",\"type\":\"user\"}}".to_string()) } else { plain(m, p) });
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    let c = Arc::clone(&chat);
    let sending = std::thread::spawn(move || c.send("one", &[]));
    wait_until("the message is on its way", Duration::from_secs(5), || fake.any("/prompt"));
    for (k, d) in [queued("m1", "one"), ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), said("a1", "hi")] {
        chat.heard(&k, &d);
    }
    let c = Arc::clone(&chat);
    let stopping = std::thread::spawn(move || c.stop());
    wait_until("the interrupt is posted", Duration::from_secs(2), || interrupts(&fake) == 1 || stopping.is_finished());
    assert_eq!(interrupts(&fake), 1, "the chat's own run is interrupted");
    let (k, d) = ev("session.execution.interrupted", json!({}));
    chat.heard(&k, &d);
    assert_eq!(stopping.join().unwrap(), Some(StopHow::Interrupt));
    sending.join().unwrap().unwrap();
    assert_eq!(interrupts(&fake), 1, "exactly one interrupt");
    assert_eq!(kinds_of(&seen, "c1"), ["user", "assistant", "stopped", "result"]);
    assert_eq!(results_for(&seen, "c1"), ["error_during_execution"]);
    assert_eq!(page_count(&seen, "c1", 0, 1), 0);
    assert!(!chat.busy() && !chat.lock().tr.running());
    server.shutdown();
}

// Review 8 P3-1: a run first heard from its own events (its start and the delivery were missed) while
// a message of this chat waits, with nothing saying it is another chat's run, may be that message's
// run: Stop interrupts it. A run heard before the message was sent is another chat's.
#[test]
fn a_run_first_heard_while_an_own_message_waits_is_stopped() {
    let step = || ev("session.step.started", json!({ "assistantMessageID": "a1" }));
    let mut tr = Translator::new(SES).own_only();
    tr.admit("m1", "one");
    fed(&mut tr, &[step(), said("a1", "hi")]);
    assert!(tr.running() && tr.runs_mine() && tr.engaged(), "the run may be the waiting message's");
    // The other order: the run was going on before the message was sent.
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[step(), said("a1", "hi")]);
    tr.admit("m1", "one");
    assert!(tr.running() && !tr.runs_mine() && !tr.engaged());
    // Another chat's waiting message is no reason.
    let mut tr = Translator::new(SES).own_only();
    fed(&mut tr, &[queued("m_a", "one"), step()]);
    assert!(tr.running() && !tr.runs_mine());

    let fake = fake(plain);
    let (server, _) = server_on(&fake);
    let (_, _, gen) = server.wake().unwrap();
    let (seen, sink) = sink();
    let chat = OpenChat::attach(&server, "c1", spec(Vec::new()), SES, None, gen, sink);
    mine(&chat, &[("m1", "one")]);
    for (k, d) in [step(), said("a1", "hi")] {
        chat.heard(&k, &d);
    }
    assert!(chat.stop().is_some());
    assert_eq!(interrupts(&fake), 1, "the run may be this chat's own");
    assert_eq!(fake.count("DELETE", &format!("/api/session/{SES}/inbox/m1")), 1);
    assert_eq!(kinds_of(&seen, "c1").last().map(String::as_str), Some("stopped"));
    server.shutdown();
}

// Review 8 P3-2: only an event that starts or carries on a piece of work says a run is going on. One
// that ends a piece, heard late after the run's own end, starts no run: the chat is not left running.
#[test]
fn a_stray_event_after_a_runs_end_starts_no_run() {
    let strays = [
        said("a1", "late"),
        ev("session.reasoning.ended", json!({ "assistantMessageID": "a1", "ordinal": 0, "text": "hm" })),
        ev("session.tool.success", json!({ "id": "t1", "content": [] })),
        ev("session.tool.failed", json!({ "id": "t1", "error": { "message": "no" } })),
        ev("session.tool.input.ended", json!({ "assistantMessageID": "a1", "id": "t1" })),
        ev("session.step.ended", json!({ "assistantMessageID": "a1" })),
        ev("session.step.failed", json!({ "assistantMessageID": "a1" })),
    ];
    for one in strays {
        let mut tr = Translator::new(SES).own_only();
        tr.admit("m1", "one");
        fed(&mut tr, &[ev("session.execution.started", json!({})), ev("session.inbox.delivered", json!({ "inboxID": "m1" })), said("a1", "hi")]);
        assert_eq!(subtypes(&results_of(&fed(&mut tr, &[ev("session.execution.succeeded", json!({}))]))), ["success"]);
        fed(&mut tr, std::slice::from_ref(&one));
        assert!(!tr.running() && !tr.busy(), "{} after the run's end starts no run", one.0);
    }
}
