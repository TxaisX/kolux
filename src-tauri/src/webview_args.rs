//! The browser arguments the main window's engine starts with, beyond wry's defaults: the identity
//! prompt switched off (T-319-b BROW-026) and the saved proxy as one `--proxy-server` switch
//! (row 939, T-240 BROW-033). wry adds `--proxy-server` only when the app passes no browser
//! arguments of its own, and Kolux always does (T-286-b), so the switch goes into the string here.
use tauri::Url;

pub const CREDENTIALS_REFUSED: &str = "Kolux's web views can't use a proxy that needs a username and password. Nothing was loaded directly; set a proxy without credentials or clear the setting.";
const SHAPE_REFUSED: &str = "Kolux's web views take a proxy written as http://host:port or socks5://host:port, with no path. Nothing was loaded directly; fix the setting or clear it.";

/// Chromium's default for a socks5 address without a port.
const SOCKS_PORT: u16 = 1080;

/// `--proxy-server=<scheme>://host:port` for a saved proxy. The switch carries no credentials, so
/// an address with them is refused rather than loaded without them; a missing port is the scheme's
/// default (http 80, socks5 1080); a path, query or fragment is refused.
pub fn proxy_flag(proxy: &Url) -> Result<String, String> {
    if !proxy.username().is_empty() || proxy.password().is_some() {
        return Err(CREDENTIALS_REFUSED.into());
    }
    let port = match proxy.scheme() {
        "http" => proxy.port_or_known_default(),
        "socks5" => Some(proxy.port().unwrap_or(SOCKS_PORT)),
        _ => None,
    }
    .filter(|p| *p != 0); // port 0 names no listener
    // Only a host Chromium reads as one host: `=`, `;` or `,` turn the value into a per-scheme rule
    // list it drops, and the engine goes direct.
    let host = proxy.host_str().filter(|h| (h.starts_with('[') && h.ends_with(']')) || (!h.is_empty() && h.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))));
    match (host, port) {
        (Some(host), Some(port)) if matches!(proxy.path(), "" | "/") && proxy.query().is_none() && proxy.fragment().is_none() => Ok(format!("--proxy-server={}://{host}:{port}", proxy.scheme())),
        _ => Err(SHAPE_REFUSED.into()),
    }
}

/// The argument string for the saved proxy: the base arguments with exactly one `--proxy-server`
/// (any the base had is replaced), or the base as it is when no proxy is saved (the system's proxy
/// then applies to the engine by itself).
pub fn with_proxy(base: &str, proxy: Option<&Url>) -> Result<String, String> {
    let Some(proxy) = proxy else { return Ok(base.to_string()) };
    let flag = proxy_flag(proxy)?;
    let kept = strip(base, &["--proxy-server", "--no-proxy-server"]);
    Ok(if kept.is_empty() { flag } else { format!("{kept} {flag}") })
}

fn strip(args: &str, switches: &[&str]) -> String {
    args.split_whitespace().filter(|a| !switches.contains(&a.split('=').next().unwrap_or_default())).collect::<Vec<_>>().join(" ")
}

/// `args` without any `--proxy-server` switch.
#[cfg(test)]
pub fn without_proxy(args: &str) -> String {
    strip(args, &["--proxy-server"])
}

