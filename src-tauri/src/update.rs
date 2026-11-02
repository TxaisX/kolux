//! Updates (APP-024, APP-025, APP-026, APP-027).
//!
//! The page owns the timetable (start-up, every 30 minutes, retries, offline, focus, wake: see
//! `src/update/schedule.ts`); this module owns the feed, the signed download and the install.
//! A found update downloads by itself and waits in memory; it installs when the user clicks
//! Restart to update, or when the app quits. The app never restarts itself to update.
//!
//! The feed is Kolux RS's own (OD-20): a Tauri update manifest at the latest release of the
//! releases repository. Every download is checked against the minisign public key below; there is
//! no switch that turns that off. Development copies and unpackaged copies never update
//! themselves; a development copy may be pointed at a test feed through two environment
//! variables, which release builds ignore.

use crate::resources::update_care as care;
use crate::resources::update_guard as guard;
use crate::state::Store;
use crate::terminal::Terminals;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update manifest of the newest published release (OD-20: Kolux RS's own feed).
pub const RELEASE_ENDPOINT: &str = "https://github.com/TxaisX/kolux-rs/releases/latest/download/latest.json";
/// The minisign public key releases are signed with. The release job (scripts/release.mjs, T-091)
/// builds it in from the public half of the signing key; a build made without it says it cannot
/// update instead of accepting anything unsigned.
pub const RELEASE_PUBKEY: &str = match option_env!("KOLUX_RS_RELEASE_PUBKEY") {
    Some(k) => k,
    None => "",
};
/// A check that has not answered by then is dropped (APP-024 "a check that stalls").
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Development copies only: a test feed and its key.
pub const ENV_ENDPOINT: &str = "KOLUX_RS_UPDATE_ENDPOINT";
pub const ENV_PUBKEY: &str = "KOLUX_RS_UPDATE_PUBKEY";
/// Release notes in the card are cut to this many lines (APP-027).
pub const NOTE_LINES: usize = 6;

const KEY_LAST_CHECK: &str = "update.lastCheckAt";
const KEY_DISMISSED: &str = "update.dismissedVersion";
const KEY_TIP_DONE: &str = "update.tipDone";

#[derive(Debug, Clone, PartialEq)]
pub struct Feed {
    pub endpoint: String,
    pub pubkey: String,
}

/// Where this copy reads updates from, or why it never updates itself.
/// `debug` is a development build; `installed` is true when the program sits in an installed
/// copy (the installer leaves its uninstaller beside it).
pub fn feed(debug: bool, installed: bool, env: impl Fn(&str) -> Option<String>) -> Result<Feed, String> {
    if debug {
        return match (env(ENV_ENDPOINT), env(ENV_PUBKEY)) {
            (Some(endpoint), Some(pubkey)) if !endpoint.trim().is_empty() && !pubkey.trim().is_empty() => {
                Ok(Feed { endpoint: endpoint.trim().into(), pubkey: pubkey.trim().into() })
            }
            _ => Err("This is a development copy of Kolux RS; it never updates itself.".into()),
        };
    }
    if !installed {
        return Err("This copy of Kolux RS was not installed, so it cannot install updates. Install it from the releases page to get updates.".into());
    }
    if RELEASE_PUBKEY.trim().is_empty() {
        return Err("This build has no update signing key, so it cannot check updates safely.".into());
    }
    Ok(Feed { endpoint: RELEASE_ENDPOINT.into(), pubkey: RELEASE_PUBKEY.into() })
}

fn installed_copy() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

fn this_feed() -> Result<Feed, String> {
    feed(cfg!(debug_assertions), installed_copy(), |k| std::env::var(k).ok())
}

/// Release notes as a few plain lines: headings and empty lines go, list markers are stripped,
/// and the list is cut to `NOTE_LINES` (APP-027).
pub fn clean_notes(body: Option<&str>) -> Vec<String> {
    let Some(body) = body else { return Vec::new() };
    body.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("<!--"))
        .filter(|l| !l.chars().all(|c| c == '-' || c == '=' || c == '*' || c == '_'))
        .map(|l| {
            let l = l.strip_prefix("- ").or_else(|| l.strip_prefix("* ")).or_else(|| l.strip_prefix("+ ")).unwrap_or(l);
            l.trim().to_string()
        })
        .filter(|l| !l.is_empty())
        .take(NOTE_LINES)
        .collect()
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub version: String,
    pub current_version: String,
    pub notes: Vec<String>,
    pub date: Option<String>,
}

