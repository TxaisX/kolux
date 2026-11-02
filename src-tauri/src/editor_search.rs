// Searching file contents across a worktree (EDIT-037). ripgrep answers; without it, git's own
// grep stands in where the folder is a repository. By default the search is plain text, ignores
// case, covers hidden files and skips the git folder; match case, whole word and regular
// expression are options. Include and exclude take comma-separated patterns, a bare pattern
// matching at any depth and a backslash before a comma making it literal. Results are capped,
// long lines are trimmed around the hit, a slow search is stopped, an overly long query is
// refused, and a search that fails says why instead of finding nothing.
use std::io::{BufRead, BufReader, Read};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_QUERY: usize = 1000;
const MAX_HITS: usize = 2000;
const TIMEOUT: Duration = Duration::from_secs(15);
/// Characters of a long line kept on each side of the hit.
const SIDE: usize = 80;
/// FIX-3 (council P5): characters of the hit itself sent to the window; a longer one (a regex
/// spanning a minified line) is cut here and ends with an ellipsis, while `len` keeps its real length.
const TEXT_MAX: usize = 200;
/// FIX-3 (council P5): ripgrep skips files bigger than this (a dump or a bundle, not source).
const MAX_FILESIZE: &str = "10M";
/// How often a running search looks whether a newer one for the same folder has replaced it.
const POLL: Duration = Duration::from_millis(50);
/// The error a replaced search ends with; the window has already moved on and drops it.
pub const SUPERSEDED: &str = "A newer search of this folder replaced this one.";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    query: String,
    #[serde(default)]
    match_case: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    include: String,
    #[serde(default)]
    exclude: String,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Hit {
    /// 1-based line.
    line: u64,
    /// Where the hit starts in the line, in UTF-16 units (what the editor counts).
    col: usize,
    before: String,
    text: String,
    after: String,
    /// The hit's full length in UTF-16 units; `text` may be cut to TEXT_MAX characters.
    len: usize,
}

#[derive(serde::Serialize, Debug)]
pub struct FileHits {
    /// Relative to the worktree, with forward slashes.
    path: String,
    hits: Vec<Hit>,
}

#[derive(serde::Serialize, Debug)]
pub struct Found {
    files: Vec<FileHits>,
    total: usize,
    capped: bool,
    source: &'static str,
}

/// Comma-separated patterns; `\,` is a comma inside a pattern. Blanks are dropped.
pub fn split_patterns(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&',') => {
                cur.push(',');
                chars.next();
            }
            ',' => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

/// A line cut to the hit at bytes `start..end`, with up to SIDE characters either side. The work
/// is bounded by SIDE, not by the line: a minified one-line file is never counted end to end per hit.
pub fn trim_around(line: &str, start: usize, end: usize) -> (String, String, String) {
    let start = floor(line, start.min(line.len()));
    let end = floor(line, end.clamp(start, line.len()));
    let before = &line[..start];
    let after = &line[end..];
    let cut_before: String = match before.char_indices().rev().nth(SIDE - 1) {
        Some((i, _)) if i > 0 => format!("…{}", &before[i..]),
        _ => before.to_string(),
    };
    let cut_after: String = match after.char_indices().nth(SIDE) {
        Some((i, _)) => format!("{}…", &after[..i]),
        None => after.to_string(),
    };
    let mid = &line[start..end];
    let text = match mid.char_indices().nth(TEXT_MAX) {
        Some((i, _)) => format!("{}…", &mid[..i]),
        None => mid.to_string(),
    };
    (cut_before.trim_start().to_string(), text, cut_after)
}

