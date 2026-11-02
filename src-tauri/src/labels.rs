// PROJ-088 (T-303): friendly local addresses for each workspace's dev server. Off by default. When
// the setting is on, Kolux listens on loopback and forwards `http://<label>.localhost:<PORT>/` to the
// dev server listening inside that workspace. Only plain http targets are served (an https target is
// refused), responses pass through byte for byte, and a target bound to 0.0.0.0 (or ::) is reached on
// loopback. Browsers resolve every `*.localhost` name to loopback on their own, so no hosts file or
// DNS is touched.
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

/// The settings field: `true` turns the labels on. Absent or anything else = off.
pub const SETTING: &str = "workspaceLocalhostLabels";
/// The loopback port the label addresses use.
pub const PORT: u16 = 4580;
/// The most a request head may take before the connection is dropped.
const HEAD_LIMIT: usize = 64 * 1024;

/// A label is turned into the target the dev server listens on (`host:port`); None = no workspace
/// with that label, or no server in it.
pub type Resolve = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Whether the labels are on (off by default).
pub fn enabled(settings: &serde_json::Value) -> bool {
    settings.get(SETTING).and_then(serde_json::Value::as_bool).unwrap_or(false)
}

/// The label of a workspace: its folder's name, lower-cased, anything outside a-z 0-9 made `-`.
pub fn label_of(path: &str) -> String {
    let last = path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("");
    let mut out = String::new();
    for c in last.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() { out.push(c) } else if !out.ends_with('-') { out.push('-') }
    }
    out.trim_matches('-').to_string()
}

/// The label in a Host header (`foo.localhost:4580`, `FOO.localhost`); None for anything else.
pub fn host_label(host: &str) -> Option<String> {
    let host = host.trim().to_ascii_lowercase();
    let name = host.split(':').next()?;
    let label = name.strip_suffix(".localhost")?;
    (!label.is_empty() && !label.contains('.')).then(|| label.to_string())
}

/// A bind-all address is reached on loopback; anything else is left as it is.
pub fn loopback(addr: &str) -> String {
    match addr.trim_matches(['[', ']']) {
        "0.0.0.0" | "" => "127.0.0.1".to_string(),
        "::" => "::1".to_string(),
        other => other.to_string(),
    }
}

/// The `host:port` to connect to for a target (`3000`, `0.0.0.0:3000`, `http://[::]:3000/`); None
/// when the target is not plain http or not on this PC (loopback IP or `localhost` only).
pub fn target_of(target: &str) -> Option<String> {
    let t = target.trim();
    if t.starts_with("https://") { return None }
    let t = t.strip_prefix("http://").unwrap_or(t);
    let t = t.split('/').next()?;
    let (host, port) = match t.rsplit_once(':') {
        Some((h, p)) if !h.ends_with(':') || h.starts_with('[') => (h, p),
        _ => ("0.0.0.0", t),
    };
    let port: u16 = port.parse().ok()?;
    // The one guard every connect passes: only this PC, decided from the text (no DNS lookup).
    let host = match loopback(host).as_str() {
        "localhost" => "127.0.0.1".to_string(),
        h if h.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback()) => h.to_string(),
        _ => return None,
    };
    Some(if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") })
}

/// Whether the setting is on right now: while off, the listener (if ever bound) answers nothing but
/// a refusal, so no label address serves anything.
static ON: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<Result<u16, String>> = OnceLock::new();

/// Follows the setting: the first time it is on the listener is bound; off again makes every
/// address refuse. Called from the background poll.
pub fn apply(on: bool, resolve: &Resolve) {
    ON.store(on, Ordering::Relaxed);
    if on {
        STARTED.get_or_init(|| start(resolve.clone()));
    }
}

/// Listens on loopback at PORT; returns the bound port.
pub fn start(resolve: Resolve) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| format!("port {PORT}: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || serve(listener, resolve));
    Ok(port)
}

/// Every known workspace of every Git project: the main folders and the worktrees Kolux has seen.
fn workspace_paths(store: &crate::state::Store) -> Vec<String> {
    crate::projects::load_projects(store)
        .into_iter()
        .filter(|p| !crate::folder_projects::is_folder(store, &p.id))
        .flat_map(|p| {
            let mut v = vec![p.path.clone()];
            v.extend(crate::projects::seen_of(store, &p).unwrap_or_default());
            v
        })
        .collect()
}

