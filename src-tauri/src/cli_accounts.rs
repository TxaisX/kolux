//! CLI-014 / ACCT-031: `kolux account add` and `kolux account list`.
//!
//! `add` asks the app first (so nothing starts when Kolux is not running or is too old), gets a
//! throwaway folder inside the app's own profile, runs the agent's own login right in the user's
//! terminal against that folder (Claude: `claude auth login`; Codex: `codex login --device-auth`,
//! so the browser can be on another machine), then hands the folder to the app, which registers
//! the account the same way Settings does and deletes the folder. Ctrl+C while the login runs is
//! passed to the login only; the command then removes the throwaway folder before it ends, and a
//! second Ctrl+C just waits for that. When the terminal itself closes (an SSH session dropping),
//! the folder is removed on the way out. `list` reads the saved lists; it never asks a provider
//! for fresh usage.

use crate::claude_key::Ended;
use crate::cli::{Ctx, Fail, Request};
use crate::state::Store;
use crate::{claude_accounts, codex_accounts};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub const ADD: &str = "account.add";
pub const LIST: &str = "account.list";
pub const BEGIN: &str = "account.add-begin";
pub const FINISH: &str = "account.add-finish";
/// Where a command-line sign-in writes until the app takes it in.
pub const TEMP_FOLDER: &str = "sign-in-temp";
pub const AGENTS: &[&str] = &["claude", "codex"];

fn name(agent: &str) -> &'static str {
    if agent == "codex" {
        "Codex"
    } else {
        "Claude Code"
    }
}

// ---------------------------------------------------------------- the app's side

/// Row 944: an account id from the renderer is joined into paths, so only letters and digits pass (no "..", separators or empty).
pub(crate) fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The throwaway folder of one sign-in; always worked out here, never taken from the caller.
pub fn temp_of(profile: &Path, agent: &str, id: &str) -> Option<PathBuf> {
    (AGENTS.contains(&agent) && safe_id(id)).then(|| profile.join(TEMP_FOLDER).join(format!("{agent}-{id}")))
}

pub fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let agent = req.args["agent"].as_str().unwrap_or("claude");
    let profile = ctx.store.lock().map_err(|e| Fail::new("failed", e.to_string()))?.dir();
    match req.command.as_str() {
        LIST => Ok(list(&*ctx.store.lock().map_err(|e| Fail::new("failed", e.to_string()))?)),
        BEGIN => begin(&profile, agent, &format!("{:x}", crate::claude_key::now_ms())),
        FINISH => {
            let id = req.args["id"].as_str().unwrap_or_default();
            let program = crate::agents::find_program("claude");
            let status = |dir: &Path| program.as_deref().and_then(|p| claude_accounts::auth_status(p, Some(dir)));
            let out = finish(ctx.store, &profile, agent, id, crate::claude_key::now_ms(), status, codex_accounts::remove_dir_patiently, &crate::hooks::agent_hooks::user_home());
            (ctx.notify)(json!({ "kind": "accounts" }));
            out
        }
        other => Err(Fail::new("invalid_arguments", format!("unknown command {other}"))),
    }
}

/// Every managed account with the active one marked; nothing active means the agent's own
/// login (the system default) is the one new panes use.
pub fn list(store: &Store) -> Value {
    let claude_active = claude_accounts::active(store);
    let codex_active = store.get(codex_accounts::ACTIVE_KEY).ok().flatten().filter(|id| codex_accounts::load(store).iter().any(|a| &a.id == id));
    let mut accounts: Vec<Value> = claude_accounts::load(store)
        .into_iter()
        .map(|a| json!({ "agent": "claude", "id": a.id, "email": a.email, "organization": a.organization, "active": claude_active.as_deref() == Some(a.id.as_str()), "lastSignIn": a.last_sign_in, "needsSignIn": a.stale }))
        .collect();
    accounts.extend(codex_accounts::load(store).into_iter().map(|a| json!({ "agent": "codex", "id": a.id, "email": a.email, "organization": Value::Null, "active": codex_active.as_deref() == Some(a.id.as_str()), "lastSignIn": a.last_sign_in, "needsSignIn": a.sign_in_error })));
    json!({ "accounts": accounts, "systemDefault": { "claude": claude_active.is_none(), "codex": codex_active.is_none() } })
}

