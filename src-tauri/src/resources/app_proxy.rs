// APP-032 (T-324-b): the network proxy for the app's own traffic (update checks and downloads).
// The address is the sealed `httpProxy` setting (T-323, SET-040), the bypass list is `httpProxyBypass`.
// Order: an explicit setting, else the system proxy, else the proxy environment variables (the last two
// are what the HTTP client does when nothing is set). A setting that cannot be used never lets a
// request slip around it: the caller gets an error and sends nothing. The address, which may carry
// credentials, never appears in a message.
use std::net::Ipv4Addr;
use tauri::Url;

pub const PROXY_KEY: &str = "httpProxy";
pub const BYPASS_KEY: &str = "httpProxyBypass";

const SCHEMES: [&str; 4] = ["http", "https", "socks5", "socks5h"];

#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// No explicit setting: the system proxy, then the environment's, as the client does by itself.
    Default,
    /// The host is on the bypass list: no proxy at all.
    Direct,
    Via(Url),
}

fn parse(setting: &str) -> Result<Url, String> {
    match Url::parse(setting) {
        Ok(u) if SCHEMES.contains(&u.scheme()) && u.host_str().is_some() => Ok(u),
        _ => Err("the network proxy setting is not an http, https or socks5 address with a host; app traffic that needs it stays off until the setting is fixed or cleared".into()),
    }
}

fn v4(s: &str) -> Option<Ipv4Addr> {
    s.parse().ok()
}

/// Does one bypass entry cover this host and port? Entries are host names, `*.suffix` / `.suffix`
/// (the domain and its subdomains), `<local>` (names with no dot), `*`, an IPv4 address or an
/// IPv4 range `a.b.c.d/n`; an entry may end in `:port`. An entry with a port or range that cannot
/// exist covers nothing.
fn entry_covers(entry: &str, host: &str, port: u16) -> bool {
    let entry = entry.trim().to_ascii_lowercase();
    let host = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if entry.is_empty() {
        return false;
    }
    if entry == "*" {
        return true;
    }
    if entry == "<local>" {
        return !host.contains('.') && !host.contains(':');
    }
    let (name, want_port) = match entry.rsplit_once(':') {
        // A port that cannot exist (65536 and above) is an impossible entry, like a range of more
        // than 32 bits: it covers nothing. It must not fall back to a bare host name, which would
        // cover every port.
        Some((n, p)) if !n.contains(':') && p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => match p.parse::<u16>() {
            Ok(port) => (n.to_string(), Some(port)),
            Err(_) => return false,
        },
        _ => (entry.clone(), None),
    };
    if want_port.is_some_and(|p| p != port) {
        return false;
    }
    if let Some((base, bits)) = name.split_once('/') {
        let (Some(base), Ok(bits), Some(ip)) = (v4(base), bits.parse::<u32>(), v4(&host)) else { return false };
        if bits > 32 {
            return false;
        }
        let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
        return u32::from(base) & mask == u32::from(ip) & mask;
    }
    let suffix = name.strip_prefix("*.").or_else(|| name.strip_prefix('.'));
    match suffix {
        Some(s) => host == s || host.ends_with(&format!(".{s}")),
        None => host == name,
    }
}

pub fn bypassed(list: &[String], host: &str, port: u16) -> bool {
    list.iter().any(|e| entry_covers(e, host, port))
}

/// Which way a request to `url` goes, given the saved settings.
pub fn route(setting: Option<&str>, bypass: &[String], url: &Url) -> Result<Route, String> {
    let Some(v) = setting.map(str::trim).filter(|v| !v.is_empty()) else { return Ok(Route::Default) };
    // A bad address is an error even for a bypassed host: the setting is broken either way.
    let proxy = parse(v)?;
    let host = url.host_str().unwrap_or("");
    if bypassed(bypass, host, url.port_or_known_default().unwrap_or(0)) {
        return Ok(Route::Direct);
    }
    Ok(Route::Via(proxy))
}

