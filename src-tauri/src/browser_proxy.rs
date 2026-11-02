// Row 939 (T-240 BROW-033): the saved proxy must reach the engine. wry adds `--proxy-server` only
// when the app passes no browser arguments of its own, and Kolux always does (T-286-b), so the
// switch goes into the argument string here. An engine environment cannot change its options while
// it lives, and two on one data folder must agree, so each folder's first argument string is kept
// and a tab that would need another is refused: never opened, never opened direct.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Url;

pub const CREDENTIALS_REFUSED: &str = "The in-app browser can't use a proxy that needs a username and password. Nothing was loaded directly; set a proxy without credentials or clear the setting.";
pub const CHANGED_REFUSED: &str = "The proxy setting changed. Restart Kolux to apply it; nothing was loaded directly.";
const SHAPE_REFUSED: &str = "The in-app browser takes a proxy written as http://host:port or socks5://host:port, with no path. Nothing was loaded directly; fix the setting or clear it.";

/// The key of the data folder the main window and the default profile's tabs share.
pub const DEFAULT_FOLDER: &str = "default";

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

/// The argument string a tab passes for the saved proxy: the base arguments with exactly one
/// `--proxy-server` (any the base had is replaced), or the base as it is when no proxy is saved
/// (the system's proxy then applies to the engine by itself).
pub fn tab_browser_args(base: &str, proxy: Option<&Url>) -> Result<String, String> {
    let Some(proxy) = proxy else { return Ok(base.to_string()) };
    let flag = proxy_flag(proxy)?;
    let kept = strip(base, &["--proxy-server", "--no-proxy-server"]);
    Ok(if kept.is_empty() { flag } else { format!("{kept} {flag}") })
}

fn strip(args: &str, switches: &[&str]) -> String {
    args.split_whitespace().filter(|a| !switches.contains(&a.split('=').next().unwrap_or_default())).collect::<Vec<_>>().join(" ")
}

/// What a tab is built with: its browser arguments and the address for the builder's `proxy_url`.
/// Windows: the proxy rides in the arguments (wry ignores `proxy_url` beside them) and the folder's
/// engine must agree. Elsewhere wry reads only `proxy_url`, so the arguments stay the window's and
/// the saved address goes to the builder exactly as `proxy_of` gave it. On every OS an address the
/// engine cannot take (credentials, a path) is refused here, before anything loads.
pub fn tab_setup(launch: &str, folder: &str, saved: Option<&Url>) -> Result<(String, Option<Url>), String> {
    let args = tab_browser_args(&without_proxy(launch), saved)?; // on non-Windows only to validate the proxy
    if !cfg!(windows) {
        return Ok((launch.to_string(), saved.cloned()));
    }
    admit(folder, (folder == DEFAULT_FOLDER).then_some(launch), &args)?;
    // The window's own string when it matches: byte-exact even if the engine compares options exactly.
    Ok((if folder == DEFAULT_FOLDER { launch.to_string() } else { args }, None))
}

/// `args` without any `--proxy-server` switch.
pub fn without_proxy(args: &str) -> String {
    strip(args, &["--proxy-server"])
}

/// Whether two argument strings are the same switches (spacing aside).
pub fn same_args(a: &str, b: &str) -> bool {
    a.split_whitespace().eq(b.split_whitespace())
}

/// The argument string each data folder's engine environment was created with.
#[derive(Default)]
pub struct Envs {
    by_folder: HashMap<String, String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Open,
    Refuse,
}

impl Envs {
    /// A folder's first string is kept; a later tab opens only with the same one.
    pub fn admit(&mut self, folder: &str, args: &str) -> Verdict {
        if same_args(self.by_folder.entry(folder.to_string()).or_insert_with(|| args.to_string()), args) {
            Verdict::Open
        } else {
            Verdict::Refuse
        }
    }
}

static ENVS: LazyLock<Mutex<Envs>> = LazyLock::new(Default::default);

