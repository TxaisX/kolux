//! GitHub reads through gh that the kept engine shares: a repository's fork parent (GIT-055, for
//! pull request review), the one host gate every gh call passes, and the pull request check details
//! and merge (pull_requests.rs).

use crate::scm::{gh_run, gh_words};
use std::path::Path;

// The pull request reads and writes, mounted here so lib.rs needs no `mod` line of its own.
#[path = "pull_requests.rs"]
pub(crate) mod pull_requests;

/// `owner/name` checked to plain GitHub names, and the host to a plain host name; anything else is
/// refused before gh sees it.
pub(crate) fn repo_path(host: &str, repo: &str) -> Result<String, String> {
    if !host_ok(host) {
        return Err("This repository's GitHub host cannot be read".into());
    }
    if !full_name_ok(repo) {
        return Err("This repository's name cannot be read".into());
    }
    Ok(format!("repos/{repo}"))
}

/// The owner/name rule: exactly two plain GitHub name parts (letters, digits, `-`, `_`, `.`, never
/// `.` or `..` alone). Used for what Kolux sends to gh and for what GitHub answers (FIX-1), so a
/// parent name can never break the `repo:owner/name` search it goes into.
pub fn full_name_ok(repo: &str) -> bool {
    let plain = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    matches!(repo.split_once('/'), Some((o, n)) if plain(o) && plain(n))
}

pub(crate) fn gh_json(gh: &Path, host: &str, path: &str, extra: &[&str]) -> Result<serde_json::Value, String> {
    host_allowed(gh, host)?;
    let args: Vec<&str> = ["api", path, "--hostname", host].into_iter().chain(extra.iter().copied()).collect();
    let text = gh_run(gh, &std::env::temp_dir(), &args, None).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// GIT-055: the parent (`owner/name`) of a fork, from GitHub's repository record; None when the
/// repository is not a fork or its parent is gone.
pub fn parent_of(v: &serde_json::Value) -> Option<String> {
    if v["fork"].as_bool() != Some(true) {
        return None;
    }
    v["parent"]["full_name"].as_str().filter(|s| full_name_ok(s)).map(String::from)
}

/// GIT-055: the fork parent of `repo` on `host`.
pub fn repo_parent(gh: &Path, host: &str, repo: &str) -> Result<Option<String>, String> {
    Ok(parent_of(&gh_json(gh, host, &repo_path(host, repo)?, &[])?))
}

/// A plain host name: what `repo_path` and the host gate check before gh sees it.
pub(crate) fn host_ok(host: &str) -> bool {
    !host.is_empty() && !host.starts_with('-') && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
}

/// FIX-1 (council FB 1): the one gate in front of every gh call this file makes. Kolux talks only to
/// github.com, to the host GH_HOST names, or to a host gh is signed in to (gh keeps a user for it in
/// its own config: `gh config get -h <host> user`, which reads gh's config and goes nowhere). Any
/// other host, from a pasted project address or from a repository's remote, is refused before gh
/// runs, so gh never sends an Enterprise token or even a bare request to it.
pub(crate) fn host_allowed(gh: &Path, host: &str) -> Result<(), String> {
    host_allowed_with(gh, host, std::env::var("GH_HOST").ok().as_deref())
}

/// How long one `gh config get` may take (it reads gh's own config files and goes nowhere).
const GH_CONFIG_LIMIT: std::time::Duration = std::time::Duration::from_secs(5);

pub(crate) fn host_allowed_with(gh: &Path, host: &str, gh_host: Option<&str>) -> Result<(), String> {
    host_allowed_within(gh, host, gh_host, GH_CONFIG_LIMIT)
}

fn host_allowed_within(gh: &Path, host: &str, gh_host: Option<&str>, limit: std::time::Duration) -> Result<(), String> {
    host_allowed_reading(gh, host, gh_host, &|args| gh_config(gh, args, limit))
}

/// The gate with the `gh config get` reader handed in, so a test can make a read fail.
pub(crate) fn host_allowed_reading(gh: &Path, host: &str, gh_host: Option<&str>, read: &dyn Fn(&[&str]) -> ConfigRead) -> Result<(), String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    if !host_ok(host) {
        return Err("This repository's GitHub host cannot be read".into());
    }
    let h = host.to_ascii_lowercase();
    if h == "github.com" || gh_host.is_some_and(|g| g.trim().eq_ignore_ascii_case(&h)) {
        return Ok(());
    }
    // FIX-2 (council AFTER 4): a host found signed in stays allowed for a minute, so a gh auth
    // logout takes effect soon; a refusal is asked again next time, so signing in needs no restart.
    static SIGNED_IN: OnceLock<Mutex<HashMap<(std::path::PathBuf, String), Instant>>> = OnceLock::new();
    const KEEP: Duration = Duration::from_secs(60);
    let known = SIGNED_IN.get_or_init(Default::default);
    let key = (gh.to_path_buf(), h.clone());
    if known.lock().map(|k| k.get(&key).is_some_and(|t| t.elapsed() < KEEP)).unwrap_or(false) {
        return Ok(());
    }
    // FIX-2 (council FS 3): gh answers `config get -h <host> user` with the top-level user when
    // the host has none of its own, so an answer equal to plain `config get user` is no sign-in.
    // A host whose own user is the same login as the top-level one is refused too (safe side).
    // FIX-3 (reliability review FIX-SOON 6): a read that fails or times out is no answer, and no
    // answer refuses the host (it is never taken for "gh has no top-level user", which would sign
    // in a host that has none of its own). Only a refusal that gh really gave is the plain one.
    let cannot_check = || Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them (gh did not answer its config read; try again in a moment)."));
    match read(&["config", "get", "-h", &h, "user"]) {
        ConfigRead::Value(user) => match read(&["config", "get", "user"]) {
            ConfigRead::Value(top) if top == user => {
                // FIX-3 (review AFTER 2): name the real reason; gh gives every host the top-level user.
                return Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them: the user gh reports for it is gh's top-level `user` setting, which every host falls back to (gh auth login --hostname {h} signs in)."));
            }
            ConfigRead::Value(_) | ConfigRead::Unset => {}
            ConfigRead::Failed => return cannot_check(),
        },
        ConfigRead::Unset => {
            return Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them (gh auth login --hostname {h} signs in)."));
        }
        ConfigRead::Failed => return cannot_check(),
    }
    if let Ok(mut k) = known.lock() {
        k.insert(key, Instant::now());
    }
    Ok(())
}