/// The saved settings of the open store. An address that cannot be unsealed (the system key changed)
/// is left as it is in the store and unused; the system proxy applies then.
pub fn route_from_store(store: &crate::state::Store, url: &Url) -> Result<Route, String> {
    let setting = crate::secrets::read_setting(store, PROXY_KEY).ok().flatten();
    let bypass: Vec<String> = store
        .settings()
        .get(BYPASS_KEY)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|e| e.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    route(setting.as_deref(), &bypass, url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }
    fn list(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn app032_no_setting_leaves_the_system_proxy_and_the_environment_in_charge() {
        assert_eq!(route(None, &[], &u("https://github.com/x")).unwrap(), Route::Default);
        assert_eq!(route(Some("  "), &list(&["github.com"]), &u("https://github.com/x")).unwrap(), Route::Default);
    }

    #[test]
    fn app032_an_explicit_setting_wins_and_keeps_its_credentials_for_that_proxy() {
        match route(Some("http://me:pw@proxy.corp:3128"), &[], &u("https://github.com/x")).unwrap() {
            Route::Via(p) => {
                assert_eq!(p.host_str(), Some("proxy.corp"));
                assert_eq!(p.username(), "me");
            }
            other => panic!("{other:?}"),
        }
        for ok in ["https://p:1", "socks5://p:1080", "socks5h://p:1080"] {
            assert!(matches!(route(Some(ok), &[], &u("https://a.b/")).unwrap(), Route::Via(_)), "{ok}");
        }
    }

    #[test]
    fn app032_an_unusable_setting_is_an_error_that_does_not_show_the_address() {
        for bad in ["ftp://p:1", "http://", "not a url", "proxy.corp:3128"] {
            let e = route(Some(bad), &[], &u("https://github.com/x")).unwrap_err();
            assert!(!e.contains(bad), "{e}");
        }
        let e = route(Some("ftp://me:secret@p:1"), &[], &u("https://github.com/")).unwrap_err();
        assert!(!e.contains("secret") && !e.contains("me:"), "{e}");
        // broken even when the host would have been bypassed
        assert!(route(Some("ftp://p:1"), &list(&["github.com"]), &u("https://github.com/")).is_err());
    }

    #[test]
    fn app032_a_bypassed_host_goes_direct_and_the_rest_through_the_proxy() {
        let l = list(&["github.com", "*.corp.example", "10.0.0.0/8", "<local>"]);
        let p = Some("http://p:8080");
        assert_eq!(route(p, &l, &u("https://github.com/a")).unwrap(), Route::Direct);
        assert_eq!(route(p, &l, &u("https://api.corp.example/a")).unwrap(), Route::Direct);
        assert_eq!(route(p, &l, &u("https://corp.example/a")).unwrap(), Route::Direct);
        assert_eq!(route(p, &l, &u("http://10.2.3.4/a")).unwrap(), Route::Direct);
        assert_eq!(route(p, &l, &u("http://intranet/a")).unwrap(), Route::Direct);
        assert!(matches!(route(p, &l, &u("https://objects.githubusercontent.com/a")).unwrap(), Route::Via(_)));
        assert!(matches!(route(p, &l, &u("http://11.0.0.1/a")).unwrap(), Route::Via(_)));
        assert!(matches!(route(p, &l, &u("https://notgithub.com/a")).unwrap(), Route::Via(_)));
    }

    #[test]
    fn app032_bypass_entries_cover_ports_ranges_and_the_wildcard() {
        assert!(entry_covers("example.com:8443", "example.com", 8443));
        assert!(!entry_covers("example.com:8443", "example.com", 443));
        assert!(entry_covers("192.168.1.0/24", "192.168.1.77", 80));
        assert!(!entry_covers("192.168.1.0/24", "192.168.2.1", 80));
        assert!(entry_covers("0.0.0.0/0", "8.8.8.8", 80));
        assert!(!entry_covers("1.2.3.4/40", "1.2.3.4", 80), "an impossible range covers nothing");
        assert!(entry_covers(".example.com", "a.example.com", 443));
        assert!(!entry_covers(".example.com", "badexample.com", 443));
        assert!(entry_covers("*", "anything.at.all", 1));
        assert!(!entry_covers("<local>", "a.b", 80));
        assert!(entry_covers("EXAMPLE.com", "example.COM", 80), "case is ignored");
        assert!(!entry_covers("", "example.com", 80));
    }

    /// R6-F01: a port that cannot exist is an impossible entry, like a range of more than 32 bits:
    /// it covers nothing. Today the unreadable number is dropped and the entry covers every port,
    /// so `example.com:99999` bypasses the proxy for `example.com` on 80 and 443 alike.
    #[test]
    fn audit_r6_f01_an_impossible_bypass_port_covers_nothing() {
        for entry in ["example.com:99999", "example.com:65536"] {
            assert!(!entry_covers(entry, "example.com", 80), "{entry} must not cover port 80");
            assert!(!entry_covers(entry, "example.com", 443), "{entry} must not cover port 443");
        }
    }
}
