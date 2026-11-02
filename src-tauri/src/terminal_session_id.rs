//! SESS-030 (T-066-d): where the session id of an id-only agent comes from. Claude Code and Codex
//! hand theirs over through hook events; the others have a resume form that needs the id
//! (`agents::resume_args`) but no hook, so the id is read from what the agent itself says:
//! 1. its own resume hint ("... copilot --resume=<id>") in the pane's output, which is any agent that prints
//!    the command that brings the conversation back (read at exit, or whenever asked);
//! 2. the output of the agent's own sessions command run in the pane's folder (`SOURCES`), asked by the
//!    window when it writes the layout down (`terminal::terminal_listed_session`, T-066-e).
//!
//! The table below records only what each agent offers; the output shapes the parsers accept are
//! deliberately loose (a UUID-shaped token per line, or a JSON list with an id field), because no
//! agent is installed on the build PC. The live proof (T-066-e) runs each real agent once and
//! tightens a parser if its output differs. The never-twice rule lives in `pick_listed`: an id another
//! pane already holds is skipped.

use crate::agents::{resume_args, safe_session};

/// How an agent's sessions command prints its list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Listing {
    /// One session per line with a UUID-shaped id (an optional prefix such as Amp's `T-` kept); `newest_first` = the order of the lines.
    Lines { newest_first: bool },
    /// A JSON array (or an object holding one) of rows with an id field.
    Json,
}

/// One id-only agent's session-id sources.
pub struct Source {
    pub agent: &'static str,
    /// The agent's own command that lists its sessions for the current folder, as arguments after the program; none when it has none.
    pub list: Option<(&'static [&'static str], Listing)>,
    /// The agent's documented "continue the last session here" form. Recorded only: a restore does not use it
    /// until the live proof shows it never opens a picker and never resumes the same session in two panes.
    pub continue_form: Option<&'static [&'static str]>,
}

