//! ACCT-005: sign a Claude account in through the browser and keep it as a managed account.
//! ACCT-006: Claude sign-ins are renewed by default, with an opt-out.
//!
//! Every managed account gets a private Claude configuration folder of its own
//! (`<profile>\claude-accounts\<id>`). Kolux runs Claude Code's own `claude auth login` inside it,
//! hidden (the ConPTY runner of ACCT-004), and keeps the credentials that login wrote there, with
//! a sealed copy in the vault (`<profile>\vault\claude-<id>.json`, ACCT-009). A login that quits
//! early or leaves no new credentials adds nothing; a failed re-authentication puts the earlier
//! credentials back. New Claude panes run on the active account through `CLAUDE_CONFIG_DIR`,
//! unless the 1-year key (ACCT-004) is connected: key mode wins.
//!
//! ACCT-006 under OD-01 (DECISIONS.md, DT-A2): the opt-out ships switched on, so sign-in upkeep is
//! left to Claude Code itself, which refreshes its own sign-in in every pane it runs; Kolux sends
//! nothing to Anthropic's token service and never flags an account as needing re-auth for a
//! renewal. Kolux's own renewal (opt-out off) is T-043-d.
//! ponytail: the macOS keychain rules (ACCT-005) are a rule table in keychain.rs (T-043-e), not yet
//! called from here; wiring them in needs a Mac (T-043-f). This build keeps the credentials file.

use crate::claude_key::{run_hidden, Attention, Ended};
use crate::{secrets, state::Store};
use portable_pty::CommandBuilder;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Store keys: the managed accounts, and which one new Claude panes use.
pub const LIST_KEY: &str = "claudeAccounts";
pub const ACTIVE_KEY: &str = "claudeActiveAccount";
/// Settings field of the ACCT-006 opt-out; absent means on (OD-01).
pub const UPKEEP_FIELD: &str = "claudeSignInUpkeepByClaudeCode";
pub const CONFIG_ENV: &str = "CLAUDE_CONFIG_DIR";
pub const CREDENTIALS: &str = ".credentials.json";
pub const FOLDER: &str = "claude-accounts";
pub const EVENT: &str = "claude-accounts";
pub const LOGIN_LIMIT: Duration = Duration::from_secs(600);
const STATUS_LIMIT: Duration = Duration::from_secs(20);

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: Option<String>,
    pub organization: Option<String>,
    /// The account's private Claude configuration folder: where it runs.
    pub config_dir: String,
    /// Milliseconds since 1970 of the last good sign-in.
    pub last_sign_in: i64,
    /// ACCT-012: Claude Code no longer reports this account signed in; Sign in again clears it.
    #[serde(default)]
    pub stale: bool,
}

/// ACCT-025: each listed account's live sign-in file and its sealed copy in the vault.
pub fn sign_in_files(store: &Store, profile: &Path) -> Vec<(PathBuf, PathBuf)> {
    load(store).into_iter().map(|a| (profile.join(FOLDER).join(&a.id).join(CREDENTIALS), profile.join(secrets::VAULT).join(format!("claude-{}.json", a.id)))).collect()
}

pub fn load(store: &Store) -> Vec<Account> {
    load_kept(store, LIST_KEY)
}

/// Row 193: the saved value under `key`, or its default. A value that no longer reads is kept
/// aside (`<key>.corrupt-<ms>`) and the key starts fresh, in one step of the store that never
/// replaces an existing copy or a value that changed since it was read (row 888); a store that
/// cannot be read gives the default and changes nothing. Coordinator default (Txais may overrule):
/// keep aside and start fresh, rather than refusing every save.
pub(crate) fn load_kept<T: serde::de::DeserializeOwned + serde::Serialize + Default>(store: &Store, key: &str) -> T {
    crate::orchestration::kept::or_default(store, key)
}

fn save(store: &Store, list: &[Account]) -> Result<(), String> {
    store.set(LIST_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn active(store: &Store) -> Option<String> {
    store.get(ACTIVE_KEY).ok().flatten().filter(|id| load(store).iter().any(|a| &a.id == id))
}

/// ACCT-006 with OD-01: the opt-out is on unless the user turned it off.
pub fn upkeep_left_to_claude(settings: &Value) -> bool {
    settings.get(UPKEEP_FIELD).and_then(Value::as_bool).unwrap_or(true)
}

/// The variable a new pane gets for the managed account: only a Claude pane, only when the 1-year
/// key is not the connection (key mode wins), only with an active account.
pub fn pane_env(program: Option<&str>, key_mode: bool, active_dir: Option<String>) -> Option<(&'static str, String)> {
    if key_mode || crate::tools::credited_program(program?) != Some("claude") {
        return None;
    }
    active_dir.map(|d| (CONFIG_ENV, d))
}

/// ACCT-024: the variables in the user's own per-agent settings that would sign a Claude pane in
/// past its managed account. An empty value blanks the variable and is fine; so is anything that is
/// not a sign-in, such as a custom endpoint. Windows compares names without case.
pub fn sign_in_overrides(own_env: &[(String, String)], windows: bool) -> Vec<String> {
    const SIGN_INS: [&str; 3] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", crate::claude_key::ENV];
    own_env
        .iter()
        .filter(|(k, v)| !v.is_empty() && SIGN_INS.iter().any(|s| if windows { s.eq_ignore_ascii_case(k) } else { s == k }))
        .map(|(k, _)| k.clone())
        .collect()
}

fn text<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str)).filter(|s| !s.trim().is_empty())
}

/// Email and organisation from `claude auth status --json`; `None` when it is not signed in.
/// ponytail: the signed-in field names are not published; the common spellings are tried.
pub fn identity(json: &str) -> Option<(Option<String>, Option<String>)> {
    let v: Value = serde_json::from_str(json.trim()).ok()?;
    if v.get("loggedIn").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let account = v.get("account").unwrap_or(&Value::Null);
    let email = text(&v, &["email", "emailAddress"]).or_else(|| text(account, &["email", "emailAddress"]));
    let org = text(&v, &["orgName", "organizationName", "organization"])
        .or_else(|| v.get("organization").and_then(|o| text(o, &["name"])))
        .or_else(|| text(account, &["orgName", "organizationName"]));
    Some((email.map(str::to_string), org.map(str::to_string)))
}

/// The credentials a login left behind, if Kolux may keep them: present, and not the very ones
/// that were there before it.
pub fn fresh_credentials(before: Option<&str>, after: Option<String>) -> Option<String> {
    after.filter(|a| !a.trim().is_empty() && Some(a.as_str()) != before)
}

