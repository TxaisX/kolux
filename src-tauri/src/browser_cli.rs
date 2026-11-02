//! T-195 (BROW-042, BROW-046, BROW-047): the `kolux` browser commands. An agent in a worktree
//! runs `kolux goto`, `kolux snapshot`, `kolux click --element e12` and the rest; each command goes
//! to the worktree's active browser tab (or `--page <n>`), where the user can watch. Kolux is its
//! own page-driving helper: every command is a script run inside the page through the web view
//! (no third-party automation helper is pinned; owner decision recorded in the T-195 commit). The
//! helper's state (the element references a snapshot hands out) lives in the page, so a page that
//! is replaced starts clean and an old reference is refused with "run snapshot again".
//!
//! `cli.rs` is a shared file: it gains this module's table, check, run and text by
//! `evidence/browser-T-195-cli.rs.patch` (applied in MERGE 198).

use super::{eval_json, pick_tab, preview, profiles, same_dir, tabs, tell, Tab, EVAL_WAIT};
use crate::cli::{Fail, Request};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub type Command = (&'static str, &'static str, &'static [&'static str]);

/// Every browser command path, its wire name and its flags (`--worktree`, `--page` and `--json`
/// on all of them; BROW-042 Compat).
pub const COMMANDS: &[Command] = &[
    ("goto", "browser.goto", &["url", "worktree", "page"]),
    ("back", "browser.back", &["worktree", "page"]),
    ("forward", "browser.forward", &["worktree", "page"]),
    ("reload", "browser.reload", &["worktree", "page"]),
    ("wait", "browser.wait", &["selector", "timeout", "text", "url", "load", "fn", "state", "worktree", "page"]),
    ("eval", "browser.eval", &["expression", "worktree", "page"]),
    ("scroll", "browser.scroll", &["direction", "amount", "worktree", "page"]),
    ("snapshot", "browser.snapshot", &["worktree", "page"]),
    ("screenshot", "browser.screenshot", &["format", "path", "worktree", "page"]),
    ("full-screenshot", "browser.full-screenshot", &["format", "path", "worktree", "page"]),
    ("pdf", "browser.pdf", &["path", "worktree", "page"]),
    ("click", "browser.click", &["element", "worktree", "page"]),
    ("dblclick", "browser.dblclick", &["element", "worktree", "page"]),
    ("check", "browser.check", &["element", "worktree", "page"]),
    ("uncheck", "browser.uncheck", &["element", "worktree", "page"]),
    ("focus", "browser.focus", &["element", "worktree", "page"]),
    ("clear", "browser.clear", &["element", "worktree", "page"]),
    ("select-all", "browser.select-all", &["element", "worktree", "page"]),
    ("hover", "browser.hover", &["element", "worktree", "page"]),
    ("scrollintoview", "browser.scrollintoview", &["element", "worktree", "page"]),
    ("fill", "browser.fill", &["element", "value", "worktree", "page"]),
    ("type", "browser.type", &["input", "worktree", "page"]),
    ("inserttext", "browser.inserttext", &["text", "worktree", "page"]),
    ("select", "browser.select", &["element", "value", "worktree", "page"]),
    ("keypress", "browser.keypress", &["key", "worktree", "page"]),
    ("drag", "browser.drag", &["from", "to", "worktree", "page"]),
    ("upload", "browser.upload", &["element", "files", "worktree", "page"]),
    ("download", "browser.download", &["selector", "path", "worktree", "page"]),
    ("highlight", "browser.highlight", &["selector", "worktree", "page"]),
    ("find", "browser.find", &["locator", "value", "action", "text", "worktree", "page"]),
    ("get", "browser.get", &["what", "element", "worktree", "page"]),
    ("is", "browser.is", &["what", "element", "worktree", "page"]),
    ("mouse move", "browser.mouse-move", &["x", "y", "worktree", "page"]),
    ("mouse down", "browser.mouse-down", &["button", "worktree", "page"]),
    ("mouse up", "browser.mouse-up", &["button", "worktree", "page"]),
    ("mouse wheel", "browser.mouse-wheel", &["dy", "dx", "worktree", "page"]),
    ("exec", "browser.exec", &["command", "worktree", "page"]),
    // T-241 (BROW-044, BROW-045, BROW-048): tabs, profiles, cookies and web storage. The tab and
    // profile commands need no page but keep the two flags every browser command takes.
    ("tab list", "browser.tab-list", &["show-profile", "worktree", "page"]),
    ("tab current", "browser.tab-current", &["worktree", "page"]),
    ("tab show", "browser.tab-show", &["index", "worktree", "page"]),
    ("tab switch", "browser.tab-switch", &["index", "focus", "worktree", "page"]),
    ("tab create", "browser.tab-create", &["url", "profile", "lease", "holder", "worktree", "page"]),
    ("tab close", "browser.tab-close", &["index", "worktree", "page"]),
    // T-312-b (ORCH-061): page leases. One holder at a time owns a placement; the pages it opens
    // there with `tab create --lease` close when it releases the lease.
    ("tab lease", "browser.tab-lease", &["lease", "holder", "worktree", "page"]),
    ("tab release", "browser.tab-release", &["lease", "holder", "worktree", "page"]),
    ("tab leases", "browser.tab-leases", &["worktree", "page"]),
    ("tab profile", "browser.tab-profile", &["worktree", "page"]),
    ("tab profile set", "browser.tab-profile-set", &["profile", "worktree", "page"]),
    ("tab profile use-default", "browser.tab-profile-use-default", &["worktree", "page"]),
    ("tab profile clone", "browser.tab-profile-clone", &["worktree", "page"]),
    ("profiles list", "browser.profiles-list", &["worktree", "page"]),
    ("profiles create", "browser.profiles-create", &["label", "scope", "no-ua-spoof", "worktree", "page"]),
    ("profiles delete", "browser.profiles-delete", &["profile", "worktree", "page"]),
    ("cookie get", "browser.cookie-get", &["name", "url", "worktree", "page"]),
    ("cookie set", "browser.cookie-set", &["name", "value", "url", "domain", "path", "expires", "secure", "httpOnly", "sameSite", "worktree", "page"]),
    ("cookie delete", "browser.cookie-delete", &["name", "url", "domain", "path", "worktree", "page"]),
    ("storage get", "browser.storage-get", &["area", "key", "worktree", "page"]),
    ("storage set", "browser.storage-set", &["area", "key", "value", "worktree", "page"]),
    ("storage clear", "browser.storage-clear", &["area", "worktree", "page"]),
    // T-251 (CLI-047 Compat): the area as a word, `storage local set --key a --value=`.
    ("storage local get", "browser.storage-local-get", &["key", "worktree", "page"]),
    ("storage local set", "browser.storage-local-set", &["key", "value", "worktree", "page"]),
    ("storage local clear", "browser.storage-local-clear", &["worktree", "page"]),
    ("storage session get", "browser.storage-session-get", &["key", "worktree", "page"]),
    ("storage session set", "browser.storage-session-set", &["key", "value", "worktree", "page"]),
    ("storage session clear", "browser.storage-session-clear", &["worktree", "page"]),
    // T-242 (BROW-049): interception, capture and the console and network logs.
    ("intercept enable", "browser.intercept-enable", &["patterns", "worktree", "page"]),
    ("intercept disable", "browser.intercept-disable", &["worktree", "page"]),
    ("intercept list", "browser.intercept-list", &["worktree", "page"]),
    ("capture start", "browser.capture-start", &["worktree", "page"]),
    ("capture stop", "browser.capture-stop", &["worktree", "page"]),
    ("console", "browser.console", &["limit", "worktree", "page"]),
    ("network", "browser.network", &["limit", "worktree", "page"]),
    // T-242 (BROW-050): emulation, dialogs and the clipboard.
    ("viewport", "browser.viewport", &["width", "height", "scale", "mobile", "worktree", "page"]),
    ("geolocation", "browser.geolocation", &["latitude", "longitude", "accuracy", "worktree", "page"]),
    ("set device", "browser.set-device", &["name", "worktree", "page"]),
    ("set offline", "browser.set-offline", &["state", "worktree", "page"]),
    ("set headers", "browser.set-headers", &["headers", "origin", "worktree", "page"]),
    ("set credentials", "browser.set-credentials", &["user", "pass", "origin", "worktree", "page"]),
    ("set media", "browser.set-media", &["color-scheme", "reduced-motion", "worktree", "page"]),
    ("clipboard read", "browser.clipboard-read", &["worktree", "page"]),
    ("clipboard write", "browser.clipboard-write", &["text", "worktree", "page"]),
    ("dialog accept", "browser.dialog-accept", &["text", "worktree", "page"]),
    ("dialog dismiss", "browser.dialog-dismiss", &["worktree", "page"]),
];

/// BROW-050 `kolux set device --name`: width, height, scale and whether it is a mobile device.
/// ponytail: a short table of common devices; a settings file if people ask for their own.
pub const DEVICES: &[(&str, f64, f64, f64, bool)] = &[
    // T-240 (BROW-034): the toolbar's presets, names and sizes as the compat list has them; phone
    // and tablet presets are double density with the phone identity and touch.
    ("Mobile S", 320.0, 568.0, 2.0, true),
    ("Mobile M", 375.0, 667.0, 2.0, true),
    ("Mobile L", 425.0, 812.0, 2.0, true),
    ("Tablet", 768.0, 1024.0, 2.0, true),
    ("Laptop", 1024.0, 768.0, 1.0, false),
    ("Laptop L", 1440.0, 900.0, 1.0, false),
    ("Desktop", 1920.0, 1080.0, 1.0, false),
    ("iPhone SE", 375.0, 667.0, 2.0, true),
    ("iPhone 14", 390.0, 844.0, 3.0, true),
    ("iPhone 14 Pro Max", 430.0, 932.0, 3.0, true),
    ("Pixel 7", 412.0, 915.0, 2.625, true),
    ("Galaxy S23", 360.0, 780.0, 3.0, true),
    ("iPad", 810.0, 1080.0, 2.0, true),
    ("iPad Pro 12.9", 1024.0, 1366.0, 2.0, true),
    ("Desktop 1080p", 1920.0, 1080.0, 1.0, false),
];
/// BROW-034: the presets the toolbar's Viewport Size menu offers, in its order (the rest of
/// [`DEVICES`] are the command line's `set device` names).
pub const PRESETS: usize = 7;
/// A clipboard write larger than this is refused before anything runs (BROW-050).
pub const CLIPBOARD_MAX: usize = 1024 * 1024;
/// `kolux console` / `kolux network` without `--limit`.
pub const LOG_DEFAULT: usize = 100;
/// The most entries a capture keeps per log.
const CAPTURE_MAX: usize = 2000;
const COLOR_SCHEMES: &[&str] = &["dark", "light"];
const MOTIONS: &[&str] = &["reduce", "no-preference"];

/// Reference-based element commands (BROW-047).
const ELEMENT: &[&str] = &["browser.click", "browser.dblclick", "browser.check", "browser.uncheck", "browser.focus", "browser.clear", "browser.select-all", "browser.hover", "browser.scrollintoview"];
const WAIT_CONDITIONS: &[&str] = &["selector", "text", "url", "load", "fn", "state"];
const LOAD_STATES: &[&str] = &["load", "domcontentloaded", "networkidle"];
const GET_WHAT: &[&str] = &["text", "html", "value", "url", "title", "count", "box"];
const IS_WHAT: &[&str] = &["visible", "enabled", "checked"];
const BUTTONS: &[&str] = &["left", "right", "middle"];
const FIND_ACTIONS: &[&str] = &["click", "dblclick", "check", "uncheck", "focus", "clear", "select-all", "hover", "scrollintoview", "fill", "type", "select", "highlight"];
const LOCATORS: &[&str] = &["role", "text", "label", "selector", "placeholder"];
const STORAGE_AREAS: &[&str] = &["local", "session"];
/// A wait with no `--timeout`, and the longest one accepted.
pub const WAIT_DEFAULT_MS: u64 = 5_000;
pub const WAIT_MAX_MS: u64 = 300_000;
/// How often a wait asks the page again.
const WAIT_STEP: Duration = Duration::from_millis(100);
/// Inserted text goes to the page in pieces this long, in order (BROW-047).
pub const TYPE_PIECE: usize = 500;
/// Upload: the most file bytes carried into the page in one command.
const UPLOAD_MAX: u64 = 8 * 1024 * 1024;

fn args(message: impl Into<String>) -> Fail {
    Fail::new("invalid_arguments", message)
}

pub fn is_browser(command: &str) -> bool {
    COMMANDS.iter().any(|c| c.1 == command)
}

/// T-251 (CLI-047): `storage local|session get|set|clear` is `storage get|set|clear --area
/// local|session`; the area and the plain command behind such a wire name.
fn storage_word(command: &str) -> Option<(&str, String)> {
    let (area, op) = command.strip_prefix("browser.storage-")?.split_once('-')?;
    STORAGE_AREAS.contains(&area).then(|| (area, format!("browser.storage-{op}")))
}

/// T-251 (CLI-047): `--expires` in unix seconds; 0 keeps the cookie for the browsing session.
fn expires_at(v: Option<&str>) -> Option<i64> {
    v.and_then(|s| s.trim().parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0).map(|n| n as i64)
}

