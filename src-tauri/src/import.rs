//! What an older profile brings into this one.
//!
//! HID-036 (T-331): settings retired before this rebuild are dropped quietly from an older profile,
//! with no message and no failed load, and never come back: `without_retired` is the filter the
//! settings load and save apply (coordinator hunk in state.rs, T-331 commit body). A retired setting
//! is recognised by its exact old spelling only, so a key a newer build writes is never dropped.
//!
//! The former product's (Nightshift's) settings carry-over (APP-004, T-213) ran only on request,
//! through the command line's `profile migrate`, and went with it.

use serde_json::Value;

/// The former product name, as its settings spelled their camelCase prefix.
pub const FORMER_NAME: &str = "nightshift";

/// HID-036 (T-331): settings retired before this rebuild, each by the exact camelCase names an older
/// profile may have saved it under (letter case and separators matter, so a newer key that only
/// looks like one is kept). They are dropped quietly whenever settings are read or saved, so they
/// never fail a load and never come back with a later change.
pub const RETIRED: &[(&str, &[&str])] = &[
    ("scrollback size in bytes", &["scrollbackBytes", "terminalScrollbackBytes", "scrollbackSizeBytes", "scrollbackBufferSize"]),
    ("GitHub attribution", &["githubAttribution", "gitAttribution", "commitAttribution", "addGithubAttribution"]),
    ("agents sidebar", &["agentsSidebar", "agentSidebar", "showAgentsSidebar", "agentsSidebarOpen"]),
    ("OpenCode sign-in cookie", &["opencodeCookie", "opencodeSigninCookie", "opencodeSessionCookie", "opencodeAuthCookie"]),
    ("OpenCode workspace id", &["opencodeWorkspaceId", "opencodeWorkspace"]),
    ("dashboard open mode", &["dashboardOpenMode", "dashboardMode", "dashboardWindowMode"]),
    ("artifact sharing", &["artifactSharing", "artifactsSharing", "shareArtifacts"]),
    ("artifacts on or off", &["artifactsEnabled", "enableArtifacts", "artifactsOn"]),
    ("artifacts button", &["artifactsButton", "artifactButton", "showArtifactsButton"]),
    ("skip the artifact delete confirmation", &["skipArtifactDeleteConfirm", "skipArtifactDeleteConfirmation", "artifactDeleteConfirmSkip", "confirmArtifactDelete"]),
    ("skill sharing", &["skillSharing", "skillsSharing", "shareSkills"]),
    ("phone-pairing connection mode", &["pairingConnectionMode", "phonePairingMode", "mobilePairingMode"]),
    // Secrets taken off `secrets::SECRET_SETTINGS`, with the plain settings of their features: dropped here, so a sealed
    // value left in a profile never reaches the window.
    ("xAI key for Grok panes", &["xaiApiKey"]),
    ("Kimi and MiniMax usage checks", &["moonshotApiKey", "minimaxApiKey", "minimaxCookie", "minimaxEndpoint", "minimaxGroupId", "minimaxUsageModel", "minimaxModelNames"]),
    ("browser search-session link", &["browserSearchSessionUrl"]),
    ("reading the Gemini CLI's own sign-in", &["geminiCliCredentials"]),
];

/// A saved setting's name as the retired list spells it: a name a profile saved under the old
/// product's or the current product's camelCase prefix (`nightshiftSkillSharing`, `koluxSkillSharing`)
/// reads as the bare name (`skillSharing`). Nothing else is normalised: not letter case, not dots,
/// dashes or underscores.
fn bare(key: &str) -> String {
    for p in ["kolux", FORMER_NAME] {
        if let Some(rest) = key.strip_prefix(p) {
            let mut c = rest.chars();
            if let Some(first) = c.next().filter(|c| c.is_ascii_uppercase()) {
                return format!("{}{}", first.to_ascii_lowercase(), c.as_str());
            }
        }
    }
    key.to_owned()
}

/// Whether `key` names a retired setting.
pub fn is_retired(key: &str) -> bool {
    let b = bare(key);
    RETIRED.iter().any(|(_, names)| names.contains(&b.as_str()))
}

/// `settings` with every retired setting dropped (a value that is not an object is left alone).
pub fn without_retired(mut settings: Value) -> Value {
    drop_retired(&mut settings);
    settings
}