/// The first non-external listener row that passes `target_of`: a row bound to this PC's network
/// address is skipped when a loopback one follows.
fn first_target(rows: Vec<crate::ports::PortRow>) -> Option<String> {
    rows.into_iter().filter(|r| !r.external).find_map(|r| target_of(&format!("{}:{}", loopback(&r.addr), r.port)))
}

/// The target for a label: the first dev server listening inside the workspace whose folder has
/// that label (its own process tree, not an outside service).
pub fn resolve_in(app: &tauri::AppHandle, label: &str) -> Option<String> {
    let paths = app.state::<Mutex<crate::state::Store>>().lock().ok().map(|s| workspace_paths(&s))?;
    let path = paths.into_iter().find(|p| label_of(p) == label)?;
    // The Ports back end's own command (VIEW-078), so this module needs nothing private from it.
    let rows = tauri::async_runtime::block_on(crate::ports::ports_list(app.state::<crate::terminal::Terminals>(), vec![path.clone()], path)).ok()?;
    first_target(rows)
}

/// Accepts connections until the listener is dropped; each one is forwarded on its own thread.
pub fn serve(listener: TcpListener, resolve: Resolve) {
    for client in listener.incoming().flatten() {
        let resolve = resolve.clone();
        std::thread::spawn(move || handle(client, &resolve));
    }
}

