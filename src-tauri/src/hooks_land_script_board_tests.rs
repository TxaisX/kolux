//! LAND-02 board tests (locked): the `kolux-land.cmd` script an agent runs to land its work, and
//! its fenced writer. Wired from hooks.rs with
//! `#[cfg(test)] #[path = "hooks_land_script_board_tests.rs"] mod land_script_board_tests;`
use super::*;

/// A fresh folder of this test's own under the system temp folder (never the real home).
fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-land02-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn expected(home: &Path) -> PathBuf {
    home.join(".kolux").join("bin").join("kolux-land.cmd")
}

#[test]
fn the_land_script_lives_in_the_kolux_bin_folder_not_agent_hooks() {
    let home = Path::new("C:/somebody");
    let p = land_script_in(home);
    assert!(p.starts_with(home) && p.ends_with(Path::new(".kolux").join("bin").join("kolux-land.cmd")), "{}", p.display());
    assert_eq!(LAND_SCRIPT, "kolux-land.cmd");
    if let Some(real) = land_script() {
        assert!(real.ends_with(Path::new(".kolux").join("bin").join("kolux-land.cmd")), "{}", real.display());
        assert!(!real.to_string_lossy().contains("agent-hooks"), "the shim folder is never the land script's home");
    }
}

#[test]
fn the_land_script_text_has_its_marks_curl_flags_and_endpoint_line() {
    let text = land_script_text();
    assert!(text.starts_with("@echo off\r\n"), "{text}");
    assert!(!text.replace("\r\n", "").contains('\n'), "every line ends with CRLF");
    assert!(text.contains("Written by Kolux"), "the fence mark");
    let lines: Vec<&str> = text.split("\r\n").collect();
    let chcp = lines.iter().position(|l| l.trim_start().to_ascii_lowercase().starts_with("chcp 65001")).expect("a chcp 65001 line");
    assert!(lines[chcp].to_ascii_uppercase().contains(">NUL"), "chcp prints nothing: {}", lines[chcp]);
    let curl = lines.iter().position(|l| l.contains("curl.exe")).expect("a curl line");
    assert!(chcp < curl, "the code page is set before anything runs");
    let post = lines[curl];
    for want in ["%SystemRoot%\\System32\\curl.exe", "--fail-with-body", "-m 150", "--noproxy \"*\"", "--data-binary", "/land", "X-Kolux-Token:", "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%", "http://127.0.0.1:"] {
        assert!(post.contains(want), "curl line lacks {want:?}: {post}");
    }
    // The endpoint file is read exactly the way the hook scripts read it (a pane outlives a restart).
    let hook = claude_script();
    let endpoint = hook.split("\r\n").find(|l| l.contains("for /f \"usebackq tokens=1,2\"")).expect("the hook script's endpoint line");
    assert!(lines.contains(&endpoint), "the land script reads the endpoint file like script(): {endpoint}");
    assert!(!text.contains("agent-hooks"), "nothing from the shim folder");
}

#[test]
fn writing_the_land_script_creates_it_and_leaves_an_unchanged_one_alone() {
    let home = temp("write");
    let path = write_land_script(&home).expect("written");
    assert_eq!(path.components().collect::<Vec<_>>(), expected(&home).components().collect::<Vec<_>>());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), land_script_text());
    let names: Vec<String> = std::fs::read_dir(home.join(".kolux").join("bin")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(names, vec!["kolux-land.cmd".to_string()], "the bin folder holds only the land script");
    assert!(!home.join(".kolux").join("agent-hooks").exists(), "the shim folder is not touched");
    // Unchanged: no write at all, so even a read-only file is fine.
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms.clone()).unwrap();
    let again = write_land_script(&home);
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&path, perms).unwrap();
    assert!(again.is_ok(), "an unchanged script is left as it is: {again:?}");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn a_foreign_file_under_the_land_script_name_is_never_overwritten() {
    let home = temp("foreign");
    let file = expected(&home);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "@echo off\r\necho my own land\r\n").unwrap();
    let out = write_land_script(&home);
    assert!(out.is_err(), "a file Kolux did not write is refused: {out:?}");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "@echo off\r\necho my own land\r\n");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn a_stale_kolux_land_script_is_rewritten() {
    let home = temp("stale");
    let file = expected(&home);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "@echo off\r\nrem An older Kolux land script. Written by Kolux; edits are overwritten.\r\nexit /b 1\r\n").unwrap();
    write_land_script(&home).expect("Kolux's own older script is replaced");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), land_script_text());
    let _ = std::fs::remove_dir_all(&home);
}

