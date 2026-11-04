//! ACCT-007: Codex connects with a ChatGPT sign-in or a device code.
//!
//! Every Codex account Kolux adds lives in a private Codex home of its own
//! (`<profile>\codex-accounts\<id>`). Kolux runs Codex's own `codex login` (browser) or
//! `codex login --device-auth` (a link and a one-time code to enter on any device) hidden, with
//! `CODEX_HOME` pointing at that home, so the user's usual Codex folder is never touched. The home
//! holds a `config.toml` that keeps the sign-in in the home's own `auth.json` (Codex's file
//! store), and Kolux keeps a sealed copy in the vault (`<profile>\vault\codex-<id>.json`, ACCT-009).
//! A login that fails is rolled back, but a home that already holds a working sign-in is never
//! deleted. The newly connected account becomes the active one: new Codex panes and the usage pill
//! run on it. Without a managed account, Codex's own system-default login is reported as it is.
//! T-138 (ACCT-019, ACCT-020): the list shows the system default first, then each account; any
//! row can be made active, an account can be removed (its sign-in goes, retried while Windows still
//! holds it, and its home with the settings and sessions stays), and the user's own Codex folder is
//! only ever read, never mirrored or written.

use crate::claude_key::{run_hidden, Attention, Ended};
use crate::codex_usage::{sign_in_kind, SignIn};
use crate::{secrets, state::Store};
use base64::Engine;
use portable_pty::CommandBuilder;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const LIST_KEY: &str = "codexAccounts";
pub const ACTIVE_KEY: &str = "codexActiveAccount";
pub const HOME_ENV: &str = "CODEX_HOME";
pub const FOLDER: &str = "codex-accounts";
pub const EVENT: &str = "codex-accounts";
pub const LOGIN_LIMIT: Duration = Duration::from_secs(900);
/// Keeps the sign-in in the home's own `auth.json` rather than the system keyring.
pub const HOME_CONFIG: &str = "cli_auth_credentials_store = \"file\"\n";

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// The ChatGPT account's email, when the sign-in names it.
    pub email: Option<String>,
    /// The account's private Codex home: where it runs.
    pub home: String,
    pub last_sign_in: i64,
    /// ACCT-012: Codex answered with a sign-in error for this account; Sign in again clears it.
    #[serde(default)]
    pub sign_in_error: bool,
    /// ACCT-019 (T-138-b): the user's own name for the account, so a personal and a business
    /// workspace on one email can be told apart. Kolux does not guess the kind: OpenAI does not
    /// document where a sign-in says it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

pub const LABEL_MAX: usize = 40;

/// Names an account (trimmed, at most LABEL_MAX characters); a blank name clears it.
pub fn set_label(store: &Store, id: &str, label: &str) -> Result<(), String> {
    let mut list: Vec<Account> = crate::orchestration::kept::load(store, LIST_KEY)?;
    let Some(a) = list.iter_mut().find(|a| a.id == id) else {
        return Err("That Codex account is no longer listed.".into());
    };
    let name: String = label.trim().chars().take(LABEL_MAX).collect();
    a.label = Some(name.trim_end().to_string()).filter(|n| !n.is_empty());
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn codex_account_label(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: String, label: String) -> Result<(), String> {
    set_label(&*store.lock().map_err(|e| e.to_string())?, &id, &label)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

pub fn load(store: &Store) -> Vec<Account> {
    crate::claude_accounts::load_kept(store, LIST_KEY)
}

/// The active account, if it is still listed and its home is on disk.
pub fn active_account(store: &Store) -> Option<Account> {
    let id = store.get(ACTIVE_KEY).ok().flatten()?;
    load(store).into_iter().find(|a| a.id == id).filter(|a| PathBuf::from(&a.home).is_dir())
}

/// Flags or clears an account's sign-in error (ACCT-012); true when that changed anything.
pub fn mark_sign_in_error(store: &Store, id: &str, error: bool) -> Result<bool, String> {
    let mut list: Vec<Account> = crate::orchestration::kept::load(store, LIST_KEY)?;
    let Some(a) = list.iter_mut().find(|a| a.id == id && a.sign_in_error != error) else {
        return Ok(false);
    };
    a.sign_in_error = error;
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(true)
}

/// T-139-d (ACCT-023, ACCT-012): a pane on managed account `id` printed Codex's sign-in error.
/// Only a listed account whose own home holds a sign-in is flagged (never the system default,
/// which is not listed, nor an account Kolux cannot read); true when that changed anything.
pub fn flag_printed(store: &Store, id: &str) -> Result<bool, String> {
    let Some(a) = load(store).into_iter().find(|a| a.id == id) else {
        return Ok(false);
    };
    if sign_in_kind(&Path::new(&a.home).join("auth.json")).is_none() {
        return Ok(false);
    }
    mark_sign_in_error(store, id, true)
}

#[tauri::command]
pub fn codex_account_sign_in_printed(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: String) -> Result<bool, String> {
    let changed = flag_printed(&*store.lock().map_err(|e| e.to_string())?, &id)?;
    if changed {
        let _ = app.emit(EVENT, ());
    }
    Ok(changed)
}

/// ACCT-025: each listed account's live sign-in file and its sealed copy in the vault.
pub fn sign_in_files(store: &Store, profile: &Path) -> Vec<(PathBuf, PathBuf)> {
    load(store).into_iter().map(|a| (Path::new(&a.home).join("auth.json"), profile.join(secrets::VAULT).join(format!("codex-{}.json", a.id)))).collect()
}

/// The active account's home, if it is still listed and on disk.
pub fn active_home(store: &Store) -> Option<String> {
    active_account(store).map(|a| a.home)
}

/// ACCT-024: how long a new Codex pane waits for the chosen account's sign-in to be in place.
pub const SIGN_IN_WAIT: Duration = Duration::from_secs(2);

/// ACCT-024: the Codex home a new pane runs in. `active` reads the chosen account's home and is
/// asked again every `step`, so an account changed while the pane waits wins. No sign-in after
/// `wait`: the system-default login (`None`), or, when the choice changed and the new one has no
/// sign-in either, an error asking the user to open the pane again.
pub fn ready_home(active: impl FnMut() -> Option<String>, signed_in: impl Fn(&str) -> bool, wait: Duration, step: Duration) -> Result<Option<String>, String> {
    let started = std::time::Instant::now();
    ready_home_by(active, signed_in, || started.elapsed() >= wait, || std::thread::sleep(step))
}

/// ACCT-024 (FIX-4): `ready_home` with its clock and its pause handed in, so a test counts polls
/// instead of watching the wall clock (a loaded machine slowed the timed version into a false fail).
/// `out_of_time` says the wait is over; `pause` waits one step.
fn ready_home_by(mut active: impl FnMut() -> Option<String>, signed_in: impl Fn(&str) -> bool, mut out_of_time: impl FnMut() -> bool, mut pause: impl FnMut()) -> Result<Option<String>, String> {
    let first = active();
    let mut home = first.clone();
    loop {
        match home.as_deref() {
            None => return Ok(None),
            Some(h) if signed_in(h) => return Ok(home),
            _ if out_of_time() => break,
            _ => pause(),
        }
        home = active();
    }
    if home == first {
        Ok(None)
    } else {
        Err("The Codex account changed while this pane was starting, and the new one is not signed in yet. Open it again.".into())
    }
}

/// ACCT-023: the home a resumed pane runs on. `None` when its account is no longer listed (the
/// pane is stale, never moved to another account), `Some(None)` while the home is not on disk yet.
pub fn resume_home(accounts: &[Account], id: &str) -> Option<Option<String>> {
    let a = accounts.iter().find(|a| a.id == id)?;
    Some(PathBuf::from(&a.home).is_dir().then(|| a.home.clone()))
}

/// ACCT-023: waits about two seconds for the resumed account's home, then gives up with a
/// try-again message rather than carrying on as another account.
pub fn wait_home(store: &Mutex<Store>, id: &str) -> Result<String, String> {
    for _ in 0..20 {
        let listed = store.lock().map(|s| resume_home(&load(&s), id)).map_err(|e| e.to_string())?;
        match listed {
            None => return Err("The Codex account this session ran on is no longer listed, so it was not resumed on another one. Pick an account in Settings and start it again.".into()),
            Some(Some(home)) => return Ok(home),
            Some(None) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    Err("That account's Codex sign-in is not in place yet; try again in a moment.".into())
}

/// The variable a new pane gets: only a Codex pane, only with an active account.
pub fn pane_env(program: Option<&str>, home: Option<String>) -> Option<(&'static str, String)> {
    if crate::tools::credited_program(program?) != Some("codex") {
        return None;
    }
    home.map(|h| (HOME_ENV, h))
}

/// How plain Codex is signed in (ACCT-007): ChatGPT, an API key, an API key with a custom
/// provider, or signed out. Looks in `CODEX_HOME`, then `.codex` in the user's home.
pub fn system_default(codex_home_env: Option<&str>, user_home: Option<&Path>) -> &'static str {
    let home = codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")));
    let Some(home) = home else { return "signed-out" };
    match sign_in_kind(&home.join("auth.json")) {
        Some(SignIn::ChatGpt) => "chatgpt",
        Some(SignIn::ApiKey) => "api-key",
        None if custom_provider(&fs::read_to_string(home.join("config.toml")).unwrap_or_default()) => "custom-provider",
        None => "signed-out",
    }
}

/// A top-level `model_provider` other than OpenAI's: the key then comes from that provider's
/// own settings. ponytail: a line scan, not a TOML parser; only the top-level key counts.
/// A top-level `key = value` of a config.toml (before the first table), quotes and comment removed.
fn top_level(config: &str, key: &str) -> Option<String> {
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            return None;
        }
        if let Some(v) = line.strip_prefix(key).map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            return Some(v.split('#').next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'').to_string());
        }
    }
    None
}

fn custom_provider(config: &str) -> bool {
    top_level(config, "model_provider").is_some_and(|v| !v.is_empty() && v != "openai")
}

/// SET-030: an account home's config.toml no longer agrees with what Kolux wrote there: the
/// sign-in is not kept in the home's own file any more, or another model provider took over.
pub fn config_drift(home: &Path) -> bool {
    let config = fs::read_to_string(home.join("config.toml")).unwrap_or_default();
    top_level(&config, "cli_auth_credentials_store").as_deref() != Some("file") || custom_provider(&config)
}

/// The link and the one-time code of a device sign-in, only once both have been printed.
pub fn device_prompt(clean: &str) -> Option<(String, String)> {
    let words = || clean.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '/' && c != ':' && c != '-' && c != '.' && c != '_'));
    let link = words().find(|w| w.starts_with("https://"))?.trim_end_matches('.').to_string();
    let code = words().find(|w| {
        let parts: Vec<&str> = w.split('-').collect();
        parts.len() >= 2 && parts.iter().all(|p| p.len() >= 4 && p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()))
    })?;
    Some((link, code.to_string()))
}

/// The email in a ChatGPT sign-in's identity token, if it carries one.
/// ponytail: the token's claims are not published; `email` is the standard OpenID claim.
pub fn email(auth: &str) -> Option<String> {
    let v: Value = serde_json::from_str(auth).ok()?;
    let token = v.get("tokens")?.get("id_token")?.as_str()?;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email").and_then(Value::as_str).filter(|e| e.contains('@')).map(str::to_string)
}

