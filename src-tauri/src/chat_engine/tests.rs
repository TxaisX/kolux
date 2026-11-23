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
            let a = chat_args("claude", model, None, resume);
            assert!(!a.iter().any(|x| x == "--bare"), "{a:?}");
            assert_eq!(a[..8], ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"]);
            assert_eq!(a.windows(2).any(|w| w == ["--model", "opus"]), model.is_some());
            assert_eq!(a.windows(2).any(|w| w == ["--resume", "abc-123"]), resume.is_some());
        }
    }
}

#[test]
fn an_effort_pick_reaches_the_start_line_and_unknown_words_are_refused() {
    let a = chat_args("openclaude", Some("deepseek/deepseek-v4.1-flash-1017"), Some("high"), None);
    assert!(a.windows(2).any(|w| w == ["--effort", "high"]), "{a:?}");
    assert!(valid_effort("openclaude", "ultracode"));
    assert!(!valid_effort("claude", "ultracode"), "Claude Code has no ultracode level");
    assert!(valid_effort("claude", "max"));
    assert!(!valid_effort("openclaude", "turbo"));
}

/// 2026-11-20: OpenClaude reads the same stream-json lines, but its permission modes are not Claude
/// Code's — measured: `auto` falls back to `default` and every tool call is refused, while
/// `bypassPermissions` acts with no prompt (DT-C283: a chat never asks). Its picked model is routed
/// through OpenRouter, the gateway its list in the window comes from; no model, no provider.
#[test]
fn openclaude_gets_the_mode_it_knows_and_its_gateway() {
    let a = chat_args("openclaude", Some("deepseek/deepseek-v4.1-flash-1017"), None, None);
    assert!(a.windows(2).any(|w| w == ["--permission-mode", "bypassPermissions"]), "{a:?}");
    assert!(!a.windows(2).any(|w| w == ["--permission-mode", "auto"]), "{a:?}");
    assert!(a.windows(2).any(|w| w == ["--provider", OPENCLAUDE_PROVIDER]), "{a:?}");
    assert!(a.windows(2).any(|w| w == ["--model", "deepseek/deepseek-v4.1-flash-1017"]), "{a:?}");
    let own = chat_args("openclaude", None, None, None);
    assert!(!own.iter().any(|x| x == "--provider"), "Program default keeps OpenClaude's own setup: {own:?}");
    assert!(own.windows(2).any(|w| w == ["--permission-mode", "bypassPermissions"]), "{own:?}");
}

#[test]
fn stdin_lines_and_the_page_payload_have_the_documented_shapes() {
    let user: Value = serde_json::from_str(&user_line("hi", &[Image { media_type: "image/png".into(), base64: "AAAA".into() }])).unwrap();
    assert_eq!(user, json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "hi" }, { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }] }, "parent_tool_use_id": null }));
    let stop: Value = serde_json::from_str(&interrupt_line("r1")).unwrap();
    assert_eq!(stop, json!({ "type": "control_request", "request_id": "r1", "request": { "subtype": "interrupt", "cancel_queued": true } }));
    let img: Image = serde_json::from_value(json!({ "mediaType": "image/jpeg", "base64": "B" })).unwrap();
    assert_eq!(img.media_type, "image/jpeg");
    let ev = ChatEvent::Exit { pid: 42, code: Some(0), reason: ExitReason::Sleep };
    assert_eq!(serde_json::to_value(Payload { chat_id: "c1", event: &ev }).unwrap(), json!({ "chatId": "c1", "kind": "exit", "pid": 42, "code": 0, "reason": "sleep" }));
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
    harness_busy(idle, BUSY_IDLE_SLEEP, stop_grace)
}

