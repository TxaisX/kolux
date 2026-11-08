//! spec/13 P0 boxes BROW-051, BROW-008, BROW-009 (Rust halves). The agent endpoints are the hooks HTTP
//! endpoint (request gate) and the CLI line port (real listener on a loopback port); no network beyond 127.0.0.1.

use base64::Engine;
use kolux_lib::cli::{call, serve_loop, Request};
use kolux_lib::hooks::{answer, gate, parse_request, Request as Http};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

const TOKEN: &str = "tok-for-cards-13";

fn id_header() -> String {
    base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":7,"terminal":3,"hookVersion":1}"#)
}

/// A request as the hooks endpoint reads it off the wire; `lines` are extra header lines.
fn wire(method_path: &str, host: &str, lines: &str) -> Http {
    let raw = format!("{method_path} HTTP/1.1\r\nHost: {host}\r\n{lines}Content-Length: 2\r\n\r\n{{}}");
    parse_request(&mut raw.as_bytes()).expect("parsed")
}

fn cli_listener() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    assert!(listener.local_addr().unwrap().ip().is_loopback(), "the CLI line port is loopback only");
    let port = listener.local_addr().unwrap().port();
    let ran = Arc::new(AtomicUsize::new(0));
    let seen = ran.clone();
    std::thread::spawn(move || {
        serve_loop(listener, TOKEN, "rt-cards-13", move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
            Ok(json!({ "ok": true }))
        })
    });
    (port, ran)
}

fn req(token: &str, id: &str) -> Request {
    Request { id: id.into(), token: token.into(), command: "browser.tabs".into(), cwd: String::new(), args: json!({}), pane: None, cli: String::new(), arrived: None }
}

/// What a browser sends for the page's own fetch, form post, img/script tag and preflight, each
/// carrying the CORRECT token (a page that somehow learned the secret).
#[test]
fn brow051_box1_a_web_page_is_refused_even_with_the_secret() {
    let token_line = format!("X-Kolux-Token: {TOKEN}\r\nX-Kolux-Pane: {}\r\n", id_header());
    let fetch = wire("POST /claude", "127.0.0.1:4321", &format!("Origin: http://evil.example\r\n{token_line}"));
    let form = wire("POST /claude", "127.0.0.1:4321", &format!("Referer: http://evil.example/page\r\n{token_line}"));
    let tag = wire("GET /claude", "127.0.0.1:4321", &format!("Sec-Fetch-Mode: no-cors\r\nSec-Fetch-Site: cross-site\r\nSec-Fetch-Dest: image\r\n{token_line}"));
    let preflight = wire("OPTIONS /claude", "127.0.0.1:4321", "Origin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: x-kolux-token\r\n");
    for (what, r) in [("fetch with Origin", &fetch), ("form post with Referer", &form), ("img/script tag with Sec-Fetch", &tag), ("CORS preflight", &preflight)] {
        assert_eq!(gate(r, TOKEN), Some(404), "{what}");
    }
    // The control: the same bytes without the web headers are Kolux's own tool and pass.
    let own = wire("POST /claude", "127.0.0.1:4321", &token_line);
    assert_eq!(gate(&own, TOKEN), None);
    // A name aimed at this computer (DNS rebinding) is refused with the right token and no web headers.
    let rebound = wire("POST /claude", "rebind.evil.example:4321", &token_line);
    assert_eq!(gate(&rebound, TOKEN), Some(404));
}

#[test]
fn brow051_box1_the_cli_port_drops_a_web_pages_http_request_without_a_byte() {
    let (port, ran) = cli_listener();
    // A web page can only speak HTTP: fetch, XHR, form post and a text/plain form post that spells the JSON line as its body.
    let line = serde_json::to_string(&req(TOKEN, "page-1")).unwrap();
    for sent in [
        format!("POST / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{line}", line.len()),
        format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nSec-Fetch-Mode: no-cors\r\n\r\n"),
        format!("OPTIONS / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\n\r\n"),
    ] {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).ok();
        s.write_all(sent.as_bytes()).unwrap();
        let mut reply = Vec::new();
        let _ = s.read_to_end(&mut reply);
        assert!(reply.is_empty(), "no reply at all to {}: {:?}", sent.lines().next().unwrap(), String::from_utf8_lossy(&reply));
    }
    assert_eq!(ran.load(Ordering::SeqCst), 0, "no handler ran for a web page");
}

#[test]
fn brow051_box2_the_bare_port_is_refused_and_the_handed_address_works() {
    // Hooks HTTP endpoint: bare host and port, no token, a wrong token: 404 (the empty body is hooks.rs:644-646).
    let bare_get = wire("GET /", "127.0.0.1:4321", "");
    assert_eq!(gate(&bare_get, TOKEN), Some(404));
    let no_token = wire("POST /claude", "127.0.0.1:4321", &format!("X-Kolux-Pane: {}\r\n", id_header()));
    assert_eq!(gate(&no_token, TOKEN), Some(404));
    let wrong = wire("POST /claude", "127.0.0.1:4321", &format!("X-Kolux-Token: not-it\r\nX-Kolux-Pane: {}\r\n", id_header()));
    assert_eq!(gate(&wrong, TOKEN), Some(404));
    // The address Kolux handed the agent's hook script (token + pane header, loopback host) works.
    for host in ["127.0.0.1:4321", "localhost:4321", "[::1]:4321"] {
        let ok = wire("POST /claude", host, &format!("X-Kolux-Token: {TOKEN}\r\nX-Kolux-Pane: {}\r\n", id_header()));
        assert_eq!(gate(&ok, TOKEN), None, "{host}");
    }
    let hook = "{\"hook_event_name\":\"PreCompact\"}";
    let raw = format!("POST /claude HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Kolux-Token: {TOKEN}\r\nX-Kolux-Pane: {}\r\nContent-Length: {}\r\n\r\n{hook}", id_header(), hook.len());
    let own = parse_request(&mut raw.as_bytes()).unwrap();
    assert_eq!(gate(&own, TOKEN), None);
    assert_eq!(answer(&own, TOKEN).0, 200);

    // CLI line port: the bare port with a guessed or missing token gets `unauthorized` and runs nothing; the token from cli.json works.
    let (port, ran) = cli_listener();
    for guess in ["", "guess"] {
        let v = call(port, &req(guess, "bare")).unwrap();
        assert_eq!((v["success"].clone(), v["error"]["code"].clone()), (json!(false), json!("unauthorized")), "token {guess:?}");
    }
    assert_eq!(ran.load(Ordering::SeqCst), 0);
    let v = call(port, &req(TOKEN, "own")).unwrap();
    assert_eq!(v["success"], true);
    assert_eq!(ran.load(Ordering::SeqCst), 1);
}