/// Why a login gave Kolux no account, with links and the code kept out.
pub fn failure(ended: &Ended, output: &str, code: Option<&str>) -> Attention {
    let clean = |s: &str| {
        let s = crate::claude_accounts::scrub(s);
        match code {
            Some(c) if !c.is_empty() => s.replace(c, "[code removed]"),
            _ => s,
        }
    };
    match ended {
        Ended::Cancelled => Attention::new("cancelled", "Sign-in cancelled."),
        Ended::TimedOut => Attention::new("browser-blocked", "The Codex sign-in was not finished within 15 minutes."),
        Ended::NotStarted(e) => format!("Codex's sign-in could not start: {}", clean(e)).into(),
        // SET-030: Codex refusing the command line itself is no sign-in problem.
        Ended::Exited(_) if bad_arguments(output) => Attention::new("unknown", "This Codex version did not accept Kolux's sign-in command; update Codex and try again."),
        Ended::Exited(_) | Ended::Stopped => match output.lines().map(str::trim).rfind(|l| !l.is_empty()) {
            Some(last) => Attention::new("sign-in-refused", format!("Codex's sign-in ended without signing in: {}", clean(last))),
            None => Attention::new("sign-in-refused", "Codex's sign-in ended without signing in."),
        },
    }
}

/// Codex's command-line parser rejecting what it was given (its usual usage-error wording).
pub fn bad_arguments(output: &str) -> bool {
    let o = output.to_lowercase();
    ["unexpected argument", "unrecognized subcommand", "unrecognized option", "for more information, try '--help'"].iter().any(|k| o.contains(k))
}

/// The command a sign-in runs: `codex login` (or with `--device-auth`) inside `home`.
pub fn login_command(program: &Path, home: &Path, device: bool) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.arg("login");
    if device {
        cmd.arg("--device-auth");
    }
    cmd.env(HOME_ENV, home.as_os_str());
    cmd
}

/// One sign-in, into a fresh private home or again into a listed account's own (ACCT-012). On
/// success a new account is listed and made active, a listed one updated in place, and the
/// sign-in sealed into the vault; only a sign-in the login changed counts. On failure the home is
/// removed, unless it already holds a working sign-in.
pub fn sign_in(store: &Mutex<Store>, profile: &Path, id: &str, existing: bool, now: i64, login: impl FnOnce(&Path) -> (String, Ended, Option<String>)) -> Result<Account, Attention> {
    // Row 944: the id comes from the renderer and is joined into paths, so an unsafe one is refused before anything touches the disk.
    if !crate::cli_accounts::safe_id(id) {
        return Err(Attention::new("unknown", "That account id is not valid."));
    }
    // Row 923: a NEW account never reuses a taken id, so a clash cannot overwrite a listed account's home or sealed copy.
    // Row 929: `existing` at an id that is not listed (a stale screen) is a new account too, so it claims a free id.
    // Row 932: a list that cannot be read fails here, before the login; it never routes a listed account to a new id.
    let listed_ids: Vec<String> = crate::orchestration::kept::load::<Vec<Account>>(&*store.lock().map_err(|e| e.to_string())?, LIST_KEY)?.into_iter().map(|a| a.id).collect();
    // Row 940: an unlisted id whose home is there (a list set aside as corrupt leaves the homes) is still that sign-in; a removed account keeps its home too (only its sign-in goes), so a stale screen lands in that home again.
    let (id, home) = if existing && (listed_ids.iter().any(|l| l == id) || profile.join(FOLDER).join(id).is_dir()) {
        let home = profile.join(FOLDER).join(id);
        fs::create_dir_all(&home).map_err(|e| e.to_string())?;
        (id.to_string(), home)
    } else {
        crate::claude_accounts::claim_new_folder(profile, FOLDER, "codex", &listed_ids, id)?
    };
    let id = id.as_str();
    let auth = home.join("auth.json");
    fs::write(home.join("config.toml"), HOME_CONFIG).map_err(|e| e.to_string())?;
    // ACCT-019: only a home with no sign-in file at all is removed; one that cannot be read (a
    // locked file) may still hold a working sign-in.
    let roll_back = || {
        if matches!(auth.try_exists(), Ok(false)) {
            let _ = fs::remove_dir_all(&home);
        }
    };
    let before = fs::read_to_string(&auth).ok();
    let (output, ended, code) = login(&home);
    let signed_in = matches!(ended, Ended::Exited(_)) && sign_in_kind(&auth) == Some(SignIn::ChatGpt) && fs::read_to_string(&auth).ok() != before;
    if !signed_in {
        roll_back();
        return Err(failure(&ended, &output, code.as_deref()));
    }
    let text = fs::read_to_string(&auth).map_err(|e| e.to_string())?;
    let vault = profile.join(secrets::VAULT).join(format!("codex-{id}.json"));
    let vault_was_there = !matches!(vault.try_exists(), Ok(false));
    if let Err(e) = secrets::write_file(&vault, &text) {
        return Err(format!("The sign-in could not be stored: {e}").into());
    }
    let account = Account { id: id.into(), email: email(&text), home: home.to_string_lossy().into_owned(), last_sign_in: now, sign_in_error: false, label: None };
    let store = store.lock().map_err(|e| e.to_string())?;
    // Row 916: the home stays (ACCT-019), but a sealed copy made for an account that never got listed is deleted.
    let drop_new_copy = || {
        if !vault_was_there {
            crate::claude_accounts::remove_sealed_copy(&vault);
        }
    };
    let mut list: Vec<Account> = match crate::orchestration::kept::load(&store, LIST_KEY) {
        Ok(l) => l,
        Err(e) => {
            drop_new_copy();
            return Err(e.into());
        }
    };
    let listed = list.iter().any(|a| a.id == id);
    match list.iter_mut().find(|a| a.id == id) {
        Some(a) => *a = Account { label: a.label.take(), ..account.clone() },
        None => list.push(account.clone()),
    }
    // A new account is listed and made active in one transaction, so a refused save leaves neither.
    let saved = serde_json::to_string(&list).map_err(|e| e.to_string()).and_then(|json| {
        if listed { store.set(LIST_KEY, &json) } else { store.set_all(&[(LIST_KEY, &json), (ACTIVE_KEY, id)]) }.map_err(|e| e.to_string())
    });
    if let Err(e) = saved {
        if !listed {
            drop_new_copy();
        }
        return Err(e.into());
    }
    Ok(account)
}

#[derive(Default)]
pub struct SignIns {
    /// "browser" or "device" while a sign-in runs.
    running: Mutex<Option<String>>,
    /// ACCT-019: when each account's sign-in file was first seen missing.
    missing_since: Mutex<std::collections::HashMap<String, std::time::Instant>>,
    in_browser: AtomicBool,
    device: Mutex<Option<(String, String)>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexView {
    pub accounts: Vec<Account>,
    pub active: Option<String>,
    /// `chatgpt`, `api-key`, `custom-provider` or `signed-out`: plain Codex's own login.
    pub system_default: String,
    pub signing_in: Option<String>,
    pub in_browser: bool,
    pub device_link: Option<String>,
    pub device_code: Option<String>,
    pub attention: Option<Attention>,
    /// Ids of accounts whose home's config.toml has drifted (SET-030).
    pub drifted: Vec<String>,
    /// ACCT-019: accounts whose sign-in file has been gone for longer than the grace period.
    pub missing: Vec<String>,
    /// ACCT-021: why the user's Codex settings cannot be copied into the accounts, if they cannot.
    pub settings_warning: Option<String>,
}

#[tauri::command]
pub fn codex_accounts(store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>) -> Result<CodexView, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let env = std::env::var(HOME_ENV).ok();
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let device = sign_ins.device.lock().ok().and_then(|d| d.clone());
    let accounts = load(&store);
    let active = store.get(ACTIVE_KEY).ok().flatten().filter(|id| accounts.iter().any(|a| &a.id == id));
    let drifted = accounts.iter().filter(|a| config_drift(Path::new(&a.home))).map(|a| a.id.clone()).collect();
    let missing = match sign_ins.missing_since.lock() {
        Ok(mut seen) => accounts.iter().filter(|a| missing_now(&mut seen, &a.id, Path::new(&a.home).join("auth.json").exists(), std::time::Instant::now())).map(|a| a.id.clone()).collect(),
        Err(_) => Vec::new(),
    };
    let settings_warning = user_dir(env.as_deref(), user.as_deref()).and_then(|u| settings_problem(&u));
    Ok(CodexView {
        settings_warning,
        drifted,
        missing,
        accounts,
        active,
        system_default: system_default(env.as_deref(), user.as_deref()).into(),
        signing_in: sign_ins.running.lock().ok().and_then(|r| r.clone()),
        in_browser: sign_ins.in_browser.load(Ordering::SeqCst),
        device_link: device.as_ref().map(|d| d.0.clone()),
        device_code: device.map(|d| d.1),
        attention: sign_ins.attention.lock().ok().and_then(|a| a.clone()),
    })
}

/// Connect (browser) or Sign in with a code (`device` = true): adds a Codex account, or signs
/// the listed account `again` in once more (ACCT-012).
#[tauri::command]
pub fn codex_account_sign_in(app: AppHandle, sign_ins: tauri::State<'_, SignIns>, device: bool, again: Option<String>) -> Result<(), String> {
    if again.is_none() {
        let env = std::env::var(HOME_ENV).ok();
        let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
        if user_custom_provider(env.as_deref(), user.as_deref()) {
            return Err(CUSTOM_PROVIDER_REFUSAL.into());
        }
    }
    {
        let mut running = sign_ins.running.lock().map_err(|e| e.to_string())?;
        if running.is_some() {
            return Err("A Codex sign-in is already in progress; finish it or cancel it first.".into());
        }
        *running = Some(if device { "device" } else { "browser" }.into());
    }
    let finish = |app: &AppHandle, attention: Option<Attention>| {
        let s = app.state::<SignIns>();
        if let Ok(mut g) = s.attention.lock() {
            *g = attention;
        }
        s.in_browser.store(false, Ordering::SeqCst);
        if let Ok(mut g) = s.device.lock() {
            *g = None;
        }
        if let Ok(mut g) = s.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
    };
    let program = match crate::agents::find_program("codex") {
        Some(p) if !crate::claude_key::is_wrapper(&p) => p,
        Some(_) => {
            finish(&app, Some(Attention::new("install-unavailable", "The installed Codex launcher is a script wrapper Kolux cannot start directly. Install Codex's native build and try again.")));
            return Ok(());
        }
        None => {
            finish(&app, Some(Attention::new("not-found", "Codex is not installed, so there is nothing to sign in with.")));
            return Ok(());
        }
    };
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = sign_ins.cancel.lock() {
        *c = Some(cancel.clone());
    }
    if let Ok(mut g) = sign_ins.attention.lock() {
        *g = None;
    }
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let store = app.state::<Mutex<Store>>();
        let existing = again.is_some();
        let id = again.unwrap_or_else(|| format!("{:x}", crate::claude_key::now_ms()));
        let result = sign_in(&store, &profile, &id, existing, crate::claude_key::now_ms(), |home| {
            let seen: Arc<Mutex<Option<(String, String)>>> = Arc::default();
            let peek = seen.clone();
            let peek_app = app.clone();
            let browser_app = app.clone();
            let (out, ended) = run_hidden(
                login_command(&program, home, device),
                LOGIN_LIMIT,
                cancel,
                move || {
                    if !device {
                        browser_app.state::<SignIns>().in_browser.store(true, Ordering::SeqCst);
                        let _ = browser_app.emit(EVENT, ());
                    }
                },
                move |clean| {
                    // The device view waits until both the link and the code are known.
                    if device {
                        if let Some(found) = device_prompt(clean) {
                            let mut s = peek.lock().unwrap_or_else(|p| p.into_inner());
                            if s.as_ref() != Some(&found) {
                                *s = Some(found.clone());
                                if let Ok(mut g) = peek_app.state::<SignIns>().device.lock() {
                                    *g = Some(found);
                                }
                                let _ = peek_app.emit(EVENT, ());
                            }
                        }
                    }
                    false
                },
            );
            let code = seen.lock().ok().and_then(|s| s.as_ref().map(|d| d.1.clone()));
            (out, ended, code)
        });
        finish(&app, result.err().filter(|e| e.reason != "cancelled"));
    });
    Ok(())
}

