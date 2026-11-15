//! ORCH-060: the session tab inventory. One authoritative list of the session tabs that are open,
//! each with the agent Kolux started in it and where the window shows it, published by the
//! runtime through one call (`session_tabs`) so the command line, the agents' runtime calls and
//! the app read the same list instead of each composing its own.
//!
//! The list is the live session set (a tab exists while its session does) joined with the
//! window's latest placement report: a window row for a session that has closed adds nothing,
//! and a session the window has not placed yet is listed with no placement.
// ponytail: the command line's terminal list, its worktree list and its peer list still compose
// their own rows from the same two sources; switching them onto `tabs` is the cli lane's hunk in
// the T-262 handoff (they live in cli.rs, which this lane does not edit).

use serde::Serialize;
use serde_json::Value;

use crate::terminal::Terminals;

/// Where the window shows a tab: its pane (a cell of its worktree's grid, counted from 1), its tab
/// inside that pane (counted from 1), and whether it is the one in view.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub pane: u64,
    pub tab: u64,
    pub shown: bool,
}

/// One session tab.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    /// The terminal handle (`term-<n>`).
    pub handle: String,
    /// The agent in the tab: the one Kolux started, else the one the foreground poll found in front
    /// of the shell (none for a plain shell; a tab title plays no part).
    pub agent: Option<&'static str>,
    /// The program line Kolux started, when it started one.
    pub program: Option<String>,
    /// The folder the session was started in.
    pub cwd: Option<String>,
    /// The name the tab shows.
    pub title: Option<String>,
    /// Where the window shows it, once the window has reported it.
    pub placement: Option<Placement>,
}

/// The agent a program line was credited to, quoted or not.
fn agent_of(program: Option<&str>) -> Option<&'static str> {
    crate::tools::credited_program(program?)
}

/// Joins the live sessions (handle, start folder, program, in handle order) with the window's
/// placement rows.
pub fn compose(sessions: Vec<(String, Option<String>, Option<String>)>, layout: &[Value]) -> Vec<Tab> {
    compose_with(sessions, layout, crate::foreground::found)
}

/// `compose`, with `found` answering the agent in front of a shell terminal by id. B-01: an agent
/// typed into a shell pane (how every agent pane starts) has no program line to credit, so the
/// foreground poll's answer stands in, the same rule as `Terminals::program`.
fn compose_with(sessions: Vec<(String, Option<String>, Option<String>)>, layout: &[Value], found: impl Fn(u32) -> Option<&'static str>) -> Vec<Tab> {
    sessions
        .into_iter()
        .map(|(handle, cwd, program)| {
            let at = layout.iter().find(|r| r["handle"] == handle.as_str());
            let placement = at.and_then(|r| Some(Placement { pane: r["cell"].as_u64()?, tab: r["tab"].as_u64()?, shown: r["shown"].as_bool().unwrap_or(false) }));
            let title = at.and_then(|r| r["title"].as_str()).map(str::to_string);
            let agent = agent_of(program.as_deref()).or_else(|| handle.strip_prefix("term-")?.parse().ok().and_then(&found));
            Tab { agent, handle, program, cwd, title, placement }
        })
        .collect()
}

/// The inventory as the runtime holds it right now.
pub fn tabs(terminals: &Terminals) -> Vec<Tab> {
    compose(terminals.every(), &terminals.layout())
}

/// The program's own name from a program line, quoted or not: no folder, no executable extension
/// and none of the arguments (which may carry a key or a token).
pub fn program_name(line: &str) -> Option<String> {
    let line = line.trim();
    let first = match line.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or_default(),
        None => line.split_whitespace().next().unwrap_or_default(),
    };
    let base = first.rsplit(['/', '\\']).next().unwrap_or_default();
    let stem = match base.rsplit_once('.') {
        Some((stem, ext)) if ["exe", "cmd", "bat", "com", "ps1"].contains(&ext.to_ascii_lowercase().as_str()) => stem,
        _ => base,
    };
    (!stem.is_empty()).then(|| stem.to_string())
}

/// T-279-c (MERGE 41 review): the inventory as served to agents over the runtime socket: each
/// tab's program line is cut to the program's name, so a key or token on a command line never
/// leaves the app; the agent credit is worked out before the cut, so it is unchanged.
pub fn for_socket(tabs: Vec<Tab>) -> Vec<Tab> {
    tabs.into_iter().map(|t| Tab { program: t.program.as_deref().and_then(program_name), ..t }).collect()
}

/// The inventory for the runtime socket right now (see `for_socket`).
// Row 256: the CLI's terminal list and its worktree terminal rows are served from this, never `tabs`.
pub fn tabs_for_socket(terminals: &Terminals) -> Vec<Tab> {
    for_socket(tabs(terminals))
}

