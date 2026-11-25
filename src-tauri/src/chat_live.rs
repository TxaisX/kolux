//! T-050-c (VIEW-019): a live agent detected in the pane decides chat or terminal over what the
//! session was launched as. A shell where the user typed `claude` by hand, an orchestrator worker
//! or a typed command (panes with no program of Kolux's own) show chat once an agent is in front;
//! a launch whose program changed (the first one exited, another was typed) follows the new one;
//! an agent that exited hands the pane back to its terminal. The detection itself is the ACCT-050
//! process walk in `foreground.rs`; this module adds the root process to it, the decision, the
//! clock a hand-started transcript is looked for from, and a looser transcript search for a
//! session Kolux did not start (its shell may have moved folders).

use crate::foreground::Front;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// What a pane has in front: the root process itself when it is an agent (a program Kolux started
/// directly, or a shell started as `pwsh -c claude`; the programs an agent starts are its own
/// business), else the first agent on each line of descent under it (an agent typed into a shell;
/// a program that exited leaves the shell in front; another agent typed after it is the one found).
/// Called by `foreground::front` once evidence/chat-T-050-c-foreground.rs.patch is applied.
#[allow(dead_code)]
pub fn front_of(root: u32, table: &[(u32, u32, String)], credit_of: &mut dyn FnMut(u32, &str) -> Option<&'static str>) -> Front {
    if let Some((_, _, name)) = table.iter().find(|(pid, _, _)| *pid == root) {
        if let Some(a) = credit_of(root, name) {
            return Front::Agent(a);
        }
    }
    crate::foreground::front_in(root, table, credit_of)
}