/// T-319-b (BROW-026): the engine's built-in identity prompt (FedCM) is switched off, so sites fall
/// back to their ordinary popup or redirect sign-in. Engine switches are one string shared by every
/// web view on a data folder, so this adds the feature to that string's one `--disable-features=`
/// list (a second such switch would replace the first).
pub fn fedcm_off(args: &str) -> String {
    const SWITCH: &str = "--disable-features=";
    const FEDCM_FEATURE: &str = "FedCm";
    let mut found = false;
    let mut out: Vec<String> = Vec::new();
    for a in args.split_whitespace() {
        match a.strip_prefix(SWITCH) {
            Some(list) if !found => {
                found = true;
                let mut names: Vec<&str> = list.split(',').filter(|n| !n.is_empty()).collect();
                if !names.contains(&FEDCM_FEATURE) {
                    names.push(FEDCM_FEATURE);
                }
                out.push(format!("{SWITCH}{}", names.join(",")));
            }
            _ => out.push(a.to_string()),
        }
    }
    if !found {
        out.push(format!("{SWITCH}{FEDCM_FEATURE}"));
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }
    const BASE: &str = "--disable-features=msWebOOUI,msPdfOOUI --disable-renderer-backgrounding";

    fn count(args: &str, prefix: &str) -> usize {
        args.split_whitespace().filter(|a| a.starts_with(prefix)).count()
    }

    #[test]
    fn brow026_fedcm_joins_the_one_disable_features_list_once() {
        let wry = "--disable-features=msWebOOUI,msPdfOOUI --disable-renderer-backgrounding";
        assert_eq!(fedcm_off(wry), "--disable-features=msWebOOUI,msPdfOOUI,FedCm --disable-renderer-backgrounding");
        // Already there: the string is unchanged, so every web view keeps passing the same one.
        assert_eq!(fedcm_off(&fedcm_off(wry)), fedcm_off(wry));
        // No list yet: one is added; an empty string gets just the switch.
        assert_eq!(fedcm_off("--disable-gpu"), "--disable-gpu --disable-features=FedCm");
        assert_eq!(fedcm_off(""), "--disable-features=FedCm");
        assert_eq!(fedcm_off("--disable-features=FedCm,X"), "--disable-features=FedCm,X");
    }

    #[test]
    fn row939_a_saved_proxy_is_one_switch_after_the_base_arguments() {
        for (saved, flag) in [
            ("http://127.0.0.1:8080", "--proxy-server=http://127.0.0.1:8080"),
            ("socks5://proxy.test:1080", "--proxy-server=socks5://proxy.test:1080"),
            ("http://127.0.0.1:8080/", "--proxy-server=http://127.0.0.1:8080"),
        ] {
            let args = with_proxy(BASE, Some(&url(saved))).unwrap();
            assert_eq!(args, format!("{BASE} {flag}"), "{saved}");
            assert_eq!(count(&args, "--proxy-server="), 1);
            assert!(args.starts_with(BASE), "the base stays, wry's defaults with it");
        }
    }

    #[test]
    fn row939_no_proxy_leaves_the_base_alone() {
        assert_eq!(with_proxy(BASE, None).unwrap(), BASE);
        assert_eq!(with_proxy("", None).unwrap(), "");
    }

    #[test]
    fn row939_a_proxy_in_the_base_is_replaced_not_doubled() {
        let base = format!("--proxy-server=http://old:1 {BASE} --no-proxy-server");
        let args = with_proxy(&base, Some(&url("http://new.test:3128"))).unwrap();
        assert_eq!(count(&args, "--proxy-server="), 1);
        assert!(args.contains("--proxy-server=http://new.test:3128") && !args.contains("old:1") && !args.contains("--no-proxy-server"), "{args}");
        assert!(args.contains(BASE));
        assert_eq!(without_proxy(&format!("{BASE} --proxy-server=http://old:1")), BASE);
        assert_eq!(without_proxy(BASE), BASE);
    }

    #[test]
    fn row939_the_default_port_is_the_schemes_and_stated() {
        assert!(with_proxy(BASE, Some(&url("http://proxy.test"))).unwrap().ends_with("--proxy-server=http://proxy.test:80"));
        assert!(with_proxy(BASE, Some(&url("socks5://proxy.test"))).unwrap().ends_with("--proxy-server=socks5://proxy.test:1080"));
        assert!(with_proxy(BASE, Some(&url("http://[::1]:8080"))).unwrap().ends_with("--proxy-server=http://[::1]:8080"));
    }

    #[test]
    fn row939_a_proxy_with_credentials_refuses_and_never_echoes_them() {
        for saved in ["http://me:PLANTED-SECRET@127.0.0.1:8080", "socks5://me@proxy.test:1080", "http://:pw@proxy.test:80"] {
            let e = with_proxy(BASE, Some(&url(saved))).unwrap_err();
            assert_eq!(e, CREDENTIALS_REFUSED, "{saved}");
            assert!(!e.contains("PLANTED-SECRET") && !e.contains("me:"));
        }
    }

    #[test]
    fn row939_a_path_query_or_fragment_refuses() {
        for saved in ["http://proxy.test:8080/pac", "http://proxy.test:8080?x=1", "socks5://proxy.test:1080#f"] {
            let e = with_proxy(BASE, Some(&url(saved))).unwrap_err();
            assert_eq!(e, SHAPE_REFUSED, "{saved}");
        }
    }

    #[test]
    fn row939_a_host_the_switch_cannot_state_refuses_instead_of_going_direct() {
        // `=`, `;` and `,` make Chromium read the value as a per-scheme rule list, drop it and go direct.
        for saved in ["http://http=proxy.corp:3128", "socks5://a=b:1080", "http://a%3Db:3128", "socks5://a%3Db:1080", "http://a;b:3128", "http://a,b:3128", "socks5://a;b:1080", "socks5://a,b:1080"] {
            let u = url(saved);
            assert_eq!(proxy_flag(&u), Err(SHAPE_REFUSED.to_string()), "{saved}");
            assert_eq!(with_proxy(BASE, Some(&u)), Err(SHAPE_REFUSED.to_string()), "{saved}");
        }
        for ok in ["http://proxy.corp-1.example:3128", "http://10.0.0.1:80", "http://[::1]:8080", "http://localhost:8080", "socks5://proxy_1.test:1080", "http://PROXY.Test:80"] {
            assert!(proxy_flag(&url(ok)).is_ok(), "{ok}");
        }
    }

    #[test]
    fn row939b_port_zero_refuses() {
        for saved in ["http://127.0.0.1:0", "socks5://proxy.test:0", "http://[::1]:0", "http://localhost:0"] {
            let u = url(saved);
            assert_eq!(proxy_flag(&u), Err(SHAPE_REFUSED.to_string()), "{saved}");
            assert_eq!(with_proxy("--a", Some(&u)), Err(SHAPE_REFUSED.to_string()), "{saved}");
        }
        assert!(proxy_flag(&url("http://127.0.0.1:1")).is_ok());
    }

    // Row 939b: shapes the engine would read as something else. Each must stop at the setting (proxy_of
    // refuses) or at the switch (proxy_flag refuses); none may come out as a proxy.
    #[test]
    fn row939b_odd_host_shapes_refuse_instead_of_going_direct() {
        for saved in ["http://[::1]=x:8080", "http://[::1]=x", "http://[fe80::1%25eth0]:8080", "http://[fe80::1%eth0]:8080", "http://a%0Ab:3128", "http://a%0Db:3128", "http://[::1\n]:8080", "socks5://[::1]=x:1080", "http://proxy.test\n=x:3128", "http://proxy.\ntest:3128", "http://proxy.test:3128\n--no-sandbox"] {
            let got = crate::net::proxy_of(Some(saved)).and_then(|p| p.map_or(Ok(String::new()), |u| proxy_flag(&u)));
            assert!(got.is_err(), "{saved} must refuse, got {got:?}");
        }
    }
}
