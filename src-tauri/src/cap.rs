//! USAGE-006: Claude and Codex panes are held to a 200k context window unless the user switched
//! the cap off in Settings > Agents. Nothing is written to the agents' own files: Claude Code gets
//! the window as an environment variable, Codex as two per-run config overrides.

use serde_json::Value;

/// The setting; never saved means on.
pub const FIELD: &str = "contextCap200k";
/// Claude Code compacts once the context reaches this many tokens.
pub const CLAUDE_ENV: &str = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const WINDOW: &str = "200000";
/// Codex: the window it is told it has, and where it compacts (COMPAT 5.7).
const CODEX_OVERRIDES: [&str; 2] = ["model_context_window=200000", "model_auto_compact_token_limit=180000"];

pub fn on(settings: &Value) -> bool {
    settings.get(FIELD) != Some(&Value::Bool(false))
}

/// Whether Kolux's own environment already names Claude's variable, in any letter case.
pub fn env_set() -> bool {
    std::env::vars_os().any(|(k, _)| k.to_string_lossy().eq_ignore_ascii_case(CLAUDE_ENV))
}

/// Adds the cap to a Claude or Codex start. Claude: the variable, unless the environment
/// (`env_set`) or an explicit `--autocompact` already decides. Codex: `-c key=value` twice, before
/// any `--`, unless the user's arguments already name either key, a profile or OSS mode. Nothing
/// else is touched, and a second pass adds nothing.
pub fn apply(program: Option<&str>, args: &mut Vec<String>, env: &mut Vec<(String, String)>, env_set: bool) {
    match program.and_then(crate::tools::credited_program) {
        // Txais (2026-11-21): OpenClaude is Claude Code's CLI under another name, so it is held to the
        // same window. A build that does not know the variable simply ignores it.
        Some("claude") | Some("openclaude") => {
            let explicit = args.iter().any(|a| a == "--autocompact" || a.starts_with("--autocompact="));
            if !env_set && !explicit {
                env.push((CLAUDE_ENV.to_string(), WINDOW.to_string()));
            }
        }
        Some("codex") => {
            let own = args.iter().any(|a| {
                a == "--oss"
                    || a == "--profile"
                    || a.starts_with("--profile=")
                    || (a.starts_with("-p") && !a.starts_with("--"))
                    || CODEX_OVERRIDES.iter().any(|o| a.contains(o.split('=').next().unwrap_or(o)))
            });
            if !own {
                let at = args.iter().position(|a| a == "--").unwrap_or(args.len());
                let add: Vec<String> = CODEX_OVERRIDES.iter().flat_map(|o| ["-c".to_string(), o.to_string()]).collect();
                args.splice(at..at, add);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(a: &[&str]) -> Vec<String> {
        a.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn the_cap_is_on_unless_the_setting_says_off() {
        assert!(on(&json!({})));
        assert!(on(&json!({ "contextCap200k": true })));
        assert!(!on(&json!({ "contextCap200k": false })));
    }

    #[test]
    fn claude_gets_the_window_as_a_variable_unless_the_user_already_set_one() {
        let mut env = vec![];
        let mut args = s(&["--permission-mode", "auto"]);
        apply(Some("claude"), &mut args, &mut env, false);
        assert_eq!(env, vec![(CLAUDE_ENV.to_string(), "200000".to_string())]);
        assert_eq!(args, s(&["--permission-mode", "auto"]), "Claude's arguments are untouched");
        let mut env = vec![];
        apply(Some("claude"), &mut args, &mut env, true);
        assert!(env.is_empty(), "the process environment already carries the variable");
        let mut args = s(&["--autocompact=false"]);
        apply(Some("claude"), &mut args, &mut env, false);
        assert!(env.is_empty(), "an explicit compact option wins");
        let mut args = s(&[]);
        apply(Some("C:/Users/t/AppData/Roaming/npm/claude.cmd"), &mut args, &mut env, false);
        assert_eq!(env.len(), 1, "the program is credited by its command line");
    }

    #[test]
    fn codex_gets_two_overrides_before_the_terminator_and_only_once() {
        let mut env = vec![];
        let mut args = s(&["--sandbox", "workspace-write", "--ask-for-approval", "never", "--", "Review"]);
        apply(Some("codex"), &mut args, &mut env, false);
        assert_eq!(args, s(&["--sandbox", "workspace-write", "--ask-for-approval", "never", "-c", "model_context_window=200000", "-c", "model_auto_compact_token_limit=180000", "--", "Review"]));
        assert!(env.is_empty(), "Codex gets no variable");
        let before = args.clone();
        apply(Some("codex"), &mut args, &mut env, false);
        assert_eq!(args, before, "a second pass adds nothing");
        for own in [s(&["-c", "model_context_window=1000000"]), s(&["--config", "model_auto_compact_token_limit=90000"]), s(&["--oss"]), s(&["--profile", "work"]), s(&["-p", "work"]), s(&["-pwork"])] {
            let mut args = own.clone();
            apply(Some("codex"), &mut args, &mut env, false);
            assert_eq!(args, own, "the user's own choice stands: {own:?}");
        }
        let mut args = s(&["--model", "o3"]);
        apply(Some("codex"), &mut args, &mut env, false);
        assert_eq!(args.len(), 6, "with no terminator the overrides go at the end");
        assert_eq!(args[2], "-c");
    }

    #[test]
    fn other_programs_and_shells_are_left_alone() {
        let mut env = vec![];
        for p in [None, Some("gemini"), Some("")] {
            let mut args = s(&["x"]);
            apply(p, &mut args, &mut env, false);
            assert_eq!((args.len(), env.len()), (1, 0));
        }
    }

    // Txais (2026-11-21): OpenClaude runs Claude Code's CLI, so a chat or pane started on it is capped
    // like Claude Code itself.
    #[test]
    fn openclaude_is_capped_the_way_claude_code_is() {
        let mut env = vec![];
        let mut args = s(&["--permission-mode", "bypassPermissions"]);
        apply(Some("openclaude"), &mut args, &mut env, false);
        assert_eq!(env, vec![(CLAUDE_ENV.to_string(), "200000".to_string())]);
        let mut env = vec![];
        apply(Some("openclaude"), &mut args, &mut env, true);
        assert!(env.is_empty(), "the process environment already carries the variable");
    }
}
