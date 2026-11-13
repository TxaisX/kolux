//! Secrets sealed on disk (ACCT-009). Every key and sign-in Kolux keeps is sealed with the
//! operating system's own user-bound protection before it touches a file: Windows DPAPI
//! (`CryptProtectData`, current-user scope) through `windows-sys`. Elsewhere there is no real
//! keyring in this build, so values are only scrambled and the log says so once.
//!
//! Two places hold secrets:
//! - the settings file, in the fields named by [`SECRET_SETTINGS`] (the Claude 1-year key and
//!   the xAI key); the front end never receives them (ACCT-011, T-154) and never writes them;
//!   they change only through [`secret_set`] / [`secret_clear`];
//! - the `vault` folder in the profile, one sealed file per managed sign-in (managed Claude
//!   credentials, Codex account details; written by T-043 through [`write_file`]).
//!
//! A value or file that is still in the clear (older release, or sealing unavailable at the
//! time) always loads, and the one-off pass after the first window seals it. Nothing is ever
//! lost: a value that cannot be sealed stays as it was, a sealed file that cannot be opened is
//! moved aside, not deleted.

use crate::state::Store;
use base64::Engine;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Settings fields that hold secrets (SAFE-026): the Claude 1-year key (ACCT-004), the xAI key
/// (ACCT-008), the Moonshot key for the Kimi balance (T-547), and the HTTP proxy address and browser search-session link, which have no screen
/// yet (OD-18; their settings come with T-240 and T-323 under these names).
pub const SECRET_SETTINGS: &[&str] = &["claudeOauthToken", "xaiApiKey", "httpProxy", "browserSearchSessionUrl", "minimaxCookie", "minimaxApiKey", "moonshotApiKey"];
/// SAFE-026: what a save says while the system's secret store is not answering.
const STORE_DOWN: &str = "the system secret store is not answering";
/// Marks a sealed value; the part after it is base64 of the sealed bytes.
const PREFIX: &str = "kolux-sealed:v1:";
/// A sealed value made where only scrambling was available.
const PREFIX_SCRAMBLED: &str = "kolux-scrambled:v1:";
/// The folder in the profile holding one sealed file per managed sign-in.
pub const VAULT: &str = "vault";
/// State key: the one-off sealing pass has run (carried over, COMPAT ACCT-009).
pub const PASS_DONE: &str = "secretsSealingPassDone";
/// State key: which protection sealed values last time, so the log notes a change once.
const BACKEND_KEY: &str = "secretsBackend";
/// State key: the secret fields dropped because they could not be opened (ACCT-010), as a JSON
/// list, kept until the user dismisses the note or stores that secret again.
const DROPPED_KEY: &str = "secretsDropped";

/// Which protection this computer gives secrets.
pub fn backend() -> &'static str {
    if cfg!(windows) {
        "dpapi"
    } else {
        "scrambled"
    }
}

#[cfg(test)]
thread_local! { static DOWN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

/// Tests stand in for a secret store outage, one test thread at a time.
#[cfg(test)]
fn set_store_down(down: bool) {
    DOWN.with(|d| d.set(down));
}

/// SAFE-026: whether the secret store is treated as down. A development build also takes
/// `KOLUX_RS_SECRET_STORE_DOWN` so the outage can be shown live; a release build never does.
fn store_down() -> bool {
    #[cfg(test)]
    if DOWN.with(|d| d.get()) {
        return true;
    }
    cfg!(debug_assertions) && std::env::var_os("KOLUX_RS_SECRET_STORE_DOWN").is_some()
}

/// Whether the secret store seals and opens a fresh value right now.
fn store_works() -> bool {
    seal("kolux-probe").and_then(|v| unseal(&v)).is_ok()
}

pub fn is_sealed(v: &str) -> bool {
    v.starts_with(PREFIX) || v.starts_with(PREFIX_SCRAMBLED)
}

/// Seals `plain`. An already sealed value is returned as it is.
pub fn seal(plain: &str) -> Result<String, String> {
    if is_sealed(plain) {
        return Ok(plain.to_string());
    }
    if store_down() {
        return Err(STORE_DOWN.into());
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    #[cfg(windows)]
    {
        Ok(format!("{PREFIX}{}", b64.encode(dpapi::protect(plain.as_bytes())?)))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("{PREFIX_SCRAMBLED}{}", b64.encode(scramble(plain.as_bytes()))))
    }
}

/// Opens a value. A value in the clear (older release) is returned as it is.
pub fn unseal(v: &str) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    if let Some(rest) = v.strip_prefix(PREFIX) {
        if store_down() {
            return Err(STORE_DOWN.into());
        }
        let bytes = b64.decode(rest).map_err(|_| "the sealed value is damaged".to_string())?;
        #[cfg(windows)]
        let plain = dpapi::unprotect(&bytes)?;
        #[cfg(not(windows))]
        let plain: Vec<u8> = {
            let _ = bytes;
            return Err("this value was sealed on Windows and cannot be opened here".into());
        };
        return String::from_utf8(plain).map_err(|_| "the sealed value is damaged".to_string());
    }
    if let Some(rest) = v.strip_prefix(PREFIX_SCRAMBLED) {
        let bytes = b64.decode(rest).map_err(|_| "the sealed value is damaged".to_string())?;
        return String::from_utf8(scramble(&bytes)).map_err(|_| "the sealed value is damaged".to_string());
    }
    Ok(v.to_string())
}

