//! T-158 (BROW-015): a page's `window.open` that asks for a size (a sign-in through another
//! service, a payment window) opens a small window of its own instead of a tab. The window stays
//! the opener's popup (the page keeps its `window.opener`, so the sign-in finishes in the tab), it
//! inherits the opener's engine (profile, policies), and its title bar is the strip: the origin
//! alone, trimmed from the left so the real domain stays readable, marked "Not secure" for plain
//! http to another computer, then the page title. Closing the tab closes its popups; a closed
//! popup is unlinked from its tab. Unsafe addresses are refused, and before the opener's page has
//! finished its first load a popup goes to the system browser instead.
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::Url;

/// The longest origin the strip shows whole; a longer one keeps its right end (the real domain).
pub const STRIP_MAX: usize = 48;
/// Label prefix of a popup window.
pub const LABEL_PREFIX: &str = "browser-popup-";

/// What the strip says about an address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Strip {
    pub origin: String,
    pub secure: bool,
}

/// This computer's own names and addresses (plain http to them counts as secure).
pub fn loopback(host: &str) -> bool {
    let h = host.trim_end_matches('.').trim_start_matches('[').trim_end_matches(']');
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    h.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// The origin alone (scheme, host, a port that is not the scheme's own), never a path, query or
/// sign-in part; long origins are trimmed from the left.
pub fn strip(url: &Url) -> Strip {
    let host = url.host_str().unwrap_or_default();
    let origin = match url.port() {
        Some(p) => format!("{}://{}:{}", url.scheme(), host, p),
        None => format!("{}://{}", url.scheme(), host),
    };
    let secure = url.scheme() == "https" || (url.scheme() == "http" && loopback(host));
    Strip { origin: trim_left(&origin, STRIP_MAX), secure }
}

/// The last `max` characters behind an ellipsis when longer.
pub fn trim_left(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let tail: String = s.chars().skip(n - (max - 1)).collect();
    format!("…{tail}")
}

/// The popup window's title bar: the strip first (Kolux's own words, which no page title can push
/// aside), then the page title.
pub fn title(url: &Url, page_title: &str) -> String {
    let s = strip(url);
    let mark = if s.secure { "" } else { "Not secure · " };
    let page = page_title.trim();
    if page.is_empty() {
        format!("{mark}{}", s.origin)
    } else {
        format!("{mark}{} — {page}", s.origin)
    }
}

/// Where a page's new-window request goes once the tab rules allowed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// A plain `_blank` link or `window.open` without a size: another tab (BROW-014).
    Tab,
    /// A sized `window.open`: the small linked window.
    Window,
    /// The opener's page has not finished its first load: the system browser instead.
    System,
}

/// The route for an allowed request: `sized` = the page asked for a width or height, `ready` = the
/// opener's page finished a load.
pub fn route(sized: bool, ready: bool) -> Route {
    match (sized, ready) {
        (false, _) => Route::Tab,
        (true, true) => Route::Window,
        (true, false) => Route::System,
    }
}

#[derive(Default)]
pub struct Links {
    /// tab id -> its popup labels
    by_tab: HashMap<u32, Vec<String>>,
    /// tabs whose page finished a load
    ready: HashSet<u32>,
    next: u32,
}

impl Links {
    /// A fresh label for a popup of `tab`, linked to it.
    pub fn open(&mut self, tab: u32) -> String {
        self.next += 1;
        let label = format!("{LABEL_PREFIX}{tab}-{}", self.next);
        self.by_tab.entry(tab).or_default().push(label.clone());
        label
    }
    /// A popup closed: it is unlinked from its tab.
    pub fn closed(&mut self, label: &str) {
        for v in self.by_tab.values_mut() {
            v.retain(|l| l != label);
        }
        self.by_tab.retain(|_, v| !v.is_empty());
    }
    /// The tab closed: its popups, to close with it.
    pub fn tab_closed(&mut self, tab: u32) -> Vec<String> {
        self.ready.remove(&tab);
        self.by_tab.remove(&tab).unwrap_or_default()
    }
    pub fn mark_ready(&mut self, tab: u32) {
        self.ready.insert(tab);
    }
    pub fn is_ready(&self, tab: u32) -> bool {
        self.ready.contains(&tab)
    }
    #[cfg(test)]
    pub fn popups_of(&self, tab: u32) -> &[String] {
        self.by_tab.get(&tab).map(Vec::as_slice).unwrap_or(&[])
    }
}

