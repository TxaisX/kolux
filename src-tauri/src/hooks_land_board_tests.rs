//! LAND-01 board tests (locked): the hook listener's `/land` route and the retry of a workspace left
//! behind main after a pane's turn finishes. Wired from hooks.rs with
//! `#[cfg(test)] #[path = "hooks_land_board_tests.rs"] mod land_board_tests;`
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering as AtOrdering};
use std::sync::mpsc;

/// An identity header the way a pane's environment carries it.
fn ident(pane: u32, terminal: u32) -> String {
    base64::engine::general_purpose::STANDARD.encode(format!(r#"{{"paneKey":{pane},"terminal":{terminal},"hookVersion":1}}"#))
}

/// The token `pane_env` mints for that identity under secret "tok".
fn token_for(pane: u32, terminal: u32) -> String {
    pane_token("tok", pane, Some(terminal))
}

type Seen = Arc<Mutex<Vec<(u32, Option<u32>, String)>>>;

/// A listener on a loopback port whose `/land` answer is `answer`; returns the port, what `land`
/// was called with, and how many statuses / after-jobs were raised.
fn listen(answer: impl Fn(u32, Option<u32>, &str) -> (u16, String) + Send + Sync + 'static) -> (u16, Seen, Arc<AtomicUsize>, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let (raised, aftered) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
    let (s, r, a) = (Arc::clone(&seen), Arc::clone(&raised), Arc::clone(&aftered));
    let line = Line {
        token: "tok".into(),
        raise: Box::new(move |_| {
            r.fetch_add(1, AtOrdering::SeqCst);
        }),
        after: Box::new(move |_| {
            a.fetch_add(1, AtOrdering::SeqCst);
        }),
        land: Box::new(move |pane, terminal, body| {
            s.lock().unwrap().push((pane, terminal, body.to_string()));
            answer(pane, terminal, body)
        }),
    };
    std::thread::spawn(move || accept(listener, Arc::new(line)));
    (port, seen, raised, aftered)
}

/// Sends raw bytes as the body of a POST to `path`; returns (status line, body).
fn send(port: u16, path: &str, headers: &str, body: &[u8]) -> (String, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let head = format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{headers}Content-Length: {}\r\n\r\n", body.len());
    s.write_all(head.as_bytes()).unwrap();
    s.write_all(body).unwrap();
    let mut reply = Vec::new();
    let _ = s.read_to_end(&mut reply);
    let reply = String::from_utf8_lossy(&reply).into_owned();
    let (head, body) = reply.split_once("\r\n\r\n").unwrap_or((&reply, ""));
    (head.lines().next().unwrap_or_default().to_string(), body.to_string())
}

fn signed_headers(pane: u32, terminal: u32) -> String {
    format!("X-Kolux-Token: {}\r\nX-Kolux-Pane: {}\r\n", token_for(pane, terminal), ident(pane, terminal))
}

#[test]
fn land_route_hands_the_proven_pane_and_trimmed_folder_to_land() {
    let (port, seen, raised, aftered) = listen(|_, _, body| {
        if body.ends_with("ws-b") {
            (409, "Not sent to main: it has uncommitted changes in a.txt.".to_string())
        } else {
            (200, "Sent to main. Every other workspace took it in.".to_string())
        }
    });
    let (status, body) = send(port, "/land", &signed_headers(58_501, 5), b"  C:\\work\\ws-a \r\n");
    assert!(status.contains(" 200 "), "{status}");
    assert_eq!(body, "Sent to main. Every other workspace took it in.");
    let (status, body) = send(port, "/land", &signed_headers(58_502, 6), b"C:\\work\\ws-b");
    assert!(status.contains(" 409 "), "{status}");
    assert_eq!(body, "Not sent to main: it has uncommitted changes in a.txt.");
    let got = seen.lock().unwrap().clone();
    assert_eq!(got, vec![(58_501, Some(5), "C:\\work\\ws-a".to_string()), (58_502, Some(6), "C:\\work\\ws-b".to_string())]);
    assert_eq!(raised.load(AtOrdering::SeqCst), 0, "a land raises no pane status");
    assert_eq!(aftered.load(AtOrdering::SeqCst), 0, "a land queues no after-work");
}

#[test]
fn land_route_refuses_an_unproven_request_with_a_bare_404() {
    let (port, seen, _, _) = listen(|_, _, _| (200, "Sent to main.".to_string()));
    let id = ident(58_511, 7);
    let other = token_for(58_512, 8);
    let cases = [
        ("no token", format!("X-Kolux-Pane: {id}\r\n")),
        ("the shared secret as token", format!("X-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\n")),
        ("another pane's token", format!("X-Kolux-Token: {other}\r\nX-Kolux-Pane: {id}\r\n")),
        ("no identity", format!("X-Kolux-Token: {}\r\n", token_for(58_511, 7))),
        ("from a web page", format!("{}Origin: http://evil.example\r\n", signed_headers(58_511, 7))),
    ];
    for (what, headers) in cases {
        let (status, body) = send(port, "/land", &headers, b"C:\\work\\ws-a");
        assert!(status.contains(" 404 ") && body.is_empty(), "{what}: {status} {body:?}");
    }
    assert!(seen.lock().unwrap().is_empty(), "no unproven request reaches land");
}

#[test]
fn land_route_checks_the_body_before_landing() {
    let (port, seen, _, _) = listen(|_, _, _| (200, "Sent to main.".to_string()));
    let h = signed_headers(58_521, 9);
    let too_big = format!("C:\\{}", "a".repeat(1022));
    assert_eq!(too_big.len(), 1025);
    let cases: [(&str, Vec<u8>, &str); 4] = [
        ("empty", Vec::new(), " 400 "),
        ("only spaces and a line end", b"   \r\n".to_vec(), " 400 "),
        ("not UTF-8", vec![b'C', b':', 0xff, 0xfe], " 400 "),
        ("1025 bytes", too_big.into_bytes(), " 413 "),
    ];
    for (what, body, want) in cases {
        let (status, text) = send(port, "/land", &h, &body);
        assert!(status.contains(want), "{what}: {status}");
        assert!(!text.trim().is_empty(), "{what}: the agent is told why in plain text");
    }
    assert!(seen.lock().unwrap().is_empty(), "a refused body never reaches land");
    let exact = format!("C:\\{}", "b".repeat(1021));
    assert_eq!(exact.len(), 1024);
    let (status, _) = send(port, "/land", &h, exact.as_bytes());
    assert!(status.contains(" 200 "), "1024 bytes is allowed: {status}");
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(seen.lock().unwrap()[0].2, exact);
}

#[test]
fn land_route_does_not_hold_up_status_hooks_while_it_works() {
    let (go, wait) = mpsc::channel::<()>();
    let wait = Mutex::new(wait);
    let (started_tx, started) = mpsc::channel::<()>();
    let started_tx = Mutex::new(started_tx);
    let (port, _, raised, _) = listen(move |_, _, _| {
        let _ = started_tx.lock().unwrap().send(());
        // Held until the test lets go (or gives up): a land can take a long time.
        let _ = wait.lock().unwrap().recv_timeout(Duration::from_secs(30));
        (200, "Sent to main.".to_string())
    });
    let lander = std::thread::spawn(move || send(port, "/land", &signed_headers(58_531, 11), b"C:\\work\\ws-a"));
    started.recv_timeout(Duration::from_secs(20)).expect("the land started");
    // While the land is still working, another pane's status hook is answered.
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
    let event = r#"{"hook_event_name":"UserPromptSubmit","prompt":"go","session_id":"land01"}"#;
    write!(s, "POST /claude HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{}Content-Length: {}\r\n\r\n{event}", signed_headers(58_532, 12), event.len()).unwrap();
    let mut reply = String::new();
    let _ = s.read_to_string(&mut reply);
    let answered = reply.lines().next().unwrap_or_default().contains(" 200 ");
    let _ = go.send(());
    let (status, _) = lander.join().unwrap();
    assert!(answered, "a status hook waited behind a land: {reply:?}");
    assert_eq!(raised.load(AtOrdering::SeqCst), 1, "the status hook was heard");
    assert!(status.contains(" 200 "), "{status}");
}

fn status_of(state: &'static str, boundary: bool, child: Option<&str>) -> crate::status::Status {
    crate::status::Status {
        pane_key: 58_541,
        terminal: Some(13),
        change: Change { state, boundary, ..Change::default() },
        children: Vec::new(),
        stop: None,
        reply: None,
        child: child.map(str::to_string),
        interrupted: false,
        monitoring: false,
    }
}

#[test]
fn turn_finished_is_true_only_for_the_lead_finishing_a_turn() {
    assert!(turn_finished(&status_of("done", false, None)), "the lead's Stop: done");
    assert!(!turn_finished(&status_of("done", true, None)), "a session start or clear is not a finished turn");
    assert!(!turn_finished(&status_of("done", false, Some("agent-1"))), "a sub-agent finishing is not the lead's turn");
    for state in ["working", "waiting", "permission", "blocked"] {
        assert!(!turn_finished(&status_of(state, false, None)), "{state}");
    }
}

/// The body of `fn <name>(` in hooks.rs, comments removed, up to the closing brace at column 0.
fn body_of(name: &str) -> String {
    let src = include_str!("hooks.rs");
    let at = src.find(&format!("\nfn {name}(")).or_else(|| src.find(&format!("\npub fn {name}("))).or_else(|| src.find(&format!("\npub(crate) fn {name}("))).unwrap_or_else(|| panic!("fn {name} exists in hooks.rs"));
    let rest = &src[at + 1..];
    let end = rest.find("\n}\n").or_else(|| rest.find("\n}\r\n")).expect("function ends");
    rest[..end].lines().map(|l| l.split("// ").next().unwrap_or("")).collect::<Vec<_>>().join("\n")
}

#[test]
fn the_listener_answers_land_outside_the_order_lock_and_serve_wires_from_pane() {
    let handle = body_of("handle");
    let land = handle.find("\"/land\"").expect("handle has a /land arm");
    let order = handle.find("ORDER.lock").expect("handle still takes ORDER for status hooks");
    assert!(land < order, "the /land arm comes before the ORDER lock");
    assert!(handle.contains("line.land"), "the arm calls the Line's land");
    let serve = body_of("serve");
    assert!(serve.contains("land::from_pane("), "serve wires land to land::from_pane");
}

#[test]
fn a_finished_turn_retries_its_workspace_off_the_queue_thread() {
    let after = body_of("after_reply");
    assert!(after.contains("retry_after_turn("), "after_reply calls retry_after_turn for a status");
    let retry = body_of("retry_after_turn");
    assert!(retry.contains("turn_finished("), "only a finished turn retries");
    assert!(retry.contains("thread::spawn"), "the retry runs on its own thread, not the after-reply queue");
    assert!(retry.contains("retry_behind("), "it calls land::retry_behind");
    assert!(retry.contains("dir_of("), "the folder is the one the pane's terminal started in");
}
