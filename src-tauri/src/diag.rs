//! APP-041: diagnostic logs stay on this computer and are scrubbed before sharing.
//!
//! Kolux keeps a short record of its own doings (app starts and exits, terminal sessions starting
//! and ending, what a background pass refused) in `<profile>/logs/kolux.log`. The profile folder is
//! limited to the current user (ACCT-009, `secrets::sealing_pass`) and the logs folder inherits
//! that. A file past `FILE_CAP` moves aside as `kolux.<millis>.log`, and the oldest files go until
//! everything fits in `TOTAL_CAP`. Writing a line never fails the action it records: every error
//! here is dropped. What the user copies or writes as a review copy is `scrub`bed first; masking is
//! idempotent because the mask itself matches no rule.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The live file moves aside past this size.
pub const FILE_CAP: u64 = 512 * 1024;
/// The files moved aside are deleted, oldest first, past this total.
pub const TOTAL_CAP: u64 = 2 * 1024 * 1024;
/// What a masked value becomes. Matches no rule, so masking twice changes nothing.
pub const MASK: &str = "[masked]";
const LIVE: &str = "kolux.log";
const REVIEW: &str = "diagnostics-review.txt";

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Appends one line (seconds since the epoch, then the text) and keeps the folder within the caps.
pub fn write(dir: &Path, line: &str) {
    write_capped(dir, line, FILE_CAP, TOTAL_CAP);
}

/// APP-003: where `catch_panics` and `fatal` write; set once the profile folder is known.
static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_dir(dir: &Path) {
    let _ = DIR.set(dir.to_path_buf());
}

/// APP-003: a panic is written to the log as well as stderr. One on a background thread ends only
/// that thread and the app keeps going; one on the main thread is fatal and says so.
pub fn catch_panics() {
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        before(info);
        if let Some(dir) = DIR.get() {
            let main = std::thread::current().name() == Some("main");
            write(dir, &format!("{}: {info}", if main { "fatal error" } else { "error in background work, the app keeps going" }));
        }
    }));
}

/// APP-003: a failure before the window is up ends the process with its reason in the log, so no
/// invisible copy is left holding on.
pub fn fatal(reason: &str) -> ! {
    eprintln!("Kolux could not start: {reason}");
    if let Some(dir) = DIR.get() {
        write(dir, &format!("could not start: {reason}"));
    }
    std::process::exit(1)
}

fn write_capped(dir: &Path, line: &str, file_cap: u64, total_cap: u64) {
    let logs = dir.join("logs");
    if fs::create_dir_all(&logs).is_err() {
        return;
    }
    let live = logs.join(LIVE);
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&live) {
        let _ = writeln!(f, "{} {line}", now_secs());
    }
    if fs::metadata(&live).is_ok_and(|m| m.len() > file_cap) {
        rotate(&logs, &live, total_cap);
    }
}

/// Moves the live file aside under a time-stamped name, then deletes the oldest files moved aside
/// until they fit in `total_cap` (the live file starts over empty, so only the old ones count).
fn rotate(logs: &Path, live: &Path, total_cap: u64) {
    let mut n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let mut aside = logs.join(format!("kolux.{n:013}.log"));
    while aside.exists() {
        n += 1;
        aside = logs.join(format!("kolux.{n:013}.log"));
    }
    if fs::rename(live, &aside).is_err() {
        return;
    }
    let mut old = rotated(logs);
    let mut total: u64 = old.iter().map(|(_, len)| len).sum();
    while total > total_cap && !old.is_empty() {
        let (path, len) = old.remove(0);
        if fs::remove_file(path).is_err() {
            break;
        }
        total -= len;
    }
}

