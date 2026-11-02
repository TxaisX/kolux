//! T-547 (OD-01 / DT-C32; coordinator default 2026-10-20, Txais may overrule): Kolux asks two
//! providers' published usage services itself, with a key the user gives it and that stays sealed
//! in the settings file (the secrets module). Only these two are built:
//! - Kimi Open Platform balance: a GET of the balance address on api.moonshot.ai with the user's
//!   Moonshot key as a Bearer token; the reply's data carries the available, voucher and cash
//!   balance (public docs: platform.kimi.ai/docs/api/balance; 401 = invalid or missing key).
//! - MiniMax M Plan remaining usage: a GET of the remains address on www.minimax.io with the key as
//!   a Bearer token (public docs: platform.minimax.io/docs/m-plan/faq.md and token-plan/faq.md).
//!   MiniMax publishes no format for the reply, so Kolux says only that MiniMax answered; the
//!   figures wait for published docs (kolux-rs-after.md). Its mainland endpoint has no published
//!   usage address, so nothing is asked there.
//!
//! Claude, Codex and Gemini are not asked anything here: their figures stay on what their own
//! sessions report (USAGE-021). Rules this module keeps:
//! - only an address on a host in [`HOSTS`] is ever asked, over https on the default port, with no
//!   user name in it ([`allowed`]); the transport follows no redirects, so the key goes nowhere else;
//! - a check runs only when the user asks for one: there is no background traffic;
//! - the key never reaches the page (only a masked tail, [`masked`]), never a log line and never an
//!   error text; [`Secret`] prints as stars;
//! - a refused key, a rate limit and no connection each read as their own plain state.
//!
//! The network call itself is behind [`Fetch`]. The shipped transport ([`transport`]) is the one
//! client in provider_net.rs: it re-checks the address, follows no redirect, gives up after 10
//! seconds and reads at most 64 KB. The privacy audit and the privacy statement name both hosts.

use crate::secrets;
use crate::state::Store;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// The only hosts a usage check may ask (T-547).
pub const HOSTS: [&str; 2] = ["api.moonshot.ai", "www.minimax.io"];
/// Kimi Open Platform balance (platform.kimi.ai/docs/api/balance).
pub const KIMI_URL: &str = "https://api.moonshot.ai/v1/users/me/balance";
/// MiniMax M Plan remaining usage (platform.minimax.io/docs/m-plan/faq.md, "Method 3").
pub const MINIMAX_URL: &str = "https://www.minimax.io/v1/token_plan/remains";
/// The sealed settings field that holds the Moonshot key (listed in secrets::SECRET_SETTINGS).
pub const KIMI_KEY: &str = "moonshotApiKey";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Kimi,
    Minimax,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Kimi, Provider::Minimax];

    pub fn parse(word: &str) -> Result<Provider, String> {
        match word {
            "kimi" => Ok(Provider::Kimi),
            "minimax" => Ok(Provider::Minimax),
            _ => Err(format!("{word} has no usage service Kolux asks")),
        }
    }

    /// The sealed settings field the provider's key lives in. MiniMax shares the key the
    /// Accounts page already keeps (ACCT-028), so there is one MiniMax key, not two.
    pub fn key_field(self) -> &'static str {
        match self {
            Provider::Kimi => KIMI_KEY,
            Provider::Minimax => crate::agent_creds::MINIMAX_KEY,
        }
    }

    pub fn url(self) -> &'static str {
        match self {
            Provider::Kimi => KIMI_URL,
            Provider::Minimax => MINIMAX_URL,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Kimi => "Kimi (Moonshot) API key",
            Provider::Minimax => "MiniMax API key",
        }
    }
}

/// A key on its way to the transport. It prints as stars, so a debug line or a panic message can
/// never carry it.
pub struct Secret(String);

/// Row 657: the key's bytes are overwritten when it is dropped, so it does not linger in freed
/// memory (best effort: no copy the standard library made earlier is reachable from here).
impl Drop for Secret {
    fn drop(&mut self) {
        let mut bytes = std::mem::take(&mut self.0).into_bytes();
        bytes.fill(0);
        std::hint::black_box(&bytes);
    }
}

