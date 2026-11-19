//! Chat engine tests. Parsing runs on hand-written fixtures modelled on the documented message
//! shapes (never captured from a real config folder). Process tests run `stub.js` through node,
//! never the real `claude`, each in its own temp folder with a scratch CLAUDE_CONFIG_DIR.
use super::events::*;
use super::*;
use serde_json::{json, Value};
use std::sync::atomic::AtomicUsize;

const INIT: &str = include_str!("fixtures/init.jsonl");
const TURN: &str = include_str!("fixtures/turn.jsonl");
const DENIED: &str = include_str!("fixtures/denied.jsonl");
const STUB: &str = include_str!("stub.js");

fn events_of(text: &str) -> Vec<ChatEvent> {
    text.lines().filter_map(parse_line).collect()
}

fn init_fixture() -> Init {
    match events_of(INIT).remove(0) {
        ChatEvent::Init(i) => i,
        other => panic!("not an init: {other:?}"),
    }
}

#[test]
fn init_fixture_reads_every_field() {
    let i = init_fixture();
    assert_eq!(i.session_id, "5f0e7a2c-1111-4222-8333-444455556666");
    assert_eq!(i.skills, ["tidy", "release-notes", "demo-plugin:review"], "two skills and a plugin's skill");
    assert_eq!(i.plugins, [Plugin { name: "demo-plugin".into(), path: Some("/plugins/demo-plugin".into()) }]);
    let status: Vec<(&str, Option<&str>)> = i.mcp_servers.iter().map(|m| (m.name.as_str(), m.status.as_deref())).collect();
    assert_eq!(status, [("notes", Some("connected")), ("tracker", Some("failed"))], "two connectors, one failed");
    assert_eq!(i.mcp_server_errors[0].kind.as_deref(), Some("connect_failed"));
    assert_eq!((i.model.as_deref(), i.permission_mode.as_deref(), i.cwd.as_deref()), (Some("claude-sonnet-demo"), Some("auto"), Some("/work/demo")));
    assert_eq!(i.capabilities, ["interrupt_receipt_v1", "interrupt_cancel_queued_v1"]);
    assert_eq!(i.agents, ["general-purpose"]);
    assert_eq!(i.api_key_source.as_deref(), Some("none"));
    assert_eq!(i.raw["output_style"], "default", "the whole line is kept");
}

#[test]
fn turn_fixture_reads_text_tools_subagents_compaction_and_result() {
    let ev = events_of(TURN);
    assert_eq!(ev.len(), 8);
    let ChatEvent::Assistant { blocks, parent_tool_use_id: None, message_id, .. } = &ev[0] else { panic!("{:?}", ev[0]) };
    assert_eq!(blocks, &[Block::Text { text: "Reading the readme first.".into() }]);
    assert_eq!(message_id.as_deref(), Some("msg_01"));
    let ChatEvent::Assistant { blocks, .. } = &ev[1] else { panic!() };
    let Block::ToolUse { id, name, step: StepView::Tool { tool }, .. } = &blocks[0] else { panic!("{blocks:?}") };
    assert_eq!((id.as_str(), name.as_str(), tool.group, tool.preview.as_str()), ("toolu_read1", "Read", "read", "README.md"), "mapped by chat_tools::claude_step");
    let ChatEvent::User { tool_results, parent_tool_use_id: None, .. } = &ev[2] else { panic!() };
    assert_eq!(tool_results, &[ToolResult { tool_use_id: "toolu_read1".into(), output: "# Demo\nA small project.".into(), is_error: false }]);
    // A subagent: the Task call, then rows that name it as their parent.
    let ChatEvent::Assistant { blocks, .. } = &ev[3] else { panic!() };
    let Block::ToolUse { step: StepView::Tool { tool }, .. } = &blocks[0] else { panic!() };
    assert_eq!((tool.group, tool.name.as_str()), ("agent", "general-purpose"));
    let ChatEvent::Assistant { parent_tool_use_id, blocks, .. } = &ev[4] else { panic!() };
    assert_eq!(parent_tool_use_id.as_deref(), Some("toolu_task1"));
    let Block::ToolUse { step: StepView::Tool { tool }, .. } = &blocks[0] else { panic!() };
    assert_eq!(tool.group, "shell");
    let ChatEvent::User { parent_tool_use_id, tool_results, .. } = &ev[5] else { panic!() };
    assert_eq!((parent_tool_use_id.as_deref(), tool_results[0].output.as_str()), (Some("toolu_task1"), "3"));
    assert_eq!(ev[6], ChatEvent::CompactBoundary { trigger: Some("auto".into()), pre_tokens: Some(167000) });
    let ChatEvent::Result(r) = &ev[7] else { panic!() };
    assert_eq!((r.subtype.as_str(), r.is_error, r.total_cost_usd, r.num_turns), ("success", false, Some(0.0123), Some(4)));
    assert_eq!(r.usage.as_ref().unwrap()["output_tokens"], 31);
    assert!(r.model_usage.is_some());
}

