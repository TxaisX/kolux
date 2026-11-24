//! Tests of the OpenCode backend: the event stream's frames, the translation into chat events, the
//! model and session rows, and one live run (ignored by default) against the real `opencode`.
use super::events::*;
use super::opencode::*;
use super::*;
use serde_json::{json, Value};

const SESSION: &str = "ses_df0ce5469ffeRVOAV45sEAVd3O";
const MODEL: &str = "openrouter/deepseek/deepseek-v4.1-flash-1017";

fn kind(e: &ChatEvent) -> String {
    serde_json::to_value(e).unwrap()["kind"].as_str().unwrap_or_default().to_string()
}

fn kinds(evs: &[ChatEvent]) -> Vec<String> {
    evs.iter().map(kind).collect()
}

/// Feeds events one after another at the same instant; returns everything the page would hear.
fn feed(tr: &mut Translator, events: &[(&str, Value)]) -> Vec<ChatEvent> {
    let now = Instant::now();
    events.iter().flat_map(|(k, d)| tr.on_event(k, d, now)).collect()
}

fn sent(inbox: &str, text: &str) -> (&'static str, Value) {
    ("session.inbox.enqueued", json!({ "sessionID": SESSION, "inboxID": inbox, "item": { "type": "user", "payload": { "text": text }, "delivery": "steer" } }))
}

fn blocks_of(e: &ChatEvent) -> Vec<Block> {
    match e {
        ChatEvent::Assistant { blocks, .. } => blocks.clone(),
        _ => Vec::new(),
    }
}

#[test]
fn the_chat_agents_are_claude_code_and_opencode() {
    assert_eq!(CHAT_AGENTS, ["claude", "opencode"]);
    assert_eq!(AGENT, "opencode");
    assert_eq!(STREAM_AGENTS, ["claude"], "only Claude Code is run as a hidden stream-json process");
}

#[test]
fn an_opencode_session_id_passes_and_a_path_does_not() {
    assert!(opencode::valid_session(SESSION));
    assert!(!opencode::valid_session("ses_1/../x"));
    assert!(!opencode::valid_session(""));
    assert!(opencode::valid_effort("xhigh") && opencode::valid_effort("none"));
    assert!(!opencode::valid_effort("hi there"));
}

#[test]
fn a_listed_model_id_splits_into_provider_and_model() {
    assert_eq!(model_ref(MODEL, None).unwrap(), json!({ "id": "deepseek/deepseek-v4.1-flash-1017", "providerID": "openrouter" }));
    assert_eq!(model_ref("opencode/big-pickle", Some("high")).unwrap(), json!({ "id": "big-pickle", "providerID": "opencode", "variant": "high" }));
    assert!(model_ref("opus", None).is_err(), "a bare name is not an id OpenCode lists");
}

#[test]
fn the_model_list_becomes_rows_with_the_printed_id_and_the_efforts() {
    let list = json!({ "data": [
        { "id": "anthropic/claude-opus-5.5", "providerID": "openrouter", "name": "Claude Opus 5.5", "variants": [{ "id": "low" }, { "id": "max" }] },
        { "id": "big-pickle", "providerID": "opencode", "name": "", "variants": [] },
        { "id": "off/one", "providerID": "openrouter", "name": "Off", "enabled": false },
    ] });
    let rows = model_rows(&list);
    assert_eq!(rows.len(), 2, "a model that is turned off is left out: {rows:?}");
    assert_eq!(rows[0], ModelRow { id: "openrouter/anthropic/claude-opus-5.5".into(), label: "Claude Opus 5.5".into(), provider: "anthropic".into(), efforts: vec!["low".into(), "max".into()] });
    assert_eq!(rows[1], ModelRow { id: "opencode/big-pickle".into(), label: "big-pickle".into(), provider: "opencode".into(), efforts: vec![] });
    assert_eq!(serde_json::to_value(&rows[0]).unwrap(), json!({ "id": "openrouter/anthropic/claude-opus-5.5", "label": "Claude Opus 5.5", "provider": "anthropic", "efforts": ["low", "max"] }));
}

