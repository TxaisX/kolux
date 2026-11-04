//! T-242 (BROW-067): the dev servers a workspace is running, for the Preview button. The system's
//! listening TCP ports are read (the Ports popover's shared `netstat -ano` on Windows, `lsof` elsewhere) and matched
//! against the addresses the workspace's terminals printed: on Windows the port scan carries no
//! working folder, so a port counts as the workspace's when one of its terminals printed an address
//! for it and the port is listening. Ranking: a printed address first, then a port speaking HTTP,
//! then the smallest port number.
//! ponytail: ports owned by the workspace's own processes (no printed address) are not candidates
//! yet; that needs the pane's process tree from the terminal lane (after-list).
use serde::Serialize;
use std::time::Duration;

/// A TCP port something listens on, with the process that holds it (0 when unknown).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Listening {
    pub port: u16,
    pub pid: u32,
}

/// A dev server the Preview button may open.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Candidate {
    pub host: String,
    pub port: u16,
    /// The address as a terminal printed it (the one used when there is one).
    pub url: String,
    pub printed: bool,
    pub web: bool,
}

/// `netstat -ano`: `  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    1234`; UDP lines are skipped.
pub fn parse_netstat(text: &str) -> Vec<Listening> {
    let mut out = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 5 || !f[0].eq_ignore_ascii_case("tcp") || !f[3].eq_ignore_ascii_case("listening") {
            continue;
        }
        let Some(port) = f[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else { continue };
        let pid = f[4].parse::<u32>().unwrap_or(0);
        if !out.iter().any(|l: &Listening| l.port == port) {
            out.push(Listening { port, pid });
        }
    }
    out
}

/// `lsof -nP -iTCP -sTCP:LISTEN`: `node  123 me  23u IPv4 0x..  0t0 TCP *:5173 (LISTEN)`.
pub fn parse_lsof(text: &str) -> Vec<Listening> {
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        let Some(addr) = f.iter().rev().nth(1) else { continue };
        let Some(port) = addr.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else { continue };
        let pid = f.get(1).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        if !out.iter().any(|l: &Listening| l.port == port) {
            out.push(Listening { port, pid });
        }
    }
    out
}

/// The ports listening on this machine now.
pub fn listening() -> Vec<Listening> {
    // T-726: the same table the Ports popover reads (one netstat run serves both pollers).
    #[cfg(windows)]
    let text = crate::ports::netstat(false).unwrap_or_default();
    #[cfg(not(windows))]
    let text = std::process::Command::new("lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN"]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    if cfg!(windows) { parse_netstat(&text) } else { parse_lsof(&text) }
}

/// How long a port gets to answer the HEAD request.
const WEB_WAIT: Duration = Duration::from_millis(400);

/// The address a port on this machine is asked at, with a HEAD request through the approved near
/// client (APP-070): any HTTP answer means a web server, not a database.
pub fn loopback(port: u16) -> Option<tauri::Url> {
    tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).ok()
}

/// The ports among the printed local addresses that are listening: the only ones asked.
pub fn asked(listening: &[Listening], printed: &[String]) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    for (_, port) in printed.iter().filter_map(|p| local_address(p)) {
        if listening.iter().any(|l| l.port == port) && !out.contains(&port) {
            out.push(port);
        }
    }
    out
}

/// The host and port of a printed address, when it is a local web address.
pub fn local_address(url: &str) -> Option<(String, u16)> {
    let u = tauri::Url::parse(url.trim()).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?.trim_matches(['[', ']']).to_string();
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "0.0.0.0" | "::" | "::1") || host.ends_with(".localhost");
    if !local {
        return None;
    }
    let host = if matches!(host.as_str(), "0.0.0.0" | "::" | "::1") { "localhost".to_string() } else { host };
    Some((host, u.port_or_known_default()?))
}

/// BROW-067: the workspace's dev servers, ranked. `printed` is what its terminals printed; `web`
/// says whether a port speaks HTTP (asked once per port).
pub fn candidates(listening: &[Listening], printed: &[String], web: impl Fn(u16) -> bool) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();
    for p in printed {
        let Some((host, port)) = local_address(p) else { continue };
        if !listening.iter().any(|l| l.port == port) || out.iter().any(|c| c.port == port) {
            continue;
        }
        out.push(Candidate { host, port, url: p.trim().to_string(), printed: true, web: web(port) });
    }
    rank(&mut out);
    out
}

/// A printed address first, next a port speaking a recognised web protocol, the smallest port
/// number breaking any tie.
pub fn rank(list: &mut [Candidate]) {
    list.sort_by(|a, b| b.printed.cmp(&a.printed).then(b.web.cmp(&a.web)).then(a.port.cmp(&b.port)));
}

