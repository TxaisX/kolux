//! spec/03 terminals: TERM-040 start folders and TERM-041 one new-tab command per agent.
//! Needs `pty` and `agents` public in lib.rs. The shell is a real one; it runs with the scratch
//! home the lane's environment gives the test process.

use kolux_lib::agents::CATALOGUE;
use kolux_lib::pty::{shell_commands, start_dir, PtySession};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Starts the default shell in `dir`, waits until its output holds `leaf` (the prompt names the folder), and kills it.
fn shell_prompt_names(dir: &str, leaf: &str) -> Result<String, String> {
    let out = Arc::new(Mutex::new(Vec::<u8>::new()));
    let sink = out.clone();
    let mut session = PtySession::spawn_first(shell_commands(Some(dir), None), 120, 30, move |c| sink.lock().unwrap().extend_from_slice(c), |_| {})?;
    let end = Instant::now() + Duration::from_secs(40);
    let mut seen = String::new();
    let mut answered = 0;
    while Instant::now() < end {
        std::thread::sleep(Duration::from_millis(200));
        seen = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
        // the console host asks where the cursor is and waits for the answer, as the window's terminal gives it
        let asked = seen.matches("\x1b[6n").count();
        while answered < asked {
            session.write(b"\x1b[1;1R").unwrap();
            answered += 1;
        }
        if seen.contains(leaf) {
            break;
        }
    }
    session.kill();
    if seen.contains(leaf) { Ok(seen) } else { Err(format!("no prompt naming {leaf}: {seen:?}")) }
}