#[test]
fn the_session_list_becomes_rows_without_a_subagents_own_sessions() {
    let list = json!({ "data": [
        { "id": "ses_a", "title": "Fix the build", "time": { "created": 5, "updated": 9 } },
        { "id": "ses_child", "title": "sub", "parentID": "ses_a", "time": { "created": 6, "updated": 8 } },
        { "id": "ses_b", "time": { "created": 3 } },
    ] });
    let rows = session_rows(&list);
    assert_eq!(rows, vec![SessionRow { id: "ses_a".into(), title: "Fix the build".into(), updated_at: 9 }, SessionRow { id: "ses_b".into(), title: "New chat".into(), updated_at: 3 }]);
    assert_eq!(serde_json::to_value(&rows[0]).unwrap(), json!({ "id": "ses_a", "title": "Fix the build", "updatedAt": 9 }));
}

#[test]
fn the_event_stream_is_cut_into_events_across_chunks() {
    let mut f = Frames::default();
    assert!(f.feed(b": heartbeat\n\n").is_empty(), "a comment frame is nothing");
    assert!(f.feed(b"data: {\"id\":\"1\",\"type\":\"session.text.delta\",\"da").is_empty(), "half a frame waits");
    let got = f.feed(b"ta\":{\"sessionID\":\"s\",\"delta\":\"ok\"}}\r\n\r\ndata: {\"type\":\"server.connected\",\"data\":{}}\n\n");
    assert_eq!(got, vec![("session.text.delta".to_string(), json!({ "sessionID": "s", "delta": "ok" })), ("server.connected".to_string(), json!({}))]);
    assert!(f.feed(b"data: not json\n\n").is_empty(), "a frame that is not JSON is dropped");
}

#[test]
fn a_plain_turn_is_an_echo_the_growing_reply_and_one_result() {
    let mut tr = Translator::new(SESSION);
    let evs = feed(
        &mut tr,
        &[
            sent("msg_1", "Reply with the word ok"),
            ("session.execution.started", json!({ "sessionID": SESSION })),
            ("session.instructions.updated", json!({ "sessionID": SESSION })),
            ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_1" })),
            ("session.step.started", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "model": { "id": "deepseek/deepseek-v4.1-flash-1017", "providerID": "openrouter" } })),
            ("session.text.started", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0 })),
            ("session.text.delta", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "delta": "o" })),
            ("session.text.delta", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "delta": "k" })),
            ("session.text.ended", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "text": "ok" })),
            ("session.step.ended", json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "finish": "stop", "cost": 0.0035, "tokens": { "input": 10, "output": 2, "reasoning": 0, "cache": { "read": 5, "write": 1 } } })),
            ("session.execution.succeeded", json!({ "sessionID": SESSION })),
        ],
    );
    // The second delta lands inside the stream's pause, so it is not sent on its own.
    assert_eq!(kinds(&evs), ["raw", "user", "assistant", "assistant", "assistant", "result"]);
    assert_eq!(evs[1], ChatEvent::User { parent_tool_use_id: None, text: vec!["Reply with the word ok".into()], tool_results: vec![] }, "the echo that confirms the send");
    assert_eq!(blocks_of(&evs[2]), vec![Block::Text { text: "o".into() }], "the reply is drawn while it is written");
    assert_eq!(blocks_of(&evs[3]), vec![Block::Text { text: "ok".into() }]);
    let ChatEvent::Assistant { message_id, model, usage, session_id, .. } = &evs[4] else { panic!("{:?}", evs[4]) };
    assert_eq!(message_id.as_deref(), Some("msg_a"), "one message id, so each send replaces the row before it");
    assert_eq!(model.as_deref(), Some(MODEL));
    assert_eq!(session_id.as_deref(), Some(SESSION));
    assert_eq!(usage.clone().unwrap(), json!({ "input_tokens": 10, "cache_read_input_tokens": 5, "cache_creation_input_tokens": 1, "output_tokens": 2, "reasoning_tokens": 0 }));
    let ChatEvent::Result(r) = &evs[5] else { panic!("{:?}", evs[5]) };
    assert_eq!((r.subtype.as_str(), r.is_error, r.result.as_deref(), r.session_id.as_deref()), ("success", false, Some("ok"), Some(SESSION)));
    assert_eq!(r.total_cost_usd, Some(0.0035));
    assert!(!tr.busy(), "the turn is over");
}