fn floor(s: &str, mut i: usize) -> usize {
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn hit(line_no: u64, line: &str, start: usize, end: usize) -> Hit {
    let line = line.trim_end_matches(['\n', '\r']);
    let col = line[..floor(line, start.min(line.len()))].encode_utf16().count();
    hit_at(line_no, line, start, end, col)
}

// FIX-5 (council d2 AFTER 5): how many hits this thread built, so a test can prove the cap bounds
// the work and not only the result.
#[cfg(test)]
thread_local! {
    static HITS_BUILT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn hit_at(line_no: u64, line: &str, start: usize, end: usize, col: usize) -> Hit {
    #[cfg(test)]
    HITS_BUILT.with(|c| c.set(c.get() + 1));
    let s = floor(line, start.min(line.len()));
    let len = line[s..floor(line, end.clamp(s, line.len()))].encode_utf16().count();
    let (before, text, after) = trim_around(line, start, end);
    Hit { line: line_no, col, before, text, after, len }
}

fn rel(p: &str) -> String {
    let p = p.replace('\\', "/");
    p.strip_prefix("./").unwrap_or(&p).to_string()
}

/// One ripgrep `--json` line turned into at most `limit` hits (none for the other message kinds).
/// FIX-2 (council P1): the cap applies before any hit is built, and the column is one forward scan
/// over the line (submatches come in order), so a line with tens of thousands of matches costs one
/// pass, not one pass per match. (ripgrep's --max-columns does not apply to its JSON output.)
pub fn parse_rg(line: &str, limit: usize) -> Option<(String, Vec<Hit>)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v["type"] != "match" {
        return None;
    }
    let d = &v["data"];
    let path = rel(d["path"]["text"].as_str()?);
    let text = d["lines"]["text"].as_str()?;
    let no = d["line_number"].as_u64()?;
    let text = text.trim_end_matches(['\n', '\r']);
    let (mut at, mut col) = (0usize, 0usize);
    let mut hits = Vec::new();
    for m in d["submatches"].as_array()?.iter().take(limit) {
        let (Some(s), Some(e)) = (m["start"].as_u64(), m["end"].as_u64()) else { continue };
        let s = floor(text, (s as usize).min(text.len()));
        if s < at {
            continue;
        }
        col += text[at..s].encode_utf16().count();
        at = s;
        hits.push(hit_at(no, text, s, e as usize, col));
    }
    Some((path, hits))
}

/// One `git grep -z -n --column` line: path, line, 1-based byte column, text. git gives only where
/// the first hit starts, so a plain-text hit is as long as the query.
// ponytail: a regex hit in git's fallback is marked from its start with no length; ripgrep gives real spans.
pub fn parse_git(line: &str, fixed_len: Option<usize>) -> Option<(String, Vec<Hit>)> {
    let mut parts = line.splitn(4, '\0');
    let path = rel(parts.next()?);
    let no: u64 = parts.next()?.parse().ok()?;
    let col: usize = parts.next()?.parse().ok()?;
    let text = parts.next()?;
    let start = col.saturating_sub(1);
    Some((path, vec![hit(no, text, start, start + fixed_len.unwrap_or(0))]))
}

/// ripgrep's arguments for `a`, searching the working folder; the same whether ripgrep runs here
/// or inside a WSL distribution.
fn rg_args(a: &Ask) -> Vec<String> {
    let mut args: Vec<String> = ["--json", "--hidden", "--no-config", "--no-messages", "--max-filesize", MAX_FILESIZE, "-g", "!.git/"].map(String::from).to_vec();
    args.push(if a.match_case { "-s" } else { "-i" }.into());
    if a.whole_word {
        args.push("-w".into());
    }
    if !a.regex {
        args.push("-F".into());
    }
    for p in split_patterns(&a.include) {
        args.extend(["-g".into(), p]);
    }
    for p in split_patterns(&a.exclude) {
        args.extend(["-g".into(), format!("!{p}")]);
    }
    args.extend(["-e".into(), a.query.clone(), "--".into(), ".".into()]);
    args
}

fn rg_command(root: &Path, a: &Ask) -> Command {
    let mut cmd = Command::new("rg");
    cmd.args(rg_args(a)).current_dir(root);
    cmd
}

/// EDIT-044 (T-062-b): a root inside a WSL distribution, `\\wsl$\<distro>\...` or
/// `\\wsl.localhost\<distro>\...` (either slash, the share's name case-blind, the long-path
/// `\\?\UNC\` form too): the distribution's name and the folder as Linux spells it (`/` for the
/// distribution's own root). None for every other path.
pub fn wsl_root(root: &Path) -> Option<(String, String)> {
    let s = root.to_string_lossy().replace('/', "\\");
    let lower = s.to_ascii_lowercase();
    let s = match lower.strip_prefix("\\\\?\\unc\\") {
        Some(_) => format!("\\\\{}", &s[8..]),
        None => s,
    };
    let lower = s.to_ascii_lowercase();
    let head = ["\\\\wsl.localhost\\", "\\\\wsl$\\"].into_iter().find(|h| lower.starts_with(h))?.len();
    let (distro, tail) = s[head..].split_once('\\').unwrap_or((&s[head..], ""));
    if distro.is_empty() {
        return None;
    }
    Some((distro.to_string(), format!("/{}", tail.replace('\\', "/"))))
}

/// EDIT-044: ripgrep inside the distribution, with the same arguments as a local search, run from
/// the folder as Linux spells it so the hits come back `./relative` and map onto the root as they
/// do locally. `-e` runs the command without the distribution's shell in between, so the query
/// and the patterns reach ripgrep exactly as typed. ripgrep has to be installed in the
/// distribution; the Windows side needs no working folder on the share.
fn wsl_rg_command(distro: &str, linux_root: &str, a: &Ask) -> Command {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "--cd", linux_root, "-e", "rg"]).args(rg_args(a));
    cmd
}

