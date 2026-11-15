//! The app's own network policy and its one approved HTTP client (APP-070), kept from the removed
//! in-app browser pane (Goal 0, 2026-11-12: web pages open in the user's own browser).
//!
//! - The URL policy: `allowed` (never one of the app's own `*.localhost` origins), `local_host` /
//!   `local_ip` (this machine or the local network), `hop_ok` (every redirect checked again).
//! - The clients: `icon_clients` (a near and a public-only far client, never through a proxy, with
//!   their own name lookup), `fetch_icon_within` (project and site icons, web_icon.rs) and `head`
//!   (the update check's installer probe, update.rs), which never goes around a saved or system
//!   proxy (T-323-c/d/e).
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};

/// Icons larger than this are not shown (a real site icon is a few kilobytes).
const ICON_MAX: usize = 256 * 1024;

/// Whether an address names this machine or the local network rather than the public web:
/// loopback, private, link-local, carrier-grade NAT and unspecified addresses, `localhost`, and
/// names that only a local network resolves (no dot, `.local`, `.lan`, `.internal`, `.home.arpa`).
/// A public name that resolves to such an address is caught by the icon fetch's own lookup
/// (`Resolver`), which also covers a name rebound after the page loaded (council FIX-2, FS2).
pub fn local_host(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(ip) => local_ip(ip),
        Err(_) => {
            let d = host.trim_end_matches('.').to_ascii_lowercase();
            d.is_empty() || !d.contains('.') || [".localhost", ".local", ".lan", ".internal", ".home.arpa"].iter().any(|s| d.ends_with(s))
        }
    }
}

/// Whether an address is on this machine or the local network: loopback, private, link-local,
/// carrier-grade NAT, `0.0.0.0/8` and broadcast, and the IPv6 forms of those, including an IPv4
/// address written as IPv6 (mapped `::ffff:a.b.c.d` or compatible `::a.b.c.d`, council FIX-2).
/// Council FIX-3 adds, whole: `198.18.0.0/15` (benchmarking), `192.0.0.0/24`, `240.0.0.0/4`
/// (reserved, broadcast inside), NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16` and
/// site-local `fec0::/10`, each of which can carry or reach a local IPv4 address.
pub fn local_ip(ip: IpAddr) -> bool {
    let v4 = |ip: Ipv4Addr| {
        let [a, b, c, _] = ip.octets();
        a == 0
            || ip.is_loopback()
            || ip.is_private()
            || ip.is_link_local()
            || (a == 100 && (b & 0xc0) == 64)
            || (a == 198 && (b & 0xfe) == 18)
            || (a == 192 && b == 0 && c == 0)
            || a >= 240
    };
    match ip {
        IpAddr::V4(ip) => v4(ip),
        IpAddr::V6(ip) => {
            let g = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || (g[0] & 0xfe00) == 0xfc00
                || (g[0] & 0xffc0) == 0xfe80
                || (g[0] & 0xffc0) == 0xfec0
                || g[0] == 0x2002
                || (g[0] == 0x64 && g[1] == 0xff9b && (g[2..6] == [0; 4] || g[2] == 1))
                || ip.to_ipv4().is_some_and(v4)
        }
    }
}

/// How many redirects an icon fetch follows.
const ICON_HOPS: usize = 5;

/// Whether an icon fetch may follow a redirect to `next`, given the addresses already asked
/// (`previous`, first the icon address the page gave): the same rule as a tab's address on every
/// hop, never from https down to http, and never onto this machine or the local network unless
/// the chain started on that very host.
pub fn hop_ok(next: &Url, previous: &[Url], app: Option<&Url>) -> bool {
    let (Some(first), Some(last)) = (previous.first(), previous.last()) else { return false };
    previous.len() <= ICON_HOPS
        && next.scheme() != "about"
        && allowed(next, app).is_ok()
        && !(last.scheme() == "https" && next.scheme() == "http")
        && (!local_host(next) || same_spot(next, first))
}

/// How the icon fetch looks a host name up: the system's own lookup, or a stand-in in tests.
pub type Lookup = fn(&str) -> std::io::Result<Vec<IpAddr>>;

fn system_lookup(host: &str) -> std::io::Result<Vec<IpAddr>> {
    use std::net::ToSocketAddrs;
    Ok((host, 0).to_socket_addrs()?.map(|a| a.ip()).collect())
}

/// The addresses an icon fetch for another host may connect to (council FIX-2, FS2).
pub fn public_addrs(ips: Vec<IpAddr>) -> Vec<IpAddr> {
    ips.into_iter().filter(|ip| !local_ip(*ip)).collect()
}

/// The icon fetch's own name lookup: for any host other than the page's own, only public
/// addresses come back, so a public name that points at this machine or the local network
/// (`192-168-1-1.nip.io`, `localtest.me`, or a name rebound after the page loaded) is never asked.
struct Resolver {
    lookup: Lookup,
    public: bool,
}

impl reqwest::dns::Resolve for Resolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let (lookup, public, host) = (self.lookup, self.public, name.as_str().to_string());
        Box::pin(async move {
            let ips = tauri::async_runtime::spawn_blocking(move || lookup(&host)).await??;
            let ips = if public { public_addrs(ips) } else { ips };
            if ips.is_empty() {
                return Err("the icon host is on this machine or the local network".into());
            }
            let addrs: reqwest::dns::Addrs = Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

/// The two icon clients, both built by the one `icon_client_for` builder line. `near` fetches a
/// page's own-host icon only when that page is itself open on this machine or the local network
/// (`icon_near`); a redirect off that host stops and is handed to `far`. `far` fetches every
/// other icon, a public page's own-host icon included, through the public-only lookup. Neither
/// goes through a proxy (a proxy would resolve the name where the lookup cannot see it), so with a saved
/// proxy no icon is fetched at all (T-323-c: `fetch_icon_unless_proxied`; never around the proxy).
/// DNS rebinding: a public name rebound to a local address after its page loaded reaches `far`
/// as an empty lookup and is never asked (council FIX-3: reqwest goes through none of the
/// engine's local-network checks, so `near` never serves a public page).
pub struct IconClients {
    near: reqwest::Client,
    far: reqwest::Client,
}

/// An icon client with the redirect rule above: a refused hop fails the fetch.
fn icon_client_for(app: Option<Url>, near: bool, lookup: Lookup) -> Option<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(move |hop| {
        let same = hop.previous().first().is_some_and(|first| same_spot(first, hop.url()));
        if !hop_ok(hop.url(), hop.previous(), app.as_ref()) {
            // Only the scheme and host: the path or query of an address can carry a token.
            let to = format!("{}://{}", hop.url().scheme(), hop.url().host_str().unwrap_or("?"));
            hop.error(format!("icon redirect to {to} refused"))
        } else if near && !same {
            hop.stop()
        } else {
            hop.follow()
        }
    });
    let resolver = Resolver { lookup, public: !near };
    reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(policy).no_proxy().dns_resolver(resolver).build().ok()
}

pub fn icon_clients(app: Option<Url>, lookup: Lookup) -> Option<IconClients> {
    Some(IconClients { near: icon_client_for(app.clone(), true, lookup)?, far: icon_client_for(app, false, lookup)? })
}

/// The clients every icon fetch shares (the dev origin never changes while the app runs).
fn icon_client(app: Option<Url>) -> Option<&'static IconClients> {
    static CLIENTS: OnceLock<Option<IconClients>> = OnceLock::new();
    CLIENTS.get_or_init(move || icon_clients(app, system_lookup)).as_ref()
}

