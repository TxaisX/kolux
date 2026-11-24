//! Workspace names become safe branch and folder names (PROJ-021). The shown name stays exactly
//! what the user typed; this is only the cleaned-up form used for the branch and the folder.

/// Emoji the cleaner knows by their short word. Any other symbol gets its Unicode name.
const EMOJI_WORDS: &[(char, &str)] = &[
    ('\u{1F525}', "fire"),
    ('\u{1F680}', "rocket"),
    ('\u{1F41B}', "bug"),
    ('\u{2728}', "sparkles"),
    ('\u{2B50}', "star"),
    ('\u{2764}', "heart"),
    ('\u{1F4A1}', "bulb"),
    ('\u{1F527}', "wrench"),
    ('\u{1F389}', "tada"),
    ('\u{2705}', "check"),
    ('\u{26A1}', "zap"),
    ('\u{1F9EA}', "test-tube"),
    ('\u{1F4DD}', "memo"),
    ('\u{1F512}', "lock"),
];

/// Turns a typed name into a name Git and the file system both accept, or `None` when nothing
/// usable is left. Rules: spaces, slashes and punctuation become hyphens, repeated separators
/// merge, characters Git refuses are dropped, runs of dots shrink to one, letters outside ASCII
/// stay, known emoji become their word, any other symbol its Unicode name in words (a joined
/// emoji names each of its parts), and the result never starts or ends with a separator.
pub fn safe_name(input: &str) -> Option<String> {
    let mut out = String::new();
    for ch in input.chars() {
        if let Some((_, word)) = EMOJI_WORDS.iter().find(|(c, _)| *c == ch) {
            push_sep(&mut out);
            out.push_str(word);
            push_sep(&mut out);
        } else if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
        } else if ch == '.' {
            if !out.ends_with('.') && !out.is_empty() {
                out.push('.');
            }
        } else if ch == '-' || ch == '_' || ch.is_whitespace() || ch == '/' || ch == '\\' || ch.is_ascii_punctuation() {
            // `~ ^ : ? * [ ] < > | " @ { }` are refused by Git or Windows; every one of them, and
            // every other mark, acts as a separator rather than surviving into the name.
            push_sep(&mut out);
        } else if !silent(ch) {
            if let Some(name) = unicode_names2::name(ch) {
                push_sep(&mut out);
                out.push_str(&name.to_string().to_lowercase().replace(' ', "-"));
                push_sep(&mut out);
            }
        }
        // control characters, joiners, selectors, modifiers and marks: dropped
    }
    // collapse "-.-" style runs: a dot next to a hyphen keeps only the dot
    let mut cleaned = String::new();
    for ch in out.chars() {
        if ch == '.' && cleaned.ends_with('-') {
            cleaned.pop();
        }
        if ch == '-' && cleaned.ends_with('.') {
            continue;
        }
        cleaned.push(ch);
    }
    let trimmed = cleaned.trim_matches(|c| c == '-' || c == '.').to_string();
    if trimmed.is_empty() {
        return None;
    }
    // Git refuses every name ending in ".lock"; the folder would also be odd. A typed name can
    // carry more than one (".lock.lock"), so strip until none is left rather than just the last.
    let mut trimmed = trimmed.as_str();
    while let Some(stripped) = trimmed.strip_suffix(".lock") {
        trimmed = stripped;
    }
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Characters that shape a neighbour rather than say anything of their own: controls, zero-width
/// joiners, variation selectors, emoji tags and skin tones, combining marks.
fn silent(ch: char) -> bool {
    ch.is_control()
        || matches!(ch as u32,
            0x200B..=0x200D | 0x2060 | 0xFEFF
            | 0xFE00..=0xFE0F | 0xE0100..=0xE01EF
            | 0xE0000..=0xE007F
            | 0x1F3FB..=0x1F3FF
            | 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

fn push_sep(out: &mut String) {
    if !out.is_empty() && !out.ends_with('-') && !out.ends_with('.') {
        out.push('-');
    }
}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn spaces_become_hyphens_and_emoji_become_words() {
        assert_eq!(safe_name("Fix login \u{1F525}").as_deref(), Some("fix-login-fire"));
        assert_eq!(safe_name("fix-login").as_deref(), Some("fix-login"));
        assert_eq!(safe_name("  Fix   login  ").as_deref(), Some("fix-login"));
    }

    #[test]
    fn slashes_dots_and_git_refused_characters() {
        assert_eq!(safe_name("feature/auth/v2").as_deref(), Some("feature-auth-v2"));
        assert_eq!(safe_name("a..b...c").as_deref(), Some("a.b.c"));
        assert_eq!(safe_name("what?*[yes]:no~^").as_deref(), Some("what-yes-no"));
        assert_eq!(safe_name("ref@{1}").as_deref(), Some("ref-1"));
        assert_eq!(safe_name("name.lock").as_deref(), Some("name"));
        assert_eq!(safe_name("C:\\Users\\me").as_deref(), Some("c-users-me"));
    }

    #[test]
    fn leading_dash_and_dots_are_trimmed() {
        assert_eq!(safe_name("-rf").as_deref(), Some("rf"));
        assert_eq!(safe_name("--force").as_deref(), Some("force"));
        assert_eq!(safe_name(".hidden.").as_deref(), Some("hidden"));
        assert_eq!(safe_name("a - . - b").as_deref(), Some("a.b"));
    }

    #[test]
    fn unicode_letters_stay_and_unknown_symbols_go() {
        assert_eq!(safe_name("Caf\u{e9} r\u{e9}sum\u{e9}").as_deref(), Some("caf\u{e9}-r\u{e9}sum\u{e9}"));
        assert_eq!(safe_name("\u{65E5}\u{672C}\u{8A9E} test").as_deref(), Some("\u{65E5}\u{672C}\u{8A9E}-test"));
    }

    #[test]
    fn unknown_emoji_fall_back_to_their_unicode_names_and_joiners_vanish() {
        // A ZWJ sequence names each of its parts (T-013-fix-b); the joiner, skin tones,
        // variation selectors and combining marks say nothing.
        assert_eq!(safe_name("ship it \u{1F9D1}\u{200D}\u{1F4BB}").as_deref(), Some("ship-it-adult-personal-computer"));
        assert_eq!(safe_name("ok \u{1F44D}\u{1F3FD}").as_deref(), Some("ok-thumbs-up-sign"));
        assert_eq!(safe_name("warn \u{26A0}\u{FE0F}").as_deref(), Some("warn-warning-sign"));
        assert_eq!(safe_name("e\u{301}").as_deref(), Some("e"));
        assert_eq!(safe_name("\u{20AC}5").as_deref(), Some("euro-sign-5"));
    }

    #[test]
    fn nothing_usable_is_rejected() {
        assert_eq!(safe_name(""), None);
        assert_eq!(safe_name("   "), None);
        assert_eq!(safe_name("?*~^:"), None);
        assert_eq!(safe_name("..."), None);
        assert_eq!(safe_name("-"), None);
        assert_eq!(safe_name(".lock").as_deref(), Some("lock"), "a leading dot goes first, so lock itself is fine");
    }

    #[test]
    fn audit_r8_f01_a_name_is_never_left_ending_in_lock() {
        // A typed workspace name may end in ".lock" more than once; git refuses every name
        // ending in ".lock", so every trailing one has to go, not just the last.
        assert_eq!(safe_name("notes.lock.lock").as_deref(), Some("notes"));
        assert_eq!(safe_name("a.lock.lock.lock").as_deref(), Some("a"));
    }
}
