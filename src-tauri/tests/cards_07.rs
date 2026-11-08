//! spec/07 accounts and keys (ACCT-001..013 and 034; the card each test proves is in its name). Needs `claude_key`, `claude_accounts`,
//! `codex_accounts` and `secrets` public in lib.rs. Every sign-in file, key and token here is a
//! hand-written fake in a folder under this crate's target directory; the three agents are stood in
//! for by small batch files that print hand-written lines and write fake sign-in files. Nothing real
//! is read, started or contacted, and no credential store of the machine is touched.
#![cfg(windows)]

use kolux_lib::claude_accounts as ca;
use kolux_lib::claude_key as ck;
use kolux_lib::codex_accounts as cx;
use kolux_lib::grok;
use kolux_lib::install;
use kolux_lib::routing;
use kolux_lib::secrets;
use kolux_lib::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DAY: i64 = 86_400_000;
const NOW: i64 = 1_800_000_000_000;
/// Obviously fake; long enough and prefixed the way the key picker looks for.
const KEY: &str = "sk-ant-oat01-TEST-ONLY-NOT-A-REAL-KEY-0000000000000000000000";

fn folder(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("cards07-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn profile(name: &str) -> (PathBuf, Mutex<Store>) {
    let dir = folder(name);
    let store = Store::open(&dir).unwrap();
    (dir, Mutex::new(store))
}

fn write_bat(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("@echo off\r\n{}\r\n", lines.join("\r\n"))).unwrap();
    path
}

fn never() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

/// A stand-in `claude`: `auth login` prints a sign-in link and writes the credentials file into
/// the folder named by CLAUDE_CONFIG_DIR; `auth status --json` answers as a signed-in account.
fn fake_claude(dir: &Path, login: &str) -> PathBuf {
    write_bat(
        dir,
        "claude.cmd",
        &[
            "if \"%2\"==\"status\" goto status",
            "echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789 in your browser",
            "ping -n 2 127.0.0.1 >nul",
            login,
            "exit /b 0",
            ":status",
            "echo {\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"email\":\"sam@example.com\",\"orgName\":\"Example Org\"}",
        ],
    )
}

fn creds_line(token: &str) -> String {
    format!(">\"%CLAUDE_CONFIG_DIR%\\.credentials.json\" echo {{\"claudeAiOauth\":{{\"accessToken\":\"{token}\"}}}}")
}

fn login_with(program: &Path, id_dir: &Path, cancel: Arc<AtomicBool>, on_browser: impl Fn() + Send + 'static) -> (String, ck::Ended) {
    ck::run_hidden(ca::login_command(program, id_dir), Duration::from_secs(30), cancel, on_browser, |_| false)
}

// ---------------------------------------------------------------- ACCT-004

#[test]
fn acct004_box1_connect_keeps_the_key_and_names_a_renewal_a_year_ahead() {
    let (dir, store) = profile("key-connect");
    // The key setup, as Claude Code's `setup-token` prints it: a sign-in link, then the key.
    let program = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "ping -n 2 127.0.0.1 >nul", &format!("echo {KEY}"), "ping -n 4 127.0.0.1 >nul"]);
    let mut cmd = portable_pty::CommandBuilder::new(program.as_os_str());
    cmd.arg("setup-token");
    let seen = Arc::new(AtomicBool::new(false));
    let flag = seen.clone();
    let out = ck::run_setup(cmd, ck::SETUP_LIMIT, never(), move || flag.store(true, Ordering::SeqCst));
    assert_eq!(out, ck::Outcome::Key(KEY.into()));
    assert!(seen.load(Ordering::SeqCst), "the card is told the browser step has started");
    // MIRROR claude_key.rs:466-478: the setup thread keeps a Key outcome with keep() and the clock.
    let ck::Outcome::Key(token) = out else { unreachable!() };
    let store = store.lock().unwrap();
    ck::keep(&store, &token, NOW).unwrap();
    let raw = std::fs::read_to_string(dir.join("settings.json")).unwrap();
    assert!(!raw.contains(KEY), "the key is never in the clear");
    let has = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap().is_some();
    let status = ck::status_checked(&store.settings(), has, false, NOW);
    assert!(status.connected && !status.renew_due && !status.expired);
    assert_eq!(status.expires_at, Some(NOW + 365 * DAY), "good for twelve months, so the renewal month is a year ahead");
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!((wire["connected"].as_bool(), wire["renewDue"].as_bool(), wire["expiresAt"].as_i64()), (Some(true), Some(false), Some(NOW + 365 * DAY)));
    assert_eq!(wire["attention"], Value::Null);
    drop(store);
    // And the launcher check that decides the setup may run at all: a native build, not a wrapper.
    assert!(!ck::is_wrapper(Path::new(r"C:\fake\claude.exe")));
}

