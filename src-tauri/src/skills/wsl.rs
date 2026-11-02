//! SKILL-021: skills inside a WSL distribution. The distribution is the one the open project lives
//! in. Kolux asks it for the skill folders through a small shell script (one `wsl.exe` call per
//! folder, run through the `Runner` below so tests use a fake) and reads the answer strictly: an
//! answer that is cut off, has no end line or has a broken line is an error, never an empty list.
//! Plugins inside WSL and the distribution's own plugin caches are not read (kolux-rs-after.md).
//! SKILL-022 (T-180-b): a skill the scan listed is deleted the same way, by a second small script
//! run in the project's distribution (`DELETE_SCRIPT`, `Runner::delete`), never through the share.

use base64::Engine;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
/// The first line of every answer.
const HEADER: &str = "KOLUX-WSL-SKILLS 1";
/// An answer is read up to this many bytes; more is an error, not a shorter list.
const ANSWER_LIMIT: usize = 8 * 1024 * 1024;

/// SKILL-022: the first line of a delete answer.
const DELETE_HEADER: &str = "KOLUX-WSL-DELETE 1";
/// A delete step inside a distribution that takes longer than this is given up as a failure.
const DELETE_LIMIT: Duration = Duration::from_secs(60);

/// SKILL-022: what the delete script is asked to do with one skill folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Step {
    /// Say what is there (folder or link, its change time, a link's target) and change nothing.
    Check,
    /// Remove it: a folder whole, a link by itself.
    Delete,
}

impl Step {
    fn word(self) -> &'static str {
        match self {
            Step::Check => "check",
            Step::Delete => "delete",
        }
    }
}

/// Runs the folder script in a distribution. `dir` is a folder in it; `~/` stands for its home.
pub trait Runner: Send + Sync {
    fn run(&self, distro: &str, dir: &str, cancel: &AtomicBool) -> Result<Vec<u8>, String>;
    /// SKILL-022: runs the delete script on `dir`, a skill folder right under `root` (one of the
    /// scanned skill folders, `~/` for the distribution's home), for one `step`.
    fn delete(&self, distro: &str, root: &str, dir: &str, step: Step) -> Result<Vec<u8>, String>;
}

/// No WSL at hand: every call fails with a plain reason (tests that do not care about WSL).
#[cfg(test)]
pub struct Unavailable;

#[cfg(test)]
impl Runner for Unavailable {
    fn run(&self, _distro: &str, _dir: &str, _cancel: &AtomicBool) -> Result<Vec<u8>, String> {
        Err("WSL is not available on this computer".into())
    }

    fn delete(&self, _distro: &str, _root: &str, _dir: &str, _step: Step) -> Result<Vec<u8>, String> {
        Err("WSL is not available on this computer".into())
    }
}

/// One shell line, run as `sh -c <SCRIPT> kolux <dir>`. It prints the header, `NOTFOUND` when the
/// folder is missing, one `SKILL` line per skill file and `END <count>` last.
pub const SCRIPT: &str = r#"set -f; D="$1"; case "$D" in "~/"*) D="$HOME/${D#??}";; esac; echo "KOLUX-WSL-SKILLS 1"; if [ ! -d "$D" ]; then echo NOTFOUND; echo "END 0"; exit 0; fi; find -L "$D" -maxdepth 5 -name SKILL.md -type f 2>/dev/null | sort | { n=0; while IFS= read -r f; do d=$(dirname "$f"); r=$(readlink -f "$d" 2>/dev/null || echo "$d"); m=$(stat -c %Y "$f" 2>/dev/null || echo 0); p=$(printf %s "$d" | base64 | tr -d '\n'); q=$(printf %s "$r" | base64 | tr -d '\n'); t=$(head -c 8192 "$f" 2>/dev/null | base64 | tr -d '\n'); printf 'SKILL\t%s\t%s\t%s\t%s\n' "$p" "$q" "$m" "$t"; n=$((n+1)); done; echo "END $n"; }"#;