/// The Preview button's candidates for a workspace: `printed` is what its terminals printed.
#[tauri::command]
pub async fn browser_dev_ports(app: tauri::AppHandle, printed: Vec<String>) -> Result<Vec<Candidate>, String> {
    let now = tauri::async_runtime::spawn_blocking(listening).await.map_err(|e| e.to_string())?;
    let mut web = Vec::new();
    for port in asked(&now, &printed) {
        let Some(url) = loopback(port) else { continue };
        if super::head(&app, &url, true, WEB_WAIT).await.is_ok() {
            web.push(port);
        }
    }
    Ok(candidates(&now, &printed, |p| web.contains(&p)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow067_listening_ports_are_read_from_netstat_and_lsof() {
        let netstat = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1200\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4321\n  TCP    [::]:5173              [::]:0                 LISTENING       4321\n  TCP    127.0.0.1:52000        127.0.0.1:443          ESTABLISHED     77\n  UDP    0.0.0.0:5353           *:*                                    9\n";
        assert_eq!(parse_netstat(netstat), vec![Listening { port: 135, pid: 1200 }, Listening { port: 5173, pid: 4321 }]);
        let lsof = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode    4321 me  23u IPv4 0xabc 0t0 TCP *:5173 (LISTEN)\npostgres 88 me 7u IPv6 0xdef 0t0 TCP [::1]:5432 (LISTEN)\n";
        assert_eq!(parse_lsof(lsof), vec![Listening { port: 5173, pid: 4321 }, Listening { port: 5432, pid: 88 }]);
    }

    #[test]
    fn t726_the_shared_table_shows_an_ipv6_only_dev_server_and_skips_udp() {
        // The Ports popover's `netstat -ano` (no `-p tcp`) also lists IPv6 and UDP, so a dev server
        // bound only to [::1] now shows on the Preview button; UDP never does.
        let netstat = "  TCP    [::1]:5173             [::]:0                 LISTENING       4321\n  UDP    0.0.0.0:5353           *:*                                    900\n  UDP    [::]:3000              *:*                                    901\n";
        assert_eq!(parse_netstat(netstat), vec![Listening { port: 5173, pid: 4321 }]);
    }

    #[test]
    fn brow067_candidates_are_the_printed_local_addresses_that_listen_ranked() {
        let listening = [Listening { port: 5173, pid: 1 }, Listening { port: 3000, pid: 2 }, Listening { port: 5432, pid: 3 }];
        let printed = ["http://localhost:5173/".to_string(), "http://0.0.0.0:3000".into(), "http://localhost:8080".into(), "https://example.com/".into(), "postgres://localhost:5432".into()];
        let got = candidates(&listening, &printed, |p| p == 3000);
        // 8080 is not listening, example.com is not local, 5432 is not a web address; the HTTP
        // speaker ranks first, the printed address is kept as printed, 0.0.0.0 reads as localhost.
        assert_eq!(got.iter().map(|c| (c.port, c.web)).collect::<Vec<_>>(), vec![(3000, true), (5173, false)]);
        assert_eq!(got[0].host, "localhost");
        assert_eq!(got[0].url, "http://0.0.0.0:3000");
        assert_eq!(local_address("http://127.0.0.1:5173/x"), Some(("127.0.0.1".into(), 5173)));
        assert_eq!(local_address("http://app.localhost/"), Some(("app.localhost".into(), 80)));
        assert_eq!(local_address("http://[::1]:4000"), Some(("localhost".into(), 4000)));
        assert_eq!(local_address("http://192.168.1.4:5173"), None);
        // Ties: a printed one first, then a web one, then the smaller port.
        let mut list = vec![Candidate { host: "localhost".into(), port: 9000, url: String::new(), printed: false, web: true }, Candidate { host: "localhost".into(), port: 8000, url: String::new(), printed: false, web: false }, Candidate { host: "localhost".into(), port: 8500, url: String::new(), printed: false, web: true }];
        rank(&mut list);
        assert_eq!(list.iter().map(|c| c.port).collect::<Vec<_>>(), vec![8500, 9000, 8000]);
    }

    #[test]
    fn app070_only_listening_printed_ports_are_asked_and_through_the_near_client() {
        let listening = [Listening { port: 5173, pid: 1 }, Listening { port: 3000, pid: 2 }];
        let printed = ["http://localhost:5173/".to_string(), "http://127.0.0.1:5173/x".into(), "http://localhost:8080".into(), "https://example.com/".into(), "http://0.0.0.0:3000".into()];
        assert_eq!(asked(&listening, &printed), vec![5173, 3000]);
        assert_eq!(loopback(5173).unwrap().as_str(), "http://127.0.0.1:5173/");
        // A web server answers the HEAD; a port that closes without an HTTP answer does not.
        let clients = super::super::icon_clients(None, |_| Ok(vec![])).unwrap();
        let web = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let web_port = web.local_addr().unwrap().port();
        let mute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mute_port = mute.local_addr().unwrap().port();
        let a = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut s, _) = web.accept().unwrap();
            let _ = s.read(&mut [0u8; 1024]);
            s.write_all(b"HTTP/1.0 404 Not Found\r\n\r\n").unwrap();
        });
        let b = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut s, _) = mute.accept().unwrap();
            let _ = s.read(&mut [0u8; 1024]);
            s.write_all(b"\x00\x00\x00\x08garbage!").unwrap();
        });
        let ask = |p| tauri::async_runtime::block_on(super::super::head_with(&clients, &loopback(p).unwrap(), true, WEB_WAIT)).is_ok();
        assert!(ask(web_port));
        assert!(!ask(mute_port));
        a.join().unwrap();
        b.join().unwrap();
    }
}
