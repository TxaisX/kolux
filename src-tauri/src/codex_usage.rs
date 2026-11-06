//! Codex plan figures without opening a session (USAGE-022). Kolux first checks that a Codex
//! sign-in exists at all (the account's own Codex home, then `CODEX_HOME`, then `~/.codex`), and
//! launches nothing when there is none. Otherwise it starts Codex's background app server in a
//! hidden process that only reads (`initialize`, `account/read`, `account/rateLimits/read`), then
//! closes it, giving it time to exit cleanly before stopping it by force.
//!
//! The read order of the card also names Codex's own usage service (tried before the background
//! process) and the status screen in a hidden terminal (tried after it); both, and the two rules
//! that lean on the service (the 5-hour figure and the reset-credit count taken from it when the
//! process leaves them out), are task T-042-b in PLAN.md.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// One usage window: how much is used and when it resets (Unix seconds).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    pub window_mins: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsage {
    /// `ok`, `signed-out` (no sign-in anywhere, nothing launched), `sign-in-again` (the sign-in
    /// is no longer accepted), `api-key` (signed in with a key: no plan figures), `busy` (a read
    /// for this home is already running) or `error`.
    pub state: String,
    pub five_hour: Option<Window>,
    pub weekly: Option<Window>,
    /// Limit-reset credits still available.
    pub reset_credits: Option<i64>,
    pub plan: Option<String>,
    /// What went wrong, with file locations and secrets taken out.
    pub message: Option<String>,
}

impl CodexUsage {
    fn state(state: &str, message: Option<String>) -> CodexUsage {
        CodexUsage { state: state.into(), five_hour: None, weekly: None, reset_credits: None, plan: None, message }
    }
}

/// How the sign-in in a Codex home looks, without reading any secret out of it.
#[derive(Debug, PartialEq, Eq)]
pub enum SignIn {
    ChatGpt,
    ApiKey,
}

/// The Codex home whose sign-in counts: the account's own home first, then `CODEX_HOME`, then
/// `.codex` in the user's home (COMPAT USAGE-022). Only a home holding `auth.json` counts.
pub fn signed_in_home(account_home: Option<&Path>, codex_home_env: Option<&str>, user_home: Option<&Path>) -> Option<(PathBuf, SignIn)> {
    let mut homes: Vec<PathBuf> = Vec::new();
    if let Some(h) = account_home {
        homes.push(h.to_path_buf());
    }
    if let Some(h) = codex_home_env.map(str::trim).filter(|h| !h.is_empty()) {
        homes.push(PathBuf::from(h));
    }
    if let Some(h) = user_home {
        homes.push(h.join(".codex"));
    }
    homes.into_iter().find_map(|h| sign_in_kind(&h.join("auth.json")).map(|k| (h, k)))
}

pub fn sign_in_kind(auth: &Path) -> Option<SignIn> {
    let v: Value = serde_json::from_slice(&std::fs::read(auth).ok()?).ok()?;
    let present = |k: &str| v.get(k).is_some_and(|x| !x.is_null() && x.as_str() != Some(""));
    if present("tokens") {
        Some(SignIn::ChatGpt)
    } else if present("OPENAI_API_KEY") {
        Some(SignIn::ApiKey)
    } else {
        None
    }
}

/// A window of at most this many minutes is the short (5-hour) one; anything longer is weekly.
const SHORT_WINDOW_MAX_MINS: i64 = 24 * 60;

fn window(v: &Value) -> Option<Window> {
    let used = v.get("usedPercent")?.as_f64()?;
    Some(Window { used_percent: used, resets_at: v.get("resetsAt").and_then(Value::as_i64), window_mins: v.get("windowDurationMins").and_then(Value::as_i64) })
}