#[tauri::command]
pub fn codex_account_cancel(app: AppHandle, sign_ins: tauri::State<'_, SignIns>) {
    // ACCT-002: with nothing running, Cancel wipes a leftover needs-attention state.
    let running = sign_ins.running.lock().map(|r| r.is_some()).unwrap_or(false);
    match sign_ins.cancel.lock().ok().and_then(|c| c.clone()) {
        Some(flag) if running => flag.store(true, Ordering::SeqCst),
        _ => {
            if let Ok(mut g) = sign_ins.attention.lock() {
                *g = None;
            }
            let _ = app.emit(EVENT, ());
        }
    }
}

/// ACCT-019: a sign-in file missing for a moment (Codex rewriting it) is not yet a warning.
pub const MISSING_GRACE: Duration = Duration::from_secs(30);
pub fn missing_now(seen: &mut std::collections::HashMap<String, std::time::Instant>, id: &str, present: bool, now: std::time::Instant) -> bool {
    if present {
        seen.remove(id);
        return false;
    }
    now.duration_since(*seen.entry(id.into()).or_insert(now)) >= MISSING_GRACE
}

pub const CUSTOM_PROVIDER_REFUSAL: &str = "Your Codex settings send Codex to a custom model provider, so a ChatGPT account cannot be added. Stay on the system default, or switch Codex's model_provider back to OpenAI first. Your settings were not changed.";

/// The user's own Codex settings (CODEX_HOME, else .codex in the user's home) name a custom
/// model provider. Read only.
pub fn user_custom_provider(codex_home_env: Option<&str>, user_home: Option<&Path>) -> bool {
    let home = codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")));
    home.is_some_and(|h| custom_provider(&fs::read_to_string(h.join("config.toml")).unwrap_or_default()))
}

/// ACCT-021: the user's own Codex settings folder: CODEX_HOME, else .codex in the user's home.
pub fn user_dir(codex_home_env: Option<&str>, user_home: Option<&Path>) -> Option<PathBuf> {
    codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")))
}

/// ACCT-021: the user's Codex settings, or the plain reason they cannot be copied.
fn user_settings(user: &Path) -> Result<toml_edit::DocumentMut, String> {
    let text = match fs::read_to_string(user.join("config.toml")) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("Codex has no settings file (config.toml) yet, so the accounts run on Codex's defaults.".into()),
        Err(e) => return Err(format!("Codex's settings file could not be read (antivirus or another program may have it locked), so the accounts keep the settings they had: {e}")),
    };
    if text.trim().is_empty() {
        return Err("Codex's settings file is empty, so the accounts run on Codex's defaults.".into());
    }
    text.parse().map_err(|_| "Codex's settings file is not valid TOML, so the accounts keep the settings they had.".to_string())
}

/// ACCT-021: where an older release kept its one shared Codex home (the old app's roaming folder).
pub fn legacy_home(roaming: Option<&Path>) -> Option<PathBuf> {
    roaming.map(|r| r.join("kolux").join("codex-runtime-home"))
}

/// ACCT-021: the settings the accounts are given. The user's own come first; only when those are
/// missing or empty, the shared settings an older release left are read instead (read only, without
/// its hook entries or notify command, which belonged to that release's own hooks).
/// ponytail: only the older home's settings file is read; its sign-in and sessions are ACCT-026's.
fn settings_source(user: &Path, legacy: Option<&Path>) -> Result<toml_edit::DocumentMut, String> {
    let own = user_settings(user);
    let Err(why) = &own else { return own };
    if !(why.contains("no settings file") || why.contains("is empty")) {
        return own;
    }
    let older = legacy.and_then(|l| fs::read_to_string(l.join("config.toml")).ok()).filter(|t| !t.trim().is_empty());
    let Some(mut doc) = older.and_then(|t| t.parse::<toml_edit::DocumentMut>().ok()) else { return own };
    doc.remove("hooks");
    doc.remove("notify");
    Ok(doc)
}

/// ACCT-021: why the settings cannot be copied into the accounts from this machine, if they
/// cannot (the older release's shared settings count as a source).
pub fn settings_problem(user: &Path) -> Option<String> {
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    settings_source(user, legacy_home(roaming.as_deref()).as_deref()).err()
}

/// What an account's home is given from the user's own Codex folder besides the settings file:
/// folders of skills, plugins, custom prompts and rules, and the user's global instruction files.
/// A fixed list, so a sign-in file, a session or a log is never reachable from here.
const SHARED_DIRS: [&str; 4] = ["skills", "plugins", "prompts", "rules"];
const SHARED_FILES: [&str; 2] = ["AGENTS.md", "AGENTS.override.md"];
/// How long one launch spends copying before it goes on (the rest follows at the next launch).
pub const SHARE_LIMIT: Duration = Duration::from_secs(2);

/// Row 174: what Kolux copied into a home, by path relative to the home, with the modified time the
/// copy was given. It lives in the home (`SHARED_LIST`), so removing the account removes it too.
type Shared = std::collections::BTreeMap<String, u64>;
const SHARED_LIST: &str = ".kolux-shared.json";

fn stamp(t: std::time::SystemTime) -> u64 {
    t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
}

/// The list, or an empty one when it is missing or unreadable (the safe way round: nothing is
/// then removed, and the copies are recorded again as they are made).
fn read_shared(home: &Path) -> Shared {
    fs::read_to_string(home.join(SHARED_LIST)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_shared(home: &Path, list: &Shared) {
    if let Ok(text) = serde_json::to_string(list) {
        let _ = fs::write(home.join(SHARED_LIST), text);
    }
}

/// A list entry is only ever a path inside one of the fixed shared names.
fn shared_path_ok(rel: &str) -> bool {
    let mut parts = Path::new(rel).components();
    let first = match parts.next() {
        Some(std::path::Component::Normal(f)) => f.to_string_lossy().into_owned(),
        _ => return false,
    };
    (SHARED_DIRS.contains(&first.as_str()) || SHARED_FILES.contains(&first.as_str())) && parts.all(|c| matches!(c, std::path::Component::Normal(_)))
}

/// Row 174: a file the user has deleted goes from the home too, but only one Kolux copied and the
/// home has not changed since (its modified time is still the one the copy was given). An edited
/// copy stays and is no longer tracked. Nothing is removed unless the user's Codex folder is there
/// and the source is plainly gone, so a folder that is unplugged or locked costs nothing.
fn prune_shared(user: &Path, home: &Path, list: &mut Shared) {
    if !user.is_dir() {
        return;
    }
    for rel in list.keys().cloned().collect::<Vec<_>>() {
        if !shared_path_ok(&rel) || !matches!(user.join(&rel).try_exists(), Ok(false)) {
            continue;
        }
        let target = home.join(&rel);
        match fs::metadata(&target).and_then(|m| m.modified()) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                list.remove(&rel);
            }
            Err(_) => {}
            Ok(t) => {
                let ours = list.get(&rel).is_some_and(|s| *s == stamp(t));
                if !ours || fs::remove_file(&target).is_ok() {
                    list.remove(&rel);
                }
                if ours {
                    let mut dir = target.parent();
                    while let Some(d) = dir.filter(|d| *d != home && d.starts_with(home)) {
                        if fs::remove_dir(d).is_err() {
                            break;
                        }
                        dir = d.parent();
                    }
                }
            }
        }
    }
}