/// SKILL-022: one shell line, run as `sh -c <DELETE_SCRIPT> kolux <check|delete> <root> <dir>`. It
/// prints the header and then exactly one line: `OUTSIDE` when `dir` is not right under `root`
/// (checked after `~/` has become the distribution's own home), `GONE` when nothing is there,
/// `FAIL <reason>` when something could not be done, or `OK <folder|link> <change time of
/// SKILL.md> <link target, base64>` once the step is done. Only the delete step removes anything:
/// a link goes by itself (`rm`), so its target stays; a folder goes whole (`rm -rf`).
pub const DELETE_SCRIPT: &str = r#"set -f; M="$1"; R="$2"; P="$3"; case "$R" in "~/"*) R="$HOME/${R#??}";; esac; R="${R%/}"; echo "KOLUX-WSL-DELETE 1"; N="${P##*/}"; if [ "${P%/*}" != "$R" ] || [ -z "$N" ] || [ "$N" = . ] || [ "$N" = .. ]; then echo OUTSIDE; exit 0; fi; if [ -L "$P" ]; then K=link; elif [ -d "$P" ]; then K=folder; elif [ -e "$P" ]; then echo "FAIL $P is not a folder"; exit 0; else echo GONE; exit 0; fi; m=$(stat -c %Y "$P/SKILL.md" 2>/dev/null || echo 0); t=""; if [ "$K" = link ]; then t=$(readlink -f "$P" 2>/dev/null | tr -d '\n' | base64 | tr -d '\n'); fi; if [ "$M" = delete ]; then if [ "$K" = link ]; then e=$(rm "$P" 2>&1); else e=$(rm -rf "$P" 2>&1); fi; if [ -e "$P" ] || [ -L "$P" ]; then echo "FAIL $(printf %s "$e" | tr '\n\t' '  ')"; exit 0; fi; fi; echo "OK $K $m $t""#;

/// `wsl.exe -d <distro> --exec sh -c <SCRIPT> kolux <dir>`, hidden, killed when `cancel` is set.
pub struct Real;

impl Real {
    /// One hidden `wsl.exe -d <distro> --exec sh -c <script> kolux <args..>` call, read to the end.
    /// Stopped (killed) when `cancel` is set or `limit` passes; a non-zero exit is an error.
    fn call(distro: &str, script: &str, args: &[&str], cancel: &AtomicBool, limit: Option<Duration>, stopped: &str) -> Result<Vec<u8>, String> {
        use std::io::Read;
        use std::process::{Command, Stdio};
        if !safe_name(distro) {
            return Err(format!("{distro:?} is not a distribution name Kolux will pass to WSL"));
        }
        let mut cmd = Command::new("wsl.exe");
        cmd.args(["-d", distro, "--exec", "sh", "-c", script, "kolux"]).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start wsl.exe: {e}"))?;
        let out = child.stdout.take().ok_or("Could not read from wsl.exe")?;
        let reader = std::thread::spawn(move || {
            let mut buf = vec![];
            let _ = out.take(ANSWER_LIMIT as u64 + 1).read_to_end(&mut buf);
            buf
        });
        let deadline = limit.map(|l| std::time::Instant::now() + l);
        let status = loop {
            if cancel.load(Ordering::Relaxed) || deadline.is_some_and(|d| std::time::Instant::now() >= d) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(stopped.into());
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(e) => return Err(format!("wsl.exe: {e}")),
            }
        };
        let buf = reader.join().map_err(|_| "The WSL answer could not be read".to_string())?;
        if !status.success() {
            return Err(format!("wsl.exe ended with {}", status.code().map_or("no exit code".into(), |c| format!("exit code {c}"))));
        }
        Ok(buf)
    }
}

impl Runner for Real {
    fn run(&self, distro: &str, dir: &str, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
        Real::call(distro, SCRIPT, &[dir], cancel, None, "The WSL scan was stopped")
    }