/// Makes the throwaway folder a command-line sign-in writes into.
pub fn begin(profile: &Path, agent: &str, id: &str) -> Result<Value, Fail> {
    if agent == "codex" {
        let env = std::env::var(codex_accounts::HOME_ENV).ok();
        let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
        if codex_accounts::user_custom_provider(env.as_deref(), user.as_deref()) {
            return Err(Fail::new("refused", codex_accounts::CUSTOM_PROVIDER_REFUSAL));
        }
    }
    let temp = temp_of(profile, agent, id).ok_or_else(|| Fail::new("invalid_arguments", "account add signs in claude or codex"))?;
    fs::create_dir_all(&temp).map_err(|e| Fail::new("failed", format!("could not make a folder for the sign-in: {e}")))?;
    if agent == "codex" {
        // The sign-in must land in the folder's own auth.json, not the system keyring.
        fs::write(temp.join("config.toml"), codex_accounts::HOME_CONFIG).map_err(|e| Fail::new("failed", e.to_string()))?;
    }
    Ok(json!({ "id": id, "temp": temp }))
}

/// Takes in what the login left in the throwaway folder as a managed account (the same checks as
/// Settings: a real new sign-in, not one already listed), then deletes the folder. A sign-in that
/// worked is still a failure when the folder cannot be deleted, and the account is not kept. `home` is
/// the home whose hooks install lock the rollback takes (a test passes a scratch one).
#[allow(clippy::too_many_arguments)]
pub fn finish(store: &Mutex<Store>, profile: &Path, agent: &str, id: &str, now: i64, status: impl FnOnce(&Path) -> Option<String>, cleanup: impl Fn(&Path) -> std::io::Result<()>, home: &Path) -> Result<Value, Fail> {
    let temp = temp_of(profile, agent, id).filter(|t| t.is_dir()).ok_or_else(|| Fail::new("failed", "that sign-in is not waiting in Kolux; run kolux account add again"))?;
    let adopt = |dir: &Path| -> Result<(), String> {
        for entry in fs::read_dir(&temp).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            fs::rename(entry.path(), dir.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    let ended = |r: Result<(), String>| r.map_or_else(Ended::NotStarted, |()| Ended::Exited(Some(0)));
    let added = if agent == "codex" {
        codex_accounts::sign_in(store, profile, id, false, now, |home| (String::new(), ended(adopt(home)), None)).map(|a| json!({ "agent": "codex", "id": a.id, "email": a.email, "organization": Value::Null, "active": true }))
    } else {
        claude_accounts::sign_in(store, profile, id, false, now, |dir| (String::new(), ended(adopt(dir))), status).map(|a| json!({ "agent": "claude", "id": a.id, "email": a.email, "organization": a.organization, "active": false }))
    };
    let cleaned = cleanup(&temp);
    match (added, cleaned) {
        (Err(a), _) => Err(Fail::new("sign_in_failed", a.message)),
        (Ok(v), Err(e)) => {
            let s = store.lock().map_err(|e| Fail::new("failed", e.to_string()))?;
            // Row 921: a taken id was moved on, so remove the account that was made, not the one asked for.
            let made = v["id"].as_str().unwrap_or(id);
            let _ = if agent == "codex" { codex_accounts::discard(&s, profile, made) } else { claude_accounts::discard(&s, profile, made, home) };
            Err(Fail::new("sign_in_failed", format!("The sign-in worked, but its temporary copy at {} could not be removed ({e}), so the account was not kept. Delete that folder and try again.", temp.display())))
        }
        (Ok(v), Ok(())) => Ok(v),
    }
}

// ---------------------------------------------------------------- the command line's side

static INTERRUPTED: AtomicBool = AtomicBool::new(false);
static HELD: Mutex<Option<PathBuf>> = Mutex::new(None);

fn drop_held() -> std::io::Result<()> {
    let held = HELD.lock().ok().and_then(|mut h| h.take());
    held.map_or(Ok(()), |t| codex_accounts::remove_dir_patiently(&t))
}

#[cfg(windows)]
unsafe extern "system" fn on_console_event(kind: u32) -> windows_sys::core::BOOL {
    use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT};
    if kind == CTRL_C_EVENT || kind == CTRL_BREAK_EVENT {
        // The login gets the interrupt too and ends; the command cleans up after it.
        INTERRUPTED.store(true, Ordering::SeqCst);
    } else {
        // The terminal is closing or the session ending: this process ends when we return.
        let _ = drop_held();
    }
    1
}

fn arm() {
    INTERRUPTED.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    // SAFETY: registers a plain function that only touches statics; it stays valid for the
    // life of the process.
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(on_console_event), 1);
    }
}