pub static LINKS: LazyLock<Mutex<Links>> = LazyLock::new(Default::default);

pub fn mark_ready(tab: u32) {
    if let Ok(mut l) = LINKS.lock() {
        l.mark_ready(tab);
    }
}

pub fn is_ready(tab: u32) -> bool {
    LINKS.lock().map(|l| l.is_ready(tab)).unwrap_or(false)
}

// T-657 (R07-browser.3, DT-C93): a page opens a window, a tab or the system browser only when the
// user started it. The engine's own handlers (browser_engine::attach) record its word on that
// (`IsUserInitiated`) for every new-window request and for every `kolux-chord:` request the
// page's script makes; the app's handlers act only on a request recorded as user-started. No
// record (the engine said nothing) counts as not started: it fails closed.

/// How long the engine's word on one request is kept for the app's handler to read.
const WORD_KEPT: Duration = Duration::from_secs(2);
/// The words kept at most (a page flooding requests cannot grow the list).
const WORDS_KEPT: usize = 32;

/// The engine's word on new-window requests: (tab, address, user started, when).
#[derive(Default)]
pub struct Windows(Vec<(u32, String, bool, Instant)>);

impl Windows {
    pub fn note(&mut self, tab: u32, uri: &str, user: bool, now: Instant) {
        self.0.retain(|w| now.saturating_duration_since(w.3) <= WORD_KEPT);
        if self.0.len() >= WORDS_KEPT {
            self.0.remove(0);
        }
        self.0.push((tab, same_form(uri), user, now));
    }
    /// Whether the user started `tab`'s request for `url` (the word is used up).
    pub fn take(&mut self, tab: u32, url: &Url, now: Instant) -> bool {
        self.0.retain(|w| now.saturating_duration_since(w.3) <= WORD_KEPT);
        let want = same_form(url.as_str());
        match self.0.iter().position(|w| w.0 == tab && w.1 == want) {
            Some(i) => self.0.remove(i).2,
            None => false,
        }
    }
}

/// An address in one written form, so the engine's text and the toolkit's parsed address compare.
fn same_form(uri: &str) -> String {
    Url::parse(uri).map(|u| u.to_string()).unwrap_or_else(|_| uri.to_string())
}

/// What the app does with a page's request once the engine says the user started it.
pub type Act = Box<dyn FnOnce() + Send>;

enum Half {
    Word(bool),
    Act(Act),
}

/// The two halves of a page's `kolux-chord:` request: the engine's word and the app's action.
/// Both handlers see the same navigation, in an order neither controls; whichever comes second
/// completes it.
#[derive(Default)]
pub struct Meet(Vec<(u32, String, Half, Instant)>);

impl Meet {
    /// The engine's word on `tab`'s request `uri`: the action to run now, if the app's came first
    /// and the user started it.
    pub fn word(&mut self, tab: u32, uri: &str, user: bool, now: Instant) -> Option<Act> {
        self.half(tab, same_form(uri), Half::Word(user), now)
    }
    /// The app's action for `tab`'s request `uri`: itself, to run now, if the engine's word came
    /// first and says the user started it.
    pub fn act(&mut self, tab: u32, uri: &str, act: Act, now: Instant) -> Option<Act> {
        self.half(tab, same_form(uri), Half::Act(act), now)
    }
    fn half(&mut self, tab: u32, uri: String, h: Half, now: Instant) -> Option<Act> {
        self.0.retain(|m| now.saturating_duration_since(m.3) <= WORD_KEPT);
        let pairs = |m: &Half| matches!((m, &h), (Half::Word(_), Half::Act(_)) | (Half::Act(_), Half::Word(_)));
        let Some(i) = self.0.iter().position(|m| m.0 == tab && m.1 == uri && pairs(&m.2)) else {
            if self.0.len() >= WORDS_KEPT {
                self.0.remove(0);
            }
            self.0.push((tab, uri, h, now));
            return None;
        };
        match (self.0.remove(i).2, h) {
            (Half::Word(user), Half::Act(act)) | (Half::Act(act), Half::Word(user)) => user.then_some(act),
            _ => None,
        }
    }
}

