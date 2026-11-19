//! The OpenRouter route: a chat that runs Claude Code through OpenRouter instead of an Anthropic
//! sign-in. This module only builds the environment for that chat's process and names where its
//! config folder lives; the chat engine starts the process.
//!
//! Source for the variable names (read 2026-11-19): OpenRouter's "Claude Code" integration guide,
//! <https://openrouter.ai/docs/guides/coding-agents/claude-code-integration>. It asks for
//! `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<OpenRouter key>` and
//! `ANTHROPIC_API_KEY` set to an explicitly empty value, and names the model variables
//! `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`,
//! `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL`, with values like
//! `~anthropic/claude-opus-latest[1m]`. Setting the Fable variable is the only way to make Fable
//! selectable in `/model` through OpenRouter.
//!
//! The key lives in the secrets vault (a sealed settings field, see `secrets`), under
//! [`KEY_FIELD`]. It is never logged, and nothing here prints an environment.
#![allow(dead_code)] // wired in the chat-app screens stage

use crate::state::Store;
use std::path::{Path, PathBuf};

/// The vault field that holds the OpenRouter key.
/// NOTE for the glue: `secrets::SECRET_SETTINGS` must list this name before `secrets::write_setting`
/// will store it (that list is in `secrets.rs`, outside this lane).
pub const KEY_FIELD: &str = "openrouterApiKey";
/// Where Claude Code is pointed.
pub const BASE_URL: &str = "https://openrouter.ai/api";
/// The route's folder under the profile: `<profile>\providers\openrouter`.
pub const PROVIDERS_FOLDER: &str = "providers";
pub const ROUTE_FOLDER: &str = "openrouter";

/// The model variables and what each is set to: OpenRouter's "latest" aliases, with the 1M
/// context where the guide gives it.
pub const MODEL_VARS: &[(&str, &str)] = &[
    ("ANTHROPIC_DEFAULT_FABLE_MODEL", "~anthropic/claude-fable-latest[1m]"),
    ("ANTHROPIC_DEFAULT_OPUS_MODEL", "~anthropic/claude-opus-latest[1m]"),
    ("ANTHROPIC_DEFAULT_SONNET_MODEL", "~anthropic/claude-sonnet-latest[1m]"),
    ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "~anthropic/claude-haiku-latest"),
    ("CLAUDE_CODE_SUBAGENT_MODEL", "~anthropic/claude-opus-latest[1m]"),
];

/// ACCT-024 (terminal.rs, `spawn_unlogged`) refuses a Claude pane that runs on a managed account
/// when the user's own per-agent settings carry `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or
/// the 1-year key variable, because those would sign the pane in past its account. This route
/// sets exactly those variables itself, on purpose, and its config folder is not a managed
/// account's, so the glue must skip that check for a chat on this route.
pub const BYPASSES_ACCT_024: bool = true;

/// The route's Claude config folder: `<profile>\providers\openrouter`.
pub fn config_dir(profile_dir: &Path) -> PathBuf {
    profile_dir.join(PROVIDERS_FOLDER).join(ROUTE_FOLDER)
}

/// The variables for a chat on this route, in the order they are set. `key` is the OpenRouter key
/// (trimmed); `ANTHROPIC_API_KEY` is set to empty, which the guide requires.
pub fn pane_env(profile_dir: &Path, key: &str) -> Vec<(String, String)> {
    let mut env = vec![
        ("ANTHROPIC_BASE_URL".to_string(), BASE_URL.to_string()),
        ("ANTHROPIC_AUTH_TOKEN".to_string(), key.trim().to_string()),
        ("ANTHROPIC_API_KEY".to_string(), String::new()),
    ];
    env.extend(MODEL_VARS.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    env.push((crate::claude_accounts::CONFIG_ENV.to_string(), config_dir(profile_dir).to_string_lossy().into_owned()));
    env
}

/// The saved key, opened. `Ok(None)` when none is saved; an error (never carrying the key) when
/// the vault cannot open it.
pub fn saved_key(store: &Store) -> Result<Option<String>, String> {
    Ok(crate::secrets::read_setting(store, KEY_FIELD)?.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()))
}

/// [`pane_env`] with the key read from the vault; `Ok(None)` when no key is saved.
pub fn pane_env_from_vault(store: &Store, profile_dir: &Path) -> Result<Option<Vec<(String, String)>>, String> {
    Ok(saved_key(store)?.map(|k| pane_env(profile_dir, &k)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FAKE: &str = "sk-or-v1-fake-key-for-tests";

    fn get<'a>(env: &'a [(String, String)], k: &str) -> Option<&'a str> {
        env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }

    #[test]
    fn the_environment_points_claude_code_at_openrouter() {
        let profile = Path::new(r"C:\profile");
        let env = pane_env(profile, &format!("  {FAKE}\n"));
        assert_eq!(get(&env, "ANTHROPIC_BASE_URL"), Some("https://openrouter.ai/api"));
        assert_eq!(get(&env, "ANTHROPIC_AUTH_TOKEN"), Some(FAKE), "trimmed");
        assert_eq!(get(&env, "ANTHROPIC_API_KEY"), Some(""), "present and explicitly empty");
        for (k, v) in MODEL_VARS {
            assert_eq!(get(&env, k), Some(*v), "{k}");
        }
        assert_eq!(get(&env, "ANTHROPIC_DEFAULT_OPUS_MODEL"), Some("~anthropic/claude-opus-latest[1m]"));
        assert_eq!(get(&env, "CLAUDE_CONFIG_DIR"), Some(config_dir(profile).to_string_lossy().as_ref()));
        assert!(config_dir(profile).ends_with(Path::new("providers").join("openrouter")));
        let names: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        let mut once = names.clone();
        once.sort();
        once.dedup();
        assert_eq!(names.len(), once.len(), "no variable twice");
        assert!(BYPASSES_ACCT_024);
    }

    #[test]
    fn the_key_comes_from_the_vault_and_a_missing_one_is_none() {
        let dir = crate::test_dir::temp("openrouter-vault");
        let profile = dir.join("profile");
        let store = Store::open(&profile).unwrap();
        assert_eq!(saved_key(&store).unwrap(), None);
        assert_eq!(pane_env_from_vault(&store, &profile).unwrap(), None);
        let sealed = crate::secrets::seal(FAKE).unwrap();
        store.save_settings(&json!({ KEY_FIELD: sealed })).unwrap();
        assert_eq!(saved_key(&store).unwrap().as_deref(), Some(FAKE));
        let env = pane_env_from_vault(&store, &profile).unwrap().unwrap();
        assert_eq!(get(&env, "ANTHROPIC_AUTH_TOKEN"), Some(FAKE));
        store.save_settings(&json!({ KEY_FIELD: "   " })).unwrap();
        assert_eq!(saved_key(&store).unwrap(), None, "a blank key is no key");
        drop(store);
    }
}