#[test]
fn thinking_text_and_a_tool_call_keep_their_places_in_one_message() {
    let mut tr = Translator::new(SESSION);
    let at = |k: &str, extra: Value| {
        let mut d = json!({ "sessionID": SESSION, "assistantMessageID": "msg_a" });
        for (key, v) in extra.as_object().unwrap() {
            d[key] = v.clone();
        }
        (k.to_string(), d)
    };
    let events = [
        at("session.execution.started", json!({})),
        at("session.step.started", json!({ "model": { "id": "x/y", "providerID": "openrouter" } })),
        at("session.reasoning.started", json!({ "ordinal": 0 })),
        at("session.text.started", json!({ "ordinal": 0 })),
        // The text block ends before the thinking that began first: both keep the place they began in.
        at("session.text.ended", json!({ "ordinal": 0, "text": "Listing the folder." })),
        at("session.reasoning.ended", json!({ "ordinal": 0, "text": "The user wants a listing." })),
        at("session.tool.input.started", json!({ "id": "call_1", "name": "shell" })),
        at("session.tool.input.delta", json!({ "id": "call_1", "delta": "{\"comm" })),
        at("session.tool.called", json!({ "id": "call_1", "input": { "command": "dir" } })),
        at("session.tool.progress", json!({ "id": "call_1" })),
        at("session.tool.success", json!({ "id": "call_1", "content": [{ "type": "text", "text": "a.txt" }, { "type": "text", "text": "b.txt" }] })),
    ];
    let now = Instant::now();
    let evs: Vec<ChatEvent> = events.iter().flat_map(|(k, d)| tr.on_event(k, d, now)).collect();
    assert_eq!(kinds(&evs), ["assistant", "assistant", "assistant", "user"]);
    let last = blocks_of(&evs[2]);
    assert_eq!(last.len(), 3, "{last:?}");
    assert_eq!(last[0], Block::Thinking { text: "The user wants a listing.".into() });
    assert_eq!(last[1], Block::Text { text: "Listing the folder.".into() });
    let Block::ToolUse { id, name, input, step: StepView::Tool { tool } } = &last[2] else { panic!("{:?}", last[2]) };
    assert_eq!((id.as_str(), name.as_str(), input), ("call_1", "shell", &json!({ "command": "dir" })));
    assert_eq!((tool.call.as_str(), tool.group), ("call_1", "shell"), "a shell call is the command row: {tool:?}");
    assert!(tool.preview.contains("dir"), "{tool:?}");
    assert_eq!(evs[3], ChatEvent::User { parent_tool_use_id: None, text: vec![], tool_results: vec![ToolResult { tool_use_id: "call_1".into(), output: "a.txt\nb.txt".into(), is_error: false }] });
    let failed = tr.on_event("session.tool.failed", &json!({ "sessionID": SESSION, "id": "call_2", "error": { "type": "unknown", "message": "No such file" } }), now);
    assert_eq!(failed, vec![ChatEvent::User { parent_tool_use_id: None, text: vec![], tool_results: vec![ToolResult { tool_use_id: "call_2".into(), output: "No such file".into(), is_error: true }] }]);
}

#[test]
fn two_messages_answered_in_one_run_get_one_result_each() {
    let mut tr = Translator::new(SESSION);
    let evs = feed(
        &mut tr,
        &[
            sent("msg_1", "one"),
            sent("msg_2", "two"),
            ("session.execution.started", json!({ "sessionID": SESSION })),
            ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_1" })),
            ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_2" })),
            ("session.execution.succeeded", json!({ "sessionID": SESSION })),
        ],
    );
    assert_eq!(kinds(&evs), ["user", "user", "result", "result"], "the page counts one result per message it sent");
    assert!(!tr.busy());
    assert!(tr.cut(Instant::now()).is_empty(), "a turn that already ended is not ended twice");
}