/// Runs the agent's own login in this terminal against `temp`; its exit code.
pub fn run_login(agent: &str, temp: &Path) -> Result<Option<i32>, String> {
    let program = crate::agents::find_program(agent).ok_or_else(|| format!("{} is not installed, so there is nothing to sign in with", name(agent)))?;
    let mut cmd = std::process::Command::new(program);
    if agent == "codex" {
        cmd.args(["login", "--device-auth"]).env(codex_accounts::HOME_ENV, temp);
    } else {
        cmd.args(["auth", "login"]).env(claude_accounts::CONFIG_ENV, temp).env_remove(crate::claude_key::ENV);
    }
    // CLI-004: a prompt or device code goes to standard error, so `--json` output stays parseable.
    run_forwarding(cmd, std::io::stderr()).map_err(|e| format!("{}'s sign-in could not start: {e}", name(agent)))
}

/// Runs `cmd` in this terminal with its standard output copied to `to` as it arrives; its input and
/// its own error output stay the user's. Gives the exit code (none when a signal ended it).
fn run_forwarding(mut cmd: std::process::Command, mut to: impl std::io::Write + Send) -> std::io::Result<Option<i32>> {
    use std::io::Read;
    cmd.stdout(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;
    let mut out = child.stdout.take();
    let status = std::thread::scope(|s| {
        s.spawn(|| {
            let mut buf = [0u8; 1024];
            while let Some(Ok(n)) = out.as_mut().map(|o| o.read(&mut buf)) {
                if n == 0 || to.write_all(&buf[..n]).and_then(|_| to.flush()).is_err() {
                    break;
                }
            }
        });
        child.wait()
    })?;
    Ok(status.code())
}

/// Refused before the app is asked when the agent is not installed.
pub fn installed(agent: &str) -> Result<(), Fail> {
    match crate::agents::find_program(agent) {
        Some(_) => Ok(()),
        None => Err(Fail::new("not_found", format!("{} is not installed, so there is nothing to sign in with", name(agent)))),
    }
}

/// `kolux account add`: `ask` sends one request to the app and gives its result, `login` runs
/// the sign-in in this terminal.
pub fn add(agent: &str, ask: impl Fn(&str, Value) -> Result<Value, Fail>, login: impl FnOnce(&Path) -> Result<Option<i32>, String>) -> Result<Value, Fail> {
    arm();
    let begun = ask(BEGIN, json!({ "agent": agent })).map_err(|f| if f.message.contains("unknown command") { Fail::new("app_too_old", "This Kolux is too old to take in accounts from the command line; update it, then try again.") } else { f })?;
    let (Some(id), Some(temp)) = (begun["id"].as_str(), begun["temp"].as_str().map(PathBuf::from)) else {
        return Err(Fail::new("failed", "the app did not say where the sign-in goes"));
    };
    if let Ok(mut h) = HELD.lock() {
        *h = Some(temp.clone());
    }
    let ran = login(&temp);
    let stopped = if INTERRUPTED.load(Ordering::SeqCst) {
        Some("Sign-in interrupted".to_string())
    } else {
        match ran {
            Ok(Some(0)) => None,
            Ok(code) => Some(format!("{}'s sign-in ended without signing in (exit {})", name(agent), code.map_or("unknown".into(), |c| c.to_string()))),
            Err(e) => Some(e),
        }
    };
    if let Some(why) = stopped {
        return Err(match drop_held() {
            Ok(()) => Fail::new("sign_in_failed", format!("{why}; nothing was added and its temporary sign-in was removed.")),
            Err(e) => Fail::new("sign_in_failed", format!("{why}; nothing was added, but its temporary sign-in at {} could not be removed ({e}). Delete that folder.", temp.display())),
        });
    }
    let out = ask(FINISH, json!({ "agent": agent, "id": id }));
    let left = drop_held();
    match (out, left) {
        (Ok(_), Err(e)) => Err(Fail::new("sign_in_failed", format!("The account was added, but its temporary sign-in at {} could not be removed ({e}). Delete that folder.", temp.display()))),
        (out, _) => out,
    }
}

/// What `account list` and `account add` print without `--json`.
pub fn text(command: &str, r: &Value) -> String {
    let who = |a: &Value| {
        let parts: Vec<&str> = [a["email"].as_str(), a["organization"].as_str()].into_iter().flatten().collect();
        if parts.is_empty() {
            "(no email reported)".to_string()
        } else {
            parts.join(" · ")
        }
    };
    if command == ADD {
        let agent = r["agent"].as_str().unwrap_or("claude");
        let then = if r["active"] == true { format!("; new {} panes use it now", name(agent)) } else { "; pick it in Settings > Accounts to use it for new panes".into() };
        return format!("added {} account {}{then}", name(agent), who(r));
    }
    let mut out = Vec::new();
    for agent in AGENTS {
        out.push(name(agent).to_string());
        let mark = |on: bool| if on { "*" } else { " " };
        out.push(format!("  {} System default ({}'s own login)", mark(r["systemDefault"][agent] == true), name(agent)));
        for a in r["accounts"].as_array().into_iter().flatten().filter(|a| a["agent"] == *agent) {
            let warn = if a["needsSignIn"] == true { "  (needs sign-in again)" } else { "" };
            out.push(format!("  {} {}{warn}", mark(a["active"] == true), who(a)));
        }
    }
    out.push("* marks the one new panes use".into());
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Row 944: only letters and digits are a safe account id.
    #[test]
    fn row944_safe_id_takes_letters_and_digits_only() {
        for ok in ["a1", "c7", "19f3a"] {
            assert!(safe_id(ok), "{ok}");
        }
        for bad in ["", "..", ".", "a/b", "a\\b", "a-1", "a b", "é"] {
            assert!(!safe_id(bad), "{bad:?}");
        }
    }

    struct Sink(std::sync::Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for Sink {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn t197c_a_sign_in_s_prompt_goes_to_the_stream_it_is_sent_to_and_its_exit_code_comes_back() {
        let said = std::sync::Arc::new(Mutex::new(Vec::new()));
        let run = |line: &str, to: Sink| {
            let mut c = if cfg!(windows) { std::process::Command::new("cmd") } else { std::process::Command::new("sh") };
            c.args([if cfg!(windows) { "/C" } else { "-c" }, line]);
            run_forwarding(c, to).unwrap()
        };
        assert_eq!(run("echo Visit the page and enter the code ABCD-1234", Sink(said.clone())), Some(0));
        assert!(String::from_utf8_lossy(&said.lock().unwrap()).contains("enter the code ABCD-1234"));
        assert_eq!(run("exit 3", Sink(said.clone())), Some(3), "a failed login keeps its own status");
        assert!(run_forwarding(std::process::Command::new("kolux-rs-no-such-program"), Sink(said)).is_err(), "a program that will not start is an error");
    }

    const CREDS: &str = r#"{"claudeAiOauth":{"accessToken":"fake-access","refreshToken":"fake-refresh"}}"#;
    const SIGNED_IN: &str = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.com","orgName":"Example Org"}"#;

    /// The folder goes when the test ends, after the store in it has closed.
    fn profile(tag: &str) -> (crate::test_dir::TempDir, Mutex<Store>) {
        let dir = crate::test_dir::temp(&format!("rs-cli-acct-{tag}"));
        let store = Store::open(&dir).unwrap();
        (dir, Mutex::new(store))
    }

    #[test]
    fn a_claude_sign_in_from_the_command_line_is_listed_and_its_temporary_copy_is_gone() {
        let (dir, store) = profile("claude");
        let begun = begin(&dir, "claude", "a1").unwrap();
        let temp = PathBuf::from(begun["temp"].as_str().unwrap());
        assert!(temp.starts_with(dir.join(TEMP_FOLDER)));
        fs::write(temp.join(claude_accounts::CREDENTIALS), CREDS).unwrap();
        let added = finish(&store, &dir, "claude", "a1", 5, |_| Some(SIGNED_IN.into()), codex_accounts::remove_dir_patiently, &dir.join("home")).unwrap();
        assert_eq!(added["email"], "sam@example.com");
        assert!(!temp.exists(), "the throwaway folder is deleted");
        assert_eq!(fs::read_to_string(dir.join(claude_accounts::FOLDER).join("a1").join(claude_accounts::CREDENTIALS)).unwrap(), CREDS);
        let listed = list(&store.lock().unwrap());
        assert_eq!(listed["accounts"][0]["email"], "sam@example.com");
        assert_eq!(listed["accounts"][0]["active"], false);
        assert_eq!(listed["systemDefault"]["claude"], true, "a new Claude account is not made active");
        assert!(text(LIST, &listed).contains("* System default (Claude Code's own login)\n    sam@example.com · Example Org"));
        // The same account again: refused, nothing kept.
        let again = begin(&dir, "claude", "a2").unwrap();
        fs::write(PathBuf::from(again["temp"].as_str().unwrap()).join(claude_accounts::CREDENTIALS), CREDS.replace("fake-access", "other")).unwrap();
        let twin = finish(&store, &dir, "claude", "a2", 6, |_| Some(SIGNED_IN.into()), codex_accounts::remove_dir_patiently, &dir.join("home")).unwrap_err();
        assert!(twin.message.contains("already in the list"), "{}", twin.message);
        assert_eq!(claude_accounts::load(&store.lock().unwrap()).len(), 1);
        assert!(!dir.join(TEMP_FOLDER).join("claude-a2").exists() && !dir.join(claude_accounts::FOLDER).join("a2").exists());
    }

    #[test]
    fn a_codex_device_sign_in_is_made_active_and_a_login_that_wrote_nothing_adds_nothing() {
        let (dir, store) = profile("codex");
        let begun = begin(&dir, "codex", "c1").unwrap();
        let temp = PathBuf::from(begun["temp"].as_str().unwrap());
        assert!(fs::read_to_string(temp.join("config.toml")).unwrap().contains("cli_auth_credentials_store"));
        let empty = finish(&store, &dir, "codex", "c1", 5, |_| None, codex_accounts::remove_dir_patiently, &dir.join("home")).unwrap_err();
        assert_eq!(empty.code, "sign_in_failed");
        assert!(codex_accounts::load(&store.lock().unwrap()).is_empty() && !temp.exists() && !dir.join(codex_accounts::FOLDER).join("c1").exists());
        let begun = begin(&dir, "codex", "c2").unwrap();
        let temp = PathBuf::from(begun["temp"].as_str().unwrap());
        fs::write(temp.join("auth.json"), r#"{"tokens":{"id_token":"x","access_token":"y","refresh_token":"z"}}"#).unwrap();
        let added = finish(&store, &dir, "codex", "c2", 6, |_| None, codex_accounts::remove_dir_patiently, &dir.join("home")).unwrap();
        assert_eq!(added["active"], true);
        let listed = list(&store.lock().unwrap());
        assert_eq!((listed["accounts"][0]["agent"].as_str(), listed["systemDefault"]["codex"].as_bool()), (Some("codex"), Some(false)));
        assert!(text(LIST, &listed).contains("Codex\n    System default (Codex's own login)\n  * (no email reported)"));
    }

    #[test]
    fn a_sign_in_whose_temporary_copy_cannot_be_removed_is_reported_failed_and_not_kept() {
        let (dir, store) = profile("stuck");
        let temp = PathBuf::from(begin(&dir, "claude", "s1").unwrap()["temp"].as_str().unwrap());
        fs::write(temp.join(claude_accounts::CREDENTIALS), CREDS).unwrap();
        let stuck = finish(&store, &dir, "claude", "s1", 5, |_| Some(SIGNED_IN.into()), |_| Err(std::io::Error::other("in use")), &dir.join("home")).unwrap_err();
        assert!(stuck.message.contains("was not kept"), "{}", stuck.message);
        assert!(claude_accounts::load(&store.lock().unwrap()).is_empty());
        // Row 989 R1: the rollback took its hooks install lock under the scratch home, never the real one.
        assert!(dir.join("home").join(".kolux-rs").join("agent-hooks").is_dir(), "the lock ran in the scratch home");
    }

    #[test]
    fn an_interrupted_sign_in_leaves_nothing_behind_and_the_app_is_never_asked_to_keep_it() {
        let (dir, store) = profile("interrupt");
        let asked = Mutex::new(Vec::new());
        let ask = |command: &str, args: Value| {
            asked.lock().unwrap().push(command.to_string());
            match command {
                BEGIN => begin(&dir, args["agent"].as_str().unwrap(), "i1"),
                _ => finish(&store, &dir, "claude", "i1", 5, |_| Some(SIGNED_IN.into()), codex_accounts::remove_dir_patiently, &dir.join("home")),
            }
        };
        let out = add("claude", ask, |temp| {
            fs::write(temp.join(claude_accounts::CREDENTIALS), CREDS).unwrap();
            INTERRUPTED.store(true, Ordering::SeqCst); // Ctrl+C part-way through
            Ok(None)
        });
        assert!(out.unwrap_err().message.starts_with("Sign-in interrupted; nothing was added"));
        assert!(!dir.join(TEMP_FOLDER).join("claude-i1").exists(), "no stray credentials");
        assert_eq!(*asked.lock().unwrap(), vec![BEGIN.to_string()]);
        let out = add("claude", ask, |temp| fs::write(temp.join(claude_accounts::CREDENTIALS), CREDS).map(|()| Some(0)).map_err(|e| e.to_string()));
        assert_eq!(out.unwrap()["email"], "sam@example.com");
        assert!(!dir.join(TEMP_FOLDER).join("claude-i1").exists());
        let old = add("claude", |_: &str, _: Value| Err(Fail::new("invalid_arguments", "unknown command account.add-begin")), |_| unreachable!("no sign-in starts"));
        assert_eq!(old.unwrap_err().code, "app_too_old");
        let gone = add("claude", |_: &str, _: Value| Err(Fail::new("app_unreachable", "Kolux is not running; start it first")), |_| unreachable!("no sign-in starts"));
        assert_eq!(gone.unwrap_err().code, "app_unreachable");
    }

    #[test]
    fn a_folder_is_only_ever_worked_out_by_the_app() {
        let dir = PathBuf::from("p");
        assert_eq!(temp_of(&dir, "codex", "ab12"), Some(dir.join(TEMP_FOLDER).join("codex-ab12")));
        assert_eq!(temp_of(&dir, "codex", "../x"), None);
        assert_eq!(temp_of(&dir, "grok", "ab12"), None);
        assert_eq!(temp_of(&dir, "claude", ""), None);
    }
}
