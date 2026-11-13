//! STAT-061 / T-125: what a Grok hook event means for the pane. Grok's own ask-the-user tool runs
//! with no permission step, so the start of that tool is the only signal: it means waiting and
//! carries the question; the end of that same tool means working and drops the question; a failure
//! of the question tool (a cancelled question) means working and never rebuilds the question card;
//! the start of any other tool means working. The events are in the normalized hook shape every
//! vendor is turned into (agent_hooks::vendors::normalize). Routing Grok's hooks here and carrying
//! the question on the status payload is wiring for the status lane (kolux-after.md).
// Nothing calls this until the hook listener routes Grok's events here.
#![allow(dead_code)]

use serde_json::Value;

/// The name parts that mark Grok's ask-the-user tool.
const ASK_MARKS: [&str; 2] = ["ask", "question"];
const QUESTION_MAX: usize = 300;

/// The pane's state after one event, with the question while one is open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub state: &'static str,
    pub question: Option<String>,
}

fn is_ask(tool: &str) -> bool {
    let t = tool.to_ascii_lowercase();
    ASK_MARKS.iter().any(|m| t.contains(m))
}

/// The question text a tool start carries, from the usual input keys, trimmed to a card's length.
fn question_of(event: &Value) -> Option<String> {
    let input = event.get("tool_input")?;
    let text = match input {
        Value::String(s) => Some(s.as_str()),
        Value::Object(o) => ["question", "prompt", "message", "text"].iter().find_map(|k| o.get(*k).and_then(Value::as_str)),
        _ => None,
    }?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(QUESTION_MAX).collect())
}

/// What one normalized Grok tool event means; `None` for an event that moves nothing here.
pub fn change(event: &Value) -> Option<Turn> {
    let name = event.get("hook_event_name").and_then(Value::as_str)?;
    let tool = event.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    let working = Turn { state: "working", question: None };
    Some(match name {
        "PreToolUse" if is_ask(tool) => Turn { state: "waiting", question: question_of(event) },
        "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => working,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stat061_the_ask_tool_starting_means_waiting_with_the_question() {
        let e = json!({ "hook_event_name": "PreToolUse", "tool_name": "ask_user", "tool_input": { "question": "Which branch should I use?", "choices": ["main", "dev"] } });
        assert_eq!(change(&e), Some(Turn { state: "waiting", question: Some("Which branch should I use?".into()) }));
        let plain = json!({ "hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion", "tool_input": "  Deploy now?  " });
        assert_eq!(change(&plain).unwrap().question.as_deref(), Some("Deploy now?"));
        let bare = json!({ "hook_event_name": "PreToolUse", "tool_name": "ask_user" });
        assert_eq!(change(&bare), Some(Turn { state: "waiting", question: None }), "no text still waits");
    }

    #[test]
    fn stat061_answering_cancelling_or_another_tool_means_working_with_no_card() {
        let working = Turn { state: "working", question: None };
        assert_eq!(change(&json!({ "hook_event_name": "PostToolUse", "tool_name": "ask_user", "tool_response": "main" })), Some(working.clone()));
        assert_eq!(change(&json!({ "hook_event_name": "PostToolUseFailure", "tool_name": "ask_user", "error": "cancelled" })), Some(working.clone()));
        assert_eq!(change(&json!({ "hook_event_name": "PreToolUse", "tool_name": "bash", "tool_input": { "command": "ls" } })), Some(working));
        assert_eq!(change(&json!({ "hook_event_name": "Notification" })), None);
    }

    #[test]
    fn stat061_a_long_question_is_cut_to_card_length() {
        let long = "x".repeat(1_000);
        let e = json!({ "hook_event_name": "PreToolUse", "tool_name": "ask_question", "tool_input": { "prompt": long } });
        assert_eq!(change(&e).unwrap().question.unwrap().len(), QUESTION_MAX);
    }
}