/// What a browser command needs, checked before the app is asked (the parse step's arm).
pub fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    if let Some((area, base)) = storage_word(command) {
        let mut f = flags.clone();
        f.insert("area".into(), json!(area));
        return check(&base, &f);
    }
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    // CLI-047: a cookie value, a storage value and a password may be empty; a name or key may not.
    if let Some(k) = flags.keys().find(|k| !["text", "input", "value", "expression", "command", "fn", "pass"].contains(&k.as_str()) && text(k).is_some_and(str::is_empty)) {
        return Err(args(format!("--{k} cannot be empty")));
    }
    let need = |k: &str| text(k).filter(|v| !v.is_empty()).ok_or_else(|| args(format!("--{k} is required")));
    let one_of = |k: &str, set: &[&str]| match text(k) {
        Some(v) if set.contains(&v) => Ok(()),
        Some(v) => Err(args(format!("--{k} {v} is not one of {}", set.join("|")))),
        None => Ok(()),
    };
    let number = |k: &str| match text(k) {
        Some(v) if v.parse::<f64>().is_ok() => Ok(()),
        Some(v) => Err(args(format!("--{k} takes a number, not {v}"))),
        None => Ok(()),
    };
    // T-242: a viewport side is a whole number of CSS pixels from 1 to 10000; a coordinate stays
    // within its range.
    let size = |k: &str| match text(k) {
        Some(v) if v.parse::<u32>().is_ok_and(|n| (1..=10_000).contains(&n)) => Ok(()),
        Some(v) => Err(args(format!("--{k} takes whole pixels from 1 to 10000, not {v}"))),
        None => Ok(()),
    };
    let within = |k: &str, max: f64| match text(k) {
        Some(v) if v.parse::<f64>().is_ok_and(|n| n.abs() <= max) => Ok(()),
        Some(v) => Err(args(format!("--{k} takes a number from -{max} to {max}, not {v}"))),
        None => Ok(()),
    };
    if let Some(p) = text("page") {
        if p.parse::<u32>().is_err() {
            return Err(args(format!("--page takes a tab number, not {p}")));
        }
    }
    match command {
        "browser.goto" => {
            need("url")?;
        }
        "browser.wait" => {
            if !WAIT_CONDITIONS.iter().any(|k| flags.contains_key(*k)) {
                return Err(args("wait needs a condition: --selector, --text, --url, --load, --fn or --state (with --selector)"));
            }
            if flags.contains_key("state") && !flags.contains_key("selector") {
                return Err(args("--state hidden|visible says what to wait for about --selector; give both"));
            }
            one_of("state", &["hidden", "visible"])?;
            one_of("load", LOAD_STATES)?;
            if let Some(t) = text("timeout") {
                match t.parse::<u64>() {
                    Ok(ms) if ms > 0 && ms <= WAIT_MAX_MS => {}
                    _ => return Err(args(format!("--timeout takes milliseconds from 1 to {WAIT_MAX_MS}"))),
                }
            }
        }
        "browser.eval" => {
            need("expression")?;
        }
        "browser.scroll" => {
            need("direction")?;
            one_of("direction", &["up", "down", "left", "right"])?;
            number("amount")?;
        }
        c if ELEMENT.contains(&c) => {
            need("element")?;
        }
        "browser.screenshot" | "browser.full-screenshot" => one_of("format", &["png", "jpeg"])?,
        "browser.fill" | "browser.select" => {
            need("element")?;
            if text("value").is_none() {
                return Err(args("--value is required"));
            }
        }
        "browser.type" => {
            if text("input").is_none() {
                return Err(args("--input is required"));
            }
        }
        "browser.inserttext" => {
            if text("text").is_none() {
                return Err(args("--text is required"));
            }
        }
        "browser.keypress" => {
            need("key")?;
        }
        "browser.drag" => {
            need("from")?;
            need("to")?;
        }
        "browser.upload" => {
            need("element")?;
            need("files")?;
        }
        "browser.download" => {
            need("selector")?;
            need("path")?;
        }
        "browser.highlight" => {
            need("selector")?;
        }
        "browser.find" => {
            need("locator")?;
            need("value")?;
            need("action")?;
            one_of("locator", LOCATORS)?;
            one_of("action", FIND_ACTIONS)?;
        }
        "browser.get" => {
            need("what")?;
            one_of("what", GET_WHAT)?;
            if !["url", "title"].contains(&text("what").unwrap_or_default()) {
                need("element")?;
            }
        }
        "browser.is" => {
            need("what")?;
            one_of("what", IS_WHAT)?;
            need("element")?;
        }
        "browser.mouse-move" => {
            need("x")?;
            need("y")?;
            number("x")?;
            number("y")?;
        }
        "browser.mouse-down" | "browser.mouse-up" => one_of("button", BUTTONS)?,
        "browser.mouse-wheel" => {
            need("dy")?;
            number("dy")?;
            number("dx")?;
        }
        "browser.exec" => {
            need("command")?;
        }
        "browser.tab-show" | "browser.tab-switch" | "browser.tab-close" => {
            if let Some(i) = text("index") {
                if i.parse::<u32>().is_err() {
                    return Err(args(format!("--index takes a tab number, not {i}")));
                }
            }
        }
        "browser.tab-profile-set" | "browser.profiles-delete" => {
            need("profile")?;
        }
        "browser.tab-lease" | "browser.tab-release" | "browser.tab-create" => {
            if command != "browser.tab-create" || flags.contains_key("lease") {
                need("lease")?;
            }
            if let Some(l) = text("lease") {
                super::lease::name(l, "lease").map_err(args)?;
            }
            if let Some(h) = text("holder") {
                super::lease::name(h, "holder").map_err(args)?;
            }
        }
        "browser.profiles-create" => {
            need("label")?;
            one_of("scope", profiles::SCOPES)?;
        }
        "browser.cookie-set" => {
            need("name")?;
            if !flags.contains_key("value") {
                return Err(args("--value is required"));
            }
            // CLI-047: an expiry is unix seconds, a finite number from 0 up.
            if let Some(e) = text("expires") {
                if !e.parse::<f64>().is_ok_and(|n| n.is_finite() && n >= 0.0) {
                    return Err(args(format!("--expires takes unix seconds, a finite number from 0 up, not {e}")));
                }
            }
            one_of("sameSite", &["Strict", "Lax", "None"])?;
        }
        "browser.cookie-delete" => {
            need("name")?;
        }
        "browser.storage-get" | "browser.storage-clear" => one_of("area", STORAGE_AREAS)?,
        "browser.storage-set" => {
            one_of("area", STORAGE_AREAS)?;
            need("key")?;
            if !flags.contains_key("value") {
                return Err(args("--value is required"));
            }
        }
        "browser.console" | "browser.network" => {
            if let Some(n) = text("limit") {
                if !n.parse::<usize>().is_ok_and(|n| n > 0) {
                    return Err(args(format!("--limit takes a count from 1 up, not {n}")));
                }
            }
        }
        "browser.viewport" => {
            need("width")?;
            need("height")?;
            size("width")?;
            size("height")?;
            scale(text("scale"))?;
        }
        "browser.geolocation" => {
            need("latitude")?;
            need("longitude")?;
            within("latitude", 90.0)?;
            within("longitude", 180.0)?;
            number("accuracy")?;
        }
        "browser.set-device" => {
            let name = need("name")?;
            if device(name).is_none() {
                return Err(args(format!("no device is called {name}; one of {}", DEVICES.iter().map(|d| d.0).collect::<Vec<_>>().join(", "))));
            }
        }
        "browser.set-offline" => one_of("state", &["on", "off"])?,
        "browser.set-headers" | "browser.set-credentials" => {
            if command == "browser.set-headers" {
                headers_of(need("headers")?)?;
            } else {
                need("user")?;
                if !flags.contains_key("pass") {
                    return Err(args("--pass is required"));
                }
            }
            // T-656: --origin names the one site the values are sent to.
            if let Some(o) = flags.get("origin").and_then(Value::as_str) {
                if origin_of(o).is_none() {
                    return Err(args(format!("--origin takes a web address such as https://example.com, not {o}")));
                }
            }
        }
        "browser.set-media" => {
            if !flags.contains_key("color-scheme") && !flags.contains_key("reduced-motion") {
                return Err(args("set media needs --color-scheme dark|light or --reduced-motion reduce|no-preference"));
            }
            one_of("color-scheme", COLOR_SCHEMES)?;
            one_of("reduced-motion", MOTIONS)?;
        }
        "browser.clipboard-write" => {
            let Some(t) = flags.get("text").and_then(Value::as_str) else {
                return Err(args("--text is required"));
            };
            // BROW-050: an oversized write is refused here, before anything runs.
            if t.len() > CLIPBOARD_MAX {
                return Err(args(format!("--text is {} bytes; the clipboard takes up to {} KB", t.len(), CLIPBOARD_MAX / 1024)));
            }
        }
        _ => {}
    }
    Ok(flags.clone())
}

/// `--scale`: the device scale from 0.25 to 5 (the engine's zoom range), when given.
fn scale(v: Option<&str>) -> Result<(), Fail> {
    match v {
        Some(s) if s.parse::<f64>().is_ok_and(|n| (0.25..=5.0).contains(&n)) => Ok(()),
        Some(s) => Err(args(format!("--scale takes a factor from 0.25 to 5, not {s}"))),
        None => Ok(()),
    }
}

/// BROW-050: the device a name stands for, letter case and spaces aside.
pub fn device(name: &str) -> Option<&'static (&'static str, f64, f64, f64, bool)> {
    let key = |s: &str| s.to_lowercase().replace([' ', '-', '_'], "");
    DEVICES.iter().find(|d| key(d.0) == key(name))
}

/// `--headers <json>`: an object of header names to string values.
pub fn headers_of(text: &str) -> Result<Map<String, Value>, Fail> {
    let v: Value = serde_json::from_str(text).map_err(|e| args(format!("--headers is not JSON: {e}")))?;
    let Value::Object(m) = v else {
        return Err(args("--headers takes a JSON object, such as {\"X-Debug\":\"1\"}"));
    };
    if let Some((k, _)) = m.iter().find(|(_, v)| !v.is_string()) {
        return Err(args(format!("--headers: the value of {k} must be a string")));
    }
    Ok(m)
}

/// `kolux set credentials`: the Authorization header the page's requests carry.
pub fn basic_auth(user: &str, pass: &str) -> String {
    use base64::Engine as _;
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}")))
}

/// `*` matches any run of characters; everything else is literal (the `--url` pattern of wait).
pub fn wildcard(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match p.split_first() {
            None => t.is_empty(),
            Some(('*', rest)) => (0..=t.len()).any(|i| go(rest, &t[i..])),
            Some((c, rest)) => t.first() == Some(c) && go(rest, &t[1..]),
        }
    }
    if !pattern.contains('*') {
        return text.contains(pattern);
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

/// Splits a helper command line into words: spaces separate, single or double quotes group, a
/// backslash keeps the next character.
pub fn split_command(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut open = false;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                open = true;
            }
            (None, '\\') => {
                if let Some(n) = chars.next() {
                    word.push(n);
                }
            }
            (None, c) if c.is_whitespace() => {
                if open || !word.is_empty() {
                    out.push(std::mem::take(&mut word));
                }
                open = false;
            }
            (None, c) => word.push(c),
        }
    }
    if open || !word.is_empty() {
        out.push(word);
    }
    out
}

/// Text in pieces of at most `n` characters, never splitting a character.
pub fn pieces(text: &str, n: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars.chunks(n.max(1)).map(|c| c.iter().collect()).collect()
}

/// The command word after `browser.` (the driver's `cmd`).
fn short(command: &str) -> &str {
    command.strip_prefix("browser.").unwrap_or(command)
}

/// Why a page answer is a failure, by its code: a reference the page no longer knows asks for a
/// new snapshot; a timeout counts towards restarting the helper.
pub fn fail_of(answer: &Value) -> Option<Fail> {
    let e = answer["error"].as_str()?;
    let code = if e.contains("run snapshot again") { "stale_reference" } else { "failed" };
    Some(Fail { code, message: e.to_string(), data: json!({ "hint": if code == "stale_reference" { "the page changed since the snapshot; run snapshot and use its new references" } else { "" } }) })
}

/// Runs one page command and hands back its answer object.
fn page(id: u32, cmd: &str, a: Value, wait: Duration) -> Result<Value, Fail> {
    let script = DRIVER.replace("__REQ__", &json!({ "cmd": cmd, "args": a }).to_string());
    let answer = eval_json(id, &script, wait).map_err(|e| Fail { code: if e.contains("did not answer") { "timeout" } else { "failed" }, message: e, data: Value::Null })?;
    match fail_of(&answer) {
        Some(f) => Err(f),
        None => Ok(answer),
    }
}

/// How long a wait runs, from `--timeout` (milliseconds) or the default.
pub fn wait_limit(a: &Value) -> Duration {
    Duration::from_millis(a["timeout"].as_str().and_then(|t| t.parse::<u64>().ok()).unwrap_or(WAIT_DEFAULT_MS).min(WAIT_MAX_MS))
}

/// BROW-046: a wait asks the page again every tenth of a second until the condition holds or the
/// time is up; an address pattern is checked here against the page's own location.
fn wait(id: u32, a: &Value) -> Result<Value, Fail> {
    let limit = wait_limit(a);
    let until = Instant::now() + limit;
    let pattern = a["url"].as_str();
    let mut asked = 0u32;
    loop {
        let left = until.saturating_duration_since(Instant::now());
        let answer = page(id, "check-wait", a.clone(), left.min(EVAL_WAIT).max(Duration::from_millis(50)))?;
        asked += 1;
        let holds = answer["value"].as_bool().unwrap_or(false) && pattern.is_none_or(|p| answer["url"].as_str().is_some_and(|u| wildcard(p, u)));
        if holds {
            return Ok(json!({ "page": id, "satisfied": true, "asked": asked, "url": answer["url"] }));
        }
        if Instant::now() >= until {
            return Err(timed_out(id, asked, &answer["url"], limit));
        }
        std::thread::sleep(WAIT_STEP);
    }
}

/// CLI-046: a wait that runs out says the condition did not hold. Kolux answered, so it is never
/// told as Kolux being down or unreachable.
fn timed_out(id: u32, asked: u32, url: &Value, limit: Duration) -> Fail {
    Fail { code: "timeout", message: format!("the condition did not hold within {} ms", limit.as_millis()), data: json!({ "page": id, "asked": asked, "url": url }) }
}

/// CLI-047: the HTTP-only cookie `cookie set --httpOnly` asks for, on the open page's host unless
/// `--domain` names it or a parent of it (never another site).
fn engine_cookie(id: u32, a: &Value, page_url: &str) -> Result<super::cookies::Entry, Fail> {
    use tauri::webview::cookie::SameSite;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let on = |k: &str| a.get(k).is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)));
    let host = tauri::Url::parse(page_url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)).ok_or_else(|| args(format!("browser tab {id} shows no site ({page_url}), so there is no site to set the cookie on")))?;
    let domain = text("domain").map(|d| d.to_ascii_lowercase()).unwrap_or_else(|| host.clone());
    let bare = domain.trim_start_matches('.');
    if bare.is_empty() || !(host == bare || host.ends_with(&format!(".{bare}"))) {
        return Err(args(format!("--domain {domain} is not the site of browser tab {id} ({host}); cookies are set on the open page's site")));
    }
    let same_site = match text("sameSite").as_deref() {
        Some("Strict") => Some(SameSite::Strict),
        Some("Lax") => Some(SameSite::Lax),
        Some("None") => Some(SameSite::None),
        _ => None,
    };
    Ok(super::cookies::Entry { name: text("name").unwrap_or_default(), value: a["value"].as_str().unwrap_or_default().to_string(), domain, path: text("path").unwrap_or_else(|| "/".into()), secure: on("secure"), http_only: true, same_site, expires: expires_at(a["expires"].as_str()) })
}

/// `kolux exec --command "<helper command>"`: the helper is Kolux itself, so the command is one
/// of the browser commands above, in the same words (`click --element e12`); never another exec.
pub fn exec_words(line: &str) -> Result<crate::cli::Parsed, Fail> {
    let words = split_command(line);
    let (_, parsed) = crate::cli::parse(&words);
    let Some(p) = parsed? else {
        return Err(args("exec needs a browser command, such as \"click --element e12\""));
    };
    if !is_browser(&p.command) {
        return Err(args(format!("exec runs browser commands only; {} is not one", words.first().map(String::as_str).unwrap_or_default())));
    }
    if p.command == "browser.exec" {
        return Err(args("exec does not run another exec"));
    }
    Ok(p)
}

fn exec(req: &Request, worktree: Option<&str>, line: &str) -> Result<Value, Fail> {
    let p = exec_words(line)?;
    let inner = Request { command: p.command, args: Value::Object(p.args), ..req.clone() };
    run(&inner, worktree)
}

/// What stands between a request and the page: the tab it goes to (BROW-042). Pure, so it is
/// tested without the app. Every command reaches the page since the capture, print and download
/// commands went to the engine (T-251).
pub fn gate(_command: &str, page_no: Option<u32>, worktree: Option<&str>, tabs: &[super::Tab]) -> Result<u32, Fail> {
    pick_tab(tabs, page_no, worktree).map_err(|m| Fail { code: "not_found", message: m, data: json!({ "hint": "open a browser tab in the worktree (Ctrl+T, Browser) or name one with --page <n>" }) })
}

/// after-list 91: `--page <n>` names a page the app has opened whose pane has not reported it yet
/// (a tab opened a moment ago). When the page exists, it counts as open: it joins the list as an
/// unplaced tab (no worktree, not on screen), so only an explicit `--page` can pick it.
pub fn reported_or_open(mut tabs: Vec<super::Tab>, page_no: Option<u32>, exists: impl Fn(u32) -> bool) -> Vec<super::Tab> {
    if let Some(n) = page_no {
        if !tabs.iter().any(|t| t.id == n) && exists(n) {
            tabs.push(super::Tab { id: n, worktree: None, shown: false, seen: 0, url: String::new(), title: String::new() });
        }
    }
    tabs
}