/// The icon bytes as a data: address, if the server said it is an image and it is small enough.
pub fn icon_data(kind: &str, bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let kind = kind.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    if !kind.starts_with("image/") || bytes.is_empty() || bytes.len() > ICON_MAX {
        return None;
    }
    Some(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Whether two addresses name the same host on the same port, a scheme's default port counting
/// as written (council FIX-4, AFTER 2): a page on one port of this machine never reaches another.
pub fn same_spot(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// What is left of an icon fetch's time limit after `elapsed`; `None` once it has run out
/// (council FIX-4, AFTER 3: the far request after a hand-off gets only this).
pub fn time_left(elapsed: Duration, limit: Duration) -> Option<Duration> {
    limit.checked_sub(elapsed).filter(|d| !d.is_zero())
}

/// Where a redirect the near client stopped at goes next, if the far client may follow it: the
/// `Location` joined to the address that answered, under the same rule as every other hop.
pub fn hand_off(from: &Url, location: Option<&str>, app: Option<&Url>) -> Option<Url> {
    let next = from.join(location?).ok()?;
    hop_ok(&next, std::slice::from_ref(from), app).then_some(next)
}

/// T-323-c: whether an icon may be fetched. The icon clients connect directly (their public-only name
/// lookup would not see a proxy's side), so a saved proxy, or one that cannot be read, means no icon
/// rather than a connection around the user's proxy. An empty setting means "the system's proxy"
/// (OD-18): it allows the fetch only while [`system_proxy_in_use`] says there is none (T-323-e).
pub fn icon_fetch_allowed(saved: &Result<Option<String>, String>) -> bool {
    matches!(saved, Ok(p) if matches!(proxy_of(p.as_deref()), Ok(None))) && !system_proxy_in_use()
}

/// T-323-e: whether the system names a proxy: the Windows per-user proxy (`ProxyEnable` 1 with a
/// `ProxyServer`) or a PAC script (`AutoConfigURL`), or a proxy environment variable on any platform.
/// ponytail: "Automatically detect settings" (WPAD) alone is not counted: it is on by default on most
/// Windows machines, so failing closed on it would remove icons for nearly everyone. A WPAD-only
/// proxy still goes unseen, as do macOS and Linux desktop proxy settings (no process spawned per check).
pub(crate) fn system_proxy_from(enable: Option<u32>, server: Option<&str>, pac: Option<&str>, env: impl Fn(&str) -> Option<String>) -> bool {
    let set = |v: Option<&str>| v.is_some_and(|v| !v.trim().is_empty());
    (enable == Some(1) && set(server))
        || set(pac)
        || ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].iter().any(|n| set(env(n).as_deref()))
}

/// The machine's proxy settings, read now. A read error or a missing key (the normal case) is "not in use".
fn read_system_proxy() -> bool {
    #[cfg(windows)]
    let (enable, server, pac) = {
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
        const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (key, name) = (wide(KEY), wide("ProxyEnable"));
        let (mut value, mut bytes) = (0u32, 4u32);
        // SAFETY: both strings are NUL-terminated and outlive the call; `value` holds the 4 bytes a DWORD needs.
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&mut value as *mut u32).cast(), &mut bytes) };
        let reg = |v: &str| crate::agents::registry_string(HKEY_CURRENT_USER, KEY, v);
        ((rc == 0).then_some(value), reg("ProxyServer"), reg("AutoConfigURL"))
    };
    #[cfg(not(windows))]
    let (enable, server, pac): (Option<u32>, Option<String>, Option<String>) = (None, None, None);
    system_proxy_from(enable, server.as_deref(), pac.as_deref(), |n| std::env::var(n).ok())
}

/// [`read_system_proxy`], remembered for 30 s: icons and HEADs fire often and there is no watcher.
#[cfg(not(test))]
fn system_proxy_in_use() -> bool {
    static SEEN: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    match *seen {
        Some((at, v)) if at.elapsed() < Duration::from_secs(30) => v,
        _ => {
            let v = read_system_proxy();
            *seen = Some((Instant::now(), v));
            v
        }
    }
}

// Tests never read this machine's registry or environment: the answer is set per test thread.
#[cfg(test)]
thread_local! {
    static SYSTEM_PROXY_FOR_TEST: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn system_proxy_in_use() -> bool {
    SYSTEM_PROXY_FOR_TEST.with(|c| c.get())
}

#[cfg(test)]
fn set_system_proxy_for_test(on: bool) {
    SYSTEM_PROXY_FOR_TEST.with(|c| c.set(on));
}

/// The sealed proxy setting as saved (None without a store or a value).
fn saved_proxy(app: &AppHandle) -> Result<Option<String>, String> {
    match app.try_state::<Mutex<crate::state::Store>>() {
        Some(store) => {
            let store = store.lock().map_err(|e| e.to_string())?;
            proxy_in_profile(store.try_settings(), &store.dir())
        },
        None => Ok(None),
    }
}

const SETTINGS_UNREADABLE: &str = "Kolux can't read its settings, so it makes no direct request in case a proxy is set. Nothing was loaded directly; restart Kolux or check settings.json.";

/// The saved `httpProxy`, opened. A file that cannot be read is an error, never "no proxy"; a file
/// that is simply not there (first run) reads as no settings.
fn proxy_in_settings(read: std::io::Result<serde_json::Value>) -> Result<Option<String>, String> {
    match read.map_err(|_| SETTINGS_UNREADABLE.to_string())?.get("httpProxy") {
        Some(serde_json::Value::String(s)) if !s.is_empty() => crate::secrets::unseal(s).map(Some),
        _ => Ok(None),
    }
}

/// `proxy_in_settings` plus a second look at the last good copy for a missing settings.json (the
/// load itself reads that copy since row 944; this is the belt for a copy too damaged to say). That is "can't read", never "no proxy".
fn proxy_in_profile(read: std::io::Result<serde_json::Value>, dir: &std::path::Path) -> Result<Option<String>, String> {
    let saved = proxy_in_settings(read)?;
    if saved.is_some() || !matches!(std::fs::metadata(dir.join("settings.json")), Err(e) if e.kind() == std::io::ErrorKind::NotFound) {
        return Ok(saved);
    }
    match std::fs::read(dir.join("settings.json.bak")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(SETTINGS_UNREADABLE.to_string()),
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) if v.is_object() && v.get("httpProxy").is_none_or(|p| p.as_str() == Some("")) => Ok(None),
            _ => Err(SETTINGS_UNREADABLE.to_string()),
        },
    }
}