fn workspace(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-cards03-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// TERM-040 box 2: a requested start folder that does not exist opens the terminal in the workspace folder.
#[test]
fn term040_box2_a_missing_start_folder_opens_the_shell_in_the_workspace_folder() {
    let ws = workspace("term040-ws");
    let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
    let ws_s = ws.to_string_lossy().into_owned();
    // the decision
    assert_eq!(start_dir(&ws_s, Some("no-such-folder-cards03")), ws_s);
    assert_eq!(start_dir(&ws_s, Some("  ")), ws_s);
    assert_eq!(start_dir(&ws_s, None), ws_s);
    // an existing relative folder is kept, so the fallback is not just "always the workspace"
    let sub = ws.join("sub-cards03");
    std::fs::create_dir_all(&sub).unwrap();
    assert_eq!(start_dir(&ws_s, Some("sub-cards03")), sub.to_string_lossy());
    // the effect: the shell started where start_dir says shows the workspace folder as its working folder
    let start = start_dir(&ws_s, Some("no-such-folder-cards03"));
    shell_prompt_names(&start, &leaf).expect("the shell opened in the workspace folder");
    // and the control: a shell started in the existing sub folder shows that folder, not the workspace leaf alone
    let inner = start_dir(&ws_s, Some("sub-cards03"));
    shell_prompt_names(&inner, "sub-cards03").expect("an existing start folder is kept");
    let _ = std::fs::remove_dir_all(&ws);
}

/// TERM-040: a folder outside the workspace (absolute) is kept when it exists.
#[test]
fn term040_an_existing_absolute_folder_outside_the_workspace_is_kept() {
    let ws = workspace("term040-in");
    let other = workspace("term040-out");
    let other_s = other.to_string_lossy().into_owned();
    assert_eq!(start_dir(&ws.to_string_lossy(), Some(&other_s)), other_s);
    let _ = std::fs::remove_dir_all(&ws);
    let _ = std::fs::remove_dir_all(&other);
}

/// TERM-041 box 2: every agent the app can list has its own `tab.newAgent.<id>` command, and none has a key.
#[test]
fn term041_box2_every_catalogue_agent_has_an_unbound_new_tab_command() {
    let actions = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/keys/actions.ts")).unwrap();
    let line = actions.lines().find(|l| l.contains("tab.newAgent.${id}")).expect("the per-agent command line");
    assert!(line.contains(r#""tabs", [])"#), "the per-agent command takes no key: {line}");
    for (id, _, _, _) in CATALOGUE.iter() {
        assert!(actions.contains(&format!("[\"{id}\", \"")), "no new-tab command for agent {id}");
    }
}

/// A real shell on a pty, with the console host's cursor query answered; `settle` waits until its output stops growing.
struct Shell {
    out: Arc<Mutex<Vec<u8>>>,
    session: PtySession,
    answered: usize,
}

impl Shell {
    fn start(dir: &str) -> Shell {
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = out.clone();
        let mut cmds = shell_commands(Some(dir), None);
        // A profile is the user's, not the test's: a runner profile that starts a child makes the
        // idle shell look busy and lets the two-shell test see its neighbour's history.
        if let Some(first) = cmds.first_mut() {
            let name = first.get_argv().first().map(|a| a.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if name.ends_with("pwsh.exe") || name.ends_with("powershell.exe") {
                first.arg("-NoProfile");
            }
        }
        let session = PtySession::spawn_first(cmds, 120, 30, move |c| sink.lock().unwrap().extend_from_slice(c), |_| {}).expect("a shell starts");
        Shell { out, session, answered: 0 }
    }

    fn answer_cursor_queries(&mut self) {
        let seen = String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned();
        let asked = seen.matches("\x1b[6n").count();
        while self.answered < asked {
            self.session.write(b"\x1b[1;1R").unwrap();
            self.answered += 1;
        }
    }

    /// Polls `check` (answering cursor queries) until it holds or `secs` pass; returns the last value seen.
    fn until(&mut self, secs: u64, mut check: impl FnMut(&Shell) -> bool) -> bool {
        let end = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < end {
            std::thread::sleep(Duration::from_millis(200));
            self.answer_cursor_queries();
            if check(self) {
                return true;
            }
        }
        false
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned()
    }
}

/// TERM-045 box 1: closing a pane whose shell runs a long program (a dev-server stand-in) would stop it, an idle shell would not.
/// `Terminals::busy` reads exactly `procs::has_children(pty pid)` for a plain shell (terminal.rs `busy`), which is what is asked here.
#[test]
fn term045_box1_a_shell_running_a_program_is_busy_and_an_idle_shell_is_not() {
    let ws = workspace("term045");
    let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
    let mut sh = Shell::start(&ws.to_string_lossy());
    assert!(sh.until(40, |s| s.text().contains(&leaf)), "the prompt names the folder: {:?}", sh.text());
    let pid = sh.session.pid().expect("the shell has a process id");
    // idle: the prompt is up and nothing runs under it (given a moment for start-up work to settle)
    let idle = sh.until(15, |_| kolux_lib::procs::has_children(pid) == Some(false));
    assert!(idle, "an idle shell has no program of its own: {:?}", kolux_lib::procs::has_children(pid));
    // busy: a long-running program (stands in for a dev server) is started in the shell
    let cmd: &[u8] = if cfg!(windows) { b"ping -n 60 127.0.0.1\r" } else { b"sleep 60\n" };
    sh.session.write(cmd).unwrap();
    let busy = sh.until(30, |_| kolux_lib::procs::has_children(pid) == Some(true));
    assert!(busy, "a shell running a program is busy: {:?}", kolux_lib::procs::has_children(pid));
    kolux_lib::procs::kill_tree(pid);
    sh.session.kill();
    let _ = std::fs::remove_dir_all(&ws);
}

/// Runs git with identity and a quiet config so a scratch repo can commit.
fn git(dir: &std::path::Path, args: &[&str]) {
    let st = std::process::Command::new("git").current_dir(dir).args(["-c", "user.name=cards", "-c", "user.email=cards@example.invalid", "-c", "commit.gpgsign=false"]).args(args).output().expect("git runs");
    assert!(st.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&st.stderr));
}

/// TERM-022 boxes 1-2: what the pane header's chip reads, in the shape the window receives.
#[test]
fn term022_the_head_the_chip_reads_is_the_branch_a_detached_commit_or_nothing() {
    use kolux_lib::scm::head_of;
    let repo = workspace("term022-repo");
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["commit", "-q", "--allow-empty", "-m", "first"]);
    git(&repo, &["switch", "-q", "-c", "feature/x"]);
    let on_branch = head_of(&repo).expect("a repository has a head");
    assert_eq!(on_branch.branch.as_deref(), Some("feature/x"));
    let sha = on_branch.head.clone().expect("a commit");
    assert_eq!(sha.len(), 40);
    let json = serde_json::to_value(&on_branch).unwrap();
    assert_eq!(json, serde_json::json!({ "branch": "feature/x", "head": sha }));
    // detached: no branch, the commit it sits on
    git(&repo, &["switch", "-q", "--detach"]);
    let detached = head_of(&repo).unwrap();
    assert_eq!(detached.branch, None);
    assert_eq!(detached.head.as_deref(), Some(sha.as_str()));
    assert_eq!(serde_json::to_value(&detached).unwrap(), serde_json::json!({ "branch": null, "head": sha }));
    // a plain folder outside git has no head at all
    let plain = workspace("term022-plain");
    assert_eq!(head_of(&plain), None);
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&plain);
}

/// TERM-017 box 2 (backend half): two sessions alive at once never print into each other. A layout change is a pure
/// reorder of the window's pane list and never reaches a session; where output goes is decided by session id / pane key.
#[test]
fn term017_box2_text_printed_in_one_session_never_shows_in_another() {
    let (wa, wb) = (workspace("term017-a"), workspace("term017-b"));
    let (mut a, mut b) = (Shell::start(&wa.to_string_lossy()), Shell::start(&wb.to_string_lossy()));
    let (la, lb) = (wa.file_name().unwrap().to_string_lossy().into_owned(), wb.file_name().unwrap().to_string_lossy().into_owned());
    assert!(a.until(40, |s| s.text().contains(&la)), "A prompt: {:?}", a.text());
    assert!(b.until(40, |s| s.text().contains(&lb)), "B prompt: {:?}", b.text());
    let (ma, mb) = ("KOLUXAAAA17", "KOLUXBBBB17");
    a.session.write(format!("echo {ma}\r").as_bytes()).unwrap();
    b.session.write(format!("echo {mb}\r").as_bytes()).unwrap();
    // The marker must arrive as the shell's output line. Counting every occurrence also counts
    // the typed command and PSReadLine's history suggestion, which is shared between the two
    // shells on a CI runner and says nothing about where the output went.
    let printed = |text: &str, marker: &str| text.lines().any(|l| l.contains(marker) && !l.contains("echo "));
    assert!(a.until(30, |s| printed(&s.text(), ma)), "A ran its echo: {:?}", a.text());
    assert!(b.until(30, |s| printed(&s.text(), mb)), "B ran its echo: {:?}", b.text());
    assert!(!printed(&a.text(), mb), "B's text reached A: {:?}", a.text());
    assert!(!printed(&b.text(), ma), "A's text reached B: {:?}", b.text());
    // a pane remounted by a move asks for its terminal by pane key and is handed the one still running, never a fresh one
    let back = kolux_lib::terminal::attach_answer(5, Some(42), 5);
    assert_eq!((back.state, back.id), ("attached", Some(42)));
    assert_eq!(kolux_lib::terminal::attach_answer(5, None, 5).state, "fresh");
    a.session.kill();
    b.session.kill();
    let _ = std::fs::remove_dir_all(&wa);
    let _ = std::fs::remove_dir_all(&wb);
}

// ---------------------------------------------------------------- TERM-105 and TERM-125

use base64::Engine as _;
use kolux_lib::pty::link::{missed, row_tail};
use kolux_lib::pty::service::{write_endpoint, Client, Config, Endpoint, Service};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};