/// Upload: the files are read here and carried into the page as bytes (a page cannot open a path).
fn files_of(list: &str) -> Result<Vec<Value>, Fail> {
    let mut out = Vec::new();
    let mut total = 0u64;
    for p in list.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let path = std::path::Path::new(p);
        let bytes = std::fs::read(path).map_err(|e| Fail::new("failed", format!("{p}: {e}")))?;
        total += bytes.len() as u64;
        if total > UPLOAD_MAX {
            return Err(Fail::new("failed", format!("the files exceed {} MB together", UPLOAD_MAX / (1024 * 1024))));
        }
        use base64::Engine as _;
        out.push(json!({ "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string()), "type": "", "data": base64::engine::general_purpose::STANDARD.encode(bytes) }));
    }
    if out.is_empty() {
        return Err(args("--files names no file"));
    }
    Ok(out)
}

/// T-242: what the command line emulates for one tab. `state` is the JSON the page's `__kxEmu`
/// takes (intercept, offline, headers, auth, geo, media, mobile); the viewport is the app's (the
/// page is laid out at that size); a capture holds what `kolux network` / `kolux console` saw
/// between `capture start` and `capture stop`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Emu {
    pub state: Map<String, Value>,
    pub viewport: Option<(f64, f64)>,
    pub capture: Option<Capture>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Capture {
    pub on: bool,
    pub console: Vec<Value>,
    pub network: Vec<Value>,
}

static EMU: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<u32, Emu>>> = std::sync::LazyLock::new(Default::default);

fn with_emu<T>(id: u32, f: impl FnOnce(&mut Emu) -> T) -> T {
    let mut all = EMU.lock().unwrap_or_else(|e| e.into_inner());
    f(all.entry(id).or_default())
}

/// The tab's emulation state as the script of a page at `page` takes it; `None` when nothing is
/// emulated. T-656: the extra headers and credentials are blanked unless the page is on the site they
/// were set for, so a page on another site never holds them, nor learns which site that is (they stay
/// stored for the way back).
pub fn emu_state(id: u32, page: &str) -> Option<String> {
    let all = EMU.lock().ok()?;
    let mut s = all.get(&id).filter(|e| !e.state.is_empty())?.state.clone();
    let here = origin_of(page);
    for (value, at, blank) in [("headers", "headersOrigin", json!({})), ("auth", "authOrigin", Value::Null)] {
        if s.contains_key(value) && (here.is_none() || s.get(at).and_then(Value::as_str) != here.as_deref()) {
            s.insert(value.into(), blank);
            s.remove(at);
        }
    }
    Some(Value::Object(s).to_string())
}

/// T-656: an address's site as its page sees it (`location.origin`); `None` when it has none
/// (about:blank, data:, an unparsable address).
pub fn origin_of(url: &str) -> Option<String> {
    let o = tauri::Url::parse(url).ok()?.origin();
    o.is_tuple().then(|| o.ascii_serialization())
}

/// T-656: the site that extra headers or credentials are for: `--origin`, else the open page's.
fn site_for(id: u32, given: Option<String>) -> Result<String, Fail> {
    let from = given.unwrap_or_else(|| tabs().into_iter().find(|t| t.id == id).map(|t| t.url).unwrap_or_default());
    origin_of(&from).ok_or_else(|| args(format!("page {id} is not on a web site ({from:?}); open the site first or pass --origin https://host")))
}

/// BROW-050: whether the tab emulates being offline (its navigations are refused).
pub fn offline(id: u32) -> bool {
    EMU.lock().is_ok_and(|all| all.get(&id).is_some_and(|e| e.state.get("offline").and_then(Value::as_bool).unwrap_or(false)))
}

/// The page's size inside its pane: the pane's, cut to the emulated viewport when there is one.
pub fn fit(id: u32, w: f64, h: f64) -> (f64, f64) {
    match EMU.lock().ok().and_then(|all| all.get(&id).and_then(|e| e.viewport)) {
        Some((vw, vh)) => (w.min(vw), h.min(vh)),
        None => (w, h),
    }
}

/// BROW-049: a closed tab's set-up is cleared.
pub fn forget(id: u32) {
    if let Ok(mut all) = EMU.lock() {
        all.remove(&id);
    }
}

/// Capture: entries the page handed back that the capture does not hold yet are appended, oldest
/// first, up to the cap (a page's performance entries repeat on every pull; a repeat adds nothing).
pub fn merge_entries(into: &mut Vec<Value>, fresh: &[Value]) -> usize {
    let mut added = 0;
    for e in fresh {
        if !into.contains(e) {
            into.push(e.clone());
            added += 1;
        }
    }
    if into.len() > CAPTURE_MAX {
        into.drain(..into.len() - CAPTURE_MAX);
    }
    added
}

/// The last `limit` entries of a log.
pub fn tail(list: &[Value], limit: usize) -> Vec<Value> {
    list[list.len().saturating_sub(limit)..].to_vec()
}

/// Lays the page out at `w`x`h` (cut to the pane, BROW-050) with the phone identity when `mobile`.
/// The size and identity go into [`EMU`] first, so a load that starts meanwhile gets them from the
/// load hook; a size that took but an identity that did not is reported as such (BROW-034).
fn emulate(id: u32, w: f64, h: f64, scale: Option<f64>, mobile: bool) -> Result<Value, Fail> {
    with_emu(id, |e| {
        e.viewport = Some((w, h));
        e.state.insert("mobile".into(), json!(mobile));
    });
    super::relayout(id, scale).map_err(|m| Fail::new("failed", m))?;
    apply_emu(id).map_err(|f| Fail::new("partial", format!("the page is laid out at {w}x{h} but its identity did not change: {}", f.message)))?;
    Ok(json!({ "page": id, "width": w, "height": h, "scale": scale, "mobile": mobile, "summary": format!("page {id} shows {w}x{h}{}{}", scale.map(|s| format!(" at {s}x")).unwrap_or_default(), if mobile { " (mobile)" } else { "" }) }))
}

/// T-240 (BROW-034): the toolbar's Viewport Size: a preset by name, or `None` / "Default" for the
/// pane's own size and the plain identity again.
pub fn preset(id: u32, name: Option<&str>) -> Result<Value, Fail> {
    match name.map(str::trim).filter(|n| !n.is_empty() && !n.eq_ignore_ascii_case("default")) {
        None => {
            with_emu(id, |e| {
                e.viewport = None;
                e.state.insert("mobile".into(), json!(false));
            });
            super::relayout(id, Some(1.0)).map_err(|m| Fail::new("failed", m))?;
            apply_emu(id)?;
            Ok(json!({ "page": id, "summary": format!("page {id} fills its pane") }))
        }
        Some(n) => {
            let d = device(n).ok_or_else(|| args(format!("no preset is called {n}; one of {}", DEVICES[..PRESETS].iter().map(|d| d.0).collect::<Vec<_>>().join(", "))))?;
            emulate(id, d.1, d.2, Some(d.3), d.4)
        }
    }
}

/// Sends the tab's emulation state to its page (the same script the load hook runs).
fn apply_emu(id: u32) -> Result<(), Fail> {
    let page = tabs().into_iter().find(|t| t.id == id).map(|t| t.url).unwrap_or_default();
    let state = emu_state(id, &page).unwrap_or_else(|| "{}".into());
    eval_json(id, &format!("({}, {{ok:true}})", super::emu_script(&state)), EVAL_WAIT).map(|_| ()).map_err(|m| Fail::new("failed", m))
}

/// The page's log entries (`__kxLog`): the recorder is in every page's first script.
fn page_log(id: u32, what: &str, limit: usize) -> Result<Vec<Value>, Fail> {
    let answer = page(id, "log", json!({ "what": what, "limit": limit }), EVAL_WAIT)?;
    Ok(answer["entries"].as_array().cloned().unwrap_or_default())
}

/// `kolux console` / `kolux network`: while a capture runs, the page's log is pulled into it and the
/// capture is listed; after a stop the capture stands; with no capture the page's own log is listed.
fn log_cmd(id: u32, what: &str, limit: usize) -> Result<Value, Fail> {
    let on = with_emu(id, |e| e.capture.as_ref().map(|c| c.on));
    let fresh = if on != Some(false) { page_log(id, what, CAPTURE_MAX)? } else { Vec::new() };
    let list = with_emu(id, |e| match e.capture.as_mut() {
        Some(c) => {
            let into = if what == "console" { &mut c.console } else { &mut c.network };
            if c.on {
                merge_entries(into, &fresh);
            }
            tail(into, limit)
        }
        None => tail(&fresh, limit),
    });
    Ok(json!({ "page": id, "entries": list, "capturing": on == Some(true), "summary": format!("{} {what} entr{}", list.len(), if list.len() == 1 { "y" } else { "ies" }) }))
}

/// BROW-050 `kolux clipboard`: the system clipboard, read and written from the app side.
fn clipboard(cmd: &str, text: Option<&str>) -> Result<Value, Fail> {
    #[cfg(windows)]
    {
        if cmd == "clipboard-read" {
            let t = crate::clipboard::os::get_text().unwrap_or_default();
            return Ok(json!({ "text": t, "summary": format!("{} character(s) on the clipboard", t.chars().count()) }));
        }
        let t = text.unwrap_or_default();
        crate::clipboard::os::put_text(std::ptr::null_mut(), t).map_err(|m| Fail::new("failed", m))?;
        Ok(json!({ "characters": t.chars().count(), "summary": format!("{} character(s) placed on the clipboard", t.chars().count()) }))
    }
    #[cfg(not(windows))]
    {
        let _ = (cmd, text);
        Err(Fail::new("unsupported", "the clipboard is reached through the Windows clipboard in this build"))
    }
}

/// The app side of every browser command (the dispatch arm). `worktree` is the folder the command
/// is for: `--worktree` resolved, or the caller's own worktree, or none.
pub fn run(req: &Request, worktree: Option<&str>) -> Result<Value, Fail> {
    if let Some((area, base)) = storage_word(&req.command) {
        let mut r = req.clone();
        r.args["area"] = json!(area);
        r.command = base;
        return run(&r, worktree);
    }
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let on = |k: &str| a.get(k).is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)));
    let page_no = text("page").and_then(|p| p.parse::<u32>().ok());
    if let Some(v) = tabs_cmd(req, worktree, page_no)? {
        return Ok(v);
    }
    if req.command.starts_with("browser.clipboard-") {
        // The clipboard is the machine's, not a page's: no tab is needed.
        return clipboard(short(&req.command), a["text"].as_str());
    }
    let id = gate(&req.command, page_no, worktree, &reported_or_open(tabs(), page_no, super::page_exists))?;
    let cmd = short(&req.command);
    let limit = text("limit").and_then(|n| n.parse::<usize>().ok()).unwrap_or(LOG_DEFAULT);
    let set = |f: &dyn Fn(&mut Map<String, Value>)| with_emu(id, |e| f(&mut e.state));
    match req.command.as_str() {
        "browser.goto" => {
            let url = text("url").ok_or_else(|| args("--url is required"))?;
            if offline(id) {
                // BROW-050: an offline tab fails to load, as the real thing would.
                return Err(Fail { code: "offline", message: format!("page {id} emulates being offline, so {url} cannot load; kolux set offline --state off lets it"), data: json!({ "page": id, "url": url }) });
            }
            let to = super::navigate_to(id, &url)?;
            Ok(json!({ "page": id, "url": to, "summary": format!("page {id} is going to {to}") }))
        }
        "browser.intercept-enable" => {
            let patterns: Vec<String> = text("patterns").unwrap_or_else(|| "*".into()).split(',').map(str::trim).filter(|p| !p.is_empty()).map(str::to_string).collect();
            set(&|s| {
                s.insert("intercept".into(), json!(patterns));
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "patterns": patterns, "summary": format!("page {id} holds requests matching {}", patterns.join(", ")) }))
        }
        "browser.intercept-disable" => {
            set(&|s| {
                s.insert("intercept".into(), Value::Null);
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "summary": format!("page {id} holds no requests; held ones were released") }))
        }
        "browser.intercept-list" => {
            let patterns = with_emu(id, |e| e.state.get("intercept").cloned().unwrap_or(Value::Null));
            let held = page_log(id, "held", CAPTURE_MAX)?;
            Ok(json!({ "page": id, "patterns": patterns, "held": held, "summary": format!("{} request(s) held", held.len()) }))
        }
        "browser.capture-start" => {
            with_emu(id, |e| e.capture = Some(Capture { on: true, ..Default::default() }));
            Ok(json!({ "page": id, "summary": format!("page {id}: capturing console and network") }))
        }
        "browser.capture-stop" => {
            let (console, network) = (page_log(id, "console", CAPTURE_MAX)?, page_log(id, "network", CAPTURE_MAX)?);
            let counts = with_emu(id, |e| {
                let c = e.capture.get_or_insert_with(Default::default);
                if c.on {
                    merge_entries(&mut c.console, &console);
                    merge_entries(&mut c.network, &network);
                }
                c.on = false;
                (c.console.len(), c.network.len())
            });
            Ok(json!({ "page": id, "console": counts.0, "network": counts.1, "summary": format!("page {id}: capture stopped with {} console and {} network entries", counts.0, counts.1) }))
        }
        "browser.console" | "browser.network" => log_cmd(id, cmd, limit),
        "browser.viewport" | "browser.set-device" => {
            let (w, h, scale, mobile) = if cmd == "viewport" {
                let n = |k: &str| text(k).and_then(|v| v.parse::<f64>().ok());
                (n("width").unwrap_or(1024.0), n("height").unwrap_or(768.0), n("scale"), on("mobile"))
            } else {
                let d = device(&text("name").unwrap_or_default()).ok_or_else(|| args("--name is required"))?;
                (d.1, d.2, Some(d.3), d.4)
            };
            emulate(id, w, h, scale, mobile)
        }
        "browser.geolocation" => {
            let n = |k: &str| text(k).and_then(|v| v.parse::<f64>().ok());
            let geo = json!({ "latitude": n("latitude"), "longitude": n("longitude"), "accuracy": n("accuracy").unwrap_or(1.0) });
            set(&|s| {
                s.insert("geo".into(), geo.clone());
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "geolocation": geo, "summary": format!("page {id} is at {}, {}", geo["latitude"], geo["longitude"]) }))
        }
        "browser.set-offline" => {
            let off = text("state").is_none_or(|s| s == "on");
            set(&|s| {
                s.insert("offline".into(), json!(off));
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "offline": off, "summary": format!("page {id} is {}", if off { "offline" } else { "online" }) }))
        }
        "browser.set-headers" => {
            let h = headers_of(&text("headers").unwrap_or_default())?;
            // Clearing (`--headers {}`) needs no site, so it works on any tab.
            let at = if h.is_empty() { None } else { Some(site_for(id, text("origin"))?) };
            set(&|s| {
                s.insert("headers".into(), Value::Object(h.clone()));
                match &at {
                    Some(at) => s.insert("headersOrigin".into(), json!(at)),
                    None => s.remove("headersOrigin"),
                };
            });
            apply_emu(id)?;
            let summary = match &at {
                Some(at) => format!("page {id} sends {} extra header(s) with its requests to {at}", h.len()),
                None => format!("page {id} sends no extra headers"),
            };
            Ok(json!({ "page": id, "headers": h, "origin": at, "summary": summary }))
        }
        "browser.set-credentials" => {
            let auth = basic_auth(&text("user").unwrap_or_default(), &text("pass").unwrap_or_default());
            let at = site_for(id, text("origin"))?;
            set(&|s| {
                s.insert("auth".into(), json!(auth));
                s.insert("authOrigin".into(), json!(at));
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "origin": at, "summary": format!("page {id} sends HTTP basic credentials with its requests to {at}") }))
        }
        "browser.set-media" => {
            let media = json!({ "colorScheme": text("color-scheme"), "reducedMotion": text("reduced-motion") });
            set(&|s| {
                s.insert("media".into(), media.clone());
            });
            apply_emu(id)?;
            Ok(json!({ "page": id, "media": media, "summary": format!("page {id} prefers {}{}", text("color-scheme").map(|c| format!("a {c} colour scheme")).unwrap_or_default(), text("reduced-motion").map(|m| format!(" {m} motion")).unwrap_or_default()) }))
        }
        "browser.dialog-accept" | "browser.dialog-dismiss" => {
            let accept = cmd == "dialog-accept";
            let mut answer = page(id, "dialog", json!({ "accept": accept, "text": a["text"] }), EVAL_WAIT)?;
            answer["page"] = json!(id);
            Ok(answer)
        }
        "browser.back" | "browser.forward" | "browser.reload" => {
            super::go(id, cmd)?;
            Ok(json!({ "page": id, "summary": format!("page {id}: {cmd}") }))
        }
        "browser.wait" => wait(id, a),
        "browser.exec" => exec(req, worktree, &text("command").unwrap_or_default()),
        "browser.type" | "browser.inserttext" => {
            let key = if cmd == "type" { "input" } else { "text" };
            let whole = a[key].as_str().unwrap_or_default().to_string();
            let mut sent = 0usize;
            for piece in pieces(&whole, TYPE_PIECE) {
                page(id, cmd, json!({ key: piece }), EVAL_WAIT)?;
                sent += piece.chars().count();
            }
            Ok(json!({ "page": id, "characters": sent, "summary": format!("{cmd}: {sent} character(s) went to the focused field") }))
        }
        "browser.cookie-get" | "browser.cookie-set" | "browser.cookie-delete" => {
            // BROW-048: cookies are read and set by the open page (document.cookie), so --url may
            // only name that page's site.
            if let Some(u) = text("url") {
                let page_url = tabs().into_iter().find(|t| t.id == id).map(|t| t.url).unwrap_or_default();
                if !same_origin(&u, &page_url) {
                    return Err(args(format!("--url {u} is not the site of browser tab {id} ({page_url}); cookies are read and set on the open page")));
                }
            }
            if cmd == "cookie-set" && on("httpOnly") {
                // CLI-047: document.cookie cannot set an HTTP-only cookie; the engine's store can.
                let page_url = tabs().into_iter().find(|t| t.id == id).map(|t| t.url).unwrap_or_default();
                let e = engine_cookie(id, a, &page_url)?;
                super::set_cookie(id, e.clone()).map_err(|m| Fail::new("failed", m))?;
                return Ok(json!({ "page": id, "ok": true, "summary": format!("HTTP-only cookie {} set for {}", e.name, e.domain) }));
            }
            let mut answer = page(id, cmd, a.clone(), EVAL_WAIT)?;
            answer["page"] = json!(id);
            if cmd == "cookie-delete" {
                answer["destructive"] = json!(true);
            }
            Ok(answer)
        }
        "browser.storage-clear" => {
            let mut answer = page(id, cmd, a.clone(), EVAL_WAIT)?;
            answer["page"] = json!(id);
            answer["destructive"] = json!(true);
            Ok(answer)
        }
        "browser.screenshot" | "browser.full-screenshot" | "browser.pdf" => capture(id, cmd, a, worktree, &req.cwd),
        "browser.download" => download(id, a, worktree, &req.cwd),
        "browser.upload" => {
            let files = files_of(&text("files").unwrap_or_default())?;
            let mut answer = page(id, cmd, json!({ "element": a["element"], "files": files }), EVAL_WAIT)?;
            answer["page"] = json!(id);
            Ok(answer)
        }
        _ => {
            let mut answer = page(id, cmd, a.clone(), EVAL_WAIT)?;
            answer["page"] = json!(id);
            Ok(answer)
        }
    }
}