fn info_of(u: &Update) -> Info {
    Info {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: clean_notes(u.body.as_deref()),
        date: u.date.map(|d| d.to_string()),
    }
}

/// The update found by the last check, and the one that finished downloading.
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// T-199 (APP-029): Restart to update is already under way; a second click is ignored.
    restarting: AtomicBool,
    watchdog: Arc<care::Watchdog>,
    /// APP-031: the newest check's number.
    rounds: care::CheckRounds,
    /// APP-028: the last install attempt's outcome, read once per launch.
    last_attempt: Mutex<Option<Option<care::LastAttempt>>>,
}

/// T-199 (APP-031): the compatibility mode in force (the variable wins over the saved choice).
fn compat_on(app: &AppHandle) -> bool {
    let saved = app.state::<Mutex<Store>>().lock().ok().and_then(|s| s.get(care::KEY_COMPAT).ok().flatten()).as_deref() == Some("1");
    care::compat_mode(saved, std::env::var(care::ENV_COMPAT).ok().as_deref())
}

/// The hosts a release download is fetched from (GitHub Releases and the storage it redirects to).
pub fn release_host(url: &str) -> bool {
    let Ok(u) = tauri::Url::parse(url) else { return false };
    if u.scheme() != "https" {
        return false;
    }
    let Some(h) = u.host_str() else { return false };
    h == "github.com" || h.ends_with(".githubusercontent.com")
}

/// True only when the release host answers that the named installer is not there (404 or 410). The
/// HEAD goes through the app's one approved public-only client (APP-070), which speaks HTTP/1.1 only.
/// The first request goes only to GitHub's release hosts, over https (the privacy statement names GitHub
/// Releases only); a redirect from there is followed by the same public-only client, so later hops are
/// GitHub's choice, not pinned here. A feed that points anywhere else, such as a local test endpoint, is never asked, so
/// such a feed never sees the "half published" answer; that is accepted.
async fn installer_missing(app: &AppHandle, url: &tauri::Url) -> bool {
    if !release_host(url.as_str()) {
        return false;
    }
    matches!(crate::browser::head(app, url, false, CHECK_TIMEOUT).await, Ok(a) if matches!(a.status, 404 | 410))
}

/// APP-028: what the next launch says about the last install attempt (read once, then removed).
#[tauri::command]
pub fn update_last_attempt(app: AppHandle, updates: State<'_, Updates>) -> Result<Option<care::LastAttempt>, String> {
    let mut cached = updates.last_attempt.lock().map_err(|e| e.to_string())?;
    if let Some(known) = cached.as_ref() {
        return Ok(known.clone());
    }
    let store = app.state::<Mutex<Store>>();
    let store = store.lock().map_err(|e| e.to_string())?;
    let raw = store.get(care::KEY_ATTEMPT).ok().flatten().filter(|v| !v.is_empty());
    let out = care::outcome(raw.as_deref(), &app.package_info().version.to_string(), now_ms());
    if raw.is_some() {
        let _ = store.set(care::KEY_ATTEMPT, "");
    }
    *cached = Some(out.clone());
    Ok(out)
}

/// APP-031: the card's "Use compatibility mode" choice.
#[tauri::command]
pub fn update_compat(store: State<'_, Mutex<Store>>, on: bool) -> Result<(), String> {
    store.lock().map_err(|e| e.to_string())?.set(care::KEY_COMPAT, if on { "1" } else { "0" }).map_err(|e| e.to_string())
}