/// What one `gh config get` came to.
pub(crate) enum ConfigRead {
    Value(String),
    Unset,
    Failed,
}

/// FIX-3 / FIX-4: one `gh config get` through the bounded runner in scm.rs, which ends the whole
/// process tree gh started at the limit (never only gh itself). A read that cannot run or does not
/// answer in time is `Failed`; so is a non-zero exit that is not gh's "could not find key" answer.
fn gh_config(gh: &Path, args: &[&str], limit: std::time::Duration) -> ConfigRead {
    match crate::scm::gh_config_within(gh, args, limit) {
        Ok(r) => config_read(r.ok, &r.out, &r.err),
        Err(_) => ConfigRead::Failed,
    }
}

/// FIX-4 (council FIX-SOON 1): what one finished read means. Exit 0 with a value is the value, exit
/// 0 with nothing is "not set" (an older gh prints nothing for a key that is not set). A non-zero
/// exit is "not set" only when gh's own error says it could not find the key (the text gh's config
/// library gives; an unexpected wording fails closed to `Failed`, which refuses the host). Any other
/// non-zero exit (a config file being rewritten, a lock, a shim error) is no answer, never "no
/// top-level user", which would sign in a host that has none of its own.
/// FIX-5 (council AFTER 1-2) and FIX-6: only gh's quoted `could not find key "` counts (a wider "key not found" also matches
/// a wrapper's own error), and a value of more than one line is no answer: a login is one line, and
/// two reads that differ only in an extra line must not compare unequal and let a host through.
fn config_read(ok: bool, out: &str, err: &str) -> ConfigRead {
    if ok {
        return if out.is_empty() {
            ConfigRead::Unset
        } else if out.contains('\n') || out.contains('\r') {
            ConfigRead::Failed
        } else {
            ConfigRead::Value(out.to_string())
        };
    }
    // FIX-6 (council FIX-SOON 2): the quoted form, in gh's own case; a bare prefix also matched
    // "could not find keyring entry" from a wrapper or credential helper.
    if err.contains("could not find key \"") { ConfigRead::Unset } else { ConfigRead::Failed }
}