/// Drops the retired settings in place; returns how many went.
pub fn drop_retired(settings: &mut Value) -> usize {
    let Some(map) = settings.as_object_mut() else { return 0 };
    let before = map.len();
    map.retain(|k, _| !is_retired(k));
    before - map.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Store;
    use serde_json::{json, Map};
    use std::fs;

    /// A profile's settings carrying every retired setting, in the spellings an older profile may use.
    fn every_retired() -> Value {
        let mut m = Map::new();
        for (i, (_, names)) in RETIRED.iter().enumerate() {
            m.insert(names[0].to_owned(), json!(i));
        }
        m.insert("terminalScrollbackBytes".into(), json!(1_000_000));
        m.insert("koluxAgentsSidebar".into(), json!(true));
        m.insert("nightshiftGithubAttribution".into(), json!(false));
        m.insert("theme".into(), json!("dark"));
        m.insert("language".into(), json!("ja"));
        m.insert("artifacts".into(), json!({"kept": "the library is a live feature"}));
        m.insert("rightSidebarOpen".into(), json!(true));
        Value::Object(m)
    }

    #[test]
    fn t331_hid036_every_retired_setting_is_named_and_none_collides_with_a_live_one() {
        assert_eq!(RETIRED.len(), 16, "the full list in the card's Compat line, and the retired keys and usage checks");
        for live in ["theme", "language", "artifacts", "skills", "rightSidebarOpen", "leftSidebarWidth", "sidebar", "scrollback", "agentStatusHooks", "confirmWorkspaceDelete"] {
            assert!(!is_retired(live), "{live} is a live setting");
        }
        assert!(is_retired("scrollbackBytes") && is_retired("terminalScrollbackBytes"));
        assert!(is_retired("koluxOpencodeWorkspaceId") && is_retired("nightshiftSkillSharing"));
    }

    #[test]
    fn fix1_after1_only_the_exact_old_spellings_are_dropped_and_a_newer_key_is_kept() {
        // Newer keys that merely look like a retired one (other letter case, other separators, a
        // shorter name) belong to a newer build and must survive a load and a save.
        for newer in ["pairingmode", "pairingMode", "pairing-mode", "pairing.mode", "scrollbackbytes", "scrollback_bytes", "SCROLLBACK_BYTES", "terminal.scrollback-bytes", "agents-sidebar", "Agents_Sidebar", "artifactsEnabledV2", "skillSharingMode"] {
            assert!(!is_retired(newer), "{newer} is not an old spelling");
        }
        let mut s = json!({"pairingmode": "relay", "scrollbackbytes": 5, "phonePairingMode": "old", "scrollbackBytes": 1, "theme": "dark"});
        assert_eq!(drop_retired(&mut s), 2);
        assert_eq!(s, json!({"pairingmode": "relay", "scrollbackbytes": 5, "theme": "dark"}));
        // every listed name is written in the camelCase an older profile used, so each matches itself exactly
        for (_, names) in RETIRED {
            for n in *names {
                assert!(is_retired(n), "{n}");
                assert!(n.chars().all(|c| c.is_ascii_alphanumeric()) && n.starts_with(|c: char| c.is_ascii_lowercase()), "{n} must be a camelCase key");
            }
        }
    }

    #[test]
    fn t331_hid036_a_profile_with_every_retired_setting_loads_without_them_and_they_never_come_back() {
        let root = crate::test_dir::temp("imp-retired");
        let profile = root.join("com.txaisxiong.kolux");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("settings.json"), serde_json::to_vec(&every_retired()).unwrap()).unwrap();
        let store = Store::open(&profile).unwrap();
        // Load: the read succeeds (no message, no refusal) and the retired ones are gone.
        let loaded = without_retired(store.try_settings().expect("loads"));
        assert_eq!(loaded, json!({"theme": "dark", "language": "ja", "artifacts": {"kept": "the library is a live feature"}, "rightSidebarOpen": true}));
        // The next save writes them out of the file.
        store.save_settings(&loaded).unwrap();
        let on_disk: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(on_disk, loaded);
        // A later change made from an old copy that still had them does not bring them back.
        let mut stale = every_retired();
        stale["theme"] = json!("light");
        store.save_settings(&without_retired(stale)).unwrap();
        let after: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(after["theme"], json!("light"));
        assert!(after.as_object().unwrap().keys().all(|k| !is_retired(k)), "{after}");
        drop(store);
    }
}