/// A harness with its own idle sleep for a process that looks busy.
fn harness_busy(idle: Duration, busy_idle: Duration, stop_grace: Duration) -> Harness {
    let node = crate::agents::find_program("node").expect("the chat engine's process tests need node on PATH (CI installs it)");
    let dir = std::env::temp_dir().join(format!("kolux-chat-engine-{}-{}", std::process::id(), DIRS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(dir.join("claude-config")).unwrap();
    std::fs::write(dir.join("stub.js"), STUB).unwrap();
    let launch = Launch { program: node, pre_args: vec![dir.join("stub.js").to_string_lossy().into_owned()] };
    Harness { engines: Engines::new(Config { launch: Some(launch), idle, busy_idle, stop_grace }), seen: Arc::default(), dir }
}

impl Harness {
    fn sink(&self) -> Sink {
        let seen = Arc::clone(&self.seen);
        Arc::new(move |id: &str, ev: &ChatEvent| seen.lock().unwrap().push((id.to_string(), ev.clone())))
    }

    fn spec(&self, extra: &[(&str, &str)]) -> Spec {
        let mut env = vec![("CLAUDE_CONFIG_DIR".to_string(), self.dir.join("claude-config").to_string_lossy().into_owned())];
        env.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        Spec { agent: "claude".to_string(), cwd: self.dir.clone(), model: None, effort: None, env, handoff_at: 0, handoff_note: None }
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

// Txais (2026-11-21): a chat is handed off on the turn's own reading, never a guess.
#[test]
fn a_turns_prompt_is_its_input_plus_both_cache_parts() {
    let usage = json!({"input_tokens": 1000, "cache_creation_input_tokens": 20000, "cache_read_input_tokens": 79000});
    assert_eq!(prompt_tokens(Some(&usage)), Some(100_000));
    assert_eq!(prompt_tokens(Some(&json!({"input_tokens": 5}))), Some(5), "a turn with no cache still counts");
    assert_eq!(prompt_tokens(None), None, "a turn with no usage is never guessed at");
    assert_eq!(prompt_tokens(Some(&json!({"cache_read_input_tokens": 9}))), None, "no input number, no reading");
    let absurd = json!({"input_tokens": u64::MAX, "cache_read_input_tokens": 1});
    assert_eq!(prompt_tokens(Some(&absurd)), None, "an overflowing sum is no reading either");
}

#[test]
fn the_handoff_note_is_the_prompt_and_a_missing_one_adds_nothing() {
    let dir = std::env::temp_dir().join(format!("kolux-note-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let note = dir.join("handoff.md");
    std::fs::write(&note, "# Handoff\n\n## Left to do\n- finish the readers").unwrap();
    let prompt = note_prompt(&note);
    assert!(prompt.contains(&note.display().to_string()), "it says where the note is: {prompt}");
    assert!(prompt.contains("- finish the readers"), "it carries the note's own words: {prompt}");
    // A note that has gone missing still names its place: the agent writes it there as it works.
    let missing = dir.join("missing.md");
    let gone = note_prompt(&missing);
    assert!(gone.contains(&missing.display().to_string()), "a missing note still names the place: {gone}");
    assert!(!gone.contains("Left to do"));
    drop(std::fs::remove_dir_all(&dir));
}

// Txais (2026-11-21): at the handoff line the chat ends its process and forgets the session, so the
// next message starts a fresh conversation. Nothing is typed into the agent: the turn already ended.
#[test]
fn a_chat_at_the_handoff_line_ends_its_process_and_forgets_the_session() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    let mut spec = h.spec(&[]);
    spec.handoff_at = 1; // the stub's own turn reports input_tokens: 1
    h.engines.start("c1", spec, None, h.sink()).unwrap();
    h.engines.send("c1", "hello", &[]).unwrap();
    let handoffs = h.wait("c1", 1, |e| matches!(e, ChatEvent::Handoff { .. }));
    assert_eq!(handoffs.clone(), vec![ChatEvent::Handoff { tokens: 1, at: 1 }]);
    h.wait("c1", 1, |e| is_exit(e, ExitReason::Handoff));
    assert_eq!(h.engines.engine("c1").unwrap().session_id(), None, "the next send starts fresh");
    assert!(!h.engines.engine("c1").unwrap().is_running(), "the handed-off process is gone");
    h.engines.close_all();
}

// The note is free text: through a cmd.exe shim it could cut the line short or start another
// command, so only a plain Claude Code program takes it.
#[test]
fn the_note_rides_only_on_a_plain_claude_code_line() {
    assert!(notes_on_line("claude", false));
    assert!(!notes_on_line("claude", true), "never through cmd.exe");
    assert!(!notes_on_line("openclaude", false), "not known to take the flag");
}

fn said(e: &ChatEvent, text: &str) -> bool {
    matches!(e, ChatEvent::Assistant { blocks, .. } if blocks.iter().any(|b| matches!(b, Block::Text { text: t } if t.contains(text))))
}

/// The position of the first event of chat `id` that matches, in the order the sink saw them.
fn first_at(h: &Harness, id: &str, hit: impl Fn(&ChatEvent) -> bool) -> Option<usize> {
    h.seen.lock().unwrap().iter().filter(|(c, _)| c == id).position(|(_, e)| hit(e))
}

// Review P1-A (2026-11-23): a message the user wrote while a turn past the line was still running is
// queued in the agent. Ending the process on that turn's result would lose it, so the handoff waits
// for the last outstanding message's result.
#[test]
fn a_message_queued_during_a_turn_past_the_line_is_answered_before_the_handoff() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    let mut spec = h.spec(&[]);
    spec.handoff_at = 1_000;
    h.engines.start("q1", spec, None, h.sink()).unwrap();
    h.engines.send("q1", "hold [big] first", &[]).unwrap();
    h.wait("q1", 1, |e| said(e, "holding"));
    h.engines.send("q1", "second", &[]).unwrap();
    h.wait("q1", 1, |e| matches!(e, ChatEvent::Handoff { .. }));
    h.wait("q1", 1, |e| is_exit(e, ExitReason::Handoff));
    let echo = first_at(&h, "q1", |e| said(e, "echo: second")).expect("the queued message was answered, not lost");
    let handoff = first_at(&h, "q1", |e| matches!(e, ChatEvent::Handoff { .. })).unwrap();
    assert!(echo < handoff, "the answer comes before the handoff");
    let handoffs = h.wait("q1", 1, |e| matches!(e, ChatEvent::Handoff { .. }));
    assert_eq!(handoffs, vec![ChatEvent::Handoff { tokens: 500_000, at: 1_000 }], "one handoff, on the reading that crossed");
    h.engines.close_all();
}

// Review P2-D (2026-11-23): OpenClaude (and Claude Code through a .cmd shim) cannot take the note on
// its command line, so the first message after a handoff carries it inside the JSON line instead.
#[test]
fn after_a_handoff_the_next_openclaude_message_carries_the_note_once() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    let note = h.dir.join("note.md");
    std::fs::write(&note, "# Handoff

## Left to do
- wire the readers").unwrap();
    let mut spec = h.spec(&[]);
    spec.agent = "openclaude".to_string();
    spec.handoff_at = 1_000;
    spec.handoff_note = Some(note.clone());
    h.engines.start("n1", spec, None, h.sink()).unwrap();
    h.engines.send("n1", "[big] first", &[]).unwrap();
    h.wait("n1", 1, |e| is_exit(e, ExitReason::Handoff));
    let args = h.stub_args("n1", 1);
    assert!(!args[0]["args"].to_string().contains("wire the readers"), "never on the command line");
    h.engines.send("n1", "second", &[]).unwrap();
    h.wait("n1", 1, |e| said(e, "second"));
    assert!(first_at(&h, "n1", |e| said(e, "wire the readers") && said(e, "second")).is_some(), "the message after the handoff carries the note");
    h.engines.send("n1", "third", &[]).unwrap();
    h.wait("n1", 1, |e| said(e, "echo: third"));
    assert!(first_at(&h, "n1", |e| said(e, "third") && said(e, "wire the readers")).is_none(), "only the first message after the handoff carries it");
    h.engines.close_all();
}

// Review P3-E (2026-11-23): a NUL in the note would end the string the CLI reads; it is dropped.
#[test]
fn a_nul_in_the_note_never_reaches_the_prompt() {
    let dir = std::env::temp_dir().join(format!("kolux-note-nul-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let note = dir.join("handoff.md");
    std::fs::write(&note, "left\0to do").unwrap();
    let prompt = note_prompt(&note);
    assert!(!prompt.contains('\0'), "no NUL survives: {prompt:?}");
    assert!(prompt.contains("leftto do"));
    drop(std::fs::remove_dir_all(&dir));
}

// Review P2-C (2026-11-23): the reader of a process that was already ended (a stop, a sleep, a
// handoff) can still deliver a late line. Its usage and its result belong to the old process and
// must never hand off, or count against, the process running now.
#[test]
fn a_stale_reader_never_hands_off_the_process_running_now() {
    let spec = Spec { agent: "claude".to_string(), cwd: std::env::temp_dir(), model: None, effort: None, env: Vec::new(), handoff_at: 1_000, handoff_note: None };
    let mut inner = Inner { spec, session_id: None, last_prompt: None, outstanding: 1, handoff_due: None, note_due: false, stop_mark: None, child: None, gen: 2, busy: true, last_active: Instant::now(), closing: false, ending: None };
    let big = json!({ "input_tokens": 500_000 });
    inner.saw_usage(1, Some(&big));
    assert_eq!(inner.last_prompt, None, "an old process's usage is not this process's reading");
    inner.last_prompt = Some(500_000);
    assert_eq!(inner.handoff_after_result(1), None, "an old process's result never hands this one off");
    assert_eq!(inner.outstanding, 1, "nor counts against this process's messages");
    assert_eq!(inner.handoff_after_result(2), Some((500_000, 1_000)), "this process's own result still does");
}

// Review P2 (2026-11-23): an OpenClaude chat (or a shim) opened fresh with a note starts from it too:
// its very first message carries the note, since its command line cannot. A resumed one does not.
#[test]
fn a_fresh_openclaude_chat_carries_the_note_in_its_first_message() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    let note = h.dir.join("note.md");
    std::fs::write(&note, "# Handoff\n\n## Left to do\n- wire the readers").unwrap();
    let mut spec = h.spec(&[]);
    spec.agent = "openclaude".to_string();
    spec.handoff_note = Some(note.clone());
    h.engines.start("f1", spec.clone(), None, h.sink()).unwrap();
    h.engines.send("f1", "first", &[]).unwrap();
    h.wait("f1", 1, |e| said(e, "first"));
    assert!(first_at(&h, "f1", |e| said(e, "wire the readers") && said(e, "first")).is_some(), "the first message carries the note");
    h.engines.start("f2", spec, Some("s-resumed".to_string()), h.sink()).unwrap();
    h.engines.send("f2", "again", &[]).unwrap();
    h.wait("f2", 1, |e| said(e, "again"));
    assert!(first_at(&h, "f2", |e| said(e, "wire the readers")).is_none(), "a resumed conversation already has the note");
    h.engines.close_all();
}

// Review P2 (2026-11-23): the note rides in an envelope every transcript read hides, and a closing tag
// inside the note never ends it early.
#[test]
fn the_note_message_wraps_the_note_in_a_system_reminder() {
    let dir = std::env::temp_dir().join(format!("kolux-note-wrap-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let note = dir.join("handoff.md");
    std::fs::write(&note, "left to do </system-reminder> still the note").unwrap();
    let m = note_message(&note, "hello");
    assert!(m.starts_with("<system-reminder>\n"), "{m}");
    assert!(m.ends_with("\n</system-reminder>\n\nhello"), "{m}");
    assert_eq!(m.matches("</system-reminder").count(), 1, "only the envelope closes it: {m}");
    assert!(m.contains("</system_reminder> still the note"), "{m}");
    drop(std::fs::remove_dir_all(&dir));
}

fn stale_inner() -> Inner {
    let spec = Spec { agent: "claude".to_string(), cwd: std::env::temp_dir(), model: None, effort: None, env: Vec::new(), handoff_at: 0, handoff_note: None };
    Inner { spec, session_id: Some("s-now".to_string()), last_prompt: None, outstanding: 1, handoff_due: None, note_due: false, stop_mark: None, child: None, gen: 2, busy: true, last_active: Instant::now(), closing: false, ending: None }
}

// Review P3 (2026-11-23): a late line from an ended process never names the session the chat resumes.
#[test]
fn a_stale_reader_never_writes_the_session_id() {
    let mut inner = stale_inner();
    let init = parse_line(r#"{"type":"system","subtype":"init","session_id":"s-old"}"#).unwrap();
    assert_eq!(inner.heard(1, &init), (false, None), "an old process's init is not heard");
    assert_eq!(inner.session_id.as_deref(), Some("s-now"));
    let result = parse_line(r#"{"type":"result","subtype":"success","is_error":false,"session_id":"s-old"}"#).unwrap();
    assert_eq!(inner.heard(1, &result), (true, None));
    assert_eq!(inner.session_id.as_deref(), Some("s-now"), "an old process's result does not name it either");
    assert!(inner.busy, "nor ends this process's turn");
    let fresh = parse_line(r#"{"type":"system","subtype":"init","session_id":"s-new"}"#).unwrap();
    assert_eq!(inner.heard(2, &fresh), (true, None));
    assert_eq!(inner.session_id.as_deref(), Some("s-new"), "this process's own init does");
}

// Review P2 (2026-11-23): Claude Code answers a message queued behind a running turn with a result of
// its own (checked on claude -p: two messages 1 s apart gave two results), so the chat stays busy
// until the queued message's result, not the first one.
#[test]
fn a_queued_message_keeps_the_chat_busy_past_the_first_result() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    h.start("b1", &[]);
    h.engines.send("b1", "hold first", &[]).unwrap();
    h.wait("b1", 1, |e| said(e, "holding"));
    h.engines.send("b1", "second", &[]).unwrap();
    // The stub prints the held turn's result, then answers "second" 300 ms later.
    h.results("b1", 1);
    let engine = h.engines.engine("b1").unwrap();
    assert!(lock(&engine.inner).busy, "the queued message is still running");
    h.results("b1", 2);
    assert!(!lock(&engine.inner).busy, "its own result ends the turn");
    h.engines.close_all();
}

// Review P2 (2026-11-23): an interrupt can cancel the messages queued behind the stopped turn, so
// their results never come. The first result after a Stop answers everything sent, and Stop ends in
// an interrupt instead of waiting out its grace and killing the process.
#[test]
fn stop_with_a_queued_message_ends_in_an_interrupt_not_a_kill() {
    let h = harness(IDLE_SLEEP, Duration::from_secs(3));
    h.start("s1", &[]);
    h.engines.send("s1", "queue first", &[]).unwrap();
    h.wait("s1", 1, |e| said(e, "queueing"));
    h.engines.send("s1", "second", &[]).unwrap();
    assert_eq!(h.engines.stop("s1").unwrap(), Some(StopHow::Interrupt));
    let engine = h.engines.engine("s1").unwrap();
    assert!(!lock(&engine.inner).busy, "nothing is left running");
    assert!(engine.is_running(), "the process was interrupted, not ended");
    h.engines.close_all();
}

// Review P2 (2026-11-23): a turn whose result never comes leaves the chat looking busy; a process
// silent for the whole busy idle period sleeps anyway, so it cannot linger forever.
#[test]
fn a_silent_busy_process_still_sleeps() {
    let h = harness_busy(IDLE_SLEEP, Duration::from_millis(400), STOP_GRACE);
    h.start("i1", &[]);
    h.engines.send("i1", "queue forever", &[]).unwrap();
    h.wait("i1", 1, |e| said(e, "queueing"));
    assert!(lock(&h.engines.engine("i1").unwrap().inner).busy);
    h.wait("i1", 1, |e| is_exit(e, ExitReason::Sleep));
    h.engines.close_all();
}

// Review P2 (2026-11-23): every line of the process running now counts as activity, not only replies;
// a late line from an ended process does not.
#[test]
fn every_current_line_counts_as_activity() {
    let mut inner = stale_inner();
    let long_ago = Instant::now().checked_sub(Duration::from_secs(60)).unwrap_or_else(Instant::now);
    for line in [r#"{"type":"system","subtype":"init","session_id":"s-now"}"#, r#"{"type":"rate_limit_event"}"#, r#"{"type":"result","subtype":"success","is_error":false}"#] {
        let ev = parse_line(line).unwrap();
        inner.last_active = long_ago;
        inner.heard(1, &ev);
        assert_eq!(inner.last_active, long_ago, "a stale line is not activity: {line}");
        inner.heard(2, &ev);
        assert!(inner.last_active.elapsed() < Duration::from_secs(5), "a current line is: {line}");
    }
}

// Review P2 (2026-11-23): a long silent tool call (a cargo build) is a busy turn that writes nothing for
// a while; the short idle sleep must not cut it off, only the much longer busy one.
#[test]
fn a_silent_busy_process_outlives_the_short_idle_sleep() {
    let h = harness_busy(Duration::from_millis(200), BUSY_IDLE_SLEEP, STOP_GRACE);
    h.start("i2", &[]);
    h.engines.send("i2", "queue a long build", &[]).unwrap();
    h.wait("i2", 1, |e| said(e, "queueing"));
    std::thread::sleep(Duration::from_millis(1500));
    let slept = h.seen.lock().unwrap().iter().any(|(id, e)| id == "i2" && is_exit(e, ExitReason::Sleep));
    assert!(!slept, "a busy turn silent past the short idle sleep was cut off");
    let engine = h.engines.engine("i2").unwrap();
    assert!(engine.is_running() && lock(&engine.inner).busy, "the turn is still running");
    h.engines.close_all();
}

// Review P2-1 (2026-11-23): Stop cancels what was queued behind the stopped turn (cancel_queued), but a
// message sent after the Stop is new and runs. Only what was outstanding at the Stop is dropped, so the
// chat stays busy until the later message's own result, and no handoff fires before it.
#[test]
fn a_message_sent_after_stop_keeps_the_chat_busy_until_its_result() {
    let h = harness(IDLE_SLEEP, Duration::from_secs(3));
    let mut spec = h.spec(&[]);
    spec.handoff_at = 1_000;
    h.engines.start("p1", spec, None, h.sink()).unwrap();
    h.engines.send("p1", "queue first [big]", &[]).unwrap();
    h.wait("p1", 1, |e| said(e, "queueing"));
    h.engines.send("p1", "second", &[]).unwrap();
    let how = std::thread::scope(|s| {
        let stopping = s.spawn(|| h.engines.stop("p1").unwrap());
        // The stub ends the interrupted turn 300 ms after the interrupt; this lands inside that wait.
        std::thread::sleep(Duration::from_millis(100));
        h.engines.send("p1", "late after", &[]).unwrap();
        stopping.join().unwrap()
    });
    assert_eq!(how, Some(StopHow::Interrupt));
    let engine = h.engines.engine("p1").unwrap();
    assert!(lock(&engine.inner).busy, "the message sent after Stop is still running");
    assert!(first_at(&h, "p1", |e| matches!(e, ChatEvent::Handoff { .. })).is_none(), "no handoff before its result");
    h.wait("p1", 1, |e| matches!(e, ChatEvent::Handoff { .. }));
    let echo = first_at(&h, "p1", |e| said(e, "echo:  after")).expect("the message sent after Stop was answered");
    let handoff = first_at(&h, "p1", |e| matches!(e, ChatEvent::Handoff { .. })).unwrap();
    assert!(echo < handoff, "its answer comes before the handoff");
    assert!(first_at(&h, "p1", |e| said(e, "echo: second")).is_none(), "the message queued before Stop was cancelled");
    h.engines.close_all();
}

// Review P2-2 (2026-11-23): a reply with nothing outstanding is a turn the engine did not count; the
// chat is busy again until that turn's result, but not while a Stop waits for its own result.
#[test]
fn a_reply_with_nothing_outstanding_makes_the_chat_busy_again() {
    let reply = parse_line(r#"{"type":"assistant","parent_tool_use_id":null,"message":{"id":"m1","content":[{"type":"text","text":"hi"}]}}"#).unwrap();
    let result = parse_line(r#"{"type":"result","subtype":"success","is_error":false}"#).unwrap();
    let mut inner = stale_inner();
    inner.outstanding = 0;
    inner.busy = false;
    inner.heard(1, &reply);
    assert!(!inner.busy && inner.outstanding == 0, "a stale reply re-arms nothing");
    inner.heard(2, &reply);
    assert!(inner.busy && inner.outstanding == 1, "a current reply re-arms the chat");
    inner.heard(2, &result);
    assert!(!inner.busy && inner.outstanding == 0, "its result ends it");
    inner.stop_mark = Some(0);
    inner.heard(2, &reply);
    assert!(!inner.busy && inner.outstanding == 0, "not while a Stop waits");
}

// Review P3-1 (2026-11-23): every exit names its process, so the page can tell a late exit of a
// replaced process from the exit of the one it runs now.
#[test]
fn an_exit_names_the_process_that_ended() {
    let h = harness(IDLE_SLEEP, STOP_GRACE);
    h.start("x1", &[]);
    let started = h.wait("x1", 1, |e| matches!(e, ChatEvent::Started { .. }));
    let ChatEvent::Started { pid, .. } = started[0] else { unreachable!() };
    h.engines.close("x1");
    let exits = h.wait("x1", 1, |e| matches!(e, ChatEvent::Exit { .. }));
    assert!(matches!(exits[0], ChatEvent::Exit { pid: p, .. } if p == pid), "{exits:?} names pid {pid}");
}