/// EDIT-044: what a search command wrote to its error stream. wsl.exe writes its own messages
/// (no such distribution, no such command) in UTF-16, ripgrep and git in UTF-8.
fn stderr_text(bytes: &[u8]) -> String {
    let utf16 = bytes.len() >= 2 && bytes.len().is_multiple_of(2) && (bytes.starts_with(&[0xFF, 0xFE]) || (bytes[0] != 0 && bytes[1] == 0));
    if utf16 {
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        return String::from_utf16_lossy(&units).trim_start_matches('\u{FEFF}').to_string();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn git_command(root: &Path, a: &Ask) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=off", "grep", "-z", "-n", "--column", "-I", "--no-color", "--untracked"]);
    if !a.match_case {
        cmd.arg("-i");
    }
    if a.whole_word {
        cmd.arg("-w");
    }
    cmd.arg(if a.regex { "-E" } else { "-F" });
    cmd.args(["-e", &a.query, "--"]);
    let inc = split_patterns(&a.include);
    if inc.is_empty() {
        cmd.arg(".");
    }
    for p in inc {
        cmd.arg(format!(":(glob)**/{p}"));
    }
    for p in split_patterns(&a.exclude) {
        cmd.arg(format!(":(glob,exclude)**/{p}"));
    }
    cmd.current_dir(root);
    cmd
}

/// Runs a search command, collecting hits until the cap or the time limit.
/// FIX-3 (council P4): the search running for each folder. A new search of the same folder raises
/// the old one's flag, and the old one kills its ripgrep or git child at once instead of reading on
/// to the cap or the time limit while the user types.
/// FIX-4 (council d2 AFTER 1): each search takes a generation number when its command is called,
/// before the fence step, which can take a while and lets calls reach their folder out of order.
/// A folder remembers the generation of the search that holds it; a search with a lower number than
/// the holder's stops at once instead of stopping the newer one.
static GEN: AtomicU64 = AtomicU64::new(0);

pub fn next_gen() -> u64 {
    GEN.fetch_add(1, Ordering::SeqCst) + 1
}

type Held = (u64, Arc<AtomicBool>);
static RUNNING: Mutex<Option<HashMap<PathBuf, Held>>> = Mutex::new(None);

/// This search's flag for `root`. It takes the folder from a lower generation and raises that one's
/// flag; when the folder is held by a higher generation (a newer search, or a cancel), the flag comes
/// back already raised and the folder is left alone.
fn claim(root: &Path, gen: u64) -> Arc<AtomicBool> {
    match RUNNING.lock() {
        Ok(mut m) => claim_in(m.get_or_insert_with(HashMap::new), root, gen),
        Err(_) => Arc::new(AtomicBool::new(false)),
    }
}

/// `claim` on a map of its own, so a test can fill hundreds of folders without touching `RUNNING`.
fn claim_in(map: &mut HashMap<PathBuf, Held>, root: &Path, gen: u64) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    match map.get(root) {
        Some((held, _)) if *held > gen => flag.store(true, Ordering::SeqCst),
        _ => {
            if let Some((_, old)) = map.insert(root.to_path_buf(), (gen, flag.clone())) {
                old.store(true, Ordering::SeqCst);
            }
        }
    }
    flag
}

/// FIX-4 (council d2 AFTER 7): no view wants `root`'s search any more (its explorer was closed or
/// moved to another folder). The running search stops, and one still on its way through the fence
/// (a lower generation) stops when it arrives.
/// FIX-5 (council d2 AFTER 1): `gen` is the cancel's own number, taken when its command was called,
/// before the fence step, the way a search takes its. A folder held by a higher number (a search
/// asked after this cancel that got through the fence first) is left alone, so a late cancel never
/// stops a newer search.
pub fn cancel(root: &Path, gen: u64) {
    if let Ok(mut m) = RUNNING.lock() {
        cancel_in(m.get_or_insert_with(HashMap::new), root, gen);
    }
}

/// FIX-7 (council d2 FIX-SOON 1): `cancel` on a map of its own, so a test can run many cancels and
/// see that the map stays at `MAX_MARKERS`. `cancel` is only the lock around this.
fn cancel_in(map: &mut HashMap<PathBuf, Held>, root: &Path, gen: u64) {
    if map.get(root).is_some_and(|(held, _)| *held > gen) {
        return;
    }
    if let Some((_, old)) = map.insert(root.to_path_buf(), (gen, Arc::new(AtomicBool::new(true)))) {
        old.store(true, Ordering::SeqCst);
    }
    prune_markers(map, MAX_MARKERS);
}

/// FIX-6 (council d2 AFTER 2): a cancel leaves a raised marker on its folder, so an older search
/// still in the fence stops on arrival. A folder nobody searches again would keep its marker for the
/// whole run; past `keep` entries the oldest raised ones go (a search still in the fence is seconds
/// old, never hundreds of folders old). A search that is still running is never dropped.
/// FIX-7 (council d2 AFTER 1): in this map "flag raised" means "this entry is a marker". That holds
/// because only `cancel_in` inserts an already-raised flag; a search whose flag was raised by a newer
/// claim has been replaced in the map, and a search `claim_in` refused (a higher number holds the
/// folder) was never inserted. Keep both true, or give `Held` an explicit marker field, before any
/// change that leaves a raised flag on a still-running search in the map: it would become prunable.
const MAX_MARKERS: usize = 256;

fn prune_markers(map: &mut HashMap<PathBuf, Held>, keep: usize) {
    if map.len() <= keep {
        return;
    }
    let mut done: Vec<(u64, PathBuf)> = map.iter().filter(|(_, (_, f))| f.load(Ordering::SeqCst)).map(|(k, (g, _))| (*g, k.clone())).collect();
    done.sort();
    for (_, k) in done.into_iter().take(map.len() - keep) {
        map.remove(&k);
    }
}

/// The search behind `flag` is over: forget it unless a newer one already took its place.
fn release(root: &Path, flag: &Arc<AtomicBool>) {
    if let Ok(mut m) = RUNNING.lock() {
        if let Some(map) = m.as_mut() {
            if map.get(root).is_some_and(|(_, f)| Arc::ptr_eq(f, flag)) {
                map.remove(root);
            }
        }
    }
}