/// Turns an `account/rateLimits/read` result into the figures Kolux shows. Each window is
/// placed by its own length, so a weekly-only plan never shows its weekly limit in the 5-hour
/// place; each keeps its own reset time; rows for one particular model are ignored.
pub fn figures(result: &Value) -> CodexUsage {
    // The general Codex bucket: `rateLimitsByLimitId.codex` when given, else the single view;
    // a bucket tied to one model is never used.
    let general = |s: &&Value| s.get("normalModelSlug").is_none_or(Value::is_null);
    let snap = result
        .get("rateLimitsByLimitId")
        .and_then(|m| m.get("codex"))
        .filter(general)
        .or_else(|| result.get("rateLimits").filter(general))
        .cloned()
        .unwrap_or(Value::Null);
    let mut out = CodexUsage::state("ok", None);
    let mut slots: Vec<(Window, bool)> = Vec::new(); // (window, came as primary)
    for (key, primary) in [("primary", true), ("secondary", false)] {
        if let Some(w) = snap.get(key).and_then(window) {
            slots.push((w, primary));
        }
    }
    for (w, primary) in slots {
        let short = match w.window_mins {
            Some(m) => m <= SHORT_WINDOW_MAX_MINS,
            // No length given: Codex's convention, primary is the short window.
            None => primary,
        };
        let slot = if short { &mut out.five_hour } else { &mut out.weekly };
        if slot.is_none() {
            *slot = Some(w);
        }
    }
    out.plan = snap.get("planType").and_then(Value::as_str).map(str::to_string);
    out.reset_credits = result.get("rateLimitResetCredits").and_then(|c| c.get("availableCount")).and_then(Value::as_i64);
    out
}

/// Whether an error from Codex means the sign-in is no longer accepted.
pub fn needs_sign_in(message: &str) -> bool {
    let m = message.to_lowercase();
    ["authentication required", "sign in", "log in", "login", "refresh token", "refresh_token", "unauthorized", "401", "token expired", "expired token", "invalid_grant"]
        .iter()
        .any(|k| m.contains(k))
}