fn record_attempt(app: &AppHandle, update: &Update) {
    if let Ok(store) = app.state::<Mutex<Store>>().lock() {
        let notes = clean_notes(update.body.as_deref());
        let _ = store.set(care::KEY_ATTEMPT, &care::attempt_json(&update.current_version, &update.version, now_ms(), &notes));
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    reason: Option<String>,
    current_version: String,
    last_check_at: Option<u64>,
    dismissed_version: Option<String>,
    tip_done: bool,
    ready: Option<Info>,
    compat: bool,
}

#[tauri::command]
pub fn update_status(app: AppHandle, store: State<'_, Mutex<Store>>, updates: State<'_, Updates>) -> Result<Status, String> {
    let feed = this_feed();
    let store = store.lock().map_err(|e| e.to_string())?;
    let get = |k: &str| store.get(k).ok().flatten();
    Ok(Status {
        enabled: feed.is_ok(),
        reason: feed.err(),
        current_version: app.package_info().version.to_string(),
        last_check_at: get(KEY_LAST_CHECK).and_then(|v| v.parse().ok()),
        dismissed_version: get(KEY_DISMISSED).filter(|v| !v.is_empty()),
        tip_done: get(KEY_TIP_DONE).as_deref() == Some("1"),
        ready: updates.ready.lock().map_err(|e| e.to_string())?.as_ref().map(|(u, _)| info_of(u)),
        compat: care::compat_mode(get(care::KEY_COMPAT).as_deref() == Some("1"), std::env::var(care::ENV_COMPAT).ok().as_deref()),
    })
}

/// Remembers the dismissed version or that the reassurance tip is done, or empties the refused-installer list.
#[tauri::command]
pub fn update_mark(store: State<'_, Mutex<Store>>, key: String, value: String) -> Result<(), String> {
    let (key, value) = match key.as_str() {
        "dismissedVersion" => (KEY_DISMISSED, value),
        "tipDone" => (KEY_TIP_DONE, value),
        // The refused-installer list can be emptied here, never added to.
        "refusedInstallers" => (guard::KEY_REFUSED, guard::refused_reset_value(&value)?.to_string()),
        _ => return Err(format!("unknown update mark: {key}")),
    };
    store.lock().map_err(|e| e.to_string())?.set(key, &value).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One check against the feed. `None` means this copy is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Info>, String> {
    let feed = this_feed()?;
    let url: tauri::Url = feed.endpoint.parse().map_err(|e| format!("bad update address: {e}"))?;
    // T-324-b (APP-032): the saved proxy; a setting that cannot be used stops the check, never goes around it.
    // T-323-b (SET-040): with the HTTP/1 switch of Settings > General.
    let (route, http1) = {
        let plan = crate::resources::app_http::plan_for(&app, &url)?;
        (plan.route, plan.http1)
    };
    // T-199 (APP-031): checks are numbered; a late answer from an earlier one stores nothing.
    let round = app.state::<Updates>().rounds.begin();
    let compat = compat_on(&app);
    let (ends, cleans) = (app.clone(), app.clone());
    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .pubkey(feed.pubkey)
        .timeout(CHECK_TIMEOUT)
        .on_before_exit(installer_hook(move || end_for_installer(&ends), move || cleans.cleanup_before_exit(), || crate::procs::hand_off(false)));
    builder = match route {
        crate::resources::app_proxy::Route::Default => builder,
        crate::resources::app_proxy::Route::Direct => builder.no_proxy(),
        crate::resources::app_proxy::Route::Via(p) => builder.proxy(p),
    };
    if compat || http1 {
        builder = builder.configure_client(|c| c.http1_only());
    }
    let found = match builder.build().map_err(|e| e.to_string())?.check().await {
        Ok(found) => found,
        Err(e) => {
            let text = format!("{e} {e:?}");
            match care::classify(&text) {
                // A missing manifest counts as no update, not as an error.
                care::Problem::NoManifest => None,
                care::Problem::NoPlatform => {
                    return Err(format!("{}The newest release has no installer for this system yet. Kolux RS will look again soon.", care::MARK_QUIET))
                }
                care::Problem::Protocol if !compat => return Err(format!("{}{e}", care::MARK_COMPAT)),
                _ => return Err(e.to_string()),
            }
        }
    };
    // APP-031: a release whose installer is not uploaded yet is passed over until it is.
    if let Some(u) = found.as_ref() {
        // T-323-b: the public-only HEAD client has no proxy path, so with a saved proxy it is skipped
        // rather than sent around it; the download itself reports a missing installer (404).
        let proxied = matches!(crate::resources::app_http::plan_for(&app, &u.download_url).map(|p| p.route), Ok(crate::resources::app_proxy::Route::Via(_)));
        if !proxied && installer_missing(&app, &u.download_url).await {
            if !app.state::<Updates>().rounds.is_current(round) {
                return Err(care::MARK_STALE.into());
            }
            return Err(format!("{}Kolux RS {} is still being published. Kolux RS will look again soon.", care::MARK_QUIET, u.version));
        }
    }
    if !app.state::<Updates>().rounds.is_current(round) {
        return Err(care::MARK_STALE.into());
    }
    let mut found = found;
    if let Ok(store) = app.state::<Mutex<Store>>().lock() {
        let _ = store.set(KEY_LAST_CHECK, &now_ms().to_string());
        // T-293 (APP-030): an installer refused for its Windows signature is never offered again (known by the feed's signature).
        let refused = store.get(guard::KEY_REFUSED).ok().flatten();
        if found.as_ref().is_some_and(|u| guard::refused_has(refused.as_deref(), None, &u.signature)) {
            found = None;
        }
    }
    let updates = app.state::<Updates>();
    let info = found.as_ref().map(info_of);
    *updates.pending.lock().map_err(|e| e.to_string())? = found;
    Ok(info)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    version: String,
    received: u64,
    total: Option<u64>,
}

/// Downloads the update the last check found and checks its signature. The bytes wait in memory
/// until Restart to update or quit.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<Info, String> {
    let updates = app.state::<Updates>();
    if let Some((u, _)) = updates.ready.lock().map_err(|e| e.to_string())?.as_ref() {
        return Ok(info_of(u));
    }
    let mut update = updates.pending.lock().map_err(|e| e.to_string())?.clone().ok_or("There is no update to download; check again.")?;
    // T-323-b (APP-032): the installer's own host goes through the bypass list too, not only the feed's;
    // a setting that cannot be used stops the download.
    (update.proxy, update.no_proxy) = crate::resources::app_http::updater_fields(&crate::resources::app_http::plan_for(&app, &update.download_url)?.route);
    let version = update.version.clone();
    let mut received = 0u64;
    let emitter = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = emitter.emit("update-progress", Progress { version: version.clone(), received, total });
            },
            || {},
        )
        .await
        .map_err(|e| {
            // T-199 (APP-031): an installer not uploaded yet waits quietly; a protocol error offers
            // the compatibility mode.
            match care::classify(&format!("{e} {e:?}")) {
                care::Problem::Incomplete => format!("{}Kolux RS {} is still being published. Kolux RS will look again soon.", care::MARK_QUIET, update.version),
                care::Problem::Protocol => format!("{}{e}", care::MARK_COMPAT),
                _ => e.to_string(),
            }
        })?;
    // T-293 (APP-030): the installer's Windows publisher must match this copy's; no bypass.
    let (checked, version) = (bytes.clone(), update.version.clone());
    let verdict = tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join("kolux-rs-update-check");
        guard::vet(&checked, &dir, &version, &guard::running_state(), guard::Pins { subject: guard::PINNED_PUBLISHER, issuer: guard::PINNED_ISSUER }, guard::SIGNED_BUILD || guard::PINNED_PUBLISHER.is_some() || guard::PINNED_ISSUER.is_some(), guard::check_file)
    })
    .await
    .map_err(|e| e.to_string())?;
    let (why, remember) = match verdict {
        guard::Verdict::Install => (None, false),
        guard::Verdict::Stop(why) => (Some(why), true),
        // An unclear signature answer stops this download only; the next check offers it again.
        guard::Verdict::Retry(why) => (Some(why), false),
    };
    if let Some(why) = why {
        if remember {
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                let list = store.get(guard::KEY_REFUSED).ok().flatten();
                let entry = guard::Refused { sha256: guard::sha256_hex(&bytes), signature: update.signature.clone(), version: update.version.clone() };
                let _ = store.set(guard::KEY_REFUSED, &guard::refused_add(list.as_deref(), entry));
            }
        }
        *updates.pending.lock().map_err(|e| e.to_string())? = None;
        if let Ok(dir) = app.path().app_data_dir() {
            crate::diag::write(&dir, &format!("update {} {}: {why} (APP-030)", update.version, if remember { "refused" } else { "stopped once" }));
        }
        return Err(format!("{}{why}", guard::REFUSED_MARK));
    }
    let info = info_of(&update);
    *updates.ready.lock().map_err(|e| e.to_string())? = Some((update, bytes));
    Ok(info)
}