/// A real background terminal service on its own thread, as the app's service process runs it, with its endpoint file in `dir`.
struct Host {
    service: Service,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    ep: Endpoint,
}

impl Host {
    fn start(dir: &std::path::Path) -> Host {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let ep = Endpoint {
            port: listener.local_addr().unwrap().port(),
            token: format!("cards03-{}", std::process::id()),
            pid: std::process::id(),
            generation: kolux_lib::terminal::generation(),
            protocol: kolux_lib::terminal::PROTOCOL,
        };
        write_endpoint(dir, &ep).unwrap();
        let service = Service::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (s, st, token, protocol) = (service.clone(), stop.clone(), ep.token.clone(), ep.protocol);
        let thread = std::thread::spawn(move || s.run(listener, Config { token, protocol, idle: Duration::from_secs(600) }, Instant::now, &st).unwrap());
        Host { service, stop, thread: Some(thread), ep }
    }

    fn window(&self) -> Client {
        let mut c = Client::connect(&self.ep, Duration::from_secs(10)).unwrap();
        c.set_wait(Some(Duration::from_millis(300))).unwrap();
        c
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.service.end_all();
    }
}

fn unb64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).unwrap_or_default()
}

/// Reads output events of terminal `id` from the attached `window` (answering the console's cursor question through `ctl`)
/// until `done(text so far)` holds or `secs` pass; returns the text and the output count of the last event.
fn drain(window: &mut Client, ctl: &mut Client, id: u64, secs: u64, mut done: impl FnMut(&str) -> bool) -> (String, u64) {
    let (mut text, mut seq) = (String::new(), 0);
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end && !done(&text) {
        let Ok(ev) = window.read() else { continue };
        if ev["ev"] == "output" && ev["id"] == id {
            let chunk = String::from_utf8_lossy(&unb64(ev["data"].as_str().unwrap_or_default())).into_owned();
            if chunk.contains("\x1b[6n") {
                let reply = base64::engine::general_purpose::STANDARD.encode(b"\x1b[1;1R");
                let _ = ctl.request(json!({ "op": "write", "id": id, "data": reply }), &mut Vec::new());
            }
            text.push_str(&chunk);
            seq = ev["seq"].as_u64().unwrap_or(seq);
        }
    }
    (text, seq)
}