/// T-251 (CLI-047): where a capture or a download is written. `--path` must sit inside the
/// worktree (the caller's folder when it is in none), by the same rule as `kolux file`; without it
/// a capture goes to `fallback` (the app's captures folder). A file is never overwritten: a taken
/// name gets a number, as downloads do, and the name is made safe the same way.
pub fn out_path(worktree: Option<&str>, cwd: &str, given: Option<&str>, fallback: &Path, name: &str) -> Result<PathBuf, Fail> {
    let (dir, file) = match given {
        Some(g) => {
            let root = worktree.unwrap_or(cwd);
            let full = Path::new(root).join(crate::cli::file_cli::inside(root, cwd, g)?);
            let file = full.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            (full.parent().map(Path::to_path_buf).unwrap_or_default(), file)
        }
        None => (fallback.to_path_buf(), name.to_string()),
    };
    std::fs::create_dir_all(&dir).map_err(|e| Fail::new("failed", format!("{}: {e}", dir.display())))?;
    super::downloads::place(&dir, &file, &[]).map_err(|m| Fail::new("failed", m))
}

/// The largest side, in pixels, a whole-page picture is taken at (the engine's own limit).
const PICTURE_MAX: f64 = 16384.0;

/// The DevTools parameters for a picture: the visible page, or, given the page's layout metrics,
/// the whole page.
pub fn shot_params(format: &str, whole: Option<&Value>) -> String {
    let mut p = json!({ "format": format, "fromSurface": true });
    if let Some(m) = whole {
        let size = if m["cssContentSize"].is_object() { &m["cssContentSize"] } else { &m["contentSize"] };
        let side = |k: &str| size[k].as_f64().unwrap_or(0.0).clamp(1.0, PICTURE_MAX);
        p["captureBeyondViewport"] = json!(true);
        p["clip"] = json!({ "x": 0, "y": 0, "width": side("width"), "height": side("height"), "scale": 1 });
    }
    p.to_string()
}

/// The picture's bytes from the engine's base64 answer, so sizes are reported decoded.
pub fn picture(answer: &Value) -> Result<Vec<u8>, Fail> {
    use base64::Engine as _;
    let data = answer["data"].as_str().filter(|d| !d.is_empty()).ok_or_else(|| Fail::new("failed", "the page's engine sent no picture"))?;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| Fail::new("failed", "the page's engine sent a picture that is not base64"))
}

/// `kolux screenshot|full-screenshot|pdf`: the engine's picture or PDF of the page, written to a
/// file; the answer names the file and its size in bytes.
fn capture(id: u32, cmd: &str, a: &Value, worktree: Option<&str>, cwd: &str) -> Result<Value, Fail> {
    let failed = |m: String| Fail::new("failed", m);
    let format = a["format"].as_str().map(str::trim).filter(|f| !f.is_empty()).unwrap_or("png");
    let ext = match cmd {
        "pdf" => "pdf",
        _ if format == "jpeg" => "jpg",
        _ => "png",
    };
    let given = a["path"].as_str().map(str::trim).filter(|p| !p.is_empty());
    let fallback = if given.is_none() { super::captures_dir().map_err(failed)? } else { PathBuf::new() };
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let path = out_path(worktree, cwd, given, &fallback, &format!("page-{id}-{cmd}-{stamp}.{ext}"))?;
    let shown = path.display().to_string();
    let bytes = if cmd == "pdf" {
        if !super::print_pdf(id, &shown).map_err(failed)? {
            return Err(failed(format!("the engine could not print page {id}")));
        }
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        let whole = if cmd == "full-screenshot" { Some(super::devtools(id, "Page.getLayoutMetrics", "{}".into()).map_err(failed)?) } else { None };
        let data = picture(&super::devtools(id, "Page.captureScreenshot", shot_params(format, whole.as_ref())).map_err(failed)?)?;
        std::fs::write(&path, &data).map_err(|e| failed(format!("{shown}: {e}")))?;
        data.len() as u64
    };
    let what = match cmd {
        "pdf" => "PDF",
        "full-screenshot" => "whole-page picture",
        _ => "picture",
    };
    Ok(json!({ "page": id, "path": shown, "bytes": bytes, "format": ext, "summary": format!("{what} of page {id} written to {shown} ({bytes} bytes)") }))
}

/// How long `kolux download` watches a started download before it answers "still downloading".
const DOWNLOAD_WAIT: Duration = Duration::from_secs(120);

/// `kolux download`: the tab's next download is armed to the confined path, the element is
/// clicked, and the download is watched until it ends (or DOWNLOAD_WAIT passes).
fn download(id: u32, a: &Value, worktree: Option<&str>, cwd: &str) -> Result<Value, Fail> {
    use super::downloads::{self, State};
    let given = a["path"].as_str().map(str::trim).filter(|p| !p.is_empty()).ok_or_else(|| args("--path is required"))?;
    let path = out_path(worktree, cwd, Some(given), Path::new(""), "")?;
    downloads::arm(id, path.clone());
    if let Err(f) = page(id, "find", json!({ "locator": "selector", "value": a["selector"], "action": "click" }), EVAL_WAIT) {
        downloads::disarm(id);
        return Err(f);
    }
    let shown = path.display().to_string();
    let started = Instant::now();
    loop {
        match downloads::state_of(&path) {
            Some((State::Done, bytes)) => return Ok(json!({ "page": id, "path": shown, "bytes": bytes, "summary": format!("downloaded {bytes} bytes to {shown}") })),
            Some((State::Running, bytes)) if started.elapsed() >= DOWNLOAD_WAIT => {
                return Ok(json!({ "page": id, "path": shown, "bytes": bytes, "running": true, "summary": format!("still downloading to {shown} ({bytes} bytes so far); the browser pane shows when it ends") }))
            }
            Some((State::Running, _)) => {}
            Some((state, _)) => return Err(Fail::new("failed", format!("the download to {shown} {}", if state == State::Cancelled { "was cancelled" } else { "failed" }))),
            None if started.elapsed() >= downloads::ARM_FOR => {
                downloads::disarm(id);
                return Err(Fail::new("failed", format!("clicking {} started no download within {} s", a["selector"], downloads::ARM_FOR.as_secs())));
            }
            None => {}
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// BROW-044 `kolux tab list`: the registry's rows for a worktree (`--worktree all`, or a caller
/// outside every worktree: every tab). Tabs no pane has described yet count for any worktree.
pub fn tab_rows(tabs: &[Tab], worktree: Option<&str>, all: bool) -> Vec<Tab> {
    let mut rows: Vec<Tab> = match worktree {
        Some(wt) if !all => {
            let mine: Vec<Tab> = tabs.iter().filter(|t| t.worktree.as_deref().is_some_and(|w| same_dir(w, wt))).cloned().collect();
            if mine.is_empty() && tabs.iter().all(|t| t.worktree.is_none()) { tabs.to_vec() } else { mine }
        }
        _ => tabs.to_vec(),
    };
    rows.sort_by_key(|t| t.id);
    rows
}

fn row(t: &Tab, store: Option<&profiles::Store>) -> Value {
    let mut v = json!({ "page": t.id, "url": t.url, "title": t.title, "worktree": t.worktree, "shown": t.shown });
    // T-312-b (ORCH-061): a page an agent placed under a lease says which.
    if let Some(l) = super::lease::with(|l| l.place_of(t.id).map(str::to_string)) {
        v["lease"] = json!(l);
    }
    if let Some(s) = store {
        v["profile"] = json!(profiles::tab_profile(s, t.id));
    }
    v
}

/// Two addresses of one site: scheme, host and port alike (the cookie commands' `--url`).
pub fn same_origin(a: &str, b: &str) -> bool {
    match (tauri::Url::parse(a), tauri::Url::parse(b)) {
        (Ok(a), Ok(b)) => a.origin() == b.origin(),
        _ => false,
    }
}

fn store() -> Result<(std::path::PathBuf, profiles::Store), Fail> {
    let root = profiles::root().map_err(|m| Fail::new("failed", m))?;
    let s = profiles::load(&root);
    Ok((root, s))
}

/// T-312-b (ORCH-061): who asks for a lease: `--holder`, else the Kolux terminal the call came
/// from (the app checked its key), else the plain command line.
pub fn holder_of(req: &Request) -> String {
    let given = req.args["holder"].as_str().map(str::trim).filter(|s| !s.is_empty());
    given.map(str::to_string).or_else(|| req.pane.as_ref().map(|p| p.handle.clone()).filter(|h| !h.is_empty())).unwrap_or_else(|| "cli".into())
}

/// after-list 732: a lease whose holder terminal has closed is freed before any lease is taken
/// or listed, so a closed terminal never keeps a placement from the next holder.
fn free_gone_leases() {
    super::lease::with(|t| t.free_gone(super::terminal_live));
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Waits up to `limit` for the registry to show `done` (the pane acts on the event and reports).
fn settle(limit: Duration, mut done: impl FnMut(&[Tab]) -> bool) -> bool {
    let start = Instant::now();
    loop {
        if done(&tabs()) {
            return true;
        }
        if start.elapsed() >= limit {
            return false;
        }
        std::thread::sleep(WAIT_STEP);
    }
}

/// The front end owns the tabs: it is told what to open, show or close and the registry says when it did.
const TAB_EVENT: &str = "browser-cli";
const PROFILE_EVENT: &str = "browser-profile";
const SETTLE: Duration = Duration::from_secs(5);

/// BROW-044 / BROW-045: the tab and profile commands. They need no page, so they run before the
/// gate; `Ok(None)` for every other command.
fn tabs_cmd(req: &Request, worktree: Option<&str>, page_no: Option<u32>) -> Result<Option<Value>, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let on = |k: &str| a.get(k).is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)));
    let all = text("worktree").is_some_and(|w| w == "all");
    let index = || text("index").and_then(|i| i.parse::<u32>().ok());
    let current = |id: Option<u32>| gate("browser.tab-show", id.or(page_no), worktree, &tabs());
    let fail = |m: String| Fail::new("failed", m);
    let v = match req.command.as_str() {
        "browser.tab-list" => {
            let prof = if on("show-profile") { Some(store()?.1) } else { None };
            let rows: Vec<Value> = tab_rows(&tabs(), worktree, all).iter().map(|t| row(t, prof.as_ref())).collect();
            json!({ "tabs": rows, "summary": format!("{} browser tab(s)", rows.len()) })
        }
        "browser.tab-current" | "browser.tab-show" => {
            let id = current(index())?;
            let t = tabs().into_iter().find(|t| t.id == id).ok_or_else(|| fail(format!("browser tab {id} is not open")))?;
            let mut v = row(&t, store().ok().map(|s| s.1).as_ref());
            v["summary"] = json!(format!("page {id}: {} {}", t.title, t.url));
            v
        }
        "browser.tab-switch" => {
            let id = current(index())?;
            tell(TAB_EVENT, json!({ "action": "switch", "page": id, "focus": on("focus") })).map_err(fail)?;
            if !settle(Duration::from_secs(2), |t| t.iter().any(|t| t.id == id && t.shown)) {
                return Err(fail(format!("browser tab {id} did not come on screen")));
            }
            json!({ "page": id, "summary": format!("page {id} is on screen") })
        }
        "browser.tab-create" => {
            let mut url = text("url").unwrap_or_else(|| "about:blank".into());
            let mut answer = json!({});
            if preview::is_document(&url) {
                // BROW-039: an HTML document on disk opens as a preview.
                let p = preview::add(&url).map_err(fail)?;
                url = p["url"].as_str().unwrap_or_default().to_string();
                answer = p;
            } else {
                super::allowed(&super::parse(&url).map_err(args)?, None).map_err(args)?;
            }
            // The address as the opening tab will see it, so the profile reaches this tab only.
            let key = super::parse(&url).map(|u| u.to_string()).unwrap_or_else(|_| url.clone());
            let handed = text("profile");
            if let Some(p) = handed.clone() {
                let (_, s) = store()?;
                profiles::get(&s, &p).ok_or_else(|| Fail::new("not_found", format!("no profile is called {p}")))?;
                super::hand_profile(&key, p);
            }
            // T-312-b (ORCH-061): a page placed under a lease needs the lease first.
            let lease = text("lease");
            let who = holder_of(req);
            free_gone_leases();
            let took = match &lease {
                Some(l) => super::lease::with(|t| t.acquire(l, &who, now_ms())).map_err(|m| Fail::new("blocked", m))?,
                None => false,
            };
            let before: Vec<u32> = tabs().iter().map(|t| t.id).collect();
            let told = tell(TAB_EVENT, json!({ "action": "create", "url": url, "worktree": worktree })).map_err(fail);
            let mut id = None;
            if told.is_ok() {
                settle(SETTLE, |t| {
                    id = t.iter().map(|t| t.id).find(|i| !before.contains(i));
                    id.is_some()
                });
            }
            let Some(id) = id else {
                if handed.is_some() {
                    super::take_profile(&key);
                }
                if let (Some(l), true) = (&lease, took) {
                    // A lease taken only for this page is not kept when the page never opened.
                    let _ = super::lease::with(|t| t.release(l, &who, &[]));
                }
                told?;
                return Err(fail("no new browser tab appeared within 5 s".into()));
            };
            if let Some(l) = &lease {
                super::lease::with(|t| t.add_page(l, &who, id)).map_err(fail)?;
                answer["lease"] = json!(l);
                answer["holder"] = json!(who);
            }
            answer["page"] = json!(id);
            answer["url"] = json!(url);
            answer["summary"] = json!(format!("page {id} opened at {url}"));
            answer
        }
        "browser.tab-close" => {
            let id = current(index())?;
            tell(TAB_EVENT, json!({ "action": "close", "page": id })).map_err(fail)?;
            if !settle(SETTLE, |t| t.iter().all(|t| t.id != id)) {
                return Err(fail(format!("browser tab {id} did not close")));
            }
            json!({ "page": id, "destructive": true, "summary": format!("page {id} closed") })
        }
        "browser.tab-lease" => {
            free_gone_leases();
            let l = text("lease").unwrap_or_default();
            let who = holder_of(req);
            let took = super::lease::with(|t| t.acquire(&l, &who, now_ms())).map_err(|m| Fail::new("blocked", m))?;
            let summary = if took { format!("{who} now holds placement {l}") } else { format!("{who} already holds placement {l}") };
            json!({ "lease": l, "holder": who, "taken": took, "summary": summary })
        }
        "browser.tab-release" => {
            let l = text("lease").unwrap_or_default();
            let who = holder_of(req);
            let open: Vec<u32> = tabs().iter().map(|t| t.id).collect();
            let pages = super::lease::with(|t| t.release(&l, &who, &open)).map_err(|m| if m.starts_with("no lease") { Fail::new("not_found", m) } else { Fail::new("blocked", m) })?;
            for p in &pages {
                tell(TAB_EVENT, json!({ "action": "close", "page": p })).map_err(fail)?;
            }
            if !settle(SETTLE, |t| t.iter().all(|t| !pages.contains(&t.id))) {
                let left: Vec<u32> = tabs().iter().map(|t| t.id).filter(|i| pages.contains(i)).collect();
                return Err(fail(format!("placement {l} was released but page(s) {left:?} did not close")));
            }
            json!({ "lease": l, "holder": who, "closed": pages, "destructive": !pages.is_empty(), "summary": format!("placement {l} released; {} page(s) closed", pages.len()) })
        }
        "browser.tab-leases" => {
            free_gone_leases();
            let open: Vec<u32> = tabs().iter().map(|t| t.id).collect();
            let rows = super::lease::with(|t| {
                t.prune(&open);
                t.rows()
            });
            json!({ "leases": rows, "summary": format!("{} lease(s)", rows.len()) })
        }
        "browser.tab-profile" => {
            let id = current(None)?;
            let (_, s) = store()?;
            let p = profiles::tab_profile(&s, id);
            json!({ "page": id, "profile": p, "summary": format!("page {id} runs in profile {p}") })
        }
        "browser.tab-profile-set" | "browser.tab-profile-use-default" | "browser.tab-profile-clone" => {
            let id = current(None)?;
            let (root, _) = store()?;
            let (p, saved) = profiles::edit(&root, |s| match req.command.as_str() {
                "browser.tab-profile-set" => profiles::set_tab(s, id, &text("profile").unwrap_or_default()),
                "browser.tab-profile-use-default" => profiles::set_tab(s, id, profiles::DEFAULT),
                _ => {
                    let from = profiles::tab_profile(s, id);
                    profiles::clone_profile(s, &from, Some(id))
                }
            });
            let p = p.map_err(|m| Fail::new("not_found", m))?;
            saved.map_err(fail)?;
            tell(PROFILE_EVENT, json!({ "page": id, "profile": p.id })).map_err(fail)?;
            json!({ "page": id, "profile": p, "summary": format!("page {id} uses profile {}; the pane reopens its page there", p.id) })
        }
        "browser.profiles-list" => {
            let (_, s) = store()?;
            let list = profiles::list(&s);
            json!({ "profiles": list, "summary": format!("{} profile(s)", list.len()) })
        }
        "browser.profiles-create" => {
            let (root, _) = store()?;
            let (p, saved) = profiles::edit(&root, |s| profiles::create(s, &text("label").unwrap_or_default(), text("scope").as_deref(), !on("no-ua-spoof")));
            let p = p.map_err(args)?;
            saved.map_err(fail)?;
            json!({ "profile": p, "summary": format!("profile {} created ({})", p.id, p.scope) })
        }
        "browser.profiles-delete" => {
            let (root, _) = store()?;
            let id = text("profile").unwrap_or_default();
            let (gone, saved) = profiles::edit(&root, |s| {
                let users: Vec<u32> = s.tabs.iter().filter(|(_, v)| **v == id).filter_map(|(k, _)| k.parse().ok()).collect();
                profiles::delete(s, &id).map(|p| (p, users))
            });
            let (p, users) = gone.map_err(|m| if m.contains("default") { args(m) } else { Fail::new("not_found", m) })?;
            saved.map_err(fail)?;
            // after-list 153: its tabs reopen on the default now; the data folder goes once none of them is open in it.
            for page in users {
                tell(PROFILE_EVENT, json!({ "page": page, "profile": profiles::DEFAULT })).map_err(fail)?;
            }
            profiles::forget_data(&p.id);
            json!({ "profile": p, "destructive": true, "summary": format!("profile {} deleted; its tabs reopen on the default and its data folder is removed once none is open in it", p.id) })
        }
        _ => return Ok(None),
    };
    Ok(Some(v))
}

