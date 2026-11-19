//! spec/13 P0 boxes BROW-051, BROW-008, BROW-009 (Rust halves). The agent endpoint is the hooks HTTP
//! endpoint (request gate); no network beyond 127.0.0.1.

use base64::Engine;
use kolux_lib::hooks::{answer, gate, parse_request, Request as Http};

const TOKEN: &str = "tok-for-cards-13";

/// T-793 (DT-C240): the hook token of the pane `id_header` names (paneKey 7, terminal 3).
fn pane_tok() -> String {
    kolux_lib::hooks::pane_token(TOKEN, 7, Some(3))
}

fn id_header() -> String {
    base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":7,"terminal":3,"hookVersion":1}"#)
}

/// A request as the hooks endpoint reads it off the wire; `lines` are extra header lines.
fn wire(method_path: &str, host: &str, lines: &str) -> Http {
    let raw = format!("{method_path} HTTP/1.1\r\nHost: {host}\r\n{lines}Content-Length: 2\r\n\r\n{{}}");
    parse_request(&mut raw.as_bytes()).expect("parsed")
}

/// What a browser sends for the page's own fetch, form post, img/script tag and preflight, each
/// carrying the CORRECT token (a page that somehow learned the secret).
#[test]
fn brow051_box1_a_web_page_is_refused_even_with_the_secret() {
    let token_line = format!("X-Kolux-Token: {}\r\nX-Kolux-Pane: {}\r\n", pane_tok(), id_header());
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
        let ok = wire("POST /claude", host, &format!("X-Kolux-Token: {}\r\nX-Kolux-Pane: {}\r\n", pane_tok(), id_header()));
        assert_eq!(gate(&ok, TOKEN), None, "{host}");
    }
    let hook = "{\"hook_event_name\":\"PreCompact\"}";
    let raw = format!("POST /claude HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Kolux-Token: {}\r\nX-Kolux-Pane: {}\r\nContent-Length: {}\r\n\r\n{hook}", pane_tok(), id_header(), hook.len());
    let own = parse_request(&mut raw.as_bytes()).unwrap();
    assert_eq!(gate(&own, TOKEN), None);
    assert_eq!(answer(&own, TOKEN).0, 200);
}
