//! What the chat, token and library readers share about Claude Code's own files: the name of the
//! event the Artifacts library sends when it changed behind the window's back, the time format of
//! a transcript line, and the folder Claude Code keeps its config and transcripts in.

use std::path::PathBuf;

/// Sent to the window when the library changed behind its back.
pub const EVENT: &str = "artifacts-changed";

/// Milliseconds since 1970 from a UTC time such as 2026-09-24T09:56:01.421Z.
/// ponytail: offsets other than Z are read as UTC; Claude Code writes Z.
pub fn parse_time(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let frac: String = if b.get(19) == Some(&b'.') { s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect() } else { String::new() };
    let ms: i64 = format!("{frac:0<3}").parse().ok()?;
    // Days from the civil date (the well-known era / day-of-era method).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from((((days * 24 + hh) * 60 + mm) * 60 + ss) * 1000 + ms).ok()
}

/// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else .claude in the home folder.
pub fn claude_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(d.into());
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|h| PathBuf::from(h).join(".claude"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_parse_as_utc_milliseconds() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-09-24T09:56:01.421Z"), Some(1_790_243_761_421));
        assert_eq!(parse_time("2000-02-29T12:00:00.5Z"), Some(951_825_600_500));
        assert_eq!(parse_time("yesterday"), None);
    }
}
