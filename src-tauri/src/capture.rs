//! What the chat and token readers share about Claude Code's own files: the time format of a
//! transcript line, and the folder Claude Code keeps its config and transcripts in.

use std::path::PathBuf;

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
    // Reject fields no real date can have: the day-of-era arithmetic below would otherwise turn
    // them into a nearby instant, and a corrupt transcript would be dated at a made-up time.
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days_in_month = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=days_in_month).contains(&d) || !(0..24).contains(&hh) || !(0..60).contains(&mm) || !(0..60).contains(&ss) {
        return None;
    }
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

    #[test]
    fn audit_r8_f02_an_impossible_date_is_not_a_time() {
        // A corrupt or hand-edited transcript can carry a date that never existed. It must read
        // as no time at all, or the chat is sorted by a made-up instant.
        assert_eq!(parse_time("2026-13-01T00:00:00Z"), None, "month 13");
        assert_eq!(parse_time("2026-00-10T00:00:00Z"), None, "month 0");
        assert_eq!(parse_time("2026-01-00T00:00:00Z"), None, "day 0");
        assert_eq!(parse_time("2026-02-30T00:00:00Z"), None, "30 February");
        assert_eq!(parse_time("2026-04-31T00:00:00Z"), None, "31 April");
        assert_eq!(parse_time("2026-01-01T24:00:00Z"), None, "hour 24");
        assert_eq!(parse_time("2026-01-01T00:60:00Z"), None, "minute 60");
        assert_eq!(parse_time("2026-01-01T00:00:00Z"), Some(1_767_225_600_000), "a real date still parses");
    }
}
