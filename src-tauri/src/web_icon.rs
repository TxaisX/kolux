// T-302-c (PROJ-018, the web places FIX-4 shelved): the picture the package manifest names on the web,
// the favicon of the manifest's homepage, and `https` icon links in the page source. A repository
// chooses these addresses, so none is ever handed to the page: Rust fetches them and returns a data
// URL, or nothing.
//
// The fetch reuses the guarded icon client (net.rs, the one network client the privacy statement
// names for site icons) instead of building a second one:
// - its own name lookup returns only public addresses and reqwest connects only to what that lookup
//   returned, so the address actually connected to is the checked one (DNS rebinding included: a
//   name that answers a local address at fetch time gets an empty lookup and is never asked);
// - every redirect goes through the same rule and lookup again, never from https down to http and
//   never onto this machine or the local network;
// - no proxy (a proxy would resolve the name where the lookup cannot see it);
// - only answers that say they are pictures, read no further than the size cap.
// On top of that this module takes https only, no user name or password in the address, no local
// host by name or number, a picture type from a short list, the project icon size cap
// (`AUTO_ICON_FILE_MAX`) and its own few-seconds limit. Answers are kept for the run so a panel
// that asks for every row does not fetch again.
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::Url;

use crate::net;
use crate::projects::AUTO_ICON_FILE_MAX;

/// How long one web icon fetch may take in all, redirects included.
pub const WEB_ICON_TIME: Duration = Duration::from_secs(4);
/// How many web addresses one project may try (manifest picture, homepage favicon, page links).
pub const WEB_TRIES_MAX: usize = 4;
/// The picture types a web icon may be.
const KINDS: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"];
/// The longest data URL header the frontend budgets for (projects.rs and projectIcon.ts).
const HEADER_MAX: usize = 40;
const CACHE_MAX: usize = 256;

/// A repository-chosen address the app may fetch: https, a host, no user name or password, and not
/// this machine or the local network by name or number (IPv4 written in any form the URL standard
/// accepts, IPv6, and IPv4 inside IPv6 all end up as a number here). Anything else is refused.
pub fn web_icon_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw.trim()).ok()?;
    let host_ok = url.host_str().is_some_and(|h| !h.is_empty());
    (url.scheme() == "https" && host_ok && url.username().is_empty() && url.password().is_none() && !net::local_host(&url) && net::allowed(&url, None).is_ok()).then_some(url)
}

/// The picture the package manifest names, when it is a web address.
pub fn manifest_icon_url(manifest: &Value) -> Option<Url> {
    manifest.get("icon")?.as_str().and_then(web_icon_url)
}

/// The favicon at the root of the manifest's homepage. The homepage itself is never fetched.
pub fn homepage_favicon_url(manifest: &Value) -> Option<Url> {
    let home = web_icon_url(manifest.get("homepage")?.as_str()?)?;
    home.join("/favicon.ico").ok().and_then(|u| web_icon_url(u.as_str()))
}

/// The icon links of a page that are https web addresses (relative ones are the repository's).
pub fn page_icon_urls(hrefs: &[String]) -> Vec<Url> {
    hrefs.iter().filter_map(|h| web_icon_url(h)).collect()
}

/// Whether a data URL fetched from the web may be a project icon: a picture type from the list and
/// no more picture than a file inside the repository may be (`AUTO_ICON_FILE_MAX`).
pub fn accept(data_url: &str) -> bool {
    let Some((head, body)) = data_url.split_once(',') else { return false };
    let Some(kind) = head.strip_prefix("data:").and_then(|h| h.strip_suffix(";base64")) else { return false };
    let most = AUTO_ICON_FILE_MAX.div_ceil(3) * 4;
    head.len() < HEADER_MAX && KINDS.contains(&kind) && !body.is_empty() && body.len() as u64 <= most
}

fn system_lookup(host: &str) -> std::io::Result<Vec<IpAddr>> {
    use std::net::ToSocketAddrs;
    Ok((host, 0).to_socket_addrs()?.map(|a| a.ip()).collect())
}