/// Fetches an icon (`near`: the icon is on the page's own host), reading no more of the body than
/// an icon may be: a non-image answer or one that says it is too large is dropped before its body
/// is read, and a body that turns out too large is dropped as soon as it passes the limit.
/// The fetch under one overall time limit: each request's own timeout runs until its body is
/// read, and the far request after a hand-off gets only what the near one left. The redirect cap
/// is per client, so a hand-off can take up to twice `ICON_HOPS` hops, all inside the limit.
pub(crate) async fn fetch_icon_within(clients: &IconClients, near: bool, url: Url, app: Option<&Url>, limit: Duration) -> Option<String> {
    let start = Instant::now();
    let mut res = if near { &clients.near } else { &clients.far }.get(url).timeout(limit).send().await.ok()?;
    if near && res.status().is_redirection() {
        // The near client stopped at a redirect off the page's host: the rest is the far client's.
        let next = hand_off(res.url(), res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()), app)?;
        let left = time_left(start.elapsed(), limit)?;
        res = clients.far.get(next).timeout(left).send().await.ok()?;
    }
    let mut res = res.error_for_status().ok()?;
    let kind = res.headers().get(reqwest::header::CONTENT_TYPE)?.to_str().ok()?.to_string();
    if !kind.trim().to_ascii_lowercase().starts_with("image/") || res.content_length().is_some_and(|n| n > ICON_MAX as u64) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        if body.len() + chunk.len() > ICON_MAX {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    icon_data(&kind, &body)
}

/// Whether a tab may go to `url` (T-500): http, https or the blank page only. A `*.localhost`
/// host is where the app itself (tauri.localhost), its IPC (ipc.localhost) and every custom scheme
/// (kolux-artifact.localhost) answer, and `app` is the app's own origin in a development build;
/// Tauri counts a page at any of those as its own and opens every app command to it, so a tab
/// never goes there. Plain `localhost` (a user's own dev server) is fine.
pub fn allowed(url: &Url, app: Option<&Url>) -> Result<(), String> {
    if url.as_str() == "about:blank" {
        return Ok(());
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("{}: addresses do not open in a browser tab", url.scheme()));
    }
    // `tauri.localhost.` is the same host as `tauri.localhost` (council FIX-2, AFTER 5).
    let host = url.host_str().unwrap_or_default().trim_end_matches('.');
    let app_own = |a: &Url| a.scheme() == url.scheme() && a.port_or_known_default() == url.port_or_known_default() && a.host_str().map(|h| h.trim_end_matches('.')) == Some(host);
    if host.ends_with(".localhost") || app.is_some_and(app_own) {
        return Err(format!("{host} is the app's own address and does not open in a browser tab"));
    }
    Ok(())
}

/// The app's own origin while it runs from the dev server; a release build serves itself from a
/// `*.localhost` host, which `allowed` refuses on its own.
fn app_origin(app: &AppHandle) -> Option<Url> {
    tauri::is_dev().then(|| app.config().build.dev_url.clone()).flatten()
}

/// BROW-033: the sealed `httpProxy` setting as the engine takes it. Empty means the system's own
/// proxy (OD-18's default); anything else must be an http:// or socks5:// address with a host, or
/// the tab is not opened. The value itself never goes into a message: it may carry credentials
/// (SAFE-026 seals it for that reason).
pub fn proxy_of(setting: Option<&str>) -> Result<Option<Url>, String> {
    let Some(v) = setting.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    // The URL parser drops tabs and newlines inside the text, so a setting holding one would pass as another address.
    match Url::parse(v) {
        Ok(u) if matches!(u.scheme(), "http" | "socks5") && u.host_str().is_some() && !v.chars().any(char::is_control) => Ok(Some(u)),
        _ => Err("the HTTP proxy setting is not an http:// or socks5:// address with a host; the tab stays closed until the setting is fixed or cleared".into()),
    }
}

/// This computer's own names and addresses (plain http to them counts as secure).
pub fn loopback(host: &str) -> bool {
    let h = host.trim_end_matches('.').trim_start_matches('[').trim_end_matches(']');
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    h.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// What a HEAD request through the approved clients got back: the status and the length the
/// answer says its body has.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Answer {
    pub status: u16,
    pub length: Option<u64>,
}

/// Why a HEAD request through the approved clients failed: the error chain's text, whether it ran
/// out of time, and the socket error underneath when there is one.
#[derive(Debug, Clone, PartialEq)]
pub struct Failed {
    pub text: String,
    pub timeout: bool,
    pub io: Option<std::io::ErrorKind>,
}

/// The socket error somewhere down an error's chain of causes.
fn io_kind(e: &(dyn std::error::Error + 'static)) -> Option<std::io::ErrorKind> {
    let mut cur = Some(e);
    while let Some(x) = cur {
        if let Some(io) = x.downcast_ref::<std::io::Error>() {
            return Some(io.kind());
        }
        cur = x.source();
    }
    None
}

/// APP-070: every request Kolux itself makes (the update check's installer probe) is one HEAD
/// through the icon clients, the one approved way out: `near` for an address on this machine or
/// the local network, the public-only client otherwise, both without a proxy and under the icon
/// redirect rule. Nothing of the body is read. This one asks unconditionally; `head` is the way in
/// for the app, because it never goes around a saved proxy (T-323-d): a connection Kolux makes
/// itself is made direct, so under a saved (or unreadable, or unusable, or in-use system) proxy
/// only this machine's own addresses are asked (a proxy never carries them); every other address,
/// the local network included, is skipped with [`PROXY_SKIPPED`] and no connection. The caller
/// then makes no installer check.
pub async fn head_with(clients: &IconClients, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    match if near { &clients.near } else { &clients.far }.head(url.clone()).timeout(wait).send().await {
        Ok(r) => Ok(Answer { status: r.status().as_u16(), length: r.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse().ok()) }),
        Err(e) => Err(Failed { text: error_text(&e), timeout: e.is_timeout(), io: io_kind(&e) }),
    }
}