/// Reversible scramble for systems without a real keyring; not protection, and logged as such.
fn scramble(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().enumerate().map(|(i, b)| b ^ (0x5a ^ (i as u8).wrapping_mul(31))).collect()
}

/// Seals every clear secret field of a settings object in place. A field that cannot be sealed
/// is left as it was. Returns how many fields were sealed.
pub fn seal_settings(value: &mut Value) -> usize {
    let mut n = 0;
    if let Some(obj) = value.as_object_mut() {
        for key in SECRET_SETTINGS {
            if let Some(Value::String(s)) = obj.get(*key) {
                if !s.is_empty() && !is_sealed(s) {
                    if let Ok(sealed) = seal(s) {
                        obj.insert((*key).to_string(), Value::String(sealed));
                        n += 1;
                    }
                }
            }
        }
    }
    n
}

/// Settings as the window may see them: the secret fields are taken out.
pub fn without_secrets(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        for key in SECRET_SETTINGS {
            obj.remove(*key);
        }
    }
    value
}

/// Settings the window sends back: its secret fields are ignored and the stored ones kept.
pub fn keep_stored_secrets(stored: &Value, mut incoming: Value) -> Value {
    if let Some(obj) = incoming.as_object_mut() {
        for key in SECRET_SETTINGS {
            obj.remove(*key);
            if let Some(v) = stored.get(*key) {
                obj.insert((*key).to_string(), v.clone());
            }
        }
    }
    incoming
}

/// Reads a secret settings field, opened. `None` when it is not set.
pub fn read_setting(store: &Store, key: &str) -> Result<Option<String>, String> {
    match store.settings().get(key) {
        Some(Value::String(s)) if !s.is_empty() => unseal(s).map(Some),
        _ => Ok(None),
    }
}

/// Rows 653/654: the fields that hold one API key, which goes into an Authorization header.
pub const API_KEY_FIELDS: &[&str] = &["moonshotApiKey", "minimaxApiKey"];
/// Rows 654: the longest an API key may be (bytes).
pub const API_KEY_MAX: usize = 512;

/// Rows 653/654: an API key field only ever stores one short line of visible characters, whoever
/// writes it (the Accounts page, the usage page or the generic secret command), so a pasted line
/// break cannot reach a header and a huge paste cannot fill the settings file. Other secret
/// fields, and an already sealed value, are not checked here.
pub fn check_api_key(key: &str, plain: &str) -> Result<(), String> {
    if !API_KEY_FIELDS.contains(&key) || is_sealed(plain) {
        return Ok(());
    }
    if plain.len() > API_KEY_MAX {
        return Err(format!("A key is at most {API_KEY_MAX} characters"));
    }
    if plain.chars().any(|c| c.is_whitespace() || c.is_control() || !c.is_ascii()) {
        return Err("A key is one line of letters, digits and symbols with no spaces".into());
    }
    Ok(())
}

/// Stores a secret settings field sealed. Refuses to store it in the clear: while the secret
/// store is down the save fails and the value saved earlier stays as it was (SAFE-026). Callers
/// hold the store lock across the seal and the write, so a slower save can never land after a
/// newer one.
pub fn write_setting(store: &Store, key: &str, plain: &str) -> Result<(), String> {
    if !SECRET_SETTINGS.contains(&key) {
        return Err(format!("{key} is not a secret field"));
    }
    check_api_key(key, plain)?;
    let sealed = seal(plain).map_err(|e| format!("{e}; nothing was saved"))?;
    // Card 13: the reconnect note is read first, so a note that cannot be kept aside refuses before the key is stored.
    let mut left: Vec<String> = crate::orchestration::kept::load(store, DROPPED_KEY).map_err(|e| format!("{e}; nothing was saved"))?;
    let mut settings = store.settings();
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings[key] = Value::String(sealed);
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    // ACCT-010: a key stored again is no longer one to reconnect.
    left.retain(|k| k != key);
    let _ = store.set(DROPPED_KEY, &Value::from(left).to_string());
    Ok(())
}

