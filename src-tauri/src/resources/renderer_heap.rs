// APP-022 (T-324-b): the interface's memory ceiling. On a machine with 8 GB of RAM or more the
// engine's old-space ceiling is raised; KOLUX_RENDERER_HEAP_MB sets it outright. Pure choice here;
// recovery::launch_browser_args puts the result into the WebView2 browser arguments.

pub const ENV: &str = "KOLUX_RENDERER_HEAP_MB";
const GIB: u64 = 1 << 30;
/// "8 GB or more": a machine sold as 8 GB reports a little under 8 GiB to the OS.
pub const MIN_RAM: u64 = 7 * GIB + GIB / 2;
/// Owner's choice (DT-C229, 2026-11-09; the spec leaves the figures open): 1.5 GiB from 8 GB of RAM, 2 GiB from
/// 16 GB. The ceiling is not a target and V8 pointer compression caps the heap at 4 GiB anyway; the interface
/// uses about 170 MB, so this is roughly ten times headroom. KOLUX_RENDERER_HEAP_MB still raises it.
pub const MID_MB: u64 = 1536;
pub const BIG_MB: u64 = 2048;
pub const BIG_RAM: u64 = 15 * GIB;
/// Above this an override is clamped: the engine does not take a larger old space seriously.
pub const MAX_MB: u64 = 65_536;

/// What the environment variable asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Ask {
    /// Not set, or unreadable: the automatic choice stands.
    Auto,
    /// 0, a negative number, off, none or default: the platform's own ceiling, even on a big machine.
    Platform,
    Mb(u64),
}

pub fn ask(value: Option<&str>) -> Ask {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else { return Ask::Auto };
    match v.to_ascii_lowercase().as_str() {
        "off" | "none" | "default" => return Ask::Platform,
        _ => {}
    }
    match v.parse::<i64>() {
        Ok(n) if n > 0 => Ask::Mb((n as u64).min(MAX_MB)),
        Ok(_) => Ask::Platform,
        Err(_) => Ask::Auto,
    }
}

/// The ceiling to set in megabytes, or `None` to leave the platform's own.
pub fn heap_mb(value: Option<&str>, ram_bytes: Option<u64>) -> Option<u64> {
    match ask(value) {
        Ask::Mb(n) => Some(n),
        Ask::Platform => None,
        Ask::Auto => match ram_bytes {
            Some(r) if r >= BIG_RAM => Some(BIG_MB),
            Some(r) if r >= MIN_RAM => Some(MID_MB),
            _ => None,
        },
    }
}

const FLAG: &str = "--js-flags=";
const OLD_SPACE: &str = "--max-old-space-size";

/// `args` with the ceiling set. An existing `--js-flags=` switch gets the setting inside it (its own
/// old-space figure wins); each switch stays once.
pub fn with_heap(args: &str, mb: u64) -> String {
    let setting = format!("{OLD_SPACE}={mb}");
    let mut found = false;
    let parts: Vec<String> = args
        .split_whitespace()
        .map(|a| match a.strip_prefix(FLAG) {
            Some(inner) if !found => {
                found = true;
                let inner = inner.trim_matches('"');
                if inner.contains(OLD_SPACE) {
                    a.to_string()
                } else if inner.is_empty() {
                    format!("{FLAG}{setting}")
                } else {
                    format!("{FLAG}\"{inner} {setting}\"")
                }
            }
            _ => a.to_string(),
        })
        .collect();
    if found {
        parts.join(" ")
    } else if parts.is_empty() {
        format!("{FLAG}{setting}")
    } else {
        format!("{} {FLAG}{setting}", parts.join(" "))
    }
}

/// `args` with the ceiling this machine and environment call for; unchanged when none applies.
pub fn apply(args: &str, value: Option<&str>, ram_bytes: Option<u64>) -> String {
    match heap_mb(value, ram_bytes) {
        Some(mb) => with_heap(args, mb),
        None => args.to_string(),
    }
}

/// The real environment and the real RAM.
pub fn apply_here(args: &str) -> String {
    apply(args, std::env::var(ENV).ok().as_deref(), crate::sysmem::total_ram_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;
    const MIB: u64 = 1 << 20;

    #[test]
    fn app022_a_positive_number_sets_the_ceiling_whatever_the_ram() {
        assert_eq!(heap_mb(Some("3000"), Some(2 * GB)), Some(3000));
        assert_eq!(heap_mb(Some(" 6144 "), None), Some(6144));
        assert_eq!(heap_mb(Some("999999999"), Some(64 * GB)), Some(MAX_MB));
    }

    #[test]
    fn app022_zero_negative_off_none_and_default_keep_the_platforms_ceiling_even_on_a_big_machine() {
        for v in ["0", "-5", "off", "OFF", "none", "Default"] {
            assert_eq!(heap_mb(Some(v), Some(32 * GB)), None, "{v}");
        }
    }

    #[test]
    fn app022_an_unreadable_value_is_ignored_and_the_automatic_choice_stands() {
        for v in ["lots", "12.5", "1e3", "", "  "] {
            assert_eq!(heap_mb(Some(v), Some(32 * GB)), Some(BIG_MB), "{v:?}");
        }
        assert_eq!(heap_mb(Some("lots"), Some(4 * GB)), None);
    }

    #[test]
    fn app022_below_8gb_the_default_stays_and_from_8gb_it_rises() {
        assert_eq!((MID_MB, BIG_MB), (1536, 2048), "DT-C229: the owner's figures");
        assert_eq!(heap_mb(None, Some(4 * GB)), None);
        assert_eq!(heap_mb(None, Some(7 * GB)), None);
        assert_eq!(heap_mb(None, None), None, "unknown RAM is not guessed");
        assert_eq!(heap_mb(None, Some(8 * GB)), Some(MID_MB));
        assert_eq!(heap_mb(None, Some(8 * GB - 300 * MIB)), Some(MID_MB), "an 8 GB machine reports a bit less");
        assert_eq!(heap_mb(None, Some(16 * GB)), Some(BIG_MB));
        assert_eq!(heap_mb(None, Some(16 * GB - 300 * MIB)), Some(BIG_MB));
    }

    #[test]
    fn app022_the_switch_is_added_once_and_merged_into_an_existing_js_flags() {
        assert_eq!(with_heap("", 4096), "--js-flags=--max-old-space-size=4096");
        assert_eq!(with_heap("--a --b", 4096), "--a --b --js-flags=--max-old-space-size=4096");
        assert_eq!(with_heap("--a --js-flags=--expose-gc --b", 2048), "--a --js-flags=\"--expose-gc --max-old-space-size=2048\" --b");
        let own = "--js-flags=--max-old-space-size=1000";
        assert_eq!(with_heap(own, 4096), own, "a figure already in the string wins");
        let twice = with_heap(&with_heap("--a", 4096), 4096);
        assert_eq!(twice.matches(OLD_SPACE).count(), 1);
    }

    #[test]
    fn app022_apply_leaves_the_arguments_alone_when_nothing_is_asked() {
        assert_eq!(apply("--a", None, Some(4 * GB)), "--a");
        assert_eq!(apply("--a", Some("off"), Some(32 * GB)), "--a");
        assert_eq!(apply("--a", Some("1500"), Some(4 * GB)), "--a --js-flags=--max-old-space-size=1500");
    }
}
