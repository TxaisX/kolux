//! APP-020 on macOS and Linux: the login shell's environment (its search path above all), read once
//! at startup in the background so the window never waits for it. A terminal opened before it
//! arrives gets the app's own environment.

use std::time::Duration;

static LOGIN_ENV: std::sync::OnceLock<Vec<(String, String)>> = std::sync::OnceLock::new();
/// What the shell prints before its environment, so whatever a profile script prints is skipped.
const ENV_MARK: &str = "__KOLUX_LOGIN_ENV__";
/// Variables that describe the reading shell itself, not the user's setup.
const SHELL_OWN: [&str; 4] = ["PWD", "OLDPWD", "SHLVL", "_"];

/// Starts reading the login shell's environment (macOS and Linux only).
pub fn start() {
    if cfg!(unix) {
        std::thread::spawn(|| {
            let shell = std::env::var("SHELL").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "/bin/sh".into());
            if let Some(env) = read(std::path::Path::new(&shell), Duration::from_secs(10)) {
                let _ = LOGIN_ENV.set(env);
            }
        });
    }
}

/// What the login shell set, once it has answered; empty before that and on Windows.
pub fn get() -> &'static [(String, String)] {
    LOGIN_ENV.get().map_or(&[], Vec::as_slice)
}

/// Runs `shell` as a login shell that prints its environment, giving up after `limit` (a profile
/// script that hangs never holds anything up).
pub fn read(shell: &std::path::Path, limit: Duration) -> Option<Vec<(String, String)>> {
    use std::io::Read as _;
    let mut child = crate::winproc::command(shell)
        .args(["-l", "-c", &format!("printf '%s\n' {ENV_MARK}; env")])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(limit).ok();
    let _ = child.kill();
    let _ = child.wait();
    let env = parse_env(&out?);
    (!env.is_empty()).then_some(env)
}

/// The variables `env` printed after the mark. A line that does not start a new NAME=value goes
/// with the value before it (a value with line breaks in it).
pub fn parse_env(out: &str) -> Vec<(String, String)> {
    let Some(start) = out.find(&format!("{ENV_MARK}\n")) else { return vec![] };
    let mut env: Vec<(String, String)> = Vec::new();
    for line in out[start + ENV_MARK.len() + 1..].lines() {
        let named = line.split_once('=').filter(|(k, _)| !k.is_empty() && !k.starts_with(|c: char| c.is_ascii_digit()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
        match (named, env.last_mut()) {
            (Some((k, v)), _) => env.push((k.to_string(), v.to_string())),
            (None, Some((_, v))) => {
                v.push('\n');
                v.push_str(line);
            }
            (None, None) => {}
        }
    }
    env.retain(|(k, _)| !SHELL_OWN.contains(&k.as_str()));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    /// APP-020 on macOS and Linux: what the login shell printed before the mark (a profile banner)
    /// is skipped, a value with a line break stays one value, and the reading shell's own variables
    /// are dropped.
    #[test]
    fn app020_the_login_shells_environment_is_read_after_the_mark_with_multi_line_values() {
        let out = "Welcome to the box!\nA=1\n__KOLUX_LOGIN_ENV__\nPATH=/opt/homebrew/bin:/usr/bin\nPWD=/home/me\nFUNC=() {  echo hi\n}\nSHLVL=2\n_=/usr/bin/env\nHOME=/home/me\n";
        let env = parse_env(out);
        let want: Vec<(String, String)> = [("PATH", "/opt/homebrew/bin:/usr/bin"), ("FUNC", "() {  echo hi\n}"), ("HOME", "/home/me")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(env, want);
        // no mark (the shell failed before printing it): nothing is taken from the output
        assert!(parse_env("PATH=/bin\n").is_empty());
    }

    /// The reader runs a real login shell and never waits past its limit.
    #[cfg(unix)]
    #[test]
    fn app020_the_login_shell_is_read_within_its_limit() {
        let env = read(std::path::Path::new("/bin/sh"), Duration::from_secs(10)).expect("sh prints its environment");
        assert!(env.iter().any(|(k, _)| k == "PATH"));
    }

    /// Nothing has been read on a host that never started the reader, and a missing shell gives nothing.
    #[test]
    fn app020_an_unreadable_shell_gives_no_environment() {
        assert!(read(std::path::Path::new("/definitely/not/a/shell"), Duration::from_secs(1)).is_none());
    }
}