pub(crate) fn s(v: &serde_json::Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn a_fork_names_its_parent_and_a_plain_repository_has_none() {
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": "up/stream"}})), Some("up/stream".into()));
        assert_eq!(parent_of(&json!({"fork": false, "parent": {"full_name": "up/stream"}})), None);
        assert_eq!(parent_of(&json!({"fork": true})), None, "a fork whose parent is gone has no parent");
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": ""}})), None);
    }

    #[test]
    fn a_parent_name_outside_the_owner_name_rule_is_dropped() {
        for bad in ["up", "up/stream/x", "up/stream x", "up/stream\"", "../stream", "up/..", "up/stream repo:evil/x", "/stream", "up/"] {
            assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": bad}})), None, "{bad}");
        }
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": "Up-1/stream.rs_2"}})), Some("Up-1/stream.rs_2".into()));
    }

    #[test]
    fn odd_hosts_and_repository_names_never_reach_gh() {
        assert_eq!(repo_path("github.com", "o/r").unwrap(), "repos/o/r");
        for (h, r) in [("github.com", "o"), ("github.com", "../r"), ("github.com", "o/r/x"), ("github.com", "o/.."), ("git hub", "o/r"), ("", "o/r"), ("github.com", "o/r?x=1")] {
            assert!(repo_path(h, r).is_err(), "{h} {r}");
        }
    }

    #[test]
    fn the_parent_read_asks_gh_for_the_right_address() {
        let dir = crate::test_dir::temp("github-reads");
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(
                &f,
                "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho %2| findstr assignees >nul && goto people\r\necho {\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}\r\nexit /b 0\r\n:people\r\necho [{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]\r\nexit /b 0\r\n",
            )
            .unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncase \"$2\" in *assignees*) echo '[{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]';; *) echo '{\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}';; esac\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        assert_eq!(repo_parent(&gh, "github.com", "me/fork").unwrap(), Some("up/stream".into()));
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("api repos/me/fork --hostname github.com"), "{calls}");
        assert!(repo_parent(&gh, "github.com", "bad").is_err());
    }

    /// FIX-1 (council FB 1): a stand-in gh that is signed in to ghe.corp only (gh config get -h
    /// <host> user answers a login there and fails everywhere else) and keeps every call. FIX-2
    /// (council FS 3): like real gh, a top-level user (top.txt, what `gh config set user` writes)
    /// is the answer for every host that has none of its own, with or without -h.
    fn gate_stand_in(name: &str) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" goto config\r\necho {\"fork\":false,\"data\":{}}\r\nexit /b 0\r\n:config\r\nif /i \"%3\"==\"-h\" if /i \"%4\"==\"ghe.corp\" (echo ana& exit /b 0)\r\nif exist \"%~dp0top.txt\" (type \"%~dp0top.txt\"& exit /b 0)\r\nif exist \"%~dp0locked.txt\" (echo gh: the config file is busy 1>&2& exit /b 1)\r\necho could not find key \"user\" 1>&2\r\nexit /b 1\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$1\" = config ]; then if [ \"$3\" = -h ] && [ \"$4\" = ghe.corp ]; then echo ana; exit 0; fi; [ -f \"$(dirname \"$0\")/top.txt\" ] && cat \"$(dirname \"$0\")/top.txt\" && exit 0; if [ -f \"$(dirname \"$0\")/locked.txt\" ]; then echo 'gh: the config file is busy' >&2; exit 1; fi; echo 'could not find key \"user\"' >&2; exit 1; fi\necho '{\"fork\":false,\"data\":{}}'\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        (gh, dir)
    }

    #[test]
    fn a_host_gh_is_not_signed_in_to_never_gets_a_request() {
        let (gh, dir) = gate_stand_in("github-host-gate");
        let api_calls = || fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().filter(|l| l.starts_with("api")).map(String::from).collect::<Vec<_>>();
        // A host taken from a repository's remote: the fork parent read is refused before gh runs.
        assert!(repo_parent(&gh, "evil.example", "acme/app").unwrap_err().contains("signed in to"));
        assert!(repo_parent(&gh, "-x.corp", "acme/app").is_err(), "a host that starts with a dash is not a host");
        assert_eq!(api_calls(), Vec::<String>::new(), "nothing reached gh api for a host it is not signed in to");
        let before = fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().count();
        assert!(host_allowed_with(&gh, "env.corp", Some("ENV.corp")).is_ok() && host_allowed_with(&gh, "GitHub.com", None).is_ok(), "GH_HOST and github.com need no check");
        assert!(host_allowed_with(&gh, "env.corp", Some("other.corp")).is_err());
        assert_eq!(fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().count(), before + 1, "only the refused env.corp asked gh config");
        // A host gh is signed in to goes through.
        assert_eq!(repo_parent(&gh, "ghe.corp", "acme/app").unwrap(), None);
        let got = api_calls();
        assert!(got.iter().any(|c| c.starts_with("api repos/acme/app --hostname ghe.corp")), "{got:?}");
    }

    #[test]
    fn a_top_level_gh_user_does_not_sign_in_every_host() {
        let (gh, dir) = gate_stand_in("github-host-gate-top");
        fs::write(dir.join("top.txt"), "zed
").unwrap();
        let api_calls = || fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().filter(|l| l.starts_with("api")).count();
        // gh config get -h evil.example user falls back to the top-level user, the same answer as
        // gh config get user: that is no sign-in, so nothing goes to evil.example.
        let why = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(why.contains("signed in to") && why.contains("top-level `user` setting"), "the refusal names the top-level setting: {why}");
        assert!(repo_parent(&gh, "evil.example", "acme/app").is_err());
        assert_eq!(api_calls(), 0, "nothing reached gh api for a host known only through the top-level user");
        // A host with its own user in gh's hosts still passes.
        assert!(host_allowed_with(&gh, "ghe.corp", None).is_ok());
        assert_eq!(repo_parent(&gh, "ghe.corp", "acme/app").unwrap(), None);
        assert_eq!(api_calls(), 1);
    }

    /// FIX-4 (council FIX-SOON 1): gh failing a config read for a reason other than "key not set"
    /// (a config file being rewritten, a lock, a shim error) is no answer, so it refuses the host;
    /// only gh's own "could not find key" answer counts as the key being unset.
    #[test]
    fn a_config_read_that_fails_for_another_reason_is_no_answer_and_refuses_the_host() {
        let (gh, dir) = gate_stand_in("github-host-gate-locked");
        let busy = || dir.join("locked.txt");
        // ghe.corp has its own user; the top-level read exits 1 with an error that is not "key not found".
        fs::write(busy(), "x").unwrap();
        let why = host_allowed_with(&gh, "ghe.corp", None).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
        // The host's own read failing the same way is no answer either, not the plain refusal.
        let why = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
        // gh saying the key is not set is an answer: ghe.corp's own user stands, evil.example is plainly refused.
        fs::remove_file(busy()).unwrap();
        assert!(host_allowed_with(&gh, "ghe.corp", None).is_ok());
        let plain = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(plain.contains("is not one of them") && !plain.contains("did not answer"), "{plain}");
    }

    #[test]
    fn only_gh_s_key_not_found_answer_reads_as_unset() {
        let read = |ok: bool, out: &str, err: &str| match config_read(ok, out, err) {
            ConfigRead::Value(v) => format!("value:{v}"),
            ConfigRead::Unset => "unset".into(),
            ConfigRead::Failed => "failed".into(),
        };
        assert_eq!(read(true, "ana", ""), "value:ana");
        assert_eq!(read(true, "", ""), "unset", "an older gh prints nothing for a key that is not set");
        assert_eq!(read(false, "", "could not find key \"user\""), "unset");
        assert_eq!(read(false, "", "Could not find key \"user\""), "failed", "FIX-6: gh's own case only");
        assert_eq!(read(false, "", "gh: could not find key: user"), "failed", "FIX-6: only the quoted-key form is gh's");
        assert_eq!(read(false, "", ""), "failed", "a bare non-zero exit says nothing about the key");
        assert_eq!(read(false, "", "gh: the config file is busy"), "failed");
        assert_eq!(read(false, "ana", "permission denied"), "failed", "output on a failed read is not an answer");
    }

    /// FIX-5 (council AFTER 1): "key not found" alone is wider than gh's wording; a wrapper or shim
    /// saying "secret key not found" must not read as "no such key", because an unset top-level
    /// key lets a host through.
    #[test]
    fn a_shim_s_key_not_found_is_no_answer_only_gh_s_could_not_find_key_is() {
        let read = |err: &str| matches!(config_read(false, "", err), ConfigRead::Unset);
        assert!(!read("secret key not found"));
        assert!(!read("key not found"));
        assert!(!read("gh: signing key not found in the keychain"));
        assert!(read("could not find key \"user\""));
        assert!(read("gh: could not find key \"user\" in the config"));
    }

    /// FIX-6 (council FIX-SOON 2): the bare prefix "could not find key" also matches a wrapper or
    /// credential helper saying "could not find keyring entry", and an unset top-level key lets
    /// a host through. Only the quoted form (`could not find key "`), in gh's own case, is "unset".
    #[test]
    fn a_wrapper_s_could_not_find_keyring_is_no_answer() {
        let read = |err: &str| matches!(config_read(false, "", err), ConfigRead::Unset);
        assert!(!read("could not find keyring entry"));
        assert!(!read("gh: could not find keyring"));
        assert!(!read("Could not find keychain item"));
        assert!(!read("gh: Could Not Find Key: user"), "unquoted wording is no answer");
        assert!(!read("Could not find key \"user\""), "case-sensitive");
        assert!(!read("could not find key: user"));
        assert!(read("could not find key \"user\""));
    }

    /// FIX-5 (council AFTER 2): a config answer of more than one line is no answer. A value that
    /// carries an extra line would compare unequal to the other read and let the host through.
    #[test]
    fn a_config_answer_of_more_than_one_line_is_no_answer_and_refuses_the_host() {
        for out in ["ana\nbob", "ana\r\nbob", "ana\n\nbob"] {
            assert!(matches!(config_read(true, out, ""), ConfigRead::Failed), "{out:?}");
        }
        assert!(matches!(config_read(true, "ana", ""), ConfigRead::Value(ref v) if v == "ana"));
        let gh = Path::new("fix5-multiline-gh");
        let host = |args: &[&str]| args.contains(&"-h");
        // Both reads print the same first line plus a different extra line: with the whole text
        // compared they differ and the host would be let through; it is refused instead.
        let why = host_allowed_reading(gh, "ghe.corp", None, &|a| config_read(true, if host(a) { "ana\nx" } else { "ana\ny" }, "")).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
    }

    /// FIX-3 (reliability review FIX-SOON 6): a gh_config read that fails or times out is no answer,
    /// and no answer refuses the host; it never reads as "no top-level user" (which would sign in
    /// a host that has none of its own).
    #[test]
    fn a_failed_gh_config_read_refuses_the_host_instead_of_allowing_it() {
        use std::cell::RefCell;
        let gh = Path::new("fix3-failed-read-gh");
        let host = |args: &[&str]| args.contains(&"-h");
        // The host's own user reads fine; the top-level read fails: refused, with its own wording.
        let err = host_allowed_reading(gh, "ghe.corp", None, &|a| if host(a) { ConfigRead::Value("ana".into()) } else { ConfigRead::Failed }).unwrap_err();
        assert!(err.contains("did not answer its config read"), "{err}");
        // The host's own read fails: refused too.
        assert!(host_allowed_reading(gh, "ghe.corp", None, &|_| ConfigRead::Failed).unwrap_err().contains("did not answer its config read"));
        // A host gh answers "no user" for is the plain not-signed-in refusal.
        let plain = host_allowed_reading(gh, "ghe.corp", None, &|_| ConfigRead::Unset).unwrap_err();
        assert!(plain.contains("signed in to") && !plain.contains("did not answer"), "{plain}");
        // gh saying it has no top-level user is an answer: the host's own user stands.
        let seen = RefCell::new(0);
        let ok = host_allowed_reading(gh, "ghe.corp", None, &|a| {
            *seen.borrow_mut() += 1;
            if host(a) { ConfigRead::Value("ana".into()) } else { ConfigRead::Unset }
        });
        assert!(ok.is_ok() && *seen.borrow() == 2, "{ok:?}");
    }

    /// The gh_config read that hangs: the gate answers inside its limit, refuses, and the whole
    /// tree gh started ends with it (a program gh left running would leave a mark seconds later).
    #[cfg(windows)]
    #[test]
    fn a_gh_config_read_that_times_out_refuses_the_host_and_ends_the_whole_tree() {
        let dir = crate::test_dir::temp("github-config-timeout");
        fs::write(dir.join("late.cmd"), "@echo off\r\nping -n 4 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
        let gh = dir.join("gh.cmd");
        fs::write(&gh, "@echo off\r\nif /i \"%3\"==\"-h\" (echo ana& exit /b 0)\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\nping -n 30 127.0.0.1 >nul\r\n").unwrap();
        timed_out_read_refuses_and_leaves_no_mark(&gh, &dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_gh_config_read_that_times_out_refuses_the_host_and_ends_the_whole_tree() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::test_dir::temp("github-config-timeout");
        let gh = dir.join("gh");
        fs::write(&gh, "#!/bin/sh\nd=\"$(dirname \"$0\")\"\nif [ \"$3\" = -h ]; then echo ana; exit 0; fi\n( sleep 3; echo late > \"$d/late.txt\" ) &\nsleep 30\n").unwrap();
        fs::set_permissions(&gh, fs::Permissions::from_mode(0o755)).unwrap();
        timed_out_read_refuses_and_leaves_no_mark(&gh, &dir);
    }

    fn timed_out_read_refuses_and_leaves_no_mark(gh: &Path, dir: &Path) {
        let limit = std::time::Duration::from_secs(1);
        let started = std::time::Instant::now();
        let err = host_allowed_within(gh, "ghe.corp", None, limit).unwrap_err();
        assert!(err.contains("did not answer its config read"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(4), "took {:?}", started.elapsed());
        std::thread::sleep(std::time::Duration::from_millis(4500));
        assert!(!dir.join("late.txt").exists(), "a program gh started outlived the timed-out read");
    }
}