#[test]
fn denied_fixture_reads_the_denial_and_the_error_result() {
    let ev = events_of(DENIED);
    assert_eq!(ev[1], ChatEvent::PermissionDenied { tool_name: "Bash".into(), tool_use_id: Some("toolu_rm1".into()), decision_reason_type: Some("rule".into()), decision_reason: Some("Bash(rm:*) is denied".into()), message: Some("Permission to use Bash was denied.".into()) });
    let ChatEvent::User { tool_results, .. } = &ev[2] else { panic!() };
    assert!(tool_results[0].is_error);
    let ChatEvent::Result(r) = &ev[3] else { panic!() };
    assert_eq!((r.subtype.as_str(), r.is_error), ("error_max_turns", true));
    assert_eq!(r.errors, ["Reached maximum number of turns (1)"]);
    assert_eq!(r.permission_denials, [Denial { tool_name: "Bash".into(), tool_use_id: Some("toolu_rm1".into()), tool_input: json!({ "command": "rm -rf build" }) }]);
}

#[test]
fn unknown_lines_are_kept_raw_and_blank_lines_skipped() {
    assert_eq!(parse_line("   "), None);
    assert_eq!(parse_line("not json"), Some(ChatEvent::Raw { line: "not json".into(), json: None }));
    let hook = r#"{"type":"system","subtype":"hook_started","hook_name":"x"}"#;
    assert_eq!(parse_line(hook), Some(ChatEvent::Raw { line: hook.into(), json: Some(serde_json::from_str(hook).unwrap()) }));
    let ChatEvent::ApiRetry { attempt, error_status, .. } = parse_line(r#"{"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":500,"error_status":529,"error":"overloaded"}"#).unwrap() else { panic!() };
    assert_eq!((attempt, error_status), (Some(2), Some(529)));
    // A long tool result is capped the way the chat view caps it.
    let long = json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t", "content": "x".repeat(crate::chat_tools::MAX_OUTPUT + 500) }] } }).to_string();
    let Some(ChatEvent::User { tool_results, .. }) = parse_line(&long) else { panic!() };
    assert!(tool_results[0].output.len() <= crate::chat_tools::MAX_OUTPUT + 100);
}

#[test]
fn a_plan_tool_becomes_a_plan_step() {
    let line = json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "id": "t1", "name": "TodoWrite", "input": { "todos": [{ "content": "Read", "status": "completed" }] } }] } }).to_string();
    let Some(ChatEvent::Assistant { blocks, .. }) = parse_line(&line) else { panic!() };
    assert!(matches!(&blocks[0], Block::ToolUse { step: StepView::Plan { per_turn: true, .. }, .. }));
}

#[test]
fn empty_init_alarm_fires_only_when_everything_is_missing_but_expected() {
    let expected = Expected { skills: vec!["tidy".into()], plugins: vec![], connectors: vec![] };
    let empty = Init { session_id: "s".into(), ..Init::default() };
    assert!(empty_init_alarm(&empty, &expected));
    assert!(!empty_init_alarm(&empty, &Expected::default()), "nothing expected, nothing loaded: fine");
    assert!(!empty_init_alarm(&init_fixture(), &expected));
    let one_connector = Init { mcp_servers: vec![McpServer { name: "notes".into(), ..McpServer::default() }], ..empty.clone() };
    assert!(!empty_init_alarm(&one_connector, &expected), "one of the three loaded: not the bare pattern");
}

