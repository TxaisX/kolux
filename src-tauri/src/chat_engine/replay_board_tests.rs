//! CHAT-01 board tests (locked; copied verbatim from the ticket board). The chat asks the agent to
//! echo each user message back (`--replay-user-messages`), so the page can confirm a send and keep the
//! user's message above the reply. Process tests run `stub.js` through node, never a real agent, each
//! in its own temp folder with a scratch CLAUDE_CONFIG_DIR.
use super::events::*;
use super::*;
use serde_json::{json, Value};
use std::sync::atomic::AtomicUsize;

const STUB: &str = include_str!("stub.js");
const REPLAY: &str = "--replay-user-messages";

static DIRS: AtomicUsize = AtomicUsize::new(0);

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-chat01-{tag}-{}-{}", std::process::id(), DIRS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(dir.join("claude-config")).unwrap();
    std::fs::write(dir.join("stub.js"), STUB).unwrap();
    dir
}

fn node() -> PathBuf {
    crate::agents::find_program("node").expect("the chat engine's process tests need node on PATH")
}

fn combos() -> Vec<(Option<&'static str>, Option<&'static str>, Option<&'static str>)> {
    let mut out = Vec::new();
    for model in [None, Some("some-model/v1")] {
        for effort in [None, Some("high")] {
            for resume in [None, Some("abc-123")] {
                out.push((model, effort, resume));
            }
        }
    }
    out
}

fn check_line(agent: &str, mode: &str) {
    for (model, effort, resume) in combos() {
        let a = chat_args(agent, model, effort, resume);
        let head = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", mode];
        assert_eq!(a[..8], head, "the first eight arguments are unchanged: {a:?}");
        assert_eq!(a.get(8).map(String::as_str), Some(REPLAY), "the replay flag comes right after the permission mode: {a:?}");
        assert_eq!(a.iter().filter(|x| x.as_str() == REPLAY).count(), 1, "exactly once: {a:?}");
        assert_eq!(a.windows(2).any(|w| w[0] == "--model" && Some(w[1].as_str()) == model), model.is_some(), "{a:?}");
        assert_eq!(a.windows(2).any(|w| w[0] == "--effort" && Some(w[1].as_str()) == effort), effort.is_some(), "{a:?}");
        assert_eq!(a.windows(2).any(|w| w[0] == "--resume" && Some(w[1].as_str()) == resume), resume.is_some(), "{a:?}");
        assert!(!a.iter().any(|x| x == "--bare"), "{a:?}");
    }
}

#[test]
fn claude_asks_for_replay_right_after_the_permission_mode() {
    check_line("claude", "auto");
}

#[test]
fn openclaude_asks_for_replay_right_after_the_permission_mode() {
    check_line("openclaude", "bypassPermissions");
    let a = chat_args("openclaude", Some("deepseek/deepseek-v4.1-flash-1017"), None, None);
    assert!(a.windows(2).any(|w| w == ["--provider", OPENCLAUDE_PROVIDER]), "the gateway is still added: {a:?}");
}

#[test]
fn only_chat_agents_ask_for_replay() {
    for agent in ["codex", "gemini", ""] {
        let a = chat_args(agent, None, None, None);
        assert!(!a.iter().any(|x| x == REPLAY), "{agent:?} is not a chat agent: {a:?}");
    }
    for agent in CHAT_AGENTS {
        assert!(chat_args(agent, None, None, None).iter().any(|x| x == REPLAY), "{agent}");
    }
}