/// ACCT-021: copies one file when the user's is newer than the home's (or the home has none yet),
/// and gives the copy the user's modified time so an untouched file is skipped next time. The
/// second value is the stamp of a copy that is Kolux's: made now, or an earlier one that matches the
/// user's file exactly (row 174 adopts those).
fn share_file(from: &Path, to: &Path) -> std::io::Result<(bool, Option<u64>)> {
    let mine = fs::metadata(from)?.modified()?;
    if let Ok(theirs) = fs::metadata(to).and_then(|m| m.modified()) {
        if theirs >= mine {
            return Ok((false, (theirs == mine).then(|| stamp(mine))));
        }
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(from, to)?;
    fs::File::options().write(true).open(to)?.set_modified(mine)?;
    Ok((true, Some(stamp(mine))))
}

/// Copies a folder's files and sub-folders across; links are skipped, never followed. `rel` is the
/// folder's path in the home and `list` records each copy that is Kolux's.
fn share_tree(from: &Path, to: &Path, deadline: std::time::Instant, copied: &mut usize, rel: &str, list: &mut Shared) -> std::io::Result<()> {
    for entry in fs::read_dir(from)? {
        if std::time::Instant::now() >= deadline {
            return Ok(());
        }
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        let here = format!("{rel}/{}", entry.file_name().to_string_lossy());
        if kind.is_dir() {
            share_tree(&entry.path(), &target, deadline, copied, &here, list)?;
        } else if kind.is_file() {
            let (did, ours) = share_file(&entry.path(), &target)?;
            *copied += usize::from(did);
            if let Some(s) = ours {
                list.insert(here, s);
            }
        }
    }
    Ok(())
}

/// ACCT-021: before a launch, the user's own Codex skills, plugins, prompts, rules and global
/// instructions are made available inside an account's home. The home's own sign-in, sessions and
/// settings are never touched: nothing outside the fixed lists above is read, and a file the home
/// has changed since is kept. Returns how many files were copied; the first problem is the
/// warning, and the rest is still tried.
pub fn share_user_files(user: &Path, home: &Path, deadline: std::time::Instant) -> Result<usize, String> {
    let mut copied = 0;
    let mut problem = None;
    if !home.is_dir() || user == home {
        return Ok(0);
    }
    let mut note = |what: &str, e: std::io::Error| problem = problem.take().or(Some(format!("Codex's {what} could not be shared with the accounts (antivirus or another program may have a file locked): {e}")));
    let before = read_shared(home);
    let mut list = before.clone();
    prune_shared(user, home, &mut list);
    for name in SHARED_DIRS {
        let from = user.join(name);
        if from.is_dir() {
            if let Err(e) = share_tree(&from, &home.join(name), deadline, &mut copied, name, &mut list) {
                note(name, e);
            }
        }
    }
    for name in SHARED_FILES {
        let from = user.join(name);
        if from.is_file() && std::time::Instant::now() < deadline {
            match share_file(&from, &home.join(name)) {
                Ok((did, ours)) => {
                    copied += usize::from(did);
                    if let Some(s) = ours {
                        list.insert(name.to_string(), s);
                    }
                }
                Err(e) => note(name, e),
            }
        }
    }
    if list != before {
        write_shared(home, &list);
    }
    problem.map_or(Ok(copied), Err)
}

/// ACCT-021: before a launch, the user's Codex settings are copied into an account's home. The
/// home keeps Kolux's sign-in line, the project trust Codex wrote there and Kolux's hook trust
/// (the home's entry wins). True when the home's file changed; an error is the warning to show,
/// and the home is then left as it was.
/// ponytail: a trust entry Codex writes between the last read and the rename is lost; the file is
/// read again just before writing and the copy redone up to three times, a file lock if that shows.
pub fn sync_settings(user: &Path, home: &Path) -> Result<bool, String> {
    let shared = share_user_files(user, home, std::time::Instant::now() + SHARE_LIMIT);
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let changed = sync_settings_from(user, legacy_home(roaming.as_deref()).as_deref(), home);
    // The settings result leads; a skills copy that failed is the warning when the settings were fine.
    match (changed, shared) {
        (Ok(c), Ok(_)) => Ok(c),
        (Ok(_), Err(e)) | (Err(e), _) => Err(e),
    }
}

/// `sync_settings` for the settings alone, with the older release's shared home handed in.
fn sync_settings_from(user: &Path, legacy: Option<&Path>, home: &Path) -> Result<bool, String> {
    let mut doc = settings_source(user, legacy)?;
    doc["cli_auth_credentials_store"] = toml_edit::value("file");
    let file = home.join("config.toml");
    for _ in 0..3 {
        let old = fs::read_to_string(&file).unwrap_or_default();
        let mine: toml_edit::DocumentMut = old.parse().unwrap_or_default();
        let mut out = doc.clone();
        for key in ["projects", "hooks"] {
            let Some(kept) = mine.get(key).and_then(toml_edit::Item::as_table) else { continue };
            if !out.get(key).is_some_and(toml_edit::Item::is_table) {
                out[key] = toml_edit::table();
            }
            let into = out[key].as_table_mut().expect("a table was just put here");
            for (k, v) in kept.iter() {
                into.insert(k, v.clone());
            }
        }
        let text = out.to_string();
        if text == old {
            return Ok(false);
        }
        if fs::read_to_string(&file).unwrap_or_default() != old {
            continue;
        }
        crate::trust::write_whole(&file, &text)?;
        return Ok(true);
    }
    Err("Codex kept changing this account's settings file, so the copy was skipped this time.".into())
}

/// Deletes a folder, retrying for about two seconds while Windows still holds a file in it.
pub fn remove_dir_patiently(dir: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if tries >= 10 => return Err(e),
            Err(_) => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

/// Deletes a file, retrying for about two seconds while Windows or a running pane still holds it.
pub fn remove_file_patiently(path: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if tries >= 10 => return Err(e),
            Err(_) => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

/// None makes Codex's own login the one new Codex panes use.
pub fn activate(store: &Store, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id {
        if !load(store).iter().any(|a| a.id == id) {
            return Err("That Codex account is no longer listed.".into());
        }
    }
    store.set(ACTIVE_KEY, id.unwrap_or("")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn codex_account_activate(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: Option<String>) -> Result<(), String> {
    activate(&*store.lock().map_err(|e| e.to_string())?, id.as_deref())?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// Takes the account off the list and deletes its sign-in: the live `auth.json` in its private
/// home and the sealed copy in the vault. The home itself stays, so the settings, project trust,
/// hooks state and rollout transcripts it had are kept, and a pane still running on the account
/// keeps writing into a folder that is still there. New panes go back to the system default when
/// it was the active one. Only an `auth.json` directly inside Kolux's own accounts folder is ever
/// deleted.
pub fn remove(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    let (gone, cleared) = unlist(store, id)?;
    // Row 944: the sealed copy goes first, so a sign-in file that will not delete never leaves a copy a stale sign-in could unseal.
    crate::claude_accounts::remove_sealed_copy(&profile.join(secrets::VAULT).join(format!("codex-{id}.json")));
    let home = PathBuf::from(&gone.home);
    // Row 944: only the sign-in file of the account's own home directly under the accounts folder is deleted (a ".." or a nested path is not).
    if home.parent() == Some(profile.join(FOLDER).as_path()) && home.file_name().is_some_and(|n| n == id) {
        remove_file_patiently(&home.join("auth.json")).map_err(|e| format!("The account was removed from Kolux, but its sign-in file could not be deleted: {e}"))?;
    }
    cleared
}

/// The command line's rollback (row 921): a sign-in whose temporary copy could not be deleted was
/// not kept as an account, so its whole home goes; nothing runs on it yet.
pub(crate) fn discard(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    let (gone, cleared) = unlist(store, id)?;
    crate::claude_accounts::remove_sealed_copy(&profile.join(secrets::VAULT).join(format!("codex-{id}.json")));
    let home = PathBuf::from(&gone.home);
    if home.parent() == Some(profile.join(FOLDER).as_path()) && home.file_name().is_some_and(|n| n == id) {
        remove_dir_patiently(&home).map_err(|e| format!("The account was not kept, but its home could not be deleted: {e}"))?;
    }
    cleared
}

/// Takes the account off the saved list, and clears the active marker when it named this account.
/// The list is saved first, so a sign-in file that will not delete is reported after the account is gone.
fn unlist(store: &Store, id: &str) -> Result<(Account, Result<(), String>), String> {
    if !crate::cli_accounts::safe_id(id) {
        return Err("That Codex account id is not valid.".into());
    }
    let mut list: Vec<Account> = crate::orchestration::kept::load(store, LIST_KEY)?;
    let Some(at) = list.iter().position(|a| a.id == id) else {
        return Err("That Codex account is no longer listed.".into());
    };
    let gone = list.remove(at);
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    // Row 947: the list is already saved, so a marker that will not clear is logged and reported at the end, after the sign-in files are gone.
    let cleared = if store.get(ACTIVE_KEY).ok().flatten().as_deref() == Some(id) { store.set(ACTIVE_KEY, "").map_err(|e| e.to_string()) } else { Ok(()) };
    if let Err(e) = &cleared {
        eprintln!("kolux-rs: could not clear the active Codex account ({e})");
    }
    Ok((gone, cleared))
}

#[tauri::command]
pub fn codex_account_remove(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>, id: String) -> Result<(), String> {
    if sign_ins.running.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Finish or cancel the sign-in first.".into());
    }
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = remove(&*store.lock().map_err(|e| e.to_string())?, &profile, &id);
    let _ = app.emit(EVENT, ());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_resumed_pane_gets_its_own_home_or_none() {
        let on_disk = temp("resume");
        let acct = |id: &str, home: &Path| Account { id: id.into(), email: None, home: home.to_string_lossy().into_owned(), last_sign_in: 0, sign_in_error: false, label: None };
        let accounts = [acct("a", &on_disk), acct("b", &on_disk.join("missing"))];
        assert_eq!(resume_home(&accounts, "a"), Some(Some(on_disk.to_string_lossy().into_owned())));
        assert_eq!(resume_home(&accounts, "b"), Some(None));
        assert_eq!(resume_home(&accounts, "gone"), None);
        let _ = fs::remove_dir_all(&*on_disk);
    }

    // ACCT-021: the user's settings reach the account's home; the sign-in line, the trust Codex
    // wrote for a project and Kolux's hook trust stay; a later edit is picked up next time.
    #[test]
    fn the_users_codex_settings_are_copied_without_touching_trust() {
        let dir = crate::test_dir::temp("codex-sync");
        let (user, home) = (dir.join("user"), dir.join("home"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(user.join("config.toml"), "model = \"o3\"\n[projects.'C:\\work']\ntrust_level = \"untrusted\"\n[tui]\nnotifications = true\n").unwrap();
        fs::write(home.join("config.toml"), format!("{HOME_CONFIG}[projects.'C:\\work']\ntrust_level = \"trusted\"\n[projects.'D:\\x']\ntrust_level = \"trusted\"\n[hooks.state]\nk = 1\n")).unwrap();
        assert_eq!(sync_settings(&user, &home), Ok(true));
        let doc: toml_edit::DocumentMut = fs::read_to_string(home.join("config.toml")).unwrap().parse().unwrap();
        assert_eq!(doc["model"].as_str(), Some("o3"));
        assert_eq!(doc["cli_auth_credentials_store"].as_str(), Some("file"));
        assert_eq!(doc["projects"]["C:\\work"]["trust_level"].as_str(), Some("trusted"), "the home's trust entry wins");
        assert_eq!(doc["projects"]["D:\\x"]["trust_level"].as_str(), Some("trusted"));
        assert_eq!(doc["hooks"]["state"]["k"].as_integer(), Some(1));
        assert_eq!(doc["tui"]["notifications"].as_bool(), Some(true));
        assert!(!config_drift(&home));
        assert_eq!(sync_settings(&user, &home), Ok(false), "nothing new: the file is left as it is");
        fs::write(user.join("config.toml"), "model = \"o4\"\n").unwrap();
        assert_eq!(sync_settings(&user, &home), Ok(true));
        let doc: toml_edit::DocumentMut = fs::read_to_string(home.join("config.toml")).unwrap().parse().unwrap();
        assert_eq!((doc["model"].as_str(), doc["projects"]["D:\\x"]["trust_level"].as_str()), (Some("o4"), Some("trusted")));
    }

    // ACCT-021: a missing, empty, unreadable or broken settings file is a plain warning and the
    // home is left alone, so the launch goes on.
    #[test]
    fn a_settings_file_that_cannot_be_copied_is_a_warning_and_the_home_is_kept() {
        let dir = crate::test_dir::temp("codex-sync-bad");
        let (user, home) = (dir.join("user"), dir.join("home"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("config.toml"), HOME_CONFIG).unwrap();
        let warn = |w: &str| sync_settings_from(&user, None, &home).unwrap_err().contains(w);
        assert!(warn("no settings file"));
        fs::write(user.join("config.toml"), " \n").unwrap();
        assert!(warn("is empty"));
        fs::write(user.join("config.toml"), "model = \n").unwrap();
        assert!(warn("not valid TOML"));
        fs::remove_file(user.join("config.toml")).unwrap();
        fs::create_dir_all(user.join("config.toml")).unwrap();
        assert!(warn("could not be read"));
        assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), HOME_CONFIG);
        assert_eq!(user_dir(Some(" "), Some(&dir)), Some(dir.join(".codex")));
        assert_eq!(user_dir(Some("E:\\c"), Some(&dir)), Some(PathBuf::from("E:\\c")));
    }

    fn temp(name: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(&format!("codex-acct-{name}"))
    }

    // Row 912: a list that could not be read or kept aside is never saved over by a sign-in.
    #[test]
    fn row912_a_codex_sign_in_cannot_save_over_a_list_that_could_not_be_kept_aside() {
        let profile = temp("row912");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let broken = "[{\"id\":\"c1\",\"email\":\"sam@exa\u{0}\u{fffd} half";
        // The list breaks while the login runs: one that is broken at the start fails before the login (row 932).
        let got = sign_in(&store, &profile, "c9", false, 1, |home: &Path| {
            store.lock().unwrap().set(LIST_KEY, broken).unwrap();
            crate::orchestration::kept::refuse_copies(&profile);
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        });
        assert!(got.is_err(), "the save is refused, not made over an empty list");
        assert!(!profile.join(secrets::VAULT).join("codex-c9.json").exists(), "a refused sign-in leaves no sealed copy");
        assert!(profile.join(FOLDER).join("c9").join("auth.json").exists(), "the home keeps its sign-in (ACCT-019)");
        let store = store.lock().unwrap();
        assert_eq!(store.get(LIST_KEY).unwrap().as_deref(), Some(broken), "the stored list is byte-identical");
        assert_eq!(store.get(ACTIVE_KEY).unwrap(), None, "no account became active for a list that was not saved");
    }

    // Row 916: a read that failed for a moment poisons nothing; the same sign-in works once the store reads again.
    #[test]
    fn row916_a_codex_sign_in_works_again_once_the_store_can_be_read() {
        let profile = temp("row916");
        let store = Mutex::new(Store::open(&profile).unwrap());
        store.lock().unwrap().set(LIST_KEY, "[]").unwrap();
        let login = |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        let side = crate::orchestration::kept::Unreadable::new(&profile);
        assert!(sign_in(&store, &profile, "c9", false, 1, login).is_err());
        side.restore();
        let got = sign_in(&store, &profile, "c10", false, 1, login);
        assert!(got.is_ok(), "{:?}", got.err());
        let store = store.lock().unwrap();
        assert_eq!(load(&store).len(), 1);
        assert_eq!(store.get(ACTIVE_KEY).unwrap().as_deref(), Some("c10"));
    }

    // Row 916 L3: a new account's list and active choice land together or not at all.
    #[test]
    fn row916_a_new_account_is_listed_and_made_active_in_one_save() {
        let profile = temp("row916-set-all");
        let store = Mutex::new(Store::open(&profile).unwrap());
        store.lock().unwrap().set(LIST_KEY, "[]").unwrap();
        store.lock().unwrap().poison(ACTIVE_KEY);
        let got = sign_in(&store, &profile, "c9", false, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        });
        assert!(got.is_err(), "the active choice cannot be saved");
        let store = store.lock().unwrap();
        assert_eq!(store.get(LIST_KEY).unwrap().as_deref(), Some("[]"), "the list did not change either");
        assert_eq!(store.get(ACTIVE_KEY).unwrap(), None);
        assert!(!profile.join(secrets::VAULT).join("codex-c9.json").exists());
    }

    // Row 916: label, flag and remove answer an honest Err while the store is unreadable, and work after.
    #[test]
    fn row916_label_flag_and_remove_work_again_once_the_store_can_be_read() {
        let profile = temp("row916-rm");
        let store = Store::open(&profile).unwrap();
        let a = Account { id: "c1".into(), email: None, home: "x".into(), last_sign_in: 1, sign_in_error: false, label: None };
        store.set(LIST_KEY, &serde_json::to_string(&vec![a]).unwrap()).unwrap();
        let side = crate::orchestration::kept::Unreadable::new(&profile);
        assert!(set_label(&store, "c1", "Work").is_err());
        assert!(mark_sign_in_error(&store, "c1", true).is_err());
        assert!(remove(&store, &profile, "c1").is_err());
        side.restore();
        assert!(set_label(&store, "c1", "Work").is_ok());
        assert_eq!(mark_sign_in_error(&store, "c1", true), Ok(true));
        assert!(remove(&store, &profile, "c1").is_ok());
        assert!(load(&store).is_empty());
    }

    // Row 193 (audit-a193-1): the Codex list is kept aside when it no longer reads, never saved over.
    #[test]
    fn row193_an_unreadable_codex_list_is_kept_aside_and_a_label_save_cannot_wipe_it() {
        let dir = temp("row193");
        let store = Store::open(&dir).unwrap();
        let broken = "[{\"id\":\"c1\",\"email\":\"sam@exa\u{0}\u{fffd} half";
        store.set(LIST_KEY, broken).unwrap();
        assert!(load(&store).is_empty());
        assert_eq!(crate::claude_accounts::test_asides(&store, LIST_KEY), vec![broken.to_string()]);
        assert!(load(&store).is_empty());
        assert_eq!(crate::claude_accounts::test_asides(&store, LIST_KEY).len(), 1, "not set aside twice");
        assert!(set_label(&store, "c1", "Work").is_err(), "nothing to label in the fresh list");
        assert_eq!(crate::claude_accounts::test_asides(&store, LIST_KEY), vec![broken.to_string()], "the old bytes stay");
    }

    fn token(email: &str) -> String {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(r#"{{"email":"{email}"}}"#));
        format!(r#"{{"OPENAI_API_KEY":null,"tokens":{{"id_token":"h.{claims}.s","access_token":"fake"}}}}"#)
    }

    #[test]
    fn device_prompt_waits_for_both_the_link_and_the_code() {
        assert_eq!(device_prompt("Follow these steps to sign in:\n1. Open this link: https://auth.example.com/device"), None);
        let both = "1. Open this link in your browser:\n   https://auth.example.com/device\n2. Enter this one-time code: ABCD-12345\n";
        assert_eq!(device_prompt(both), Some(("https://auth.example.com/device".into(), "ABCD-12345".into())));
        assert_eq!(device_prompt("https://x.example.com/a and Codex-CLI words"), None, "mixed-case words are not a code");
        // The console host places lines with cursor moves, not line breaks (seen live).
        let placed = crate::claude_key::strip_ansi("\u{1b}[4;1H   https://auth.example.com/device\u{1b}[6;1H2. Enter this one-time code\u{1b}[7;1H\u{1b}[3CWXYZ-6789");
        assert_eq!(device_prompt(&placed), Some(("https://auth.example.com/device".into(), "WXYZ-6789".into())));
    }

    #[test]
    fn a_home_whose_config_no_longer_keeps_the_sign_in_in_its_file_has_drifted() {
        let d = temp("drift");
        let home = d.as_path();
        assert!(config_drift(home), "no config.toml at all");
        fs::write(home.join("config.toml"), HOME_CONFIG).unwrap();
        assert!(!config_drift(home), "what Kolux wrote");
        fs::write(home.join("config.toml"), "model = \"o3\"\ncli_auth_credentials_store = 'file' # kept\n[tui]\n").unwrap();
        assert!(!config_drift(home), "other keys and a comment are fine");
        fs::write(home.join("config.toml"), "cli_auth_credentials_store = \"keyring\"\n").unwrap();
        assert!(config_drift(home));
        fs::write(home.join("config.toml"), "[x]\ncli_auth_credentials_store = \"file\"\n").unwrap();
        assert!(config_drift(home), "inside a table it is not the top-level setting");
        fs::write(home.join("config.toml"), format!("{HOME_CONFIG}model_provider = \"ollama\"\n")).unwrap();
        assert!(config_drift(home));
    }

    #[test]
    fn a_codex_that_rejects_its_arguments_is_not_a_refused_sign_in() {
        let clap = "error: unexpected argument '--device-auth' found\n\nUsage: codex login\n\nFor more information, try '--help'.\n";
        let a = failure(&Ended::Exited(Some(2)), clap, None);
        assert_eq!((a.reason, a.message.contains("did not accept")), ("unknown", true));
        assert_eq!(failure(&Ended::Exited(Some(1)), "Login was not completed\n", None).reason, "sign-in-refused");
    }

    #[test]
    fn the_system_default_login_is_read_truthfully() {
        let user = temp("default");
        let codex = user.join(".codex");
        fs::create_dir_all(&codex).unwrap();
        assert_eq!(system_default(None, Some(&user)), "signed-out");
        fs::write(codex.join("config.toml"), "model_provider = \"ollama\"\n[profiles.x]\n").unwrap();
        assert_eq!(system_default(None, Some(&user)), "custom-provider");
        fs::write(codex.join("config.toml"), "[model_providers.x]\nmodel_provider = \"x\"\n").unwrap();
        assert_eq!(system_default(None, Some(&user)), "signed-out", "only the top-level key counts");
        fs::write(codex.join("auth.json"), r#"{"OPENAI_API_KEY":"k","tokens":null}"#).unwrap();
        assert_eq!(system_default(None, Some(&user)), "api-key");
        fs::write(codex.join("auth.json"), token("a@example.com")).unwrap();
        assert_eq!(system_default(None, Some(&user)), "chatgpt");
        let env = temp("default-env");
        assert_eq!(system_default(env.to_str(), Some(&user)), "signed-out", "CODEX_HOME wins over ~/.codex");
    }

    #[test]
    fn removing_the_active_account_hands_codex_back_to_the_system_default() {
        let profile = temp("remove");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", false, 2, ok("kim@example.com")).unwrap();
        let s = store.lock().unwrap();
        assert_eq!(load(&s).len(), 2, "one email can be two accounts (a personal and a business workspace)");
        assert_eq!(active_account(&s).unwrap().id, "c2");
        remove(&s, &profile, "c2").unwrap();
        assert!(active_account(&s).is_none() && active_home(&s).is_none(), "the system default takes over");
        assert!(!profile.join(FOLDER).join("c2").join("auth.json").exists() && !profile.join("vault").join("codex-c2.json").exists(), "the sign-in and its sealed copy go");
        assert!(profile.join(FOLDER).join("c2").is_dir(), "the home itself stays");
        activate(&s, Some("c1")).unwrap();
        assert!(activate(&s, Some("c2")).is_err());
        assert_eq!(active_account(&s).unwrap().id, "c1", "a failed change keeps the earlier choice");
        activate(&s, None).unwrap();
        assert!(active_account(&s).is_none());
    }

    #[test]
    fn two_sign_ins_on_one_email_can_be_named_apart_and_keep_their_names() {
        let profile = temp("label");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", false, 2, ok("kim@example.com")).unwrap();
        {
            let s = store.lock().unwrap();
            set_label(&s, "c1", "  Personal  ").unwrap();
            set_label(&s, "c2", &"W".repeat(80)).unwrap();
            let list = load(&s);
            assert_eq!(list[0].label.as_deref(), Some("Personal"), "trimmed");
            assert_eq!(list[1].label.as_ref().map(|l| l.chars().count()), Some(LABEL_MAX), "capped");
            assert!(set_label(&s, "gone", "x").is_err());
        }
        sign_in(&store, &profile, "c1", true, 3, ok("kim.new@example.com")).unwrap();
        let s = store.lock().unwrap();
        assert_eq!(load(&s)[0].label.as_deref(), Some("Personal"), "signing in again keeps the name");
        set_label(&s, "c1", "   ").unwrap();
        assert_eq!(load(&s)[0].label, None, "a blank name clears it");
    }

    #[test]
    fn a_missing_sign_in_file_warns_only_after_the_grace_period() {
        let mut seen = std::collections::HashMap::new();
        let t0 = std::time::Instant::now();
        assert!(!missing_now(&mut seen, "c1", false, t0));
        assert!(!missing_now(&mut seen, "c1", false, t0 + Duration::from_secs(5)));
        assert!(missing_now(&mut seen, "c1", false, t0 + MISSING_GRACE));
        assert!(!missing_now(&mut seen, "c1", true, t0 + MISSING_GRACE), "back again: no warning");
        assert!(!missing_now(&mut seen, "c1", false, t0 + MISSING_GRACE * 2), "the clock starts over");
    }

    #[test]
    fn a_custom_model_provider_in_the_users_settings_refuses_a_chatgpt_account() {
        let user = temp("provider");
        fs::create_dir_all(user.join(".codex")).unwrap();
        assert!(!user_custom_provider(None, Some(&user)));
        fs::write(user.join(".codex").join("config.toml"), r#"model_provider = "azure""#).unwrap();
        assert!(user_custom_provider(None, Some(&user)));
        let before = fs::read(user.join(".codex").join("config.toml")).unwrap();
        assert!(!user_custom_provider(Some(&user.join("elsewhere").to_string_lossy()), Some(&user)), "CODEX_HOME wins");
        assert_eq!(fs::read(user.join(".codex").join("config.toml")).unwrap(), before, "read only");
    }

    #[test]
    fn disconnect_deletes_only_what_kolux_made_for_the_account() {
        let profile = temp("disconnect");
        let own_user = temp("remove-own");
        let own = own_user.join(".codex");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("auth.json"), token("me@example.com")).unwrap();
        let before = fs::read(own.join("auth.json")).unwrap();
        let store = Mutex::new(Store::open(&profile).unwrap());
        for (id, who) in [("c1", "kim@example.com"), ("c2", "lee@example.com")] {
            sign_in(&store, &profile, id, false, 7, |home| {
                fs::write(home.join("auth.json"), token(who)).unwrap();
                ("Successfully logged in".into(), Ended::Exited(Some(0)), None)
            })
            .unwrap();
        }
        let s = store.lock().unwrap();
        // An entry that points at the user's own folder is unlisted, never deleted.
        let mut list = load(&s);
        list.push(Account { id: "mine".into(), email: None, home: own.parent().unwrap().to_string_lossy().into_owned(), last_sign_in: 1, sign_in_error: false, label: None });
        s.set(LIST_KEY, &serde_json::to_string(&list).unwrap()).unwrap();
        assert_eq!(active_account(&s).map(|a| a.id), Some("c2".into()));
        remove(&s, &profile, "c2").unwrap();
        assert!(!profile.join(FOLDER).join("c2").join("auth.json").exists() && !profile.join("vault").join("codex-c2.json").exists());
        assert_eq!(active_account(&s), None, "the removed account is no longer active");
        assert!(profile.join(FOLDER).join("c1").is_dir() && profile.join(FOLDER).join("c1").join("auth.json").is_file() && profile.join("vault").join("codex-c1.json").is_file());
        remove(&s, &profile, "mine").unwrap();
        assert_eq!(load(&s).iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["c1"]);
        assert_eq!(fs::read(own.join("auth.json")).unwrap(), before, "the user's own Codex login is untouched");
        assert_eq!(system_default(None, own.parent()), "chatgpt");
        assert!(remove(&s, &profile, "c2").is_err());
    }

    #[test]
    fn a_new_sign_in_lands_in_its_own_home_and_becomes_active() {
        let profile = temp("ok");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let a = sign_in(&store, &profile, "c1", false, 7, |home| {
            assert!(home.ends_with("codex-accounts/c1") || home.ends_with("codex-accounts\\c1"));
            assert!(fs::read_to_string(home.join("config.toml")).unwrap().contains("\"file\""));
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            ("Successfully logged in".into(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        assert_eq!(a.email.as_deref(), Some("kim@example.com"));
        let s = store.lock().unwrap();
        assert_eq!(active_home(&s), Some(a.home.clone()));
        let vault = fs::read_to_string(profile.join("vault").join("codex-c1.json")).unwrap();
        assert!(!vault.contains("kim@example.com") && !vault.contains("fake"), "the kept copy is sealed");
        assert_eq!(pane_env(Some("codex"), active_home(&s)), Some((HOME_ENV, a.home)));
        assert_eq!(pane_env(Some("claude"), active_home(&s)), None);
    }

    /// launch FIX-4: a Command that is a bare path with a space starts fine, so it gets the account too.
    #[test]
    fn fix4_a_codex_path_with_a_space_gets_the_account() {
        let home = Some(r"C:\p\codex-accounts\c1".to_string());
        assert_eq!(pane_env(Some(r"C:\Program Files\nodejs\codex.cmd"), home.clone()), Some((HOME_ENV, home.clone().unwrap())));
        assert_eq!(pane_env(Some(r"C:\Program Files\Tools\notcodex.exe"), home), None);
    }

    // T-139-d: a printed sign-in error flags a listed, signed-in account once; an unknown id or an
    // account whose home holds no sign-in is left alone.
    #[test]
    fn a_printed_sign_in_error_flags_only_a_listed_signed_in_account() {
        let profile = temp("printed");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok).unwrap();
        let s = store.lock().unwrap();
        assert!(!flag_printed(&s, "nobody").unwrap(), "an unlisted id (the system default) is never flagged");
        assert!(flag_printed(&s, "c1").unwrap());
        assert!(load(&s)[0].sign_in_error);
        assert!(!flag_printed(&s, "c1").unwrap(), "already flagged: no change, no write");
        mark_sign_in_error(&s, "c1", false).unwrap();
        fs::remove_file(Path::new(&load(&s)[0].home).join("auth.json")).unwrap();
        assert!(!flag_printed(&s, "c1").unwrap(), "no sign-in in the home: not flagged");
    }

    #[test]
    fn signing_in_again_updates_the_account_in_place_and_clears_its_error() {
        let profile = temp("again");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", false, 2, ok("lee@example.com")).unwrap();
        {
            let s = store.lock().unwrap();
            assert!(mark_sign_in_error(&s, "c1", true).unwrap());
            assert!(!mark_sign_in_error(&s, "c1", true).unwrap(), "no change, no write");
            assert_eq!(active_account(&s).unwrap().id, "c2");
        }
        // a login that leaves the old sign-in untouched does not count, and keeps the home
        let e = sign_in(&store, &profile, "c1", true, 3, |_| (String::new(), Ended::Exited(Some(0)), None)).unwrap_err();
        assert_eq!(e.reason, "sign-in-refused");
        assert!(profile.join(FOLDER).join("c1").join("auth.json").exists());
        sign_in(&store, &profile, "c1", true, 4, ok("kim2@example.com")).unwrap();
        let s = store.lock().unwrap();
        let list = load(&s);
        assert_eq!(list.len(), 2, "updated in place, not added");
        assert!(!list[0].sign_in_error && list[0].email.as_deref() == Some("kim2@example.com") && list[0].last_sign_in == 4);
        assert_eq!(active_account(&s).unwrap().id, "c2", "signing in again does not change the active account");
    }

    #[test]
    fn a_failed_sign_in_keeps_nothing_but_never_deletes_a_working_home() {
        let profile = temp("fail");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let e = sign_in(&store, &profile, "c2", false, 1, |_| ("Enter this one-time code: WXYZ-9876\nError: device code expired".into(), Ended::Exited(Some(1)), Some("WXYZ-9876".into()))).unwrap_err();
        assert!(!e.message.contains("WXYZ-9876") && !e.message.contains("https://"), "{e}");
        assert!(!profile.join(FOLDER).join("c2").exists());
        let e = sign_in(&store, &profile, "c3", false, 1, |home| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Cancelled, None)
        })
        .unwrap_err();
        assert_eq!(e, "Sign-in cancelled.");
        assert!(profile.join(FOLDER).join("c3").join("auth.json").exists(), "a home with a working sign-in stays");
        assert!(load(&store.lock().unwrap()).is_empty());
    }

    // Row 923 (4): a new sign-in whose id is already listed takes the next free id and leaves the listed account's home and sealed copy as they were.
    #[test]
    fn row923_a_new_codex_sign_in_on_a_taken_id_never_touches_the_listed_account() {
        let profile = temp("row923-id");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        let first = sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        let (home, vault) = (profile.join(FOLDER).join("c1"), profile.join(secrets::VAULT).join("codex-c1.json"));
        let (auth_before, sealed_before) = (fs::read(home.join("auth.json")).unwrap(), fs::read(&vault).unwrap());
        let second = sign_in(&store, &profile, "c1", false, 2, ok("lee@example.com")).unwrap();
        assert_eq!(first.id, "c1");
        assert_eq!(second.id, "c2", "c1 is listed, so the new account takes the next id");
        assert_eq!(second.home, profile.join(FOLDER).join("c2").to_string_lossy(), "its home follows the claimed id");
        assert!(profile.join(secrets::VAULT).join("codex-c2.json").is_file());
        assert_eq!(fs::read(home.join("auth.json")).unwrap(), auth_before, "the listed home is byte-identical");
        assert_eq!(fs::read(&vault).unwrap(), sealed_before, "and so is its sealed copy");
        assert_eq!(load(&store.lock().unwrap()).len(), 2);
    }

    // Row 932: a store that cannot be read at the start fails a re-sign-in before the login, rather than routing a listed account to a new id.
    #[test]
    fn row932_an_existing_codex_sign_in_fails_up_front_when_the_list_cannot_be_read() {
        let profile = temp("row932-unreadable");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok).unwrap();
        let ran = std::cell::Cell::new(false);
        let side = crate::orchestration::kept::Unreadable::new(&profile);
        let got = sign_in(&store, &profile, "c1", true, 2, |h: &Path| {
            ran.set(true);
            ok(h)
        });
        side.restore();
        assert!(got.is_err(), "an unreadable list is an error, not a new account");
        assert!(!ran.get(), "and the login never started");
        let homes: Vec<_> = fs::read_dir(profile.join(FOLDER)).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(homes, ["c1"], "no duplicate account folder");
        assert_eq!(load(&store.lock().unwrap()).len(), 1);
    }

    // Row 938: with nothing listed at all an existing re-sign-in keeps its own id and home.
    #[test]
    fn row938_an_existing_codex_sign_in_with_an_empty_list_and_its_home_keeps_its_own_id() {
        let profile = temp("row938-empty");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        let first = sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        store.lock().unwrap().set(LIST_KEY, "[]").unwrap();
        let got = sign_in(&store, &profile, "c1", true, 2, ok("lee@example.com")).unwrap();
        assert_eq!(got.id, "c1", "the account keeps its id, not c2");
        assert_eq!(got.home, first.home, "and its home");
        let homes: Vec<_> = fs::read_dir(profile.join(FOLDER)).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(homes, ["c1"], "no second account home");
    }

    // Row 944: the sealed copy goes before the sign-in file, so a file that will not delete never leaves an orphan copy that a stale sign-in could unseal.
    #[test]
    fn row944_a_sign_in_file_that_will_not_delete_still_removes_the_sealed_copy() {
        let profile = temp("row944-order");
        let store = Mutex::new(Store::open(&profile).unwrap());
        sign_in(&store, &profile, "c1", false, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        let home = profile.join(FOLDER).join("c1");
        // A folder where the sign-in file should be: `remove_file` fails, so the delete is reported.
        fs::remove_file(home.join("auth.json")).unwrap();
        fs::create_dir_all(home.join("auth.json").join("held")).unwrap();
        let vault = profile.join(secrets::VAULT).join("codex-c1.json");
        assert!(vault.is_file());
        assert!(remove(&store.lock().unwrap(), &profile, "c1").is_err(), "the sign-in file delete still reports its failure");
        assert!(!vault.exists(), "the sealed copy is gone");
        assert!(home.is_dir(), "the home stays");
    }

    // Row 947: the guard's false side: a listed safe id whose stored home is outside the accounts folder is unlisted but nothing in that home is deleted.
    #[test]
    fn row947_removing_a_listed_id_whose_home_is_elsewhere_deletes_that_home_never() {
        let profile = temp("row947-elsewhere");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let elsewhere = profile.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        let marker = elsewhere.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let sign_in_outside = elsewhere.join("auth.json");
        fs::write(&sign_in_outside, token("me@example.com")).unwrap();
        let s = store.lock().unwrap();
        let odd = Account { id: "c1".into(), email: None, home: elsewhere.to_string_lossy().into_owned(), last_sign_in: 0, sign_in_error: false, label: None };
        s.set(LIST_KEY, &serde_json::to_string(&[odd]).unwrap()).unwrap();
        remove(&s, &profile, "c1").unwrap();
        assert!(crate::orchestration::kept::load::<Vec<Account>>(&s, LIST_KEY).unwrap().is_empty(), "the account is unlisted");
        assert!(marker.exists(), "the home outside the accounts folder is untouched");
        assert!(sign_in_outside.is_file(), "and so is the sign-in in it");
    }

    // Row 947: removing an account whose listed id is ".." must not delete the profile folder (the same guard as the Claude side).
    #[test]
    fn row947_removing_a_path_id_deletes_nothing() {
        let profile = temp("row947-dotdot");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let marker = profile.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let s = store.lock().unwrap();
        let odd = Account { id: "..".into(), email: None, home: profile.join(FOLDER).join("..").to_string_lossy().into_owned(), last_sign_in: 0, sign_in_error: false, label: None };
        s.set(LIST_KEY, &serde_json::to_string(&[odd]).unwrap()).unwrap();
        assert!(remove(&s, &profile, "..").is_err(), "an unsafe id is refused");
        assert!(marker.exists(), "the profile folder is still there");
    }

    // Row 947: an active marker that will not clear is reported at the end, after the list is saved and the sealed copy and sign-in are gone.
    #[test]
    fn row947_a_marker_that_will_not_clear_still_removes_the_vault_and_sign_in() {
        let profile = temp("row947-marker");
        let store = Mutex::new(Store::open(&profile).unwrap());
        sign_in(&store, &profile, "c1", false, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        let s = store.lock().unwrap();
        s.set(ACTIVE_KEY, "c1").unwrap();
        s.poison(ACTIVE_KEY);
        assert!(remove(&s, &profile, "c1").is_err(), "the failure to clear the marker is still reported");
        assert!(crate::orchestration::kept::load::<Vec<Account>>(&s, LIST_KEY).unwrap().is_empty(), "the list was saved");
        assert!(!profile.join(secrets::VAULT).join("codex-c1.json").exists(), "the sealed copy is gone");
        assert!(!profile.join(FOLDER).join("c1").join("auth.json").exists(), "and the sign-in file");
        assert!(profile.join(FOLDER).join("c1").is_dir(), "the home stays");
    }

    // C25-R5-01: Remove deletes the sign-in only. The home keeps its settings, project trust, hook
    // state and rollout transcripts, so a pane still running on the account keeps writing into a
    // folder that is still there.
    #[test]
    fn c25_removing_a_codex_account_keeps_its_home_settings_and_sessions() {
        let profile = temp("c25-keep");
        let store = Mutex::new(Store::open(&profile).unwrap());
        sign_in(&store, &profile, "c1", false, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        let home = profile.join(FOLDER).join("c1");
        let settings = "model = \"o3\"\n[projects.'C:\\work']\ntrust_level = \"trusted\"\n[hooks.state]\nk = 1\n";
        fs::write(home.join("config.toml"), settings).unwrap();
        fs::create_dir_all(home.join("sessions").join("2026")).unwrap();
        fs::write(home.join("sessions").join("2026").join("rollout.jsonl"), "a turn\n").unwrap();
        remove(&store.lock().unwrap(), &profile, "c1").unwrap();
        assert!(home.is_dir(), "the account's home is not deleted");
        assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), settings, "its settings, project trust and hook state stay");
        assert_eq!(fs::read_to_string(home.join("sessions").join("2026").join("rollout.jsonl")).unwrap(), "a turn\n", "its rollout transcript stays");
        assert!(!home.join("auth.json").exists(), "only the sign-in file is deleted");
        assert!(!profile.join(secrets::VAULT).join("codex-c1.json").exists(), "and its sealed copy");
        assert!(load(&store.lock().unwrap()).is_empty());
    }

    // Row 944: an id like ".." is never an account home; a cancelled login must not roll back (delete) the profile folder.
    #[test]
    fn row944_a_codex_sign_in_with_a_path_id_is_refused_before_the_login() {
        let profile = temp("row944-signin");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let marker = profile.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let called = std::cell::Cell::new(false);
        let got = sign_in(&store, &profile, "..", true, 1, |_: &Path| {
            called.set(true);
            (String::new(), Ended::Cancelled, None)
        });
        assert!(got.is_err(), "an unsafe id is refused");
        assert!(!called.get(), "the login never ran");
        assert!(marker.exists(), "nothing outside the accounts folder was touched");
    }

    // Row 940: a non-empty list that lacks the id but a home that is there is a still-existing sign-in (the list lost it), so it keeps its id.
    #[test]
    fn row940_an_existing_codex_sign_in_at_an_unlisted_id_with_a_home_keeps_its_id() {
        let profile = temp("row940-home");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", false, 1, ok("kim@example.com")).unwrap();
        let home = profile.join(FOLDER).join("c2");
        fs::create_dir_all(&home).unwrap();
        let got = sign_in(&store, &profile, "c2", true, 2, ok("lee@example.com")).unwrap();
        assert_eq!(got.id, "c2", "the account keeps its id, not a new one");
        assert_eq!(got.home, home.to_string_lossy());
        assert_eq!(load(&store.lock().unwrap()).len(), 2);
    }

    // Row 929: existing:true at an id that is not listed (a stale screen) is a new account, so an orphan sealed copy at that id is never overwritten.
    #[test]
    fn row929_an_existing_codex_sign_in_at_an_unlisted_id_claims_a_free_one() {
        let profile = temp("row929-stale");
        let store = Mutex::new(Store::open(&profile).unwrap());
        // Row 938: a stale screen means a non-empty list that lacks the id; an empty list keeps the id.
        sign_in(&store, &profile, "c1", false, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("lee@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        let vault = profile.join(secrets::VAULT).join("codex-c7.json");
        secrets::write_file(&vault, "orphan sealed text").unwrap();
        let orphan = fs::read(&vault).unwrap();
        let got = sign_in(&store, &profile, "c7", true, 1, |home: &Path| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        assert_ne!(got.id, "c7", "the unlisted id is taken by an orphan copy, so the account gets another");
        assert_eq!(fs::read(&vault).unwrap(), orphan, "the orphan is byte-identical");
        assert!(profile.join(secrets::VAULT).join(format!("codex-{}.json", got.id)).is_file());
        assert_eq!(got.home, profile.join(FOLDER).join(&got.id).to_string_lossy());
    }

    #[test]
    fn acct_024_a_codex_pane_waits_for_the_chosen_sign_in() {
        use std::cell::{Cell, RefCell};
        // FIX-4: no wall clock. The wait is counted in polls: it runs out after `budget` pauses, and a
        // pause takes no time, so a loaded machine cannot change what these cases see.
        let pauses = Cell::new(0u32);
        let budget = 50;
        let wait = |signed: &dyn Fn(&str) -> bool, active: &mut dyn FnMut() -> Option<String>| {
            pauses.set(0);
            ready_home_by(&mut *active, signed, || pauses.get() >= budget, || pauses.set(pauses.get() + 1))
        };
        // already signed in: no wait
        assert_eq!(wait(&|h| h == "a", &mut || Some("a".into())), Ok(Some("a".into())));
        assert_eq!(pauses.get(), 0);
        // no managed account: the system default, at once
        assert_eq!(wait(&|_| false, &mut || None), Ok(None));
        assert_eq!(pauses.get(), 0);
        // the sign-in lands while waiting (on the fifth look, so after four pauses)
        let n = RefCell::new(0);
        assert_eq!(wait(&|_| { *n.borrow_mut() += 1; *n.borrow() > 4 }, &mut || Some("a".into())), Ok(Some("a".into())));
        assert_eq!(pauses.get(), 4);
        // never lands: the pane starts on the system-default login instead of hanging, after exactly the budget
        assert_eq!(wait(&|_| false, &mut || Some("a".into())), Ok(None));
        assert_eq!(pauses.get(), budget);
        // the account is changed while waiting: the new one wins
        let calls = RefCell::new(0);
        let mut switching = || { *calls.borrow_mut() += 1; Some(if *calls.borrow() > 2 { "b" } else { "a" }.to_string()) };
        assert_eq!(wait(&|h| h == "b", &mut switching), Ok(Some("b".into())));
        // one choice after another without a sign-in: not started, asked to open it again
        let calls = RefCell::new(0);
        let mut switching = || { *calls.borrow_mut() += 1; Some(if *calls.borrow() > 2 { "b" } else { "a" }.to_string()) };
        assert!(wait(&|_| false, &mut switching).unwrap_err().contains("Open it again"));
        assert_eq!(pauses.get(), budget);
        // the real-clock wrapper with no time to wait: a sign-in that is there is taken, one that is not gives the system default, nothing sleeps
        let none = Duration::ZERO;
        assert_eq!(ready_home(|| Some("a".into()), |h| h == "a", none, none), Ok(Some("a".into())));
        assert_eq!(ready_home(|| Some("a".into()), |_| false, none, none), Ok(None));
        assert_eq!(ready_home(|| None, |_| false, none, none), Ok(None));
    }

    #[test]
    fn acct_024_b_the_real_clock_ends_a_wait_that_has_time() {
        // FIX-5: the zero-wait cases cannot tell a broken clock from a working one. Here the wait is
        // about 20 ms and the sign-in never lands: the call must come back with the system default,
        // and not before the wait is up. A slow machine can only make it later, never fail it. It
        // runs on a thread with a generous deadline so a wait that never ends fails, not hangs.
        let wait = Duration::from_millis(20);
        let (tx, rx) = std::sync::mpsc::channel();
        let started = std::time::Instant::now();
        std::thread::spawn(move || {
            let got = ready_home(|| Some("a".into()), |_| false, wait, Duration::from_millis(1));
            let _ = tx.send((got, started.elapsed()));
        });
        let (got, took) = rx.recv_timeout(Duration::from_secs(20)).expect("ready_home never gave up waiting");
        assert_eq!(got, Ok(None));
        assert!(took >= wait, "gave up after {took:?}, before the {wait:?} wait was up");
    }

    fn put(file: &Path, text: &str, age_secs: u64) {
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
        let at = std::time::SystemTime::now() - Duration::from_secs(age_secs);
        fs::File::options().write(true).open(file).unwrap().set_modified(at).unwrap();
    }

    fn read(file: &Path) -> Option<String> {
        fs::read_to_string(file).ok()
    }

    // ACCT-021: the user's skills, plugins, prompts, rules and instructions reach the account's
    // home; its sign-in, sessions and anything outside the fixed lists are never copied or touched;
    // a later edit is picked up; a file the home changed since is kept.
    #[test]
    fn acct_021_the_users_skills_and_plugins_reach_the_home_without_its_sign_in_or_sessions() {
        let dir = crate::test_dir::temp("codex-share");
        let (user, home) = (dir.join("user"), dir.join("home"));
        for (name, text) in [("skills/review/SKILL.md", "skill"), ("skills/review/refs/a.md", "ref"), ("plugins/p/plugin.json", "plug"), ("prompts/fix.md", "prompt"), ("rules/default.rules", "rule"), ("AGENTS.md", "mine")] {
            put(&user.join(name), text, 600);
        }
        for name in ["auth.json", ".credentials.json", "sessions/2026/s.jsonl", "history.jsonl", "log/l.txt", "config.toml", "installation_id"] {
            put(&user.join(name), "USER-PRIVATE", 600);
        }
        put(&home.join("auth.json"), "home-sign-in", 600);
        put(&home.join("sessions/h.jsonl"), "home-session", 600);
        let later = std::time::Instant::now() + Duration::from_secs(60);
        assert_eq!(share_user_files(&user, &home, later), Ok(6));
        assert_eq!(read(&home.join("skills/review/refs/a.md")).as_deref(), Some("ref"));
        assert_eq!(read(&home.join("AGENTS.md")).as_deref(), Some("mine"));
        assert_eq!(read(&home.join("rules/default.rules")).as_deref(), Some("rule"));
        for name in [".credentials.json", "sessions/2026/s.jsonl", "history.jsonl", "log/l.txt", "config.toml", "installation_id"] {
            assert!(!home.join(name).exists(), "{name} must not be copied");
        }
        assert_eq!(read(&home.join("auth.json")).as_deref(), Some("home-sign-in"), "the home's own sign-in stays");
        assert_eq!(read(&home.join("sessions/h.jsonl")).as_deref(), Some("home-session"));
        assert_eq!(share_user_files(&user, &home, later), Ok(0), "nothing new: nothing is copied again");
        // The user edits a skill: it is picked up. Codex edits another file in the home: kept.
        put(&user.join("skills/review/SKILL.md"), "skill v2", 10);
        put(&user.join("prompts/fix.md"), "prompt v2", 700);
        put(&home.join("prompts/fix.md"), "home edit", 5);
        assert_eq!(share_user_files(&user, &home, later), Ok(1));
        assert_eq!(read(&home.join("skills/review/SKILL.md")).as_deref(), Some("skill v2"));
        assert_eq!(read(&home.join("prompts/fix.md")).as_deref(), Some("home edit"));
        // A folder the user has not got, a home that is not there and a home that is the user's own are no-ops.
        assert_eq!(share_user_files(&dir.join("nobody"), &home, later), Ok(0));
        assert_eq!(share_user_files(&user, &dir.join("no-home"), later), Ok(0));
        assert!(!dir.join("no-home").exists(), "a missing home is never created for this");
        assert_eq!(share_user_files(&user, &user, later), Ok(0));
    }

    // Row 174 (T-171-c): a skill or prompt the user deletes goes from the home too, but only a file
    // Kolux copied and the home has not edited since; the home's own files and a missing user
    // folder never cost anything.
    #[test]
    fn row174_a_file_the_user_deletes_leaves_the_homes_copy_but_only_what_kolux_copied() {
        let dir = crate::test_dir::temp("codex-share-prune");
        let (user, home) = (dir.join("user"), dir.join("home"));
        for name in ["skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md", "prompts/fix.md"] {
            put(&user.join(name), name, 600);
        }
        put(&home.join("skills/own/SKILL.md"), "the home's own", 600);
        let later = std::time::Instant::now() + Duration::from_secs(60);
        assert_eq!(share_user_files(&user, &home, later), Ok(4));
        // Codex edits one copy; the user deletes a, c and the prompt.
        put(&home.join("skills/c/SKILL.md"), "home edit", 5);
        fs::remove_dir_all(user.join("skills/a")).unwrap();
        fs::remove_dir_all(user.join("skills/c")).unwrap();
        fs::remove_file(user.join("prompts/fix.md")).unwrap();
        assert_eq!(share_user_files(&user, &home, later), Ok(0));
        assert!(!home.join("skills/a").exists(), "a deleted skill goes from the home, folder and all");
        assert!(!home.join("prompts").exists(), "a folder that empties goes too");
        assert_eq!(read(&home.join("skills/c/SKILL.md")).as_deref(), Some("home edit"), "an edited copy stays");
        assert_eq!(read(&home.join("skills/b/SKILL.md")).as_deref(), Some("skills/b/SKILL.md"));
        assert_eq!(read(&home.join("skills/own/SKILL.md")).as_deref(), Some("the home's own"), "never copied, never removed");
        // No user folder at all (unplugged, renamed): nothing is removed.
        assert_eq!(share_user_files(&dir.join("nobody"), &home, later), Ok(0));
        assert!(home.join("skills/b/SKILL.md").exists());
        // The user's folder is there but a source is only unreadable-looking: still present means kept.
        assert_eq!(share_user_files(&user, &home, later), Ok(0));
        assert!(home.join("skills/b/SKILL.md").exists());
    }

    // Row 174: copies an earlier release made (no list yet) are adopted when they match the user's
    // file exactly, so they too go when the user deletes the original.
    #[test]
    fn row174_copies_made_before_the_list_existed_are_adopted() {
        let dir = crate::test_dir::temp("codex-share-adopt");
        let (user, home) = (dir.join("user"), dir.join("home"));
        put(&user.join("skills/old/SKILL.md"), "old", 600);
        fs::create_dir_all(home.join("skills/old")).unwrap();
        fs::copy(user.join("skills/old/SKILL.md"), home.join("skills/old/SKILL.md")).unwrap();
        let at = fs::metadata(user.join("skills/old/SKILL.md")).unwrap().modified().unwrap();
        fs::File::options().write(true).open(home.join("skills/old/SKILL.md")).unwrap().set_modified(at).unwrap();
        let later = std::time::Instant::now() + Duration::from_secs(60);
        assert_eq!(share_user_files(&user, &home, later), Ok(0));
        fs::remove_dir_all(user.join("skills/old")).unwrap();
        assert_eq!(share_user_files(&user, &home, later), Ok(0));
        assert!(!home.join("skills/old").exists());
    }

    // ACCT-021: a launch spends only so long copying; the rest follows at the next one.
    #[test]
    fn acct_021_a_copy_that_is_out_of_time_stops_and_the_next_launch_finishes_it() {
        let dir = crate::test_dir::temp("codex-share-time");
        let (user, home) = (dir.join("user"), dir.join("home"));
        put(&user.join("skills/a/SKILL.md"), "a", 60);
        fs::create_dir_all(&home).unwrap();
        assert_eq!(share_user_files(&user, &home, std::time::Instant::now()), Ok(0));
        assert!(!home.join("skills").exists());
        assert_eq!(share_user_files(&user, &home, std::time::Instant::now() + Duration::from_secs(60)), Ok(1));
    }

    // ACCT-021: with no usable settings file of their own, the shared settings an older release
    // left are read (without its hook entries); a file that exists is never second-guessed.
    #[test]
    fn acct_021_shared_settings_left_by_an_older_release_still_count() {
        let dir = crate::test_dir::temp("codex-legacy");
        let (user, old, home) = (dir.join("user"), dir.join("roaming/kolux/codex-runtime-home"), dir.join("home"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&home).unwrap();
        assert_eq!(legacy_home(Some(&dir.join("roaming"))), Some(old.clone()));
        assert_eq!(legacy_home(None), None);
        let legacy = Some(old.as_path());
        assert!(sync_settings_from(&user, legacy, &home).unwrap_err().contains("no settings file"), "no older home: the plain warning");
        put(&old.join("config.toml"), "model = \"o3\"\nnotify = [\"old-hook\"]\n[hooks.state]\nk = 1\n[tui]\nnotifications = true\n", 60);
        assert_eq!(sync_settings_from(&user, legacy, &home), Ok(true));
        let doc: toml_edit::DocumentMut = read(&home.join("config.toml")).unwrap().parse().unwrap();
        assert_eq!((doc["model"].as_str(), doc["tui"]["notifications"].as_bool()), (Some("o3"), Some(true)));
        assert!(doc.get("hooks").is_none() && doc.get("notify").is_none(), "the older release's hook entries stay behind");
        assert_eq!(doc["cli_auth_credentials_store"].as_str(), Some("file"));
        put(&user.join("config.toml"), " \n", 30);
        assert_eq!(sync_settings_from(&user, legacy, &home), Ok(false), "an empty file of their own falls back too");
        put(&user.join("config.toml"), "model = \"o4\"\n", 20);
        assert_eq!(sync_settings_from(&user, legacy, &home), Ok(true));
        assert!(!read(&home.join("config.toml")).unwrap().contains("o3"), "their own file wins once it has content");
        fs::remove_file(user.join("config.toml")).unwrap();
        fs::create_dir_all(user.join("config.toml")).unwrap();
        assert!(sync_settings_from(&user, legacy, &home).unwrap_err().contains("could not be read"), "a locked file is not papered over");
        put(&old.join("config.toml"), "model = \n", 60);
        fs::remove_dir(user.join("config.toml")).unwrap();
        assert!(sync_settings_from(&user, legacy, &home).unwrap_err().contains("no settings file"), "a broken older file is the plain warning");
    }

    // ACCT-024: a Codex pane reattaching to a session that is already running is never held back
    // for sign-in. The wait lives only in the start path; the attach command must not reach it.
    #[test]
    fn acct_024_reattaching_to_a_running_session_never_waits_for_a_sign_in() {
        let source = include_str!("terminal.rs");
        let from = source.find("pub fn terminal_attach(").expect("the attach command is in terminal.rs");
        let body = &source[from..];
        let body = &body[..body.find("\n}").expect("the attach command ends")];
        for waits in ["codex_accounts", "ready_home", "wait_home", "SIGN_IN_WAIT", "auth.json"] {
            assert!(!body.contains(waits), "the attach command reaches the sign-in wait through {waits}");
        }
        let start = source.find("pub async fn terminal_spawn(").expect("the start command is in terminal.rs");
        assert!(source[start..].contains("ready_home("), "the wait is still the start path's");
    }
}