    fn delete(&self, distro: &str, root: &str, dir: &str, step: Step) -> Result<Vec<u8>, String> {
        let never = AtomicBool::new(false);
        Real::call(distro, DELETE_SCRIPT, &[step.word(), root, dir], &never, Some(DELETE_LIMIT), &format!("The delete inside WSL took longer than {} seconds", DELETE_LIMIT.as_secs()))
    }
}

/// A distribution name made only of letters, digits, dot, dash and underscore.
pub fn safe_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// `\\wsl$\Ubuntu\home\me\repo` (or `\\wsl.localhost\...`, or the long `\\?\UNC\wsl...` form) ->
/// (`Ubuntu`, `/home/me/repo`). None for any other path, a name WSL would not take or a `..`.
pub fn split(p: &Path) -> Option<(String, String)> {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = match s.get(..8).filter(|h| h.eq_ignore_ascii_case("\\\\?\\UNC\\")) {
        Some(_) => format!("\\\\{}", &s[8..]),
        None => s,
    };
    let rest = s.strip_prefix("\\\\")?;
    let mut parts = rest.split('\\');
    let host = parts.next()?.to_ascii_lowercase();
    if host != "wsl$" && host != "wsl.localhost" {
        return None;
    }
    let distro = parts.next().filter(|d| safe_name(d))?.to_string();
    let mut linux = String::new();
    for seg in parts.filter(|s| !s.is_empty()) {
        if seg == ".." || seg == "." || seg.contains('\0') {
            return None;
        }
        linux.push('/');
        linux.push_str(seg);
    }
    if linux.is_empty() {
        linux.push('/');
    }
    Some((distro, linux))
}

/// The Windows path of a place inside a distribution.
pub fn unc(distro: &str, linux: &str) -> PathBuf {
    let mut s = format!("\\\\wsl.localhost\\{distro}");
    for seg in linux.split('/').filter(|s| !s.is_empty()) {
        s.push('\\');
        s.push_str(seg);
    }
    PathBuf::from(s)
}

/// One skill the distribution reported.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    /// The skill folder as listed (absolute, Linux form).
    pub dir: String,
    /// The same folder with links resolved, to list a skill reached twice once.
    pub real: String,
    /// Last change of the skill file in milliseconds since 1970 (None when the distribution gave 0).
    pub updated: Option<u64>,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub enum Answer {
    NotFound,
    Skills(Vec<Found>),
}

fn bad(why: &str) -> String {
    format!("WSL gave an answer Kolux could not read ({why})")
}

fn decode(field: &str) -> Result<Vec<u8>, String> {
    B64.decode(field.as_bytes()).map_err(|_| bad("a field is not valid"))
}