#[test]
fn the_command_line_never_asks_for_bare() {
    for model in [None, Some("opus")] {
        for resume in [None, Some("abc-123")] {
            let a = claude_args(model, resume);
            assert!(!a.iter().any(|x| x == "--bare"), "{a:?}");
            assert_eq!(a[..8], ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"]);
            assert_eq!(a.windows(2).any(|w| w == ["--model", "opus"]), model.is_some());
            assert_eq!(a.windows(2).any(|w| w == ["--resume", "abc-123"]), resume.is_some());
        }
    }
}

#[test]
fn stdin_lines_and_the_page_payload_have_the_documented_shapes() {
    let user: Value = serde_json::from_str(&user_line("hi", &[Image { media_type: "image/png".into(), base64: "AAAA".into() }])).unwrap();
    assert_eq!(user, json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "hi" }, { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }] }, "parent_tool_use_id": null }));
    let stop: Value = serde_json::from_str(&interrupt_line("r1")).unwrap();
    assert_eq!(stop, json!({ "type": "control_request", "request_id": "r1", "request": { "subtype": "interrupt" } }));
    let img: Image = serde_json::from_value(json!({ "mediaType": "image/jpeg", "base64": "B" })).unwrap();
    assert_eq!(img.media_type, "image/jpeg");
    let ev = ChatEvent::Exit { code: Some(0), reason: ExitReason::Sleep };
    assert_eq!(serde_json::to_value(Payload { chat_id: "c1", event: &ev }).unwrap(), json!({ "chatId": "c1", "kind": "exit", "code": 0, "reason": "sleep" }));
    let init = ChatEvent::Init(init_fixture());
    let v = serde_json::to_value(Payload { chat_id: "c1", event: &init }).unwrap();
    assert_eq!((v["kind"].as_str(), v["sessionId"].as_str(), v["mcpServers"][1]["status"].as_str()), (Some("init"), Some("5f0e7a2c-1111-4222-8333-444455556666"), Some("failed")));
    let use_ev = events_of(TURN).remove(1);
    let v = serde_json::to_value(Payload { chat_id: "c1", event: &use_ev }).unwrap();
    assert_eq!((v["kind"].as_str(), v["blocks"][0]["type"].as_str(), v["blocks"][0]["step"]["kind"].as_str()), (Some("assistant"), Some("toolUse"), Some("tool")));
}

// ---- process tests: the stub through node ----

static DIRS: AtomicUsize = AtomicUsize::new(0);

type Seen = Arc<Mutex<Vec<(String, ChatEvent)>>>;

