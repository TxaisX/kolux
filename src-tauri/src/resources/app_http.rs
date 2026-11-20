// T-323-b (SET-040, APP-032): the saved network proxy and the HTTP/1 switch applied to every HTTP
// client Kolux builds in Rust (the update download, the provider balance check). Everything is read
// here, in the back end: the sealed address goes from the secrets store into the client and nowhere
// else, and no command returns it. A setting that cannot be used is an error, never a direct request.
use super::app_proxy::{self, Route};
use crate::state::Store;
use tauri::Url;

pub const HTTP1_KEY: &str = "httpProxyHttp1";

/// How one request to one address is sent, from the saved settings.
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub route: Route,
    /// The HTTP/1 compatibility switch of Settings > General.
    pub http1: bool,
}

pub fn http1_on(store: &Store) -> bool {
    store.settings().get(HTTP1_KEY).and_then(|v| v.as_bool()) == Some(true)
}

pub fn plan_from_store(store: &Store, url: &Url) -> Result<Plan, String> {
    Ok(Plan { route: app_proxy::route_from_store(store, url)?, http1: http1_on(store) })
}

/// The updater's own request fields for a route: (explicit proxy, system proxy off).
pub fn updater_fields(route: &Route) -> (Option<Url>, bool) {
    match route {
        Route::Default => (None, false),
        Route::Direct => (None, true),
        Route::Via(p) => (Some(p.clone()), false),
    }
}

/// The plan for a request to `url`, from the open store of `app` (the lock is released before it returns).
/// The HTTP client side lives with the client (provider_net.rs), so this file names no network client.
pub fn plan_for(app: &tauri::AppHandle, url: &Url) -> Result<Plan, String> {
    use tauri::Manager;
    let store = app.state::<std::sync::Mutex<Store>>();
    let store = store.lock().map_err(|e| e.to_string())?;
    plan_from_store(&store, url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store(tag: &str) -> (crate::test_dir::TempDir, Store) {
        let dir = crate::test_dir::temp(tag);
        let store = Store::open(&dir).unwrap();
        (dir, store)
    }
    fn set(store: &Store, v: serde_json::Value) {
        store.patch_settings(v.as_object().unwrap(), &[]).unwrap();
    }
    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn set_040_the_http1_switch_is_off_until_the_setting_says_true() {
        let (_d, s) = store("http-switch");
        assert!(!http1_on(&s));
        set(&s, json!({ "httpProxyHttp1": "yes" }));
        assert!(!http1_on(&s), "only a real true counts");
        set(&s, json!({ "httpProxyHttp1": true }));
        assert!(http1_on(&s));
    }

    #[test]
    fn app_032_the_sealed_address_and_the_bypass_list_become_the_plan_and_the_switch_rides_along() {
        let (_d, s) = store("http-plan");
        crate::secrets::write_setting(&s, "httpProxy", "http://me:PW@proxy.corp:3128").unwrap();
        set(&s, json!({ "httpProxyBypass": ["github.com"], "httpProxyHttp1": true }));
        let via = plan_from_store(&s, &u("https://cdn.jsdelivr.net/npm/x.js")).unwrap();
        assert!(matches!(&via.route, Route::Via(p) if p.host_str() == Some("proxy.corp")) && via.http1);
        let direct = plan_from_store(&s, &u("https://github.com/x")).unwrap();
        assert_eq!(direct.route, Route::Direct);
        crate::secrets::clear_setting(&s, "httpProxy").unwrap();
        assert_eq!(plan_from_store(&s, &u("https://github.com/x")).unwrap().route, Route::Default, "emptied: back to the system proxy");
    }

    #[test]
    fn app_032_an_unusable_address_is_an_error_without_the_address_and_builds_no_client() {
        let (_d, s) = store("http-bad");
        crate::secrets::write_setting(&s, "httpProxy", "ftp://me:SECRET@p:1").unwrap();
        let e = plan_from_store(&s, &u("https://unpkg.com/x.js")).unwrap_err();
        assert!(!e.contains("SECRET") && !e.contains("ftp://"), "{e}");
    }

    #[test]
    fn app_032_each_route_reaches_the_updater_fields() {
        assert_eq!(updater_fields(&Route::Default), (None, false));
        assert_eq!(updater_fields(&Route::Direct), (None, true));
        assert_eq!(updater_fields(&Route::Via(u("http://p:8080"))), (Some(u("http://p:8080")), false));
    }

    // The address is read only inside the back end; no command here hands it to the page, and the stored copy is sealed.
    #[test]
    fn app_032_no_command_returns_the_proxy_address() {
        for (name, src) in [("app_proxy.rs", include_str!("app_proxy.rs")), ("app_http.rs", include_str!("app_http.rs"))] {
            let code = &src[..src.find("#[cfg(test)]").unwrap()];
            assert!(!code.contains("#[tauri::command]"), "{name} must not register a command");
        }
        let (dir, s) = store("http-sealed");
        crate::secrets::write_setting(&s, "httpProxy", "http://me:PROXYPW@proxy.corp:3128").unwrap();
        let page_view = serde_json::to_string(&s.settings()).unwrap();
        let disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        for seen in [page_view, disk] {
            assert!(!seen.contains("PROXYPW") && !seen.contains("proxy.corp"), "the stored setting is sealed");
        }
    }
}