fn reply(mut client: TcpStream, status: &str, text: &str) {
    let _ = write!(client, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
    let _ = client.shutdown(Shutdown::Both);
}

/// Reads the request head, picks the target by the Host header, then copies bytes both ways
/// unchanged until either side closes.
fn handle(mut client: TcpStream, resolve: &Resolve) {
    let _ = client.set_read_timeout(Some(Duration::from_secs(10)));
    let mut head = Vec::new();
    let mut buf = [0u8; 4096];
    let end = loop {
        let Ok(n) = client.read(&mut buf) else { return };
        if n == 0 { return }
        head.extend_from_slice(&buf[..n]);
        if let Some(i) = head.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4 }
        if head.len() > HEAD_LIMIT { return reply(client, "431 Request Header Fields Too Large", "request head too large") }
    };
    let text = String::from_utf8_lossy(&head[..end]);
    let host = text.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("host")).map(|(_, v)| v.trim().to_string()));
    let Some(label) = host.as_deref().and_then(host_label) else { return reply(client, "400 Bad Request", "not a workspace label address (expected <name>.localhost)") };
    if !ON.load(Ordering::Relaxed) { return reply(client, "404 Not Found", "workspace localhost labels are off") }
    let Some(target) = resolve(&label).and_then(|t| target_of(&t)) else { return reply(client, "502 Bad Gateway", &format!("no plain http dev server is running in workspace \"{label}\"")) };
    let Ok(mut server) = TcpStream::connect_timeout(&match target.parse() { Ok(a) => a, Err(_) => return reply(client, "502 Bad Gateway", "bad target") }, Duration::from_secs(5)) else {
        return reply(client, "502 Bad Gateway", &format!("the dev server at {target} is not answering"));
    };
    let _ = client.set_read_timeout(None);
    if server.write_all(&head).is_err() { return }
    let (Ok(mut c2), Ok(mut s2)) = (client.try_clone(), server.try_clone()) else { return };
    let up = std::thread::spawn(move || {
        let _ = std::io::copy(&mut client, &mut server);
        let _ = server.shutdown(Shutdown::Write);
    });
    let _ = std::io::copy(&mut s2, &mut c2);
    let _ = c2.shutdown(Shutdown::Write);
    let _ = up.join();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proj088_off_by_default_and_labels_come_from_the_folder_name() {
        assert!(!enabled(&serde_json::json!({})));
        assert!(!enabled(&serde_json::json!({ SETTING: "yes" })));
        assert!(enabled(&serde_json::json!({ SETTING: true })));
        assert_eq!(label_of("G:\\w\\My Repo\\Fix Login_2"), "fix-login-2");
        assert_eq!(label_of("/home/x/a/"), "a");
        assert_eq!(host_label("a.localhost:4580"), Some("a".into()));
        assert_eq!(host_label("Fix-Login.LOCALHOST"), Some("fix-login".into()));
        assert_eq!(host_label("localhost:4580"), None);
        assert_eq!(host_label("a.b.localhost"), None);
        assert_eq!(host_label("example.com"), None);
    }

    #[test]
    fn proj088_only_plain_http_targets_and_bind_all_goes_to_loopback() {
        assert_eq!(target_of("0.0.0.0:3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("http://0.0.0.0:3000/"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("[::]:5173"), Some("[::1]:5173".into()));
        assert_eq!(target_of("127.0.0.1:8080"), Some("127.0.0.1:8080".into()));
        assert_eq!(target_of("https://0.0.0.0:3000"), None, "https is not served");
        assert_eq!(target_of("0.0.0.0:nope"), None);
        assert_eq!(loopback("[::]"), "::1");
    }

    #[test]
    fn proj088_a_target_off_this_pc_is_refused_and_loopback_ones_are_kept() {
        for off in ["192.168.1.5:3000", "http://example.com:80/", "10.0.0.1:8080", "devbox:3000", "[2001:db8::1]:80", "127.0.0.1.evil.com:80"] {
            assert_eq!(target_of(off), None, "{off} is not on this PC");
        }
        assert_eq!(target_of("3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("0.0.0.0:3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("127.0.0.1:3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("localhost:3000"), Some("127.0.0.1:3000".into()));
        assert_eq!(target_of("[::]:3000"), Some("[::1]:3000".into()));
        assert_eq!(target_of("[::1]:3000"), Some("[::1]:3000".into()));
    }

    #[test]
    fn proj088_resolves_to_the_first_loopback_listener_not_the_first_row() {
        let row = |addr: &str, port: u16, external: bool| crate::ports::PortRow { port, addr: addr.into(), pid: 1, external, started: String::new(), terminal: None };
        let rows = vec![row("192.168.1.5", 3000, false), row("127.0.0.1", 3000, false)];
        assert_eq!(first_target(rows), Some("127.0.0.1:3000".into()));
        assert_eq!(first_target(vec![row("192.168.1.5", 3000, false)]), None, "no loopback listener at all");
        assert_eq!(first_target(vec![row("127.0.0.1", 1, true), row("0.0.0.0", 3000, false)]), Some("127.0.0.1:3000".into()), "external rows stay skipped");
    }

    fn fake_server(body: &'static str) -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut got = vec![0u8; 4096];
            let n = s.read(&mut got).unwrap();
            got.truncate(n);
            let _ = write!(s, "HTTP/1.1 200 OK\r\nX-Passed: through\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            let _ = s.shutdown(Shutdown::Write);
            got
        });
        (port, h)
    }

    fn ask(proxy: u16, host: &str) -> String {
        let mut c = TcpStream::connect(("127.0.0.1", proxy)).unwrap();
        write!(c, "GET /hello?x=1 HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn proj088_a_label_address_serves_the_workspaces_dev_server_unchanged_and_others_are_refused() {
        let (port, server) = fake_server("hi from a");
        let table = std::sync::Mutex::new(vec![("a".to_string(), format!("0.0.0.0:{port}")), ("tls".to_string(), "https://0.0.0.0:1".to_string()), ("lan".to_string(), "192.168.1.5:3000".to_string())]);
        let resolve: Resolve = Arc::new(move |label| table.lock().unwrap().iter().find(|(l, _)| l == label).map(|(_, t)| t.clone()));
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = l.local_addr().unwrap().port();
        std::thread::spawn(move || serve(l, resolve));
        assert!(ask(proxy, &format!("a.localhost:{proxy}")).starts_with("HTTP/1.1 404"), "off (the default): no label address serves anything");
        ON.store(true, Ordering::Relaxed);

        let out = ask(proxy, &format!("a.localhost:{proxy}"));
        assert!(out.starts_with("HTTP/1.1 200 OK\r\nX-Passed: through\r\n"), "the response passes through unchanged: {out}");
        assert!(out.ends_with("hi from a"), "{out}");
        let seen = String::from_utf8(server.join().unwrap()).unwrap();
        assert!(seen.starts_with("GET /hello?x=1 HTTP/1.1\r\n"), "the request reaches the server as sent: {seen}");

        assert!(ask(proxy, &format!("nobody.localhost:{proxy}")).starts_with("HTTP/1.1 502"), "an unknown label is refused");
        assert!(ask(proxy, &format!("tls.localhost:{proxy}")).starts_with("HTTP/1.1 502"), "an https target is not served");
        let t = std::time::Instant::now();
        assert!(ask(proxy, &format!("lan.localhost:{proxy}")).starts_with("HTTP/1.1 502"), "a target off this PC is refused");
        assert!(t.elapsed() < Duration::from_secs(2), "refused before any connect attempt");
        assert!(ask(proxy, "localhost").starts_with("HTTP/1.1 400"), "a bare host is not a label");
    }
}