/// `wsl`: the command is ripgrep run inside a WSL distribution through wsl.exe (EDIT-044). There a
/// missing ripgrep or folder ends with code 1, the same code as "nothing matched", but with a
/// message; such a search fails with that message instead of finding nothing.
fn run(mut cmd: Command, parse: impl Fn(&str, usize) -> Option<(String, Vec<Hit>)>, source: &'static str, stop: &AtomicBool, wsl: bool) -> Result<Found, std::io::Error> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let out = child.stdout.take().expect("piped");
    let mut err = child.stderr.take().expect("piped");
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let errs = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b);
        stderr_text(&b)
    });
    let deadline = Instant::now() + TIMEOUT;
    let mut files: Vec<FileHits> = Vec::new();
    let (mut total, mut capped, mut late, mut replaced) = (0, false, false, false);
    loop {
        if stop.load(Ordering::SeqCst) {
            replaced = true;
            break;
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            late = true;
            break;
        }
        match rx.recv_timeout(left.min(POLL)) {
            Ok(line) => {
                let Some((path, hits)) = parse(&line, MAX_HITS - total + 1) else { continue };
                for h in hits {
                    if total == MAX_HITS {
                        capped = true;
                        break;
                    }
                    total += 1;
                    match files.last_mut() {
                        Some(f) if f.path == path => f.hits.push(h),
                        _ => files.push(FileHits { path: path.clone(), hits: vec![h] }),
                    }
                }
                if capped {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if capped || late || replaced {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let stderr = errs.join().unwrap_or_default();
    if replaced {
        return Err(std::io::Error::other(SUPERSEDED));
    }
    if late {
        return Err(std::io::Error::other(format!("The search took longer than {} seconds and was stopped; narrow it with an include pattern.", TIMEOUT.as_secs())));
    }
    // ripgrep and git grep both end with 1 when nothing matched; more is a real failure.
    let why = stderr.lines().map(str::trim).find(|l| !l.is_empty());
    let failed = status.code().is_some_and(|c| c > 1) || (wsl && status.code() == Some(1) && why.is_some());
    if !capped && failed && total == 0 {
        return Err(std::io::Error::other(why.unwrap_or("the search command failed").to_string()));
    }
    Ok(Found { files, total, capped, source })
}

#[cfg(test)]
pub fn search(root: &Path, a: &Ask) -> Result<Found, String> {
    search_gen(root, a, next_gen())
}

/// `search` for a call that took its generation number earlier (at command entry).
pub fn search_gen(root: &Path, a: &Ask, gen: u64) -> Result<Found, String> {
    search_with(root, a, gen, wsl_rg_command)
}

/// `search_gen` with the command that searches inside a WSL distribution passed in, so a test can
/// stand in for wsl.exe (present or missing) instead of depending on the machine it runs on.
fn search_with(root: &Path, a: &Ask, gen: u64, wsl_rg: impl Fn(&str, &str, &Ask) -> Command) -> Result<Found, String> {
    if a.query.is_empty() {
        return Ok(Found { files: vec![], total: 0, capped: false, source: "none" });
    }
    if a.query.chars().count() > MAX_QUERY {
        return Err(format!("The search text is longer than {MAX_QUERY} characters."));
    }
    let stop = claim(root, gen);
    if stop.load(Ordering::SeqCst) {
        // a newer search (or a cancel) already holds this folder: nothing to start
        return Err(SUPERSEDED.into());
    }
    // EDIT-044 (T-062-b): a root inside a WSL distribution is searched by ripgrep inside it.
    let wsl = wsl_root(root);
    let cmd = match &wsl {
        Some((distro, linux_root)) => wsl_rg(distro, linux_root, a),
        None => rg_command(root, a),
    };
    let found = match run(cmd, parse_rg, "rg", &stop, wsl.is_some()) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some((distro, _)) = &wsl {
                Err(format!("WSL is not installed here (wsl.exe was not found), so the {distro} distribution cannot be searched."))
            } else if !root.join(".git").exists() {
                Err("ripgrep is not installed and this folder is not a git repository, so there is nothing to search with.".into())
            } else {
                let len = (!a.regex).then_some(a.query.len());
                run(git_command(root, a), |l, _| parse_git(l, len), "git", &stop, false).map_err(|e| e.to_string())
            }
        }
        other => other.map_err(|e| e.to_string()),
    };
    release(root, &stop);
    found
}

#[tauri::command]
pub async fn editor_search(root: String, ask: Ask, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Found, String> {
    let gen = next_gen();
    let root = fence.allow(&root, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || search_gen(&root, &ask, gen)).await.map_err(|e| e.to_string())?
}

/// FIX-4: the explorer that asked for searches of `root` is gone; stop its search.
#[tauri::command]
pub async fn editor_search_cancel(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let gen = next_gen(); // before the fence step, like editor_search (FIX-5)
    let root = fence.allow(&root, &store, &git, false)?;
    cancel(&root, gen);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(q: &str) -> Ask {
        Ask { query: q.into(), match_case: false, whole_word: false, regex: false, include: String::new(), exclude: String::new() }
    }

    #[test]
    fn patterns_split_on_commas_and_a_backslash_keeps_one() {
        assert_eq!(split_patterns("*.ts, src/**  ,,"), vec!["*.ts", "src/**"]);
        assert_eq!(split_patterns(r"a\,b.txt,c"), vec!["a,b.txt", "c"]);
        assert!(split_patterns("  ").is_empty());
    }

    #[test]
    fn long_lines_are_trimmed_around_the_hit() {
        let line = format!("{}TODO{}", "a".repeat(200), "b".repeat(200));
        let (b, t, a) = trim_around(&line, 200, 204);
        assert_eq!(t, "TODO");
        assert_eq!(b.chars().count(), SIDE + 1); // the ellipsis plus SIDE characters
        assert!(b.starts_with('…') && a.ends_with('…'));
        let (b, _, a) = trim_around("  short TODO line", 8, 12);
        assert_eq!((b.as_str(), a.as_str()), ("short ", " line"));
    }

    #[test]
    fn reads_ripgrep_and_git_lines() {
        let rg = r#"{"type":"match","data":{"path":{"text":".\\sub\\b.ts"},"lines":{"text":"é Todo todo\r\n"},"line_number":7,"submatches":[{"match":{"text":"Todo"},"start":3,"end":7},{"match":{"text":"todo"},"start":8,"end":12}]}}"#;
        let (path, hits) = parse_rg(rg, MAX_HITS).unwrap();
        assert_eq!(path, "sub/b.ts");
        assert_eq!(hits.len(), 2);
        // "é " is two UTF-16 units before the hit, though three bytes.
        assert_eq!(hits[0], Hit { line: 7, col: 2, before: "é ".into(), text: "Todo".into(), after: " todo".into(), len: 4 });
        assert!(parse_rg(r#"{"type":"begin","data":{}}"#, MAX_HITS).is_none());
        let (path, hits) = parse_git("a dir/x.txt\u{0}12\u{0}5\u{0}one todo here", Some(4)).unwrap();
        assert_eq!((path.as_str(), hits[0].line, hits[0].text.as_str(), hits[0].col), ("a dir/x.txt", 12, "todo", 4));
    }

    // FIX-2 (council P1): a minified one-line file with a match per character: the cap holds
    // before any hit is built, the columns still count UTF-16 units, and the sides stay SIDE long.
    #[test]
    fn a_line_with_thousands_of_matches_builds_only_the_hits_asked_for() {
        let line = format!("é{}", "e".repeat(60_000));
        let subs: Vec<String> = (0..60_000).map(|i| format!(r#"{{"match":{{"text":"e"}},"start":{},"end":{}}}"#, i + 2, i + 3)).collect();
        let json = format!(r#"{{"type":"match","data":{{"path":{{"text":"min.js"}},"lines":{{"text":{}}},"line_number":1,"submatches":[{}]}}}}"#, serde_json::to_string(&line).unwrap(), subs.join(","));
        HITS_BUILT.with(|c| c.set(0));
        let (_, hits) = parse_rg(&json, 3).unwrap();
        assert_eq!(hits.len(), 3);
        // FIX-5: the work is bounded too: 3 hits built out of 60 000 submatches, not 60 000 built and 3 kept
        assert_eq!(HITS_BUILT.with(|c| c.get()), 3);
        assert_eq!(hits.iter().map(|h| h.col).collect::<Vec<_>>(), vec![1, 2, 3]);
        let (_, hits) = parse_rg(&json, MAX_HITS).unwrap();
        assert_eq!(hits.len(), MAX_HITS);
        let last = hits.last().unwrap();
        assert_eq!(last.col, MAX_HITS);
        assert_eq!(last.before.chars().count(), SIDE + 1);
        assert_eq!(last.after.chars().count(), SIDE + 1);
    }

    // FIX-3 (council P5): a hit longer than TEXT_MAX characters (a regex across a minified line) is
    // cut to TEXT_MAX plus an ellipsis for the list, but keeps its real UTF-16 length for the editor.
    #[test]
    fn a_long_hit_is_cut_for_the_list_but_keeps_its_length() {
        let line = format!("ab{}cd", "é".repeat(5000));
        let h = hit(3, &line, 2, 2 + 2 * 5000);
        assert_eq!(h.text.chars().count(), TEXT_MAX + 1);
        assert!(h.text.ends_with('…') && h.text.starts_with('é'));
        assert_eq!((h.col, h.len), (2, 5000));
        assert_eq!(h.after, "cd");
        let short = hit(1, "one todo", 4, 8);
        assert_eq!((short.text.as_str(), short.len), ("todo", 4));
    }

    // FIX-3 (council P5): ripgrep is told to skip files over 10 MB; a real 11 MB file with a match is
    // not searched while a small one next to it is.
    #[test]
    fn ripgrep_skips_files_over_ten_megabytes() {
        let args: Vec<String> = rg_command(Path::new("."), &ask("x")).get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w[0] == "--max-filesize" && w[1] == "10M"), "{args:?}");
        if Command::new("rg").arg("--version").output().is_err() {
            eprintln!("ripgrep not installed; the size rule was checked on the arguments only");
            return;
        }
        let d = std::env::temp_dir().join(format!("krs-search-big-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let mut big = "needle\n".to_string();
        big.push_str(&"x".repeat(11 * 1024 * 1024));
        std::fs::write(d.join("big.txt"), big).unwrap();
        std::fs::write(d.join("small.txt"), "needle\n").unwrap();
        let f = run(rg_command(&d, &ask("needle")), parse_rg, "rg", &AtomicBool::new(false), false).unwrap();
        assert_eq!(f.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["small.txt"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    // FIX-3 (council P4): a new search of the same folder raises the running one's flag (another
    // folder's search is left alone), and a raised flag kills the child at once: a command that would
    // run for about 20 seconds ends within a few, with the superseded error the window drops.
    #[test]
    fn a_newer_search_of_the_same_folder_stops_the_older_one() {
        let (a, b) = (Path::new("C:/krs-claim-a"), Path::new("C:/krs-claim-b"));
        let first = claim(a, next_gen());
        let other = claim(b, next_gen());
        assert!(!first.load(Ordering::SeqCst));
        let second = claim(a, next_gen());
        assert!(first.load(Ordering::SeqCst), "the older search of the folder is told to stop");
        assert!(!second.load(Ordering::SeqCst) && !other.load(Ordering::SeqCst));
        release(a, &first);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_some_and(|(_, f)| Arc::ptr_eq(f, &second)), "a finished older search does not drop the newer one's entry");
        release(a, &second);
        release(b, &other);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_none());

        let stop = Arc::new(AtomicBool::new(false));
        let raise = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            raise.store(true, Ordering::SeqCst);
        });
        let mut slow = if cfg!(windows) { Command::new("ping") } else { Command::new("sleep") };
        if cfg!(windows) {
            slow.args(["-n", "20", "127.0.0.1"]);
        } else {
            slow.arg("20");
        }
        let t0 = Instant::now();
        let err = run(slow, |_, _| None, "rg", &stop, false).err().unwrap();
        assert_eq!(err.to_string(), SUPERSEDED);
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    }

    // FIX-4 (council d2 AFTER 1): the fence step can let an older search reach its folder after a
    // newer one. The older one stops at once and the newer one keeps running.
    #[test]
    fn fix4_a_search_reaching_its_folder_after_a_newer_one_stops_and_the_newer_runs_on() {
        let a = Path::new("C:/krs-gen-a");
        let (g_old, g_new) = (next_gen(), next_gen());
        let newer = claim(a, g_new);
        let older = claim(a, g_old);
        assert!(!newer.load(Ordering::SeqCst), "the newer search is not stopped by the late older one");
        assert!(older.load(Ordering::SeqCst), "the late older search stops at once");
        release(a, &older);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_some_and(|(_, f)| Arc::ptr_eq(f, &newer)), "the late one never takes the newer one's entry");
        release(a, &newer);
    }

    // FIX-4: a late older search starts no ripgrep at all, and says the superseded error.
    #[test]
    fn fix4_a_late_older_search_starts_nothing_and_says_superseded() {
        let a = Path::new("C:/krs-gen-late");
        let (g_old, g_new) = (next_gen(), next_gen());
        let newer = claim(a, g_new);
        let err = search_gen(a, &ask("needle"), g_old).err().unwrap();
        assert_eq!(err, SUPERSEDED);
        assert!(!newer.load(Ordering::SeqCst));
        release(a, &newer);
    }

    // FIX-4 (council d2 AFTER 7): a cancel stops the folder's running search, and one still on its
    // way through the fence (lower generation) stops on arrival; a search asked afterwards runs.
    #[test]
    fn fix4_cancel_stops_the_running_search_and_one_still_in_the_fence_but_not_a_later_one() {
        let a = Path::new("C:/krs-gen-cancel");
        let running = claim(a, next_gen());
        let in_the_fence = next_gen();
        cancel(a, next_gen());
        assert!(running.load(Ordering::SeqCst), "the running search is stopped");
        assert!(claim(a, in_the_fence).load(Ordering::SeqCst), "a search that was asked before the cancel stops on arrival");
        let later = claim(a, next_gen());
        assert!(!later.load(Ordering::SeqCst), "a search asked after the cancel runs");
        release(a, &later);
        cancel(Path::new("C:/krs-gen-never-searched"), next_gen()); // nothing running: no harm
    }

    // FIX-5 (council d2 AFTER 1): a cancel numbers itself when its command is called, before the
    // fence step, like a search does. A cancel called before a search must not stop that search
    // when the fence lets the search reach its folder first.
    #[test]
    fn fix5_a_cancel_called_before_a_search_does_not_stop_it_when_the_search_reaches_the_folder_first() {
        let a = Path::new("C:/krs-gen-cancel-late");
        let cancel_gen = next_gen(); // the old view's cancel entered its command first ...
        let newer = claim(a, next_gen()); // ... the new view's search got through the fence first ...
        cancel(a, cancel_gen); // ... and the cancel arrives late
        assert!(!newer.load(Ordering::SeqCst), "the newer search keeps running");
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_some_and(|(_, f)| Arc::ptr_eq(f, &newer)), "the late cancel leaves the newer search's entry alone");
        release(a, &newer);
    }

    // FIX-5: a cancel that reached the folder first still stops a search that was asked earlier and
    // is still running (the ordinary workspace switch), and leaves a marker so an even older search
    // arriving afterwards stops too.
    #[test]
    fn fix5_a_cancel_stops_an_older_running_search_and_marks_the_folder_for_older_late_ones() {
        let a = Path::new("C:/krs-gen-cancel-marker");
        let older_in_fence = next_gen();
        let running = claim(a, next_gen());
        cancel(a, next_gen());
        assert!(running.load(Ordering::SeqCst));
        assert!(claim(a, older_in_fence).load(Ordering::SeqCst));
    }

    // FIX-6 (council d2 AFTER 2): the markers a cancel leaves are bounded; a running search is kept.
    #[test]
    fn fix6_cancel_markers_are_bounded_and_a_running_search_is_never_dropped() {
        let mut map: HashMap<PathBuf, Held> = HashMap::new();
        let running = Arc::new(AtomicBool::new(false));
        map.insert(PathBuf::from("C:/running"), (1, running.clone()));
        for g in 2..=20u64 {
            map.insert(PathBuf::from(format!("C:/done-{g}")), (g, Arc::new(AtomicBool::new(true))));
        }
        prune_markers(&mut map, 30);
        assert_eq!(map.len(), 20, "under the bound nothing goes");
        prune_markers(&mut map, 10);
        assert_eq!(map.len(), 10, "over the bound it comes down to it");
        assert!(map.contains_key(Path::new("C:/running")), "the running search stays although it is the oldest");
        assert!(!map.contains_key(Path::new("C:/done-2")) && map.contains_key(Path::new("C:/done-20")), "the oldest markers go first");
        prune_markers(&mut map, 0);
        assert_eq!(map.len(), 1, "only the running search is left when nothing else can go");
    }

    // FIX-7 (council d2 FIX-SOON 1): the bound holds through the cancel itself, not only through
    // prune_markers. Red when the prune call is taken out of cancel_in (verified, see evidence).
    #[test]
    fn fix7_cancel_itself_bounds_the_map_and_keeps_a_running_search() {
        let mut map: HashMap<PathBuf, Held> = HashMap::new();
        let running = claim_in(&mut map, Path::new("C:/fix7-running"), 1);
        for g in 2..(MAX_MARKERS as u64 * 2) {
            cancel_in(&mut map, Path::new(&format!("C:/fix7-cancelled-{g}")), g);
            assert!(map.len() <= MAX_MARKERS, "the map never grows past the bound (at cancel {g})");
        }
        assert_eq!(map.len(), MAX_MARKERS, "it settles at the bound, not below it");
        assert!(!running.load(Ordering::SeqCst), "a running search is not stopped by other folders' cancels");
        assert!(map.get(Path::new("C:/fix7-running")).is_some_and(|(_, f)| Arc::ptr_eq(f, &running)), "and it stays in the map");
        assert!(map.contains_key(Path::new(&format!("C:/fix7-cancelled-{}", MAX_MARKERS as u64 * 2 - 1))), "the newest marker stays");
        assert!(!map.contains_key(Path::new("C:/fix7-cancelled-2")), "the oldest marker went");
    }

    // FIX-7 (council d2 AFTER 3): the accepted limit, written down. A marker that fell off the bound
    // no longer stops an older search arriving from the fence; a marker inside the bound still does.
    #[test]
    fn fix7_a_pruned_marker_no_longer_stops_an_older_search_but_a_kept_one_does() {
        let mut map: HashMap<PathBuf, Held> = HashMap::new();
        let first_old = 1u64;
        let last_old = 2u64;
        cancel_in(&mut map, Path::new("C:/fix7-first"), 10);
        for g in 11..(11 + MAX_MARKERS as u64) {
            cancel_in(&mut map, Path::new(&format!("C:/fix7-more-{g}")), g);
        }
        assert!(!claim_in(&mut map, Path::new("C:/fix7-first"), first_old).load(Ordering::SeqCst), "past the bound the first marker is gone");
        let newest = 10 + MAX_MARKERS as u64;
        assert!(claim_in(&mut map, Path::new(&format!("C:/fix7-more-{newest}")), last_old).load(Ordering::SeqCst), "a marker inside the bound still stops it");
    }

    #[test]
    fn refuses_an_overly_long_query() {
        let err = search(Path::new("."), &ask(&"x".repeat(MAX_QUERY + 1))).err().unwrap();
        assert!(err.contains("longer than"));
    }

    // A real search over a throwaway folder: case, whole word, exclude, regex errors, the cap.
    #[test]
    fn searches_a_folder() {
        let d = std::env::temp_dir().join(format!("krs-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sub")).unwrap();
        std::fs::create_dir_all(d.join(".hidden")).unwrap();
        std::fs::write(d.join("a.txt"), "one todo here\nTODO two\ntodos\n").unwrap();
        std::fs::write(d.join("sub").join("b.test.ts"), "x Todo\n").unwrap();
        std::fs::write(d.join(".hidden").join("c.txt"), "todo hidden\n").unwrap();
        // The fallback needs a repository; ripgrep is checked too wherever it is installed.
        let git_init = Command::new("git").args(["init", "-q"]).current_dir(&d).status().unwrap();
        assert!(git_init.success());
        let has_rg = Command::new("rg").arg("--version").output().is_ok();
        for use_git in [true, false] {
            if !use_git && !has_rg {
                continue;
            }
            let go = |a: &Ask| -> Result<Found, std::io::Error> {
                if use_git {
                    let len = (!a.regex).then_some(a.query.len());
                    run(git_command(&d, a), |l, _| parse_git(l, len), "git", &AtomicBool::new(false), false)
                } else {
                    run(rg_command(&d, a), parse_rg, "rg", &AtomicBool::new(false), false)
                }
            };
            let count = |a: &Ask| go(a).unwrap().total;
            assert_eq!(count(&ask("todo")), 5, "git={use_git}");
            assert_eq!(count(&Ask { match_case: true, ..ask("todo") }), 3);
            assert_eq!(count(&Ask { whole_word: true, ..ask("todo") }), 4);
            let no_tests = go(&Ask { exclude: "*.test.ts".into(), ..ask("todo") }).unwrap();
            assert!(no_tests.files.iter().all(|f| !f.path.ends_with(".test.ts")));
            assert_eq!(no_tests.total, 4);
            let only = go(&Ask { include: "*.ts".into(), ..ask("todo") }).unwrap();
            assert_eq!(only.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["sub/b.test.ts"]);
            assert!(go(&Ask { regex: true, ..ask("(unclosed") }).is_err());
            assert_eq!(count(&Ask { regex: true, ..ask("t.d.") }), 5);
            let hit = &go(&ask("here")).unwrap().files[0];
            assert_eq!((hit.path.as_str(), hit.hits[0].line, hit.hits[0].col, hit.hits[0].text.as_str()), ("a.txt", 1, 9, "here"));
            std::fs::write(d.join("many.txt"), "z
".repeat(MAX_HITS + 50)).unwrap();
            let many = go(&ask("z")).unwrap();
            assert!(many.capped && many.total == MAX_HITS);
            std::fs::remove_file(d.join("many.txt")).unwrap();
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    // EDIT-044 (T-062-b): a root inside a WSL distribution names the distribution and the folder as
    // Linux spells it, in either share spelling, either slash, the long-path form, and with spaces.
    #[test]
    fn edit044_a_wsl_root_names_its_distribution_and_linux_folder() {
        let some = |p: &str| wsl_root(Path::new(p));
        assert_eq!(some(r"\\wsl.localhost\Ubuntu\home\me\p"), Some(("Ubuntu".into(), "/home/me/p".into())));
        assert_eq!(some(r"\\wsl$\Ubuntu\x y"), Some(("Ubuntu".into(), "/x y".into())));
        assert_eq!(some("//wsl.localhost/Debian/srv/app"), Some(("Debian".into(), "/srv/app".into())));
        assert_eq!(some(r"\\?\UNC\wsl$\Ubuntu\home"), Some(("Ubuntu".into(), "/home".into())));
        assert_eq!(some(r"\\WSL.LOCALHOST\Ubuntu"), Some(("Ubuntu".into(), "/".into())), "the share's name is case-blind; the root of the distribution is /");
        for not in [r"C:\work\p", "/home/me/p", r"\\server\share\p", r"\\wsl.localhost\", r"C:\wsl$\x"] {
            assert_eq!(some(not), None, "{not}");
        }
    }

    // EDIT-044: the search of a WSL root runs ripgrep inside the distribution (wsl.exe, no shell in
    // between, so the query reaches ripgrep as typed) with the same arguments as a local search,
    // relative to the folder as Linux spells it; a local root still runs ripgrep itself.
    #[test]
    fn edit044_a_wsl_root_searches_inside_its_distribution_with_the_same_arguments() {
        let argv = |c: &Command| (c.get_program().to_string_lossy().into_owned(), c.get_args().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>());
        let a = Ask { include: "*.rs".into(), exclude: "target".into(), whole_word: true, ..ask("needle here") };
        let (prog, local) = argv(&rg_command(Path::new(r"C:\work\p"), &a));
        assert_eq!(prog, "rg");
        let (prog, wsl) = argv(&wsl_rg_command("Ubuntu", "/home/me/p", &a));
        assert_eq!(prog, "wsl.exe");
        assert_eq!(&wsl[..6], ["-d", "Ubuntu", "--cd", "/home/me/p", "-e", "rg"]);
        assert_eq!(&wsl[6..], &local[..], "the same ripgrep arguments inside the distribution");
        assert!(local.ends_with(&["-e".to_string(), "needle here".into(), "--".into(), ".".into()]), "{local:?}");
        let (_, spaced) = argv(&wsl_rg_command("Ubuntu", "/x y", &ask("q")));
        assert_eq!(&spaced[2..4], ["--cd", "/x y"], "a folder with a space is one argument");
        assert!(wsl_rg_command("Ubuntu", "/x", &a).get_current_dir().is_none(), "the Windows side needs no working folder on the share");
    }

    // EDIT-044: wsl.exe writes its own messages as UTF-16; ripgrep's are UTF-8. Both read as text.
    #[test]
    fn edit044_wsl_messages_in_utf16_read_as_text() {
        let utf16: Vec<u8> = "There is no distribution with the supplied name.\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(stderr_text(&utf16).trim(), "There is no distribution with the supplied name.");
        let bom: Vec<u8> = [0xFF, 0xFE].into_iter().chain(utf16.iter().copied()).collect();
        assert_eq!(stderr_text(&bom).trim(), "There is no distribution with the supplied name.");
        assert_eq!(stderr_text("rg: regex parse error\n".as_bytes()).trim(), "rg: regex parse error");
        assert_eq!(stderr_text(b""), "");
    }

    // EDIT-044: inside the distribution a missing ripgrep or folder ends with code 1 and a message,
    // the same code as "nothing matched"; with the message the search says why instead of finding
    // nothing. A local search keeps reading code 1 as no hits.
    #[cfg(unix)]
    #[test]
    fn edit044_a_wsl_search_that_ends_with_a_message_and_code_1_is_a_failure() {
        let complain = || {
            let mut c = Command::new("sh");
            c.args(["-c", "echo 'execvpe(rg) failed: No such file or directory' >&2; exit 1"]);
            c
        };
        let err = run(complain(), parse_rg, "rg", &AtomicBool::new(false), true).unwrap_err();
        assert!(err.to_string().contains("execvpe(rg) failed"), "{err}");
        let found = run(complain(), parse_rg, "rg", &AtomicBool::new(false), false).unwrap();
        assert_eq!(found.total, 0);
    }

    // EDIT-044: searching a WSL root where wsl.exe is not installed says so instead of finding nothing.
    // wsl.exe is stood in for by a program that does not exist, so the answer never depends on
    // whether the machine running the test has WSL (a Windows runner does).
    #[test]
    fn edit044_without_wsl_a_wsl_search_says_so() {
        let missing = |_: &str, _: &str, _: &Ask| Command::new("krs-no-such-wsl-exe-t062b");
        let err = search_with(Path::new(r"\\wsl.localhost\Ubuntu\home\me"), &ask("needle"), next_gen(), missing).unwrap_err();
        assert!(err.contains("WSL") && err.contains("Ubuntu") && err.contains("not installed"), "{err}");
    }
}
