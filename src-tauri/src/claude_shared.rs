//! One Claude setup for every Claude config folder Kolux runs. The user's main Claude folder is the
//! source of truth and is read-only to Kolux: its `CLAUDE.md` and `settings.json` are copied into
//! another config folder (an account's, or the OpenRouter route's) when the main copy is newer, and
//! its skills, agents, commands, plugins and hooks folders are linked in as Windows directory
//! junctions, so an edit in the main folder shows up everywhere at once.
//!
//! Only the names in [`SHARED_FILES`] and [`SHARED_LINKS`] are ever looked at. The sign-in file, the
//! app's own config file and the sessions folder (`projects`, see [`NEVER_SHARED`]) are never opened,
//! copied or linked, and nothing in the main folder is written.
//!
//! On the OpenRouter route the copied `settings.json` loses every `env` key that starts with
//! `ANTHROPIC_` and the `apiKeyHelper` key, so the main folder's own sign-in or endpoint cannot
//! leak into a chat that runs through OpenRouter.
//!
//! The same file also holds [`everyday_env`], the git fence for the Everyday folder.
#![allow(dead_code)] // wired in the chat-app screens stage

use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Files copied from the main folder when it has the newer copy.
pub const SHARED_FILES: &[&str] = &["CLAUDE.md", "settings.json"];
/// Folders linked in as junctions, pointing at the main folder's own.
pub const SHARED_LINKS: &[&str] = &["skills", "agents", "commands", "plugins", "hooks"];
/// Names that are never opened, copied or linked: the sign-in, the app's config, the sessions.
pub const NEVER_SHARED: &[&str] = &[".credentials.json", ".claude.json", "projects"];
/// The `env` keys with this start are removed on the OpenRouter route.
pub const OPENROUTER_STRIPPED_PREFIX: &str = "ANTHROPIC_";
/// The settings key that names a program printing an API key; removed on the OpenRouter route.
pub const API_KEY_HELPER: &str = "apiKeyHelper";

/// Which kind of Claude config folder is being filled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// The user's main folder itself (nothing to do).
    Main,
    /// A managed account's folder.
    Account,
    /// The OpenRouter route's folder.
    OpenRouter,
}

/// What a sync did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SyncReport {
    /// Files copied this time.
    pub copied: Vec<&'static str>,
    /// Junctions made this time.
    pub linked: Vec<&'static str>,
    /// Problems; one failing item never stops the others.
    pub warnings: Vec<String>,
}