/// ACCT-010: drops each secret settings field that is sealed but can no longer be opened (a new
/// Windows profile, a restored backup) and leaves every other setting as it was. The dropped
/// names are added to the reconnect note; returns the ones dropped now. Runs before the window
/// loads, so the connection already shows as not connected.
pub fn drop_unreadable(store: &Store, dir: &Path) -> Vec<String> {
    let mut settings = store.settings();
    let Some(obj) = settings.as_object_mut() else { return Vec::new() };
    let gone: Vec<String> = SECRET_SETTINGS
        .iter()
        .filter(|k| matches!(obj.get(**k), Some(Value::String(s)) if !s.is_empty() && unseal(s).is_err()))
        .map(|k| k.to_string())
        .collect();
    if gone.is_empty() {
        return gone;
    }
    // SAFE-026: when the store itself is down, nothing is unreadable yet; the keys stay sealed.
    if !store_works() {
        log(dir, "secrets: the system secret store is not answering; stored keys are left sealed as they are");
        return Vec::new();
    }
    // Card 13: the note is read before anything is cleared, so a note that cannot be kept aside leaves the keys sealed as they are.
    let mut all: Vec<String> = match crate::orchestration::kept::load(store, DROPPED_KEY) {
        Ok(all) => all,
        Err(e) => {
            log(dir, &format!("secrets: {e}; keys that cannot be opened are left as they are"));
            return Vec::new();
        }
    };
    for k in &gone {
        obj.remove(k);
    }
    if let Err(e) = store.save_settings(&settings) {
        log(dir, &format!("secrets: could not clear a key that cannot be opened ({e})"));
        return Vec::new();
    }
    for k in &gone {
        log(dir, &format!("secrets: {k} could not be opened on this computer; cleared, reconnect it"));
        if !all.contains(k) {
            all.push(k.clone());
        }
    }
    let _ = store.set(DROPPED_KEY, &Value::from(all).to_string());
    gone
}

/// ACCT-010: the secret fields waiting for a reconnect, for the note in the main window.
pub fn dropped(store: &Store) -> Vec<String> {
    crate::orchestration::kept::or_default(store, DROPPED_KEY)
}

pub fn dismiss_dropped(store: &Store) -> Result<(), String> {
    // Read first: a blob that cannot be kept aside fails the dismiss rather than being overwritten blind.
    crate::orchestration::kept::load::<Vec<String>>(store, DROPPED_KEY)?;
    store.set(DROPPED_KEY, "[]").map_err(|e| e.to_string())
}

/// ACCT-011: every Claude key in `line` (`sk-ant-` and the URL-safe characters after it)
/// becomes `sk-ant-[masked]`.
pub fn mask(line: &str) -> String {
    const KEY: &str = "sk-ant-";
    const DONE: &str = "[masked]";
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(i) = rest.find(KEY) {
        out.push_str(&rest[..i]);
        out.push_str("sk-ant-[masked]");
        // The mask itself starts with the key prefix: swallow an existing mask so mask(mask(x)) == mask(x).
        let after = &rest[i + KEY.len()..];
        rest = after.strip_prefix(DONE).unwrap_or(after).trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    }
    out.push_str(rest);
    out
}

/// Writes a vault file sealed, whole or not at all.
pub fn write_file(path: &Path, plain: &str) -> Result<(), String> {
    let sealed = seal(plain)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, sealed).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// ACCT-025: seals each (live sign-in file, vault file) pair again when the live file no longer
/// matches its sealed copy (the agent renewed its token while Kolux ran); a missing live file is
/// skipped. Returns how many were saved.
pub fn save_changed(pairs: &[(PathBuf, PathBuf)], log_dir: &Path) -> usize {
    let mut saved = 0;
    for (live, vault) in pairs {
        let Ok(now) = fs::read_to_string(live) else { continue };
        if read_file(vault, log_dir).ok().flatten().as_deref() != Some(now.as_str()) && write_file(vault, &now).is_ok() {
            saved += 1;
        }
    }
    saved
}

/// ACCT-025: runs one quit step on its own thread and waits at most the limit for it, so quitting
/// never hangs; None when it ran out of time (the thread is left to end with the app).
pub fn within<T: Send + 'static>(limit: std::time::Duration, step: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(step());
    });
    rx.recv_timeout(limit).ok()
}

/// Reads a vault file, opened. A clear file (older release) is read and sealed again. A sealed
/// file that cannot be opened is moved aside (`<name>.unreadable-<secs>`) and reads as `None`.
/// The managed sign-ins of T-043 read through it.
#[allow(dead_code)]
pub fn read_file(path: &Path, log_dir: &Path) -> Result<Option<String>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    match unseal(text.trim_end()) {
        Ok(plain) => {
            if !is_sealed(text.trim_end()) && write_file(path, &plain).is_err() {
                log(log_dir, &format!("secrets: could not seal {} again; left as it was", file_name(path)));
            }
            Ok(Some(plain))
        }
        Err(_) => {
            let aside = move_aside(path)?;
            log(log_dir, &format!("secrets: {} could not be opened; moved to {}", file_name(path), file_name(&aside)));
            Ok(None)
        }
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

#[allow(dead_code)]
fn move_aside(path: &Path) -> Result<PathBuf, String> {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let aside = PathBuf::from(format!("{}.unreadable-{secs}", path.display()));
    fs::rename(path, &aside).map_err(|e| e.to_string())?;
    Ok(aside)
}

/// One line in the app's own log (`diag`, APP-041: rotated and capped). Never carries a secret:
/// a Claude key in it is masked (ACCT-011). Failures are ignored.
pub fn log(dir: &Path, line: &str) {
    crate::diag::write(dir, &mask(line));
}

/// What the one-off pass did, for the tests and the log.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PassReport {
    pub settings_sealed: usize,
    pub files_sealed: usize,
    pub files_moved: usize,
    pub skipped: bool,
}