/// Keeps sign-in links and codes out of a message (ACCT-005, ACCT-011).
pub fn scrub(message: &str) -> String {
    message
        .split_whitespace()
        .map(|w| {
            if w.contains("://") {
                "[link removed]"
            } else if w.chars().filter(|c| c.is_ascii_alphanumeric()).count() >= 16 && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_.#=".contains(c)) {
                "[code removed]"
            } else {
                w
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Why a login did not give Kolux an account, in plain words.
pub fn failure(ended: &Ended, output: &str) -> Attention {
    match ended {
        Ended::Cancelled => Attention::new("cancelled", "Sign-in cancelled."),
        Ended::TimedOut => Attention::new("browser-blocked", "The browser sign-in was not finished within 10 minutes."),
        Ended::NotStarted(e) => format!("Claude Code's sign-in could not start: {}", scrub(e)).into(),
        Ended::Exited(_) | Ended::Stopped => {
            let last = output.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("");
            if last.is_empty() {
                Attention::new("sign-in-refused", "Claude Code's sign-in ended without signing in.")
            } else {
                Attention::new("sign-in-refused", format!("Claude Code's sign-in ended without signing in: {}", scrub(last)))
            }
        }
    }
}

fn read(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn hide(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// `claude auth status --json` inside `dir` (None: Claude Code's own sign-in, as a plain pane
/// would see it), hidden, given up on after 20 s.
pub fn auth_status(program: &Path, dir: Option<&Path>) -> Option<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(["auth", "status", "--json"]).env_remove(crate::claude_key::ENV);
    if let Some(dir) = dir {
        cmd.env(CONFIG_ENV, dir);
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    hide(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + STATUS_LIMIT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(child.stdout.as_mut()?, &mut out).ok()?;
    Some(out)
}

/// The command a sign-in runs: `claude auth login` with the account's folder.
pub fn login_command(program: &Path, dir: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.args(["auth", "login"]);
    cmd.env(CONFIG_ENV, dir.as_os_str());
    // The login must not pick up the 1-year key.
    cmd.env_remove(crate::claude_key::ENV);
    cmd
}

/// One sign-in, new (`existing` = None) or again. Runs `login` (the hidden `claude auth login`
/// in `dir`), then `status` for who signed in. On success the account is listed and its
/// credentials sealed into the vault; on failure nothing partial is kept and an existing
/// account's earlier credentials are put back.
#[allow(clippy::too_many_arguments)]
pub fn sign_in(store: &Mutex<Store>, profile: &Path, id: &str, existing: bool, now: i64, login: impl FnOnce(&Path) -> (String, Ended), status: impl FnOnce(&Path) -> Option<String>) -> Result<Account, Attention> {
    // Row 944: the id comes from the renderer and is joined into paths, so an unsafe one is refused before anything touches the disk.
    if !crate::cli_accounts::safe_id(id) {
        return Err(Attention::new("unknown", "That account id is not valid."));
    }
    // Row 932: `existing` at an id that is not listed (a stale screen) is a new account too, so it claims a free id; an unreadable list fails here, before the login.
    let (listed_ids, existing) = if existing {
        let ids: Vec<String> = crate::orchestration::kept::load::<Vec<Account>>(&*store.lock().map_err(|e| e.to_string())?, LIST_KEY)?.into_iter().map(|a| a.id).collect();
        // Row 940: an unlisted id whose account folder is there (a list set aside as corrupt leaves the folders) is still that sign-in; a removed account keeps its folder too (only its sign-in goes), so a stale screen lands in that folder again.
        let listed = ids.iter().any(|l| l == id) || profile.join(FOLDER).join(id).is_dir();
        (ids, listed)
    } else {
        (load(&*store.lock().map_err(|e| e.to_string())?).into_iter().map(|a| a.id).collect(), false)
    };
    let (id, dir) = if existing {
        let dir = profile.join(FOLDER).join(id);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        (id.to_string(), dir)
    } else {
        claim_new_folder(profile, FOLDER, "claude", &listed_ids, id)?
    };
    let id = id.as_str();
    let creds = dir.join(CREDENTIALS);
    let vault = profile.join(secrets::VAULT).join(format!("claude-{id}.json"));
    // Row 940: the live file as the login found it, as raw bytes, so a rollback restores even a file that is not UTF-8.
    let live_before = match fs::read(&creds) {
        Ok(bytes) => LiveBefore::Bytes(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LiveBefore::Absent,
        Err(e) => {
            eprintln!("kolux-rs: could not read the live sign-in {} ({:?})", creds.display(), e.kind());
            LiveBefore::Unreadable
        }
    };
    let before = match &live_before {
        LiveBefore::Bytes(bytes) => String::from_utf8(bytes.clone()).ok(),
        _ => None,
    };
    let undo = || {
        if !existing {
            let _ = fs::remove_dir_all(&dir);
            return;
        }
        match &live_before {
            // Row 944: put back through a temp file and a rename, so a crash never leaves a truncated live file. The token-refresh race (a pane refreshing during the login) is accepted.
            LiveBefore::Bytes(bytes) => {
                restore_sealed_copy(&creds, bytes);
            }
            // Row 938: a file that exists but cannot be read (a lock) may be the only copy of the earlier login, so it is left as it is.
            LiveBefore::Unreadable => {}
            // Row 932: no live file before, so the sealed copy is the earlier login; with none, the live file can only hold the refused login.
            LiveBefore::Absent => match secrets::read_file(&vault, profile).ok().flatten() {
                Some(earlier) => {
                    restore_sealed_copy(&creds, earlier.as_bytes());
                }
                None => remove_refused_login(&creds),
            },
        }
    };
    let (output, ended) = login(&dir);
    let fresh = match ended {
        Ended::Exited(_) => fresh_credentials(before.as_deref(), read(&creds)),
        _ => None,
    };
    let Some(fresh) = fresh else {
        undo();
        return Err(failure(&ended, &output));
    };
    let Some((email, organization)) = status(&dir).as_deref().and_then(identity) else {
        undo();
        return Err(Attention::new("sign-in-refused", "Claude Code did not report a signed-in account after the browser step."));
    };
    if !existing {
        let twin = load(&*store.lock().map_err(|e| e.to_string())?).into_iter().find(|a| same_account(a, email.as_deref(), organization.as_deref()));
        if let Some(t) = twin {
            undo();
            let who = [t.email, t.organization].into_iter().flatten().collect::<Vec<_>>().join(" · ");
            return Err(Attention::new("unknown", format!("{who} is already in the list, so nothing was added.")));
        }
    }
    // Row 921: the sealed copy as it was (None = unreadable, Some(None) = absent), put back if the list save is refused.
    let prior_vault = existing.then(|| match fs::read(&vault) {
        Ok(b) => Some(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(None),
        Err(_) => None,
    });
    if let Err(e) = secrets::write_file(&vault, &fresh) {
        undo();
        return Err(format!("The sign-in could not be stored: {e}").into());
    }
    let account = Account { id: id.into(), email, organization, config_dir: dir.to_string_lossy().into_owned(), last_sign_in: now, stale: false };
    let store = store.lock().map_err(|e| e.to_string())?;
    // Row 916: a list that cannot be read or saved leaves no credentials behind for an account that was never listed.
    let listed = (|| {
        let mut list: Vec<Account> = crate::orchestration::kept::load(&store, LIST_KEY)?;
        match list.iter_mut().find(|a| a.id == id) {
            Some(a) => *a = account.clone(),
            None => list.push(account.clone()),
        }
        save(&store, &list)
    })();
    if let Err(e) = listed {
        // Row 923: the vault goes back first, so undo's fallback copy to the live file reads the earlier credentials.
        let prior = prior_vault.flatten();
        let restored = match &prior {
            _ if !existing => {
                remove_sealed_copy(&vault);
                false
            }
            Some(Some(bytes)) => restore_sealed_copy(&vault, bytes),
            Some(None) => {
                remove_sealed_copy(&vault);
                false
            }
            None => false,
        };
        // Row 929: with no live file and no earlier bytes put back, the live file can only hold the refused login, so it goes.
        // Row 932: unless the earlier sealed bytes are still in memory; those are opened and written live instead.
        if existing && matches!(live_before, LiveBefore::Absent) && !restored {
            let back = matches!(&prior, Some(Some(bytes)) if write_live_from_sealed(&creds, bytes));
            if !back {
                remove_refused_login(&creds);
            }
        } else {
            undo();
        }
        return Err(e.into());
    }
    Ok(account)
}

/// Row 940: what the live credentials file held before a login; `Unreadable` is a file that is there but cannot be read (a sharing lock).
enum LiveBefore {
    Bytes(Vec<u8>),
    Absent,
    Unreadable,
}

/// Row 932: opens earlier sealed bytes and writes them as the live credentials, the way undo writes earlier bytes; false when they cannot be opened or written.
fn write_live_from_sealed(creds: &Path, sealed: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(sealed) else { return false };
    match secrets::unseal(text.trim_end()) {
        Ok(plain) => restore_sealed_copy(creds, plain.as_bytes()),
        Err(_) => false,
    }
}

/// Row 929: deletes the live credentials of a refused login; a file that is already gone is fine, any other failure is logged by path and kind only.
fn remove_refused_login(creds: &Path) {
    if let Err(e) = fs::remove_file(creds) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("kolux-rs: could not delete the refused sign-in {} ({:?})", creds.display(), e.kind());
        }
    }
}

/// Row 921: makes the folder of a NEW account (`agent` is the sealed copy's name prefix) and never reuses a taken id (listed, a folder or a sealed copy
/// already there); a taken id moves to the next free one, so a refused sign-in can only delete what it made.
pub(crate) fn claim_new_folder(profile: &Path, folder: &str, agent: &str, listed: &[String], id: &str) -> Result<(String, PathBuf), String> {
    let parent = profile.join(folder);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let start = u128::from_str_radix(id, 16).ok();
    for step in 0..CLAIM_TRIES {
        let candidate = match (step, start) {
            (0, _) => id.to_string(),
            (_, Some(n)) => format!("{:x}", n + u128::from(step)),
            _ => break,
        };
        if listed.contains(&candidate) || !matches!(profile.join(secrets::VAULT).join(format!("{agent}-{candidate}.json")).try_exists(), Ok(false)) {
            continue;
        }
        let dir = parent.join(&candidate);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok((candidate, dir)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Kolux could not find a free folder for the new account; try again.".into())
}

const CLAIM_TRIES: u32 = 8;

/// Rows 923, 947: puts earlier bytes (a sealed copy or the live sign-in file) back through the app's all-or-nothing save, which keeps the file's mode, syncs and sweeps stale copies; a failure is logged without the bytes. True when the bytes are back.
fn restore_sealed_copy(path: &Path, bytes: &[u8]) -> bool {
    match crate::files::write_bytes(path, bytes) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("kolux-rs: could not put {} back ({e})", path.display());
            false
        }
    }
}

/// Deletes a sealed vault copy; a copy that is already gone is fine, any other failure is logged by path only.
pub(crate) fn remove_sealed_copy(path: &Path) {
    if let Err(e) = fs::remove_file(path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("kolux-rs: could not delete the sealed copy {} ({:?})", path.display(), e.kind());
        }
    }
}

/// The one sign-in that may run, and what the last one left behind.
#[derive(Default)]
pub struct SignIns {
    running: Mutex<Option<String>>,
    in_browser: AtomicBool,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    pub accounts: Vec<Account>,
    pub active: Option<String>,
    /// The account id a sign-in is running for (a new one has no row yet).
    pub signing_in: Option<String>,
    pub in_browser: bool,
    pub attention: Option<Attention>,
    /// The 1-year key is the Claude connection, so it wins for new panes.
    pub key_mode: bool,
    pub upkeep_left_to_claude: bool,
}

#[tauri::command]
pub fn claude_accounts(store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>) -> Result<AccountsView, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let settings = store.settings();
    Ok(AccountsView {
        accounts: load(&store),
        active: active(&store),
        signing_in: sign_ins.running.lock().ok().and_then(|r| r.clone()),
        in_browser: sign_ins.in_browser.load(Ordering::SeqCst),
        attention: sign_ins.attention.lock().ok().and_then(|a| a.clone()),
        key_mode: settings.get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE),
        upkeep_left_to_claude: upkeep_left_to_claude(&settings),
    })
}

/// Add Account (`id` = None) or Sign in again (`id` = that account).
#[tauri::command]
pub fn claude_account_sign_in(app: AppHandle, sign_ins: tauri::State<'_, SignIns>, id: Option<String>) -> Result<(), String> {
    let existing = id.is_some();
    let id = id.unwrap_or_else(|| format!("{:x}", crate::claude_key::now_ms()));
    {
        let mut running = sign_ins.running.lock().map_err(|e| e.to_string())?;
        if running.is_some() {
            return Err("A Claude sign-in is already in progress; finish it in the browser or cancel it first.".into());
        }
        *running = Some(id.clone());
    }
    let set = |a: Option<Attention>| {
        if let Ok(mut g) = sign_ins.attention.lock() {
            *g = a;
        }
    };
    let program = crate::agents::find_program("claude");
    let refused = match &program {
        None => Some(Attention::new("not-found", "Claude Code is not installed, so there is nothing to sign in with.")),
        Some(p) if crate::claude_key::is_wrapper(p) => Some(Attention::new("install-unavailable", "The installed Claude launcher is a script wrapper Kolux cannot start directly. Install Claude Code's native build and try again.")),
        _ => None,
    };
    if let Some(r) = refused {
        set(Some(r));
        if let Ok(mut g) = sign_ins.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
        return Ok(());
    }
    let program = program.unwrap_or_default();
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = sign_ins.cancel.lock() {
        *c = Some(cancel.clone());
    }
    sign_ins.in_browser.store(false, Ordering::SeqCst);
    set(None);
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let browser_app = app.clone();
        let store = app.state::<Mutex<Store>>();
        let result = sign_in(
            &store,
            &profile,
            &id,
            existing,
            crate::claude_key::now_ms(),
            |dir| {
                run_hidden(
                    login_command(&program, dir),
                    LOGIN_LIMIT,
                    cancel,
                    move || {
                        browser_app.state::<SignIns>().in_browser.store(true, Ordering::SeqCst);
                        let _ = browser_app.emit(EVENT, ());
                    },
                    |_| false,
                )
            },
            |dir| auth_status(&program, Some(dir)),
        );
        let signed_in = result.as_ref().ok().map(|a| a.config_dir.clone());
        let sign_ins = app.state::<SignIns>();
        if let Ok(mut g) = sign_ins.attention.lock() {
            *g = result.err().filter(|e| e.reason != "cancelled");
        }
        sign_ins.in_browser.store(false, Ordering::SeqCst);
        if let Ok(mut g) = sign_ins.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
        // Row 989: a pane on this account reads its own settings.json, so it gets Kolux's hooks now; after the card is released, on this worker thread, and nothing after a failed sign-in.
        if let Some(dir) = signed_in {
            if let Ok(Err(e)) = store.lock().map(|s| s.settings()).map(|s| crate::hooks::agent_hooks::install_claude_account(&s, &profile, Path::new(&dir))) {
                eprintln!("kolux-rs: claude account hooks: {e}");
            }
        }
    });
    Ok(())
}

/// Stops the running sign-in, or (ACCT-002, ACCT-014: Check again) with nothing running wipes the
/// leftover needs-attention note; true when the note went, so the card is told to re-read.
fn cancel(s: &SignIns) -> bool {
    let running = s.running.lock().map(|r| r.is_some()).unwrap_or(false);
    match s.cancel.lock().ok().and_then(|c| c.clone()) {
        Some(flag) if running => {
            flag.store(true, Ordering::SeqCst);
            false
        }
        _ => {
            if let Ok(mut g) = s.attention.lock() {
                *g = None;
            }
            true
        }
    }
}

#[tauri::command]
pub fn claude_account_cancel(app: AppHandle, sign_ins: tauri::State<'_, SignIns>) {
    if cancel(&sign_ins) {
        let _ = app.emit(EVENT, ());
    }
}

/// ACCT-018: one account is one email (letter case and surrounding spaces ignored) in one
/// organisation; the same email in another organisation is another account.
pub fn same_account(a: &Account, email: Option<&str>, organization: Option<&str>) -> bool {
    let norm = |e: Option<&str>| e.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    norm(a.email.as_deref()).is_some() && norm(a.email.as_deref()) == norm(email) && a.organization.as_deref().map(str::trim) == organization.map(str::trim)
}

/// ACCT-016: `None` makes the system-default login the one new Claude panes use. Panes already
/// running keep the account they started on (ACCT-017): the choice is read only at launch.
pub fn activate(store: &Store, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id {
        if !load(store).iter().any(|a| a.id == id) {
            return Err("That Claude account is no longer listed.".into());
        }
    }
    store.set(ACTIVE_KEY, id.unwrap_or("")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn claude_account_activate(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: Option<String>) -> Result<(), String> {
    activate(&*store.lock().map_err(|e| e.to_string())?, id.as_deref())?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// ACCT-016: takes the account off the list and deletes its sign-in: the live `.credentials.json`
/// in its private folder and the sealed copy in the vault. The folder itself stays, so the
/// settings, project trust, hooks state and transcripts the account had are kept, and a pane still
/// running on the account keeps writing into a folder that is still there. New panes go back to
/// the system default when it was the active one. Only a credentials file directly inside Kolux's
/// own accounts folder is ever deleted.
pub fn remove(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    remove_in(store, profile, id)
}

/// `remove` (a test calls this directly).
pub(crate) fn remove_in(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    let (gone, cleared) = unlist(store, id)?;
    // Row 944: the sealed copy goes first, so a sign-in file that will not delete never leaves a copy a stale sign-in could unseal.
    remove_sealed_copy(&profile.join(secrets::VAULT).join(format!("claude-{id}.json")));
    let dir = PathBuf::from(&gone.config_dir);
    // Row 944: only the sign-in file of the account's own folder directly under the accounts folder is deleted (a ".." or a nested path is not).
    if dir.parent() == Some(profile.join(FOLDER).as_path()) && dir.file_name().is_some_and(|n| n == id) {
        crate::codex_accounts::remove_file_patiently(&dir.join(CREDENTIALS)).map_err(|e| format!("The account was removed from Kolux, but its sign-in file could not be deleted: {e}"))?;
    }
    cleared
}

/// The command line's rollback (row 921): a sign-in whose temporary copy could not be deleted was
/// not kept as an account, so its whole folder goes; nothing runs on it yet. `home` names the home
/// folder whose hooks install lock it takes, so a test never touches the real one.
pub(crate) fn discard(store: &Store, profile: &Path, id: &str, home: &Path) -> Result<(), String> {
    let (gone, cleared) = unlist(store, id)?;
    remove_sealed_copy(&profile.join(secrets::VAULT).join(format!("claude-{id}.json")));
    let dir = PathBuf::from(&gone.config_dir);
    if dir.parent() == Some(profile.join(FOLDER).as_path()) && dir.file_name().is_some_and(|n| n == id) {
        // Row 989: under the hooks install lock, so a sign-in's hook install cannot recreate the folder as it goes.
        crate::hooks::agent_hooks::with_install_lock(home, || crate::codex_accounts::remove_dir_patiently(&dir)).map_err(|e| format!("The account was not kept, but its folder could not be deleted: {e}"))?;
    }
    cleared
}

/// Takes the account off the saved list, and clears the active marker when it named this account.
/// The list is saved first, so a sign-in file that will not delete is reported after the account is gone.
fn unlist(store: &Store, id: &str) -> Result<(Account, Result<(), String>), String> {
    if !crate::cli_accounts::safe_id(id) {
        return Err("That Claude account id is not valid.".into());
    }
    let mut list: Vec<Account> = crate::orchestration::kept::load(store, LIST_KEY)?;
    let Some(at) = list.iter().position(|a| a.id == id) else {
        return Err("That Claude account is no longer listed.".into());
    };
    let gone = list.remove(at);
    save(store, &list)?;
    // Row 947: the list is already saved, so a marker that will not clear is logged and reported at the end, after the sign-in files are gone.
    let cleared = if store.get(ACTIVE_KEY).ok().flatten().as_deref() == Some(id) { store.set(ACTIVE_KEY, "").map_err(|e| e.to_string()) } else { Ok(()) };
    if let Err(e) = &cleared {
        eprintln!("kolux-rs: could not clear the active Claude account ({e})");
    }
    Ok((gone, cleared))
}

/// Off the window's thread: the sign-in file delete can wait up to 2 s while a running pane still holds it.
#[tauri::command]
pub async fn claude_account_remove(app: AppHandle, sign_ins: tauri::State<'_, SignIns>, id: String) -> Result<(), String> {
    if sign_ins.running.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Finish or cancel the sign-in first.".into());
    }
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let store = app.state::<Mutex<Store>>();
            let guard = store.lock().map_err(|e| e.to_string())?;
            remove(&guard, &profile, &id)
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = app.emit(EVENT, ());
    result
}

/// Marks an account stale or fresh (ACCT-012); true when that changed anything.
pub fn mark_stale(store: &Store, id: &str, stale: bool) -> Result<bool, String> {
    let mut list: Vec<Account> = crate::orchestration::kept::load(store, LIST_KEY)?;
    let Some(a) = list.iter_mut().find(|a| a.id == id && a.stale != stale) else {
        return Ok(false);
    };
    a.stale = stale;
    save(store, &list)?;
    Ok(true)
}

/// ACCT-012: asks Claude Code whether the active managed account is still signed in. Only when
/// Kolux, not Claude Code, looks after sign-ins (ACCT-006) and the 1-year key is not the
/// connection; an answer that never came leaves the account as it was. In key mode a pane that
/// stopped on a sign-in failure (`cause` "signin") means Claude refused the key (ACCT-013 b1).
#[tauri::command]
pub async fn claude_account_check(app: AppHandle, cause: Option<String>) -> Result<(), String> {
    let target = {
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE);
        if key_mode {
            let has_token = secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten().is_some();
            if key_refused(key_mode, has_token, cause.as_deref()) {
                crate::claude_key::mark_refused(&store, crate::claude_key::now_ms());
                let _ = app.emit(crate::claude_key::EVENT, ());
            }
            None
        } else if upkeep_left_to_claude(&settings) {
            None
        } else {
            active(&store).zip(active_dir(&store))
        }
    };
    let (Some((id, dir)), Some(program)) = (target, crate::agents::find_program("claude")) else {
        return Ok(());
    };
    let answer = tauri::async_runtime::spawn_blocking(move || auth_status(&program, Some(Path::new(&dir)))).await.map_err(|e| e.to_string())?;
    let Some(answer) = answer else { return Ok(()) };
    let store = app.state::<Mutex<Store>>();
    let changed = mark_stale(&*store.lock().map_err(|e| e.to_string())?, &id, identity(&answer).is_none())?;
    if changed {
        let _ = app.emit(EVENT, ());
    }
    Ok(())
}

/// ACCT-013 b1: only a pane that stopped on a sign-in failure, in key mode with a key stored,
/// means Claude refused the key; the settings page and the notice ask without a cause.
fn key_refused(key_mode: bool, has_token: bool, cause: Option<&str>) -> bool {
    key_mode && has_token && cause == Some("signin")
}

/// SET-030: what Claude Code's own sign-in on this PC says, as the card shows it.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnSignIn {
    /// `signed-in`, `signed-out`, `not-installed` or `unknown` (no answer in time).
    pub state: &'static str,
    pub email: Option<String>,
}

pub fn own_sign_in(answer: Option<&str>) -> OwnSignIn {
    match answer {
        None => OwnSignIn { state: "unknown", email: None },
        Some(a) => match identity(a) {
            Some((email, _)) => OwnSignIn { state: "signed-in", email },
            None => OwnSignIn { state: "signed-out", email: None },
        },
    }
}

/// Claude Code's own sign-in, only when that is what new Claude panes run on: not in key mode
/// and with no active managed account (null otherwise; those report on their own cards).
#[tauri::command]
pub async fn claude_own_sign_in(app: AppHandle) -> Result<Option<OwnSignIn>, String> {
    {
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let key_mode = store.settings().get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE);
        if key_mode || active_dir(&store).is_some() {
            return Ok(None);
        }
    }
    let Some(program) = crate::agents::find_program("claude") else {
        return Ok(Some(OwnSignIn { state: "not-installed", email: None }));
    };
    let answer = tauri::async_runtime::spawn_blocking(move || auth_status(&program, None)).await.map_err(|e| e.to_string())?;
    Ok(Some(own_sign_in(answer.as_deref())))
}