/// The agent the chat goes by: the one detected in front, else the launch record (the poll has
/// not seen the pane yet, the program itself is the root and only its descendants were walked,
/// or two agents are in front and the answer is unclear). Nothing detected and nothing launched
/// is a plain shell.
pub fn decide(detected: Front, launched: Option<&'static str>) -> Option<&'static str> {
    detected.agent().or(launched)
}

/// Slack behind the moment an agent was first seen, for a transcript it opened before the poll
/// noticed it (the poll runs every 2 s; the Agents screen may have been closed for longer).
const SEEN_SLACK: Duration = Duration::from_secs(600);

/// When each terminal's agent was first seen in front: (agent, moment).
static SEEN: Mutex<Option<HashMap<u32, (&'static str, SystemTime)>>> = Mutex::new(None);

/// The moment a hand-started transcript is looked for from: when `agent` was first seen in front
/// of terminal `id`, less the slack. The same agent keeps its clock; another agent, or the same
/// one after it was gone, starts a new one. `now` is the first sighting when `noted` never ran.
pub fn seen_since(id: u32, agent: &'static str, now: SystemTime) -> SystemTime {
    let mut guard = SEEN.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let at = match map.get(&id) {
        Some((a, at)) if *a == agent => *at,
        _ => {
            map.insert(id, (agent, now));
            now
        }
    };
    at.checked_sub(SEEN_SLACK).unwrap_or(SystemTime::UNIX_EPOCH)
}

/// What the foreground poll saw change in front of terminal `id` (the exact moment, ahead of the
/// chat's first look): an agent starts its clock, nothing in front forgets it. Called by
/// `foreground::poll` on every change it sees.
pub fn noted(id: u32, agent: Option<&'static str>, now: SystemTime) {
    let mut guard = SEEN.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    match agent {
        Some(a) => {
            if map.get(&id).is_none_or(|(b, _)| *b != a) {
                map.insert(id, (a, now));
            }
        }
        None => {
            map.remove(&id);
        }
    }
}

/// Every transcript under `home` the agent could have written since `since`, whatever folder the
/// session runs in: Claude's `projects/<folder>/*.jsonl`, Codex's day folders.
fn any_in(agent: &str, home: &Path, since: SystemTime) -> Option<PathBuf> {
    match agent {
        "claude" => {
            let folders = std::fs::read_dir(home.join("projects")).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir());
            crate::chat::newest(folders.flat_map(|d| crate::chat::jsonl_in(&d).collect::<Vec<_>>()), since)
        }
        "codex" => crate::chat::newest(crate::chat::codex_rollouts(home, since).into_iter(), since),
        "omp" => crate::chat::newest(crate::chat::omp_sessions(home, since).into_iter(), since),
        _ => None,
    }
}

/// CHAT-007 for a session Kolux did not start: its transcript by the documented location for the
/// pane's folder first; when that folder has none written since `since` (the shell moved folders
/// before the agent was typed), the newest one written since then anywhere under the first home
/// that has one.
pub fn find_loose(agent: &str, homes: &[PathBuf], cwd: &str, since: SystemTime) -> Option<PathBuf> {
    crate::chat::find(agent, homes, cwd, since).or_else(|| homes.iter().find_map(|h| any_in(agent, h, since)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;
    use std::fs;

    fn t(rows: &[(u32, u32, &str)]) -> Vec<(u32, u32, String)> {
        rows.iter().map(|(a, b, c)| (*a, *b, c.to_string())).collect()
    }

    /// A fake crediting by program file name (the real one lives in foreground.rs's `credit`).
    fn by_name(_: u32, name: &str) -> Option<&'static str> {
        match name.to_ascii_lowercase().as_str() {
            "claude.exe" => Some("claude"),
            "codex.exe" => Some("codex"),
            _ => None,
        }
    }

    #[test]
    fn t050c_an_agent_typed_into_a_shell_is_in_front_and_the_shell_is_back_once_it_exits() {
        // pwsh 10 -> claude 11 (typed by hand): Claude is in front.
        let typed = t(&[(10, 1, "pwsh.exe"), (11, 10, "claude.exe")]);
        assert_eq!(front_of(10, &typed, &mut by_name), Front::Agent("claude"));
        // claude exited: only the shell is left.
        let exited = t(&[(10, 1, "pwsh.exe")]);
        assert_eq!(front_of(10, &exited, &mut by_name), Front::Shell);
        // The user then typed codex: the launch changed and the new agent is the one found.
        let changed = t(&[(10, 1, "pwsh.exe"), (12, 10, "codex.exe")]);
        assert_eq!(front_of(10, &changed, &mut by_name), Front::Agent("codex"));
        // A process the table does not list (gone between two reads) has nothing in front.
        assert_eq!(front_of(99, &changed, &mut by_name), Front::Shell);
    }

    #[test]
    fn t050c_a_program_kolux_started_is_credited_as_the_root_not_by_its_own_tools() {
        // claude 10 is the pane's own process; it runs codex 11 as a tool: still Claude.
        let own = t(&[(10, 1, "claude.exe"), (11, 10, "codex.exe")]);
        assert_eq!(front_of(10, &own, &mut by_name), Front::Agent("claude"));
        // A shell started as the root with an agent typed under it is the agent (as before).
        let under = t(&[(10, 1, "cmd.exe"), (11, 10, "codex.exe")]);
        assert_eq!(front_of(10, &under, &mut by_name), Front::Agent("codex"));
        // Two agents typed into the pane: unclear, so unknown.
        let two = t(&[(10, 1, "pwsh.exe"), (11, 10, "claude.exe"), (12, 10, "codex.exe")]);
        assert_eq!(front_of(10, &two, &mut by_name), Front::Unknown);
    }

    #[test]
    fn t050c_the_detected_agent_decides_over_the_launch_record() {
        // A shell pane (no launch record): the agent typed into it, or nothing.
        assert_eq!(decide(Front::Agent("claude"), None), Some("claude"), "claude typed into a shell");
        assert_eq!(decide(Front::Shell, None), None, "a plain shell, or the agent exited");
        assert_eq!(decide(Front::Unknown, None), None);
        // A launch whose program changed: the agent found in front wins over the record.
        assert_eq!(decide(Front::Agent("codex"), Some("claude")), Some("codex"));
        // Nothing seen in front yet, or unclear: the launch record stands.
        assert_eq!(decide(Front::Shell, Some("claude")), Some("claude"));
        assert_eq!(decide(Front::Unknown, Some("claude")), Some("claude"));
    }

    #[test]
    fn t050c_a_hand_started_transcript_is_looked_for_from_the_first_sighting_with_slack() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let later = t0 + Duration::from_secs(60);
        assert_eq!(seen_since(900_201, "claude", t0), t0 - SEEN_SLACK, "first sighting, less the slack");
        assert_eq!(seen_since(900_201, "claude", later), t0 - SEEN_SLACK, "the same agent keeps its clock");
        assert_eq!(seen_since(900_201, "codex", later), later - SEEN_SLACK, "another agent starts a new one");
        // The poll's own sighting is the exact moment and comes before the chat's first look.
        let exact = t0 + Duration::from_secs(10);
        noted(900_202, Some("claude"), exact);
        assert_eq!(seen_since(900_202, "claude", later), exact - SEEN_SLACK);
        noted(900_202, Some("claude"), later);
        assert_eq!(seen_since(900_202, "claude", later), exact - SEEN_SLACK, "the same agent seen again keeps its clock");
        // Gone, then back: a new session, a new clock.
        noted(900_202, None, later);
        assert_eq!(seen_since(900_202, "claude", later), later - SEEN_SLACK);
    }

    #[test]
    fn t050c_a_transcript_kolux_did_not_start_is_found_in_the_pane_folder_first_then_anywhere() {
        // A scratch home under the test temp folder: never a real tool home.
        let d = temp("chat-loose");
        let home = d.join("claude-home");
        let since = SystemTime::now() - Duration::from_secs(60);
        let old = SystemTime::now() - Duration::from_secs(3_600);
        let other = home.join("projects").join("C--elsewhere");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("moved.jsonl"), "{}\n").unwrap();
        let homes = vec![home.clone()];
        // The pane's folder has no transcript: the one written elsewhere since the sighting is it.
        assert_eq!(find_loose("claude", &homes, "C:\\work", since), Some(other.join("moved.jsonl")));
        // Written before the sighting: not this session's.
        let f = fs::File::options().write(true).open(other.join("moved.jsonl")).unwrap();
        f.set_modified(old).unwrap();
        drop(f);
        assert_eq!(find_loose("claude", &homes, "C:\\work", since), None);
        // The pane's own folder wins when it has one.
        let own = home.join("projects").join(crate::chat::claude_folder("C:\\work"));
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("here.jsonl"), "{}\n").unwrap();
        fs::write(other.join("newer.jsonl"), "{}\n").unwrap();
        assert_eq!(find_loose("claude", &homes, "C:\\work", since), Some(own.join("here.jsonl")));
        // Codex: a rollout for another folder is found when none names the pane's.
        let codex = d.join("codex-home");
        let day = codex.join("sessions").join("2026").join("10").join("19");
        fs::create_dir_all(&day).unwrap();
        fs::write(day.join("rollout-x.jsonl"), serde_json::json!({ "type": "session_meta", "payload": { "cwd": "C:\\other" } }).to_string() + "\n").unwrap();
        assert_eq!(find_loose("codex", &[codex], "C:\\work", since), Some(day.join("rollout-x.jsonl")));
        assert_eq!(find_loose("aider", &homes, "C:\\work", since), None, "no transcript format to look for");
    }
}