/// Runs the stub directly with `args`, writes `lines` to its stdin, closes it and returns every JSON
/// line it printed.
fn run_stub(args: &[&str], lines: &[Value]) -> Vec<Value> {
    let dir = scratch("direct");
    let mut child = std::process::Command::new(node())
        .arg(dir.join("stub.js"))
        .args(args)
        .current_dir(&dir)
        .env("CLAUDE_CONFIG_DIR", dir.join("claude-config"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("node runs the stub");
    {
        let mut stdin = child.stdin.take().unwrap();
        for l in lines {
            stdin.write_all(format!("{l}\n").as_bytes()).unwrap();
        }
    }
    let out = child.wait_with_output().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect()
}

fn base_args() -> Vec<&'static str> {
    vec!["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"]
}

#[test]
fn the_stub_replays_only_when_asked() {
    let content = json!([{ "type": "text", "text": "hello there" }, { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }]);
    let msg = json!({ "type": "user", "message": { "role": "user", "content": content }, "parent_tool_use_id": null });

    let plain = run_stub(&base_args(), &[msg.clone()]);
    assert!(plain.iter().any(|l| l["type"] == "assistant"), "the stub still answers: {plain:?}");
    assert!(!plain.iter().any(|l| l["type"] == "user"), "no echo without the flag: {plain:?}");

    let mut args = base_args();
    args.push(REPLAY);
    let replay = run_stub(&args, &[msg]);
    let session = replay.iter().find(|l| l["type"] == "system" && l["subtype"] == "init").map(|l| l["session_id"].clone()).expect("an init line");
    let echoes: Vec<&Value> = replay.iter().filter(|l| l["type"] == "user").collect();
    assert_eq!(echoes.len(), 1, "one echo per message: {replay:?}");
    let e = echoes[0];
    assert_eq!(e["isReplay"], json!(true), "{e}");
    assert_eq!(e["session_id"], session, "{e}");
    assert!(e.get("parent_tool_use_id").is_some_and(Value::is_null), "parent_tool_use_id is present and null: {e}");
    assert_eq!(e["message"]["role"], "user", "{e}");
    assert_eq!(e["message"]["content"], content, "the content comes back as it was sent: {e}");
    let echo_at = replay.iter().position(|l| l["type"] == "user").unwrap();
    let reply_at = replay.iter().position(|l| l["type"] == "assistant").expect("an answer");
    assert!(echo_at < reply_at, "the echo comes before the answer: {replay:?}");
}

type Seen = Arc<Mutex<Vec<(String, ChatEvent)>>>;

struct Run {
    engines: Engines,
    seen: Seen,
    dir: PathBuf,
}

impl Drop for Run {
    fn drop(&mut self) {
        self.engines.close_all();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn run() -> Run {
    let dir = scratch("engine");
    let launch = Launch { program: node(), pre_args: vec![dir.join("stub.js").to_string_lossy().into_owned()] };
    Run { engines: Engines::new(Config { launch: Some(launch), idle: IDLE_SLEEP, busy_idle: BUSY_IDLE_SLEEP, stop_grace: STOP_GRACE }), seen: Arc::default(), dir }
}

impl Run {
    fn sink(&self) -> Sink {
        let seen = Arc::clone(&self.seen);
        Arc::new(move |id: &str, ev: &ChatEvent| seen.lock().unwrap().push((id.to_string(), ev.clone())))
    }

    fn spec(&self, agent: &str) -> Spec {
        let env = vec![("CLAUDE_CONFIG_DIR".to_string(), self.dir.join("claude-config").to_string_lossy().into_owned())];
        Spec { agent: agent.to_string(), cwd: self.dir.clone(), model: None, effort: None, env, handoff_at: 0, handoff_note: None }
    }

    fn events(&self, id: &str) -> Vec<ChatEvent> {
        self.seen.lock().unwrap().iter().filter(|(c, _)| c == id).map(|(_, e)| e.clone()).collect()
    }

    /// Waits up to 20 s for `n` results of chat `id`.
    fn wait_results(&self, id: &str, n: usize) {
        let end = Instant::now() + Duration::from_secs(20);
        loop {
            if self.events(id).iter().filter(|e| matches!(e, ChatEvent::Result(_))).count() >= n {
                return;
            }
            assert!(Instant::now() < end, "chat {id}: waited for {n} results, saw {:?}", self.events(id));
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn user_texts(evs: &[ChatEvent]) -> Vec<(usize, String)> {
    evs.iter().enumerate().filter_map(|(i, e)| if let ChatEvent::User { text, parent_tool_use_id: None, .. } = e { Some((i, text.join("\n"))) } else { None }).filter(|(_, t)| !t.is_empty()).collect()
}

fn reply_at(evs: &[ChatEvent], words: &str) -> Option<usize> {
    evs.iter().position(|e| matches!(e, ChatEvent::Assistant { blocks, .. } if blocks.iter().any(|b| matches!(b, Block::Text { text } if text.contains(words)))))
}

#[test]
fn a_sent_message_comes_back_as_a_user_event_before_its_reply() {
    for agent in CHAT_AGENTS {
        let r = run();
        let id = format!("r-{agent}");
        r.engines.start(&id, r.spec(agent), None, r.sink()).unwrap();
        r.engines.send(&id, "hello", &[]).unwrap();
        r.wait_results(&id, 1);
        r.engines.send(&id, "second one", &[]).unwrap();
        r.wait_results(&id, 2);
        let evs = r.events(&id);
        let users = user_texts(&evs);
        let texts: Vec<&str> = users.iter().map(|(_, t)| t.as_str()).collect();
        assert_eq!(texts, ["hello", "second one"], "{agent}: each message echoed once, in order: {evs:?}");
        let hello_reply = reply_at(&evs, "echo: hello").expect("the first answer");
        let second_reply = reply_at(&evs, "echo: second one").expect("the second answer");
        assert!(users[0].0 < hello_reply, "{agent}: the echo of the first message comes before its answer: {evs:?}");
        assert!(hello_reply < users[1].0 && users[1].0 < second_reply, "{agent}: the second echo sits between the two answers: {evs:?}");
        r.engines.close_all();
    }
}

// After a handoff an OpenClaude chat sends the note inside the first message (`note_message`), so the
// echo carries the note envelope with the user's own words last; the page strips the envelope.
#[test]
fn the_replayed_first_message_after_a_note_keeps_the_users_words_last() {
    let r = run();
    let note = r.dir.join("note.md");
    std::fs::write(&note, "# Handoff\n\n## Left to do\n- wire the readers").unwrap();
    let mut spec = r.spec("openclaude");
    spec.handoff_note = Some(note);
    r.engines.start("n1", spec, None, r.sink()).unwrap();
    r.engines.send("n1", "first words", &[]).unwrap();
    r.wait_results("n1", 1);
    let evs = r.events("n1");
    let users = user_texts(&evs);
    assert_eq!(users.len(), 1, "{evs:?}");
    let text = &users[0].1;
    assert!(text.starts_with("<system-reminder>\n"), "the envelope comes first: {text:?}");
    assert!(text.contains("wire the readers"), "{text:?}");
    assert!(text.ends_with("</system-reminder>\n\nfirst words"), "the user's own words come last, after the envelope: {text:?}");
    r.engines.close_all();
}