/// Brings `target_dir` in line with `main_dir` for `route`. The main folder is only read.
pub fn sync_shared(main_dir: &Path, target_dir: &Path, route: Route) -> SyncReport {
    let mut report = SyncReport::default();
    if route == Route::Main || !main_dir.is_dir() || same_folder(main_dir, target_dir) {
        return report;
    }
    if let Err(e) = fs::create_dir_all(target_dir) {
        report.warnings.push(format!("The Claude setup folder could not be made: {e}"));
        return report;
    }
    for name in SHARED_FILES {
        match copy_if_newer(&main_dir.join(name), &target_dir.join(name), name, route) {
            Ok(true) => report.copied.push(name),
            Ok(false) => {}
            Err(e) => report.warnings.push(format!("{name} could not be shared: {e}")),
        }
    }
    for name in SHARED_LINKS {
        match link_folder(&main_dir.join(name), &target_dir.join(name)) {
            Ok(true) => report.linked.push(name),
            Ok(false) => {}
            Err(e) => report.warnings.push(format!("{name} could not be shared: {e}")),
        }
    }
    report
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn modified(p: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// `settings.json` text for the OpenRouter route: `env` keys starting `ANTHROPIC_` (any case) and
/// `apiKeyHelper` removed, everything else and the key order kept.
pub fn strip_for_openrouter(settings: &str) -> Result<String, String> {
    let mut doc: Value = serde_json::from_str(settings).map_err(|e| format!("settings.json is not valid JSON ({e})"))?;
    let Some(obj) = doc.as_object_mut() else { return Err("settings.json is not a JSON object".into()) };
    obj.remove(API_KEY_HELPER);
    if let Some(env) = obj.get_mut("env").and_then(Value::as_object_mut) {
        env.retain(|k, _| !k.to_ascii_uppercase().starts_with(OPENROUTER_STRIPPED_PREFIX));
    }
    let mut text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text)
}

fn has_stripped_keys(settings: &str) -> bool {
    match serde_json::from_str::<Value>(settings) {
        Ok(Value::Object(o)) => o.contains_key(API_KEY_HELPER) || o.get("env").and_then(Value::as_object).is_some_and(|e| e.keys().any(|k| k.to_ascii_uppercase().starts_with(OPENROUTER_STRIPPED_PREFIX))),
        // A copy that cannot be read is replaced rather than trusted.
        _ => true,
    }
}

/// Copies one file when the main copy exists and is newer than the target's (or the target is
/// missing). On the OpenRouter route `settings.json` is stripped on the way, and a target that
/// still holds a stripped key is rewritten even when the main copy is not newer. True when the
/// target was written.
fn copy_if_newer(from: &Path, to: &Path, name: &str, route: Route) -> io::Result<bool> {
    let Ok(meta) = fs::metadata(from) else { return Ok(false) };
    if !meta.is_file() {
        return Ok(false);
    }
    let strip = route == Route::OpenRouter && name == "settings.json";
    let newer = match (modified(from), modified(to)) {
        (Some(a), Some(b)) => a > b,
        _ => true,
    };
    let dirty = strip && fs::read_to_string(to).is_ok_and(|t| has_stripped_keys(&t));
    if !newer && !dirty {
        return Ok(false);
    }
    if strip {
        let text = fs::read_to_string(from)?;
        let out = strip_for_openrouter(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        write_beside(to, out.as_bytes())?;
    } else {
        write_beside(to, &fs::read(from)?)?;
    }
    Ok(true)
}

/// Writes through a temporary file in the same folder, so a reader never sees half a file.
fn write_beside(to: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = to.with_extension(format!("kolux-tmp-{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, to).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// The folder a junction or symlink points at, `None` for anything else.
fn link_target(p: &Path) -> Option<PathBuf> {
    fs::read_link(p).ok()
}

fn plain(p: &Path) -> PathBuf {
    let c = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    PathBuf::from(c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

/// Makes `link` a junction to `source` (a folder in the main Claude folder). Nothing is made when
/// the main folder has no such folder. A link already pointing at it is left; a real folder or
/// file already there is the user's own and is never replaced (an error says so); a link that
/// points elsewhere is replaced, which removes only the link. True when a junction was made.
fn link_folder(source: &Path, link: &Path) -> io::Result<bool> {
    if !source.is_dir() {
        return Ok(false);
    }
    match fs::symlink_metadata(link) {
        Ok(_) => match link_target(link) {
            Some(t) if plain(&t) == plain(source) => return Ok(false),
            Some(_) => remove_link(link)?,
            None => return Err(io::Error::new(io::ErrorKind::AlreadyExists, "a folder of its own is already there, so it was left as it is")),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    make_junction(source, link)?;
    Ok(true)
}

/// Removes a junction or symlink without touching what it points at.
fn remove_link(link: &Path) -> io::Result<()> {
    // `remove_dir` on a junction removes the junction only; a file symlink needs `remove_file`.
    fs::remove_dir(link).or_else(|_| fs::remove_file(link))
}

#[cfg(windows)]
fn make_junction(source: &Path, link: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    let (s, l) = (source.to_string_lossy(), link.to_string_lossy());
    if s.contains(['%', '"']) || l.contains(['%', '"']) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "a folder name with % or a quote cannot be linked"));
    }
    // `mklink /J` needs no privilege. The whole command line is one quoted string for `cmd /S`.
    let mut cmd = crate::winproc::command("cmd.exe");
    cmd.raw_arg(format!("/D /S /C \"mklink /J \"{l}\" \"{s}\"\""));
    let out = cmd.output()?;
    if out.status.success() {
        Ok(())
    } else {
        let said = String::from_utf8_lossy(&out.stdout).trim().to_string() + &String::from_utf8_lossy(&out.stderr);
        Err(io::Error::other(format!("mklink failed: {}", said.trim())))
    }
}

#[cfg(not(windows))]
fn make_junction(source: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

/// The environment that hides any git repository above the Everyday folder from chats that run
/// there: `GIT_CEILING_DIRECTORIES` set to the Everyday folder's parent makes git stop looking
/// for a repository at that folder, so one in a parent (the user's home, a synced folder) stays
/// invisible. A repository inside the Everyday folder itself is still found.
pub fn everyday_env(everyday_dir: &Path) -> Vec<(String, String)> {
    everyday_dir.parent().filter(|p| !p.as_os_str().is_empty()).map(|p| vec![("GIT_CEILING_DIRECTORIES".to_string(), p.to_string_lossy().into_owned())]).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{Duration, SystemTime};

    const SETTINGS: &str = r#"{"model":"opus","apiKeyHelper":"print-key.cmd","env":{"ANTHROPIC_BASE_URL":"https://x.test","anthropic_auth_token":"t","KEEP_ME":"1","ANTHROPIC_API_KEY":"k"},"permissions":{"allow":["Read"]}}"#;

    fn set_age(p: &Path, secs_ago: u64) {
        let f = fs::OpenOptions::new().write(true).open(p).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(secs_ago)).unwrap();
    }

    fn main_folder(tag: &str) -> crate::test_dir::TempDir {
        let m = crate::test_dir::temp(tag);
        fs::write(m.join("CLAUDE.md"), "main rules").unwrap();
        fs::write(m.join("settings.json"), SETTINGS).unwrap();
        for d in SHARED_LINKS {
            fs::create_dir_all(m.join(d)).unwrap();
            fs::write(m.join(d).join("one.txt"), format!("main {d}")).unwrap();
        }
        m
    }

    /// Every path under `dir` with its length and modified time, to prove nothing changed.
    fn snapshot(dir: &Path) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
        let mut out = Vec::new();
        let mut todo = vec![dir.to_path_buf()];
        while let Some(d) = todo.pop() {
            for e in fs::read_dir(&d).unwrap().flatten() {
                let m = fs::metadata(e.path()).unwrap();
                out.push((e.path(), m.len(), m.modified().ok()));
                if m.is_dir() {
                    todo.push(e.path());
                }
            }
        }
        out.sort();
        out
    }

    #[test]
    fn files_are_copied_when_missing_or_older_and_left_when_newer() {
        let main = main_folder("shared-copy-main");
        let target = crate::test_dir::temp("shared-copy-target");
        let r = sync_shared(&main, &target, Route::Account);
        assert_eq!(r.copied, ["CLAUDE.md", "settings.json"], "{r:?}");
        assert_eq!(fs::read_to_string(target.join("CLAUDE.md")).unwrap(), "main rules");
        assert_eq!(fs::read_to_string(target.join("settings.json")).unwrap(), SETTINGS, "an account gets the settings as they are");
        // Nothing changed: nothing copied.
        assert!(sync_shared(&main, &target, Route::Account).copied.is_empty());
        // The main copy gets newer: copied again.
        set_age(&target.join("CLAUDE.md"), 3600);
        fs::write(main.join("CLAUDE.md"), "main rules v2").unwrap();
        assert_eq!(sync_shared(&main, &target, Route::Account).copied, ["CLAUDE.md"]);
        assert_eq!(fs::read_to_string(target.join("CLAUDE.md")).unwrap(), "main rules v2");
        // A target copy that is newer than the main one is kept.
        fs::write(target.join("CLAUDE.md"), "edited in the account").unwrap();
        set_age(&main.join("CLAUDE.md"), 3600);
        assert!(sync_shared(&main, &target, Route::Account).copied.is_empty());
        assert_eq!(fs::read_to_string(target.join("CLAUDE.md")).unwrap(), "edited in the account");
    }

    #[test]
    fn only_the_openrouter_route_strips_the_endpoint_and_key_settings() {
        let main = main_folder("shared-strip-main");
        let acct = crate::test_dir::temp("shared-strip-acct");
        let route = crate::test_dir::temp("shared-strip-route");
        sync_shared(&main, &acct, Route::Account);
        sync_shared(&main, &route, Route::OpenRouter);
        let kept: Value = serde_json::from_str(&fs::read_to_string(acct.join("settings.json")).unwrap()).unwrap();
        assert!(kept["env"]["ANTHROPIC_BASE_URL"].is_string() && kept["apiKeyHelper"].is_string());
        let cut: Value = serde_json::from_str(&fs::read_to_string(route.join("settings.json")).unwrap()).unwrap();
        assert_eq!(cut["env"], json!({ "KEEP_ME": "1" }), "every ANTHROPIC_ key goes, whatever its case");
        assert!(cut.get("apiKeyHelper").is_none());
        assert_eq!(cut["model"], "opus");
        assert_eq!(cut["permissions"], json!({ "allow": ["Read"] }));
        assert_eq!(fs::read_to_string(main.join("settings.json")).unwrap(), SETTINGS, "the main copy is untouched");
    }

    #[test]
    fn an_openrouter_copy_that_still_holds_a_key_is_cleaned_even_when_not_older() {
        let main = main_folder("shared-dirty-main");
        let route = crate::test_dir::temp("shared-dirty-route");
        // The folder was an account's copy earlier and is newer than the main file.
        set_age(&main.join("settings.json"), 3600);
        fs::write(route.join("settings.json"), SETTINGS).unwrap();
        let r = sync_shared(&main, &route, Route::OpenRouter);
        assert_eq!(r.copied, ["CLAUDE.md", "settings.json"], "the route had no CLAUDE.md, and the dirty settings are rewritten: {r:?}");
        assert!(!fs::read_to_string(route.join("settings.json")).unwrap().contains("ANTHROPIC_"));
        // And now it is clean, so the next sync copies nothing.
        assert!(sync_shared(&main, &route, Route::OpenRouter).copied.is_empty());
    }

    #[test]
    fn broken_settings_are_never_passed_on_to_the_openrouter_route() {
        let main = main_folder("shared-broken-main");
        let route = crate::test_dir::temp("shared-broken-route");
        fs::write(main.join("settings.json"), "{ not json ANTHROPIC_API_KEY").unwrap();
        let r = sync_shared(&main, &route, Route::OpenRouter);
        assert!(r.copied == ["CLAUDE.md"] && r.warnings.len() == 1, "{r:?}");
        assert!(!route.join("settings.json").exists());
    }

    #[test]
    fn linked_folders_resolve_to_the_main_ones_and_a_second_run_changes_nothing() {
        let main = main_folder("shared-link-main");
        let target = crate::test_dir::temp("shared-link-target");
        let r = sync_shared(&main, &target, Route::Account);
        assert_eq!(r.linked, SHARED_LINKS, "{r:?}");
        assert!(r.warnings.is_empty(), "{r:?}");
        for d in SHARED_LINKS {
            assert_eq!(fs::read_to_string(target.join(d).join("one.txt")).unwrap(), format!("main {d}"));
            assert!(fs::read_link(target.join(d)).is_ok(), "{d} is a link");
        }
        // A new skill in the main folder shows up through the link at once.
        fs::write(main.join("skills").join("new.txt"), "fresh").unwrap();
        assert_eq!(fs::read_to_string(target.join("skills").join("new.txt")).unwrap(), "fresh");
        assert!(sync_shared(&main, &target, Route::Account).linked.is_empty());
    }

    #[test]
    fn a_folder_of_the_accounts_own_is_never_replaced_and_a_stale_link_is_repointed() {
        let main = main_folder("shared-own-main");
        let other = main_folder("shared-own-other");
        let target = crate::test_dir::temp("shared-own-target");
        fs::create_dir_all(target.join("skills")).unwrap();
        fs::write(target.join("skills").join("mine.txt"), "mine").unwrap();
        let r = sync_shared(&main, &target, Route::Account);
        assert_eq!(r.warnings.len(), 1, "{r:?}");
        assert!(r.warnings[0].starts_with("skills "), "{r:?}");
        assert_eq!(fs::read_to_string(target.join("skills").join("mine.txt")).unwrap(), "mine");
        assert!(r.linked.contains(&"agents"));
        // A link to some other folder is repointed; the other folder keeps its files.
        remove_link(&target.join("agents")).unwrap();
        make_junction(&other.join("agents"), &target.join("agents")).unwrap();
        assert_eq!(sync_shared(&main, &target, Route::Account).linked, ["agents"]);
        assert_eq!(fs::read_to_string(target.join("agents").join("one.txt")).unwrap(), "main agents");
        assert_eq!(fs::read_to_string(other.join("agents").join("one.txt")).unwrap(), "main agents");
    }

    #[test]
    fn the_sign_in_files_and_sessions_are_never_opened_copied_or_linked() {
        let main = main_folder("shared-never-main");
        // Directories where the files would be: opening one as a file fails, so a sync that
        // succeeds and reports no warning never tried to read them.
        fs::create_dir_all(main.join(".credentials.json").join("inner")).unwrap();
        fs::create_dir_all(main.join(".claude.json").join("inner")).unwrap();
        fs::create_dir_all(main.join("projects").join("p")).unwrap();
        fs::write(main.join("projects").join("p").join("s.jsonl"), "session").unwrap();
        for route in [Route::Account, Route::OpenRouter] {
            let target = crate::test_dir::temp("shared-never-target");
            let r = sync_shared(&main, &target, route);
            assert!(r.warnings.is_empty(), "{r:?}");
            for n in NEVER_SHARED {
                assert!(!target.join(n).exists(), "{n} was shared");
            }
            let mut names: Vec<String> = fs::read_dir(&*target).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            names.sort();
            let mut allowed: Vec<String> = SHARED_FILES.iter().chain(SHARED_LINKS).map(|s| s.to_string()).collect();
            allowed.sort();
            assert_eq!(names, allowed);
        }
    }

    #[test]
    fn the_main_folder_is_unchanged_by_a_sync() {
        let main = main_folder("shared-ro-main");
        fs::create_dir_all(main.join("projects")).unwrap();
        fs::write(main.join(".credentials.json"), "secret").unwrap();
        let before = snapshot(&main);
        for route in [Route::Account, Route::OpenRouter] {
            let target = crate::test_dir::temp("shared-ro-target");
            sync_shared(&main, &target, route);
            sync_shared(&main, &target, route);
        }
        assert_eq!(snapshot(&main), before);
    }

    #[test]
    fn a_missing_main_folder_and_the_main_route_do_nothing() {
        let target = crate::test_dir::temp("shared-none-target");
        let gone = target.join("no-such-main");
        assert_eq!(sync_shared(&gone, &target.join("t"), Route::Account), SyncReport::default());
        assert!(!target.join("t").exists());
        let main = main_folder("shared-none-main");
        assert_eq!(sync_shared(&main, &main, Route::Account), SyncReport::default());
        assert_eq!(sync_shared(&main, &target, Route::Main), SyncReport::default());
    }

    #[test]
    fn everyday_env_fences_off_the_parent_folder() {
        let env = everyday_env(Path::new(r"C:\Users\x\Kolux\Everyday"));
        assert_eq!(env, [("GIT_CEILING_DIRECTORIES".to_string(), r"C:\Users\x\Kolux".to_string())]);
        assert!(everyday_env(Path::new("")).is_empty());
    }

    fn git(dir: &Path, env: &[(String, String)], args: &[&str]) -> std::process::Output {
        let mut cmd = crate::winproc::command("git");
        cmd.current_dir(dir).args(args).env("GIT_CONFIG_NOSYSTEM", "1");
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.output().expect("git runs")
    }

    #[test]
    fn a_git_repo_above_the_everyday_folder_is_invisible_there() {
        let top = crate::test_dir::temp("shared-everyday");
        assert!(git(&top, &[], &["init", "-q"]).status.success());
        let everyday = top.join("Everyday");
        fs::create_dir_all(&everyday).unwrap();
        // Without the fence the repo above is found.
        let seen = git(&everyday, &[], &["rev-parse", "--show-toplevel"]);
        assert!(seen.status.success(), "the control: {}", String::from_utf8_lossy(&seen.stderr));
        // With it, git finds no repository.
        let fenced = git(&everyday, &everyday_env(&everyday), &["rev-parse", "--show-toplevel"]);
        assert!(!fenced.status.success(), "git still saw {}", String::from_utf8_lossy(&fenced.stdout));
        // A repo made inside the Everyday folder is still found.
        assert!(git(&everyday, &everyday_env(&everyday), &["init", "-q"]).status.success());
        assert!(git(&everyday, &everyday_env(&everyday), &["rev-parse", "--show-toplevel"]).status.success());
    }
}