/// T-323-d: what a skipped request says; the diagnosis tells it from a real failure by this text.
pub const PROXY_SKIPPED: &str = "skipped: a proxy is saved, so Kolux made no direct request";

/// Whether the request may be made at all: without a proxy (saved, or the system's when the setting is empty: T-323-e) always, with one (or one that cannot
/// be read or used) only to this machine's own addresses, which no proxy carries.
pub fn head_gate(saved: &Result<Option<String>, String>, url: &Url) -> Result<(), Failed> {
    if icon_fetch_allowed(saved) || url.host_str().is_some_and(loopback) {
        return Ok(());
    }
    Err(Failed { text: PROXY_SKIPPED.into(), timeout: false, io: None })
}

#[cfg(test)]
pub fn proxy_skipped(f: &Failed) -> bool {
    f.text == PROXY_SKIPPED
}

/// `head_with` unless a proxy is saved: then no connection is made.
pub(crate) async fn head_unless_proxied(saved: &Result<Option<String>, String>, clients: &IconClients, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    head_gate(saved, url)?;
    head_with(clients, url, near, wait).await
}

/// `head_unless_proxied` through the clients the app shares: the one way the app asks anything directly.
pub async fn head(app: &AppHandle, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    let Some(clients) = icon_client(app_origin(app)) else {
        return Err(Failed { text: "no network client".into(), timeout: false, io: None });
    };
    head_unless_proxied(&saved_proxy(app), clients, url, near, wait).await
}