#[test]
fn acct004_box2_a_key_made_340_days_ago_warns_with_renew_due() {
    let (_dir, store) = profile("key-340");
    let store = store.lock().unwrap();
    ck::keep(&store, KEY, NOW - 340 * DAY).unwrap(); // the stored creation date, backdated
    let has = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap().is_some();
    let status = ck::status_checked(&store.settings(), has, false, NOW);
    assert!(status.connected && status.renew_due && !status.expired);
    assert_eq!(status.days_left, Some(25));
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!((wire["renewDue"].as_bool(), wire["expired"].as_bool(), wire["daysLeft"].as_i64()), (Some(true), Some(false), Some(25)));
    // One day short of the warning window: no warning yet.
    ck::keep(&store, KEY, NOW - 334 * DAY).unwrap();
    assert!(!ck::status_checked(&store.settings(), true, false, NOW).renew_due);
}

#[test]
fn acct004_box3_a_claude_pane_in_key_mode_is_handed_the_key_and_a_managed_account_gives_way() {
    let (dir, store) = profile("key-pane");
    let store = store.lock().unwrap();
    ck::keep(&store, KEY, NOW).unwrap();
    let settings = store.settings();
    let token = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap();
    // MIRROR terminal.rs:1719-1735: spawn asks key_mode, then claude_key::pane_env, then (only if none) the account.
    let by_key = ck::pane_env(Some("claude"), &settings, token.clone());
    assert_eq!(by_key, Some(("CLAUDE_CODE_OAUTH_TOKEN", KEY.to_string())));
    let key_mode = settings[ck::MODE_FIELD] == ck::KEY_MODE;
    assert!(key_mode);
    assert_eq!(ca::pane_env(Some("claude"), key_mode, Some(r"G:\fake\account".into())), None, "key mode wins over a managed account");
    assert_eq!(ca::pane_env(Some("claude"), false, Some(r"G:\fake\account".into())).map(|p| p.0), Some(ca::CONFIG_ENV));
    // The child process really receives the variable (nothing is printed but whether it matches).
    let (k, v) = by_key.unwrap();
    let probe = write_bat(&dir, "probe.cmd", &[&format!("if \"%{k}%\"==\"{KEY}\" (echo SIGNED-IN-BY-KEY) else (echo NO-KEY)")]);
    let mut cmd = portable_pty::CommandBuilder::new(probe.as_os_str());
    cmd.env(k, v);
    let (printed, _) = ck::run_hidden(cmd, Duration::from_secs(20), never(), || {}, |_| false);
    assert!(printed.contains("SIGNED-IN-BY-KEY") && !printed.contains("NO-KEY"), "{printed}");
}

// ---------------------------------------------------------------- ACCT-005

#[test]
fn acct005_box1_add_an_account_shows_email_and_organisation() {
    let (dir, store) = profile("add");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    let seen = Arc::new(AtomicBool::new(false));
    let flag = seen.clone();
    // MIRROR claude_accounts.rs:372-395: the add runs the hidden login in the account's folder, then asks who signed in.
    let account = ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), move || flag.store(true, Ordering::SeqCst)), |d| ca::auth_status(&program, Some(d))).unwrap();
    assert!(seen.load(Ordering::SeqCst), "the sign-in link appeared, so the note says to finish in the browser");
    assert_eq!((account.email.as_deref(), account.organization.as_deref()), (Some("sam@example.com"), Some("Example Org")));
    let listed = ca::load(&store.lock().unwrap());
    assert_eq!(listed, vec![account.clone()], "the row is listed");
    assert!(Path::new(&account.config_dir).starts_with(dir.join(ca::FOLDER)), "it has a private folder of its own");
    assert!(Path::new(&account.config_dir).join(ca::CREDENTIALS).is_file());
    assert_eq!(ca::active(&store.lock().unwrap()), None, "adding does not change the active account");
    let wire = serde_json::to_value(&account).unwrap();
    assert_eq!((wire["email"].as_str(), wire["organization"].as_str(), wire["stale"].as_bool()), (Some("sam@example.com"), Some("Example Org"), Some(false)));
    ca::activate(&store.lock().unwrap(), Some("a1")).unwrap();
    assert_eq!(ca::active(&store.lock().unwrap()).as_deref(), Some("a1"), "and it can be made active");
}

#[test]
fn acct005_box2_cancel_partway_adds_no_row_and_keeps_the_active_account() {
    let (dir, store) = profile("cancel");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    ca::activate(&store.lock().unwrap(), Some("a1")).unwrap();
    let before = ca::load(&store.lock().unwrap());
    // A second add whose login hangs in the browser step; the user presses Cancel once it shows.
    let hang = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "ping -n 30 127.0.0.1 >nul"]);
    let cancel = never();
    let press = cancel.clone();
    let err = ca::sign_in(&store, &dir, "a2", false, NOW + 1, |d| login_with(&hang, d, cancel, move || press.store(true, Ordering::SeqCst)), |_| None).unwrap_err();
    assert_eq!(err.reason, "cancelled");
    assert_eq!(ca::load(&store.lock().unwrap()), before, "no row was added");
    assert_eq!(ca::active(&store.lock().unwrap()).as_deref(), Some("a1"), "the active account stays the same");
    assert!(!dir.join(ca::FOLDER).join("a2").exists(), "nothing partial is kept");
}