/// The body of `fn <name>(` in hooks.rs, comments removed, up to the closing brace at column 0.
fn body_of(name: &str) -> String {
    let src = include_str!("hooks.rs");
    let at = src.find(&format!("\nfn {name}(")).or_else(|| src.find(&format!("\npub fn {name}("))).unwrap_or_else(|| panic!("fn {name} exists in hooks.rs"));
    let rest = &src[at + 1..];
    let end = rest.find("\n}\n").or_else(|| rest.find("\n}\r\n")).expect("function ends");
    rest[..end].lines().map(|l| l.split("// ").next().unwrap_or("")).collect::<Vec<_>>().join("\n")
}

#[test]
fn serve_writes_the_land_script_at_start() {
    let serve = body_of("serve");
    assert!(serve.contains("write_land_script("), "serve writes the land script");
}

// ------------------------------------------------------------------ the script, run for real

#[cfg(windows)]
struct Heard {
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

/// A one-request listener answering `code` and `text`; the request it heard comes back on the channel.
#[cfg(windows)]
fn fake_kolux(code: u16, text: &'static str) -> (TcpListener, u16, std::sync::mpsc::Receiver<Heard>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = std::sync::mpsc::channel();
    let mine = listener.try_clone().unwrap();
    std::thread::spawn(move || {
        if let Ok((stream, _)) = mine.accept() {
            stream.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
            let mut reader = BufReader::new(&stream);
            if let Some(req) = parse_request(&mut reader) {
                let _ = tx.send(Heard { path: req.path, headers: req.headers, body: String::from_utf8_lossy(&req.body).into_owned() });
            }
            let mut s = &stream;
            let _ = write!(s, "HTTP/1.1 {code} OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
            let _ = s.flush();
        }
    });
    (listener, port, rx)
}

/// Runs the written script with cmd in `work`, with every inherited KOLUX_ variable removed and the
/// given ones set, TEMP and TMP pointed at `tmp`. Returns (exit code, stdout).
#[cfg(windows)]
fn run_script(script: &Path, work: &Path, tmp: &Path, env: &[(&str, String)]) -> (i32, String) {
    let mut cmd = std::process::Command::new(std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into()));
    cmd.arg("/d").arg("/c").arg(script).current_dir(work).stdin(std::process::Stdio::null());
    for (k, _) in std::env::vars() {
        if k.to_ascii_uppercase().starts_with("KOLUX_") {
            cmd.env_remove(k);
        }
    }
    cmd.env("TEMP", tmp).env("TMP", tmp);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().expect("cmd runs");
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn pane_vars(endpoint: &Path) -> Vec<(&'static str, String)> {
    vec![
        ("KOLUX_PANE_KEY", "58601".to_string()),
        ("KOLUX_HOOK_IDENTITY", "eyJwYW5lS2V5Ijo1ODYwMX0=".to_string()),
        ("KOLUX_HOOK_ENDPOINT", endpoint.to_string_lossy().into_owned()),
        // Stale values: the endpoint file wins over them, as in the hook scripts.
        ("KOLUX_AGENT_HOOK_PORT", "1".to_string()),
        ("KOLUX_AGENT_HOOK_TOKEN", "env-token".to_string()),
    ]
}

/// home (script), tmp (TEMP), work (a folder name full of cmd's special characters), endpoint file.
#[cfg(windows)]
fn setup(name: &str, port: u16) -> (PathBuf, PathBuf, PathBuf, PathBuf, PathBuf) {
    let base = temp(name);
    let (home, tmp, work) = (base.join("home"), base.join("tmp"), base.join("ws & (1)! x"));
    for d in [&home, &tmp, &work] {
        std::fs::create_dir_all(d).unwrap();
    }
    let endpoint = base.join("agent-hooks-endpoint-3.txt");
    std::fs::write(&endpoint, format!("{port} file-token\n")).unwrap();
    let script = write_land_script(&home).expect("written");
    (base, script, tmp, work, endpoint)
}

#[cfg(windows)]
fn norm(p: &str) -> String {
    p.trim().trim_end_matches('\\').replace('/', "\\").to_lowercase()
}

#[cfg(windows)]
#[test]
fn the_land_script_posts_the_current_folder_to_land_and_prints_the_answer() {
    let (_keep, port, heard) = fake_kolux(200, "Sent to main. Every other workspace took it in.");
    let (base, script, tmp, work, endpoint) = setup("post", port);
    let (code, out) = run_script(&script, &work, &tmp, &pane_vars(&endpoint));
    let req = heard.recv_timeout(Duration::from_secs(20)).expect("the script posted to the port in the endpoint file");
    assert_eq!(req.path, "/land");
    assert_eq!(req.headers.get(TOKEN_HEADER).map(String::as_str), Some("file-token"), "the token from the endpoint file");
    assert_eq!(req.headers.get(IDENTITY_HEADER).map(String::as_str), Some("eyJwYW5lS2V5Ijo1ODYwMX0="));
    assert_eq!(norm(&req.body), norm(&work.to_string_lossy()), "the body is the current folder, special characters and all");
    assert_eq!(code, 0, "landed: exit 0. stdout: {out}");
    assert!(out.contains("Sent to main. Every other workspace took it in."), "the answer is printed: {out:?}");
    assert!(!out.contains("Active code page"), "chcp says nothing: {out:?}");
    assert!(std::fs::read_dir(&tmp).unwrap().next().is_none(), "the body file is removed");
    assert!(std::fs::read_dir(&work).unwrap().next().is_none(), "nothing is left in the workspace");
    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(windows)]
#[test]
fn the_land_script_exits_1_when_kolux_refuses() {
    let (_keep, port, heard) = fake_kolux(409, "Not sent to main: it has uncommitted changes in a.txt.");
    let (base, script, tmp, work, endpoint) = setup("refused", port);
    let (code, out) = run_script(&script, &work, &tmp, &pane_vars(&endpoint));
    assert!(heard.recv_timeout(Duration::from_secs(20)).is_ok(), "the script posted");
    assert_eq!(code, 1, "refused: exit 1. stdout: {out}");
    assert!(out.contains("Not sent to main: it has uncommitted changes in a.txt."), "the reason is printed: {out:?}");
    assert!(std::fs::read_dir(&tmp).unwrap().next().is_none(), "the body file is removed on failure too");
    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(windows)]
#[test]
fn the_land_script_outside_a_kolux_pane_exits_1_without_posting() {
    let (_keep, port, heard) = fake_kolux(200, "Sent to main.");
    let (base, script, tmp, work, endpoint) = setup("guard", port);
    for missing in ["KOLUX_PANE_KEY", "KOLUX_HOOK_IDENTITY"] {
        let vars: Vec<(&str, String)> = pane_vars(&endpoint).into_iter().filter(|(k, _)| *k != missing).collect();
        let (code, out) = run_script(&script, &work, &tmp, &vars);
        assert_eq!(code, 1, "without {missing}: exit 1. stdout: {out}");
        assert!(!out.trim().is_empty(), "without {missing}: a plain reason is printed");
    }
    // A posted request would have reached the fake, which reports it on its channel.
    assert!(heard.recv_timeout(Duration::from_millis(150)).is_err(), "nothing was posted");
    let _ = std::fs::remove_dir_all(&base);
}