/// Restart to update: the shells end, the installer runs and starts the new version.
#[tauri::command]
pub fn update_restart(app: AppHandle) -> Result<(), String> {
    // T-199 (APP-029): only one install runs; a click while it is getting ready is ignored.
    let updates = app.state::<Updates>();
    if updates.restarting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = restart_now(&app);
    if result.is_err() {
        updates.restarting.store(false, Ordering::SeqCst);
    }
    result
}

fn restart_now(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let ready = updates.ready.lock().map_err(|e| e.to_string())?.take();
    let Some((update, bytes)) = ready else { return Err("No update is ready.".into()) };
    // T-182 (APP-011): the update restart waits for the same save point as a quit; a save that
    // fails or times out cancels it and the ready update is kept for the next try.
    if let Err(e) = crate::lifecycle::save_point(app, 0) {
        *updates.ready.lock().map_err(|e| e.to_string())? = Some((update, bytes));
        return Err(e);
    }
    // Row 535: the terminals are not ended here; the update's before-exit hook (installer_hook)
    // ends them once the installer file is written and checked, so a package that fails its
    // check leaves them running.
    // T-199 (APP-028): the attempt is written down so the next launch can tell whether it took.
    record_attempt(app, &update);
    // APP-029: the old process is forced out at the deadline so it never blocks the installer.
    updates.watchdog.arm(std::time::Instant::now() + care::WATCHDOG_AFTER);
    let forced = app.clone();
    updates.watchdog.watch(move || {
        end_for_installer(&forced);
        std::process::exit(0)
    });
    // On Windows this checks the installer, runs the hook, starts the installer and ends this process.
    if let Err(e) = update.install(&bytes) {
        // Failed straight away: stand the watchdog down, keep the app usable, give the real cause.
        updates.watchdog.stand_down();
        // T-592: the before-exit hook may have handed off already; the app runs on, so its job takes
        // its children back (APP-053).
        crate::procs::take_back();
        if let Ok(store) = app.state::<Mutex<Store>>().lock() {
            let _ = store.set(care::KEY_ATTEMPT, "");
        }
        let cause = care::install_cause(&e.to_string());
        if let Ok(dir) = app.path().app_data_dir() {
            crate::diag::write(&dir, &format!("update {} did not start: {cause} (APP-029)", update.version));
        }
        *updates.ready.lock().map_err(|e| e.to_string())? = Some((update, bytes));
        return Err(cause);
    }
    // macOS and Linux: the new version is in place and this copy starts it (T-592: outside the job).
    crate::procs::hand_off(true);
    app.restart();
}