#[test]
fn acct005_box3_a_failed_re_authentication_keeps_the_earlier_credentials_and_the_row() {
    let (dir, store) = profile("reauth");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    let first = ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    let creds = Path::new(&first.config_dir).join(ca::CREDENTIALS);
    let earlier = std::fs::read_to_string(&creds).unwrap();
    // The re-authentication wipes the file and quits early.
    let failing = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "del \"%CLAUDE_CONFIG_DIR%\\.credentials.json\"", "exit /b 1"]);
    let err = ca::sign_in(&store, &dir, "a1", true, NOW + 5, |d| login_with(&failing, d, never(), || {}), |_| None).unwrap_err();
    assert!(!err.message.contains("https://") && !err.message.contains("abc123def456ghi789"), "no link or code in the error: {err}");
    assert_eq!(std::fs::read_to_string(&creds).unwrap(), earlier, "the earlier credentials are back");
    let rows = ca::load(&store.lock().unwrap());
    assert_eq!(rows, vec![first], "the row is unchanged and not marked as needing sign-in");
    assert!(!rows[0].stale);
}

// ---------------------------------------------------------------- ACCT-007

/// A stand-in `codex`: `login --device-auth` prints the link, then the code a moment later, waits
/// (the user is on another device), then writes a ChatGPT-style sign-in into CODEX_HOME.
fn fake_codex_device(dir: &Path) -> PathBuf {
    let claims = base64_url(r#"{"email":"kim@example.com"}"#);
    write_bat(
        dir,
        "codex.cmd",
        &[
            "echo Open this link on any device: https://auth.example.com/codex/device",
            "ping -n 2 127.0.0.1 >nul",
            "echo Enter this one-time code: WXYZ-6789",
            "ping -n 3 127.0.0.1 >nul",
            &format!(">\"%CODEX_HOME%\\auth.json\" echo {{\"OPENAI_API_KEY\":null,\"tokens\":{{\"id_token\":\"h.{claims}.s\",\"access_token\":\"fake\"}}}}"),
            "echo Successfully logged in",
        ],
    )
}

fn base64_url(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s)
}

/// The sign-in as `codex_account_sign_in` runs it (codex_accounts.rs:451-478), minus the window events.
fn codex_login(program: &Path, device: bool, shown: Arc<Mutex<Vec<(String, String, bool)>>>) -> impl FnOnce(&Path) -> (String, ck::Ended, Option<String>) + '_ {
    move |home| {
        let seen: Arc<Mutex<Option<(String, String)>>> = Arc::default();
        let peek = seen.clone();
        let auth = home.join("auth.json");
        let (out, ended) = ck::run_hidden(cx::login_command(program, home, device), cx::LOGIN_LIMIT, never(), || {}, move |clean| {
            if device {
                if let Some(found) = cx::device_prompt(clean) {
                    let mut s = peek.lock().unwrap();
                    if s.as_ref() != Some(&found) {
                        shown.lock().unwrap().push((found.0.clone(), found.1.clone(), auth.exists()));
                        *s = Some(found);
                    }
                }
            }
            false
        });
        let code = seen.lock().unwrap().as_ref().map(|d| d.1.clone());
        (out, ended, code)
    }
}

#[test]
fn acct007_box1_connect_with_a_code_shows_the_code_then_reads_connected() {
    let (dir, store) = profile("codex-device");
    let program = fake_codex_device(&dir);
    let argv = cx::login_command(&program, &dir, true).get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert_eq!(&argv[1..], ["login", "--device-auth"]);
    let shown = Arc::default();
    let started = Instant::now();
    let account = cx::sign_in(&store, &dir, "c1", false, NOW, codex_login(&program, true, Arc::clone(&shown))).unwrap();
    let shown = shown.lock().unwrap();
    assert_eq!(shown.len(), 1, "the view got one link-and-code pair, only once both were printed: {shown:?}");
    assert_eq!((shown[0].0.as_str(), shown[0].1.as_str()), ("https://auth.example.com/codex/device", "WXYZ-6789"));
    assert!(!shown[0].2, "the code was on show while the sign-in had not happened yet");
    assert!(started.elapsed() > Duration::from_secs(2), "the sign-in was still waiting on the other device after the code showed");
    // The other device finishes: the account is listed, active, named by its email.
    assert_eq!(account.email.as_deref(), Some("kim@example.com"));
    let store = store.lock().unwrap();
    assert_eq!(cx::load(&store), vec![account.clone()]);
    assert_eq!(cx::active_account(&store).map(|a| a.id), Some("c1".to_string()));
    assert!(Path::new(&account.home).starts_with(dir.join(cx::FOLDER)), "in a private Codex home of its own");
    assert_eq!(cx::system_default(Some(&account.home), None), "chatgpt");
}