#[test]
fn a_stop_ends_the_turn_the_way_the_page_marks_as_interrupted() {
    let mut tr = Translator::new(SESSION);
    let evs = feed(
        &mut tr,
        &[
            sent("msg_1", "count to 400"),
            ("session.execution.started", json!({ "sessionID": SESSION })),
            ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_1" })),
            ("session.step.failed", json!({ "sessionID": SESSION, "error": { "type": "aborted", "message": "Step interrupted" } })),
            ("session.execution.interrupted", json!({ "sessionID": SESSION, "reason": "user" })),
        ],
    );
    let ChatEvent::Result(r) = evs.last().unwrap() else { panic!("{evs:?}") };
    assert_eq!((r.subtype.as_str(), r.is_error), ("error_during_execution", true));
    // A stop that got no word from OpenCode in time ends the turn here instead.
    let mut tr = Translator::new(SESSION);
    feed(&mut tr, &[sent("msg_1", "x"), ("session.execution.started", json!({ "sessionID": SESSION })), ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_1" }))]);
    assert!(tr.running());
    assert_eq!(kinds(&tr.cut(Instant::now())), ["result"]);
    assert!(!tr.busy());
}

#[test]
fn a_failed_run_says_why() {
    let mut tr = Translator::new(SESSION);
    let evs = feed(
        &mut tr,
        &[
            sent("msg_1", "hello"),
            ("session.execution.started", json!({ "sessionID": SESSION })),
            ("session.inbox.delivered", json!({ "sessionID": SESSION, "inboxID": "msg_1" })),
            ("session.retry.scheduled", json!({ "sessionID": SESSION, "attempt": 2, "error": { "message": "Rate limited" } })),
            ("session.step.failed", json!({ "sessionID": SESSION, "error": { "type": "provider", "message": "No credit left" } })),
            ("session.execution.failed", json!({ "sessionID": SESSION })),
        ],
    );
    assert_eq!(kinds(&evs), ["user", "apiRetry", "result"]);
    assert_eq!(evs[1], ChatEvent::ApiRetry { attempt: Some(2), max_retries: None, retry_delay_ms: None, error_status: None, error: Some("Rate limited".into()) });
    let ChatEvent::Result(r) = &evs[2] else { panic!("{evs:?}") };
    assert_eq!((r.subtype.as_str(), r.is_error, r.errors.clone()), ("provider", true, vec!["No credit left".to_string()]));
}

#[test]
fn a_saved_conversation_reads_back_with_the_live_row_ids() {
    let messages = [
        json!({ "id": "msg_u", "type": "user", "text": "list it", "time": { "created": 10 } }),
        json!({ "id": "msg_m", "type": "model-switched", "model": {}, "previous": {} }),
        json!({ "id": "msg_a", "type": "assistant", "time": { "created": 11 }, "content": [
            { "type": "reasoning", "text": "thinking" },
            { "type": "text", "text": "Here." },
            { "type": "tool", "id": "call_1", "name": "shell", "state": { "status": "completed", "input": { "command": "dir" }, "content": [{ "type": "text", "text": "a.txt" }] } },
            { "type": "tool", "id": "call_2", "name": "read", "state": { "status": "error", "input": { "path": "x.txt" }, "error": { "type": "unknown", "message": "No such file" } } },
        ] }),
        json!({ "id": "msg_i", "type": "idle", "outcome": "interrupted", "time": { "created": 12 } }),
        json!({ "id": "msg_j", "type": "idle", "outcome": "succeeded" }),
    ];
    let items = history_items(&messages);
    let shape: Vec<(&str, &str, &str)> = items.iter().map(|i| (i.id.as_str(), i.role, i.kind)).collect();
    assert_eq!(shape, [("msg_u", "user", "text"), ("msg_a:000", "assistant", "thought"), ("msg_a:001", "assistant", "text"), ("msg_a:002", "assistant", "tool"), ("msg_a:003", "assistant", "tool"), ("msg_i", "status", "interrupted")]);
    assert_eq!(items[0].at, Some(10));
    let done = items[3].tool.as_ref().unwrap();
    assert_eq!((done.done, done.failed, done.output.as_deref()), (true, false, Some("a.txt")));
    let bad = items[4].tool.as_ref().unwrap();
    assert_eq!((bad.done, bad.failed, bad.output.as_deref()), (true, true, Some("No such file")));
}

#[test]
fn an_opencode_chat_is_checked_before_anything_is_started() {
    let engines = Engines::new(Config::default());
    let sink: Sink = Arc::new(|_: &str, _: &ChatEvent| {});
    let dir = std::env::temp_dir();
    let spec = |model: &str, effort: Option<&str>| Spec { agent: AGENT.to_string(), cwd: dir.clone(), model: Some(model.to_string()), effort: effort.map(String::from), env: Vec::new(), handoff_at: 0, handoff_note: None };
    let e = engines.start("c1", spec(MODEL, None), Some("not a session".to_string()), Arc::clone(&sink)).unwrap_err();
    assert!(e.contains("is not a session id"), "{e}");
    let e = engines.start("c1", spec("opus", None), None, Arc::clone(&sink)).unwrap_err();
    assert!(e.contains("is not a model OpenCode lists"), "{e}");
    let e = engines.start("c1", spec(MODEL, Some("very high")), None, Arc::clone(&sink)).unwrap_err();
    assert!(e.contains("is not an effort level"), "{e}");
    let mut gone = spec(MODEL, None);
    gone.cwd = dir.join("kolux-no-such-folder-for-a-chat");
    assert!(engines.start("c1", gone, None, sink).unwrap_err().contains("does not exist"));
    assert!(!engines.open_server().is_running(), "a refused chat starts no server");
    assert!(engines.send("c1", "hi", &[]).is_err(), "and leaves no chat open");
}

fn wait_for(seen: &Arc<Mutex<Vec<(String, ChatEvent)>>>, id: &str, results: usize) -> Vec<ChatEvent> {
    let end = Instant::now() + Duration::from_secs(180);
    loop {
        let evs: Vec<ChatEvent> = seen.lock().unwrap().iter().filter(|(c, _)| c == id).map(|(_, e)| e.clone()).collect();
        if evs.iter().filter(|e| matches!(e, ChatEvent::Result(_))).count() >= results {
            return evs;
        }
        assert!(Instant::now() < end, "no result in time; heard {:?}", kinds(&evs));
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn reply_text(evs: &[ChatEvent]) -> String {
    let texts = |e: &ChatEvent| blocks_of(e).into_iter().filter_map(|b| if let Block::Text { text } = b { Some(text) } else { None }).collect::<Vec<_>>().join("");
    evs.iter().rev().map(texts).find(|t| !t.is_empty()).unwrap_or_default()
}

/// The live proof: the real `opencode` on PATH and a cheap model. It starts the shared server, runs a
/// turn, switches the effort in place, closes the chat, resumes the same session in a new chat, then
/// reads the saved list and history and deletes the session.
/// `cargo test --manifest-path src-tauri/Cargo.toml --lib opencode_tests::live -- --ignored --nocapture`
#[test]
#[ignore = "talks to the real OpenCode and a paid model; run by hand"]
fn live_a_chat_streams_a_reply_and_resumes() {
    let dir = std::env::temp_dir().join(format!("kolux-opencode-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let seen: Arc<Mutex<Vec<(String, ChatEvent)>>> = Arc::default();
    let sink: Sink = {
        let seen = Arc::clone(&seen);
        Arc::new(move |id: &str, ev: &ChatEvent| seen.lock().unwrap().push((id.to_string(), ev.clone())))
    };
    let engines = Engines::new(Config::default());
    let spec = Spec { agent: AGENT.to_string(), cwd: dir.clone(), model: Some(MODEL.to_string()), effort: None, env: Vec::new(), handoff_at: 0, handoff_note: None };

    engines.start("live1", spec.clone(), None, Arc::clone(&sink)).unwrap();
    let opened = wait_for(&seen, "live1", 0);
    println!("open: {:?}", kinds(&opened));
    let session = opened.iter().find_map(|e| if let ChatEvent::Init(i) = e { Some(i.session_id.clone()) } else { None }).expect("init names the session");
    assert!(session.starts_with("ses_"), "{session}");
    engines.send("live1", "Reply with the word ok", &[]).unwrap();
    let first = wait_for(&seen, "live1", 1);
    println!("turn 1: {:?}", kinds(&first));
    println!("turn 1 reply: {:?}", reply_text(&first));
    let ChatEvent::Result(r) = first.iter().rev().find(|e| matches!(e, ChatEvent::Result(_))).unwrap() else { unreachable!() };
    assert_eq!((r.subtype.as_str(), r.is_error, r.session_id.as_deref()), ("success", false, Some(session.as_str())), "{r:?}");
    assert!(first.iter().any(|e| matches!(e, ChatEvent::User { text, .. } if text == &["Reply with the word ok".to_string()])), "the send is echoed");
    assert!(reply_text(&first).to_lowercase().contains("ok"));

    // A pick between turns: the same chat, the same session, no new process.
    let mut low = spec.clone();
    low.effort = Some("low".to_string());
    engines.start("live1", low, Some(session.clone()), Arc::clone(&sink)).unwrap();
    let after = wait_for(&seen, "live1", 1);
    println!("effort pick: {:?}", kinds(&after[first.len()..]));
    assert_eq!(after.iter().filter(|e| matches!(e, ChatEvent::Started { .. })).count(), 1, "a pick does not start the chat again");
    assert!(matches!(after.last(), Some(ChatEvent::Init(i)) if i.session_id == session && i.effort == Some(json!("low"))), "{:?}", after.last());
    engines.send("live1", "Reply with the word low", &[]).unwrap();
    let second = wait_for(&seen, "live1", 2);
    println!("turn 2 (effort low): {:?}", kinds(&second[after.len()..]));
    println!("turn 2 reply: {:?}", reply_text(&second));
    engines.close("live1");

    engines.start("live2", spec, Some(session.clone()), Arc::clone(&sink)).unwrap();
    engines.send("live2", "Reply with the word again", &[]).unwrap();
    let resumed = wait_for(&seen, "live2", 1);
    println!("resumed: {:?}", kinds(&resumed));
    println!("resumed reply: {:?}", reply_text(&resumed));
    assert!(matches!(&resumed[0], ChatEvent::Started { resumed: Some(s), .. } if s == &session), "{:?}", resumed[0]);
    assert!(resumed.iter().any(|e| matches!(e, ChatEvent::Result(r) if !r.is_error && r.session_id.as_deref() == Some(session.as_str()))));

    let server = engines.open_server();
    let models = server.models(&[]).unwrap();
    println!("models: {} listed; default listed: {}", models.len(), models.iter().any(|m| m.id == MODEL));
    assert!(models.iter().any(|m| m.id == MODEL));
    let sessions = server.sessions(&[], &dir.to_string_lossy()).unwrap();
    println!("sessions of the folder: {:?}", sessions.iter().map(|s| (&s.title, s.updated_at)).collect::<Vec<_>>());
    assert!(sessions.iter().any(|s| s.id == session), "the folder's list has the chat");
    let history = server.history(&[], &session, 200).unwrap();
    let said: Vec<&str> = history.items.iter().filter(|i| i.role == "user").map(|i| i.text.as_str()).collect();
    println!("history: {} rows; user rows {said:?}", history.items.len());
    assert_eq!(said, ["Reply with the word ok", "Reply with the word low", "Reply with the word again"]);
    server.delete(&[], &session).unwrap();
    assert!(server.history(&[], &session, 200).is_err(), "a deleted chat is gone");
    engines.close_all();
    assert!(!server.is_running(), "the server ends with the app");
    let _ = std::fs::remove_dir_all(&dir);
}