const fn src(agent: &'static str, list: Option<(&'static [&'static str], Listing)>, continue_form: Option<&'static [&'static str]>) -> Source {
    Source { agent, list, continue_form }
}

/// The id-only agents of T-066-d (every agent `resume_args` resumes by an id and no hook supplies one for).
pub const SOURCES: &[Source] = &[
    src("copilot", None, None),
    src("cursor", Some((&["ls"], Listing::Lines { newest_first: true })), Some(&["--continue"])),
    src("gemini", Some((&["--list-sessions"], Listing::Lines { newest_first: false })), None),
    src("devin", None, Some(&["-c"])),
    src("droid", None, Some(&["-c"])),
    src("mistral-vibe", None, Some(&["-c"])),
    src("qwen-code", None, Some(&["--continue"])),
    src("hermes", Some((&["sessions", "list"], Listing::Lines { newest_first: true })), Some(&["-c"])),
    src("grok", None, Some(&["-c"])),
    src("antigravity", None, None),
    src("kimi", None, Some(&["--continue"])),
    src("pi", None, Some(&["-c"])),
    src("goose", Some((&["session", "list", "--format", "json"], Listing::Json)), None),
    src("amp", Some((&["threads", "list"], Listing::Lines { newest_first: true })), None),
    src("openclaw", None, None),
];

pub fn source(agent: &str) -> Option<&'static Source> {
    SOURCES.iter().find(|s| s.agent == agent)
}

/// A token that can be a session id and not a word: long enough, with a digit.
fn id_like(t: &str) -> bool {
    t.len() >= 8 && safe_session(t) && t.chars().any(|c| c.is_ascii_digit())
}

/// `8-4-4-4-12` hex, with an optional `T-` style prefix before it.
fn uuid_shaped(t: &str) -> bool {
    let core = t.strip_prefix("T-").unwrap_or(t);
    let parts: Vec<&str> = core.split('-').collect();
    parts.len() == 5 && [8, 4, 4, 4, 12].iter().zip(&parts).all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

const TRIM: &[char] = &['`', '"', '\'', '.', ',', ';', '(', ')', '[', ']', '<', '>', '*'];

/// The id of the last resume hint in `text` (the pane's output as plain text): the agent's own resume
/// form (the one `resume_args` builds) followed by something shaped like an id. None when the
/// agent printed none, so prose such as "to resume this session" never yields an id.
pub fn hint_session(agent: &str, text: &str) -> Option<String> {
    source(agent)?;
    const PROBE: &str = "probe-id-0";
    let form = resume_args(agent, Some(PROBE));
    let split = form.last()?;
    let joined = split == PROBE;
    let glued = split.strip_suffix(PROBE).filter(|p| p.ends_with('='));
    // `--resume=<id>` is one token; `--resume <id>` and `resume <id>` are a run of tokens ending in the id.
    let lead: Vec<&str> = if joined { form[..form.len() - 1].iter().map(String::as_str).collect() } else { Vec::new() };
    let mut found = None;
    for line in text.lines() {
        let toks: Vec<&str> = line.split_whitespace().map(|t| t.trim_matches(TRIM)).collect();
        for (i, t) in toks.iter().enumerate() {
            let id = if let Some(prefix) = glued {
                t.strip_prefix(prefix).map(|x| x.trim_matches(TRIM))
            } else if toks[i..].len() > lead.len() && toks[i..i + lead.len()] == lead[..] {
                Some(toks[i + lead.len()])
            } else {
                None
            };
            if let Some(id) = id.filter(|id| id_like(id)) {
                found = Some(id.to_string());
            }
        }
    }
    found
}

const ID_KEYS: &[&str] = &["id", "session_id", "sessionId", "uuid", "thread_id", "threadId", "conversation_id"];
const FOLDER_KEYS: &[&str] = &["cwd", "working_dir", "workingDir", "working_directory", "directory", "project_path", "projectPath"];
const TIME_KEYS: &[&str] = &["updated_at", "updatedAt", "modified_at", "modifiedAt", "last_active", "lastActive", "created_at", "createdAt"];

fn same_folder(a: &str, b: &str) -> bool {
    let n = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    n(a) == n(b)
}

/// Every session id the sessions command printed, newest first, each with the folder it names when it names one.
fn listed(list: Listing, out: &str) -> Vec<(String, Option<String>)> {
    match list {
        Listing::Lines { newest_first } => {
            let mut ids: Vec<(String, Option<String>)> = out
                .lines()
                .filter_map(|l| l.split_whitespace().map(|t| t.trim_matches(TRIM)).find(|t| uuid_shaped(t)).filter(|t| safe_session(t)).map(|t| (t.to_string(), None)))
                .collect();
            if !newest_first {
                ids.reverse();
            }
            ids
        }
        Listing::Json => {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(out.trim()) else { return Vec::new() };
            let rows = match &v {
                serde_json::Value::Array(a) => a.clone(),
                serde_json::Value::Object(o) => o.values().find_map(|x| x.as_array().cloned()).unwrap_or_default(),
                _ => Vec::new(),
            };
            let key = |r: &serde_json::Value, keys: &[&str]| keys.iter().find_map(|k| r.get(*k)).cloned();
            let text = |x: serde_json::Value| match x {
                serde_json::Value::String(s) => Some(s),
                serde_json::Value::Number(n) => Some(n.to_string()),
                _ => None,
            };
            let mut found: Vec<(Option<String>, usize, String, Option<String>)> = rows
                .iter()
                .enumerate()
                .filter_map(|(i, r)| Some((key(r, TIME_KEYS).and_then(text), i, key(r, ID_KEYS).and_then(text)?, key(r, FOLDER_KEYS).and_then(text))))
                .collect();
            // Newest by its own time stamp (ISO text sorts as time); without one, the later row is the newer.
            found.sort_by(|a, b| (b.0.as_deref(), b.1).cmp(&(a.0.as_deref(), a.1)));
            found.into_iter().filter(|r| safe_session(&r.2)).map(|r| (r.2, r.3)).collect()
        }
    }
}

/// The newest session the agent's sessions command (`out`) lists for `folder` that no other pane
/// holds (`taken`): the never-twice rule. A row that names a different folder is skipped.
pub fn pick_listed(agent: &str, out: &str, folder: &str, taken: &[String]) -> Option<String> {
    let (_, list) = source(agent)?.list?;
    listed(list, out).into_iter().find(|(id, dir)| !taken.contains(id) && dir.as_deref().is_none_or(|d| same_folder(d, folder))).map(|(id, _)| id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID_A: &str = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    const UUID_B: &str = "7d1e4a90-2b3c-4d5e-9f01-a2b3c4d5e6f7";

    #[test]
    fn t066d_every_id_only_agent_has_a_row_and_the_table_matches_what_resume_args_resumes() {
        for s in SOURCES {
            assert!(!resume_args(s.agent, Some("probe-id-0")).is_empty(), "{}: a row needs a resume form that takes an id", s.agent);
            // A continue form is recorded, not used: a restore with no id still starts fresh for these.
            assert!(resume_args(s.agent, None).is_empty(), "{}: no id, no resume", s.agent);
        }
        let ids: Vec<&str> = SOURCES.iter().map(|s| s.agent).collect();
        for want in ["copilot", "cursor", "gemini", "devin", "droid", "mistral-vibe", "qwen-code", "hermes", "grok", "antigravity", "kimi", "pi", "goose", "amp", "openclaw"] {
            assert!(ids.contains(&want), "{want} missing");
        }
        assert_eq!(ids.len(), 15);
        assert!(source("claude").is_none() && source("codex").is_none(), "hooks supply those two");
    }

    #[test]
    fn t066d_an_agents_own_resume_hint_gives_its_id_in_each_resume_form() {
        let sid = "run-2026.10.13-a1b2c3";
        for s in SOURCES {
            let form = resume_args(s.agent, Some(sid)).join(" ");
            let bin = if s.agent == "mistral-vibe" { "vibe" } else { s.agent };
            let text = format!("Thanks for using it.\nResume this session with:\n  {bin} {form}\n");
            assert_eq!(hint_session(s.agent, &text).as_deref(), Some(sid), "{}: {text}", s.agent);
            // Quoted, in backticks and with a full stop after it still read.
            let quoted = format!("To continue run `{bin} {form}`.");
            assert_eq!(hint_session(s.agent, &quoted).as_deref(), Some(sid), "{}: {quoted}", s.agent);
        }
    }

    #[test]
    fn t066d_the_last_hint_wins_and_prose_or_the_wrong_form_gives_nothing() {
        let text = format!("copilot --resume={UUID_A}\nmore output\ncopilot --resume={UUID_B}\n");
        assert_eq!(hint_session("copilot", &text).as_deref(), Some(UUID_B));
        assert_eq!(hint_session("openclaw", "To resume this session later, run it again.\nresume the work in progress"), None, "prose after the word resume is not an id");
        assert_eq!(hint_session("gemini", "gemini --resume latest"), None, "a word, not an id");
        assert_eq!(hint_session("gemini", "gemini --resume ../../x1234567"), None, "a path is not an id");
        assert_eq!(hint_session("copilot", "copilot --resume"), None);
        assert_eq!(hint_session("claude", &format!("claude --resume {UUID_A}")), None, "claude has hooks, not a row");
        assert_eq!(hint_session("amp", "amp threads continue T-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b").as_deref(), Some("T-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"));
    }

    #[test]
    fn t066d_a_sessions_list_gives_the_newest_id_for_the_folder_and_never_one_a_pane_holds() {
        // Gemini CLI lists oldest first: the last line is the newest.
        let gemini = format!("Available sessions for this project (2):\n  1. Fix the build (2 days ago) [{UUID_A}]\n  2. Add tests (3 minutes ago) [{UUID_B}]\n");
        assert_eq!(pick_listed("gemini", &gemini, "C:/w/a", &[]).as_deref(), Some(UUID_B));
        assert_eq!(pick_listed("gemini", &gemini, "C:/w/a", &[UUID_B.to_string()]).as_deref(), Some(UUID_A), "the next newest when a pane holds the newest");
        assert_eq!(pick_listed("gemini", &gemini, "C:/w/a", &[UUID_A.to_string(), UUID_B.to_string()]), None);
        // Amp lists newest first, each id with its T- prefix.
        let amp = format!("Title            Last Updated  Messages  Thread\nFix the build    1m ago        12        T-{UUID_A}\nOlder            2d ago        4         T-{UUID_B}\n");
        assert_eq!(pick_listed("amp", &amp, "C:/w/a", &[]).as_deref(), Some(format!("T-{UUID_A}").as_str()));
        assert_eq!(pick_listed("copilot", &gemini, "C:/w/a", &[]), None, "no sessions command, no list source");
        assert_eq!(pick_listed("gemini", "No sessions found.", "C:/w/a", &[]), None);
    }

    #[test]
    fn t066d_a_json_sessions_list_is_ordered_by_time_and_filtered_by_folder() {
        let rows = r#"{"sessions":[
            {"id":"20261013_090000_a1","working_dir":"C:\\w\\other","updated_at":"2026-10-13T12:00:00Z"},
            {"id":"20261013_080000_b2","working_dir":"c:/w/a/","updated_at":"2026-10-13T08:30:00Z"},
            {"id":"20261012_070000_c3","working_dir":"C:/w/a","updated_at":"2026-10-12T07:30:00Z"}]}"#;
        assert_eq!(pick_listed("goose", rows, "C:/w/a", &[]).as_deref(), Some("20261013_080000_b2"), "the other folder's newer row is skipped");
        assert_eq!(pick_listed("goose", rows, "C:/w/a", &["20261013_080000_b2".into()]).as_deref(), Some("20261012_070000_c3"));
        // Rows with no folder key are taken as the folder's own; with no time stamp the later row is newer.
        let bare = r#"[{"id":"s-0000001"},{"id":"s-0000002"}]"#;
        assert_eq!(pick_listed("goose", bare, "C:/w/a", &[]).as_deref(), Some("s-0000002"));
        assert_eq!(pick_listed("goose", "not json", "C:/w/a", &[]), None);
        assert_eq!(pick_listed("goose", r#"[{"id":"--dangerous"},{"id":"a b"}]"#, "C:/w/a", &[]), None, "an id that cannot follow a flag is dropped");
    }
}