/// The pass that runs shortly after the first window appears. Notes the protection in use (one
/// log line when it starts, changes or ends being only a scramble), limits the profile folder to
/// the current user, and, once per profile, seals every secret still in the clear. Best effort:
/// failures go to the log, nothing is raised.
pub fn sealing_pass(store: &Mutex<Store>, dir: &Path) -> PassReport {
    let mut report = PassReport::default();
    let Ok(store) = store.lock() else { return report };
    let now = backend();
    let before = store.get(BACKEND_KEY).ok().flatten();
    if before.as_deref() != Some(now) {
        let weak_now = now != "dpapi";
        let weak_before = before.as_deref().is_some_and(|b| b != "dpapi");
        if weak_now || weak_before {
            log(dir, &format!(
                "secrets: protection is now {now}{}",
                if weak_now { " (no real keyring here; values are only scrambled)" } else { "" }
            ));
        }
        let _ = store.set(BACKEND_KEY, now);
    }
    restrict_to_user(dir, dir);
    if store.get(PASS_DONE).ok().flatten().as_deref() == Some("1") {
        report.skipped = true;
        return report;
    }
    let mut settings = store.settings();
    report.settings_sealed = seal_settings(&mut settings);
    if report.settings_sealed > 0 {
        if let Err(e) = store.save_settings(&settings) {
            log(dir, &format!("secrets: could not save the sealed settings ({e}); left as they were"));
            return report;
        }
    }
    for path in vault_files(&dir.join(VAULT)) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        if is_sealed(text.trim_end()) {
            continue;
        }
        match write_file(&path, text.trim_end()) {
            Ok(()) => report.files_sealed += 1,
            Err(e) => log(dir, &format!("secrets: could not seal {} ({e}); left as it was", file_name(&path))),
        }
    }
    let _ = store.set(PASS_DONE, "1");
    log(dir, &format!("secrets: one-off sealing pass sealed {} settings field(s) and {} file(s)", report.settings_sealed, report.files_sealed));
    report
}

fn vault_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(vault_files(&p));
        } else if !file_name(&p).contains(".unreadable-") && p.extension().is_none_or(|x| x != "tmp") {
            out.push(p);
        }
    }
    out
}

/// Rewrites the folder's permissions so only the current user has access (files inside inherit
/// it). Best effort: failures go to the log.
pub fn restrict_to_user(path: &Path, log_dir: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let (Ok(user), domain) = (std::env::var("USERNAME"), std::env::var("USERDOMAIN").ok()) else {
            log(log_dir, "secrets: could not tell the current user; folder permissions left as they were");
            return;
        };
        let who = match domain { Some(d) if !d.is_empty() => format!("{d}\\{user}"), _ => user };
        let out = std::process::Command::new("icacls")
            .arg(path)
            .args(["/inheritance:r", "/grant:r"])
            .arg(format!("{who}:(OI)(CI)F"))
            .arg("/q")
            .creation_flags(crate::winproc::no_window()) // CREATE_NO_WINDOW
            .output();
        match out {
            Ok(o) if o.status.success() => {}
            Ok(o) => log(log_dir, &format!("secrets: folder permissions not changed (icacls exit {:?})", o.status.code())),
            Err(e) => log(log_dir, &format!("secrets: folder permissions not changed ({e})")),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o700)) {
            log(log_dir, &format!("secrets: folder permissions not changed ({e})"));
        }
    }
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(input: &[u8], seal: bool) -> Result<Vec<u8>, String> {
        let len = u32::try_from(input.len()).map_err(|_| "the value is too large".to_string())?;
        let blob_in = CRYPT_INTEGER_BLOB { cbData: len, pbData: input.as_ptr() as *mut u8 };
        let mut blob_out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: both blobs point at valid memory for the call; the output buffer is allocated
        // by the system, copied out, then freed with LocalFree as the API requires.
        let ok = unsafe {
            if seal {
                CryptProtectData(&blob_in, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut blob_out)
            } else {
                CryptUnprotectData(&blob_in, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut blob_out)
            }
        };
        if ok == 0 || blob_out.pbData.is_null() {
            return Err(if seal { "the system secret store could not seal the value" } else { "the system could not open the sealed value" }.into());
        }
        // SAFETY: the system returned cbData bytes at pbData.
        let out = unsafe { std::slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec() };
        unsafe { LocalFree(blob_out.pbData as HLOCAL) };
        Ok(out)
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        run(plain, true)
    }

    pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
        run(sealed, false)
    }
}

