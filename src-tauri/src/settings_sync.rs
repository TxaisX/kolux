//! SET-035 (T-181): what a settings change is allowed to carry. A window sends a patch (`set` and
//! `remove`); this module drops the parts that must never be stored from it (settings of retired
//! features, and secret fields, which change only through the secret commands) and builds the
//! broadcast every window receives after the save, with the secret fields taken out. The save itself
//! (`Store::patch_settings`, `secrets::keep_stored_secrets`) is unchanged.

use crate::{import, secrets};
use serde_json::{Map, Value};

/// A patch as it may be stored: updates aimed at a retired setting are ignored (HID-036), and a
/// window cannot write or remove a secret field.
pub fn accepted(set: &Map<String, Value>, remove: &[String]) -> (Map<String, Value>, Vec<String>) {
    let ok = |k: &str| !import::is_retired(k) && !secrets::SECRET_SETTINGS.contains(&k);
    (set.iter().filter(|(k, _)| ok(k)).map(|(k, v)| (k.clone(), v.clone())).collect(), remove.iter().filter(|k| ok(k)).cloned().collect())
}

/// The event payload sent to every window after a save: the keys that changed and the ones that
/// went, no secret among them. A window lays it over its copy, or reads the settings again when it
/// gets none.
pub fn broadcast(set: &Map<String, Value>, remove: &[String]) -> Value {
    let (set, remove) = accepted(set, remove);
    serde_json::json!({ "set": set, "remove": remove })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{patched, Store};
    use serde_json::json;

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn set035_the_broadcast_carries_the_change_and_no_secret() {
        let set = map(json!({ "terminalFont": "Cascadia Code", "claudeOauthToken": "sk-ant-secret", "httpProxy": "http://u:p@host:1", "minimaxApiKey": "k" }));
        let payload = broadcast(&set, &["httpProxy".into(), "zoom".into()]);
        assert_eq!(payload, json!({ "set": { "terminalFont": "Cascadia Code" }, "remove": ["zoom"] }));
        let text = payload.to_string();
        for secret in ["sk-ant-secret", "u:p@host", "claudeOauthToken", "httpProxy", "minimaxApiKey"] {
            assert!(!text.contains(secret), "{secret} leaked into {text}");
        }
    }

    #[test]
    fn set035_updates_aimed_at_retired_settings_are_ignored() {
        let (set, remove) = accepted(&map(json!({ "githubAttribution": true, "agentsSidebar": true, "theme": "dark" })), &["scrollbackBytes".into(), "language".into()]);
        assert_eq!(Value::Object(set), json!({ "theme": "dark" }));
        assert_eq!(remove, vec!["language".to_string()]);
    }

    #[test]
    fn set035_a_saved_change_reads_back_as_stored_without_secrets_and_stale_values_vanish() {
        let dir = crate::test_dir::temp("set035-sync");
        let store = Store::open(&dir).unwrap();
        // A profile from before: a retired value, a stored secret, a sealed secret of a retired feature (the xAI key),
        // an ordinary setting.
        store.save_settings(&json!({ "theme": "classic", "terminalFont": "Consolas", "claudeOauthToken": "kolux-sealed:v1:AAAA" })).unwrap();
        std::fs::write(dir.join("settings.json"), serde_json::to_vec(&json!({ "theme": "classic", "terminalFont": "Consolas", "claudeOauthToken": "kolux-sealed:v1:AAAA", "xaiApiKey": "kolux-sealed:v1:BBBB", "agentsSidebar": true })).unwrap()).unwrap();
        // Load: the retired values are gone before any page sees them, and no secret reaches the window.
        let seen = secrets::without_secrets(store.settings());
        assert_eq!(seen, json!({ "theme": "classic", "terminalFont": "Consolas" }));
        // Window A changes the font, tries to write a secret and a retired value in the same patch.
        let (set, remove) = accepted(&map(json!({ "terminalFont": "Cascadia Code", "claudeOauthToken": "typed-over", "agentsSidebar": false })), &[]);
        let old = store.settings();
        let next = secrets::keep_stored_secrets(&old, patched(old.clone(), &set, &remove));
        store.save_settings(&next).unwrap();
        // The next read (what window B takes) is what was really stored.
        let stored = store.settings();
        assert_eq!(stored["terminalFont"], "Cascadia Code");
        assert_eq!(stored["claudeOauthToken"], "kolux-sealed:v1:AAAA", "the sealed secret is kept as it was");
        let on_disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!on_disk.contains("agentsSidebar") && !on_disk.contains("xaiApiKey"), "a stale retired value vanishes at the next save: {on_disk}");
        assert!(!secrets::without_secrets(stored).to_string().contains("claudeOauthToken"));
    }
}