/// ORCH-060: the session tab inventory, for the app and for anything that asks the runtime.
#[tauri::command]
pub fn session_tabs(terminals: tauri::State<'_, Terminals>) -> Vec<Tab> {
    tabs(&terminals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A placement row exactly as the window sends it (App.tsx `reportLayout`).
    fn row(handle: &str, cell: u64, tab: u64, title: &str, shown: bool) -> Value {
        json!({ "handle": handle, "dir": "C:/w/a", "cell": cell, "tab": tab, "title": title, "custom": null, "shown": shown, "ask": null })
    }

    fn session(handle: &str, program: Option<&str>) -> (String, Option<String>, Option<String>) {
        (handle.to_string(), Some("C:/w/a".to_string()), program.map(str::to_string))
    }

    #[test]
    fn orch060_open_three_tabs_lists_three_and_closing_one_lists_two() {
        let mut sessions = vec![session("term-1", None), session("term-2", Some("claude --permission-mode auto")), session("term-3", None)];
        let mut layout = vec![row("term-1", 1, 1, "pwsh", false), row("term-2", 1, 2, "Claude", true), row("term-3", 2, 1, "pwsh", true)];
        let three = compose(sessions.clone(), &layout);
        assert_eq!(three.len(), 3);
        assert_eq!(three.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-2", "term-3"]);
        assert_eq!((three[1].agent, three[0].agent), (Some("claude"), None), "the agent comes from the program Kolux started, a shell has none");
        assert_eq!(three[1].placement, Some(Placement { pane: 1, tab: 2, shown: true }));
        assert_eq!(three[2].placement, Some(Placement { pane: 2, tab: 1, shown: true }));

        // Close term-2: its session ends and the window stops reporting it.
        sessions.remove(1);
        layout.remove(1);
        let two = compose(sessions, &layout);
        assert_eq!(two.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-3"]);
    }

    #[test]
    fn orch060_the_live_sessions_decide_what_is_listed_not_a_stale_window_report() {
        // The window still reports term-2, but its session has already closed: not listed.
        let layout = vec![row("term-1", 1, 1, "pwsh", true), row("term-2", 1, 2, "old", false)];
        let tabs = compose(vec![session("term-1", None), session("term-4", None)], &layout);
        assert_eq!(tabs.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-4"]);
        assert_eq!(tabs[1].placement, None, "a session the window has not placed yet has no placement");
        // A request the window could not open (no handle) is never a tab.
        assert!(compose(vec![], &[json!({ "ask": "a1", "error": "no folder" })]).is_empty());
        // Through the runtime's own state: no session open, whatever the window last said.
        let t = Terminals::default();
        t.set_layout(layout);
        assert!(super::tabs(&t).is_empty());
    }

    #[test]
    fn orch060_an_agent_started_from_a_quoted_path_is_credited() {
        let tabs = compose(vec![session("term-1", Some(r#""C:\Program Files\nodejs\codex.cmd" --sandbox workspace-write"#)), session("term-2", Some("  "))], &[]);
        assert_eq!((tabs[0].agent, tabs[1].agent), (Some("codex"), None));
    }

    /// launch FIX-4: the inventory, the account variables and the window credit a program one way.
    #[test]
    fn fix4_a_bare_path_with_a_space_is_credited_like_the_account_callers_do() {
        let tabs = compose(vec![session("term-1", Some(r"C:\Program Files\Claude\claude.exe")), session("term-2", Some("claude --x"))], &[]);
        assert_eq!((tabs[0].agent, tabs[1].agent), (Some("claude"), Some("claude")));
    }

    /// B-01 (wave 2026-11-15): an agent typed into a shell pane (how every agent pane starts) is
    /// credited from the foreground poll, as `Terminals::program` does; a program Kolux started
    /// still wins, and a shell with nothing in front stays a shell.
    #[test]
    fn b01_an_agent_typed_into_a_shell_is_credited_from_the_foreground_poll() {
        // The poll's answers, faked: `foreground::note` keeps one shared map that other tests prune.
        let found = |id: u32| match id {
            7 => Some("claude"),
            8 => Some("codex"),
            _ => None,
        };
        let sessions = vec![
            session("term-7", Some(r"C:\Program Files\PowerShell\7\pwsh.exe")),
            session("term-8", Some("codex --sandbox workspace-write")),
            session("term-9", Some("pwsh.exe")),
        ];
        let tabs = compose_with(sessions, &[], found);
        assert_eq!(tabs[0].agent, Some("claude"), "the shell pane's agent comes from the foreground poll");
        assert_eq!(tabs[1].agent, Some("codex"), "a program Kolux started is credited first");
        assert_eq!(tabs[2].agent, None, "a shell with nothing in front stays a shell");
        assert_eq!(for_socket(tabs)[0].agent, Some("claude"), "the socket list keeps the credit");
    }

    /// T-279-c: over the runtime socket a tab's program line is only the program's name; the
    /// app's own list keeps the whole line.
    #[test]
    fn t279c_the_socket_inventory_carries_the_program_name_and_no_arguments() {
        let sessions = vec![
            session("term-1", Some(r#""C:\Program Files\nodejs\codex.cmd" --api-key sk-secret-1"#)),
            session("term-2", Some("claude --permission-mode auto --token tok-secret-2")),
            session("term-3", Some("C:/tools/aider.EXE --openai-api-key k-3")),
            session("term-4", Some("  ")),
            session("term-5", None),
        ];
        let full = compose(sessions, &[]);
        assert!(full[0].program.as_deref().is_some_and(|p| p.contains("sk-secret-1")), "the app's list keeps the line");
        let out = for_socket(full.clone());
        let programs: Vec<Option<&str>> = out.iter().map(|t| t.program.as_deref()).collect();
        assert_eq!(programs, [Some("codex"), Some("claude"), Some("aider"), None, None]);
        assert_eq!(out.iter().map(|t| t.agent).collect::<Vec<_>>(), full.iter().map(|t| t.agent).collect::<Vec<_>>(), "the agent credit is unchanged");
        let wire = serde_json::to_string(&out).unwrap();
        assert!(!wire.contains("secret") && !wire.contains("k-3"), "{wire}");
        assert_eq!(program_name("pwsh.exe -NoLogo"), Some("pwsh".to_string()));
        assert_eq!(program_name("./run.sh --x"), Some("run.sh".to_string()));
        assert!(super::tabs_for_socket(&Terminals::default()).is_empty());
    }
}