/// Whether a secret settings field is set (never its value).
/// ACCT-010: the secret fields to reconnect, by name.
pub fn secrets_dropped_on(store: &Mutex<Store>) -> Result<Vec<String>, String> {
    Ok(dropped(&*store.lock().map_err(|e| e.to_string())?))
}

/// Async so the wait for the store lock (up to 290 ms behind a background save) is not spent on the UI thread.
#[tauri::command]
pub async fn secrets_dropped(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || secrets_dropped_on(&tauri::Manager::state::<Mutex<Store>>(&app))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn secrets_dropped_dismiss(store: tauri::State<'_, Mutex<Store>>) -> Result<(), String> {
    dismiss_dropped(&*store.lock().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn secret_status(store: tauri::State<'_, Mutex<Store>>, key: String) -> Result<bool, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(read_setting(&store, &key).ok().flatten().is_some())
}

/// Stores a secret settings field, sealed.
#[tauri::command]
pub fn secret_set(store: tauri::State<'_, Mutex<Store>>, key: String, value: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    write_setting(&store, &key, value.trim())
}

/// Removes a secret settings field.
#[tauri::command]
pub fn secret_clear(store: tauri::State<'_, Mutex<Store>>, key: String) -> Result<(), String> {
    clear_setting(&*store.lock().map_err(|e| e.to_string())?, &key)
}

/// Removes a secret settings field; needs no secret store, so a clear always holds (SAFE-026).
pub fn clear_setting(store: &Store, key: &str) -> Result<(), String> {
    if !SECRET_SETTINGS.contains(&key) {
        return Err(format!("{key} is not a secret field"));
    }
    let mut settings = store.settings();
    if let Some(obj) = settings.as_object_mut() {
        obj.remove(key);
    }
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    forget_in_backup(&store.dir().join("settings.json.bak"), key)
}

/// After-list row 655: the save above made the file from before the forget the last good copy,
/// so the key is taken out of that copy too (written beside it, then moved into place). The rest
/// of the copy stays; a copy that does not read as a JSON object, or has no such key, is left as it is.
fn forget_in_backup(bak: &Path, key: &str) -> Result<(), String> {
    let Ok(bytes) = fs::read(bak) else { return Ok(()) };
    let Ok(mut copy) = serde_json::from_slice::<Value>(&bytes) else { return Ok(()) };
    if copy.as_object_mut().and_then(|o| o.remove(key)).is_none() {
        return Ok(());
    }
    let tmp = bak.with_extension("bak.tmp");
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&serde_json::to_vec_pretty(&copy)?)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, bak)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("the key was removed from settings, but its old copy in {} could not be cleared: {e}", bak.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ACCT-025: on quit a sign-in the agent renewed is sealed again; an unchanged or missing one
    // is left alone, and a step that hangs is given up after its time limit.
    // Rows 653/654: the generic path refuses what the usage page refuses, and a key has a length cap.
    #[test]
    fn row653_an_api_key_field_refuses_line_breaks_spaces_and_a_huge_paste() {
        let dir = temp_dir("row653");
        let store = Store::open(&dir).unwrap();
        for bad in ["sk-moon\r\nX-Evil: 1", "two parts", "tab\tkey", "caf\u{e9}-key"] {
            assert!(write_setting(&store, "moonshotApiKey", bad).is_err(), "{bad:?}");
            assert!(write_setting(&store, "minimaxApiKey", bad).is_err(), "{bad:?}");
        }
        assert!(write_setting(&store, "moonshotApiKey", &"k".repeat(API_KEY_MAX + 1)).is_err(), "over the cap");
        assert!(store.settings().get("moonshotApiKey").is_none(), "a refused key stores nothing");
        // Other secret fields (a cookie can be long and has spaces) are not held to the key rule.
        write_setting(&store, "minimaxCookie", &format!("a=1; b={}", "x".repeat(2000))).unwrap();
        write_setting(&store, "moonshotApiKey", &"k".repeat(API_KEY_MAX)).unwrap();
        assert_eq!(read_setting(&store, "moonshotApiKey").unwrap().map(|k| k.len()), Some(API_KEY_MAX));
    }

    #[test]
    fn renewed_sign_ins_are_sealed_again_on_quit_and_a_hung_step_is_dropped() {
        let dir = crate::test_dir::temp("quit-save");
        let (live, vault, gone) = (dir.join("auth.json"), dir.join("vault").join("codex-a.json"), dir.join("nothing.json"));
        fs::write(&live, r#"{"token":"fake-1"}"#).unwrap();
        write_file(&vault, r#"{"token":"fake-1"}"#).unwrap();
        let pairs = vec![(live.clone(), vault.clone()), (gone, dir.join("vault").join("codex-b.json"))];
        assert_eq!(save_changed(&pairs, &dir), 0);
        assert!(!dir.join("vault").join("codex-b.json").exists(), "nothing is made for a missing sign-in");
        fs::write(&live, r#"{"token":"fake-2"}"#).unwrap();
        assert_eq!(save_changed(&pairs, &dir), 1);
        assert_eq!(read_file(&vault, &dir).unwrap().as_deref(), Some(r#"{"token":"fake-2"}"#));
        assert!(!fs::read_to_string(&vault).unwrap().contains("fake-2"), "the copy is sealed");
        assert_eq!(within(std::time::Duration::from_secs(1), || 7), Some(7));
        let started = std::time::Instant::now();
        assert_eq!(within(std::time::Duration::from_millis(50), || std::thread::sleep(std::time::Duration::from_secs(5))), None);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-secrets-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_key_that_cannot_be_opened_is_dropped_alone_and_named_until_dismissed_or_set_again() {
        let dir = temp_dir("drop");
        let store = Store::open(&dir).unwrap();
        write_setting(&store, "xaiApiKey", "xai-GOOD").unwrap();
        let mut s = store.settings();
        s["claudeOauthToken"] = Value::String(format!("{PREFIX}AAAA"));
        s["claudeConnectionMode"] = "key".into();
        s["theme"] = "classic".into();
        store.save_settings(&s).unwrap();
        assert_eq!(drop_unreadable(&store, &dir), ["claudeOauthToken"]);
        let after = store.settings();
        assert!(after.get("claudeOauthToken").is_none());
        assert_eq!((after["theme"].as_str(), after["claudeConnectionMode"].as_str()), (Some("classic"), Some("key")));
        assert_eq!(read_setting(&store, "xaiApiKey").unwrap().as_deref(), Some("xai-GOOD"));
        assert_eq!(dropped(&store), ["claudeOauthToken"]);
        assert!(drop_unreadable(&store, &dir).is_empty(), "nothing left to drop");
        assert_eq!(dropped(&store), ["claudeOauthToken"], "the note stays until it is dealt with");
        let log = fs::read_to_string(dir.join("logs").join("kolux.log")).unwrap();
        assert!(log.contains("claudeOauthToken could not be opened"), "{log}");
        // Connecting again clears the note; so does dismissing it.
        write_setting(&store, "claudeOauthToken", "sk-ant-oat01-NEW").unwrap();
        assert!(dropped(&store).is_empty());
        let mut s = store.settings();
        s["xaiApiKey"] = Value::String(format!("{PREFIX}BBBB"));
        store.save_settings(&s).unwrap();
        assert_eq!(drop_unreadable(&store, &dir), ["xaiApiKey"]);
        dismiss_dropped(&store).unwrap();
        assert!(dropped(&store).is_empty());
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn card13_a_reconnect_note_that_cannot_be_kept_aside_is_never_saved_over() {
        let dir = temp_dir("noteaside");
        let store = Store::open(&dir).unwrap();
        let broken = "[\"claudeOauthTok";
        store.set(DROPPED_KEY, broken).unwrap();
        let mut s = store.settings();
        s["claudeOauthToken"] = Value::String(format!("{PREFIX}AAAA"));
        store.save_settings(&s).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        assert!(drop_unreadable(&store, &dir).is_empty(), "nothing is cleared while the note cannot be read");
        assert_eq!(store.settings()["claudeOauthToken"].as_str(), Some(format!("{PREFIX}AAAA").as_str()), "the key stays as it was");
        let err = write_setting(&store, "xaiApiKey", "xai-NEW").unwrap_err();
        assert!(err.contains(DROPPED_KEY) && err.contains("nothing was saved"), "{err}");
        assert!(store.settings().get("xaiApiKey").is_none());
        assert_eq!(store.get(DROPPED_KEY).unwrap().as_deref(), Some(broken), "the note blob is byte-identical");
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn card16c_a_failed_note_read_for_display_does_not_block_the_next_key_save_from_clearing_the_note() {
        let dir = temp_dir("note-display");
        let store = Store::open(&dir).unwrap();
        store.set(DROPPED_KEY, "[\"xaiApiKey\"]").unwrap();
        let side = crate::orchestration::kept::Unreadable::new(&dir);
        assert!(dropped(&store).is_empty(), "the display falls back to nothing");
        side.restore();
        write_setting(&store, "xaiApiKey", "xai-NEW").unwrap();
        assert_eq!(store.get(DROPPED_KEY).unwrap().as_deref(), Some("[]"), "the key stored again is no longer one to reconnect");
        drop(side);
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn card16c_dismissing_a_note_that_cannot_be_kept_aside_fails_and_leaves_the_blob() {
        let dir = temp_dir("note-dismiss");
        let store = Store::open(&dir).unwrap();
        let broken = "[\"claudeOauthTok";
        store.set(DROPPED_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let err = dismiss_dropped(&store).unwrap_err();
        assert!(err.contains(DROPPED_KEY), "{err}");
        assert_eq!(store.get(DROPPED_KEY).unwrap().as_deref(), Some(broken), "the note blob is byte-identical");
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    // After-list row 655 (T-547 review): Forget must not leave the sealed key in the last good copy.
    #[test]
    fn a_forgotten_key_is_gone_from_the_backup_and_the_other_settings_stay_in_it() {
        let dir = temp_dir("forget-bak");
        let store = Store::open(&dir).unwrap();
        write_setting(&store, "xaiApiKey", "xai-FORGET").unwrap();
        let mut s = store.settings();
        s["theme"] = "classic".into();
        store.save_settings(&s).unwrap();
        write_setting(&store, "claudeOauthToken", "sk-ant-oat01-KEEP").unwrap();
        let bak = dir.join("settings.json.bak");
        let sealed = store.settings()["xaiApiKey"].as_str().unwrap().to_string();
        assert!(fs::read_to_string(&bak).unwrap().contains(&sealed), "the backup holds the key before the forget");
        clear_setting(&store, "xaiApiKey").unwrap();
        let after: Value = serde_json::from_slice(&fs::read(&bak).unwrap()).unwrap();
        assert!(after.get("xaiApiKey").is_none(), "{after}");
        assert_eq!(after["theme"], "classic", "the rest of the last good copy stays");
        assert!(!fs::read_to_string(dir.join("settings.json")).unwrap().contains(&sealed));
        assert!(!dir.join("settings.json.bak.tmp").exists());
        // A second forget of the same key (nothing left to take out) still works.
        clear_setting(&store, "xaiApiKey").unwrap();
        assert!(!fs::read_to_string(&bak).unwrap().contains(&sealed));
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn while_the_secret_store_is_down_nothing_is_written_in_the_clear_and_a_clear_stays_cleared() {
        let dir = temp_dir("outage");
        let store = Store::open(&dir).unwrap();
        for key in SECRET_SETTINGS {
            write_setting(&store, key, &format!("{key}-FIRST")).unwrap();
        }
        let before = store.settings();
        set_store_down(true);
        // A save is refused with the secret store named; the sealed value saved earlier stays.
        let err = write_setting(&store, "claudeOauthToken", "sk-ant-oat01-SECOND").unwrap_err();
        assert!(err.contains("secret store"), "{err}");
        assert_eq!(store.settings(), before);
        // A key that cannot be opened only because the store is down is never dropped.
        assert!(drop_unreadable(&store, &dir).is_empty());
        assert_eq!(store.settings(), before);
        // A deliberate clear is honoured at once and does not come back with the store.
        clear_setting(&store, "xaiApiKey").unwrap();
        set_store_down(false);
        assert_eq!(read_setting(&store, "xaiApiKey").unwrap(), None);
        assert_eq!(read_setting(&store, "claudeOauthToken").unwrap().as_deref(), Some("claudeOauthToken-FIRST"));
        // On disk no secret is ever in the clear, and the window gets none of them.
        let disk = fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!disk.contains("-FIRST") && !disk.contains("SECOND"), "{disk}");
        assert_eq!(SECRET_SETTINGS.len(), 7);
        let shown = without_secrets(store.settings());
        assert!(SECRET_SETTINGS.iter().all(|k| shown.get(*k).is_none()), "{shown}");
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_log_masks_a_claude_key_wherever_it_appears() {
        let dir = temp_dir("mask");
        log(&dir, "claude-key: kept sk-ant-oat01-AbC_d-123 then sk-ant-oat01-ZZZ.");
        let text = fs::read_to_string(dir.join("logs").join("kolux.log")).unwrap();
        assert!(!text.contains("AbC_d-123") && !text.contains("ZZZ"), "{text}");
        assert_eq!(text.matches("sk-ant-[masked]").count(), 2, "{text}");
        assert!(text.ends_with(" then sk-ant-[masked].\n"), "{text}");
        assert_eq!(mask("no key here"), "no key here");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn seal_round_trips_and_hides_the_text() {
        let key = "sk-ant-oat01-EXAMPLE-not-a-real-key";
        let sealed = seal(key).unwrap();
        assert!(is_sealed(&sealed));
        assert!(!sealed.contains("EXAMPLE"));
        assert_eq!(unseal(&sealed).unwrap(), key);
        // sealing twice changes nothing; a clear value from an older release opens as it is
        assert_eq!(seal(&sealed).unwrap(), sealed);
        assert_eq!(unseal(key).unwrap(), key);
        // a damaged sealed value is refused, not returned as text
        assert!(unseal(&format!("{PREFIX}AAAA")).is_err());
    }

    #[test]
    fn the_window_never_sees_or_overwrites_a_secret() {
        let stored = serde_json::json!({ "theme": "classic", "claudeOauthToken": "kolux-sealed:v1:abc" });
        let shown = without_secrets(stored.clone());
        assert_eq!(shown, serde_json::json!({ "theme": "classic" }));
        let back = keep_stored_secrets(&stored, serde_json::json!({ "theme": "dark", "claudeOauthToken": "typed" , "xaiApiKey": "x"}));
        assert_eq!(back, serde_json::json!({ "theme": "dark", "claudeOauthToken": "kolux-sealed:v1:abc" }));
    }

    #[test]
    fn a_clear_profile_is_sealed_once_and_still_works() {
        let dir = temp_dir("pass");
        let store = Store::open(&dir).unwrap();
        store
            .save_settings(&serde_json::json!({ "claudeOauthToken": "sk-ant-oat01-CLEAR", "xaiApiKey": "", "theme": "x" }))
            .unwrap();
        fs::create_dir_all(dir.join(VAULT).join("claude")).unwrap();
        fs::write(dir.join(VAULT).join("claude").join("a.json"), "{\"token\":\"CLEARFILE\"}").unwrap();
        let store = Mutex::new(store);
        let r = sealing_pass(&store, &dir);
        assert_eq!((r.settings_sealed, r.files_sealed, r.skipped), (1, 1, false));
        let raw = fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!raw.contains("CLEAR"), "settings file still holds the key text");
        assert!(!fs::read_to_string(dir.join(VAULT).join("claude").join("a.json")).unwrap().contains("CLEARFILE"));
        {
            let s = store.lock().unwrap();
            assert_eq!(read_setting(&s, "claudeOauthToken").unwrap().as_deref(), Some("sk-ant-oat01-CLEAR"));
            assert_eq!(read_setting(&s, "xaiApiKey").unwrap(), None);
            assert_eq!(s.settings()["theme"], "x");
        }
        assert_eq!(read_file(&dir.join(VAULT).join("claude").join("a.json"), &dir).unwrap().as_deref(), Some("{\"token\":\"CLEARFILE\"}"));
        // the pass is one-off; a clear value written later by hand stays readable
        assert!(sealing_pass(&store, &dir).skipped);
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn masking_a_claude_key_twice_gives_the_same_text_and_still_hides_every_key() {
        for text in [
            "key sk-ant-api03-SECRET123 end",
            "sk-ant-a sk-ant-b",
            "sk-ant-[masked]",
            "sk-ant-[masked]SECRETTAIL and sk-ant-oat01-ZZZ",
            "sk-ant-sk-ant-SECRET",
            "x sk-ant-SECRET[masked] y",
        ] {
            let once = mask(text);
            assert_eq!(mask(&once), once, "mask changed an already masked text: {text:?}");
            assert!(!once.contains("SECRET") && !once.contains("ZZZ"), "{once}");
        }
        assert_eq!(mask("sk-ant-api03-SECRET123"), "sk-ant-[masked]");
        assert_eq!(mask("sk-ant-[masked]"), "sk-ant-[masked]");
    }

    #[test]
    fn written_secrets_are_sealed_and_unopenable_files_move_aside() {
        let dir = temp_dir("write");
        let store = Store::open(&dir).unwrap();
        write_setting(&store, "claudeOauthToken", "sk-ant-oat01-WRITTEN").unwrap();
        assert!(!fs::read_to_string(dir.join("settings.json")).unwrap().contains("WRITTEN"));
        assert_eq!(read_setting(&store, "claudeOauthToken").unwrap().as_deref(), Some("sk-ant-oat01-WRITTEN"));
        assert!(write_setting(&store, "theme", "x").is_err());
        let f = dir.join(VAULT).join("codex.json");
        write_file(&f, "ACCOUNT").unwrap();
        assert!(!fs::read_to_string(&f).unwrap().contains("ACCOUNT"));
        assert_eq!(read_file(&f, &dir).unwrap().as_deref(), Some("ACCOUNT"));
        // a clear file from an older release is read and sealed again
        fs::write(&f, "OLDCLEAR").unwrap();
        assert_eq!(read_file(&f, &dir).unwrap().as_deref(), Some("OLDCLEAR"));
        assert!(is_sealed(&fs::read_to_string(&f).unwrap()));
        // a sealed file that cannot be opened is moved aside, not deleted
        fs::write(&f, format!("{PREFIX}AAAAAAAA")).unwrap();
        assert_eq!(read_file(&f, &dir).unwrap(), None);
        assert!(!f.exists());
        let moved: Vec<_> = fs::read_dir(dir.join(VAULT)).unwrap().flatten().map(|e| file_name(&e.path())).collect();
        assert!(moved.iter().any(|n| n.starts_with("codex.json.unreadable-")), "{moved:?}");
        assert!(fs::read_to_string(dir.join("logs").join("kolux.log")).unwrap().contains("moved to"));
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod secrets_dropped_async_tests {
    use super::*;

    fn is_async<F: std::future::Future>(_: fn(tauri::AppHandle) -> F) {}

    #[test]
    fn secrets_dropped_is_an_async_command_that_matches_the_sync_one() {
        is_async(secrets_dropped);
        let store = Mutex::new(Store::open(&crate::test_dir::temp("secrets-dropped-async")).unwrap());
        store.lock().unwrap().set(DROPPED_KEY, "[\"moonshotApiKey\"]").unwrap();
        assert_eq!(secrets_dropped_on(&store), Ok(vec!["moonshotApiKey".to_string()]));
        assert_eq!(secrets_dropped_on(&store), Ok(dropped(&store.lock().unwrap())));
    }
}