/// The readable form of a browser answer.
pub fn text(command: &str, r: &Value) -> Option<String> {
    if let Some((_, base)) = storage_word(command) {
        return text(&base, r);
    }
    if !is_browser(command) {
        return None;
    }
    Some(match command {
        "browser.snapshot" => format!("{} ({})\n{}", r["title"].as_str().unwrap_or_default(), r["url"].as_str().unwrap_or_default(), r["tree"].as_str().unwrap_or_default()),
        "browser.get" | "browser.eval" => match &r["value"] {
            Value::String(s) => s.clone(),
            Value::Null => "null".into(),
            v => v.to_string(),
        },
        "browser.is" => r["value"].as_bool().unwrap_or(false).to_string(),
        "browser.wait" => format!("the condition holds (asked {} time(s)) at {}", r["asked"], r["url"].as_str().unwrap_or_default()),
        "browser.tab-list" => {
            let rows = r["tabs"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                "no browser tab is open".into()
            } else {
                rows.iter()
                    .map(|t| {
                        let title = t["title"].as_str().filter(|s| !s.is_empty()).unwrap_or("(untitled)");
                        format!("{}{} {} {}{}{}", t["page"], if t["shown"].as_bool().unwrap_or(false) { "*" } else { " " }, title, t["url"].as_str().unwrap_or_default(), t["worktree"].as_str().map(|w| format!("  [{w}]")).unwrap_or_default(), t["profile"].as_str().map(|p| format!("  profile {p}")).unwrap_or_default())
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        "browser.profiles-list" => r["profiles"].as_array().cloned().unwrap_or_default().iter().map(|p| format!("{}  {} ({}{})", p["id"].as_str().unwrap_or_default(), p["label"].as_str().unwrap_or_default(), p["scope"].as_str().unwrap_or_default(), if p["uaSpoof"].as_bool().unwrap_or(true) { "" } else { ", no ua spoof" })).collect::<Vec<_>>().join("\n"),
        "browser.cookie-get" => {
            let c = r["cookies"].as_array().cloned().unwrap_or_default();
            if c.is_empty() {
                "no cookie the page can read".into()
            } else {
                c.iter().map(|c| format!("{}={}", c["name"].as_str().unwrap_or_default(), c["value"].as_str().unwrap_or_default())).collect::<Vec<_>>().join("\n")
            }
        }
        "browser.storage-get" => match &r["value"] {
            Value::String(s) => s.clone(),
            Value::Null => "null".into(),
            v => serde_json::to_string_pretty(v).unwrap_or_default(),
        },
        "browser.console" => lines(&r["entries"], |e| format!("[{}] {}", e["level"].as_str().unwrap_or("log"), e["text"].as_str().unwrap_or_default()), "no console message recorded"),
        "browser.network" => lines(&r["entries"], |e| format!("{:<6} {} {}{}", e["kind"].as_str().unwrap_or_default(), e["status"].as_u64().map(|s| s.to_string()).unwrap_or_else(|| e["failed"].as_str().map(|f| format!("({f})")).unwrap_or_default()), e["url"].as_str().unwrap_or_default(), e["ms"].as_u64().map(|ms| format!("  {ms} ms")).unwrap_or_default()), "no request recorded"),
        "browser.intercept-list" => format!("patterns: {}\n{}", match &r["patterns"] { Value::Array(p) => p.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "), _ => "none".into() }, lines(&r["held"], |e| format!("held {} {}", e["kind"].as_str().unwrap_or_default(), e["url"].as_str().unwrap_or_default()), "no request held")),
        "browser.clipboard-read" => r["text"].as_str().unwrap_or_default().to_string(),
        "browser.tab-leases" => lines(&r["leases"], |l| format!("{}  held by {}  pages {}", l["lease"].as_str().unwrap_or_default(), l["holder"].as_str().unwrap_or_default(), l["pages"]), "no lease is held"),
        _ => r["summary"].as_str().map(str::to_string).unwrap_or_else(|| "ok".into()),
    })
}

/// One line per entry, or the word for none.
fn lines(list: &Value, line: impl Fn(&Value) -> String, none: &str) -> String {
    let rows: Vec<String> = list.as_array().map(|l| l.iter().map(&line).collect()).unwrap_or_default();
    if rows.is_empty() { none.to_string() } else { rows.join("\n") }
}

/// The page-side helper. It installs itself once per page as `window.__kx` (references, mouse
/// position) and answers one request per run as a JSON object: `{ok, ...}` or `{error}`.
/// `__REQ__` is replaced with the request before the script runs.
const DRIVER: &str = r#"(function(){
if(!window.__kx){
 const K={refs:{},n:0,mouse:{x:0,y:0}};
 const vis=e=>{ if(!(e instanceof Element)) return false; const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
 const role=e=>{ const r=e.getAttribute('role'); if(r) return r; const t=e.tagName.toLowerCase();
  if(t==='a'&&e.hasAttribute('href')) return 'link'; if(t==='button'||t==='summary') return 'button';
  if(t==='input'){ const ty=(e.type||'text').toLowerCase(); return ty==='checkbox'?'checkbox':ty==='radio'?'radio':(ty==='submit'||ty==='button'||ty==='reset')?'button':ty==='range'?'slider':ty==='file'?'textbox':'textbox'; }
  if(t==='textarea'||e.isContentEditable) return 'textbox'; if(t==='select') return 'combobox'; if(/^h[1-6]$/.test(t)) return 'heading';
  if(t==='img') return 'img'; if(t==='li') return 'listitem'; if(t==='option') return 'option'; if(t==='nav') return 'navigation'; if(t==='main') return 'main';
  if(t==='form') return 'form'; if(t==='table') return 'table'; if(t==='label') return 'label'; if(t==='p') return 'paragraph';
  if(e.hasAttribute('onclick')||(e.tabIndex>=0&&t!=='body')) return 'generic'; return null; };
 const name=e=>{ const l=e.getAttribute('aria-label'); if(l) return l; const lb=e.labels&&e.labels[0]; if(lb) return (lb.textContent||'').trim();
  if(e.tagName==='IMG') return e.alt||''; if(e.tagName==='INPUT'&&e.placeholder) return e.placeholder; return (e.innerText||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,80); };
 K.snapshot=function(){ K.refs={}; K.n=0; const out=[];
  const walk=(e,d)=>{ if(!(e instanceof Element)) return; const t=e.tagName.toLowerCase(); if(t==='script'||t==='style'||t==='noscript'||t==='template') return; if(!vis(e)) return;
   const r=role(e); let dd=d; if(r&&K.n<500){ K.n++; const id='e'+K.n; K.refs[id]=e; let line=' '.repeat(d*2)+'- '+r; const nm=name(e); if(nm) line+=' "'+nm.replace(/"/g,'\\"')+'"';
    if(r==='heading') line+=' [level='+(e.getAttribute('aria-level')||t.slice(1))+']'; if(r==='checkbox'||r==='radio') line+=' [checked='+!!e.checked+']'; if(e.disabled) line+=' [disabled]';
    if(r==='link') line+=' [href='+e.href+']'; line+=' [ref='+id+']'; out.push(line); dd=d+1; }
   for(const c of e.children) walk(c,dd); };
  walk(document.body,0); return {ok:true,url:location.href,title:document.title,count:K.n,tree:out.join('\n')}; };
 const el=ref=>{ const e=K.refs[ref]; if(!e||!e.isConnected) throw new Error(ref+' is not known to this page; run snapshot again'); return e; };
 const ev=(e,type,init)=>{ const C=(type==='click'||type==='dblclick'||type.startsWith('mouse'))?MouseEvent:type.startsWith('key')?KeyboardEvent:(type.startsWith('drag')||type==='drop')?DragEvent:Event; return e.dispatchEvent(new C(type,Object.assign({bubbles:true,cancelable:true,composed:true},init||{}))); };
 const setValue=(e,v)=>{ e.focus(); if(e.isContentEditable){ e.textContent=v; } else { const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value'); if(p&&p.set) p.set.call(e,v); else e.value=v; } ev(e,'input'); ev(e,'change'); };
 const target=()=>{ let a=document.activeElement; while(a&&a.shadowRoot&&a.shadowRoot.activeElement) a=a.shadowRoot.activeElement; if(a&&a.tagName==='IFRAME'){ try{ const d=a.contentDocument; if(d&&d.activeElement) a=d.activeElement; }catch(_){} } return a||document.body; };
 const insert=txt=>{ const t=target(); if(t.isContentEditable){ t.focus(); document.execCommand('insertText',false,txt); return; } if('value' in t&&t.tagName!=='BUTTON'){ const s=t.selectionStart==null?t.value.length:t.selectionStart, en=t.selectionEnd==null?t.value.length:t.selectionEnd; setValue(t,t.value.slice(0,s)+txt+t.value.slice(en)); try{ t.setSelectionRange(s+txt.length,s+txt.length); }catch(_){} return; } throw new Error('nothing that takes text has the focus; focus or click a field first'); };
 const locate=(type,value)=>{ const v=String(value).toLowerCase(); if(type==='selector') return document.querySelector(value); const all=[...document.querySelectorAll('*')].filter(vis);
  if(type==='role') return all.find(e=>role(e)===v)||null; if(type==='placeholder') return all.find(e=>(e.placeholder||'').toLowerCase().includes(v))||null;
  if(type==='label') return all.find(e=>name(e).toLowerCase()===v)||all.find(e=>name(e).toLowerCase().includes(v))||null;
  const has=e=>(e.innerText||'').trim().toLowerCase().includes(v); return all.find(e=>has(e)&&![...e.children].some(has))||null; };
 const at=(x,y)=>document.elementFromPoint(x,y)||document.body;
 const sum=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'');
 const act=(action,e,arg)=>{ switch(action){
  case 'click': e.scrollIntoView({block:'center'}); ev(e,'mouseover'); ev(e,'mousedown',{button:0}); if(e.focus) e.focus(); ev(e,'mouseup',{button:0}); e.click(); return 'clicked '+sum(e);
  case 'dblclick': e.click(); e.click(); ev(e,'dblclick'); return 'double-clicked '+sum(e);
  case 'check': if(!e.checked) e.click(); return 'checked '+sum(e);
  case 'uncheck': if(e.checked) e.click(); return 'unchecked '+sum(e);
  case 'focus': e.focus(); return 'focused '+sum(e);
  case 'clear': setValue(e,''); return 'cleared '+sum(e);
  case 'select-all': e.focus(); if(e.select) e.select(); else { const s=getSelection(); const r=document.createRange(); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); } return 'selected all in '+sum(e);
  case 'hover': e.scrollIntoView({block:'center'}); ev(e,'mouseover'); ev(e,'mouseenter',{bubbles:false}); ev(e,'mousemove'); return 'hovering '+sum(e);
  case 'scrollintoview': e.scrollIntoView({block:'center'}); return 'scrolled to '+sum(e);
  case 'fill': setValue(e,arg==null?'':String(arg)); return 'filled '+sum(e);
  case 'type': e.focus(); insert(arg==null?'':String(arg)); return 'typed into '+sum(e);
  case 'select': { const opts=[...(e.options||[])]; const o=opts.find(o=>o.value===arg)||opts.find(o=>o.text.trim()===arg); if(!o) throw new Error('no option '+arg+' in '+sum(e)); e.value=o.value; ev(e,'input'); ev(e,'change'); return 'selected '+o.value+' in '+sum(e); }
  case 'highlight': e.style.outline='3px solid #ff5a00'; e.style.outlineOffset='2px'; return 'highlighted '+sum(e);
  default: throw new Error('unknown action '+action); } };
 K.run=function(q){ try{ const a=q.args||{}; switch(q.cmd){
  case 'snapshot': return K.snapshot();
  case 'eval': { const v=(0,eval)(a.expression); return {ok:true,value:v===undefined?null:v}; }
  case 'scroll': { const n=Number(a.amount||500), d=a.direction; window.scrollBy(d==='left'?-n:d==='right'?n:0, d==='up'?-n:d==='down'?n:0); return {ok:true,summary:'scrolled '+d+' '+n+' px',scrollX:window.scrollX,scrollY:window.scrollY}; }
  case 'click': case 'dblclick': case 'check': case 'uncheck': case 'focus': case 'clear': case 'select-all': case 'hover': case 'scrollintoview': return {ok:true,summary:act(q.cmd,el(a.element))};
  case 'fill': return {ok:true,summary:act('fill',el(a.element),a.value)};
  case 'type': insert(a.input==null?'':String(a.input)); return {ok:true};
  case 'inserttext': insert(a.text==null?'':String(a.text)); return {ok:true};
  case 'select': return {ok:true,summary:act('select',el(a.element),a.value)};
  case 'keypress': { const t=target(); const k=String(a.key); const init={key:k,code:k.length===1?'Key'+k.toUpperCase():k}; ev(t,'keydown',init); ev(t,'keypress',init); if(k==='Enter'&&t.form&&t.tagName==='INPUT'){ if(t.form.requestSubmit) t.form.requestSubmit(); else t.form.submit(); } ev(t,'keyup',init); return {ok:true,summary:'pressed '+k}; }
  case 'drag': { const f=el(a.from), t=el(a.to); const dt=new DataTransfer(); ev(f,'dragstart',{dataTransfer:dt}); ev(t,'dragenter',{dataTransfer:dt}); ev(t,'dragover',{dataTransfer:dt}); ev(t,'drop',{dataTransfer:dt}); ev(f,'dragend',{dataTransfer:dt}); return {ok:true,summary:'dragged '+sum(f)+' to '+sum(t)}; }
  case 'upload': { const e=el(a.element); if(!(e instanceof HTMLInputElement)||e.type!=='file') throw new Error(a.element+' is not a file input'); const dt=new DataTransfer(); for(const f of a.files){ const bin=atob(f.data); const buf=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i); dt.items.add(new File([buf],f.name,{type:f.type||''})); } e.files=dt.files; ev(e,'input'); ev(e,'change'); return {ok:true,summary:'attached '+a.files.length+' file(s) to '+sum(e)}; }
  case 'highlight': { const e=K.refs[a.selector]||document.querySelector(a.selector); if(!e) throw new Error('nothing matches '+a.selector); return {ok:true,summary:act('highlight',e)}; }
  case 'find': { const e=locate(a.locator,a.value); if(!e) throw new Error('no '+a.locator+' matches '+JSON.stringify(a.value)); return {ok:true,summary:act(a.action,e,a.text)}; }
  case 'get': { const w=a.what; if(w==='url') return {ok:true,value:location.href}; if(w==='title') return {ok:true,value:document.title}; if(w==='count') return {ok:true,value:K.refs[a.element]?1:document.querySelectorAll(a.element).length};
   const e=el(a.element); if(w==='text') return {ok:true,value:(e.innerText!=null?e.innerText:e.textContent)||''}; if(w==='html') return {ok:true,value:e.outerHTML}; if(w==='value') return {ok:true,value:e.value===undefined?null:e.value};
   if(w==='box'){ const r=e.getBoundingClientRect(); return {ok:true,value:{x:r.x,y:r.y,width:r.width,height:r.height}}; } throw new Error('unknown property '+w); }
  case 'is': { const e=el(a.element); const w=a.what; if(w==='visible') return {ok:true,value:vis(e)}; if(w==='enabled') return {ok:true,value:!e.disabled}; if(w==='checked') return {ok:true,value:!!e.checked}; throw new Error('unknown state '+w); }
  case 'mouse-move': { K.mouse={x:Number(a.x),y:Number(a.y)}; ev(at(K.mouse.x,K.mouse.y),'mousemove',{clientX:K.mouse.x,clientY:K.mouse.y}); return {ok:true,summary:'mouse at '+K.mouse.x+','+K.mouse.y}; }
  case 'mouse-down': case 'mouse-up': { const b={left:0,middle:1,right:2}[a.button||'left']; ev(at(K.mouse.x,K.mouse.y),q.cmd==='mouse-down'?'mousedown':'mouseup',{button:b,clientX:K.mouse.x,clientY:K.mouse.y}); return {ok:true,summary:q.cmd.replace('-',' ')+' ('+(a.button||'left')+')'}; }
  case 'mouse-wheel': { const dx=Number(a.dx||0), dy=Number(a.dy||0); const e=at(K.mouse.x,K.mouse.y); e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:dx,deltaY:dy,clientX:K.mouse.x,clientY:K.mouse.y})); window.scrollBy(dx,dy); return {ok:true,summary:'wheel '+dx+','+dy}; }
  case 'cookie-get': { const all=document.cookie?document.cookie.split('; ').map(c=>{ const i=c.indexOf('='); return {name:i<0?c:c.slice(0,i),value:i<0?'':decodeURIComponent(c.slice(i+1))}; }):[]; const list=a.name?all.filter(c=>c.name===a.name):all; return {ok:true,cookies:list,summary:list.length+' cookie(s) the page can read'}; }
  case 'cookie-set': { let s=a.name+'='+encodeURIComponent(a.value==null?'':String(a.value))+'; path='+(a.path||'/'); if(a.domain) s+='; domain='+a.domain; if(Number(a.expires)>0) s+='; expires='+new Date(Number(a.expires)*1000).toUTCString(); if(a.secure) s+='; secure'; if(a.sameSite) s+='; samesite='+a.sameSite; document.cookie=s; return {ok:true,summary:'cookie '+a.name+' set for '+location.host}; }
  case 'cookie-delete': { let s=a.name+'=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path='+(a.path||'/'); if(a.domain) s+='; domain='+a.domain; document.cookie=s; return {ok:true,summary:'cookie '+a.name+' deleted for '+location.host}; }
  case 'storage-get': { const st=a.area==='session'?sessionStorage:localStorage; if(a.key!=null&&a.key!=='') return {ok:true,value:st.getItem(String(a.key))}; const o={}; for(let i=0;i<st.length;i++){ const k=st.key(i); o[k]=st.getItem(k); } return {ok:true,value:o}; }
  case 'storage-set': { const st=a.area==='session'?sessionStorage:localStorage; st.setItem(String(a.key),a.value==null?'':String(a.value)); return {ok:true,summary:(a.area||'local')+' storage: '+a.key+' set'}; }
  case 'storage-clear': { const st=a.area==='session'?sessionStorage:localStorage; const n=st.length; st.clear(); return {ok:true,summary:(a.area||'local')+' storage cleared ('+n+' key(s))'}; }
  case 'log': { if(!window.__kxLog) throw new Error('this page has no recorder; reload it'); return {ok:true,entries:window.__kxLog(a.what,Number(a.limit)||100)}; }
  case 'dialog': { if(!window.__kxDialog) throw new Error('this page has no dialog hook; reload it'); const n=window.__kxDialog({accept:!!a.accept,text:a.text==null?null:String(a.text)}); return {ok:true,armed:n,summary:(a.accept?'the next dialog is accepted':'the next dialog is dismissed')+(a.text!=null?' with '+JSON.stringify(String(a.text)):'')+' ('+n+' answer(s) armed)',dialogs:window.__kxLog('dialogs',5)}; }
  case 'check-wait': { let ok=true; if(a.selector){ const e=document.querySelector(a.selector); ok=ok&&(a.state==='hidden'?!(e&&vis(e)):!!e&&(a.state!=='visible'||vis(e))); }
   if(a.text) ok=ok&&((document.body&&document.body.innerText)||'').includes(a.text); if(a.load) ok=ok&&(a.load==='domcontentloaded'?document.readyState!=='loading':document.readyState==='complete'); if(a.fn) ok=ok&&!!(0,eval)(a.fn); return {ok:true,value:ok,url:location.href}; }
  default: throw new Error('unknown command '+q.cmd);
 } } catch(e){ return {error:String((e&&e.message)||e)}; } };
 window.__kx=K;
}
return window.__kx.run(__REQ__);
})()"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(pairs: &[(&str, &str)]) -> Map<String, Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), json!(v))).collect()
    }

    #[test]
    fn every_browser_command_takes_worktree_page_and_a_unique_wire_name() {
        let mut wires = std::collections::HashSet::new();
        for (path, wire, flags) in COMMANDS {
            assert!(flags.contains(&"worktree") && flags.contains(&"page"), "{path}");
            assert!(wire.starts_with("browser."), "{wire}");
            assert!(wires.insert(*wire), "duplicate wire {wire}");
        }
        assert!(is_browser("browser.click") && !is_browser("terminal.list"));
    }

    #[test]
    fn check_wants_the_flags_each_command_lives_on() {
        assert_eq!(check("browser.goto", &flags(&[])).unwrap_err().message, "--url is required");
        assert!(check("browser.goto", &flags(&[("url", "https://example.com")])).is_ok());
        assert!(check("browser.wait", &flags(&[("timeout", "2000")])).unwrap_err().message.starts_with("wait needs a condition"));
        assert!(check("browser.wait", &flags(&[("text", "Done"), ("timeout", "2000")])).is_ok());
        assert!(check("browser.wait", &flags(&[("text", "Done"), ("timeout", "0")])).unwrap_err().message.contains("--timeout takes milliseconds"));
        assert!(check("browser.wait", &flags(&[("state", "visible")])).unwrap_err().message.contains("--selector"));
        assert!(check("browser.wait", &flags(&[("load", "ready")])).unwrap_err().message.contains("load|domcontentloaded|networkidle"));
        assert_eq!(check("browser.click", &flags(&[])).unwrap_err().message, "--element is required");
        assert_eq!(check("browser.fill", &flags(&[("element", "e5")])).unwrap_err().message, "--value is required");
        // A blank value is a value for fill, type and inserttext (clearing a field by filling "").
        assert!(check("browser.fill", &flags(&[("element", "e5"), ("value", "")])).is_ok());
        assert!(check("browser.type", &flags(&[("input", "")])).is_ok());
        assert_eq!(check("browser.get", &flags(&[("what", "value")])).unwrap_err().message, "--element is required");
        assert!(check("browser.get", &flags(&[("what", "url")])).is_ok());
        assert!(check("browser.get", &flags(&[("what", "colour"), ("element", "e1")])).unwrap_err().message.contains("text|html|value|url|title|count|box"));
        assert!(check("browser.is", &flags(&[("what", "visible"), ("element", "e5")])).is_ok());
        assert!(check("browser.mouse-move", &flags(&[("x", "ten"), ("y", "2")])).unwrap_err().message.contains("--x takes a number"));
        assert!(check("browser.mouse-down", &flags(&[("button", "back")])).unwrap_err().message.contains("left|right|middle"));
        assert!(check("browser.find", &flags(&[("locator", "role"), ("value", "button"), ("action", "poke")])).unwrap_err().message.contains("is not one of"));
        assert!(check("browser.scroll", &flags(&[("direction", "left")])).is_ok());
        assert_eq!(check("browser.scroll", &flags(&[("direction", "sideways")])).unwrap_err().message, "--direction sideways is not one of up|down|left|right");
        assert_eq!(check("browser.snapshot", &flags(&[("page", "two")])).unwrap_err().message, "--page takes a tab number, not two");
        assert_eq!(check("browser.snapshot", &flags(&[("worktree", " ")])).unwrap_err().message, "--worktree cannot be empty");
        assert_eq!(check("browser.exec", &flags(&[])).unwrap_err().message, "--command is required");
        assert_eq!(check("browser.exec", &flags(&[])).unwrap_err().code, "invalid_arguments");
    }

    #[test]
    fn brow049_050_check_wants_what_the_log_and_emulation_commands_need() {
        assert!(check("browser.console", &flags(&[("limit", "0")])).unwrap_err().message.contains("--limit takes a count"));
        assert!(check("browser.network", &flags(&[("limit", "20")])).is_ok());
        assert_eq!(check("browser.viewport", &flags(&[("width", "390")])).unwrap_err().message, "--height is required");
        assert!(check("browser.viewport", &flags(&[("width", "390"), ("height", "0")])).unwrap_err().message.contains("whole pixels from 1 to 10000"));
        assert!(check("browser.viewport", &flags(&[("width", "390"), ("height", "844"), ("scale", "9")])).unwrap_err().message.contains("--scale takes a factor"));
        assert!(check("browser.viewport", &flags(&[("width", "390"), ("height", "844"), ("scale", "3"), ("mobile", "true")])).is_ok());
        assert!(check("browser.geolocation", &flags(&[("latitude", "91"), ("longitude", "0")])).unwrap_err().message.contains("-90 to 90"));
        assert!(check("browser.geolocation", &flags(&[("latitude", "37.77"), ("longitude", "-122.4"), ("accuracy", "10")])).is_ok());
        assert!(check("browser.set-device", &flags(&[("name", "Nokia 3310")])).unwrap_err().message.starts_with("no device is called Nokia 3310"));
        assert!(check("browser.set-device", &flags(&[("name", "iphone-14")])).is_ok());
        assert_eq!(device("IPHONE 14").map(|d| (d.1, d.2, d.4)), Some((390.0, 844.0, true)));
        // T-240 (BROW-034): the seven toolbar presets come first, named and sized as the compat list.
        let presets: Vec<_> = DEVICES[..PRESETS].iter().map(|d| (d.0, d.1 as u32, d.2 as u32, d.3 as u32, d.4)).collect();
        assert_eq!(presets, vec![("Mobile S", 320, 568, 2, true), ("Mobile M", 375, 667, 2, true), ("Mobile L", 425, 812, 2, true), ("Tablet", 768, 1024, 2, true), ("Laptop", 1024, 768, 1, false), ("Laptop L", 1440, 900, 1, false), ("Desktop", 1920, 1080, 1, false)]);
        assert_eq!(device("mobile-m").map(|d| d.0), Some("Mobile M"));
        assert_eq!(device("laptop l").map(|d| d.1), Some(1440.0));
        assert_eq!(check("browser.set-offline", &flags(&[("state", "maybe")])).unwrap_err().message, "--state maybe is not one of on|off");
        assert!(check("browser.set-offline", &flags(&[])).is_ok());
        assert!(check("browser.set-headers", &flags(&[("headers", "[1]")])).unwrap_err().message.contains("JSON object"));
        assert!(check("browser.set-headers", &flags(&[("headers", r#"{"X-Debug":1}"#)])).unwrap_err().message.contains("must be a string"));
        assert_eq!(headers_of(r#"{"X-Debug":"1"}"#).unwrap().len(), 1);
        assert_eq!(check("browser.set-credentials", &flags(&[("user", "me")])).unwrap_err().message, "--pass is required");
        assert_eq!(basic_auth("me", "secret"), "Basic bWU6c2VjcmV0");
        assert!(check("browser.set-media", &flags(&[])).unwrap_err().message.starts_with("set media needs"));
        assert!(check("browser.set-media", &flags(&[("color-scheme", "blue")])).unwrap_err().message.contains("dark|light"));
        assert!(check("browser.set-media", &flags(&[("reduced-motion", "reduce")])).is_ok());
        // BROW-050: an oversized clipboard write is refused before anything runs.
        let big = "x".repeat(CLIPBOARD_MAX + 1);
        let f = check("browser.clipboard-write", &flags(&[("text", &big)])).unwrap_err();
        assert_eq!(f.code, "invalid_arguments");
        assert!(f.message.contains("the clipboard takes up to 1024 KB"));
        assert!(check("browser.clipboard-write", &flags(&[("text", "")])).is_ok());
        assert_eq!(check("browser.clipboard-write", &flags(&[])).unwrap_err().message, "--text is required");
        assert!(check("browser.dialog-accept", &flags(&[("text", "hi")])).is_ok());
        for c in ["browser.intercept-enable", "browser.capture-start", "browser.console", "browser.network", "browser.viewport", "browser.set-device", "browser.clipboard-read", "browser.dialog-dismiss"] {
            assert!(is_browser(c), "{c}");
        }
    }

    #[test]
    fn brow049_050_emulation_state_is_per_tab_and_goes_with_the_tab() {
        let id = 9_049;
        assert_eq!(emu_state(id, "https://a.test/"), None);
        assert!(!offline(id));
        assert_eq!(fit(id, 1200.0, 800.0), (1200.0, 800.0));
        with_emu(id, |e| {
            e.state.insert("offline".into(), json!(true));
            e.viewport = Some((390.0, 844.0));
        });
        assert!(offline(id));
        // The page is cut to the emulated viewport, never grown past its pane.
        assert_eq!(fit(id, 1200.0, 800.0), (390.0, 800.0));
        assert_eq!(fit(id, 300.0, 900.0), (300.0, 844.0));
        assert_eq!(emu_state(id, "https://a.test/").as_deref(), Some(r#"{"offline":true}"#));
        assert_eq!(super::super::emu_script(r#"{"offline":true}"#), r#"window.__kxEmu && window.__kxEmu({"offline":true})"#);
        forget(id);
        assert_eq!(emu_state(id, "https://a.test/"), None);
        assert!(!offline(id));
        assert_eq!(fit(id, 1200.0, 800.0), (1200.0, 800.0));
    }

    #[test]
    fn t656_extra_headers_and_credentials_reach_only_pages_on_their_own_site() {
        let id = 9_656;
        with_emu(id, |e| {
            e.state.insert("headers".into(), json!({ "X-Token": "t" }));
            e.state.insert("headersOrigin".into(), json!("http://127.0.0.1:5000"));
            e.state.insert("auth".into(), json!("Basic bWU6c2VjcmV0"));
            e.state.insert("authOrigin".into(), json!("https://b.test"));
        });
        let at = |page: &str| serde_json::from_str::<Value>(&emu_state(id, page).unwrap()).unwrap();
        // On the headers' own site the headers go in; the credentials belong to another site.
        let a = at("http://127.0.0.1:5000/form?x=1");
        assert_eq!(a["headers"], json!({ "X-Token": "t" }));
        assert_eq!(a["auth"], Value::Null);
        // Another port, scheme or host is another site: neither value reaches that page.
        for other in ["http://127.0.0.1:5001/", "https://127.0.0.1:5000/", "http://localhost:5000/", "about:blank", "data:text/html,x"] {
            let s = at(other);
            assert_eq!(s["headers"], json!({}), "{other}");
            assert_eq!(s["auth"], Value::Null, "{other}");
            // Nor does that page learn which site they are for.
            assert!(s.get("headersOrigin").is_none() && s.get("authOrigin").is_none(), "{other}");
        }
        assert_eq!(at("https://b.test/login")["auth"], json!("Basic bWU6c2VjcmV0"));
        // Stored, not lost: back on the site the headers apply again.
        assert_eq!(at("http://127.0.0.1:5000/")["headers"], json!({ "X-Token": "t" }));
        forget(id);
        assert_eq!(origin_of("https://b.test:443/x"), Some("https://b.test".into()));
        assert_eq!(origin_of("about:blank"), None);
        assert!(check("browser.set-headers", &flags(&[("headers", "{}"), ("origin", "about:blank")])).unwrap_err().message.starts_with("--origin takes a web address"));
        assert!(check("browser.set-credentials", &flags(&[("user", "me"), ("pass", "x"), ("origin", "https://b.test")])).is_ok());
        assert_eq!(check("browser.set-credentials", &flags(&[("user", "me")])).unwrap_err().message, "--pass is required");
    }

    #[test]
    fn brow049_a_capture_merges_what_the_page_hands_back_and_lists_its_tail() {
        let mut got = vec![json!({ "url": "https://a.test/x", "kind": "fetch", "status": 200 })];
        // The page's performance entries repeat on every pull: a repeat adds nothing.
        assert_eq!(merge_entries(&mut got, &[json!({ "url": "https://a.test/x", "kind": "fetch", "status": 200 }), json!({ "url": "https://a.test/y", "kind": "img", "ms": 3, "bytes": 10 })]), 1);
        assert_eq!(got.len(), 2);
        assert_eq!(tail(&got, 1)[0]["url"], "https://a.test/y");
        assert_eq!(tail(&got, 10).len(), 2);
        let many: Vec<Value> = (0..CAPTURE_MAX + 5).map(|i| json!({ "i": i })).collect();
        merge_entries(&mut got, &many);
        assert_eq!(got.len(), CAPTURE_MAX);
        assert_eq!(got[0]["i"], 5);
        // The console line and the network line of the readable form.
        let console = json!({ "entries": [{ "level": "warn", "text": "careful" }] });
        assert_eq!(text("browser.console", &console).unwrap(), "[warn] careful");
        let net = json!({ "entries": [{ "kind": "fetch", "status": 404, "url": "https://a.test/x" }, { "kind": "xhr", "failed": "offline", "url": "https://a.test/y" }] });
        assert_eq!(text("browser.network", &net).unwrap(), "fetch  404 https://a.test/x\nxhr    (offline) https://a.test/y");
        assert_eq!(text("browser.console", &json!({ "entries": [] })).unwrap(), "no console message recorded");
        assert_eq!(text("browser.intercept-list", &json!({ "patterns": ["*/api/*"], "held": [] })).unwrap(), "patterns: */api/*\nno request held");
        assert_eq!(text("browser.clipboard-read", &json!({ "text": "hi" })).unwrap(), "hi");
        for needle in ["case 'log':", "case 'dialog':", "window.__kxLog(a.what", "window.__kxDialog("] {
            assert!(DRIVER.contains(needle), "{needle}");
        }
    }

    #[test]
    fn wildcard_matches_addresses_the_way_wait_url_means() {
        assert!(wildcard("*/done", "https://a.test/x/done"));
        assert!(wildcard("https://a.test/*", "https://a.test/x/done"));
        assert!(!wildcard("https://b.test/*", "https://a.test/x/done"));
        assert!(wildcard("done", "https://a.test/x/done")); // no star: a plain substring
        assert!(wildcard("*", ""));
        assert!(!wildcard("a*c", "ab"));
    }

    #[test]
    fn exec_lines_split_like_a_shell_and_text_goes_in_pieces() {
        assert_eq!(split_command(r#"fill --element e5 --value "hello world""#), vec!["fill", "--element", "e5", "--value", "hello world"]);
        assert_eq!(split_command("type --input ''"), vec!["type", "--input", ""]);
        assert_eq!(split_command(r"click --element e1\ 2"), vec!["click", "--element", "e1 2"]);
        assert_eq!(split_command("  "), Vec::<String>::new());
        let text: String = "ab".repeat(600) + "😀";
        let p = pieces(&text, TYPE_PIECE);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0].chars().count(), 500);
        assert_eq!(p[2], "ab".repeat(100) + "😀");
        assert_eq!(pieces("", 500), Vec::<String>::new());
    }

    #[test]
    fn a_page_error_becomes_a_fail_and_a_stale_reference_asks_for_a_new_snapshot() {
        let f = fail_of(&json!({ "error": "e12 is not known to this page; run snapshot again" })).unwrap();
        assert_eq!(f.code, "stale_reference");
        assert_eq!(fail_of(&json!({ "error": "no option x" })).unwrap().code, "failed");
        assert!(fail_of(&json!({ "ok": true })).is_none());
        assert_eq!(wait_limit(&json!({})), Duration::from_millis(WAIT_DEFAULT_MS));
        assert_eq!(wait_limit(&json!({ "timeout": "2000" })), Duration::from_millis(2000));
        assert_eq!(wait_limit(&json!({ "timeout": "9999999" })), Duration::from_millis(WAIT_MAX_MS));
    }

    // The functions that reach the page (run, eval_json, navigate_to, go) are not called from tests:
    // linking them pulls the window toolkit into the test binary, which then needs the app's
    // manifest to load (comctl32 v6). What stands before them, `gate`, is tested here instead.
    #[test]
    fn with_no_browser_tab_every_command_fails_clearly_and_nothing_opens() {
        let f = gate("browser.goto", None, Some("G:/Temp/wt"), &[]).unwrap_err();
        assert_eq!(f.code, "not_found");
        assert_eq!(f.message, "no browser tab is open in G:/Temp/wt");
        assert!(f.data["hint"].as_str().unwrap().contains("--page"));
        assert_eq!(gate("browser.snapshot", Some(7), None, &[]).unwrap_err().message, "browser tab 7 is not open");
        let tabs = [super::super::Tab { id: 3, worktree: Some("G:/Temp/wt".into()), shown: true, seen: 1, url: String::new(), title: String::new() }];
        assert_eq!(gate("browser.snapshot", None, Some("G:/Temp/wt"), &tabs).unwrap(), 3);
    }

    #[test]
    fn a_page_opened_a_moment_ago_answers_to_page_before_its_pane_reports_it() {
        let reported = vec![super::super::Tab { id: 3, worktree: Some("G:/Temp/wt".into()), shown: true, seen: 1, url: String::new(), title: String::new() }];
        // Page 8 exists in the engine but its pane has not reported it: --page 8 reaches it.
        let list = reported_or_open(reported.clone(), Some(8), |n| n == 8);
        assert_eq!(gate("browser.snapshot", Some(8), None, &list).unwrap(), 8);
        // It is never picked without --page: the worktree pick still finds the reported tab.
        assert_eq!(gate("browser.snapshot", None, Some("G:/Temp/wt"), &list).unwrap(), 3);
        // A page that does not exist is still refused, and a reported one is not doubled.
        let none = reported_or_open(reported.clone(), Some(9), |n| n == 8);
        assert_eq!(gate("browser.snapshot", Some(9), None, &none).unwrap_err().message, "browser tab 9 is not open");
        assert_eq!(reported_or_open(reported, Some(3), |_| true).len(), 1);
    }

    #[test]
    fn cli047_capture_print_and_download_reach_the_page_instead_of_being_refused() {
        for c in ["browser.screenshot", "browser.full-screenshot", "browser.pdf", "browser.download"] {
            let f = gate(c, Some(1), None, &[]).unwrap_err();
            assert_eq!(f.code, "not_found", "{c}: only a missing tab stops it");
        }
        let tabs = [super::super::Tab { id: 4, worktree: None, shown: true, seen: 1, url: String::new(), title: String::new() }];
        assert_eq!(gate("browser.screenshot", Some(4), None, &tabs).unwrap(), 4);
        assert!(check("browser.pdf", &flags(&[("path", "out/page.pdf")])).is_ok());
        assert_eq!(check("browser.download", &flags(&[("selector", "a.zip")])).unwrap_err().message, "--path is required");
    }

    #[test]
    fn cli047_capture_paths_stay_inside_the_worktree_and_never_overwrite() {
        let root = std::env::temp_dir().join(format!("kx-cli047-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let wt = root.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        let w = wt.to_string_lossy().replace('\\', "/");
        let p = out_path(Some(&w), &w, Some("shots/a.png"), Path::new(""), "").unwrap();
        assert_eq!(p, wt.join("shots").join("a.png"));
        assert!(wt.join("shots").is_dir(), "the folder is made");
        std::fs::write(&p, b"x").unwrap();
        assert_eq!(out_path(Some(&w), &w, Some("shots/a.png"), Path::new(""), "").unwrap(), wt.join("shots").join("a (2).png"));
        assert_eq!(out_path(Some(&w), &w, Some("../escape.png"), Path::new(""), "").unwrap_err().code, "outside");
        assert_eq!(out_path(Some(&w), &w, Some("C:/Windows/x.png"), Path::new(""), "").unwrap_err().code, "outside");
        assert_eq!(out_path(Some(&w), &w, Some("."), Path::new(""), "").unwrap_err().code, "not_a_file");
        let caps = root.join("captures");
        assert_eq!(out_path(Some(&w), &w, None, &caps, "page-1-screenshot-9.png").unwrap(), caps.join("page-1-screenshot-9.png"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cli047_pictures_are_the_visible_page_or_the_whole_layout_and_sizes_are_decoded_bytes() {
        let v: Value = serde_json::from_str(&shot_params("jpeg", None)).unwrap();
        assert_eq!(v, json!({ "format": "jpeg", "fromSurface": true }));
        let m = json!({ "cssContentSize": { "x": 0, "y": 0, "width": 1280.0, "height": 99999.0 }, "contentSize": { "width": 1.0, "height": 1.0 } });
        let v: Value = serde_json::from_str(&shot_params("png", Some(&m))).unwrap();
        assert_eq!(v["captureBeyondViewport"], json!(true));
        assert_eq!(v["clip"], json!({ "x": 0, "y": 0, "width": 1280.0, "height": PICTURE_MAX, "scale": 1 }));
        let old = json!({ "contentSize": { "width": 800.0, "height": 2000.0 } });
        let v: Value = serde_json::from_str(&shot_params("png", Some(&old))).unwrap();
        assert_eq!(v["clip"]["height"], json!(2000.0));
        assert_eq!(picture(&json!({ "data": "iVBORw0KGgo=" })).unwrap().len(), 8, "8 decoded bytes, not 12 base64 characters");
        assert_eq!(picture(&json!({})).unwrap_err().code, "failed");
        assert!(picture(&json!({ "data": "not base64!" })).unwrap_err().message.contains("not base64"));
    }

    #[test]
    fn exec_runs_browser_commands_only_and_never_another_exec() {
        // Without the cli.rs patch the parser does not know the browser words yet, so the refusal
        // is the parser's; with it, exec_words refuses non-browser words and nested execs.
        assert_eq!(exec_words("terminal list").unwrap_err().code, "invalid_arguments");
        assert_eq!(exec_words("").unwrap_err().code, "invalid_arguments");
        assert_eq!(exec_words("exec --command 'click --element e1'").unwrap_err().code, "invalid_arguments");
    }

    #[test]
    fn readable_answers() {
        assert_eq!(text("browser.snapshot", &json!({ "title": "T", "url": "https://a.test/", "tree": "- button \"Go\" [ref=e1]" })).unwrap(), "T (https://a.test/)\n- button \"Go\" [ref=e1]");
        assert_eq!(text("browser.get", &json!({ "value": "hello" })).unwrap(), "hello");
        assert_eq!(text("browser.get", &json!({ "value": { "x": 1 } })).unwrap(), "{\"x\":1}");
        assert_eq!(text("browser.is", &json!({ "value": false })).unwrap(), "false");
        assert_eq!(text("browser.click", &json!({ "summary": "clicked button#go" })).unwrap(), "clicked button#go");
        assert_eq!(text("browser.wait", &json!({ "asked": 3, "url": "https://a.test/" })).unwrap(), "the condition holds (asked 3 time(s)) at https://a.test/");
        assert!(text("terminal.list", &json!({})).is_none());
    }

    #[test]
    fn brow044_tab_rows_follow_the_worktree_and_all_means_every_tab() {
        let t = |id: u32, wt: Option<&str>, shown: bool| Tab { id, worktree: wt.map(str::to_string), shown, seen: id as u64, url: format!("https://{id}.test/"), title: format!("T{id}") };
        let tabs = vec![t(3, Some("G:/wt/a"), false), t(1, Some("G:/wt/b"), true), t(2, Some("G:/wt/a"), true)];
        assert_eq!(tab_rows(&tabs, Some("g:\\wt\\a"), false).iter().map(|t| t.id).collect::<Vec<_>>(), [2, 3]);
        assert_eq!(tab_rows(&tabs, Some("G:/wt/a"), true).len(), 3);
        assert_eq!(tab_rows(&tabs, None, false).len(), 3);
        assert!(tab_rows(&tabs, Some("G:/wt/c"), false).is_empty());
        let blank = vec![t(5, None, true)];
        assert_eq!(tab_rows(&blank, Some("G:/wt/c"), false).len(), 1, "tabs no pane described count for any worktree");
        let mut s = profiles::Store::default();
        profiles::create(&mut s, "Work", None, true).unwrap();
        profiles::set_tab(&mut s, 2, "work").unwrap();
        let r = row(&tabs[2], Some(&s));
        assert_eq!((r["page"].as_u64(), r["profile"].as_str(), r["shown"].as_bool()), (Some(2), Some("work"), Some(true)));
        assert!(row(&tabs[0], None).get("profile").is_none());
        assert!(same_origin("https://a.test/x", "https://a.test/y?z") && !same_origin("https://a.test/", "http://a.test/") && !same_origin("nope", "https://a.test/"));
        assert_eq!(text("browser.tab-list", &json!({ "tabs": [r] })).unwrap(), "2* T2 https://2.test/  [G:/wt/a]  profile work");
        assert_eq!(text("browser.tab-list", &json!({ "tabs": [] })).unwrap(), "no browser tab is open");
    }

    #[test]
    fn brow044_tab_and_profile_commands_check_their_flags_and_need_no_page() {
        assert!(check("browser.tab-switch", &flags(&[("index", "x")])).unwrap_err().message.contains("--index takes a tab number"));
        assert!(check("browser.tab-switch", &flags(&[("index", "4"), ("focus", "true")])).is_ok());
        assert_eq!(check("browser.profiles-create", &flags(&[])).unwrap_err().message, "--label is required");
        assert!(check("browser.profiles-create", &flags(&[("label", "Work"), ("scope", "shared")])).unwrap_err().message.contains("isolated|imported"));
        assert_eq!(check("browser.profiles-delete", &flags(&[])).unwrap_err().message, "--profile is required");
        assert!(gate("browser.tab-show", Some(9), None, &[]).is_err_and(|f| f.code == "not_found"));
        let names: Vec<&str> = COMMANDS.iter().filter(|c| c.0.starts_with("tab ") || c.0.starts_with("profiles ")).map(|c| c.0).collect();
        assert_eq!(names, ["tab list", "tab current", "tab show", "tab switch", "tab create", "tab close", "tab lease", "tab release", "tab leases", "tab profile", "tab profile set", "tab profile use-default", "tab profile clone", "profiles list", "profiles create", "profiles delete"]);
    }

    #[test]
    fn orch061_lease_commands_check_their_flags_and_name_the_holder() {
        assert_eq!(check("browser.tab-lease", &flags(&[])).unwrap_err().message, "--lease is required");
        assert_eq!(check("browser.tab-release", &flags(&[("holder", "a")])).unwrap_err().message, "--lease is required");
        assert!(check("browser.tab-lease", &flags(&[("lease", &"x".repeat(81))])).unwrap_err().message.contains("longer than"));
        assert!(check("browser.tab-lease", &flags(&[("lease", "review"), ("holder", "agent-a")])).is_ok());
        // tab create takes a lease only when one is named; a bare --lease is refused.
        assert!(check("browser.tab-create", &flags(&[("url", "https://a.test/")])).is_ok());
        let mut bare = flags(&[("url", "https://a.test/")]);
        bare.insert("lease".into(), json!(true));
        assert_eq!(check("browser.tab-create", &bare).unwrap_err().message, "--lease is required");
        assert!(check("browser.tab-create", &flags(&[("url", "https://a.test/"), ("lease", "review")])).is_ok());
        // The holder: --holder, else the calling terminal, else the command line.
        let mut req = Request { id: "1".into(), token: String::new(), command: "browser.tab-lease".into(), cwd: ".".into(), args: json!({}), pane: None, cli: String::new(), arrived: None };
        assert_eq!(holder_of(&req), "cli");
        req.pane = Some(crate::cli::Pane { handle: "term-4".into(), key: "k".into() });
        assert_eq!(holder_of(&req), "term-4");
        req.args = json!({ "holder": " agent-a " });
        assert_eq!(holder_of(&req), "agent-a");
        // The readable list.
        let r = json!({ "leases": [{ "lease": "review", "holder": "term-4", "pages": [3, 5], "since": 1 }] });
        assert_eq!(text("browser.tab-leases", &r).unwrap(), "review  held by term-4  pages [3,5]");
        assert_eq!(text("browser.tab-leases", &json!({ "leases": [] })).unwrap(), "no lease is held");
    }

    #[test]
    fn brow048_cookie_and_storage_commands_check_their_flags_and_the_page_answers_them() {
        assert_eq!(check("browser.cookie-set", &flags(&[("value", "1")])).unwrap_err().message, "--name is required");
        assert_eq!(check("browser.cookie-set", &flags(&[("name", "a")])).unwrap_err().message, "--value is required");
        let mut f = flags(&[("name", "a"), ("value", "1")]);
        f.insert("httpOnly".into(), json!(true));
        assert!(check("browser.cookie-set", &f).is_ok());
        assert!(check("browser.cookie-set", &flags(&[("name", "a"), ("value", "1"), ("sameSite", "loose")])).unwrap_err().message.contains("Strict|Lax|None"));
        assert!(check("browser.cookie-get", &flags(&[])).is_ok());
        assert_eq!(check("browser.cookie-delete", &flags(&[])).unwrap_err().message, "--name is required");
        assert!(check("browser.storage-get", &flags(&[("area", "cloud")])).unwrap_err().message.contains("local|session"));
        assert_eq!(check("browser.storage-set", &flags(&[("area", "session")])).unwrap_err().message, "--key is required");
        assert_eq!(check("browser.storage-set", &flags(&[("key", "k")])).unwrap_err().message, "--value is required");
        for c in ["cookie-get", "cookie-set", "cookie-delete", "storage-get", "storage-set", "storage-clear"] {
            assert!(DRIVER.contains(&format!("case '{c}'")), "the driver answers {c}");
        }
        assert_eq!(text("browser.cookie-get", &json!({ "cookies": [{ "name": "a", "value": "1" }, { "name": "b", "value": "" }] })).unwrap(), "a=1\nb=");
        assert_eq!(text("browser.cookie-get", &json!({ "cookies": [] })).unwrap(), "no cookie the page can read");
        assert_eq!(text("browser.storage-get", &json!({ "value": "v" })).unwrap(), "v");
        assert_eq!(text("browser.profiles-list", &json!({ "profiles": [{ "id": "default", "label": "Default", "scope": "isolated", "uaSpoof": true }, { "id": "w", "label": "W", "scope": "imported", "uaSpoof": false }] })).unwrap(), "default  Default (isolated)\nw  W (imported, no ua spoof)");
    }

    #[test]
    fn the_driver_script_carries_the_request_and_every_command_word() {
        let script = DRIVER.replace("__REQ__", &json!({ "cmd": "snapshot", "args": {} }).to_string());
        assert!(script.ends_with("return window.__kx.run({\"cmd\":\"snapshot\",\"args\":{}});\n})()"));
        for (_, wire, _) in COMMANDS {
            let cmd = short(wire);
            // T-242: the log, emulation and dialog commands reach the page through the shared
            // 'log' and 'dialog' cases and the __kxEmu state; clipboard never reaches the page.
            let app_side = ["tab-", "profiles-", "intercept-", "capture-", "set-", "clipboard-", "dialog-", "storage-local-", "storage-session-"].iter().any(|p| cmd.starts_with(p));
            if app_side || ["goto", "back", "forward", "reload", "wait", "exec", "screenshot", "full-screenshot", "pdf", "download", "console", "network", "viewport", "geolocation"].contains(&cmd) {
                continue;
            }
            assert!(DRIVER.contains(&format!("case '{cmd}'")), "the driver answers {cmd}");
        }
        assert!(DRIVER.contains("case 'check-wait'"));
    }

    fn parsed(line: &str) -> Result<crate::cli::Parsed, Fail> {
        crate::cli::parse(&line.split(' ').map(str::to_string).collect::<Vec<_>>()).1.map(|p| p.expect("not help"))
    }

    #[test]
    fn cli047_storage_area_words_keep_an_empty_value_and_reach_the_plain_commands() {
        let p = parsed("storage local set --key a --value=").unwrap();
        assert_eq!((p.command.as_str(), &p.args["area"], &p.args["key"], &p.args["value"]), ("browser.storage-local-set", &json!("local"), &json!("a"), &json!("")));
        assert_eq!(parsed("storage session get").unwrap().args["area"], "session");
        assert_eq!(parsed("storage session clear").unwrap().command, "browser.storage-session-clear");
        assert!(parsed("storage local set --key a").unwrap_err().message.contains("--value is required"));
        assert!(parsed("storage local set --key= --value=b").is_err());
        assert!(parsed("storage local clear --area session").is_err(), "the word names the area");
        assert_eq!(storage_word("browser.storage-local-clear"), Some(("local", "browser.storage-clear".to_string())));
        assert_eq!(storage_word("browser.storage-clear"), None);
        assert_eq!(storage_word("browser.storage-cloud-get"), None);
        assert_eq!(text("browser.storage-session-get", &json!({ "value": "v" })).unwrap(), "v");
    }

    #[test]
    fn cli047_cookie_flags_as_the_card_types_them_and_a_finite_expiry_from_zero() {
        let p = parsed("cookie set --name a --value b --domain d --path p --secure --httpOnly --sameSite Lax --expires 0").unwrap();
        assert_eq!((p.command.as_str(), &p.args["httpOnly"], &p.args["expires"]), ("browser.cookie-set", &json!(true), &json!("0")));
        for bad in ["-1", "inf", "NaN", "soon"] {
            assert!(check("browser.cookie-set", &flags(&[("name", "a"), ("value", ""), ("expires", bad)])).unwrap_err().message.contains("finite number from 0 up"), "{bad}");
        }
        assert!(check("browser.cookie-set", &flags(&[("name", "a"), ("value", ""), ("expires", "1700000000")])).is_ok());
        assert_eq!((expires_at(Some("0")), expires_at(Some("1700000000.9")), expires_at(None)), (None, Some(1_700_000_000), None));
        assert!(DRIVER.contains("if(Number(a.expires)>0)"));
        let a = json!({ "name": "sid", "value": "", "secure": true, "httpOnly": true, "sameSite": "Strict", "expires": "1700000000" });
        let e = engine_cookie(3, &a, "https://app.example.test/x").unwrap();
        assert_eq!((e.domain.as_str(), e.path.as_str(), e.value.as_str(), e.secure, e.http_only, e.expires), ("app.example.test", "/", "", true, true, Some(1_700_000_000)));
        assert_eq!(e.same_site, Some(tauri::webview::cookie::SameSite::Strict));
        assert_eq!(engine_cookie(3, &json!({ "name": "s", "value": "1", "domain": ".example.test" }), "https://app.example.test/").unwrap().domain, ".example.test");
        assert!(engine_cookie(3, &json!({ "name": "s", "value": "1", "domain": "other.test" }), "https://app.example.test/").unwrap_err().message.contains("is not the site of browser tab 3"));
        assert!(engine_cookie(3, &json!({ "name": "s", "value": "1", "domain": "ample.test" }), "https://app.example.test/").is_err());
        assert!(engine_cookie(3, &json!({ "name": "s", "value": "1" }), "about:blank").is_err());
    }

    #[test]
    fn cli046_cli047_sideways_scroll_empty_password_capture_formats_and_an_honest_wait_timeout() {
        assert!(check("browser.scroll", &flags(&[("direction", "right"), ("amount", "200")])).is_ok());
        assert!(DRIVER.contains("d==='left'?-n:d==='right'?n:0"));
        assert!(parsed("set credentials --user me --pass=").is_ok());
        assert_eq!(parsed("set credentials --user me").unwrap_err().message, "--pass is required");
        assert!(parsed("set credentials --user= --pass=x").is_err());
        assert!(check("browser.screenshot", &flags(&[("format", "jpeg")])).is_ok());
        assert!(check("browser.full-screenshot", &flags(&[("format", "gif")])).unwrap_err().message.contains("png|jpeg"));
        let f = timed_out(2, 20, &json!("https://a.test/"), Duration::from_millis(2000));
        assert_eq!((f.code, f.message.as_str()), ("timeout", "the condition did not hold within 2000 ms"));
        assert!(!f.message.contains("Kolux") && !f.message.contains("running"));
    }
}