impl Secret {
    pub fn new(plain: String) -> Secret {
        Secret(plain)
    }

    /// The key itself, for the Authorization header only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(****)")
    }
}

/// What the page shows of a kept key: dots and the last four characters, and only dots when the
/// key is short enough that four characters would be a large part of it.
pub fn masked(key: &str) -> String {
    let chars: Vec<char> = key.trim().chars().collect();
    if chars.len() < 16 {
        return "••••".to_string();
    }
    format!("••••{}", chars[chars.len() - 4..].iter().collect::<String>())
}

/// True only for an https address on one of [`HOSTS`], on the default port, with no user name or
/// password in it.
pub fn allowed(url: &str) -> bool {
    let Ok(u) = tauri::Url::parse(url) else { return false };
    u.scheme() == "https" && u.username().is_empty() && u.password().is_none() && u.port().is_none() && u.host_str().is_some_and(|h| HOSTS.contains(&h))
}

/// What the transport hands back: the status and the body text.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub status: u16,
    pub body: String,
}

/// Why no answer came back.
#[derive(Debug, Clone, PartialEq)]
pub enum NetFail {
    /// No connection, a name that does not resolve, or no answer in time.
    Offline,
    /// The call was not made (an address off the list, a key or proxy setting that cannot be used, or a reply that could not be read).
    NotMade(String),
}

/// The one network call a usage check makes: a GET of `url` with the key as a Bearer token.
pub trait Fetch {
    fn get(&self, url: &str, key: &Secret) -> Result<Answer, NetFail>;
}

/// What a check reads as on the page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Reading {
    /// No key kept for this provider: nothing was asked.
    NoKey,
    /// Kimi's balance, in the platform's currency (US dollars on platform.kimi.ai).
    Balance { available: f64, voucher: f64, cash: f64 },
    /// MiniMax answered the key; it publishes no format for the figures, so none are shown.
    Answered,
    /// The provider refused the key (401 or 403).
    BadKey,
    /// Too many checks in a short time (429).
    RateLimited,
    /// No connection to the provider.
    Offline,
    /// Nothing was asked, for the reason given.
    Unavailable { reason: String },
    /// The provider answered with something else.
    Failed { status: u16 },
}

/// Maps a transport result to what the page shows. Error bodies are never passed on: they are the
/// provider's text and could echo what was sent.
pub fn read_answer(p: Provider, answer: Result<Answer, NetFail>) -> Reading {
    let a = match answer {
        Ok(a) => a,
        Err(NetFail::Offline) => return Reading::Offline,
        Err(NetFail::NotMade(reason)) => return Reading::Unavailable { reason },
    };
    match a.status {
        401 | 403 => Reading::BadKey,
        429 => Reading::RateLimited,
        200..=299 => match p {
            Provider::Kimi => kimi_balance(&a.body).unwrap_or(Reading::Failed { status: a.status }),
            Provider::Minimax => Reading::Answered,
        },
        s => Reading::Failed { status: s },
    }
}

/// The Kimi balance reply: `data` with the three balances as numbers. A reply that says it failed
/// (`status` false or a non-zero `code`) or lacks a balance is not a balance.
fn kimi_balance(body: &str) -> Option<Reading> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v.get("status").and_then(Value::as_bool) == Some(false) || v.get("code").and_then(Value::as_i64).is_some_and(|c| c != 0) {
        return None;
    }
    let d = v.get("data")?;
    let n = |k: &str| d.get(k).and_then(Value::as_f64).filter(|x| x.is_finite());
    Some(Reading::Balance { available: n("available_balance")?, voucher: n("voucher_balance")?, cash: n("cash_balance")? })
}

/// One check: nothing is asked without a key, on MiniMax's mainland endpoint or for an address off
/// the list.
pub fn check(p: Provider, key: Option<Secret>, minimax_endpoint: &str, fetch: &dyn Fetch) -> Reading {
    let Some(key) = key else { return Reading::NoKey };
    if p == Provider::Minimax && minimax_endpoint == "mainland" {
        return Reading::Unavailable { reason: "MiniMax publishes no usage address for its mainland endpoint".into() };
    }
    if !allowed(p.url()) {
        return Reading::Unavailable { reason: "that address is not on the allowed list".into() };
    }
    read_answer(p, fetch.get(p.url(), &key))
}