/// Every file under `root` with its bytes, for a byte-for-byte comparison.
fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, root, out);
            } else {
                out.push((p.strip_prefix(root).unwrap().to_string_lossy().into_owned(), std::fs::read(&p).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

#[test]
fn acct007_box2_adding_a_second_account_leaves_the_users_codex_folder_byte_for_byte() {
    let (dir, store) = profile("codex-second");
    // The user's usual Codex folder, hand-made: a ChatGPT-style sign-in, settings, a skill, history.
    let user = folder("codex-user");
    let claims = base64_url(r#"{"email":"me@example.com"}"#);
    std::fs::write(user.join("auth.json"), format!(r#"{{"OPENAI_API_KEY":null,"tokens":{{"id_token":"h.{claims}.s","access_token":"fake-user"}}}}"#)).unwrap();
    std::fs::write(user.join("config.toml"), "model = \"fake-model\"\n[projects.'G:\\fake']\ntrust_level = \"trusted\"\n").unwrap();
    std::fs::create_dir_all(user.join("skills").join("demo")).unwrap();
    std::fs::write(user.join("skills").join("demo").join("SKILL.md"), "# demo skill\r\nline two\r\n").unwrap();
    std::fs::write(user.join("history.jsonl"), b"{\"text\":\"one\"}\n\xff\xfe binary tail").unwrap();
    let before = snapshot(&user);
    let stamps: Vec<_> = before.iter().map(|(n, _)| std::fs::metadata(user.join(n)).unwrap().modified().unwrap()).collect();

    let program = fake_codex_device(&dir);
    // Two accounts are added; each then gets what a pane launch gives its home (the user's skills and settings are copied in).
    for (n, id) in ["c1", "c2"].into_iter().enumerate() {
        assert!(!cx::user_custom_provider(Some(user.to_str().unwrap()), None), "the add checks the user's settings by reading only");
        let account = cx::sign_in(&store, &dir, id, false, NOW + n as i64, codex_login(&program, false, Arc::default())).unwrap();
        let home = Path::new(&account.home);
        cx::share_user_files(&user, home, Instant::now() + Duration::from_secs(5)).unwrap();
        cx::sync_settings(&user, home).unwrap();
        assert!(home.join("auth.json").is_file() && home != user, "the account has a home of its own");
        assert_ne!(std::fs::read(home.join("auth.json")).unwrap(), std::fs::read(user.join("auth.json")).unwrap(), "the user's own sign-in was not copied over the account's");
    }
    assert_eq!(cx::load(&store.lock().unwrap()).len(), 2, "both accounts are listed");
    assert_eq!(snapshot(&user), before, "every file in the usual Codex folder is byte-for-byte unchanged, none added or removed");
    let after: Vec<_> = before.iter().map(|(n, _)| std::fs::metadata(user.join(n)).unwrap().modified().unwrap()).collect();
    assert_eq!(after, stamps, "not even rewritten");
}

// ---------------------------------------------------------------- ACCT-012

#[test]
fn acct012_box1_a_stale_active_account_is_what_the_notice_reads() {
    let (dir, store) = profile("stale");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    {
        let s = store.lock().unwrap();
        ca::activate(&s, Some("a1")).unwrap();
        assert!(ca::mark_stale(&s, "a1", true).unwrap(), "Claude Code no longer reports it signed in");
        // What the window reads for the notice: the stale flag on the active account, labelled by email.
        let wire = serde_json::to_value(ca::load(&s)).unwrap();
        assert_eq!((wire[0]["id"].as_str(), wire[0]["email"].as_str(), wire[0]["stale"].as_bool()), (Some("a1"), Some("sam@example.com"), Some(true)));
        assert_eq!(ca::active(&s).as_deref(), Some("a1"));
    }
    // Sign in again is the same sign-in with the account's id (SignInNotice.tsx: claude_account_sign_in { id }): it clears the flag.
    let again = ca::sign_in(&store, &dir, "a1", true, NOW + 9, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d)));
    assert!(again.is_err(), "the same credentials as before are not taken as a new sign-in");
    let fresh = fake_claude(&dir, &creds_line("fake-access-1111"));
    ca::sign_in(&store, &dir, "a1", true, NOW + 9, |d| login_with(&fresh, d, never(), || {}), |d| ca::auth_status(&fresh, Some(d))).unwrap();
    let rows = ca::load(&store.lock().unwrap());
    assert!(!rows[0].stale && rows[0].last_sign_in == NOW + 9, "a new sign-in clears it");
}

#[test]
fn acct012_box2_the_upkeep_switch_that_hands_sign_ins_to_claude_code() {
    // The window hides the notice when this is true (AccountsView.upkeepLeftToClaude).
    assert!(ca::upkeep_left_to_claude(&json!({})), "absent = on (OD-01)");
    assert!(ca::upkeep_left_to_claude(&json!({ ca::UPKEEP_FIELD: true })));
    assert!(!ca::upkeep_left_to_claude(&json!({ ca::UPKEEP_FIELD: false })));
}

// ---------------------------------------------------------------- ACCT-013

#[test]
fn acct013_box2_a_claude_usage_limit_reaches_the_card_as_a_reset_time_with_no_fix() {
    let (_dir, store) = profile("limit");
    let store = store.lock().unwrap();
    let resets = NOW + 3 * 3_600_000;
    // The status line reports the 5-hour window used up; the hook keeps when it lifts (hooks.rs:545).
    let limits = [kolux_lib::hooks::Limit { kind: "five_hour".into(), used_percent: 100.0, resets_at: Some(resets) }];
    let lifts = kolux_lib::hooks::exhausted(&limits).unwrap();
    store.set(ck::LIMIT_KEY, &lifts.to_string()).unwrap();
    // MIRROR claude_key.rs:423-424: the card's attention is usage_limit() of the kept time.
    let kept = store.get(ck::LIMIT_KEY).unwrap().and_then(|t| t.parse().ok());
    let attention = ck::usage_limit(kept, NOW).unwrap();
    let wire = serde_json::to_value(&attention).unwrap();
    assert_eq!((wire["reason"].as_str(), wire["resetsAt"].as_i64()), (Some("usage-limit"), Some(resets)));
    assert_eq!(ck::usage_limit(kept, resets), None, "once the window lifts the card goes back to normal");
}

#[test]
fn acct013_box1_a_key_refused_mid_session_turns_the_card_to_key_expired_with_the_date_still_ahead() {
    let (_dir, store) = profile("refused");
    let store = store.lock().unwrap();
    ck::keep(&store, KEY, NOW).unwrap();
    let later = NOW + 10 * DAY; // ten days into a 365-day key
    let card = |store: &Store| ck::status_checked(&store.settings(), true, ck::is_refused(store), later);
    let before = card(&store);
    assert!(before.connected && !before.expired && before.attention.is_none(), "a healthy key shows nothing");
    // The sign-in stop reaches claude_account_check { cause: "signin" } (claude_accounts.rs key_refused, run in-crate), which marks the key.
    ck::mark_refused(&store, later);
    let after = card(&store);
    assert!(after.connected && after.expired && after.renew_due, "the card turns to key expired although the date is ahead");
    let wire = serde_json::to_value(&after).unwrap();
    assert_eq!(wire["attention"]["reason"], "key-expired");
    assert_eq!(wire["daysLeft"], 355);
    // Pinned to the file the window test reads (compared, never rewritten).
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../evidence/cards-ACCT-013-key-expired.json")).unwrap()).unwrap();
    assert_eq!(wire, fixture);
    // Account-mode Claude (no key stored) leaves the card as it is, and a new key clears the refusal.
    assert!(ck::status_checked(&json!({}), false, true, later).attention.is_none());
    ck::keep(&store, KEY, later).unwrap();
    assert!(card(&store).attention.is_none());
}

// ---------------------------------------------------------------- ACCT-009

const CLEAR_XAI: &str = "xai-FAKE-NOT-A-REAL-KEY-1111111111111111";
const CLEAR_VAULT: &str = r#"{"claudeAiOauth":{"accessToken":"fake-access-CLEARTEXT-0000","refreshToken":"fake-refresh-CLEARTEXT-0000"}}"#;

fn on_disk(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("settings.json")).unwrap()
}

#[test]
fn acct009_box1_after_quit_the_settings_file_holds_no_key_text_and_reopening_is_still_connected() {
    assert_eq!(secrets::backend(), "dpapi", "sealing is the operating system's own protection, not a scramble");
    let dir = folder("seal-reopen");
    {
        let store = Store::open(&dir).unwrap();
        ck::keep(&store, KEY, NOW).unwrap();
        secrets::write_setting(&store, grok::KEY_FIELD, CLEAR_XAI).unwrap();
    } // Kolux quits: the store is dropped
    let raw = on_disk(&dir);
    for secret in [KEY, CLEAR_XAI, "TEST-ONLY", "FAKE-NOT-A-REAL"] {
        assert!(!raw.contains(secret), "{secret} must not be readable in settings.json");
    }
    let file: Value = serde_json::from_str(&raw).unwrap();
    for field in [ck::TOKEN_FIELD, grok::KEY_FIELD] {
        assert!(secrets::is_sealed(file[field].as_str().unwrap()), "{field} is stored sealed");
    }
    // Reopen: a new store over the same folder.
    let store = Store::open(&dir).unwrap();
    assert_eq!(secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap().as_deref(), Some(KEY));
    let status = ck::status_checked(&store.settings(), true, false, NOW + DAY);
    assert!(status.connected && !status.expired, "the Claude key is still connected after reopening");
    assert_eq!(grok::connection(false, secrets::read_setting(&store, grok::KEY_FIELD).unwrap().is_some()), "key", "the xAI key too");
    // And the window never receives either key (lib.rs:131 sends settings through without_secrets).
    let shown = secrets::without_secrets(store.settings()).to_string();
    assert!(!shown.contains(KEY) && !shown.contains(CLEAR_XAI) && !shown.contains("claudeOauthToken"));
}

#[test]
fn acct009_box2_a_profile_with_clear_credentials_is_sealed_by_the_first_launch_and_still_works() {
    let dir = folder("seal-clear");
    let vault = dir.join(secrets::VAULT);
    std::fs::create_dir_all(&vault).unwrap();
    {
        let store = Store::open(&dir).unwrap();
        // A profile from the previous release: every secret stored in the clear.
        store.save_settings(&json!({"claudeOauthToken": KEY, "claudeConnectionMode": "key", "claudeKeyCreatedAt": NOW, "xaiApiKey": CLEAR_XAI})).unwrap();
        std::fs::write(vault.join("claude-a1.json"), CLEAR_VAULT).unwrap();
        std::fs::write(vault.join("codex-c1.json"), r#"{"tokens":{"access_token":"fake-codex-CLEARTEXT-0000"}}"#).unwrap();
    }
    assert!(on_disk(&dir).contains(KEY) && std::fs::read_to_string(vault.join("claude-a1.json")).unwrap().contains("CLEARTEXT"), "the starting point holds clear secrets");
    // The first launch: the one-off pass that runs shortly after the first window.
    let store = Mutex::new(Store::open(&dir).unwrap());
    let report = secrets::sealing_pass(&store, &dir);
    assert_eq!((report.settings_sealed, report.files_sealed, report.files_moved, report.skipped), (2, 2, 0, false));
    let raw = on_disk(&dir);
    assert!(!raw.contains(KEY) && !raw.contains(CLEAR_XAI), "settings.json no longer holds either key");
    for name in ["claude-a1.json", "codex-c1.json"] {
        let text = std::fs::read_to_string(vault.join(name)).unwrap();
        assert!(secrets::is_sealed(text.trim_end()) && !text.contains("CLEARTEXT"), "{name} is sealed");
    }
    // Still working: the key opens, the card reads connected, a Claude pane is handed the key,
    // the vault copy opens to the same text.
    let store = store.lock().unwrap();
    let token = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap();
    assert_eq!(token.as_deref(), Some(KEY));
    assert!(ck::status_checked(&store.settings(), true, false, NOW + DAY).connected);
    assert_eq!(ck::pane_env(Some("claude"), &store.settings(), token), Some((ck::ENV, KEY.to_string())));
    assert_eq!(secrets::read_setting(&store, grok::KEY_FIELD).unwrap().as_deref(), Some(CLEAR_XAI));
    assert_eq!(secrets::read_file(&vault.join("claude-a1.json"), &dir).unwrap().as_deref(), Some(CLEAR_VAULT));
    drop(store);
    // The pass runs once per profile: the next launch skips it and everything is still readable.
    let again = secrets::sealing_pass(&Mutex::new(Store::open(&dir).unwrap()), &dir);
    assert!(again.skipped && again.settings_sealed == 0 && again.files_sealed == 0);
    assert_eq!(secrets::read_setting(&Store::open(&dir).unwrap(), ck::TOKEN_FIELD).unwrap().as_deref(), Some(KEY));
}

// ---------------------------------------------------------------- ACCT-002

/// A stand-in `codex login` (the ChatGPT browser route): prints the sign-in link, waits for the
/// user, then writes a ChatGPT-style sign-in into CODEX_HOME. `after_wait` runs once the wait ends.
fn fake_codex_browser(dir: &Path, waits: u32, after_wait: &str) -> PathBuf {
    let claims = base64_url(r#"{"email":"kim@example.com"}"#);
    write_bat(
        dir,
        "codex.cmd",
        &[
            "echo Opening https://auth.example.com/oauth/authorize?code=abc123def456ghi789 in your browser",
            &format!("ping -n {waits} 127.0.0.1 >nul"),
            after_wait,
            &format!(">\"%CODEX_HOME%\\auth.json\" echo {{\"OPENAI_API_KEY\":null,\"tokens\":{{\"id_token\":\"h.{claims}.s\",\"access_token\":\"fake\"}}}}"),
            "echo Successfully logged in",
        ],
    )
}

/// The browser sign-in as `codex_account_sign_in` runs it (codex_accounts.rs:451-478), minus the window events.
fn codex_browser_login(program: &Path, cancel: Arc<AtomicBool>, in_browser: Arc<AtomicBool>) -> impl FnOnce(&Path) -> (String, ck::Ended, Option<String>) + '_ {
    move |home| {
        let (out, ended) = ck::run_hidden(cx::login_command(program, home, false), cx::LOGIN_LIMIT, cancel, move || in_browser.store(true, Ordering::SeqCst), |_| false);
        (out, ended, None)
    }
}

#[test]
fn acct002_box1_codex_connect_goes_to_browser_step_then_connected_with_the_account_label() {
    let (dir, store) = profile("codex-browser");
    let program = fake_codex_browser(&dir, 4, "rem the user finishes in the browser");
    let argv = cx::login_command(&program, &dir, false).get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert_eq!(&argv[1..], ["login"], "Connect is the ChatGPT browser sign-in, not the device code");
    let in_browser = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    // Poll like the card does: while the sign-in runs, the view says browser step, no account yet.
    let watcher = {
        let (seen, done, dir) = (in_browser.clone(), done.clone(), dir.clone());
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            while !done.load(Ordering::SeqCst) && Instant::now() < deadline {
                if seen.load(Ordering::SeqCst) {
                    return !dir.join(cx::FOLDER).join("c1").join("auth.json").exists();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        })
    };
    let account = cx::sign_in(&store, &dir, "c1", false, NOW, codex_browser_login(&program, never(), in_browser)).unwrap();
    done.store(true, Ordering::SeqCst);
    assert!(watcher.join().unwrap(), "the browser step was on show before the sign-in file existed");
    assert_eq!(account.email.as_deref(), Some("kim@example.com"), "the account label is the email");
    let store = store.lock().unwrap();
    assert_eq!(cx::load(&store), vec![account.clone()]);
    assert_eq!(cx::active_account(&store).map(|a| a.id), Some("c1".to_string()));
    let wire = serde_json::to_value(&account).unwrap();
    assert_eq!(wire["email"], "kim@example.com");
}

#[test]
fn acct002_box2_cancel_while_connecting_ends_the_process_and_keeps_no_partial_account() {
    let (dir, store) = profile("codex-cancel");
    let marker = dir.join("still-running.txt");
    // If the login process were left alive it would write this marker (and the sign-in file) later.
    let program = fake_codex_browser(&dir, 8, &format!(">\"{}\" echo alive", marker.display()));
    let cancel = never();
    let press = cancel.clone();
    let in_browser = Arc::new(AtomicBool::new(false));
    let flag = in_browser.clone();
    let pressed = std::thread::spawn(move || {
        // The user presses Cancel once the card says Finish signing in in the browser.
        let deadline = Instant::now() + Duration::from_secs(20);
        while !flag.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        press.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let err = cx::sign_in(&store, &dir, "c1", false, NOW, codex_browser_login(&program, cancel, in_browser)).unwrap_err();
    pressed.join().unwrap();
    assert_eq!(err.reason, "cancelled");
    assert!(started.elapsed() < Duration::from_secs(8), "the sign-in stopped at Cancel, it did not run to its own end");
    assert!(cx::load(&store.lock().unwrap()).is_empty(), "no account row");
    assert_eq!(cx::active_account(&store.lock().unwrap()), None);
    assert!(!dir.join(cx::FOLDER).join("c1").exists(), "no partial home is kept");
    assert!(!dir.join(secrets::VAULT).join("codex-c1.json").exists(), "nothing sealed into the vault");
    // Past the point where the stand-in would have finished: the process underneath is gone.
    std::thread::sleep(Duration::from_secs(9));
    assert!(!marker.exists(), "the login process was ended, not just hidden from the card");
    assert!(!dir.join(cx::FOLDER).join("c1").exists());
}

// ---------------------------------------------------------------- ACCT-003

/// A stand-in `winget install`: prints download progress, then "installs" a `codex.cmd` into `bin`.
fn fake_winget(dir: &Path, bin: &Path) -> PathBuf {
    write_bat(
        dir,
        "winget.cmd",
        &[
            "echo Found Codex CLI [OpenAI.Codex] Version 0.161.0",
            "echo Downloading https://example.invalid/codex.zip",
            "echo   12.0 MB / 48.0 MB",
            "ping -n 3 127.0.0.1 >nul",
            "echo   24.0 MB / 48.0 MB",
            "ping -n 3 127.0.0.1 >nul",
            "echo   48.0 MB / 48.0 MB",
            "echo Successfully verified installer hash",
            &format!("md \"{0}\" 2>nul & >\"{0}\\codex.cmd\" echo @echo codex", bin.display()),
            "echo Successfully installed",
        ],
    )
}

fn winget_line(program: &Path) -> portable_pty::CommandBuilder {
    let mut cmd = portable_pty::CommandBuilder::new(program.as_os_str());
    cmd.args(install::command_args(install::package("codex").unwrap()));
    cmd
}

#[test]
fn acct003_box1_install_progress_moves_then_the_tool_is_found_with_no_restart() {
    let dir = folder("install-ok");
    let bin = dir.join("bin");
    let winget = fake_winget(&dir, &bin);
    let argv = winget_line(&winget).get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert_eq!(&argv[1..4], ["install", "--id", "OpenAI.Codex"]);
    assert!(kolux_lib::agents::find_in(std::slice::from_ref(&bin), "codex").is_none(), "Codex is missing to begin with");
    // The install, with the progress the card would show after each poll.
    let seen: Arc<Mutex<Vec<u8>>> = Arc::default();
    let tick = seen.clone();
    let (_, ended) = ck::run_hidden(winget_line(&winget), install::LIMIT, never(), || {}, move |clean| {
        if let Some(p) = install::progress(clean) {
            let mut s = tick.lock().unwrap();
            if s.last() != Some(&p) {
                s.push(p);
            }
        }
        false
    });
    assert_eq!(install::conclude(&ended, "codex"), Ok(()));
    let seen = seen.lock().unwrap().clone();
    assert!(seen.len() >= 2 && seen.windows(2).all(|w| w[0] < w[1]), "progress moved upward at least twice: {seen:?}");
    // Found at once: the search path is read again (this process's own entries are kept) and the
    // program is there; no restart.
    let old = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{};{}", bin.display(), old));
    install::reread_path();
    let path = std::env::var("PATH").unwrap();
    std::env::set_var("PATH", &old);
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    assert!(dirs.iter().any(|d| d == &bin), "the new folder is on the program search path");
    assert!(kolux_lib::agents::find_in(&dirs, "codex").is_some(), "Codex is found right after the install");
    assert_eq!(install::found_after("Codex", true), Ok(()));
}

#[test]
fn acct003_box2_an_install_that_hangs_is_stopped_at_the_limit_and_shown_as_failed_to_try_again() {
    let dir = folder("install-hang");
    let hang = write_bat(&dir, "winget.cmd", &["echo Downloading https://example.invalid/codex.zip", "ping -n 60 127.0.0.1 >nul"]);
    // The real limit is fifteen minutes; the same code path runs here with a two-second stand-in.
    assert_eq!(install::LIMIT, Duration::from_secs(15 * 60));
    let started = Instant::now();
    let (_, ended) = ck::run_hidden(winget_line(&hang), Duration::from_secs(2), never(), || {}, |_| false);
    assert!(matches!(ended, ck::Ended::TimedOut) && started.elapsed() < Duration::from_secs(20), "the hung install was stopped: {ended:?}");
    let failed = install::conclude(&ended, "codex").unwrap_err();
    let wire = serde_json::to_value(&failed).unwrap();
    assert_eq!(wire["reason"], "install-failed", "the reason the card maps to Try installing again");
    assert!(failed.message.contains("15 minutes"));
    // MIRROR install.rs:238: agent_install hands LIMIT to run_hidden; the live spawn re-confirms the card.
    assert!(include_str!("../src/install.rs").contains("run_hidden(cmd, LIMIT, cancel,"));
}

// ---------------------------------------------------------------- ACCT-008

#[test]
fn acct008_the_xai_key_is_kept_sealed_once_never_shown_and_a_cli_sign_in_wins() {
    let (dir, store) = profile("grok-key");
    let typed = format!("  {CLEAR_XAI}  ");
    // MIRROR grok.rs:219-227 (grok_key_set): trim, refuse empty, write sealed; the page is not sent it back.
    let key = typed.trim();
    assert!(!key.is_empty());
    secrets::write_setting(&store.lock().unwrap(), grok::KEY_FIELD, key).unwrap();
    let raw = on_disk(&dir);
    assert!(!raw.contains(CLEAR_XAI) && !raw.contains("FAKE-NOT-A-REAL"), "sealed in the settings file");
    assert!(secrets::is_sealed(serde_json::from_str::<Value>(&raw).unwrap()[grok::KEY_FIELD].as_str().unwrap()));
    let store = store.lock().unwrap();
    assert!(!secrets::without_secrets(store.settings()).to_string().contains("xaiApiKey"), "the window's copy of the settings has no key field");
    let saved = secrets::read_setting(&store, grok::KEY_FIELD).unwrap();
    assert_eq!(saved.as_deref(), Some(CLEAR_XAI));
    // The card reports the key alone as connected, and the CLI sign-in when both exist.
    assert_eq!(grok::connection(false, saved.is_some()), "key");
    assert_eq!(grok::connection(true, saved.is_some()), "cli", "a CLI sign-in wins over a saved key");
    assert_eq!(grok::connection(true, false), "cli", "a sign-in made earlier is connected with nothing to do");
    assert_eq!(grok::connection(false, false), "none");
    // A new Grok pane gets the saved key; a pane of another agent does not.
    assert_eq!(grok::pane_env(Some("grok"), saved.clone()), Some((grok::KEY_ENV, CLEAR_XAI.to_string())));
    assert_eq!(grok::pane_env(Some("claude"), saved), None);
}

// ---------------------------------------------------------------- ACCT-034

#[test]
fn acct034_claude_and_codex_ladders_and_what_reset_gives_back() {
    // The same JSON the page is rendered from in src/settings/__cards__/ACCT-034.test.ts.
    let fixture: Value = serde_json::from_str(include_str!("../../src/settings/__cards__/ACCT-034.catalogue.json")).unwrap();
    assert_eq!(serde_json::to_value(routing::providers()).unwrap(), fixture, "the catalogue the page gets is the shipped one");
    let all = routing::providers();
    let pick = |p: &routing::Provider| p.defaults.iter().map(|d| (d.model, d.effort)).collect::<Vec<_>>();
    assert_eq!(routing::TIERS, ["major", "deep", "build", "light"]);
    assert_eq!(pick(&all[0]), [("fable", Some("high")), ("opus", Some("high")), ("sonnet", Some("medium")), ("haiku", None)], "Claude: top model high, Opus high, Sonnet medium, Haiku");
    assert_eq!(all[1].id, "codex");
    assert_ne!(pick(&all[0]), pick(&all[1]), "Codex has a ladder of its own");
    // Build set to Opus at high routes there; after Reset Claude (its entry removed, Codex's kept)
    // Build is Sonnet at medium and Codex's pick is as it was.
    let set = json!({"modelRouting": {"claude": {"build": {"model": "opus", "effort": "high"}}, "codex": {"build": {"model": "gpt-5.5", "effort": "low"}}}});
    assert_eq!(routing::route(&set, "claude", "build").unwrap(), (Some("opus".into()), Some("high".into())));
    let reset = json!({"modelRouting": {"codex": {"build": {"model": "gpt-5.5", "effort": "low"}}}});
    assert_eq!(routing::route(&reset, "claude", "build").unwrap(), (Some("sonnet".into()), Some("medium".into())));
    assert_eq!(routing::route(&reset, "codex", "build").unwrap(), (Some("gpt-5.5".into()), Some("low".into())));
}