/// The updater's last step before Windows starts the installer and this process exits (row 535):
/// it runs after the installer file is written and checked, so the terminals end only then; the
/// plugin's own clean-up, which this hook replaces, still runs after them. T-592: last of all the
/// app hands off, so the installer the plugin starts next leaves the app's kill-on-close job and
/// outlives this process (it used to die with it, and nothing installed).
fn installer_hook(end_terminals: impl Fn() + Send + Sync + 'static, cleanup: impl Fn() + Send + Sync + 'static, hand_off: impl Fn() + Send + Sync + 'static) -> impl Fn() + Send + Sync + 'static {
    move || {
        end_terminals();
        cleanup();
        hand_off();
    }
}

/// Every terminal ends and the end is written down as Kolux's own (T-286-b, APP-040), right
/// before the installer takes over.
fn end_for_installer(app: &AppHandle) {
    // AFTER-696: the background terminal service runs from the program the installer replaces, so
    // it and the shells it holds end too, not only the panes this window runs.
    // This hook runs inside the updater plugin and cannot abort the install: it only writes the failure down (row 1031).
    if !app.state::<Terminals>().end_for_update() {
        if let Ok(dir) = app.path().app_data_dir() {
            crate::diag::write(&dir, "installer starting while the terminal service still answered; the installer may not be able to replace the program (row 1031)");
        }
    }
    crate::resources::recovery::note_self_end(app, "installer starts (APP-029)");
}

/// Called as the app quits: a downloaded update installs now and does not reopen the app.
pub fn install_on_quit(app: &AppHandle) {
    let ready = app.state::<Updates>().ready.lock().ok().and_then(|mut r| r.take());
    if let Some((update, bytes)) = ready {
        if !app.state::<Terminals>().end_for_update() {
            // Row 1031: the service holds the program the installer would replace; the update is tried again next launch.
            if let Ok(dir) = app.path().app_data_dir() {
                crate::diag::write(&dir, &install_skipped_line(&update.version));
            }
            return;
        }
        record_attempt(app, &update);
        let _ = update.restart_after_install(false).install(&bytes);
    }
}

/// The diag line for an update left uninstalled at quit because the terminal service would not stop (row 1031).
fn install_skipped_line(version: &str) -> String {
    format!("update {version} not installed at quit: the terminal service did not stop in time and still holds the program (row 1031)")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row1031_the_skipped_install_line_names_the_version_and_the_reason() {
        let line = install_skipped_line("1.2.3");
        assert!(line.contains("1.2.3") && line.contains("terminal service did not stop"), "{line}");
    }

    fn env_with(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| pairs.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.clone())
    }

    #[test]
    fn the_installer_check_only_asks_github_release_hosts_over_https() {
        assert!(release_host("https://github.com/TxaisX/kolux-rs-releases/releases/download/v0.2.0/setup.exe"));
        assert!(release_host("https://release-assets.githubusercontent.com/x"));
        assert!(release_host("https://objects.githubusercontent.com/x"));
        assert!(!release_host("http://github.com/TxaisX/kolux-rs-releases/releases/download/v0.2.0/setup.exe"));
        assert!(!release_host("https://github.com.evil.example/x"));
        assert!(!release_host("https://evilgithubusercontent.com/x"));
        assert!(!release_host("https://github.com@evil.example/x"), "userinfo does not make a host");
        assert!(!release_host("http://127.0.0.1:9/setup.exe"));
        assert!(!release_host("not a url"));
    }

    #[test]
    fn the_installer_check_counts_404_and_410_as_missing_and_asks_the_host_check_first() {
        let src = include_str!("update.rs");
        let body = &src[src.find("async fn installer_missing").unwrap()..src.find("pub fn update_last_attempt").unwrap()];
        assert!(body.contains("404 | 410"), "410 Gone is a missing installer like 404");
        assert!(body.find("release_host(url.as_str())").unwrap() < body.find("browser::head").unwrap(), "non-GitHub hosts are never asked");
    }

    #[test]
    fn development_copy_never_updates_without_a_test_feed() {
        let e = feed(true, true, env_with(&[])).unwrap_err();
        assert!(e.contains("development copy"), "{e}");
        // Only one of the two variables is not enough.
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:1/latest.json")])).is_err());
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, " "), (ENV_PUBKEY, "k")])).is_err());
    }

    #[test]
    fn development_copy_takes_a_test_feed() {
        let f = feed(true, false, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json "), (ENV_PUBKEY, "abc")])).unwrap();
        assert_eq!(f, Feed { endpoint: "http://127.0.0.1:9/latest.json".into(), pubkey: "abc".into() });
    }

    #[test]
    fn release_builds_ignore_the_test_feed_and_need_an_installed_copy() {
        let env = env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json"), (ENV_PUBKEY, "abc")]);
        let e = feed(false, false, &env).unwrap_err();
        assert!(e.contains("not installed"), "{e}");
        match feed(false, true, &env) {
            Ok(f) => assert_eq!(f.endpoint, RELEASE_ENDPOINT, "a release build must never read the test feed"),
            Err(e) => assert!(e.contains("signing key"), "{e}"),
        }
    }

    /// The updater plugin's Windows install, in its own order: write and check the installer,
    /// run the before-exit hook, start the installer, exit.
    fn plugin_install(extract_ok: bool, start_ok: bool, hook: &dyn Fn()) -> Result<(), String> {
        if !extract_ok {
            return Err("bad package".into());
        }
        hook();
        if !start_ok {
            return Err("did not start".into());
        }
        Ok(())
    }

    #[test]
    fn terminals_end_only_once_the_installer_is_about_to_start() {
        // Row 535: an install that fails before the installer is ready leaves every terminal running.
        use std::sync::atomic::AtomicUsize;
        let ended = Arc::new(AtomicUsize::new(0));
        let cleaned = Arc::new(AtomicUsize::new(0));
        let (e, c) = (ended.clone(), cleaned.clone());
        let hook = installer_hook(
            move || {
                e.fetch_add(1, Ordering::SeqCst);
            },
            move || {
                c.fetch_add(1, Ordering::SeqCst);
            },
            || {},
        );
        assert!(plugin_install(false, true, &hook).is_err());
        assert_eq!(ended.load(Ordering::SeqCst), 0, "a package that fails its check must not end the terminals");
        assert!(plugin_install(true, true, &hook).is_ok());
        assert_eq!(ended.load(Ordering::SeqCst), 1);
        assert_eq!(cleaned.load(Ordering::SeqCst), 1, "the plugin's own clean-up still runs");
        // restart_now itself no longer ends the terminals ahead of the install.
        let src = include_str!("update.rs");
        let body = &src[src.find("fn restart_now").unwrap()..src.find("fn installer_hook").unwrap()];
        assert!(!body.contains(".kill_all()"), "restart_now ends the terminals before the installer is ready");
    }

    /// T-592 (R09-app-core-install.1): the app's kill-on-close job used to take the installer down with
    /// the app. The installer now leaves the job last, after the terminals ended and the plugin cleaned
    /// up, right before Windows starts it; a package that fails its check hands off nothing, so the app
    /// keeps its job for everything it starts afterwards. Every restart in this file hands off first.
    #[test]
    fn t592_the_installer_leaves_the_app_job_last_and_only_when_it_will_start() {
        let order = Arc::new(Mutex::new(Vec::new()));
        let (a, b, c) = (order.clone(), order.clone(), order.clone());
        let hook = installer_hook(move || a.lock().unwrap().push("terminals"), move || b.lock().unwrap().push("clean-up"), move || c.lock().unwrap().push("leave the job"));
        assert!(plugin_install(false, true, &hook).is_err());
        assert!(order.lock().unwrap().is_empty(), "a package that fails its check hands off nothing");
        assert!(plugin_install(true, true, &hook).is_ok());
        assert_eq!(*order.lock().unwrap(), ["terminals", "clean-up", "leave the job"]);
        let src = include_str!("update.rs").replace("\r\n", "\n"); // a Windows checkout is CRLF
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        assert!(code.contains("|| crate::procs::hand_off(false)"), "the updater's before-exit hook hands off");
        let failed = &code[code.find("if let Err(e) = update.install(&bytes)").unwrap()..];
        let failed = &failed[..failed.find("return Err(cause);").unwrap()];
        assert!(failed.contains("crate::procs::take_back();"), "an install that did not start takes the hand-off back");
        assert_eq!(code.matches("app.restart()").count(), code.matches("crate::procs::hand_off(true);\n    app.restart()").count(), "a restart that skips the hand-off dies with the job");
    }

    #[test]
    fn notes_drop_headings_and_blank_lines_and_are_cut_short() {
        let body = "## What's new\n\n- First\n* Second\n\n### Fixes\n+ Third\nFourth plain line\n---\n- Fifth\n- Sixth\n- Seventh\n";
        assert_eq!(clean_notes(Some(body)), vec!["First", "Second", "Third", "Fourth plain line", "Fifth", "Sixth"]);
        assert_eq!(clean_notes(Some("# Only a heading\n\n")), Vec::<String>::new());
        assert_eq!(clean_notes(None), Vec::<String>::new());
        // The release job's hidden source marker never shows as a note.
        assert_eq!(clean_notes(Some("- Ship it\n<!-- kolux-rs-source: abc123 -->\n")), vec!["Ship it"]);
    }

    #[test]
    fn app032_the_update_check_takes_the_saved_proxy_and_stops_when_it_is_unusable() {
        let src = include_str!("update.rs");
        let body = &src[src.find("pub async fn update_check").unwrap()..src.find("pub async fn update_download").unwrap()];
        let at = |needle: &str| body.find(needle).unwrap_or_else(|| panic!("update_check lost {needle}"));
        // the route is read (and its error returned with ?) before the client is built, and applied to it
        assert!(at("plan_for(&app, &url)?") < at(".build()"));
        assert!(at("compat || http1") < at(".build()"), "the HTTP/1 switch reaches the client");
        assert!(at("Route::Direct => builder.no_proxy()") < at(".build()"));
        assert!(at("Route::Via(p) => builder.proxy(p)") < at(".build()"));
    }

    #[test]
    fn t323b_the_download_routes_its_own_host_and_the_head_probe_does_not_go_around_a_saved_proxy() {
        let src = include_str!("update.rs");
        let body = &src[src.find("pub async fn update_download").unwrap()..src.find("pub fn update_restart").unwrap()];
        let at = |needle: &str| body.find(needle).unwrap_or_else(|| panic!("update_download lost {needle}"));
        assert!(at("plan_for(&app, &update.download_url)?") < at(".download("), "the installer host is routed first, and a bad setting stops it");
        let check = &src[src.find("pub async fn update_check").unwrap()..src.find("pub async fn update_download").unwrap()];
        assert!(check.find("!proxied && installer_missing").is_some(), "no direct probe while a proxy is saved");
    }

    // AFTER (refused-list reset): update_mark can empty the refused list, and the issuer pin reaches the check.
    #[test]
    fn t293_the_refused_list_reset_and_the_issuer_pin_are_wired() {
        let src = include_str!("update.rs");
        let mark = &src[src.find("pub fn update_mark").unwrap()..src.find("pub async fn update_download").unwrap()];
        assert!(mark.contains("\"refusedInstallers\"") && mark.contains("guard::refused_reset_value"), "update_mark lost the refused-list reset");
        let dl = &src[src.find("pub async fn update_download").unwrap()..src.find("pub fn update_restart").unwrap()];
        assert!(dl.contains("guard::PINNED_ISSUER"), "update_download no longer passes the issuer pin");
    }
}
