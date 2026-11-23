//! The restore timeline: how long each step of bringing saved tabs back took.
//!
//! A window that shows itself at 1.6 s and then spawns its first agent at 16 s leaves nothing on
//! disk to say where the time went. The page notes one mark per step (`boot_timing`) and this writes
//! it to `kolux.log` beside the start-up line, so "the tabs take ten seconds" can be read as a
//! number per step instead of a feeling. Values are milliseconds since the page started.
//!
//! Never a reason to slow or fail a restore: a name holding anything but a mark's own characters is
//! narrowed to those, a value that is not a finite, non-negative number is dropped, and a missing
//! profile folder writes nothing.

use tauri::Manager;

/// The longest name kept. `pane:12:attached:fresh` is a normal one.
const NAME_MAX: usize = 48;

/// The name as the log may hold it: letters, digits, `-`, `_` and `:` only, at most [`NAME_MAX`].
/// Everything else (a control character from a stray escape, a newline, a space) is dropped, so one
/// mark can never write two lines.
fn clean_name(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':')).take(NAME_MAX).collect()
}

/// One mark of the restore timeline. Called from the page; fire and forget on that side.
#[tauri::command]
pub fn boot_timing(app: tauri::AppHandle, name: String, ms: f64) {
    let name = clean_name(&name);
    if name.is_empty() || !ms.is_finite() || ms < 0.0 {
        return;
    }
    if let Ok(dir) = app.path().app_data_dir() {
        crate::diag::write(&dir, &format!("boot {name}={ms:.0}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_name_keeps_its_own_characters_and_drops_the_rest() {
        assert_eq!(clean_name("pane:12:attached:fresh"), "pane:12:attached:fresh");
        assert_eq!(clean_name("restore:start"), "restore:start");
    }

    /// A control character would end the line, so one mark could write two; it never survives.
    #[test]
    fn newlines_and_escapes_never_reach_the_log() {
        assert_eq!(clean_name("a\nb"), "ab");
        assert_eq!(clean_name("a\r\nb\u{1b}[2J"), "ab2J");
        assert_eq!(clean_name("a b\tc"), "abc");
        assert_eq!(clean_name("pane:1:attached:refused (14 s)"), "pane:1:attached:refused14s");
    }

    #[test]
    fn a_name_is_never_longer_than_the_log_keeps() {
        let long = "a".repeat(500);
        assert_eq!(clean_name(&long).len(), NAME_MAX);
        assert_eq!(clean_name(""), "");
    }
}