/// Does the tab open? `launch` is the main window's own string, which the default folder's
/// environment already has; a folder never seen takes `args` as its own.
pub fn admit(folder: &str, launch: Option<&str>, args: &str) -> Result<(), String> {
    // A poisoned lock refuses: the record cannot be trusted, and a tab never opens unchecked.
    let mut envs = ENVS.lock().map_err(|_| CHANGED_REFUSED.to_string())?;
    if let Some(launch) = launch {
        envs.by_folder.entry(folder.to_string()).or_insert_with(|| launch.to_string());
    }
    match envs.admit(folder, args) {
        Verdict::Open => Ok(()),
        Verdict::Refuse => Err(CHANGED_REFUSED.into()),
    }
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
    fn row939_a_saved_proxy_is_one_switch_after_the_base_arguments() {
        for (saved, flag) in [
            ("http://127.0.0.1:8080", "--proxy-server=http://127.0.0.1:8080"),
            ("socks5://proxy.test:1080", "--proxy-server=socks5://proxy.test:1080"),
            ("http://127.0.0.1:8080/", "--proxy-server=http://127.0.0.1:8080"),
        ] {
            let args = tab_browser_args(BASE, Some(&url(saved))).unwrap();
            assert_eq!(args, format!("{BASE} {flag}"), "{saved}");
            assert_eq!(count(&args, "--proxy-server="), 1);
            assert!(args.starts_with(BASE), "the base stays, wry's defaults with it");
        }
    }

    #[test]
    fn row939_no_proxy_leaves_the_base_alone() {
        assert_eq!(tab_browser_args(BASE, None).unwrap(), BASE);
        assert_eq!(tab_browser_args("", None).unwrap(), "");
    }

    #[test]
    fn row939_a_proxy_in_the_base_is_replaced_not_doubled() {
        let base = format!("--proxy-server=http://old:1 {BASE} --no-proxy-server");
        let args = tab_browser_args(&base, Some(&url("http://new.test:3128"))).unwrap();
        assert_eq!(count(&args, "--proxy-server="), 1);
        assert!(args.contains("--proxy-server=http://new.test:3128") && !args.contains("old:1") && !args.contains("--no-proxy-server"), "{args}");
        assert!(args.contains(BASE));
        assert_eq!(without_proxy(&format!("{BASE} --proxy-server=http://old:1")), BASE);
        assert_eq!(without_proxy(BASE), BASE);
    }

    #[test]
    fn row939_the_default_port_is_the_schemes_and_stated() {
        assert!(tab_browser_args(BASE, Some(&url("http://proxy.test"))).unwrap().ends_with("--proxy-server=http://proxy.test:80"));
        assert!(tab_browser_args(BASE, Some(&url("socks5://proxy.test"))).unwrap().ends_with("--proxy-server=socks5://proxy.test:1080"));
        assert!(tab_browser_args(BASE, Some(&url("http://[::1]:8080"))).unwrap().ends_with("--proxy-server=http://[::1]:8080"));
    }

    #[test]
    fn row939_a_proxy_with_credentials_refuses_and_never_echoes_them() {
        for saved in ["http://me:PLANTED-SECRET@127.0.0.1:8080", "socks5://me@proxy.test:1080", "http://:pw@proxy.test:80"] {
            let e = tab_browser_args(BASE, Some(&url(saved))).unwrap_err();
            assert_eq!(e, CREDENTIALS_REFUSED, "{saved}");
            assert!(!e.contains("PLANTED-SECRET") && !e.contains("me:"));
        }
    }

    #[test]
    fn row939_a_path_query_or_fragment_refuses() {
        for saved in ["http://proxy.test:8080/pac", "http://proxy.test:8080?x=1", "socks5://proxy.test:1080#f"] {
            let e = tab_browser_args(BASE, Some(&url(saved))).unwrap_err();
            assert_eq!(e, SHAPE_REFUSED, "{saved}");
        }
    }

    #[test]
    fn row939_a_host_the_switch_cannot_state_refuses_instead_of_going_direct() {
        // `=`, `;` and `,` make Chromium read the value as a per-scheme rule list, drop it and go direct.
        for saved in ["http://http=proxy.corp:3128", "socks5://a=b:1080", "http://a%3Db:3128", "socks5://a%3Db:1080", "http://a;b:3128", "http://a,b:3128", "socks5://a;b:1080", "socks5://a,b:1080"] {
            let u = url(saved);
            assert_eq!(proxy_flag(&u), Err(SHAPE_REFUSED.to_string()), "{saved}");
            assert_eq!(tab_browser_args(BASE, Some(&u)), Err(SHAPE_REFUSED.to_string()), "{saved}");
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
            assert_eq!(tab_setup("--a", DEFAULT_FOLDER, Some(&u)), Err(SHAPE_REFUSED.to_string()), "{saved}");
        }
        assert!(proxy_flag(&url("http://127.0.0.1:1")).is_ok());
    }

    // Row 939b: shapes the engine would read as something else. Each must stop at the setting (proxy_of
    // refuses) or at the switch (proxy_flag refuses); none may come out as a proxy.
    #[test]
    fn row939b_odd_host_shapes_refuse_instead_of_going_direct() {
        for saved in ["http://[::1]=x:8080", "http://[::1]=x", "http://[fe80::1%25eth0]:8080", "http://[fe80::1%eth0]:8080", "http://a%0Ab:3128", "http://a%0Db:3128", "http://[::1\n]:8080", "socks5://[::1]=x:1080", "http://proxy.test\n=x:3128", "http://proxy.\ntest:3128", "http://proxy.test:3128\n--no-sandbox"] {
            let got = crate::browser::proxy_of(Some(saved)).and_then(|p| p.map_or(Ok(String::new()), |u| proxy_flag(&u)));
            assert!(got.is_err(), "{saved} must refuse, got {got:?}");
        }
    }

    #[test]
    fn row939_a_default_folder_tab_passes_the_window_string_itself() {
        let launch = "--a  --proxy-server=http://x.test:1";
        let (args, _) = tab_setup(launch, DEFAULT_FOLDER, Some(&url("http://x.test:1"))).unwrap();
        assert_eq!(args, launch, "byte for byte, spacing included, not a rebuilt string");
    }

    #[test]
    fn row939_the_first_open_of_a_folder_is_recorded_and_the_same_string_opens() {
        let mut e = Envs::default();
        assert_eq!(e.admit("p1", "--a --proxy-server=http://x:1"), Verdict::Open, "first open");
        assert_eq!(e.admit("p1", "--a  --proxy-server=http://x:1"), Verdict::Open, "same switches");
        assert_eq!(e.admit("p2", "--a"), Verdict::Open, "another folder is its own environment");
    }

    #[test]
    fn row939_a_different_string_for_a_folder_refuses_and_the_record_stays() {
        let mut e = Envs::default();
        assert_eq!(e.admit("p1", "--a --proxy-server=http://x:1"), Verdict::Open);
        assert_eq!(e.admit("p1", "--a --proxy-server=http://y:2"), Verdict::Refuse, "the setting changed");
        assert_eq!(e.admit("p1", "--a"), Verdict::Refuse, "the proxy was cleared");
        assert_eq!(e.admit("p1", "--a --proxy-server=http://x:1"), Verdict::Open, "tabs already open keep the old proxy: the record did not move");
    }

    #[test]
    fn row939_tab_setup_refuses_credentials_on_every_os_and_hands_the_builder_the_proxy_of_address() {
        for saved in ["http://me:pw@127.0.0.1:8080", "http://127.0.0.1:8080/pac"] {
            assert!(tab_setup(BASE, "t939-setup-refuse", Some(&url(saved))).is_err(), "{saved}");
        }
        let given = crate::browser::proxy_of(Some("socks5://proxy.test:1080")).unwrap();
        let (args, for_builder) = tab_setup(BASE, "t939-setup-a", given.as_ref()).unwrap();
        if cfg!(windows) {
            assert_eq!(for_builder, None, "wry drops it beside browser arguments, so it rides in them");
            assert_eq!(args, format!("{BASE} --proxy-server=socks5://proxy.test:1080"));
        } else {
            assert_eq!(for_builder, given, "the builder gets the address proxy_of returned");
            assert_eq!(args, BASE, "the arguments are the window's, as before row 939");
        }
        let (args, for_builder) = tab_setup(BASE, "t939-setup-b", None).unwrap();
        assert_eq!((args.as_str(), for_builder), (BASE, None), "no proxy: nothing added anywhere");
    }

    #[test]
    fn row939_the_default_folder_is_the_windows_string() {
        let launch = "--a";
        assert_eq!(admit("t939-default-a", Some(launch), "--a"), Ok(()));
        assert_eq!(admit("t939-default-a", Some(launch), "--a --proxy-server=http://x:1"), Err(CHANGED_REFUSED.to_string()), "the window has no proxy: a proxied tab is refused, never opened direct");
        let launch = "--a --proxy-server=http://x:1";
        assert_eq!(admit("t939-default-b", Some(launch), "--a --proxy-server=http://x:1"), Ok(()));
        assert_eq!(admit("t939-default-b", Some(launch), "--a"), Err(CHANGED_REFUSED.to_string()), "the proxy was cleared after launch");
    }
}