/// The guarded icon clients, built once for project icons, with no dev origin.
fn clients() -> Option<&'static net::IconClients> {
    static CLIENTS: OnceLock<Option<net::IconClients>> = OnceLock::new();
    CLIENTS.get_or_init(|| net::icon_clients(None, system_lookup)).as_ref()
}

static CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Mutex::default);

/// Fetches one web icon (blocking: call it off the async workers, as `project_auto_icon` does).
pub fn fetch(url: &Url) -> Option<String> {
    let url = web_icon_url(url.as_str())?;
    if let Some(hit) = CACHE.lock().ok().and_then(|c| c.get(url.as_str()).cloned()) {
        return hit;
    }
    let got = clients().and_then(|c| tauri::async_runtime::block_on(net::fetch_icon_within(c, false, url.clone(), None, WEB_ICON_TIME))).filter(|d| accept(d));
    if let Ok(mut c) = CACHE.lock() {
        if c.len() >= CACHE_MAX {
            c.clear();
        }
        c.insert(url.to_string(), got.clone());
    }
    got
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::{auto_icon_with, AutoIcon};
    use serde_json::json;
    use std::cell::RefCell;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn refused(raw: &str) {
        assert!(web_icon_url(raw).is_none(), "must refuse {raw}");
    }

    #[test]
    fn only_https_web_addresses() {
        assert!(web_icon_url("https://example.com/icon.png").is_some());
        assert!(web_icon_url("  https://cdn.example.org:8443/a.svg  ").is_some(), "another port on a public host is fine");
        for raw in [
            "http://example.com/icon.png",
            "ftp://example.com/icon.png",
            "file:///C:/Windows/win.ini",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
            "ws://example.com/",
            "//example.com/icon.png",
            "/icon.png",
            "icon.png",
            "",
            "https://",
            "https://user:pass@example.com/icon.png",
            "https://user@example.com/icon.png",
        ] {
            refused(raw);
        }
    }

    #[test]
    fn local_hosts_by_name_are_refused() {
        for raw in [
            "https://localhost/i.png",
            "https://LOCALHOST./i.png",
            "https://printer/i.png",
            "https://nas.local/i.png",
            "https://router.lan/i.png",
            "https://svc.internal/i.png",
            "https://box.home.arpa/i.png",
            "https://tauri.localhost/i.png",
            "https://ipc.localhost/i.png",
        ] {
            refused(raw);
        }
    }

    #[test]
    fn ipv4_ranges_in_every_spelling() {
        for raw in [
            "https://127.0.0.1/i.png",
            "https://127.255.255.254/i.png",
            "https://2130706433/i.png",
            "https://0x7f000001/i.png",
            "https://0177.0.0.1/i.png",
            "https://127.1/i.png",
            "https://0.0.0.0/i.png",
            "https://10.0.0.1/i.png",
            "https://172.16.0.1/i.png",
            "https://172.31.255.255/i.png",
            "https://192.168.1.1/i.png",
            "https://169.254.169.254/latest/meta-data",
            "https://100.64.0.1/i.png",
            "https://100.127.255.255/i.png",
            "https://198.18.0.1/i.png",
            "https://192.0.0.1/i.png",
            "https://240.0.0.1/i.png",
            "https://255.255.255.255/i.png",
        ] {
            refused(raw);
        }
        for raw in ["https://8.8.8.8/i.png", "https://172.32.0.1/i.png", "https://100.128.0.1/i.png", "https://169.253.0.1/i.png", "https://11.0.0.1/i.png"] {
            assert!(web_icon_url(raw).is_some(), "public {raw} is fine");
        }
    }

    #[test]
    fn ipv6_ranges_and_mapped_addresses() {
        for raw in [
            "https://[::1]/i.png",
            "https://[::]/i.png",
            "https://[fe80::1]/i.png",
            "https://[febf::1]/i.png",
            "https://[fc00::1]/i.png",
            "https://[fd12:3456::1]/i.png",
            "https://[fec0::1]/i.png",
            "https://[::ffff:127.0.0.1]/i.png",
            "https://[::ffff:7f00:1]/i.png",
            "https://[::ffff:10.0.0.1]/i.png",
            "https://[::ffff:169.254.169.254]/i.png",
            "https://[::127.0.0.1]/i.png",
            "https://[64:ff9b::7f00:1]/i.png",
            "https://[64:ff9b:1::a00:1]/i.png",
            "https://[2002:7f00:1::]/i.png",
        ] {
            refused(raw);
        }
        for raw in ["https://[2606:4700::1111]/i.png", "https://[::ffff:8.8.8.8]/i.png"] {
            assert!(web_icon_url(raw).is_some(), "public {raw} is fine");
        }
    }

    #[test]
    fn the_lookup_keeps_only_public_addresses() {
        // What the fetch's own name lookup hands reqwest: a name rebound to a local address at fetch
        // time comes back empty, so nothing is connected to (net::Resolver refuses an empty list).
        let local: Vec<IpAddr> = vec![
            Ipv4Addr::LOCALHOST.into(),
            Ipv4Addr::new(10, 1, 2, 3).into(),
            Ipv4Addr::new(169, 254, 169, 254).into(),
            Ipv6Addr::LOCALHOST.into(),
            "fe80::1".parse::<Ipv6Addr>().unwrap().into(),
            "::ffff:192.168.0.1".parse::<Ipv6Addr>().unwrap().into(),
        ];
        assert!(net::public_addrs(local.clone()).is_empty());
        let public: IpAddr = Ipv4Addr::new(93, 184, 215, 14).into();
        let mut mixed = local;
        mixed.push(public);
        assert_eq!(net::public_addrs(mixed), vec![public], "a mixed answer connects to the public address only");
    }

    #[test]
    fn redirects_are_checked_on_every_hop() {
        let first = web_icon_url("https://example.com/icon.png").unwrap();
        let hop = |to: &str| net::hop_ok(&Url::parse(to).unwrap(), std::slice::from_ref(&first), None);
        assert!(hop("https://cdn.example.net/icon.png"));
        for to in [
            "http://example.com/icon.png",
            "https://127.0.0.1/icon.png",
            "https://[::1]/icon.png",
            "https://[::ffff:10.0.0.1]/icon.png",
            "https://169.254.169.254/latest",
            "https://192.168.0.10/",
            "https://localhost/",
            "https://intranet/",
            "file:///C:/x.png",
            "https://tauri.localhost/",
        ] {
            assert!(!hop(to), "redirect to {to} must stop the fetch");
        }
        // the hop cap
        let long: Vec<Url> = (0..6).map(|i| Url::parse(&format!("https://h{i}.example.com/")).unwrap()).collect();
        assert!(!net::hop_ok(&Url::parse("https://end.example.com/").unwrap(), &long, None));
    }

    #[test]
    fn only_small_pictures_are_kept() {
        let most = (AUTO_ICON_FILE_MAX.div_ceil(3) * 4) as usize;
        let at = |kind: &str, n: usize| format!("data:{kind};base64,{}", "A".repeat(n));
        assert!(accept(&at("image/png", 8)));
        assert!(accept(&at("image/svg+xml", most)), "exactly the cap");
        assert!(!accept(&at("image/png", most + 4)), "oversize");
        assert!(!accept(&at("text/html", 8)));
        assert!(!accept(&at("image/tiff", 8)));
        assert!(!accept(&at("image/png", 0)));
        assert!(!accept("data:image/png,AAAA"));
        assert!(!accept("https://example.com/i.png"));
        assert!(!accept(&format!("data:image/{};base64,AAAA", "x".repeat(40))));
    }

    #[test]
    fn manifest_and_page_places() {
        let m = json!({ "icon": "https://example.com/logo.png", "homepage": "https://proj.example.org/docs/start" });
        assert_eq!(manifest_icon_url(&m).unwrap().as_str(), "https://example.com/logo.png");
        assert_eq!(homepage_favicon_url(&m).unwrap().as_str(), "https://proj.example.org/favicon.ico");
        assert!(manifest_icon_url(&json!({ "icon": "assets/logo.png" })).is_none(), "a path is the repository's");
        assert!(manifest_icon_url(&json!({ "icon": "http://example.com/logo.png" })).is_none());
        assert!(homepage_favicon_url(&json!({ "homepage": "http://example.com" })).is_none());
        assert!(homepage_favicon_url(&json!({ "homepage": "https://10.0.0.2/" })).is_none());
        assert!(homepage_favicon_url(&json!({ "homepage": 5 })).is_none());
        let hrefs = vec!["/favicon.png".to_string(), "https://cdn.example.com/f.svg".to_string(), "http://x.example.com/f.png".to_string(), "https://127.0.0.1/f.png".to_string()];
        let got: Vec<String> = page_icon_urls(&hrefs).iter().map(|u| u.to_string()).collect();
        assert_eq!(got, vec!["https://cdn.example.com/f.svg"]);
    }

    fn temp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-web-icon-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";

    #[test]
    fn web_places_come_in_the_card_order_and_only_through_the_guard() {
        let repo = temp_repo("order");
        std::fs::write(repo.join("package.json"), r#"{ "icon": "https://img.example.com/logo.png", "homepage": "https://proj.example.org/" }"#).unwrap();
        std::fs::write(repo.join("index.html"), r#"<link rel="icon" href="http://plain.example.com/a.png"><link rel="icon" href="https://127.0.0.1/b.png"><link rel="shortcut icon" href="https://cdn.example.com/c.png">"#).unwrap();
        let asked = RefCell::new(Vec::new());
        let answer = |hit: &'static str| {
            let asked = &asked;
            move |u: &Url| {
                asked.borrow_mut().push(u.to_string());
                (u.as_str() == hit).then(|| PNG.to_string())
            }
        };
        let image = |src: &str| Some(AutoIcon { kind: "image", src: src.to_string() });
        assert_eq!(auto_icon_with(&repo, &answer("https://cdn.example.com/c.png")), image(PNG));
        assert_eq!(*asked.borrow(), vec!["https://img.example.com/logo.png", "https://proj.example.org/favicon.ico", "https://cdn.example.com/c.png"], "manifest picture, homepage favicon, then the https page link; the http and local links never reach the fetch");
        asked.borrow_mut().clear();
        assert_eq!(auto_icon_with(&repo, &answer("https://img.example.com/logo.png")), image(PNG));
        assert_eq!(asked.borrow().len(), 1, "the first hit wins");
        // a favicon inside the repository beats every web place, which are then never asked
        asked.borrow_mut().clear();
        std::fs::write(repo.join("favicon.png"), b"\x89PNG\r\n\x1a\nxx").unwrap();
        assert_eq!(auto_icon_with(&repo, &answer("https://img.example.com/logo.png")).map(|i| i.src.starts_with("data:image/png")), Some(true));
        assert!(asked.borrow().is_empty());
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn web_tries_are_capped_per_project() {
        let repo = temp_repo("cap");
        std::fs::write(repo.join("package.json"), r#"{ "icon": "https://a.example.com/1.png", "homepage": "https://b.example.com/" }"#).unwrap();
        let links: String = (0..10).map(|i| format!(r#"<link rel="icon" href="https://c{i}.example.com/i.png">"#)).collect();
        std::fs::write(repo.join("index.html"), links).unwrap();
        let count = RefCell::new(0);
        let none = |_: &Url| {
            *count.borrow_mut() += 1;
            None
        };
        let _ = auto_icon_with(&repo, &none);
        assert_eq!(*count.borrow(), WEB_TRIES_MAX);
        let _ = std::fs::remove_dir_all(&repo);
    }
}