/// Read one answer strictly: header, then either `NOTFOUND` and `END 0`, or `SKILL` lines and an
/// `END` line whose count matches. Lines before the header (a message of WSL's own) are skipped;
/// anything else out of shape makes the whole answer an error.
pub fn parse(bytes: &[u8]) -> Result<Answer, String> {
    if bytes.len() > ANSWER_LIMIT {
        return Err(bad("it is longer than Kolux reads"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| bad("it is not text"))?;
    let mut lines = text.lines().map(|l| l.trim_end_matches('\r'));
    if !lines.any(|l| l == HEADER) {
        return Err(bad("it does not start with the expected line"));
    }
    let mut skills = vec![];
    let mut missing = false;
    let mut ended = None;
    for line in lines {
        if ended.is_some() {
            if line.is_empty() {
                continue;
            }
            return Err(bad("there is more after the last line"));
        }
        if line == "NOTFOUND" {
            if missing || !skills.is_empty() {
                return Err(bad("the folder is both missing and listed"));
            }
            missing = true;
        } else if let Some(n) = line.strip_prefix("END ") {
            ended = Some(n.parse::<usize>().map_err(|_| bad("the count is not a number"))?);
        } else if let Some(rest) = line.strip_prefix("SKILL\t") {
            if missing {
                return Err(bad("the folder is both missing and listed"));
            }
            let f: Vec<&str> = rest.split('\t').collect();
            if f.len() != 4 {
                return Err(bad("a skill line is cut short"));
            }
            let dir = String::from_utf8(decode(f[0])?).map_err(|_| bad("a folder name is not text"))?;
            let real = String::from_utf8(decode(f[1])?).map_err(|_| bad("a folder name is not text"))?;
            if !dir.starts_with('/') || !real.starts_with('/') || dir.split('/').any(|s| s == "..") {
                return Err(bad("a folder is not an absolute path"));
            }
            let secs: u64 = f[2].parse().map_err(|_| bad("a time is not a number"))?;
            let text = String::from_utf8_lossy(&decode(f[3])?).into_owned();
            skills.push(Found { dir, real, updated: (secs > 0).then(|| secs.saturating_mul(1000)), text });
        } else {
            return Err(bad("a line has an unexpected shape"));
        }
    }
    match ended {
        None => Err(bad("it ends before the last line")),
        Some(n) if n != skills.len() => Err(bad("the count does not match the lines")),
        Some(_) if missing => Ok(Answer::NotFound),
        Some(_) => Ok(Answer::Skills(skills)),
    }
}

/// SKILL-022: what the distribution said about one skill folder.
#[derive(Debug, Clone, PartialEq)]
pub enum Reply {
    /// A skill folder; `updated` is the change time of its SKILL.md in milliseconds since 1970.
    Folder { updated: Option<u64> },
    /// A link where a skill folder would be, and where it really leads (absolute, Linux form).
    Link { updated: Option<u64>, target: String },
    /// Nothing is there.
    Gone,
    /// The folder is not right under the skill folder named, once `~/` is the real home.
    Outside,
    /// The step could not be done; the reason is the command's own words.
    Fail(String),
}

/// Read a delete answer strictly: the header, then exactly one verdict line and nothing else.
/// Lines before the header (a message of WSL's own) are skipped.
pub fn parse_reply(bytes: &[u8]) -> Result<Reply, String> {
    if bytes.len() > ANSWER_LIMIT {
        return Err(bad("it is longer than Kolux reads"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| bad("it is not text"))?;
    let mut lines = text.lines().map(|l| l.trim_end_matches('\r'));
    if !lines.any(|l| l == DELETE_HEADER) {
        return Err(bad("it does not start with the expected line"));
    }
    let mut rest = lines.filter(|l| !l.is_empty());
    let line = rest.next().ok_or_else(|| bad("it ends before the answer"))?;
    if rest.next().is_some() {
        return Err(bad("there is more after the answer"));
    }
    if line == "GONE" {
        return Ok(Reply::Gone);
    }
    if line == "OUTSIDE" {
        return Ok(Reply::Outside);
    }
    if let Some(why) = line.strip_prefix("FAIL").filter(|w| w.is_empty() || w.starts_with(' ')) {
        let why = why.trim();
        return Ok(Reply::Fail(if why.is_empty() { "no reason was given".into() } else { why.into() }));
    }
    let Some(ok) = line.strip_prefix("OK ") else { return Err(bad("the answer has an unexpected shape")) };
    let mut f = ok.split_whitespace();
    let kind = f.next().ok_or_else(|| bad("the answer is cut short"))?;
    let secs: u64 = f.next().ok_or_else(|| bad("the answer is cut short"))?.parse().map_err(|_| bad("a time is not a number"))?;
    let updated = (secs > 0).then(|| secs.saturating_mul(1000));
    match kind {
        "folder" => Ok(Reply::Folder { updated }),
        "link" => {
            let target = String::from_utf8(decode(f.next().ok_or_else(|| bad("a link has no target"))?)?).map_err(|_| bad("a folder name is not text"))?;
            if !target.starts_with('/') {
                return Err(bad("a folder is not an absolute path"));
            }
            Ok(Reply::Link { updated, target })
        }
        _ => Err(bad("the answer names something that is neither a folder nor a link")),
    }
}

/// Build an answer the way the script prints it (tests only).
#[cfg(test)]
pub fn answer_for(skills: &[(&str, &str, &str)]) -> String {
    let mut out = format!("{HEADER}\n");
    for (dir, real, text) in skills {
        out.push_str(&format!("SKILL\t{}\t{}\t1700000000\t{}\n", B64.encode(dir), B64.encode(real), B64.encode(text)));
    }
    out.push_str(&format!("END {}\n", skills.len()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_reads_every_wsl_path_form() {
        assert_eq!(split(Path::new("\\\\wsl$\\Ubuntu\\home\\me\\repo")), Some(("Ubuntu".into(), "/home/me/repo".into())));
        assert_eq!(split(Path::new("\\\\wsl.localhost\\Debian-12\\")), Some(("Debian-12".into(), "/".into())));
        assert_eq!(split(Path::new("\\\\?\\UNC\\wsl.localhost\\Ubuntu\\srv\\x")), Some(("Ubuntu".into(), "/srv/x".into())));
        assert_eq!(split(Path::new("//WSL$/Ubuntu/a")), Some(("Ubuntu".into(), "/a".into())));
    }

    #[test]
    fn split_refuses_other_hosts_odd_names_and_dotdot() {
        assert_eq!(split(Path::new("\\\\server\\share\\x")), None);
        assert_eq!(split(Path::new("C:\\Users\\me")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\Ubu ntu\\a")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\Ubuntu\\a\\..\\b")), None);
    }

    #[test]
    fn unc_goes_back_to_a_windows_path() {
        assert_eq!(unc("Ubuntu", "/home/me/.claude/skills/x"), PathBuf::from("\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\skills\\x"));
    }

    #[test]
    fn a_good_answer_lists_its_skills() {
        let a = answer_for(&[("/home/me/.claude/skills/pdf", "/home/me/.claude/skills/pdf", "# pdf\n"), ("/h/b", "/h/b", "")]);
        let Answer::Skills(s) = parse(a.as_bytes()).unwrap() else { panic!("not skills") };
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].dir, "/home/me/.claude/skills/pdf");
        assert_eq!(s[0].text, "# pdf\n");
        assert_eq!(s[0].updated, Some(1_700_000_000_000));
    }

    #[test]
    fn a_missing_folder_is_not_found_and_an_empty_one_is_an_empty_list() {
        assert_eq!(parse(b"KOLUX-WSL-SKILLS 1\nNOTFOUND\nEND 0\n").unwrap(), Answer::NotFound);
        assert_eq!(parse(b"KOLUX-WSL-SKILLS 1\r\nEND 0\r\n").unwrap(), Answer::Skills(vec![]));
    }

    #[test]
    fn garbled_answers_are_errors_never_an_empty_list() {
        let good = answer_for(&[("/a/b", "/a/b", "# b\n")]);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("no header", b"hello\nEND 0\n".to_vec()),
            ("cut before END", good.replace("END 1\n", "").into_bytes()),
            ("count mismatch", good.replace("END 1", "END 2").into_bytes()),
            ("count not a number", good.replace("END 1", "END x").into_bytes()),
            ("skill cut short", "KOLUX-WSL-SKILLS 1\nSKILL\tYQ==\nEND 1\n".as_bytes().to_vec()),
            ("bad base64", "KOLUX-WSL-SKILLS 1\nSKILL\t!!\t!!\t5\t\nEND 1\n".as_bytes().to_vec()),
            ("relative folder", format!("KOLUX-WSL-SKILLS 1\nSKILL\t{}\t{}\t5\t\nEND 1\n", B64.encode("a/b"), B64.encode("a/b")).into_bytes()),
            ("not text", vec![0xff, 0xfe, 0x00, 0x01]),
            ("stray line", "KOLUX-WSL-SKILLS 1\nwhat\nEND 0\n".as_bytes().to_vec()),
            ("junk after END", format!("{good}more\n").into_bytes()),
            ("missing and listed", "KOLUX-WSL-SKILLS 1\nNOTFOUND\nSKILL\tYQ==\nEND 1\n".as_bytes().to_vec()),
        ];
        for (why, bytes) in cases {
            assert!(parse(&bytes).is_err(), "{why} must be an error");
        }
    }

    #[test]
    fn a_message_of_wsls_own_before_the_header_is_skipped() {
        let a = format!("wsl: some notice\n{}", answer_for(&[]));
        assert_eq!(parse(a.as_bytes()).unwrap(), Answer::Skills(vec![]));
    }

    #[test]
    fn the_script_shape_is_one_line_with_the_header_and_end() {
        assert!(!SCRIPT.contains('\n'));
        assert!(SCRIPT.contains(HEADER) && SCRIPT.contains("END $n") && SCRIPT.contains("head -c 8192"));
    }

    // SKILL-022 (T-180-b): the delete script and its one-line answer.

    #[test]
    fn a_delete_answer_is_read_strictly() {
        let target = B64.encode("/real/pdf");
        assert_eq!(parse_reply(b"KOLUX-WSL-DELETE 1\nOK folder 1700000000 \n").unwrap(), Reply::Folder { updated: Some(1_700_000_000_000) });
        assert_eq!(parse_reply(b"KOLUX-WSL-DELETE 1\nOK folder 0\n").unwrap(), Reply::Folder { updated: None });
        assert_eq!(parse_reply(format!("KOLUX-WSL-DELETE 1\r\nOK link 1700000000 {target}\r\n").as_bytes()).unwrap(), Reply::Link { updated: Some(1_700_000_000_000), target: "/real/pdf".into() });
        assert_eq!(parse_reply(b"wsl: a notice of its own\nKOLUX-WSL-DELETE 1\nGONE\n").unwrap(), Reply::Gone);
        assert_eq!(parse_reply(b"KOLUX-WSL-DELETE 1\nOUTSIDE\n").unwrap(), Reply::Outside);
        assert_eq!(parse_reply(b"KOLUX-WSL-DELETE 1\nFAIL rm: cannot remove 'x': Permission denied\n").unwrap(), Reply::Fail("rm: cannot remove 'x': Permission denied".into()));
        assert_eq!(parse_reply(b"KOLUX-WSL-DELETE 1\nFAIL\n").unwrap(), Reply::Fail("no reason was given".into()));
        let garbled: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("no header", b"OK folder 5\n".to_vec()),
            ("header only", b"KOLUX-WSL-DELETE 1\n".to_vec()),
            ("scan header", b"KOLUX-WSL-SKILLS 1\nEND 0\n".to_vec()),
            ("stray word", b"KOLUX-WSL-DELETE 1\nnonsense\n".to_vec()),
            ("two verdicts", b"KOLUX-WSL-DELETE 1\nGONE\nGONE\n".to_vec()),
            ("junk after", b"KOLUX-WSL-DELETE 1\nGONE\nmore\n".to_vec()),
            ("time not a number", b"KOLUX-WSL-DELETE 1\nOK folder x\n".to_vec()),
            ("unknown kind", b"KOLUX-WSL-DELETE 1\nOK file 5\n".to_vec()),
            ("link without target", b"KOLUX-WSL-DELETE 1\nOK link 5\n".to_vec()),
            ("link target not base64", b"KOLUX-WSL-DELETE 1\nOK link 5 !!\n".to_vec()),
            ("link target relative", format!("KOLUX-WSL-DELETE 1\nOK link 5 {}\n", B64.encode("a/b")).into_bytes()),
            ("not text", vec![0xff, 0xfe, 0x00, 0x01]),
        ];
        for (why, bytes) in garbled {
            let e = parse_reply(&bytes).unwrap_err();
            assert!(e.contains("could not read"), "{why} must be a garbled-answer error, got {e}");
        }
    }

    #[test]
    fn the_delete_script_removes_a_link_itself_and_a_folder_whole_and_never_leaves_its_root() {
        assert!(!DELETE_SCRIPT.contains('\n'));
        assert!(DELETE_SCRIPT.contains(DELETE_HEADER));
        // A link goes with `rm` (its target stays); a folder with `rm -rf`; the path must sit right
        // under the root, checked after `~/` becomes the distribution's own home.
        assert!(DELETE_SCRIPT.contains(r#"rm "$P""#) && DELETE_SCRIPT.contains(r#"rm -rf "$P""#));
        assert!(DELETE_SCRIPT.contains("$HOME/") && DELETE_SCRIPT.contains("OUTSIDE") && DELETE_SCRIPT.contains("GONE") && DELETE_SCRIPT.contains("FAIL "));
        assert!(DELETE_SCRIPT.contains("[ \"$M\" = delete ]"), "only the delete step removes anything");
    }

    /// The delete script itself, run by a real `sh` (what a distribution runs; Unix only): a check
    /// changes nothing, a link goes by itself and its target stays, a folder goes whole, and a path
    /// not right under the root, a missing folder or a plain file are answered without removing
    /// anything.
    #[cfg(unix)]
    #[test]
    fn skill022_wsl_the_delete_script_run_by_a_real_shell_keeps_a_links_target_and_never_leaves_its_root() {
        use std::fs;
        let home = std::env::temp_dir().join(format!("kolux-wsl-delete-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let root = home.join(".claude/skills");
        let real = home.join("dev/pdf");
        let other = home.join("elsewhere/keep");
        for d in [root.join("one"), real.clone(), other.clone()] {
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        }
        std::os::unix::fs::symlink(&real, root.join("pdf")).unwrap();
        fs::write(root.join("plain"), "not a folder").unwrap();
        let sh = |step: &str, root: &str, dir: &Path| {
            let out = std::process::Command::new("sh").env("HOME", &home).args(["-c", DELETE_SCRIPT, "kolux", step, root, dir.to_str().unwrap()]).output().unwrap();
            assert!(out.status.success(), "{out:?}");
            parse_reply(&out.stdout).unwrap()
        };
        let (one, pdf) = (root.join("one"), root.join("pdf"));
        // A check names the folder and the link and removes neither.
        assert!(matches!(sh("check", "~/.claude/skills", &one), Reply::Folder { updated: Some(_) }));
        let target = real.canonicalize().unwrap().to_string_lossy().to_string();
        assert!(matches!(sh("check", "~/.claude/skills/", &pdf), Reply::Link { target: ref t, .. } if *t == target));
        assert!(one.join("SKILL.md").exists() && fs::symlink_metadata(&pdf).is_ok());
        // Outside the root (another folder, a `..` step, the root itself) is refused untouched.
        assert_eq!(sh("delete", "~/.claude/skills", &other), Reply::Outside);
        assert_eq!(sh("delete", "~/.claude/skills", &root.join("..").join("x")), Reply::Outside);
        assert_eq!(sh("delete", "~/.claude/skills", &root), Reply::Outside);
        assert_eq!(sh("delete", "~/.codex/skills", &one), Reply::Outside);
        assert!(other.join("SKILL.md").exists() && one.exists());
        // A plain file is a failure; a missing folder is gone.
        assert!(matches!(sh("delete", "~/.claude/skills", &root.join("plain")), Reply::Fail(ref w) if w.contains("not a folder")));
        assert!(root.join("plain").exists());
        assert_eq!(sh("delete", "~/.claude/skills", &root.join("missing")), Reply::Gone);
        // The link goes by itself; what it points at stays whole.
        assert!(matches!(sh("delete", "~/.claude/skills", &pdf), Reply::Link { .. }));
        assert!(fs::symlink_metadata(&pdf).is_err(), "the link is gone");
        assert!(real.join("SKILL.md").exists(), "the link's target stays");
        // A folder goes whole, and a project folder root is matched as written.
        assert!(matches!(sh("delete", root.to_str().unwrap(), &one), Reply::Folder { .. }));
        assert!(!one.exists());
        assert_eq!(sh("delete", "~/.claude/skills", &one), Reply::Gone);
        let _ = fs::remove_dir_all(&home);
    }
}