/// The files moved aside, oldest first (their names sort by time), with their sizes.
fn rotated(logs: &Path) -> Vec<(PathBuf, u64)> {
    let mut v: Vec<(PathBuf, u64)> = fs::read_dir(logs)
        .map(|rd| {
            rd.flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    name.starts_with("kolux.") && name.ends_with(".log") && name != LIVE
                })
                .map(|e| (e.path(), e.metadata().map(|m| m.len()).unwrap_or(0)))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Every log file oldest first under a header, with secrets masked: what a bug report carries.
pub fn bundle(dir: &Path, version: &str) -> String {
    let logs = dir.join("logs");
    let mut out = format!("Kolux RS {version} diagnostics, {} on {} {}\n", jiff::Timestamp::now(), std::env::consts::OS, std::env::consts::ARCH);
    let mut files: Vec<PathBuf> = rotated(&logs).into_iter().map(|(p, _)| p).collect();
    files.push(logs.join(LIVE));
    for p in files {
        if let Ok(text) = fs::read_to_string(&p) {
            out.push_str(&format!("== {} ==\n{text}", p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
            if !text.ends_with('\n') {
                out.push('\n');
            }
        }
    }
    scrub(&out)
}

const NAMES: [&str; 10] = ["key", "token", "secret", "passw", "pwd", "credential", "auth", "cookie", "bearer", "signature"];
const EXACT: [&str; 14] = [
    "password", "passwd", "pwd", "token", "secret", "key", "apikey", "api_key", "api-key", "authorization", "auth", "bearer", "cookie", "credentials",
];
const KNOWN: [&str; 15] = [
    "sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-", "AIza", "glpat-", "npm_",
];

/// A name whose value is a secret: anything with a known word in it (over-masking is the safe side).
fn secret_name(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    NAMES.iter().any(|k| low.contains(k))
}

/// An environment-style name (UPPER_SNAKE): the value after its `=` is masked whatever it is called.
fn env_name(name: &str) -> bool {
    name.len() >= 2 && name.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') && name.bytes().any(|b| b.is_ascii_uppercase())
}

/// The word with its value replaced by the mask; a leading quote and trailing punctuation stay.
fn masked(word: &str) -> String {
    let lead = word.len() - word.trim_start_matches(['"', '\'']).len();
    let core = &word[lead..];
    let keep = core.trim_end_matches(['"', '\'', ',', ';', ')', '}', '>']).len();
    format!("{}{MASK}{}", &word[..lead], &core[keep..])
}

/// One whitespace-delimited word, masked where a rule applies; `true` when the NEXT word is its value.
fn scrub_word(word: &str) -> (String, bool) {
    let bare = word.trim_matches(['"', '\'']);
    // Credentials in an address: scheme://user:pass@host.
    if let Some(i) = word.find("://") {
        let rest = &word[i + 3..];
        if let Some(at) = rest.rfind('@') {
            if !rest[..at].contains('/') {
                return (format!("{}{MASK}{}", &word[..i + 3], &rest[at..]), false);
            }
        }
    }
    // name=value, name:value, "name": "value", ANY_ENV_NAME=value, --flag=value. A bare "name:" with
    // the value in the next word counts only for a quoted (JSON) name or an exact secret word, so a
    // log prefix such as "secrets:" keeps the word after it.
    if let Some(p) = word.find(['=', ':']) {
        let quoted = word[..p].ends_with(['"', '\'']);
        let name = word[..p].trim_matches(['"', '\'']).trim_start_matches('-');
        let after = &word[p + 1..];
        if !name.is_empty() && !after.starts_with("//") && (secret_name(name) || (word.as_bytes()[p] == b'=' && env_name(name))) {
            if !after.is_empty() {
                return (format!("{}{}", &word[..=p], masked(after)), false);
            }
            if quoted || EXACT.contains(&name.to_ascii_lowercase().as_str()) {
                return (word.to_string(), true);
            }
        }
    }
    // A flag or scheme whose value is the next word: --token x, -p x, Bearer x.
    if (word.starts_with('-') && secret_name(bare.trim_start_matches('-'))) || matches!(bare.to_ascii_lowercase().as_str(), "bearer" | "basic") {
        return (word.to_string(), true);
    }
    // A token recognisable by its shape alone.
    let core = bare.trim_end_matches([',', ';', ')', '}', '>']);
    if (core.len() >= 12 && KNOWN.iter().any(|k| core.starts_with(k))) || (core.len() >= 20 && (core.starts_with("AKIA") || core.starts_with("ASIA"))) {
        return (masked(word), false);
    }
    (word.to_string(), false)
}

/// Masks key-value pairs, secrets on a command line, environment-style lines, credentials in
/// addresses and known token shapes. Whitespace is kept as it was; `scrub(scrub(t)) == scrub(t)`.
pub fn scrub(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut mask_next = false;
    let mut rest = text;
    while !rest.is_empty() {
        let ws = rest.len() - rest.trim_start().len();
        out.push_str(&rest[..ws]);
        rest = &rest[ws..];
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let word = &rest[..end];
        rest = &rest[end..];
        if word.is_empty() {
            continue;
        }
        if mask_next {
            // "Authorization: Bearer x": the scheme word stays, the value after it is masked.
            if matches!(word.trim_matches(['"', '\'']).to_ascii_lowercase().as_str(), "bearer" | "basic") {
                out.push_str(word);
                continue;
            }
            out.push_str(&masked(word));
            mask_next = false;
            continue;
        }
        let (text, next) = scrub_word(word);
        out.push_str(&text);
        mask_next = next;
    }
    out
}

fn profile(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The scrubbed bundle; the page puts it on the clipboard with `clip_write`.
#[tauri::command]
pub fn diag_bundle(app: tauri::AppHandle) -> Result<String, String> {
    Ok(bundle(&profile(&app)?, &app.package_info().version.to_string()))
}

/// How many of the newest log lines the short summary carries.
pub const SUMMARY_LINES: usize = 60;

/// APP-010: the home folder (the given one, or any `C:\Users\<name>`, `/Users/<name>`, `/home/<name>`)
/// becomes `~`, so a pasted summary does not say who is logged in.
pub fn strip_home(text: &str, home: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(h) = home.map(|h| h.trim_end_matches(['\\', '/'])).filter(|h| h.len() > 3) {
        // Either slash style, however many backslashes a log line's escaping left.
        let parts: Vec<String> = h.split(['\\', '/']).map(regex::escape).collect();
        // The match ends at a separator, whitespace, a quote, closing punctuation or the end of the text,
        // so the home `C:\Users\jo` does not eat the start of `C:\Users\joe`. The regex crate has no
        // lookahead: the boundary is a capture group put back after the `~`.
        if let Ok(re) = regex::Regex::new(&format!(r#"(?i){}([\\/\s"'`)\]}},;:>|]|$)"#, parts.join(r"[\\/]+"))) {
            out = re.replace_all(&out, "~$1").into_owned();
        }
    }
    let generic = regex::Regex::new(r#"(?i)(?:[a-z]:[\\/]+users[\\/]+|/users/|/home/)[^\\/\s"'<>|:*?]+"#).expect("the home-folder pattern is valid");
    generic.replace_all(&out, "~").into_owned()
}

/// A short diagnostic summary for the help menu: a header and the newest log lines, with the home
/// folder shortened and secrets masked by the same `scrub` the full bundle uses. No pane is needed.
pub fn summary(dir: &Path, version: &str, home: Option<&str>) -> String {
    let logs = dir.join("logs");
    let mut lines: Vec<String> = Vec::new();
    let mut files: Vec<PathBuf> = rotated(&logs).into_iter().map(|(p, _)| p).collect();
    files.push(logs.join(LIVE));
    for p in files {
        if let Ok(text) = fs::read_to_string(&p) {
            lines.extend(text.lines().map(str::to_string));
        }
    }
    let from = lines.len().saturating_sub(SUMMARY_LINES);
    let mut out = format!("Kolux RS {version} diagnostics summary, {} on {} {}\n", jiff::Timestamp::now(), std::env::consts::OS, std::env::consts::ARCH);
    out.push_str(&format!("== newest {} log line(s) ==\n", lines.len() - from));
    for l in &lines[from..] {
        out.push_str(l);
        out.push('\n');
    }
    scrub(&strip_home(&out, home))
}

/// APP-010 (Help > Copy terminal diagnostics): the scrubbed summary; the page puts it on the clipboard.
#[tauri::command]
pub fn diag_summary(app: tauri::AppHandle) -> Result<String, String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    Ok(summary(&profile(&app)?, &app.package_info().version.to_string(), home.as_deref()))
}

/// Writes the scrubbed bundle as a review copy in the profile folder and opens it; the path comes back.
#[tauri::command]
pub fn diag_review(app: tauri::AppHandle) -> Result<String, String> {
    let dir = profile(&app)?;
    let path = dir.join(REVIEW);
    fs::write(&path, bundle(&dir, &app.package_info().version.to_string())).map_err(|e| format!("could not write the review copy: {e}"))?;
    let shown = path.to_string_lossy().into_owned();
    crate::artifacts::system_open(&shown)?;
    Ok(shown)
}

/// Throws the review copy away; none to throw away is fine.
#[tauri::command]
pub fn diag_review_discard(app: tauri::AppHandle) -> Result<(), String> {
    match fs::remove_file(profile(&app)?.join(REVIEW)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("could not remove the review copy: {e}")),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-diag-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn app003_a_background_panic_is_logged_and_the_rest_keeps_going() {
        let dir = temp_dir("app003");
        set_dir(&dir);
        catch_panics();
        let joined = std::thread::spawn(|| panic!("injected background failure")).join();
        assert!(joined.is_err());
        let log = fs::read_to_string(dir.join("logs").join(LIVE)).unwrap();
        assert!(log.contains("error in background work, the app keeps going") && log.contains("injected background failure"), "{log}");
    }

    #[test]
    fn app041_masking_covers_pairs_command_lines_env_lines_addresses_and_known_shapes_and_is_idempotent() {
        let text = "\
terminal 3 started (pwsh) at 12:30 in C:\\Users\\me\\proj
claude --api-key sk-ant-api03-SECRETONE1234567890 -p \"hi\"
curl -H \"Authorization: Bearer SECRETTWO_abcdefghijk\" https://api.example/v1
ANTHROPIC_API_KEY=sk-SECRETTHREE1234567890
export DATABASE_URL=postgres://admin:SECRETFOUR@db.example:5432/app
HOME_DIR=/home/me
{\"token\": \"SECRETFIVE12345\", \"password\":\"SECRETSIX\", \"name\": \"kolux\"}
git clone https://me:ghp_SECRETSEVEN1234567890@github.com/me/repo.git
AKIASECRETEIGHT12345 xoxb-SECRETNINE-1234567890 key=SECRETTEN
Password: SECRETELEVEN
secrets: one-off sealing pass sealed 0 settings field(s) and 0 file(s)";
        let out = scrub(text);
        for s in ["SECRETONE", "SECRETTWO", "SECRETTHREE", "SECRETFOUR", "SECRETFIVE", "SECRETSIX", "SECRETSEVEN", "SECRETEIGHT", "SECRETNINE", "SECRETTEN", "SECRETELEVEN", "/home/me"] {
            assert!(!out.contains(s), "{s} survived:\n{out}");
        }
        for keep in [
            "terminal 3 started (pwsh) at 12:30 in C:\\Users\\me\\proj",
            "claude --api-key [masked] -p \"hi\"",
            "Bearer [masked]\" https://api.example/v1",
            "ANTHROPIC_API_KEY=[masked]",
            "postgres://[masked]@db.example:5432/app",
            "HOME_DIR=[masked]",
            "{\"token\": \"[masked]\", \"password\":\"[masked]\", \"name\": \"kolux\"}",
            "https://[masked]@github.com/me/repo.git",
            "[masked] [masked] key=[masked]",
            "Password: [masked]",
            "secrets: one-off sealing pass sealed 0 settings field(s) and 0 file(s)",
        ] {
            assert!(out.contains(keep), "expected {keep:?} in:\n{out}");
        }
        assert_eq!(scrub(&out), out, "masking masked text changed it");
        assert_eq!(scrub("plain words, a time 12:30 and a path C:\\x\\y.txt\n"), "plain words, a time 12:30 and a path C:\\x\\y.txt\n");
    }

    #[test]
    fn app010_the_diagnostics_summary_has_no_home_folder_path_and_no_secret_looking_value() {
        let dir = temp_dir("app010");
        let home = r"C:\Users\someone";
        write(&dir, &format!("terminal 3 started (pwsh) in {home}\\proj\\src"));
        write(&dir, "terminal 3 json C:\\\\Users\\\\someone\\\\proj and /home/linuxer/work and /Users/macer/x");
        write(&dir, "pane env ANTHROPIC_API_KEY=sk-ant-SUMMARYSECRET123456 leaked");
        write(&dir, "curl -H \"Authorization: Bearer SUMMARYTWO_abcdefghijk\" https://api.example/v1");
        write(&dir, &format!("profile at {}\\AppData\\Roaming\\kolux", home.to_lowercase()));
        let s = summary(&dir, "0.1.0", Some(home));
        assert!(s.starts_with("Kolux RS 0.1.0 diagnostics summary, "), "{s}");
        for gone in ["someone", "linuxer", "macer", "SUMMARYSECRET", "SUMMARYTWO", "C:\\Users", "/home/", "/Users/"] {
            assert!(!s.contains(gone), "{gone} survived:\n{s}");
        }
        assert!(s.contains("terminal 3 started (pwsh) in ~\\proj\\src") && s.contains("ANTHROPIC_API_KEY=[masked] leaked"), "{s}");
        assert_eq!(scrub(&s), s, "the summary is already scrubbed");
        // Only the newest lines: 200 written, the oldest is not in it.
        for i in 0..200 {
            write(&dir, &format!("filler line {i:04}"));
        }
        let s = summary(&dir, "0.1.0", None);
        assert!(s.contains("filler line 0199") && !s.contains("filler line 0100") && s.contains(&format!("newest {SUMMARY_LINES} log line(s)")), "{s}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn app010_a_home_outside_the_users_folder_is_stripped_in_every_spelling() {
        // The generic C:\Users\<name> rule cannot see this home: only the home-specific rule can.
        let home = r"D:\Profiles\Some One";
        for text in [
            r"opened D:\Profiles\Some One\proj\src",
            "opened D:/Profiles/Some One/proj/src",
            r"json D:\\Profiles\\Some One\\proj\\src",
            r"opened d:\profiles\SOME ONE\proj\src",
            r"opened d:/PROFILES/some one/proj",
            r"quoted 'D:\Profiles\Some One' and (D:\Profiles\Some One) and D:\Profiles\Some One",
        ] {
            let out = strip_home(text, Some(home));
            for gone in ["Profiles", "Some One", "profiles", "some one", "SOME ONE", "PROFILES"] {
                assert!(!out.contains(gone), "{gone} survived in {out:?} (from {text:?})");
            }
            assert!(out.contains('~'), "{out:?}");
        }
        assert_eq!(strip_home(r"in D:\Profiles\Some One\proj", Some(home)), r"in ~\proj");
        assert_eq!(strip_home(r"a D:\Profiles\Some One, b", Some(home)), "a ~, b");
    }

    #[test]
    fn app010_a_home_name_that_is_a_prefix_of_another_name_leaves_the_other_alone() {
        // Home C:\Users\jo must not turn C:\Users\joe\x into ~e\x.
        assert_eq!(strip_home(r"C:\Users\jo\x and C:\Users\jo", Some(r"C:\Users\jo")), r"~\x and ~");
        let out = strip_home(r"C:\Users\joe\x", Some(r"C:\Users\jo"));
        assert!(!out.contains("~e"), "{out}");
        assert_eq!(out, r"~\x", "the generic rule still hides joe, but whole");
        // Where the generic rule does not apply, the other name stays untouched.
        assert_eq!(strip_home(r"D:\Profiles\joe\x", Some(r"D:\Profiles\jo")), r"D:\Profiles\joe\x");
        assert_eq!(strip_home(r"D:\Profiles\jo\x", Some(r"D:\Profiles\jo")), r"~\x");
        assert_eq!(strip_home(r#"path "D:\Profiles\jo""#, Some(r"D:\Profiles\jo")), r#"path "~""#);
    }

    #[test]
    fn temporary_aws_keys_are_masked_like_long_lived_ones() {
        let out = scrub("sts ASIAQWERTYUIOP123456 and AKIAQWERTYUIOP123456 and ASIASHORT end");
        assert_eq!(out, "sts [masked] and [masked] and ASIASHORT end");
        assert_eq!(scrub(&out), out);
    }

    #[test]
    fn app041_logs_rotate_past_the_file_cap_the_oldest_go_past_the_total_and_the_bundle_is_scrubbed() {
        let dir = temp_dir("rotate");
        let logs = dir.join("logs");
        // 200 lines of about 110 bytes with a 1 KB file cap and a 3 KB total: around 22 files written,
        // at most three kept aside.
        for i in 0..200 {
            write_capped(&dir, &format!("line {i:04} {}", "x".repeat(90)), 1024, 3 * 1024);
        }
        let old = rotated(&logs);
        let total: u64 = old.iter().map(|(_, n)| n).sum();
        assert!((1..=3).contains(&old.len()), "{} files aside", old.len());
        assert!(total <= 3 * 1024, "{total} bytes aside");
        // (The live file is absent right after a write that moved it aside; the next write starts it over.)
        let all: String = old.iter().map(|(p, _)| fs::read_to_string(p).unwrap()).chain([fs::read_to_string(logs.join(LIVE)).unwrap_or_default()]).collect();
        assert!(all.contains("line 0199"), "the newest line is kept");
        assert!(!all.contains("line 0000"), "the oldest line is gone");
        // Writing never fails the action: a folder that cannot exist is skipped quietly.
        let blocked = dir.join("file-not-folder");
        fs::write(&blocked, "x").unwrap();
        write(&blocked, "nothing happens");
        // The bundle: every file oldest first under a header, the secret masked, the start line kept.
        write(&dir, "app start 7, Kolux RS 0.1.0");
        write(&dir, "pane env ANTHROPIC_API_KEY=sk-ant-BUNDLESECRET123456 leaked");
        let b = bundle(&dir, "0.1.0");
        assert!(b.starts_with("Kolux RS 0.1.0 diagnostics, "), "{b}");
        let heads: Vec<usize> = old.iter().map(|(p, _)| b.find(&format!("== {} ==", p.file_name().unwrap().to_string_lossy())).unwrap()).collect();
        assert!(heads.windows(2).all(|w| w[0] < w[1]), "oldest first: {heads:?}");
        assert!(heads.last().unwrap() < &b.find("== kolux.log ==").unwrap());
        assert!(!b.contains("BUNDLESECRET"), "{b}");
        assert!(b.contains("ANTHROPIC_API_KEY=[masked] leaked") && b.contains("app start 7, Kolux RS 0.1.0"), "{b}");
        let _ = fs::remove_dir_all(&dir);
    }
}