static WINDOWS: LazyLock<Mutex<Windows>> = LazyLock::new(Default::default);
static MEET: LazyLock<Mutex<Meet>> = LazyLock::new(Default::default);

/// The engine's word on a new-window request from `tab` (its handler runs before the toolkit's).
pub fn window_word(tab: u32, uri: &str, user: bool) {
    if let Ok(mut w) = WINDOWS.lock() {
        w.note(tab, uri, user, Instant::now());
    }
}

/// Whether the user started `tab`'s new-window request for `url`, by the engine's word.
pub fn window_started(tab: u32, url: &Url) -> bool {
    // Only WebView2 gives the word; on other engines the earlier checks alone apply (DT-C93).
    if cfg!(not(windows)) {
        return true;
    }
    WINDOWS.lock().map(|mut w| w.take(tab, url, Instant::now())).unwrap_or(false)
}

/// The engine's word on a `kolux-chord:` request from `tab`.
pub fn request_word(tab: u32, uri: &str, user: bool) {
    let run = MEET.lock().ok().and_then(|mut m| m.word(tab, uri, user, Instant::now()));
    if let Some(run) = run {
        run();
    }
}

/// Runs `act` for `tab`'s `kolux-chord:` request `uri` once the engine says the user started it.
pub fn when_started(tab: u32, uri: &str, act: Act) {
    if cfg!(not(windows)) {
        return act();
    }
    let run = MEET.lock().ok().and_then(|mut m| m.act(tab, uri, act, Instant::now()));
    if let Some(run) = run {
        run();
    }
}

/// Opens the popup window for `tab` on the opener's engine. `None` when the window toolkit refused.
pub fn open(
    app: &tauri::AppHandle,
    tab: u32,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
    dev: Option<Url>,
    spoof: bool,
) -> Option<tauri::WebviewWindow> {
    use tauri::webview::NewWindowResponse;
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = LINKS.lock().ok()?.open(tab);
    let frame_dev = dev.clone();
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.clone()));
    // T-239-b (BROW-025): a popup opened onto a sign-in host starts as Firefox when its tab's
    // profile is in normal mode; later hops are kept right by `engine::popup_identity`.
    if super::profiles::firefox_at(url.as_str(), spoof) {
        builder = builder.user_agent(&super::profiles::firefox_identity());
    }
    let built = builder
        .window_features(features)
        .title(title(url, ""))
        .zoom_hotkeys_enabled(false)
        .on_document_title_changed(|w, page| {
            if let Ok(u) = w.url() {
                let _ = w.set_title(&title(&u, &page));
            }
        })
        // The popup goes only where a tab may (http, https, never the app's own hosts); the strip
        // follows it as it navigates.
        .on_navigation(move |u| super::allowed(u, dev.as_ref()).is_ok())
        .on_page_load(|w, payload| {
            let _ = w.set_title(&title(payload.url(), &w.title().unwrap_or_default()));
        })
        // A popup's own windows are refused: a sign-in needs none, and nothing stacks up.
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
    match built {
        Ok(w) => {
            let gone = label.clone();
            w.on_window_event(move |e| {
                if matches!(e, tauri::WindowEvent::Destroyed) {
                    if let Ok(mut l) = LINKS.lock() {
                        l.closed(&gone);
                    }
                }
            });
            super::engine::popup_identity(&w, spoof);
            // after-list 718: no engine prompt in a popup; the opener tab's permission rules answer.
            super::engine::popup_permissions(&w, tab, app.clone());
            // T-607 (L1-tauri.1): no frame of Kolux's own address in a popup either.
            super::engine::popup_frames(&w, frame_dev);
            Some(w)
        }
        Err(_) => {
            if let Ok(mut l) = LINKS.lock() {
                l.closed(&label);
            }
            None
        }
    }
}