fn error_text(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(" / ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    /// How long one icon fetch may take in all in these tests (what the removed pane used).
    const ICON_TIME: Duration = Duration::from_secs(8);
    /// How long one HEAD may take in these tests.
    const DIAGNOSE_WAIT: Duration = Duration::from_secs(4);

    async fn fetch_icon(clients: &IconClients, near: bool, url: Url, app: Option<&Url>) -> Option<String> {
        fetch_icon_within(clients, near, url, app, ICON_TIME).await
    }

    /// `fetch_icon` unless a proxy is saved: then no connection is made and there is no icon.
    async fn fetch_icon_unless_proxied(saved: &Result<Option<String>, String>, clients: &IconClients, near: bool, url: Url, app: Option<&Url>) -> Option<String> {
        if !icon_fetch_allowed(saved) {
            return None;
        }
        fetch_icon(clients, near, url, app).await
    }

    /// Whether an icon goes through the near client: it is on the page's own host and that page is
    /// itself on this machine or the local network (council FIX-3).
    fn icon_near(url: &Url, page: &Url) -> bool {
        local_host(page) && same_spot(url, page)
    }

    #[test]
    fn t500_a_tab_never_opens_an_origin_tauri_counts_as_the_apps_own() {
        // evidence/T-500-isolation.txt: a page at the dev origin or at a custom-scheme host got
        // every app command; remote http, https and the blank page are what a tab is for.
        let dev = Url::parse("http://localhost:1420").unwrap();
        let ok = |u: &str| allowed(&Url::parse(u).unwrap(), Some(&dev));
        assert_eq!(ok("https://example.com/"), Ok(()));
        assert_eq!(ok("http://localhost:3000/app"), Ok(()));
        assert_eq!(ok("http://127.0.0.1:8745/probe.html"), Ok(()));
        assert_eq!(ok("about:blank"), Ok(()));
        assert!(ok("http://localhost:1420/kolux-probe").unwrap_err().contains("app's own address"));
        assert!(ok("http://kolux-artifact.localhost/x/index.html").unwrap_err().contains("app's own address"));
        assert!(ok("http://tauri.localhost/").unwrap_err().contains("app's own address"));
        assert!(ok("https://ipc.localhost/app_info").is_err());
        assert!(ok("file:///G:/Temp/browser-t195/probe.html").unwrap_err().starts_with("file: addresses do not open"));
        assert!(ok("tauri://localhost/").is_err());
        assert!(ok("javascript:alert(1)").is_err());
        // A release build has no dev origin; the *.localhost rule still holds.
        assert_eq!(allowed(&Url::parse("http://localhost:1420/").unwrap(), None), Ok(()));
        assert!(allowed(&Url::parse("http://tauri.localhost/").unwrap(), None).is_err());
    }

    #[test]
    fn brow023_the_site_icon_is_a_small_image() {
        assert_eq!(icon_data("image/png", &[1, 2, 3]), Some("data:image/png;base64,AQID".into()));
        assert_eq!(icon_data("Image/X-Icon; charset=binary", &[1]), Some("data:image/x-icon;base64,AQ==".into()));
        assert_eq!(icon_data("text/html", b"<html>"), None);
        assert_eq!(icon_data("image/png", &[]), None);
        assert_eq!(icon_data("image/png", &vec![0; ICON_MAX + 1]), None);
    }

    #[test]
    fn fix1_c_this_machine_and_the_local_network_are_local_and_the_public_web_is_not() {
        for icon in [
            "http://127.0.0.1:8745/x.ico",
            "http://localhost/favicon.ico",
            "http://[::1]/x",
            "http://[fe80::1]/x",
            "http://[fd00::5]/x",
            "http://[::ffff:192.168.0.1]/x",
            "http://192.168.1.1/x",
            "http://10.0.0.1/x",
            "http://172.16.4.4/x",
            "http://169.254.169.254/latest",
            "http://100.64.0.1/x",
            "http://0.0.0.0/x",
            "http://router/x",
            "http://nas.local/x",
            "http://box.lan/x",
            "http://svc.internal/x",
        ] {
            assert!(local_host(&Url::parse(icon).unwrap()), "{icon}");
        }
        for public in ["https://cdn.example.net/i.png", "https://8.8.8.8/i.png", "https://[2001:db8::1]/i.png"] {
            assert!(!local_host(&Url::parse(public).unwrap()), "{public}");
        }
    }

    #[test]
    fn fix1_c_every_redirect_hop_is_checked_again() {
        let u = |s: &str| Url::parse(s).unwrap();
        let https = [u("https://example.com/favicon.ico")];
        assert!(hop_ok(&u("https://cdn.example.net/i.png"), &https, None));
        assert!(!hop_ok(&u("http://cdn.example.net/i.png"), &https, None), "https down to http");
        assert!(hop_ok(&u("http://cdn.example.net/i.png"), &[u("http://example.com/x")], None));
        assert!(!hop_ok(&u("http://192.168.1.1/"), &https, None));
        assert!(!hop_ok(&u("https://localhost:3000/"), &https, None));
        assert!(!hop_ok(&u("https://tauri.localhost/"), &https, None));
        assert!(!hop_ok(&u("file:///C:/Windows/win.ini"), &https, None));
        assert!(!hop_ok(&u("about:blank"), &https, None));
        let app = u("http://localhost:1420");
        let local = [u("http://localhost:3000/favicon.ico")];
        assert!(hop_ok(&u("http://localhost:3000/real.ico"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://localhost:1420/x"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://192.168.0.1/"), &local, Some(&app)));
        let long: Vec<Url> = (0..=ICON_HOPS).map(|i| u(&format!("https://example.com/{i}"))).collect();
        assert!(!hop_ok(&u("https://example.com/next"), &long, None));
        assert!(!hop_ok(&u("https://example.com/next"), &[], None));
    }

    /// One HTTP answer on a loopback port: `head` (status line and headers), then `body` bytes.
    /// The thread returns whether the whole body went out.
    fn answer_once(head: String, body: usize) -> (Url, std::thread::JoinHandle<bool>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let (mut buf, mut got) = ([0u8; 4096], Vec::new());
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => return false,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
            }
            if s.write_all(head.as_bytes()).is_err() {
                return false;
            }
            let (chunk, mut sent) = (vec![7u8; 64 * 1024], 0);
            while sent < body {
                let n = chunk.len().min(body - sent);
                if s.write_all(&chunk[..n]).is_err() {
                    return false;
                }
                sent += n;
            }
            true
        });
        (url, t)
    }

    #[test]
    fn fix1_b_the_icon_fetch_stops_reading_past_the_limit() {
        let clients = icon_clients(None, system_lookup).unwrap();
        let fetch = |url: Url| tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None));
        let big = 32 * 1024 * 1024;
        // No length given: the body is read only until it passes the limit.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "the whole 32 MB body was read");
        // A length over the limit: refused before the body is read.
        let (url, server) = answer_once(format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {big}\r\n\r\n"), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a body said to be 32 MB was read");
        // Not an image: refused before the body is read.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a 32 MB page was read as an icon");
        // A real icon still comes through.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n".into(), 3);
        assert_eq!(fetch(url), Some("data:image/png;base64,BwcH".into()));
        assert!(server.join().unwrap());
    }

    #[test]
    fn fix1_c_the_icon_client_refuses_a_redirect_onto_another_local_host() {
        use std::io::{Read, Write};
        // The second host: counts whether anything asked it.
        let second = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = second.local_addr().unwrap().port();
        second.set_nonblocking(true).unwrap();
        // The first answer sends the fetch to the same machine under another name.
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://localhost:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        let clients = icon_clients(None, system_lookup).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        let start = Instant::now();
        let mut asked = false;
        while start.elapsed() < Duration::from_millis(500) {
            if let Ok((mut s, _)) = second.accept() {
                asked = true;
                let _ = s.read(&mut [0u8; 64]);
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!asked, "the redirect onto localhost was followed");
        // A redirect within the host and port the chain started on is followed (council FIX-4,
        // AFTER 2: another port of that host is refused, fix4_2_a_same_host_redirect_...).
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let answers: [&[u8]; 2] = [
                b"HTTP/1.1 302 Found\r\nLocation: /real.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07",
            ];
            let mut asked = Vec::new();
            for answer in answers {
                let (mut s, _) = l.accept().unwrap();
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                asked.push(String::from_utf8_lossy(&got).lines().next().unwrap_or_default().to_string());
                let _ = s.write_all(answer);
            }
            asked
        });
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(server.join().unwrap(), ["GET /favicon.ico HTTP/1.1", "GET /real.png HTTP/1.1"]);
    }

    /// A refused redirect names only the scheme and host it was sent to: the path and query of an
    /// address can carry a token, and the error text may be shown or logged.
    #[test]
    fn a_refused_icon_redirect_names_the_host_and_never_the_query() {
        let (url, first) = answer_once("HTTP/1.1 302 Found\r\nLocation: http://localhost:9/p/x.png?token=made-up-QUERY-VALUE\r\nContent-Length: 0\r\n\r\n".into(), 0);
        let clients = icon_clients(None, system_lookup).unwrap();
        let err = tauri::async_runtime::block_on(async { clients.near.get(url).send().await }).expect_err("the hop is refused");
        first.join().unwrap();
        let mut text = err.to_string();
        let mut cause = std::error::Error::source(&err);
        while let Some(e) = cause {
            text.push_str(&format!(" | {e}"));
            cause = e.source();
        }
        assert!(text.contains("icon redirect to http://localhost refused"), "{text}");
        assert!(!text.contains("made-up-QUERY-VALUE") && !text.contains("/p/x.png"), "{text}");
    }

    /// An icon server on a loopback port that answers every request with a 3-byte image; the
    /// count is how many connections reached it.
    fn icon_server() -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = hits.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { continue };
                seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07");
            }
        });
        (port, hits)
    }

    /// A stand-in lookup: every name is this machine (what nip.io, localtest.me or a rebound
    /// name answers), so no test ever asks the real network.
    fn to_this_machine(_: &str) -> std::io::Result<Vec<IpAddr>> {
        Ok(vec![IpAddr::from([127, 0, 0, 1])])
    }

    // Council FIX-2, FS2.
    #[test]
    fn fix2_b_a_public_name_that_resolves_to_this_machine_is_never_asked() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for name in ["192-168-1-1.nip.io", "localtest.me", "rebound.example.com"] {
            let url = Url::parse(&format!("http://{name}:{port}/favicon.ico")).unwrap();
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, false, url, None)), None, "{name}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "an icon fetch reached this machine through a public name");
        // Council FIX-3: a page on that very public name gets no icon from there either (a name
        // rebound after the page loaded would take the fetch onto this machine).
        let own = Url::parse(&format!("http://localtest.me:{port}/favicon.ico")).unwrap();
        let page = Url::parse(&format!("http://localtest.me:{port}/")).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&own, &page), own, None)), None);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn fix2_b_a_redirect_off_the_pages_own_host_goes_through_the_public_lookup() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://lan-box.example:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached this machine through a public name");
    }

    #[test]
    fn fix2_b_the_public_lookup_keeps_only_public_addresses() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let all = [
            "127.0.0.1", "192.168.1.1", "10.0.0.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::5",
            "::ffff:10.0.0.1", "::7f00:1", "8.8.8.8", "2001:db8::1",
        ];
        assert_eq!(public_addrs(all.map(ip).to_vec()), vec![ip("8.8.8.8"), ip("2001:db8::1")]);
    }

    // Council FIX-2, AFTER 4 and 5.
    #[test]
    fn fix2_c_ipv4_compatible_addresses_and_a_trailing_dot_are_caught() {
        let u = |s: &str| Url::parse(s).unwrap();
        for s in ["http://[::7f00:1]/", "http://[::a00:1]/", "http://[::c0a8:101]/"] {
            assert!(local_host(&u(s)), "{s}");
        }
        assert!(!local_host(&u("http://[::808:808]/")));
        assert!(allowed(&u("http://tauri.localhost./"), None).is_err());
        assert!(allowed(&u("http://ipc.localhost./x"), None).is_err());
        let app = u("http://localhost:1420");
        assert!(allowed(&u("http://localhost.:1420/"), Some(&app)).is_err());
        assert!(allowed(&u("http://localhost:3000/"), Some(&app)).is_ok());
        assert!(allowed(&u("https://example.com./"), Some(&app)).is_ok());
    }

    // Council FIX-3, FIX-BEFORE 1: DNS rebinding through the page's own name, on any port.
    #[test]
    fn fix3_1_a_public_pages_own_name_goes_through_the_public_lookup_on_any_port() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for (page, icon) in [
            ("http://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            ("https://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            (format!("http://rb.example:{port}/"), format!("http://rb.example:{port}/favicon.ico")),
        ] {
            let (page, icon) = (Url::parse(&page).unwrap(), Url::parse(&icon).unwrap());
            assert!(!icon_near(&icon, &page), "{page} {icon}");
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&icon, &page), icon, None)), None);
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "a rebound public name reached this machine");
        // A page that is itself on this machine or the local network still gets its own icon.
        let page = Url::parse(&format!("http://localhost:{port}/app")).unwrap();
        let icon = Url::parse(&format!("http://localhost:{port}/favicon.ico")).unwrap();
        assert!(icon_near(&icon, &page));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, icon, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(!icon_near(&Url::parse("http://other.lan/x").unwrap(), &Url::parse("http://box.lan/").unwrap()));
    }

    // Council FIX-3, AFTER 1.
    #[test]
    fn fix3_3_translation_and_reserved_ranges_are_local() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let local = [
            "64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b:1::1", "64:ff9b:1:ffff::1", "2002:c0a8:101::1", "2002:808:808::1", "fec0::1", "feff::1",
            "198.18.0.1", "198.19.255.255", "192.0.0.8", "240.0.0.1", "255.255.255.254",
        ];
        for s in local {
            assert!(local_ip(ip(s)), "{s}");
        }
        let public = ["198.17.255.255", "198.20.0.1", "192.0.1.1", "64:ff9c::1", "64:ff9b:2::1", "2003::1", "fe00::1", "8.8.8.8"];
        for s in public {
            assert!(!local_ip(ip(s)), "{s}");
        }
        let mut all: Vec<IpAddr> = local.map(ip).to_vec();
        all.push(ip("8.8.8.8"));
        assert_eq!(public_addrs(all), vec![ip("8.8.8.8")]);
    }

    // Council FIX-3, AFTER 2 (review "Tests"): the hand-off from the near client to the far one.
    #[test]
    fn fix3_3_a_redirect_off_the_pages_host_is_handed_on_under_the_hop_rule() {
        let u = |s: &str| Url::parse(s).unwrap();
        let from = u("https://example.com/favicon.ico");
        assert_eq!(hand_off(&from, Some("/i.png"), None), Some(u("https://example.com/i.png")));
        assert_eq!(hand_off(&from, Some("https://cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("//cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("http://cdn.example.net/i.png"), None), None, "https down to http");
        assert_eq!(hand_off(&from, Some("https://192.168.1.1/"), None), None);
        assert_eq!(hand_off(&from, Some("https://[::7f00:1]/"), None), None);
        assert_eq!(hand_off(&from, Some("https://tauri.localhost/"), None), None);
        assert_eq!(hand_off(&from, Some("file:///C:/Windows/win.ini"), None), None);
        assert_eq!(hand_off(&from, None, None), None);
        let local = u("http://localhost:3000/favicon.ico");
        assert_eq!(hand_off(&local, Some("/real.ico"), None), Some(u("http://localhost:3000/real.ico")));
        assert_eq!(hand_off(&local, Some("http://127.0.0.1:8745/"), None), None);
        assert_eq!(hand_off(&local, Some("http://localhost:1420/x"), Some(&u("http://localhost:1420"))), None);
    }

    #[test]
    fn row939_an_unreadable_settings_file_is_an_error_not_no_proxy() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row939-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Ok(None), "no file yet (first run) is no proxy");
        std::fs::write(dir.join("settings.json"), "{ half written").unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Err(SETTINGS_UNREADABLE.to_string()), "corrupt with no usable backup");
        assert!(!icon_fetch_allowed(&proxy_in_settings(store.try_settings())), "and no icon goes direct either");
        std::fs::write(dir.join("settings.json"), r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Ok(Some("http://127.0.0.1:3128".to_string())));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Row 939b, changed by row 944: a missing settings.json beside a .bak reads the .bak (state.rs read_file),
    // so a proxy in it is honoured and a copy that cannot be read refuses the tab, the icon and the HEAD.
    #[test]
    fn row939b_a_missing_settings_file_with_a_proxy_in_the_last_good_copy_refuses_everything() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row939b-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        let read = |s: &crate::state::Store| proxy_in_profile(s.try_settings(), &s.dir());
        let bak = dir.join("settings.json.bak");
        assert_eq!(read(&store), Ok(None), "neither file: first run");
        // Row 944: the load now reads the copy for a missing file, so a proxy in it is the saved proxy.
        for (what, bytes, want) in [
            ("a proxy", r#"{"httpProxy":"http://127.0.0.1:3128"}"#, Ok(Some("http://127.0.0.1:3128".to_string()))),
            ("an empty proxy", r#"{"httpProxy":""}"#, Ok(None)),
            ("no proxy", r#"{"theme":"dark"}"#, Ok(None)),
            ("a copy that cannot be read", "{ half written", Err(SETTINGS_UNREADABLE.to_string())),
        ] {
            std::fs::write(&bak, bytes).unwrap();
            let got = read(&store);
            assert_eq!(got, want, "{what}");
            if got.is_err() {
                assert!(!icon_fetch_allowed(&got), "{what}: no icon or HEAD goes direct");
            }
        }
        std::fs::write(dir.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
        std::fs::write(&bak, r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(read(&store), Ok(None), "a settings file that is there is the truth; the copy is only for a corrupt one");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // T-323-c: a saved proxy means no icon fetch at all; the icon clients only ever connect directly.
    #[test]
    fn t323c_with_a_saved_proxy_no_icon_fetch_goes_direct() {
        use std::io::{Read, Write};
        let ok = |p: Option<&str>| icon_fetch_allowed(&Ok(p.map(str::to_string)));
        assert!(ok(None) && ok(Some("  ")));
        assert!(!ok(Some("http://127.0.0.1:8080")) && !ok(Some("socks5://proxy.test:1080")));
        assert!(!ok(Some("not a url")), "a setting the engine cannot take is not an excuse to go direct");
        assert!(!icon_fetch_allowed(&Err("sealed value unreadable".into())));
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.set_nonblocking(true).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let clients = icon_clients(None, system_lookup).unwrap();
        let proxied = Ok(Some("http://127.0.0.1:8080".to_string()));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon_unless_proxied(&proxied, &clients, true, url.clone(), None)), None);
        assert!(l.accept().is_err(), "a connection reached the icon host under a saved proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n\x07\x07\x07");
        });
        let got = tauri::async_runtime::block_on(fetch_icon_unless_proxied(&Ok(None), &clients, true, url, None));
        assert_eq!(got, Some("data:image/png;base64,BwcH".into()), "without a proxy the icon is fetched as before");
        server.join().unwrap();
    }

    // T-323-d: every other direct request Kolux makes (download size, diagnosis, update probe) follows the same rule.
    #[test]
    fn t323d_with_a_saved_proxy_no_head_goes_direct() {
        use std::io::{Read, Write};
        let u = |s: &str| Url::parse(s).unwrap();
        let proxied: Result<Option<String>, String> = Ok(Some("http://127.0.0.1:8080".into()));
        let unusable: Result<Option<String>, String> = Ok(Some("not a url".into()));
        let unreadable: Result<Option<String>, String> = Err("sealed value unreadable".into());
        let free: Result<Option<String>, String> = Ok(None);
        // The gate, per address: only this machine's own addresses skip a proxy (the engine never sends them to one).
        for saved in [&proxied, &unusable, &unreadable] {
            for own in ["http://127.0.0.1:3000/", "http://localhost:3000/", "http://[::1]:3000/", "http://127.9.9.9/"] {
                assert!(head_gate(saved, &u(own)).is_ok(), "{own} is this machine's: a proxy never carries it");
            }
            // The local network is not this machine: a proxy may carry it, so it is skipped too.
            for other in ["https://example.com/a.zip", "http://192.168.1.5/", "http://10.0.0.2:8080/", "http://nas.lan/", "http://intranet/", "http://0.0.0.0:80/"] {
                let f = head_gate(saved, &u(other)).unwrap_err();
                assert!(proxy_skipped(&f) && f.text.contains("proxy is saved") && !f.timeout && f.io.is_none(), "{other} must be skipped");
            }
        }
        for any in ["https://example.com/", "http://192.168.1.5/", "http://127.0.0.1/"] {
            assert!(head_gate(&free, &u(any)).is_ok(), "without a proxy {any} is asked as before");
        }
        assert!(!proxy_skipped(&Failed { text: "connect error".into(), timeout: false, io: None }));
        // The real sockets: a host that would be reached (the lookup says this machine) sees 0 connections under a proxy.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        l.set_nonblocking(true).unwrap();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let ask = |saved: &Result<Option<String>, String>, url: &Url, near: bool| tauri::async_runtime::block_on(head_unless_proxied(saved, &clients, url, near, DIAGNOSE_WAIT));
        let lan = u(&format!("http://nas.lan:{port}/big.zip"));
        let public = u(&format!("http://files.example.com:{port}/big.zip"));
        for saved in [&proxied, &unusable, &unreadable] {
            assert!(proxy_skipped(&ask(saved, &lan, true).unwrap_err()));
            assert!(proxy_skipped(&ask(saved, &public, false).unwrap_err()));
        }
        assert!(l.accept().is_err(), "a connection reached the host under a saved proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut s, _) = l.accept().unwrap();
                let _ = s.read(&mut [0u8; 4096]);
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 42\r\nConnection: close\r\n\r\n");
            }
        });
        let seen = Ok(Answer { status: 200, length: Some(42) });
        assert_eq!(ask(&proxied, &u(&format!("http://127.0.0.1:{port}/")), true), seen, "a loopback address still connects under a proxy");
        assert_eq!(ask(&free, &lan, true), seen, "without a proxy the request goes as before");
        assert_eq!(ask(&unusable, &u(&format!("http://localhost:{port}/")), true), seen);
        server.join().unwrap();
    }

    // T-323-e: an EMPTY setting means "the system's proxy" (OD-18): when one is in use, the gate fails closed too.
    #[test]
    fn t323e_system_proxy_decision_rows() {
        let none = |_: &str| None;
        let env = |name: &'static str| move |n: &str| (n == name).then(|| "http://proxy.test:3128".to_string());
        assert!(system_proxy_from(Some(1), Some("proxy.test:3128"), None, none), "enabled with a server");
        assert!(!system_proxy_from(Some(1), Some(""), None, none), "enabled, no server");
        assert!(!system_proxy_from(Some(1), Some("  "), None, none), "enabled, blank server");
        assert!(!system_proxy_from(Some(0), Some("proxy.test:3128"), None, none), "a server left behind, switched off");
        assert!(!system_proxy_from(None, Some("proxy.test:3128"), None, none), "no ProxyEnable value");
        assert!(system_proxy_from(None, None, Some("http://wpad.corp/proxy.pac"), none), "a PAC script");
        assert!(system_proxy_from(Some(0), None, Some("http://wpad.corp/proxy.pac"), none), "a PAC script needs no ProxyEnable");
        assert!(!system_proxy_from(None, None, Some(" "), none), "a blank PAC address");
        assert!(!system_proxy_from(None, None, None, none), "nothing set (WPAD auto-detect alone is not counted)");
        for name in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
            assert!(system_proxy_from(None, None, None, env(name)), "{name}");
        }
        assert!(!system_proxy_from(None, None, None, |_| Some(String::new())), "an empty variable is not a proxy");
        assert!(!system_proxy_from(None, None, None, env("NO_PROXY")), "NO_PROXY is not a proxy");
        // The real reader never panics, whatever this machine has (a missing key is the normal case).
        let _ = read_system_proxy();
    }

    #[test]
    fn t323e_an_empty_setting_with_a_system_proxy_makes_no_direct_request() {
        use std::io::{Read, Write};
        let u = |s: &str| Url::parse(s).unwrap();
        let empty: Result<Option<String>, String> = Ok(None);
        let blank: Result<Option<String>, String> = Ok(Some("  ".into()));
        set_system_proxy_for_test(false);
        assert!(icon_fetch_allowed(&empty) && icon_fetch_allowed(&blank) && head_gate(&empty, &u("https://example.com/")).is_ok());
        set_system_proxy_for_test(true);
        assert!(!icon_fetch_allowed(&empty) && !icon_fetch_allowed(&blank), "a system proxy closes the icon gate");
        for own in ["http://127.0.0.1:3000/", "http://localhost:3000/", "http://[::1]:3000/"] {
            assert!(head_gate(&empty, &u(own)).is_ok(), "{own} is this machine's: a proxy never carries it");
        }
        for other in ["https://example.com/a.zip", "http://192.168.1.5/", "http://nas.lan/"] {
            let f = head_gate(&empty, &u(other)).unwrap_err();
            assert!(proxy_skipped(&f), "{other} must be skipped");
        }
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        l.set_nonblocking(true).unwrap();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let ask = |saved: &Result<Option<String>, String>, url: &Url, near: bool| tauri::async_runtime::block_on(head_unless_proxied(saved, &clients, url, near, DIAGNOSE_WAIT));
        let public = u(&format!("http://files.example.com:{port}/big.zip"));
        assert!(proxy_skipped(&ask(&empty, &public, false).unwrap_err()));
        let icon = u(&format!("http://files.example.com:{port}/favicon.ico"));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon_unless_proxied(&empty, &clients, false, icon, None)), None);
        assert!(l.accept().is_err(), "a connection reached the host under the system proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 42\r\nConnection: close\r\n\r\n");
        });
        let seen = Ok(Answer { status: 200, length: Some(42) });
        assert_eq!(ask(&empty, &u(&format!("http://127.0.0.1:{port}/")), true), seen, "a loopback address still connects");
        server.join().unwrap();
        set_system_proxy_for_test(false);
    }

    // Council FIX-3, AFTER 2: one overall time limit, however the fetch goes.
    #[test]
    fn fix3_3_an_icon_fetch_ends_at_its_time_limit() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n");
            std::thread::sleep(Duration::from_millis(2500));
            let _ = s.write_all(b"\x07\x07\x07");
        });
        let clients = icon_clients(None, system_lookup).unwrap();
        let start = Instant::now();
        let got = tauri::async_runtime::block_on(fetch_icon_within(&clients, true, url, None, Duration::from_millis(300)));
        let took = start.elapsed();
        assert_eq!(got, None);
        assert!(took < Duration::from_millis(1500), "took {took:?}");
        server.join().unwrap();
    }

    // Council FIX-4, AFTER 2: the port counts, so a page on one local port reaches no other.
    #[test]
    fn fix4_2_a_local_page_reaches_no_other_port_of_its_host() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(same_spot(&u("http://localhost/"), &u("http://localhost:80/x")));
        assert!(same_spot(&u("https://box.lan/"), &u("https://box.lan:443/i.png")));
        assert!(!same_spot(&u("http://127.0.0.1:3000/"), &u("http://127.0.0.1:8745/")));
        assert!(!same_spot(&u("http://box.lan/"), &u("https://box.lan/")));
        let page = u("http://127.0.0.1:3000/app");
        assert!(icon_near(&u("http://127.0.0.1:3000/favicon.ico"), &page));
        assert!(!icon_near(&u("http://127.0.0.1:8745/x"), &page));
        let first = u("http://127.0.0.1:3000/favicon.ico");
        assert!(hop_ok(&u("http://127.0.0.1:3000/real.ico"), std::slice::from_ref(&first), None));
        assert!(!hop_ok(&u("http://127.0.0.1:8745/x"), std::slice::from_ref(&first), None));
    }

    #[test]
    fn fix4_2_a_same_host_redirect_to_another_port_is_never_followed() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached another port of this machine");
    }

    // Council FIX-4, AFTER 3: the far request after a hand-off gets only what is left.
    #[test]
    fn fix4_3_the_far_request_gets_only_what_is_left() {
        let s = Duration::from_secs;
        assert_eq!(time_left(s(0), s(8)), Some(s(8)));
        assert_eq!(time_left(s(3), s(8)), Some(s(5)));
        assert_eq!(time_left(Duration::from_millis(7999), s(8)), Some(Duration::from_millis(1)));
        assert_eq!(time_left(s(8), s(8)), None);
        assert_eq!(time_left(s(9), s(8)), None);
    }

    // APP-070: a HEAD through the approved near client reaches this machine: a closed port fails
    // as a refused connection, an open one answers with its status and length.
    #[test]
    fn brow008_a_closed_local_port_is_refused_and_an_open_one_is_reached() {
        let clients = icon_clients(None, system_lookup).unwrap();
        // A released ephemeral port can be taken by another process before the HEAD: try a fresh one.
        let mut tries = Vec::new();
        loop {
            let gone = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = gone.local_addr().unwrap().port();
            drop(gone);
            let url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
            let f = tauri::async_runtime::block_on(head_with(&clients, &url, true, DIAGNOSE_WAIT)).unwrap_err();
            if !f.timeout && f.io == Some(std::io::ErrorKind::ConnectionRefused) {
                assert!(local_host(&url));
                break;
            }
            tries.push(f);
            assert!(tries.len() < 5, "no closed port was refused: {tries:?}");
        }
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/", open.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut s, _) = open.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            s.write_all(b"HTTP/1.1 200 OK
Content-Length: 1234
Connection: close

").unwrap();
        });
        assert_eq!(tauri::async_runtime::block_on(head_with(&clients, &url, true, DIAGNOSE_WAIT)), Ok(Answer { status: 200, length: Some(1234) }));
        server.join().unwrap();
    }

    #[test]
    fn app070_a_public_only_probe_never_reaches_this_machine() {
        // The far client's own lookup drops local addresses, so a HEAD to a loopback address through
        // it never connects (a name rebound to this machine is caught the same way).
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = open.local_addr().unwrap().port();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let url = Url::parse(&format!("http://rebound.example.com:{port}/")).unwrap();
        assert!(tauri::async_runtime::block_on(head_with(&clients, &url, false, DIAGNOSE_WAIT)).is_err());
    }

    #[test]
    fn brow033_the_proxy_setting_is_empty_for_the_system_proxy_an_http_or_socks5_address_or_refused_unquoted() {
        assert_eq!(proxy_of(None), Ok(None));
        assert_eq!(proxy_of(Some("  ")), Ok(None));
        assert_eq!(proxy_of(Some("http://127.0.0.1:8080")).unwrap().map(|u| u.to_string()), Some("http://127.0.0.1:8080/".into()));
        assert_eq!(proxy_of(Some("socks5://user:pw-secret@proxy.test:1080")).unwrap().map(|u| u.port()), Some(Some(1080)));
        for bad in ["ftp://user:pw-secret@proxy.test", "proxy.test:8080", "http://", "not a url"] {
            let e = proxy_of(Some(bad)).unwrap_err();
            assert!(e.contains("http:// or socks5://") && !e.contains("secret") && !e.contains("proxy.test"), "{bad}: {e}");
        }
    }
}