struct Harness {
    engines: Engines,
    seen: Seen,
    dir: PathBuf,
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.engines.close_all();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn harness(idle: Duration, stop_grace: Duration) -> Harness {
    let node = crate::agents::find_program("node").expect("the chat engine's process tests need node on PATH (CI installs it)");
    let dir = std::env::temp_dir().join(format!("kolux-chat-engine-{}-{}", std::process::id(), DIRS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(dir.join("claude-config")).unwrap();
    std::fs::write(dir.join("stub.js"), STUB).unwrap();
    let launch = Launch { program: node, pre_args: vec![dir.join("stub.js").to_string_lossy().into_owned()] };
    Harness { engines: Engines::new(Config { launch: Some(launch), idle, stop_grace }), seen: Arc::default(), dir }
}

impl Harness {
    fn sink(&self) -> Sink {
        let seen = Arc::clone(&self.seen);
        Arc::new(move |id: &str, ev: &ChatEvent| seen.lock().unwrap().push((id.to_string(), ev.clone())))
    }

    fn spec(&self, extra: &[(&str, &str)]) -> Spec {
        let mut env = vec![("CLAUDE_CONFIG_DIR".to_string(), self.dir.join("claude-config").to_string_lossy().into_owned())];
        env.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        Spec { cwd: self.dir.clone(), model: None, env }
    }

    fn start(&self, id: &str, extra: &[(&str, &str)]) {
        self.engines.start(id, self.spec(extra), None, self.sink()).unwrap();
    }

    /// Waits up to 20 s for `n` events of chat `id` that match.
    fn wait(&self, id: &str, n: usize, hit: impl Fn(&ChatEvent) -> bool) -> Vec<ChatEvent> {
        let end = Instant::now() + Duration::from_secs(20);
        loop {
            let found: Vec<ChatEvent> = self.seen.lock().unwrap().iter().filter(|(c, e)| c == id && hit(e)).map(|(_, e)| e.clone()).collect();
            if found.len() >= n {
                return found;
            }
            assert!(Instant::now() < end, "chat {id}: waited for {n} events, saw {:?}", self.seen.lock().unwrap().iter().filter(|(c, _)| c == id).collect::<Vec<_>>());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn results(&self, id: &str, n: usize) -> Vec<TurnResult> {
        self.wait(id, n, |e| matches!(e, ChatEvent::Result(_))).into_iter().filter_map(|e| if let ChatEvent::Result(r) = e { Some(r) } else { None }).collect()
    }

    /// The stub's own report of its command line and environment, one per start.
    fn stub_args(&self, id: &str, n: usize) -> Vec<Value> {
        self.wait(id, n, |e| matches!(e, ChatEvent::Raw { json: Some(j), .. } if j["type"] == "stub_args")).into_iter().filter_map(|e| if let ChatEvent::Raw { json, .. } = e { json } else { None }).collect()
    }
}

fn is_exit(e: &ChatEvent, why: ExitReason) -> bool {
    matches!(e, ChatEvent::Exit { reason, .. } if *reason == why)
}

#[test]
fn start_send_stop_and_close_a_chat() {
    let h = harness(IDLE_SLEEP, Duration::from_secs(10));
    // CLAUDE_CODE_SIMPLE (what --bare sets) in the caller's variables never reaches the agent.
    h.start("c1", &[(BARE_ENV, "1")]);
    let init = h.wait("c1", 1, |e| matches!(e, ChatEvent::Init(_)));
    let ChatEvent::Init(init) = &init[0] else { unreachable!() };
    let args = &h.stub_args("c1", 1)[0];
    assert!(!args["args"].as_array().unwrap().iter().any(|a| a == "--bare"), "{args}");
    assert_eq!(args["bare_env"], Value::Null);
    assert!(args["config_dir"].as_str().unwrap().ends_with("claude-config"), "the scratch config folder");
    h.wait("c1", 1, |e| matches!(e, ChatEvent::Stderr { line } if line == "stub ready"));

    h.engines.send("c1", "hello", &[Image { media_type: "image/png".into(), base64: "AAAA".into() }]).unwrap();
    let r = h.results("c1", 1);
    assert_eq!((r[0].subtype.as_str(), r[0].result.as_deref()), ("success", Some("echo: hello")));
    h.wait("c1", 1, |e| matches!(e, ChatEvent::Assistant { blocks, .. } if blocks == &[Block::Text { text: "echo: hello (1 images)".into() }]));
    assert_eq!(h.engines.engine("c1").unwrap().session_id().as_deref(), Some(init.session_id.as_str()));

    assert_eq!(h.engines.stop("c1").unwrap(), None, "no turn running: nothing to stop");
    h.engines.send("c1", "slow job", &[]).unwrap();
    h.wait("c1", 1, |e| matches!(e, ChatEvent::Assistant { message_id: Some(m), .. } if m == "msg-slow"));
    assert_eq!(h.engines.stop("c1").unwrap(), Some(StopHow::Interrupt));
    assert_eq!(h.results("c1", 2)[1].subtype, "error_during_execution");
    h.wait("c1", 1, |e| *e == ChatEvent::Stopped { how: StopHow::Interrupt });
    assert!(h.engines.engine("c1").unwrap().is_running(), "an interrupt keeps the process");

    h.engines.send("c1", "again", &[]).unwrap();
    assert_eq!(h.results("c1", 3)[2].result.as_deref(), Some("echo: again"));

    h.engines.close("c1");
    h.wait("c1", 1, |e| is_exit(e, ExitReason::Closed));
    assert!(h.engines.send("c1", "late", &[]).is_err());
}

#[test]
fn stop_ends_a_deaf_process_and_the_next_send_resumes() {
    let h = harness(IDLE_SLEEP, Duration::from_millis(300));
    h.start("c2", &[("STUB_IGNORE_INTERRUPT", "1")]);
    h.wait("c2", 1, |e| matches!(e, ChatEvent::Init(_)));
    let session = h.engines.engine("c2").unwrap().session_id().unwrap();
    h.engines.send("c2", "slow job", &[]).unwrap();
    h.wait("c2", 1, |e| matches!(e, ChatEvent::Assistant { .. }));
    assert_eq!(h.engines.stop("c2").unwrap(), Some(StopHow::Ended));
    h.wait("c2", 1, |e| is_exit(e, ExitReason::Stopped));
    h.wait("c2", 1, |e| *e == ChatEvent::Stopped { how: StopHow::Ended });

    h.engines.send("c2", "after", &[]).unwrap();
    h.wait("c2", 1, |e| matches!(e, ChatEvent::Started { resumed: Some(s), .. } if *s == session));
    assert_eq!(h.results("c2", 1)[0].result.as_deref(), Some("echo: after"));
}

#[test]
fn an_idle_chat_sleeps_and_resumes_on_the_next_send() {
    let h = harness(Duration::from_millis(400), Duration::from_secs(5));
    h.start("c3", &[]);
    h.engines.send("c3", "hello", &[]).unwrap();
    let first = h.results("c3", 1)[0].session_id.clone().unwrap();
    h.wait("c3", 1, |e| is_exit(e, ExitReason::Sleep));
    assert!(!h.engines.engine("c3").unwrap().is_running(), "asleep: no process");
    assert_eq!(h.engines.engine("c3").unwrap().session_id().as_deref(), Some(first.as_str()), "the session id is kept");

    h.engines.send("c3", "awake", &[]).unwrap();
    assert_eq!(h.results("c3", 2)[1].result.as_deref(), Some("echo: awake"));
    let args = h.stub_args("c3", 2);
    let second: Vec<&str> = args[1]["args"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert!(second.windows(2).any(|w| w == ["--resume", first.as_str()]), "{second:?}");
    assert!(!second.contains(&"--bare"));
}

#[test]
fn twenty_chats_run_at_once() {
    let h = Arc::new(harness(IDLE_SLEEP, Duration::from_secs(5)));
    let ids: Vec<String> = (0..20).map(|i| format!("many-{i}")).collect();
    let starts: Vec<_> = ids
        .iter()
        .map(|id| {
            let (h, id) = (Arc::clone(&h), id.clone());
            std::thread::spawn(move || {
                h.start(&id, &[]);
                h.engines.send(&id, &format!("hi {id}"), &[]).unwrap();
            })
        })
        .collect();
    for s in starts {
        s.join().unwrap();
    }
    for id in &ids {
        let r = h.results(id, 1);
        assert_eq!(r[0].result.as_deref(), Some(format!("echo: hi {id}").as_str()));
    }
    h.engines.close_all();
    for id in &ids {
        h.wait(id, 1, |e| is_exit(e, ExitReason::Closed));
    }
}

#[test]
fn bad_names_never_reach_the_command_line() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    let mut spec = h.spec(&[]);
    spec.model = Some("opus & calc".into());
    assert!(h.engines.start("bad", spec, None, h.sink()).is_err());
    assert!(h.engines.start("bad", h.spec(&[]), Some("abc\" & calc".into()), h.sink()).is_err());
    let mut spec = h.spec(&[]);
    spec.cwd = h.dir.join("missing");
    assert!(h.engines.start("bad", spec, None, h.sink()).is_err());
    assert!(h.engines.engine("bad").is_none());
}