/// The tab closed: its popups close with it.
pub fn close_for(app: &tauri::AppHandle, tab: u32) {
    use tauri::Manager;
    let labels = LINKS.lock().map(|mut l| l.tab_closed(tab)).unwrap_or_default();
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
}

/// T-319-b (BROW-026): the engine's built-in identity prompt (FedCM) cannot work inside a pane, so
/// it is switched off and sites fall back to their ordinary popup or redirect sign-in. Engine
/// switches are one string shared by every web view on a data folder, so this adds the feature to
/// that string's one `--disable-features=` list (a second such switch would replace the first).
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

    #[test]
    fn brow032_a_popup_is_answered_by_its_opener_tabs_permission_rules() {
        // The engine hook cannot run in a unit test (no web view); the regression guard is that the
        // popup's build path wires it with the opener's tab id, after the identity hook.
        let src = include_str!("browser_popup.rs");
        let open = &src[src.find("pub fn open(").unwrap()..src.find("pub fn close_for(").unwrap()];
        let ident = open.find("engine::popup_identity(&w, spoof)").unwrap();
        let perms = open.find(["engine::popup_permissions(&w, tab, ", "app.clone())"].concat().as_str()).expect("popup permissions hook");
        assert!(perms > ident);
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

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn brow015_the_strip_is_the_origin_alone_never_path_query_or_sign_in() {
        let s = strip(&u("https://user:pw@github.com/login/oauth/authorize?client_id=abc&state=xyz#frag"));
        assert_eq!(s.origin, "https://github.com");
        assert!(s.secure);
        assert_eq!(strip(&u("https://pay.example.com:8443/checkout?id=1")).origin, "https://pay.example.com:8443");
        // the scheme's own port is not shown
        assert_eq!(strip(&u("https://example.com:443/x")).origin, "https://example.com");
    }

    #[test]
    fn brow015_long_origins_are_trimmed_from_the_left_so_the_domain_stays() {
        let long = "https://a-very-long-subdomain-name.another-long-part.login.example.com/path";
        let s = strip(&u(long));
        assert_eq!(s.origin.chars().count(), STRIP_MAX);
        assert!(s.origin.starts_with('…'));
        assert!(s.origin.ends_with("login.example.com"));
        // exactly at the limit: kept whole
        let at = format!("https://{}.com", "a".repeat(STRIP_MAX - "https://.com".len()));
        assert_eq!(strip(&u(&at)).origin.chars().count(), STRIP_MAX);
        assert!(!strip(&u(&at)).origin.starts_with('…'));
    }

    #[test]
    fn brow015_plain_http_is_not_secure_except_to_this_computer() {
        assert!(!strip(&u("http://example.com/")).secure);
        assert!(strip(&u("http://localhost:3000/")).secure);
        assert!(strip(&u("http://127.0.0.1:8080/")).secure);
        assert!(strip(&u("http://127.4.5.6/")).secure);
        assert!(strip(&u("http://[::1]:5173/")).secure);
        assert!(!strip(&u("http://localhost.example.com/")).secure, "a lookalike is not this computer");
        assert!(!strip(&u("http://10.0.0.5/")).secure, "another computer on the network is not this one");
    }

    #[test]
    fn brow015_the_title_bar_puts_the_strip_before_the_page_title() {
        assert_eq!(title(&u("https://github.com/login?x=1"), "Sign in to GitHub"), "https://github.com — Sign in to GitHub");
        assert_eq!(title(&u("http://example.com/a"), "Pay"), "Not secure · http://example.com — Pay");
        assert_eq!(title(&u("https://github.com/"), "  "), "https://github.com");
        // a page title pretending to be an origin still comes after the real one
        assert!(title(&u("https://evil.test/"), "https://bank.com").starts_with("https://evil.test — "));
    }

    #[test]
    fn brow015_a_sized_request_is_a_popup_window_and_waits_for_the_openers_first_load() {
        assert_eq!(route(false, true), Route::Tab);
        assert_eq!(route(false, false), Route::Tab);
        assert_eq!(route(true, true), Route::Window);
        assert_eq!(route(true, false), Route::System);
    }

    #[test]
    fn brow015_popups_stay_linked_to_their_tab_and_close_with_it() {
        let mut l = Links::default();
        let a = l.open(7);
        let b = l.open(7);
        let c = l.open(9);
        assert_ne!(a, b);
        assert!(a.starts_with(LABEL_PREFIX));
        assert_eq!(l.popups_of(7), [a.clone(), b.clone()]);
        // a closed popup is unlinked; its tab and the other popup stay
        l.closed(&a);
        assert_eq!(l.popups_of(7), std::slice::from_ref(&b));
        // the tab closes: its remaining popups are handed back to close, the other tab's stay
        l.mark_ready(7);
        assert_eq!(l.tab_closed(7), vec![b]);
        assert!(!l.is_ready(7));
        assert_eq!(l.popups_of(9), [c]);
        assert!(l.tab_closed(7).is_empty());
    }

    // T-657 (DT-C93)
    #[test]
    fn t657_a_window_the_user_did_not_start_is_refused_and_one_they_did_passes() {
        let now = Instant::now();
        let mut w = Windows::default();
        let timer = Url::parse("http://127.0.0.1:9/tick-0").unwrap();
        let click = Url::parse("http://127.0.0.1:9/clicked-open").unwrap();
        w.note(4, "http://127.0.0.1:9/tick-0", false, now);
        w.note(4, "http://127.0.0.1:9/clicked-open", true, now);
        assert!(!w.take(4, &timer, now), "a page timer opens nothing");
        assert!(w.take(4, &click, now), "the user's click opens its window");
        // The word is used up, belongs to one tab, and no word at all is a refusal (fails closed).
        assert!(!w.take(4, &click, now));
        w.note(4, "http://127.0.0.1:9/clicked-open", true, now);
        assert!(!w.take(5, &click, now));
        assert!(!w.take(4, &Url::parse("http://127.0.0.1:9/never").unwrap(), now));
        // An old word is gone; the list stays bounded under a flood.
        assert!(!w.take(4, &click, now + WORD_KEPT + Duration::from_millis(1)));
        for i in 0..100 {
            w.note(4, &format!("http://127.0.0.1:9/f{i}"), false, now);
        }
        assert!(w.0.len() <= WORDS_KEPT);
        // The engine's text and the toolkit's parsed address compare in one form.
        w.note(4, "HTTP://127.0.0.1:9", true, now);
        assert!(w.take(4, &Url::parse("http://127.0.0.1:9/").unwrap(), now));
    }

    #[test]
    fn t657_a_page_request_acts_only_on_the_engines_word_in_either_order() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let now = Instant::now();
        let ran = Arc::new(AtomicUsize::new(0));
        let act = || {
            let ran = ran.clone();
            Box::new(move || {
                ran.fetch_add(1, Ordering::SeqCst);
            }) as Act
        };
        let pick = "kolux-chord:pick?what=open-kolux&u=http%3A%2F%2F127.0.0.1%3A9%2Fp";
        let mut m = Meet::default();
        // The app first, then the engine: user started runs it, not started drops it.
        assert!(m.act(1, pick, act(), now).is_none());
        m.word(1, pick, true, now).unwrap()();
        assert!(m.act(1, pick, act(), now).is_none());
        assert!(m.word(1, pick, false, now).is_none());
        // The engine first, then the app.
        assert!(m.word(1, pick, true, now).is_none());
        m.act(1, pick, act(), now).unwrap()();
        assert!(m.word(1, pick, false, now).is_none());
        assert!(m.act(1, pick, act(), now).is_none());
        // Another tab or another request does not complete the pair; an old half is gone.
        assert!(m.word(2, pick, true, now).is_none());
        assert!(m.act(1, "kolux-chord:open-front?u=x", act(), now).is_none());
        assert!(m.word(1, "kolux-chord:open-front?u=x", true, now + WORD_KEPT + Duration::from_millis(1)).is_none());
        assert_eq!(ran.load(Ordering::SeqCst), 2);
        for i in 0..100 {
            m.act(3, &format!("kolux-chord:pick?n={i}"), act(), now);
        }
        assert!(m.0.len() <= WORDS_KEPT);
    }
}