/// The key row the settings page shows: kept or not, and the masked tail when kept.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRow {
    pub provider: Provider,
    pub label: &'static str,
    pub kept: bool,
    pub masked: Option<String>,
}

pub fn key_rows(store: &Store) -> Vec<KeyRow> {
    Provider::ALL
        .iter()
        .map(|&p| {
            let key = secrets::read_setting(store, p.key_field()).ok().flatten();
            KeyRow { provider: p, label: p.label(), kept: key.is_some(), masked: key.as_deref().map(masked) }
        })
        .collect()
}

/// Keeps a key, sealed. A key is one line of printable text with no spaces: anything else would
/// break the Authorization header and is refused before it is stored.
pub fn set_key(store: &Store, p: Provider, value: &str) -> Result<(), String> {
    let key = value.trim();
    if key.is_empty() {
        return Err("Paste a key first".into());
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control() || !c.is_ascii()) {
        return Err("A key is one line of letters, digits and symbols with no spaces".into());
    }
    // Rows 653/654: write_setting checks the same rule and the length cap for every writer.
    secrets::write_setting(store, p.key_field(), key)
}

pub fn forget_key(store: &Store, p: Provider) -> Result<(), String> {
    secrets::clear_setting(store, p.key_field())
}

/// The transport: the one client in provider_net.rs, reaching the network by the saved proxy plan.
pub fn transport(plan: crate::resources::app_http::Plan) -> impl Fetch {
    crate::resources::provider_net::Net::new(plan)
}