/// Takes file locations and anything that looks like a key or token out of a message.
pub fn scrub(message: &str, home: &Path) -> String {
    let mut out = message.replace(&home.display().to_string(), "<codex home>");
    if let Some(h) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let h = PathBuf::from(h).display().to_string();
        if !h.is_empty() {
            out = out.replace(&h, "~");
        }
    }
    out.split_whitespace()
        .map(|w| {
            let bare = w.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            let secretish = bare.starts_with("sk-") || bare.starts_with("eyJ") || (bare.len() >= 32 && bare.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
            let pathish = w.contains(":\\") || w.starts_with('/') && w.len() > 1;
            if secretish {
                "<secret>".to_string()
            } else if pathish {
                "<path>".to_string()
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The conversation with the app server over its output lines: the replies to requests 2
/// (`account/read`) and 3 (`account/rateLimits/read`) decide the figures.
pub fn conclude(account: Option<&Value>, limits: Option<&Value>, home: &Path) -> CodexUsage {
    if let Some(a) = account {
        if let Some(e) = a.get("error") {
            let msg = e.get("message").and_then(Value::as_str).unwrap_or("Codex refused the account read");
            return CodexUsage::state(if needs_sign_in(msg) { "sign-in-again" } else { "error" }, Some(scrub(msg, home)));
        }
        let r = a.get("result").cloned().unwrap_or(Value::Null);
        if r.get("account").is_none_or(Value::is_null) && r.get("requiresOpenaiAuth").and_then(Value::as_bool) == Some(true) {
            return CodexUsage::state("sign-in-again", Some("Codex says this sign-in is no longer valid; sign in again".into()));
        }
        if r.get("account").and_then(|x| x.get("type")).and_then(Value::as_str) == Some("apiKey") {
            return CodexUsage::state("api-key", None);
        }
    }
    match limits {
        None => CodexUsage::state("error", Some("Codex did not answer the usage read in time".into())),
        Some(l) => {
            if let Some(e) = l.get("error") {
                let msg = e.get("message").and_then(Value::as_str).unwrap_or("Codex refused the usage read");
                CodexUsage::state(if needs_sign_in(msg) { "sign-in-again" } else { "error" }, Some(scrub(msg, home)))
            } else {
                figures(l.get("result").unwrap_or(&Value::Null))
            }
        }
    }
}

/// Homes with a read in progress: at most one read per Codex home at a time.
static READING: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

struct Claim(PathBuf);
impl Claim {
    fn take(home: &Path) -> Option<Claim> {
        let mut g = READING.lock().ok()?;
        g.get_or_insert_with(HashSet::new).insert(home.to_path_buf()).then(|| Claim(home.to_path_buf()))
    }
}
impl Drop for Claim {
    fn drop(&mut self) {
        if let Ok(mut g) = READING.lock() {
            if let Some(s) = g.as_mut() {
                s.remove(&self.0);
            }
        }
    }
}

/// Time for the whole read, and for the server to close by itself once its input ends.
const READ_TIMEOUT: Duration = Duration::from_secs(20);
const CLOSE_GRACE: Duration = Duration::from_secs(3);

pub(crate) fn app_server(program: &Path, home: &Path) -> std::io::Result<Child> {
    let mut cmd = if program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat")) {
        let mut c = Command::new(crate::pty::system_program("cmd.exe")); // T-663
        c.arg("/d").arg("/c").arg(program);
        c
    } else {
        Command::new(program)
    };
    cmd.arg("app-server").env("CODEX_HOME", home).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: never a Codex window on screen
    }
    cmd.spawn()
}

/// Ends the server: input closed first, a grace period, then the whole process tree by force.
/// Gives back how it ended when it ended by itself.
pub(crate) fn finish(mut child: Child) -> Option<std::process::ExitStatus> {
    drop(child.stdin.take());
    let start = Instant::now();
    while start.elapsed() < CLOSE_GRACE {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new(crate::pty::system_program("taskkill.exe")).args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).output();
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

/// Reads the plan figures for one Codex home through the background app server.
pub fn read_with(program: &Path, home: &Path) -> CodexUsage {
    let Some(_claim) = Claim::take(home) else {
        return CodexUsage::state("busy", None);
    };
    let mut child = match app_server(program, home) {
        Ok(c) => c,
        Err(e) => return CodexUsage::state("error", Some(scrub(&format!("Codex could not be started: {e}"), home))),
    };
    let (tx, rx) = mpsc::channel::<Value>();
    let out = child.stdout.take();
    std::thread::spawn(move || {
        let Some(out) = out else { return };
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    let mut stdin = child.stdin.take();
    let mut send = |m: Value| {
        if let Some(s) = stdin.as_mut() {
            let _ = writeln!(s, "{m}");
            let _ = s.flush();
        }
    };
    send(json!({ "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "kolux-rs", "title": "Kolux", "version": env!("CARGO_PKG_VERSION") } } }));
    let deadline = Instant::now() + READ_TIMEOUT;
    let (mut account, mut limits) = (None, None);
    let mut started = false;
    while limits.is_none() {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(msg) = rx.recv_timeout(left) else { break };
        match msg.get("id").and_then(Value::as_i64) {
            Some(1) if !started => {
                started = true;
                send(json!({ "method": "initialized" }));
                send(json!({ "id": 2, "method": "account/read", "params": { "refreshToken": false } }));
                send(json!({ "id": 3, "method": "account/rateLimits/read" }));
            }
            Some(2) => account = Some(msg),
            Some(3) => limits = Some(msg),
            _ => {}
        }
    }
    child.stdin = stdin;
    let ended = finish(child);
    // SET-030: a helper that quit without a word (Codex refusing how it was started) is an error,
    // never a sign-in problem.
    if let (None, None, Some(status)) = (&account, &limits, ended.filter(|s| !s.success())) {
        return CodexUsage::state("error", Some(format!("Codex's usage helper quit before answering ({status}); this Codex version may not accept how Kolux starts it")));
    }
    conclude(account.as_ref(), limits.as_ref(), home)
}

/// Codex plan figures for the signed-in home (`account_home` is a managed account's own home).
pub fn read(account_home: Option<&Path>) -> CodexUsage {
    let env = std::env::var("CODEX_HOME").ok();
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let Some((home, kind)) = signed_in_home(account_home, env.as_deref(), user.as_deref()) else {
        return CodexUsage::state("signed-out", None);
    };
    if kind == SignIn::ApiKey {
        return CodexUsage::state("api-key", None);
    }
    let Some(program) = crate::agents::find_program("codex") else {
        return CodexUsage::state("error", Some("Codex is not installed".into()));
    };
    read_with(&program, &home)
}

/// T-548-b: the plan figures of ONE managed account's own Codex home, never falling back to
/// another sign-in (the fall-back in `read` would show the system default's figures under the
/// account's name). `program` is `None` when Codex is not installed.
// Live once evidence/accounts-T-548-b-lib.rs.patch registers codex_usage_of (shared lib.rs).
#[allow(dead_code)]
pub fn read_account(home: &Path, program: Option<&Path>) -> CodexUsage {
    match sign_in_kind(&home.join("auth.json")) {
        None => CodexUsage::state("signed-out", None),
        Some(SignIn::ApiKey) => CodexUsage::state("api-key", None),
        Some(SignIn::ChatGpt) => match program {
            Some(p) => read_with(p, home),
            None => CodexUsage::state("error", Some("Codex is not installed".into())),
        },
    }
}

/// ACCT-012: a sign-in error from a managed account's own sign-in flags that account; the
/// system default's never does (when the account home holds no sign-in, it was not read).
fn flag_sign_in(app: &tauri::AppHandle, account: &crate::codex_accounts::Account, usage: &CodexUsage) {
    use tauri::{Emitter, Manager};
    if sign_in_kind(&Path::new(&account.home).join("auth.json")).is_none() {
        return;
    }
    let error = match usage.state.as_str() {
        "sign-in-again" => Some(true),
        "ok" => Some(false),
        _ => None,
    };
    let store = app.state::<Mutex<crate::state::Store>>();
    let changed = error.and_then(|e| store.lock().ok().and_then(|s| crate::codex_accounts::mark_sign_in_error(&s, &account.id, e).ok())).unwrap_or(false);
    if changed {
        let _ = app.emit(crate::codex_accounts::EVENT, ());
    }
}

#[tauri::command]
pub async fn codex_usage(app: tauri::AppHandle) -> Result<CodexUsage, String> {
    use tauri::Manager;
    // ACCT-007: the active managed Codex account's home is read first.
    let account = app.state::<Mutex<crate::state::Store>>().lock().ok().and_then(|s| crate::codex_accounts::active_account(&s));
    let home = account.as_ref().map(|a| PathBuf::from(&a.home));
    let usage = tauri::async_runtime::spawn_blocking(move || read(home.as_deref())).await.map_err(|e| e.to_string())?;
    if let Some(a) = &account {
        flag_sign_in(&app, a, &usage);
    }
    Ok(usage)
}

/// T-548-b: the plan figures of one account, for a pane that runs on an account other than the
/// active one. `account` is a managed account's id; `None` is the system default sign-in
/// (`CODEX_HOME`, then `~/.codex`). An id that is no longer listed reads as signed out.
// Live once evidence/accounts-T-548-b-lib.rs.patch registers codex_usage_of (shared lib.rs).
#[allow(dead_code)]
#[tauri::command]
pub async fn codex_usage_of(app: tauri::AppHandle, account: Option<String>) -> Result<CodexUsage, String> {
    use tauri::Manager;
    let Some(id) = account else {
        return tauri::async_runtime::spawn_blocking(|| read(None)).await.map_err(|e| e.to_string());
    };
    let listed = app.state::<Mutex<crate::state::Store>>().lock().ok().map(|s| crate::codex_accounts::load(&s)).unwrap_or_default();
    let Some(entry) = listed.into_iter().find(|a| a.id == id) else {
        return Ok(CodexUsage::state("signed-out", None));
    };
    let home = PathBuf::from(&entry.home);
    let usage = tauri::async_runtime::spawn_blocking(move || read_account(&home, crate::agents::find_program("codex").as_deref())).await.map_err(|e| e.to_string())?;
    flag_sign_in(&app, &entry, &usage);
    Ok(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from(r"C:\Users\someone\.codex")
    }

    #[test]
    fn sign_in_is_looked_for_in_the_account_home_then_codex_home_then_the_default() {
        let root = std::env::temp_dir().join(format!("kolux-rs-codexhome-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (acct, env, user) = (root.join("acct"), root.join("env"), root.join("user"));
        for d in [&acct, &env, &user.join(".codex")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let env_s = env.display().to_string();
        // nothing signed in anywhere: no home, so nothing is launched
        assert_eq!(signed_in_home(Some(&acct), Some(&env_s), Some(&user)), None);
        std::fs::write(user.join(".codex").join("auth.json"), r#"{"tokens":{"x":1}}"#).unwrap();
        assert_eq!(signed_in_home(Some(&acct), Some(&env_s), Some(&user)).unwrap().0, user.join(".codex"));
        std::fs::write(env.join("auth.json"), r#"{"OPENAI_API_KEY":"k","tokens":null}"#).unwrap();
        assert_eq!(signed_in_home(Some(&acct), Some(&env_s), Some(&user)), Some((env.clone(), SignIn::ApiKey)));
        // a blank CODEX_HOME is ignored
        assert_eq!(signed_in_home(None, Some("  "), Some(&user)).unwrap().0, user.join(".codex"));
        std::fs::write(acct.join("auth.json"), r#"{"tokens":{"x":1}}"#).unwrap();
        assert_eq!(signed_in_home(Some(&acct), Some(&env_s), Some(&user)), Some((acct.clone(), SignIn::ChatGpt)));
        // an auth file with neither tokens nor a key is not a sign-in
        std::fs::write(acct.join("auth.json"), r#"{"tokens":null,"OPENAI_API_KEY":null}"#).unwrap();
        assert_eq!(signed_in_home(Some(&acct), None, None), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    // T-548-b: one account's own read never borrows another sign-in.
    #[test]
    fn an_accounts_own_read_never_falls_back_to_another_sign_in() {
        let root = std::env::temp_dir().join(format!("kolux-rs-codexacct-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (empty, key, chat) = (root.join("empty"), root.join("key"), root.join("chat"));
        for d in [&empty, &key, &chat] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(key.join("auth.json"), r#"{"OPENAI_API_KEY":"k","tokens":null}"#).unwrap();
        std::fs::write(chat.join("auth.json"), r#"{"tokens":{"x":1}}"#).unwrap();
        let quitter = root.join("codex.cmd");
        std::fs::write(&quitter, "@exit /b 2\r\n").unwrap();
        // no sign-in in the account's home: signed out, and nothing is launched (no program needed)
        assert_eq!(read_account(&empty, Some(&quitter)).state, "signed-out");
        assert_eq!(read_account(&root.join("gone"), None).state, "signed-out");
        // a key sign-in has no plan figures
        assert_eq!(read_account(&key, Some(&quitter)).state, "api-key");
        // a ChatGPT sign-in with Codex missing is an error; with Codex present it reads that home
        let missing = read_account(&chat, None);
        assert_eq!((missing.state.as_str(), missing.message.as_deref()), ("error", Some("Codex is not installed")));
        let ran = read_account(&chat, Some(&quitter));
        assert!(ran.message.as_deref().unwrap_or("").contains("quit before answering"), "{:?}", ran.message);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_weekly_only_plan_never_shows_in_the_five_hour_place() {
        let r = json!({ "rateLimits": { "primary": { "usedPercent": 37, "windowDurationMins": 10080, "resetsAt": 1_800_000_000 }, "secondary": null, "planType": "plus" } });
        let u = figures(&r);
        assert_eq!(u.five_hour, None);
        assert_eq!(u.weekly, Some(Window { used_percent: 37.0, resets_at: Some(1_800_000_000), window_mins: Some(10080) }));
        assert_eq!(u.plan.as_deref(), Some("plus"));
    }

    #[test]
    fn both_windows_keep_their_own_reset_times_and_model_rows_are_ignored() {
        let r = json!({
            "rateLimits": { "primary": { "usedPercent": 1, "windowDurationMins": 300 }, "normalModelSlug": null },
            "rateLimitsByLimitId": {
                "codex": { "primary": { "usedPercent": 12, "windowDurationMins": 300, "resetsAt": 100 }, "secondary": { "usedPercent": 40, "windowDurationMins": 10080, "resetsAt": 900 } },
                "codex_bengalfox": { "secondary": { "usedPercent": 99, "windowDurationMins": 10080, "resetsAt": 5 }, "normalModelSlug": "gpt-5.3-codex-spark" }
            },
            "rateLimitResetCredits": { "availableCount": 2, "credits": null }
        });
        let u = figures(&r);
        assert_eq!(u.five_hour.as_ref().map(|w| (w.used_percent, w.resets_at)), Some((12.0, Some(100))));
        assert_eq!(u.weekly.as_ref().map(|w| (w.used_percent, w.resets_at)), Some((40.0, Some(900))));
        assert_eq!(u.reset_credits, Some(2));
        // a single view tied to one model is not used either
        let only_model = json!({ "rateLimits": { "secondary": { "usedPercent": 99, "windowDurationMins": 10080 }, "normalModelSlug": "m" } });
        assert_eq!(figures(&only_model).weekly, None);
        // no lengths given: primary is the short one, secondary the weekly one
        let bare = json!({ "rateLimits": { "primary": { "usedPercent": 5 }, "secondary": { "usedPercent": 6 } } });
        let b = figures(&bare);
        assert_eq!((b.five_hour.unwrap().used_percent, b.weekly.unwrap().used_percent), (5.0, 6.0));
    }

    #[test]
    fn a_refused_sign_in_ends_the_read_with_sign_in_again_and_no_figures() {
        // what Codex 0.156 answers with no valid sign-in (seen live with an empty CODEX_HOME)
        let account = json!({ "id": 2, "result": { "account": null, "requiresOpenaiAuth": true } });
        let limits = json!({ "error": { "code": -32600, "message": "codex account authentication required to read rate limits" }, "id": 3 });
        let u = conclude(Some(&account), Some(&limits), &home());
        assert_eq!((u.state.as_str(), u.five_hour.is_none(), u.weekly.is_none()), ("sign-in-again", true, true));
        // a dead refresh token reported on the usage read
        let dead = json!({ "id": 3, "error": { "message": "Your refresh token has already been used to generate a new access token" } });
        let ok_account = json!({ "id": 2, "result": { "account": { "type": "chatgpt", "email": "e", "planType": "plus" } } });
        assert_eq!(conclude(Some(&ok_account), Some(&dead), &home()).state, "sign-in-again");
        // any other failure is an error, with the location and key text taken out
        let other = json!({ "id": 3, "error": { "message": r"could not read C:\Users\someone\.codex\cache.json near sk-abc123" } });
        let e = conclude(Some(&ok_account), Some(&other), &home());
        assert_eq!(e.state, "error");
        let m = e.message.unwrap();
        assert!(!m.contains("someone") && !m.contains("sk-abc123"), "{m}");
        assert_eq!(conclude(Some(&ok_account), None, &home()).state, "error");
    }

    #[test]
    #[cfg(windows)]
    fn a_helper_that_quits_at_once_is_an_error_and_not_a_sign_in_problem() {
        let dir = std::env::temp_dir().join(format!("kolux-codex-quit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let program = dir.join("codex.cmd");
        std::fs::write(&program, "@exit /b 2\r\n").unwrap();
        let u = read_with(&program, &dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(u.state, "error");
        assert!(u.message.as_deref().unwrap_or("").contains("quit before answering"), "{:?}", u.message);
    }

    #[test]
    fn one_read_per_codex_home_at_a_time() {
        let h = PathBuf::from(r"C:\x\.codex");
        let first = Claim::take(&h).unwrap();
        assert!(Claim::take(&h).is_none());
        assert!(Claim::take(Path::new(r"C:\y\.codex")).is_some());
        drop(first);
        assert!(Claim::take(&h).is_some());
    }
}