/// The active account's folder for a new pane, if it is still there.
pub fn active_dir(store: &Store) -> Option<String> {
    let id = active(store)?;
    load(store).into_iter().find(|a| a.id == id).map(|a| a.config_dir).filter(|d| PathBuf::from(d).is_dir())
}

/// T-548-b: a listed account's own folder, if it is still there: where a restored pane starts again.
pub fn dir_of(store: &Store, id: &str) -> Option<String> {
    load(store).into_iter().find(|a| a.id == id).map(|a| a.config_dir).filter(|d| PathBuf::from(d).is_dir())
}

/// Row 984: the `.claude.json` a new Claude pane will read, which is where its folder trust goes.
/// Same precedence as the pane's launch (`pane_env`): an active managed account outside key mode
/// reads its own folder; otherwise the pane inherits the app's `process_file`.
pub fn pane_config_file(store: &Store, process_file: PathBuf) -> PathBuf {
    pane_config_dir(&store.settings(), active_dir(store)).map_or(process_file, |d| d.join(".claude.json"))
}

/// The `CLAUDE_CONFIG_DIR` the user set for Claude's panes (`agentOptions.claude.env`); the last
/// line naming it wins, as in the pane's environment. Blank or relative counts as unset: Kolux
/// cannot know what a relative folder is relative to.
pub fn user_config_dir(settings: &Value) -> Option<PathBuf> {
    let env = crate::agents::parse_env(crate::agents::option_field(settings, "claude", "env")?);
    let named = |k: &str| if cfg!(windows) { k.eq_ignore_ascii_case(CONFIG_ENV) } else { k == CONFIG_ENV };
    env.iter().rev().find(|(k, _)| named(k)).map(|(_, v)| PathBuf::from(v)).filter(|d| d.is_absolute())
}