fn lock<'a>(store: &'a State<'_, Mutex<Store>>) -> Result<std::sync::MutexGuard<'a, Store>, String> {
    store.lock().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_keys(store: State<'_, Mutex<Store>>) -> Result<Vec<KeyRow>, String> {
    Ok(key_rows(&*lock(&store)?))
}

/// Saves or replaces a key; the MiniMax key is the Accounts page's too, so that page refreshes.
#[tauri::command]
pub fn provider_key_set(app: AppHandle, store: State<'_, Mutex<Store>>, provider: String, value: String) -> Result<Vec<KeyRow>, String> {
    let p = Provider::parse(&provider)?;
    let guard = lock(&store)?;
    set_key(&guard, p, &value)?;
    let rows = key_rows(&guard);
    drop(guard);
    let _ = app.emit(crate::agent_creds::EVENT, ());
    Ok(rows)
}

#[tauri::command]
pub fn provider_key_forget(app: AppHandle, store: State<'_, Mutex<Store>>, provider: String) -> Result<Vec<KeyRow>, String> {
    let p = Provider::parse(&provider)?;
    let guard = lock(&store)?;
    forget_key(&guard, p)?;
    let rows = key_rows(&guard);
    drop(guard);
    let _ = app.emit(crate::agent_creds::EVENT, ());
    Ok(rows)
}

/// One check, run when the user asks. The store lock is released before the network call.
#[tauri::command]
pub async fn provider_usage_check(store: State<'_, Mutex<Store>>, provider: String) -> Result<Reading, String> {
    let p = Provider::parse(&provider)?;
    let (key, endpoint, plan) = {
        let guard = lock(&store)?;
        // The saved proxy applies; a setting that cannot be used asks nothing (never a direct request).
        let plan = match tauri::Url::parse(p.url()).map_err(|e| e.to_string()).and_then(|u| crate::resources::app_http::plan_from_store(&guard, &u)) {
            Ok(plan) => plan,
            Err(reason) => return Ok(Reading::Unavailable { reason }),
        };
        let key = secrets::read_setting(&guard, p.key_field())?.map(Secret::new);
        let endpoint = guard.settings().get(crate::agent_creds::MINIMAX_ENDPOINT).and_then(Value::as_str).unwrap_or("overseas").to_string();
        (key, endpoint, plan)
    };
    tauri::async_runtime::spawn_blocking(move || check(p, key, &endpoint, &transport(plan))).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A transport that answers from a fixture and remembers what it was asked.
    struct Fixture {
        answer: Result<Answer, NetFail>,
        asked: RefCell<Vec<(String, String)>>,
    }

    impl Fixture {
        fn new(answer: Result<Answer, NetFail>) -> Fixture {
            Fixture { answer, asked: RefCell::new(Vec::new()) }
        }
        fn status(status: u16, body: &str) -> Fixture {
            Fixture::new(Ok(Answer { status, body: body.into() }))
        }
    }

    impl Fetch for Fixture {
        fn get(&self, url: &str, key: &Secret) -> Result<Answer, NetFail> {
            self.asked.borrow_mut().push((url.into(), key.expose().into()));
            self.answer.clone()
        }
    }

    fn key(k: &str) -> Option<Secret> {
        Some(Secret::new(k.into()))
    }

    // The balance reply as the Kimi balance page shows it.
    const KIMI_OK: &str = r#"{"code":0,"data":{"available_balance":49.58894,"voucher_balance":46.58893,"cash_balance":3.00001},"scode":"0x0","status":true}"#;
    // The error body shape the same page documents.
    const KIMI_401: &str = r#"{"error":{"message":"Invalid Authentication","type":"invalid_authentication_error"}}"#;

    #[test]
    fn t547_kimi_balance_is_read_from_the_documented_reply() {
        let f = Fixture::status(200, KIMI_OK);
        let r = check(Provider::Kimi, key("sk-moon-FIXTURE-0001"), "overseas", &f);
        assert_eq!(r, Reading::Balance { available: 49.58894, voucher: 46.58893, cash: 3.00001 });
        assert_eq!(f.asked.borrow().as_slice(), &[(KIMI_URL.to_string(), "sk-moon-FIXTURE-0001".to_string())], "one GET of the balance address with the key");
    }

    #[test]
    fn t547_a_reply_that_says_it_failed_or_lacks_a_balance_is_not_a_balance() {
        for body in [
            r#"{"code":0,"data":{"available_balance":1.0,"voucher_balance":0},"status":true}"#,
            r#"{"code":5,"data":{"available_balance":1.0,"voucher_balance":0,"cash_balance":1.0},"status":true}"#,
            r#"{"code":0,"data":{"available_balance":1.0,"voucher_balance":0,"cash_balance":1.0},"status":false}"#,
            r#"{"code":0,"data":{"available_balance":"1.0","voucher_balance":0,"cash_balance":1.0}}"#,
            "<html>gateway</html>",
            "",
        ] {
            assert_eq!(read_answer(Provider::Kimi, Ok(Answer { status: 200, body: body.into() })), Reading::Failed { status: 200 }, "{body}");
        }
        // A zero or negative balance is still a balance (Kimi stops requests at 0 or below).
        let r = read_answer(Provider::Kimi, Ok(Answer { status: 200, body: r#"{"code":0,"data":{"available_balance":-0.5,"voucher_balance":0,"cash_balance":-0.5},"status":true}"#.into() }));
        assert_eq!(r, Reading::Balance { available: -0.5, voucher: 0.0, cash: -0.5 });
    }

    #[test]
    fn t547_errors_map_to_bad_key_rate_limit_and_offline() {
        for p in Provider::ALL {
            assert_eq!(read_answer(p, Ok(Answer { status: 401, body: KIMI_401.into() })), Reading::BadKey);
            assert_eq!(read_answer(p, Ok(Answer { status: 403, body: String::new() })), Reading::BadKey);
            assert_eq!(read_answer(p, Ok(Answer { status: 429, body: String::new() })), Reading::RateLimited);
            assert_eq!(read_answer(p, Err(NetFail::Offline)), Reading::Offline);
            assert_eq!(read_answer(p, Ok(Answer { status: 500, body: "boom".into() })), Reading::Failed { status: 500 });
            assert_eq!(read_answer(p, Ok(Answer { status: 302, body: String::new() })), Reading::Failed { status: 302 }, "a redirect is not followed");
        }
        // The provider's own error text never reaches the page.
        let shown = serde_json::to_string(&read_answer(Provider::Kimi, Ok(Answer { status: 401, body: KIMI_401.into() }))).unwrap();
        assert_eq!(shown, r#"{"state":"badKey"}"#);
    }

    #[test]
    fn t547_minimax_answer_shows_no_invented_figures() {
        let f = Fixture::status(200, r#"{"anything":1}"#);
        assert_eq!(check(Provider::Minimax, key("mm-FIXTURE-key-0002"), "overseas", &f), Reading::Answered);
        assert_eq!(f.asked.borrow()[0].0, MINIMAX_URL);
        // The mainland endpoint has no published usage address: nothing is asked.
        let f = Fixture::status(200, "{}");
        assert!(matches!(check(Provider::Minimax, key("mm-FIXTURE-key-0002"), "mainland", &f), Reading::Unavailable { .. }));
        assert!(f.asked.borrow().is_empty());
    }

    #[test]
    fn t547_nothing_is_asked_without_a_key_or_off_the_list() {
        let f = Fixture::status(200, KIMI_OK);
        assert_eq!(check(Provider::Kimi, None, "overseas", &f), Reading::NoKey);
        assert!(f.asked.borrow().is_empty());
        for p in Provider::ALL {
            assert!(allowed(p.url()), "{:?}", p);
        }
        for bad in [
            "http://api.moonshot.ai/v1/users/me/balance",
            "https://api.moonshot.ai:8443/v1/users/me/balance",
            "https://user@api.moonshot.ai/v1",
            "https://api.moonshot.ai.example.com/v1",
            "https://api.moonshot.cn/v1/users/me/balance",
            "https://minimax.io/v1/token_plan/remains",
            "https://platform.minimax.io/v1/token_plan/remains",
            "not a url",
        ] {
            assert!(!allowed(bad), "{bad}");
        }
    }

    #[test]
    fn t547_the_key_prints_as_stars_and_shows_masked() {
        let s = Secret::new("sk-moon-FIXTURE-abcd1234".into());
        assert_eq!(format!("{s:?}"), "Secret(****)");
        assert_eq!(masked("sk-moon-FIXTURE-abcd1234"), "••••1234");
        assert_eq!(masked("short-key-12"), "••••", "a short key shows no characters");
        assert_eq!(masked(""), "••••");
    }

    #[test]
    fn t547_keys_are_kept_sealed_shown_masked_and_forgotten() {
        let dir = crate::test_dir::temp("t547-keys");
        let store = Store::open(&dir).unwrap();
        assert!(key_rows(&store).iter().all(|r| !r.kept && r.masked.is_none()));
        assert!(set_key(&store, Provider::Kimi, "   ").is_err());
        assert!(set_key(&store, Provider::Kimi, "sk-moon two parts").is_err(), "a space is refused");
        assert!(set_key(&store, Provider::Kimi, "sk-moon\r\nX-Evil: 1").is_err(), "a line break is refused");
        assert!(store.settings().get(KIMI_KEY).is_none(), "a refused key stores nothing");
        set_key(&store, Provider::Kimi, "  sk-moon-FIXTURE-SECRET-9876  ").unwrap();
        let disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!disk.contains("FIXTURE-SECRET"), "never in the clear on disk");
        assert_eq!(secrets::read_setting(&store, KIMI_KEY).unwrap().as_deref(), Some("sk-moon-FIXTURE-SECRET-9876"), "trimmed");
        let rows = key_rows(&store);
        assert_eq!((rows[0].provider, rows[0].kept, rows[0].masked.as_deref()), (Provider::Kimi, true, Some("••••9876")));
        assert!(!rows[1].kept);
        assert!(!serde_json::to_string(&rows).unwrap().contains("FIXTURE-SECRET"), "the page never receives the key");
        // MiniMax shares the Accounts page's key field.
        set_key(&store, Provider::Minimax, "mm-FIXTURE-SECRET-key-5555").unwrap();
        assert!(secrets::read_setting(&store, crate::agent_creds::MINIMAX_KEY).unwrap().is_some());
        forget_key(&store, Provider::Kimi).unwrap();
        let rows = key_rows(&store);
        assert_eq!((rows[0].kept, rows[1].kept), (false, true));
        assert!(store.settings().get(KIMI_KEY).is_none());
        assert_eq!(Provider::parse("claude"), Err("claude has no usage service Kolux asks".to_string()), "Claude, Codex and Gemini are not asked");
    }
}