fn has_line(text: &str, line: &str) -> bool {
    plain(text).split(['\r', '\n']).any(|l| l.trim() == line)
}

/// The text with escape sequences (colours, cursor moves, window titles) taken out, so a shell that redraws the typed line
/// character by character cannot fake or hide a line of program output.
fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('[') => {
                for n in it.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(n) = it.next() {
                    if n == '\u{7}' {
                        break;
                    }
                    if n == '\u{1b}' {
                        it.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// TERM-105 box 1: a build is running in a pane; the window quits (its connection ends); the build goes on in the background
/// service and prints while no window is open; a reopened window gets the same terminal back (same id, same pane mark), the
/// output printed while it was away, and then the rest of the build live.
/// Window side: `pty::link::missed` (pub) is what the app adds to the pane's saved output for the gap. The real Service, its tail
/// and the real shell decide the outcome; `Terminals::adopt` itself needs an app handle and is not run.
#[test]
fn term105_box1_a_build_running_at_quit_goes_on_and_its_output_continues_in_the_same_pane() {
    let dir = workspace("term105-host");
    let ws = workspace("term105-ws");
    let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
    let host = Host::start(&dir);
    let (mut first, mut ctl) = (host.window(), host.window());
    let mut events = Vec::new();
    first.request(json!({ "op": "attach" }), &mut events).unwrap();
    let row = ctl.request(json!({ "op": "spawn", "cols": 100, "rows": 30, "cwd": ws.to_string_lossy(), "meta": { "pane": 42 } }), &mut events).unwrap();
    let id = row["id"].as_u64().unwrap();
    let (prompt, _) = drain(&mut first, &mut ctl, id, 40, |t| t.contains(&leaf));
    assert!(prompt.contains(&leaf), "the shell is up in the folder: {prompt:?}");
    // the build: eight steps one second apart; each prints a number the typed command text never contains
    let build: &[u8] = if cfg!(windows) {
        b"1..8 | % { 'BLD' + ($_*7); Start-Sleep 1 }\r"
    } else {
        b"for i in 1 2 3 4 5 6 7 8; do echo BLD$((i*7)); sleep 1; done\n"
    };
    let typed = base64::engine::general_purpose::STANDARD.encode(build);
    ctl.request(json!({ "op": "write", "id": id, "data": typed }), &mut events).unwrap();
    let (before, seen) = drain(&mut first, &mut ctl, id, 30, |t| has_line(t, "BLD7"));
    assert!(has_line(&before, "BLD7"), "the build started: {before:?}");
    // quit: the window's connection ends, the terminal stays
    drop(first);
    let end = Instant::now() + Duration::from_secs(5);
    while host.service.counts() != (1, 0) {
        assert!(Instant::now() < end, "the closed window was not detached");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(3000));
    // reopen
    let mut second = host.window();
    let back = second.request(json!({ "op": "attach" }), &mut events).unwrap();
    let kept = back["terminals"].as_array().unwrap().iter().find(|t| t["id"] == id).expect("the same terminal is still there").clone();
    assert_eq!(kept["meta"]["pane"], 42, "it is still the terminal of the same pane");
    let tail = row_tail(&kept);
    let now = kept["seq"].as_u64().unwrap();
    let gap = String::from_utf8_lossy(missed(Some(seen), now, &tail, &[])).into_owned();
    assert!(has_line(&gap, "BLD14"), "the step printed while no window was open is in what the pane is given: {gap:?}");
    assert!(!has_line(&before, "BLD14"), "that step was not seen before the quit");
    assert!(!has_line(&gap, "BLD7"), "what the window had already drawn is not added twice: {gap:?}");
    // the build keeps running: its last step arrives live on the reopened window
    let (live, _) = drain(&mut second, &mut ctl, id, 30, |t| has_line(t, "BLD56"));
    assert!(has_line(&live, "BLD56"), "the build ran to its last step after the reopen: {live:?}");
    ctl.request(json!({ "op": "kill", "id": id }), &mut events).unwrap();
    drop(host);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&ws);
}

/// TERM-125 box 1: `kolux terminal send --text <t> --enter` types the text and submits it; without `--enter` the text only sits typed.
/// The real command-line parser reads the flags, the real send driver (`sendonce::drive`, the one `send_once` in cli.rs runs) decides
/// the writes, and a real shell receives them. The text is a command whose output (`SENT125`) the typed characters never contain,
/// so the output line proves the shell ran it.
/// MIRROR src-tauri/src/cli.rs:3673 (send_once): the `Look` built from the terminal and the `write` callback are rebuilt here around the real driver.
#[test]
fn term125_box1_send_enter_types_the_text_and_submits_it() {
    use kolux_lib::orchestration::sendonce::{drive, Look, Outcome, Send};
    let parse = |line: &str| {
        let words: Vec<String> = line.split(' ').map(String::from).collect();
        kolux_lib::cli::parse(&words).1.expect("the flags parse").expect("a command").args
    };
    let run = |tag: &str, flags: &str| -> (bool, Vec<&'static str>, Outcome, String) {
        let ws = workspace(tag);
        let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
        let mut sh = Shell::start(&ws.to_string_lossy());
        assert!(sh.until(40, |s| s.text().contains(&leaf)), "the prompt names the folder: {:?}", sh.text());
        // the flag parser is given one word per space here, so the space of the command is spelled `_`
        let command = if cfg!(windows) { "echo_(\"SENT\"+(100+25))" } else { "echo_SENT$((100+25))" };
        let args = parse(&format!("terminal send --terminal term-1 --text {command}{flags}"));
        let text = args["text"].as_str().unwrap().replacen("echo_", "echo ", 1);
        assert!(!text.contains("SENT125"), "the typed text never holds the output line");
        let enter = args.get("enter").and_then(|v| v.as_bool()).unwrap_or(false);
        let started = Instant::now();
        let mut send = Send::new(text.len(), enter, cfg!(windows), 0);
        let out = sh.out.clone();
        let (mut last, mut seen) = (Instant::now(), 0usize);
        let look = || {
            let now = out.lock().unwrap().len();
            if now != seen {
                seen = now;
                last = Instant::now();
            }
            Look { now_ms: started.elapsed().as_millis() as u64, last_output_ms: Some(last.duration_since(started).as_millis() as u64), live: true, ..Look::default() }
        };
        let d = drive(&mut send, Some(&text), false, look, |s| sh.session.write(s.as_bytes()), std::thread::sleep).expect("the send finishes");
        let made = sh.until(if enter { 30 } else { 4 }, |s| has_line(&s.text(), "SENT125"));
        let shown = sh.text();
        sh.session.kill();
        let _ = std::fs::remove_dir_all(&ws);
        (made, d.delivered, d.outcome, shown)
    };
    let (made, delivered, outcome, shown) = run("term125-enter", " --enter");
    assert_eq!((delivered.as_slice(), outcome), (["text", "enter"].as_slice(), Outcome::Sent));
    assert!(made, "the shell ran the typed command after --enter: {shown:?}");
    let (made, delivered, outcome, shown) = run("term125-plain", "");
    assert_eq!((delivered.as_slice(), outcome), (["text"].as_slice(), Outcome::TextOnly));
    assert!(!made, "without --enter the text is only typed, never run: {shown:?}");
}