/// The folder a new Claude pane runs with as `CLAUDE_CONFIG_DIR`, `None` = the app's own. The pane's
/// order (terminal.rs applies the user's variables first, then Kolux's account variable): the
/// active managed account (`pane_env`: not key mode, the program credited to Claude, so a custom
/// command counts), else the user's own `CLAUDE_CONFIG_DIR`. Trust and the agent hooks both read it.
pub fn pane_config_dir(settings: &Value, active_dir: Option<String>) -> Option<PathBuf> {
    let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE);
    let program = crate::agents::command_override(settings, "claude").unwrap_or("claude");
    pane_env(Some(program), key_mode, active_dir).map(|(_, d)| PathBuf::from(d)).or_else(|| user_config_dir(settings))
}

/// `pane_config_file` read from the live store at call time, so an account switch is honoured.
pub fn trust_config_file(store: &Mutex<Store>) -> PathBuf {
    let process_file = crate::trust::claude_config_file();
    match store.lock() {
        Ok(store) => pane_config_file(&store, process_file),
        Err(_) => process_file,
    }
}

/// Tests only: the bytes of every `<key>.corrupt-<ms>[-n]` copy in the store, read straight from
/// its table. (It used to probe the last 10 s of millisecond names one query each, so a PC slow
/// enough to take 10 s over the first call missed the copy on the second.)
#[cfg(test)]
pub(crate) fn test_asides(store: &Store, key: &str) -> Vec<String> {
    let conn = rusqlite::Connection::open(store.dir().join("state.db")).unwrap();
    let mut q = conn.prepare("SELECT value FROM kv WHERE key LIKE ?1 ORDER BY key").unwrap();
    q.query_map([format!("{key}.corrupt-%")], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ACCT-014: Check again routes to Cancel; with nothing running it wipes the stale note.
    #[test]
    fn an_idle_cancel_clears_the_note_and_a_running_one_only_flags() {
        let s = SignIns::default();
        *s.attention.lock().unwrap() = Some(Attention::new("not-found", "x"));
        assert!(cancel(&s));
        assert!(s.attention.lock().unwrap().is_none());
        let flag = Arc::new(AtomicBool::new(false));
        *s.running.lock().unwrap() = Some("new".into());
        *s.cancel.lock().unwrap() = Some(flag.clone());
        *s.attention.lock().unwrap() = Some(Attention::new("plan", "x"));
        assert!(!cancel(&s));
        assert!(flag.load(Ordering::SeqCst) && s.attention.lock().unwrap().is_some());
    }

    // Row 193 (audit-a193-1): an account list that no longer reads is kept aside, never saved over.
    #[test]
    fn row193_an_unreadable_account_list_is_kept_aside_and_the_next_save_cannot_wipe_it() {
        let (_dir, store) = profile("row193");
        let store = store.lock().unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        store.set(LIST_KEY, broken).unwrap();
        assert!(load(&store).is_empty(), "the list reads empty");
        let kept = test_asides(&store, LIST_KEY);
        assert_eq!(kept.len(), 1, "one copy kept aside");
        assert_eq!(kept[0], broken, "byte for byte");
        // A second read does not set the fresh list aside again, and a save leaves the copy alone.
        assert!(load(&store).is_empty());
        assert_eq!(test_asides(&store, LIST_KEY).len(), 1);
        save(&store, &[Account { id: "n1".into(), email: None, organization: None, config_dir: "x".into(), last_sign_in: 1, stale: false }]).unwrap();
        assert_eq!(test_asides(&store, LIST_KEY), vec![broken.to_string()]);
        assert_eq!(load(&store).len(), 1);
    }

    #[test]
    fn acct_013_b1_only_a_sign_in_stop_in_key_mode_with_a_key_counts_as_a_refusal() {
        assert!(key_refused(true, true, Some("signin")));
        for cause in [None, Some("limit"), Some("error"), Some("")] {
            assert!(!key_refused(true, true, cause), "{cause:?} is no refusal");
        }
        assert!(!key_refused(false, true, Some("signin")), "not key mode");
        assert!(!key_refused(true, false, Some("signin")), "no key stored");
        // The status a caller sees: only the refusal expires a key inside its date.
        let (_dir, store) = profile("acct013b1");
        let store = store.lock().unwrap();
        let now = crate::claude_key::now_ms();
        crate::claude_key::keep(&store, "sk-ant-oat01-FAKE", now).unwrap();
        let expired = |store: &Store| crate::claude_key::status_checked(&store.settings(), true, crate::claude_key::is_refused(store), now).expired;
        for cause in [None, Some("limit"), Some("error")] {
            if key_refused(true, true, cause) {
                crate::claude_key::mark_refused(&store, now);
            }
            assert!(!expired(&store));
        }
        if key_refused(true, true, Some("signin")) {
            crate::claude_key::mark_refused(&store, now);
        }
        assert!(expired(&store));
    }

    // Row 888: the account list goes through the store's own keep-aside step, once, and resets the key.
    #[test]
    fn row888_an_undecodable_account_list_is_kept_aside_exactly_once_and_the_key_is_reset() {
        let (_dir, store) = profile("row888-once");
        let store = store.lock().unwrap();
        for broken in ["{\"not\": \"a list\"}", "[{\"id\":", "7"] {
            store.set(LIST_KEY, broken).unwrap();
            assert!(load(&store).is_empty());
            assert!(load(&store).is_empty(), "a second read sets nothing aside again");
            assert_eq!(store.get(LIST_KEY).unwrap().as_deref(), Some("[]"), "the key starts fresh");
            assert!(crate::orchestration::kept::asides(&store, LIST_KEY).contains(&broken.to_string()), "{broken}: byte-identical copy");
        }
        assert_eq!(crate::orchestration::kept::asides(&store, LIST_KEY).len(), 3, "one copy per broken value, none replaced");
    }

    // Row 888: a write that lands while the copy is being made is never overwritten by the reset.
    #[test]
    fn row888_the_list_is_not_reset_when_it_changes_during_the_keep_aside() {
        let (dir, store) = profile("row888-changed");
        let store = store.lock().unwrap();
        let broken = "[{\"id\":\"a1\",";
        store.set(LIST_KEY, broken).unwrap();
        // Another process saves a new list at the moment the copy is written.
        let side = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        side.execute_batch(&format!(
            "CREATE TRIGGER other_writer AFTER INSERT ON kv WHEN NEW.key LIKE '%.corrupt-%' BEGIN UPDATE kv SET value = '[]' || ' ' WHERE key = '{LIST_KEY}'; END;"
        ))
        .unwrap();
        assert!(load(&store).is_empty());
        assert_eq!(store.get(LIST_KEY).unwrap().as_deref(), Some(broken), "the reset was refused: nothing was changed");
        assert!(crate::orchestration::kept::asides(&store, LIST_KEY).is_empty(), "the copy rolled back with the refused reset");
    }

    // Row 912: a list that could not be read or kept aside is never saved over by a sign-in.
    #[test]
    fn row912_a_sign_in_cannot_save_over_a_list_that_could_not_be_kept_aside() {
        let (dir, store) = profile("row912");
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        store.lock().unwrap().set(LIST_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let got = sign_in(&store, &dir, "a9", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into()));
        assert!(got.is_err(), "the save is refused, not made over an empty list");
        assert!(!dir.join(secrets::VAULT).join("claude-a9.json").exists(), "a refused sign-in leaves no sealed copy");
        assert!(!dir.join(FOLDER).join("a9").exists(), "and no account folder");
        let store = store.lock().unwrap();
        assert_eq!(store.get(LIST_KEY).unwrap().as_deref(), Some(broken), "the stored list is byte-identical");
    }

    // Row 916: a read that failed for a moment poisons nothing; the same sign-in works once the store reads again.
    #[test]
    fn row916_a_sign_in_works_again_once_the_store_can_be_read() {
        let (dir, store) = profile("row916");
        let old = Account { id: "a1".into(), email: Some("old@example.com".into()), organization: None, config_dir: "x".into(), last_sign_in: 1, stale: false };
        store.lock().unwrap().set(LIST_KEY, &serde_json::to_string(&vec![old]).unwrap()).unwrap();
        let side = crate::orchestration::kept::Unreadable::new(&dir);
        assert!(sign_in(&store, &dir, "a9", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).is_err());
        assert!(!dir.join(secrets::VAULT).join("claude-a9.json").exists(), "no sealed copy left behind");
        assert!(!dir.join(FOLDER).join("a9").exists(), "no account folder left behind");
        side.restore();
        let got = sign_in(&store, &dir, "a10", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into()));
        assert!(got.is_ok(), "{:?}", got.err());
        assert_eq!(load(&store.lock().unwrap()).len(), 2, "the old account stays and the new one is added");
    }

    // Row 916: remove and mark_stale answer an honest Err while the store is unreadable, and work after.
    #[test]
    fn row916_remove_and_mark_stale_work_again_once_the_store_can_be_read() {
        let (dir, store) = profile("row916-rm");
        let a = Account { id: "a1".into(), email: None, organization: None, config_dir: "x".into(), last_sign_in: 1, stale: false };
        let store = store.lock().unwrap();
        store.set(LIST_KEY, &serde_json::to_string(&vec![a]).unwrap()).unwrap();
        let side = crate::orchestration::kept::Unreadable::new(&dir);
        assert!(mark_stale(&store, "a1", true).is_err());
        assert!(remove_in(&store, &dir, "a1").is_err());
        side.restore();
        assert_eq!(mark_stale(&store, "a1", true), Ok(true));
        assert!(remove_in(&store, &dir, "a1").is_ok());
        assert!(load(&store).is_empty());
    }

    // Row 921 (1): a new sign-in whose id is already taken never touches that account's folder or sealed copy.
    #[test]
    fn row921_a_refused_new_sign_in_on_a_taken_id_leaves_the_listed_account_whole() {
        let (dir, store) = profile("row921-id");
        let listed = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let sealed = fs::read(&vault).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        store.lock().unwrap().set(LIST_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"kim@example.com","orgName":"Other Org"}"#;
        let got = sign_in(&store, &dir, "a1", false, 8, writes(r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#, Ended::Exited(Some(0))), |_| Some(other.into()));
        assert!(got.is_err(), "the list save is refused");
        assert!(Path::new(&listed.config_dir).join(CREDENTIALS).is_file(), "the listed account's folder survives");
        assert_eq!(fs::read_to_string(Path::new(&listed.config_dir).join(CREDENTIALS)).unwrap(), CREDS, "with its own sign-in");
        assert_eq!(fs::read(&vault).unwrap(), sealed, "and its sealed copy");
    }

    // Row 921 (1): a taken id (listed, or a folder or sealed copy already there) moves the new account to the next free id.
    #[test]
    fn row921_a_new_sign_in_on_a_taken_id_takes_the_next_free_one() {
        let (dir, store) = profile("row921-bump");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        fs::create_dir_all(dir.join(FOLDER).join("a2")).unwrap();
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"kim@example.com","orgName":"Other Org"}"#;
        let got = sign_in(&store, &dir, "a1", false, 8, writes(CREDS, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        assert_eq!(got.id, "a3", "a1 is listed and a2 has a folder");
        assert_eq!(load(&store.lock().unwrap()).len(), 2);
        assert!(dir.join(secrets::VAULT).join("claude-a3.json").is_file());
        assert!(dir.join(secrets::VAULT).join("claude-a1.json").is_file());
    }

    // Row 921 (2): a refused re-sign-in puts the sealed copy back as well as the live file.
    #[test]
    fn row921_a_refused_re_sign_in_puts_the_earlier_sealed_copy_back() {
        let (dir, store) = profile("row921-vault");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let sealed = fs::read(&vault).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(fs::read(&vault).unwrap(), sealed, "the sealed copy is the earlier one again");
        assert_eq!(secrets::read_file(&vault, &dir).unwrap().as_deref(), Some(CREDS));
        assert_eq!(fs::read_to_string(Path::new(&a.config_dir).join(CREDENTIALS)).unwrap(), CREDS, "and so is the live file");
    }

    /// Row 947: no save copy (`*.tmp` or `.kolux-save-*`) is left in a folder.
    fn no_save_copies_in(folder: &Path) -> bool {
        fs::read_dir(folder).unwrap().flatten().all(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            !n.ends_with(".tmp") && !n.contains(".kolux-save-")
        })
    }

    // Row 947: the write-back of the earlier live bytes and sealed copy leaves no temp file in the account folder or the vault.
    #[test]
    fn row947_a_refused_re_sign_in_leaves_no_save_copy_behind() {
        let (dir, store) = profile("row947-leftovers");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        let live = Path::new(&a.config_dir);
        assert_eq!(fs::read_to_string(live.join(CREDENTIALS)).unwrap(), CREDS, "the earlier live bytes are back");
        assert!(no_save_copies_in(live), "no save copy in the account folder");
        assert!(no_save_copies_in(&dir.join(secrets::VAULT)), "no save copy in the vault");
    }

    // Row 947: a live credentials file kept at owner-only mode is still owner-only after a refused re-sign-in writes the earlier bytes back. unix only, so it is not run on Windows.
    #[cfg(unix)]
    #[test]
    fn row947_a_refused_re_sign_in_keeps_the_live_file_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, store) = profile("row947-mode");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        fs::set_permissions(&live, fs::Permissions::from_mode(0o600)).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(fs::read_to_string(&live).unwrap(), CREDS);
        assert_eq!(fs::metadata(&live).unwrap().permissions().mode() & 0o777, 0o600);
    }

    // Row 923 (1): with the live file gone, a refused re-sign-in leaves neither the vault nor the live file on the new sign-in.
    #[test]
    fn row923_a_refused_re_sign_in_with_no_live_file_does_not_leave_the_new_credentials() {
        let (dir, store) = profile("row923-order");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        fs::remove_file(&live).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(secrets::read_file(&vault, &dir).unwrap().as_deref(), Some(CREDS), "the vault holds the earlier sign-in");
        assert_ne!(fs::read_to_string(&live).ok().as_deref(), Some(new), "the live file is not the new sign-in");
        assert_eq!(fs::read_to_string(&live).unwrap(), CREDS, "undo copied the earlier sealed credentials back");
    }

    // Row 923 (1): an existing account with no sealed copy gets none from a refused re-sign-in.
    #[test]
    fn row923_a_refused_re_sign_in_with_no_earlier_sealed_copy_leaves_none() {
        let (dir, store) = profile("row923-novault");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        fs::remove_file(&vault).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert!(!vault.exists(), "no sealed copy appears");
    }

    // Row 929: no live file and no earlier sealed copy means no earlier credentials, so a refused re-sign-in leaves none live.
    #[test]
    fn row929_a_refused_re_sign_in_with_no_live_file_and_no_sealed_copy_leaves_no_live_file() {
        let (dir, store) = profile("row929-none");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        fs::remove_file(&live).unwrap();
        fs::remove_file(&vault).unwrap();
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert!(!live.exists(), "the refused login is not left live");
        assert!(!vault.exists(), "and no sealed copy appears");
    }

    // Row 932: no live file and a sealed copy that cannot be opened (lost key) leaves no earlier bytes, so the refused login must not stay live.
    #[test]
    fn row932_a_refused_re_sign_in_with_an_unopenable_sealed_copy_leaves_no_live_file() {
        let (dir, store) = profile("row932-garbage");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        fs::remove_file(&live).unwrap();
        fs::write(&vault, format!("{}!!!", secrets::seal("x").unwrap())).unwrap();
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, writes(new, Ended::Exited(Some(0))), |_| None).is_err());
        assert!(!live.exists(), "the refused login is not left live");
    }

    // Row 932: no seam fails the sealed-copy restore without failing the first vault write (both use the same temp file), so the live-file step is tested on its own.
    #[test]
    fn row932_earlier_sealed_bytes_are_opened_and_written_live_or_nothing_is() {
        let dir = crate::test_dir::temp("claude-accounts-row932-live");
        let live = dir.join(CREDENTIALS);
        assert!(write_live_from_sealed(&live, secrets::seal(CREDS).unwrap().as_bytes()));
        assert_eq!(fs::read_to_string(&live).unwrap(), CREDS);
        let other = dir.join("other.json");
        assert!(!write_live_from_sealed(&other, format!("{}!!!", secrets::seal("x").unwrap()).as_bytes()));
        assert!(!write_live_from_sealed(&other, &[0xff, 0xfe]));
        assert!(!other.exists(), "bytes that cannot be opened write nothing");
    }

    // Row 932: existing:true at an id that is not listed (a stale screen) is a new account, so an orphan sealed copy at that id is never overwritten.
    #[test]
    fn row932_an_existing_claude_sign_in_at_an_unlisted_id_claims_a_free_one() {
        let (dir, store) = profile("row932-stale");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a7.json");
        secrets::write_file(&vault, "orphan sealed text").unwrap();
        let orphan = fs::read(&vault).unwrap();
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"lee@example.com","orgName":"Other Org"}"#;
        let got = sign_in(&store, &dir, "a7", true, 9, writes(r#"{"claudeAiOauth":{"accessToken":"fake-lee"}}"#, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        assert_ne!(got.id, "a7", "the unlisted id is taken by an orphan copy, so the account gets another");
        assert_eq!(fs::read(&vault).unwrap(), orphan, "the orphan is byte-identical");
        assert!(dir.join(secrets::VAULT).join(format!("claude-{}.json", got.id)).is_file());
        assert_eq!(load(&store.lock().unwrap()).len(), 2);
    }

    // Row 938 (1): a live file that exists but cannot be read is the only copy of the earlier login, so a login that never started must not delete it.
    #[test]
    fn row938_a_not_started_re_sign_in_leaves_an_unreadable_live_file_alone() {
        let (dir, store) = profile("row938-live");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        fs::remove_file(&vault).unwrap();
        let bytes = [0xffu8, 0xfe, 0x00, 0x80, b'x'];
        fs::write(&live, bytes).unwrap();
        let got = sign_in(&store, &dir, "a1", true, 9, |_: &Path| (String::new(), Ended::NotStarted("no claude".into())), |_| None);
        assert!(got.is_err());
        assert_eq!(fs::read(&live).unwrap(), bytes, "the unreadable live file is byte-identical");
    }

    /// A listed account whose live file holds bytes that are not UTF-8 and has no sealed copy; returns (live path, those bytes).
    fn listed_with_unreadable_live(dir: &Path, store: &Mutex<Store>) -> (PathBuf, [u8; 5]) {
        let a = sign_in(store, dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        fs::remove_file(dir.join(secrets::VAULT).join("claude-a1.json")).unwrap();
        let live = Path::new(&a.config_dir).join(CREDENTIALS);
        let bytes = [0xffu8, 0xfe, 0x00, 0x80, b'x'];
        fs::write(&live, bytes).unwrap();
        (live, bytes)
    }

    // Row 940 (1): the refused-save path puts the unreadable live file back byte for byte, over the login that overwrote it.
    #[test]
    fn row940_a_refused_save_puts_an_unreadable_live_file_back_exactly() {
        let (dir, store) = profile("row940-refused");
        let (live, bytes) = listed_with_unreadable_live(&dir, &store);
        let broken = "[{\"id\":\"a1\",\"email\":\"sam@exa\u{0}\u{fffd} half written";
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, breaks_list(&store, &dir, broken, new), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(fs::read(&live).unwrap(), bytes, "the unreadable live file is byte-identical, not the refused login");
    }

    // Row 940 (1): the same when the status step fails after the login wrote its credentials.
    #[test]
    fn row940_a_failed_status_puts_an_unreadable_live_file_back_exactly() {
        let (dir, store) = profile("row940-status");
        let (live, bytes) = listed_with_unreadable_live(&dir, &store);
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, writes(new, Ended::Exited(Some(0))), |_| None).is_err());
        assert_eq!(fs::read(&live).unwrap(), bytes, "the unreadable live file is byte-identical, not the refused login");
    }

    // Row 940 (2): with nothing listed, an existing sign-in whose account folder is there (a list set aside as corrupt) keeps its own id and folder.
    #[test]
    fn row938_an_existing_sign_in_with_an_empty_list_and_its_folder_keeps_its_own_id() {
        let (dir, store) = profile("row938-empty");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        store.lock().unwrap().set(LIST_KEY, "[]").unwrap();
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        let got = sign_in(&store, &dir, "a1", true, 9, writes(new, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        assert_eq!(got.id, "a1", "the account keeps its id, not a2");
        assert_eq!(got.config_dir, a.config_dir, "and its folder");
        assert_eq!(fs::read_dir(dir.join(FOLDER)).unwrap().count(), 1, "no second account folder");
        assert_eq!(load(&store.lock().unwrap()).len(), 1);
    }


    // Row 940 (2): an empty list and an orphan sealed copy but no folder is a removed account, so a refused stale sign-in never unseals the orphan live.
    #[test]
    fn row940_a_refused_sign_in_at_a_removed_id_leaves_its_orphan_sealed_copy_alone() {
        let (dir, store) = profile("row940-orphan");
        store.lock().unwrap().set(LIST_KEY, "[]").unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        secrets::write_file(&vault, CREDS).unwrap();
        let orphan = fs::read(&vault).unwrap();
        let new = r#"{"claudeAiOauth":{"accessToken":"fake-new"}}"#;
        assert!(sign_in(&store, &dir, "a1", true, 9, writes(new, Ended::Exited(Some(0))), |_| None).is_err());
        assert_eq!(fs::read(&vault).unwrap(), orphan, "the orphan is byte-identical");
        assert!(!dir.join(FOLDER).join("a1").join(CREDENTIALS).exists(), "no credentials go live in the removed account's folder");
    }

    // Row 944: an id like ".." is never an account folder; the sign-in refuses it before the login runs or anything on disk changes.
    #[test]
    fn row944_a_sign_in_with_a_path_id_is_refused_before_the_login() {
        let (dir, store) = profile("row944-signin");
        let marker = dir.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let called = std::cell::Cell::new(false);
        let got = sign_in(&store, &dir, "..", true, 9, |_| {
            called.set(true);
            (String::new(), Ended::Cancelled)
        }, |_| None);
        assert!(got.is_err(), "an unsafe id is refused");
        assert!(!called.get(), "the login never ran");
        assert!(marker.exists(), "nothing outside the accounts folder was touched");
    }

    // Row 944: the sealed copy goes before the sign-in file, so a file that will not delete never leaves an orphan copy that a stale sign-in could unseal.
    #[test]
    fn row944_a_sign_in_file_that_will_not_delete_still_removes_the_sealed_copy() {
        let (dir, store) = profile("row944-order");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let folder = dir.join(FOLDER).join("a1");
        // A folder where the sign-in file should be: `remove_file` fails, so the delete is reported.
        fs::remove_file(folder.join(CREDENTIALS)).unwrap();
        fs::create_dir_all(folder.join(CREDENTIALS).join("held")).unwrap();
        let vault = dir.join(secrets::VAULT).join("claude-a1.json");
        assert!(vault.is_file());
        assert!(remove_in(&store.lock().unwrap(), &dir, "a1").is_err(), "the sign-in file delete still reports its failure");
        assert!(!vault.exists(), "the sealed copy is gone");
        assert!(folder.is_dir(), "the folder stays");
    }

    // Row 944: removing an account whose listed id is ".." must not delete the profile folder.
    #[test]
    fn row944_removing_a_path_id_deletes_nothing() {
        let (dir, store) = profile("row944-remove");
        let marker = dir.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let s = store.lock().unwrap();
        let odd = Account { id: "..".into(), email: None, organization: None, config_dir: dir.join(FOLDER).join("..").to_string_lossy().into_owned(), last_sign_in: 1, stale: false };
        save(&s, &[odd]).unwrap();
        assert!(remove_in(&s, &dir, "..").is_err(), "an unsafe id is refused");
        assert!(marker.exists(), "the profile folder is still there");
    }

    // Row 947: the guard's false side: a listed safe id whose stored folder is outside the accounts folder is unlisted but nothing in that folder is deleted.
    #[test]
    fn row947_removing_a_listed_id_whose_folder_is_elsewhere_deletes_that_folder_never() {
        let (dir, store) = profile("row947-elsewhere");
        let elsewhere = dir.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        let marker = elsewhere.join("marker.txt");
        fs::write(&marker, "keep").unwrap();
        let sign_in_outside = elsewhere.join(CREDENTIALS);
        fs::write(&sign_in_outside, CREDS).unwrap();
        let s = store.lock().unwrap();
        let odd = Account { id: "a1".into(), email: None, organization: None, config_dir: elsewhere.to_string_lossy().into_owned(), last_sign_in: 1, stale: false };
        save(&s, &[odd]).unwrap();
        remove_in(&s, &dir, "a1").unwrap();
        assert!(load(&s).is_empty(), "the account is unlisted");
        assert!(marker.exists(), "the folder outside the accounts folder is untouched");
        assert_eq!(fs::read_to_string(&sign_in_outside).unwrap(), CREDS, "and so is the sign-in in it");
    }

    // Row 947: an active marker that will not clear is reported at the end, after the list is saved and the sealed copy and sign-in are gone.
    #[test]
    fn row947_a_marker_that_will_not_clear_still_removes_the_vault_and_sign_in() {
        let (dir, store) = profile("row947-marker");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let s = store.lock().unwrap();
        activate(&s, Some("a1")).unwrap();
        s.poison(ACTIVE_KEY);
        assert!(remove_in(&s, &dir, "a1").is_err(), "the failure to clear the marker is still reported");
        assert!(load(&s).is_empty(), "the list was saved");
        assert!(!dir.join(secrets::VAULT).join("claude-a1.json").exists(), "the sealed copy is gone");
        assert!(!dir.join(FOLDER).join("a1").join(CREDENTIALS).exists(), "and the sign-in file");
        assert!(dir.join(FOLDER).join("a1").is_dir(), "the account's folder stays");
    }

    // Row 940 (2): a non-empty list that lacks the id but a folder that is there is a still-existing sign-in (the list lost it), so it keeps its id.
    #[test]
    fn row940_an_existing_sign_in_at_an_unlisted_id_with_a_folder_keeps_its_id() {
        let (dir, store) = profile("row940-folder");
        sign_in(&store, &dir, "b1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let folder = dir.join(FOLDER).join("a1");
        fs::create_dir_all(&folder).unwrap();
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"lee@example.com","orgName":"Other Org"}"#;
        let got = sign_in(&store, &dir, "a1", true, 9, writes(r#"{"claudeAiOauth":{"accessToken":"fake-lee"}}"#, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        assert_eq!(got.id, "a1", "the account keeps its id, not a new one");
        assert_eq!(Path::new(&got.config_dir), folder, "and its folder");
        assert_eq!(load(&store.lock().unwrap()).len(), 2);
    }

    // Row 938 (3): a store that cannot be read at the start fails an existing sign-in before the login runs.
    #[test]
    fn row938_an_existing_claude_sign_in_fails_up_front_when_the_list_cannot_be_read() {
        let (dir, store) = profile("row938-unreadable");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let ran = std::cell::Cell::new(false);
        let side = crate::orchestration::kept::Unreadable::new(&dir);
        let got = sign_in(&store, &dir, "a1", true, 9, |d: &Path| { ran.set(true); writes(CREDS, Ended::Exited(Some(0)))(d) }, |_| Some(SIGNED_IN.into()));
        side.restore();
        assert!(got.is_err(), "an unreadable list is an error, not a new account");
        assert!(!ran.get(), "and the login never started");
        let folders: Vec<_> = fs::read_dir(dir.join(FOLDER)).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(folders, ["a1"], "no duplicate account folder");
    }

    // Row 912: a read-only caller keeps the plain load: the default, and no key poisoned.
    #[test]
    fn row912_a_read_only_load_gives_the_default_and_poisons_nothing() {
        let (dir, store) = profile("row912-ro");
        let store = store.lock().unwrap();
        store.set(LIST_KEY, "[{\"id\":").unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        assert!(load(&store).is_empty());
        assert!(active(&store).is_none());
        store.set("unrelated.key", "1").unwrap();
        store.set(ACTIVE_KEY, "").unwrap();
        assert!(store.set(LIST_KEY, "[]").is_ok(), "the read-only load poisoned nothing");
        store.set("unrelated.key", "2").unwrap();
    }

    #[test]
    fn row193_an_absent_or_readable_list_is_left_alone() {
        let (_dir, store) = profile("row193-ok");
        let store = store.lock().unwrap();
        assert!(load(&store).is_empty());
        store.set(LIST_KEY, "null").unwrap();
        assert!(load(&store).is_empty());
        store.set(LIST_KEY, "[]").unwrap();
        assert!(load(&store).is_empty());
        assert!(test_asides(&store, LIST_KEY).is_empty(), "nothing was unreadable");
    }

    const CREDS: &str = r#"{"claudeAiOauth":{"accessToken":"fake-access","refreshToken":"fake-refresh"}}"#;
    const SIGNED_IN: &str = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.com","orgName":"Example Org"}"#;

    /// The folder goes when the test ends, after the store in it has closed.
    fn profile(tag: &str) -> (crate::test_dir::TempDir, Mutex<Store>) {
        let dir = crate::test_dir::temp(&format!("claude-accounts-{tag}"));
        let store = Store::open(&dir).unwrap();
        (dir, Mutex::new(store))
    }

    /// A login that writes `creds`, and breaks the account list as it ends so the save is refused: a list broken before the login fails the sign-in up front (row 932).
    fn breaks_list<'a>(store: &'a Mutex<Store>, dir: &'a Path, broken: &'a str, creds: &'static str) -> impl FnOnce(&Path) -> (String, Ended) + 'a {
        move |d| {
            store.lock().unwrap().set(LIST_KEY, broken).unwrap();
            crate::orchestration::kept::refuse_copies(dir);
            writes(creds, Ended::Exited(Some(0)))(d)
        }
    }

    fn writes(creds: &'static str, ended: Ended) -> impl FnOnce(&Path) -> (String, Ended) {
        move |dir| {
            fs::write(dir.join(CREDENTIALS), creds).unwrap();
            ("Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789 in your browser".into(), ended)
        }
    }

    #[test]
    fn the_same_account_is_not_added_twice_but_another_organisation_is() {
        let (dir, store) = profile("twice");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let again = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"  SAM@Example.com ","orgName":"Example Org"}"#;
        let err = sign_in(&store, &dir, "a2", false, 8, writes(CREDS, Ended::Exited(Some(0))), |_| Some(again.into())).unwrap_err();
        assert_eq!(err.message, "sam@example.com · Example Org is already in the list, so nothing was added.");
        assert_eq!(load(&store.lock().unwrap()).len(), 1);
        assert!(!dir.join(FOLDER).join("a2").exists(), "the second folder is not kept");
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.com","orgName":"Second Org"}"#;
        sign_in(&store, &dir, "a3", false, 9, writes(CREDS, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        assert_eq!(load(&store.lock().unwrap()).len(), 2, "one email in two organisations is two accounts");
    }

    #[test]
    fn removing_the_active_account_goes_back_to_the_system_default() {
        let (dir, store) = profile("remove");
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"lee@example.com","orgName":"Example Org"}"#;
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        sign_in(&store, &dir, "a2", false, 8, writes(CREDS, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        let s = store.lock().unwrap();
        activate(&s, Some("a2")).unwrap();
        assert_eq!(active(&s).as_deref(), Some("a2"));
        assert!(activate(&s, Some("gone")).is_err());
        assert_eq!(active(&s).as_deref(), Some("a2"), "a failed change keeps the earlier choice");
        remove_in(&s, &dir, "a2").unwrap();
        assert_eq!(active(&s), None, "the system default takes over");
        let folder = dir.join(FOLDER).join("a2");
        assert!(folder.is_dir() && !folder.join(CREDENTIALS).exists(), "the folder stays, its sign-in goes");
        assert!(!dir.join("vault").join("claude-a2.json").exists(), "and the sealed copy");
        assert_eq!(load(&s).len(), 1);
        activate(&s, Some("a1")).unwrap();
        activate(&s, None).unwrap();
        assert_eq!(active(&s), None, "the system default can be picked again");
        assert!(remove_in(&s, &dir, "a2").is_err());
        drop(s);
    }

    // C25-R5-01: Remove deletes the sign-in only. The account's folder keeps its settings, its
    // project trust and its transcripts, so a pane still running on the account keeps writing into
    // a folder that is still there, and a later sign-in finds its old settings.
    #[test]
    fn c25_removing_a_claude_account_keeps_its_folder_with_settings_trust_and_transcripts() {
        let (dir, store) = profile("c25-keep");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let folder = Path::new(&a.config_dir);
        let settings = r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"kolux-hook"}]}]}}"#;
        let trust = r#"{"projects":{"C:\\work":{"hasTrustDialogAccepted":true,"allowedTools":[]}}}"#;
        fs::write(folder.join("settings.json"), settings).unwrap();
        fs::write(folder.join(".claude.json"), trust).unwrap();
        let transcripts = folder.join("projects").join("C--work");
        fs::create_dir_all(&transcripts).unwrap();
        fs::write(transcripts.join("session.jsonl"), "a turn\n").unwrap();
        remove_in(&store.lock().unwrap(), &dir, "a1").unwrap();
        assert!(folder.is_dir(), "the account's folder is not deleted");
        assert_eq!(fs::read_to_string(folder.join("settings.json")).unwrap(), settings, "its settings and hook state stay");
        assert_eq!(fs::read_to_string(folder.join(".claude.json")).unwrap(), trust, "its project trust stays");
        assert_eq!(fs::read_to_string(transcripts.join("session.jsonl")).unwrap(), "a turn\n", "its transcript stays");
        assert!(!folder.join(CREDENTIALS).exists(), "only the sign-in file is deleted");
        assert!(!dir.join(secrets::VAULT).join("claude-a1.json").exists(), "and its sealed copy");
        assert!(load(&store.lock().unwrap()).is_empty());
    }

    #[test]
    fn a_finished_sign_in_is_listed_with_email_and_organisation_and_sealed() {
        let (dir, store) = profile("ok");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        assert_eq!(a.email.as_deref(), Some("sam@example.com"));
        assert_eq!(a.organization.as_deref(), Some("Example Org"));
        let vault = fs::read_to_string(dir.join("vault").join("claude-a1.json")).unwrap();
        assert!(!vault.contains("fake-refresh"), "the kept copy is sealed");
        assert_eq!(load(&store.lock().unwrap()), vec![a.clone()]);
        assert_eq!(active(&store.lock().unwrap()), None, "adding does not change the active account");
    }

    #[test]
    fn a_stale_account_is_marked_once_and_a_new_sign_in_clears_it() {
        let (dir, store) = profile("stale");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        {
            let s = store.lock().unwrap();
            assert!(mark_stale(&s, "a1", true).unwrap());
            assert!(!mark_stale(&s, "a1", true).unwrap(), "no change, no write");
            assert!(!mark_stale(&s, "gone", true).unwrap());
            assert!(load(&s)[0].stale);
        }
        // an older record without the field reads as fresh
        assert!(!serde_json::from_str::<Account>(r#"{"id":"x","email":null,"organization":null,"configDir":"d","lastSignIn":1}"#).unwrap().stale);
        sign_in(&store, &dir, "a1", true, 8, writes(r#"{"claudeAiOauth":{"accessToken":"fake-2"}}"#, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        assert!(!load(&store.lock().unwrap())[0].stale, "Sign in again clears it");
    }

    #[test]
    fn a_cancelled_or_empty_sign_in_keeps_nothing() {
        let (dir, store) = profile("cancel");
        let err = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Cancelled), |_| Some(SIGNED_IN.into())).unwrap_err();
        assert_eq!(err, "Sign-in cancelled.");
        let err = sign_in(&store, &dir, "a2", false, 7, |_| ("Login failed: see https://claude.ai/x?code=abcdefghijklmnopqrstu".into(), Ended::Exited(Some(1))), |_| Some(SIGNED_IN.into())).unwrap_err();
        assert!(!err.message.contains("https://") && !err.message.contains("abcdefghijklmnopqrstu"), "no link or code in the error: {err}");
        assert_eq!(err.reason, "sign-in-refused", "a refused sign-in offers Try again");
        assert!(load(&store.lock().unwrap()).is_empty());
        assert!(!dir.join(FOLDER).join("a1").exists() && !dir.join(FOLDER).join("a2").exists(), "no partial folder left");
    }

    #[test]
    fn a_failed_re_authentication_puts_the_earlier_credentials_back() {
        let (dir, store) = profile("reauth");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let creds = Path::new(&a.config_dir).join(CREDENTIALS);
        // The login wipes the file and gives up partway.
        let err = sign_in(&store, &dir, "a1", true, 9, |d| {
            fs::remove_file(d.join(CREDENTIALS)).unwrap();
            (String::new(), Ended::Exited(Some(1)))
        }, |_| None);
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(&creds).unwrap(), CREDS, "earlier credentials restored");
        // The same credentials as before are never taken as a new sign-in.
        assert!(sign_in(&store, &dir, "a1", true, 9, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(load(&store.lock().unwrap())[0].last_sign_in, 7, "the row is unchanged");
    }

    #[test]
    fn claude_codes_own_sign_in_is_reported_as_signed_in_signed_out_or_unknown() {
        assert_eq!(own_sign_in(Some(SIGNED_IN)), OwnSignIn { state: "signed-in", email: Some("sam@example.com".into()) });
        assert_eq!(own_sign_in(Some(r#"{"loggedIn":false}"#)).state, "signed-out");
        assert_eq!(own_sign_in(Some("")).state, "signed-out", "an empty answer is not a sign-in");
        assert_eq!(own_sign_in(None).state, "unknown", "no answer in time is not reported as signed out");
    }

    #[test]
    fn identity_needs_a_signed_in_status() {
        assert_eq!(identity(SIGNED_IN), Some((Some("sam@example.com".into()), Some("Example Org".into()))));
        assert_eq!(identity(r#"{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}"#), None);
        assert_eq!(identity(r#"{"loggedIn":true,"account":{"emailAddress":"x@y.z"},"organization":{"name":"Org"}}"#), Some((Some("x@y.z".into()), Some("Org".into()))));
        assert_eq!(identity("not json"), None);
    }

    #[test]
    fn key_mode_wins_and_only_claude_panes_get_the_account() {
        let d = Some(r"C:\p\claude-accounts\a1".to_string());
        assert_eq!(pane_env(Some("claude"), false, d.clone()), Some((CONFIG_ENV, d.clone().unwrap())));
        assert_eq!(pane_env(Some("claude"), true, d.clone()), None, "the 1-year key wins");
        assert_eq!(pane_env(Some("codex"), false, d.clone()), None);
        assert_eq!(pane_env(None, false, d), None);
        assert_eq!(pane_env(Some("claude"), false, None), None);
    }

    /// launch FIX-4: a Command that is a bare path with a space starts fine, so it gets the account too.
    #[test]
    fn fix4_a_claude_path_with_a_space_gets_the_account() {
        let d = Some(r"C:\p\claude-accounts\a1".to_string());
        assert_eq!(pane_env(Some(r"C:\Program Files\Claude\claude.exe"), false, d.clone()), Some((CONFIG_ENV, d.clone().unwrap())));
        assert_eq!(pane_env(Some(r"C:\Program Files\Tools\notclaude.exe"), false, d), None);
    }

    #[test]
    fn upkeep_is_left_to_claude_code_unless_turned_off() {
        assert!(upkeep_left_to_claude(&json!({})));
        assert!(!upkeep_left_to_claude(&json!({ UPKEEP_FIELD: false })));
    }

    #[test]
    fn acct_024_own_settings_that_sign_in_are_named() {
        let env = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        let found = sign_in_overrides(&env(&[("ANTHROPIC_API_KEY", "sk-made-up"), ("ANTHROPIC_BASE_URL", "https://proxy.example"), ("ANTHROPIC_AUTH_TOKEN", "")]), false);
        assert_eq!(found, vec!["ANTHROPIC_API_KEY".to_string()], "an endpoint is fine, a blanked token is fine");
        assert_eq!(sign_in_overrides(&env(&[("anthropic_auth_token", "t")]), true), vec!["anthropic_auth_token".to_string()], "Windows names ignore case");
        assert!(sign_in_overrides(&env(&[("anthropic_auth_token", "t")]), false).is_empty(), "elsewhere names are exact");
        assert_eq!(sign_in_overrides(&env(&[("CLAUDE_CODE_OAUTH_TOKEN", "t")]), false).len(), 1);
    }

    // Row 984: a store with one managed account (its folder exists), a Kolux-made worktree, and the
    // app's own file path; nothing here reads or writes the real ~/.claude.
    struct Trust {
        _dir: crate::test_dir::TempDir,
        store: Mutex<Store>,
        account_file: PathBuf,
        process_file: PathBuf,
        worktree: PathBuf,
    }

    fn trust_fixture(tag: &str, active_account: bool) -> Trust {
        let (dir, store) = profile(tag);
        let (account_dir, worktree) = (dir.join("acct1"), dir.join("wt"));
        fs::create_dir_all(&account_dir).unwrap();
        fs::create_dir_all(&worktree).unwrap();
        {
            let s = store.lock().unwrap();
            save(&s, &[Account { id: "a1".into(), email: None, organization: None, config_dir: account_dir.to_string_lossy().into(), last_sign_in: 1, stale: false }]).unwrap();
            if active_account {
                activate(&s, Some("a1")).unwrap();
            }
            crate::projects::set_origin(&s, &worktree.to_string_lossy(), Some(&json!({ "madeBy": "app" }))).unwrap();
        }
        Trust { account_file: account_dir.join(".claude.json"), process_file: dir.join("process").join(".claude.json"), worktree, store, _dir: dir }
    }

    fn key_mode(t: &Trust) {
        let set = serde_json::Map::from_iter([(crate::claude_key::MODE_FIELD.to_string(), json!(crate::claude_key::KEY_MODE))]);
        t.store.lock().unwrap().patch_settings(&set, &[]).unwrap();
    }

    fn trusted_in(file: &Path, t: &Trust) -> bool {
        let doc: Value = serde_json::from_str(&fs::read_to_string(file).unwrap_or_else(|_| "{}".into())).unwrap();
        doc["projects"][crate::trust::claude_key(&t.worktree).unwrap()]["hasTrustDialogAccepted"] == true
    }

    #[test]
    fn row984_a_launch_trusts_the_active_accounts_file_and_leaves_the_process_file_alone() {
        let t = trust_fixture("row984-managed", true);
        let n = crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert_eq!(n, 1);
        assert!(trusted_in(&t.account_file, &t), "the account's own .claude.json carries the trust");
        assert!(!t.process_file.exists(), "the app's file is not created");
    }

    #[test]
    fn row984_key_mode_trusts_the_process_file() {
        let t = trust_fixture("row984-key", true);
        key_mode(&t);
        crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&t.process_file, &t));
        assert!(!t.account_file.exists(), "key mode pane gets no account folder");
    }

    #[test]
    fn row984_no_active_account_trusts_the_process_file_and_a_switch_is_followed() {
        let t = trust_fixture("row984-none", false);
        assert_eq!(pane_config_file(&t.store.lock().unwrap(), t.process_file.clone()), t.process_file);
        crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&t.process_file, &t));
        assert!(!t.account_file.exists());
        activate(&t.store.lock().unwrap(), Some("a1")).unwrap();
        assert_eq!(pane_config_file(&t.store.lock().unwrap(), t.process_file.clone()), t.account_file, "read at launch time, so the switch counts");
    }

    fn claude_command(t: &Trust, command: &str) {
        let set = serde_json::Map::from_iter([(crate::agents::OPTIONS_FIELD.to_string(), json!({ "claude": { "command": command } }))]);
        t.store.lock().unwrap().patch_settings(&set, &[]).unwrap();
    }

    // Review M1: the pane runs the user's own command, so trust follows what that command gets.
    #[test]
    fn row984_a_custom_command_the_pane_gets_no_account_for_trusts_the_process_file() {
        let t = trust_fixture("row984-npx", true);
        claude_command(&t, "  npx @anthropic-ai/claude-code ");
        crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&t.process_file, &t), "no CLAUDE_CONFIG_DIR is set for this command, so it reads the app's file");
        assert!(!t.account_file.exists());
    }

    #[test]
    fn row984_a_custom_command_credited_to_claude_trusts_the_account_file() {
        let t = trust_fixture("row984-path", true);
        claude_command(&t, r"C:\tools\claude.exe");
        crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&t.account_file, &t));
        assert!(!t.process_file.exists());
        claude_command(&t, "   ");
        assert_eq!(pane_config_file(&t.store.lock().unwrap(), t.process_file.clone()), t.account_file, "a blank command is the default claude");
    }

    // Review L1: the CLI server's per-request context (what worker-start trusts through) follows the
    // active account; reverting its claude_config to the app's own file fails this.
    #[test]
    fn row984_the_cli_request_context_trusts_the_active_accounts_file() {
        let t = trust_fixture("row984-cli", true);
        let git = crate::git::Git::detect().unwrap();
        let terminals = crate::terminal::Terminals::default();
        let ctx = crate::cli::request_ctx(&t.store, &git, &terminals, &|_| {}, &|| Ok(()));
        assert_eq!(ctx.claude_config, t.account_file);
        crate::trust::trust_folders(&ctx.claude_config, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&t.account_file, &t));
    }

    // Row 989 ruling: a CLAUDE_CONFIG_DIR the user set in the pane env decides trust too, below the managed account.
    fn own_config_dir(t: &Trust, line: &str) {
        let set = serde_json::Map::from_iter([(crate::agents::OPTIONS_FIELD.to_string(), json!({ "claude": { "env": line } }))]);
        t.store.lock().unwrap().patch_settings(&set, &[]).unwrap();
    }

    #[test]
    fn row989_trust_follows_the_users_config_dir_when_no_account_is_active() {
        let t = trust_fixture("row989-own", false);
        let own = t.worktree.parent().unwrap().join("own-claude");
        own_config_dir(&t, &format!("OTHER=1\nCLAUDE_CONFIG_DIR={}", own.display()));
        assert_eq!(pane_config_file(&t.store.lock().unwrap(), t.process_file.clone()), own.join(".claude.json"));
        crate::trust::trust_for_launch(&t.store, &t.process_file, "claude", std::slice::from_ref(&t.worktree)).unwrap();
        assert!(trusted_in(&own.join(".claude.json"), &t), "the user's own folder carries the trust");
        assert!(!t.process_file.exists());
    }

    #[test]
    fn row989_an_active_account_wins_over_the_users_config_dir_and_key_mode_does_not() {
        let t = trust_fixture("row989-both", true);
        let own = t.worktree.parent().unwrap().join("own-claude");
        own_config_dir(&t, &format!("claude_config_dir={}", own.display()));
        let file = || pane_config_file(&t.store.lock().unwrap(), t.process_file.clone());
        assert_eq!(file(), t.account_file, "Kolux's account variable is applied after the user's");
        key_mode(&t);
        assert_eq!(file(), own.join(".claude.json"), "key mode hands no account, so the user's own folder is what the pane gets");
    }

    #[test]
    fn row989_a_blank_or_relative_user_config_dir_is_ignored() {
        let t = trust_fixture("row989-rel", false);
        for line in ["CLAUDE_CONFIG_DIR=", "CLAUDE_CONFIG_DIR=relative/dir", "NOT_IT=C:/x"] {
            own_config_dir(&t, line);
            assert_eq!(pane_config_file(&t.store.lock().unwrap(), t.process_file.clone()), t.process_file, "{line}");
        }
    }
}
