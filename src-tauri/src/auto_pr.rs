//! T-652 / T-653 (DT-C89, DT-C90, DT-C91): the steps of the automatic pull request flow that must
//! be safe by construction, so the window cannot get them wrong. `auto_pr_scan` says what a commit
//! would be stopped by, `auto_pr_commit` commits a workspace's changes on its own branch and
//! `auto_pr_push` pushes that branch. All three fail closed: they never touch the default branch,
//! never force, never pull, and stop (naming the files, never the value) when a file looks like a
//! secret or is over 10 MB. They act only on a folder the project fence (ACCT-055) allows.

use crate::git::{command, run, Git, NO_PROMPT};
use crate::scm::{self, Status};
use regex::bytes::Regex;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

/// A file over this size is never committed or pushed by the automatic flow (DT-C90).
const MAX_BYTES: u64 = 10 * 1024 * 1024;
/// More files than this in one automatic commit is a folder that should have been ignored.
const MAX_FILES: usize = 5_000;
/// How long `git add`, a commit or a push may take before Kolux stops waiting (a hook or a sign-in
/// that hangs).
const PUSH_LIMIT: Duration = Duration::from_secs(600);
/// How long reading the remote's branches may take.
const REMOTE_LIMIT: Duration = Duration::from_secs(60);
/// How long Kolux waits for git's output after git itself has exited (a hook that left a program
/// running keeps the pipes open).
const DRAIN_GRACE: Duration = Duration::from_secs(5);

/// What one step did. `kind` is done, clean, local, skipped, blocked or failed; `files` is set
/// only for blocked (the offending paths).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStep {
    pub kind: String,
    pub message: String,
    pub files: Vec<String>,
}

fn step(kind: &str, message: impl Into<String>) -> AutoStep {
    AutoStep { kind: kind.into(), message: message.into(), files: Vec::new() }
}

/// A message for the window: no credentials from a remote address and no Claude key.
fn scrub(text: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    crate::secrets::mask(&RE.get_or_init(|| regex::Regex::new(r"://[^/@\s]+@").expect("valid")).replace_all(text, "://"))
}

// ---------------------------------------------------------------------------------------------
// The scan: one pure function over (path, size, bytes).
// ---------------------------------------------------------------------------------------------

/// Does the file name alone mark a secret? Case-insensitive, any folder depth.
fn name_hit(path: &str) -> bool {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    if base.ends_with(".env") {
        return true;
    }
    if base.starts_with(".env.") {
        return !["example", "sample", "template"].iter().any(|ext| base.ends_with(&format!(".{ext}")));
    }
    if [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].iter().any(|ext| base.ends_with(ext)) {
        return true;
    }
    if [".netrc", "_netrc", ".git-credentials", "terraform.tfstate", "terraform.tfstate.backup"].contains(&base.as_str()) {
        return true;
    }
    // id_rsa, id_rsa_work, id_ed25519-ci; never the public half (id_rsa.pub, id_rsa_work.pub).
    ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].iter().any(|k| base == *k || (base.strip_prefix(k).is_some_and(|rest| rest.starts_with(['_', '-'])) && !base.ends_with(".pub")))
}

/// The well-known key shapes. A prefix counts only when the character before it is not a letter
/// or digit, so `task-ant-...` is not `sk-ant-...`.
fn secret_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(concat!(
            r"(?-u)-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|",
            r"_authToken\s*=\s*\S|",
            r"(?:^|[^A-Za-z0-9])(?:",
            r"(?:AKIA|ASIA)[0-9A-Z]{16}",
            r"|gh[pousr]_[A-Za-z0-9]{36}",
            r"|github_pat_[A-Za-z0-9_]{20,}",
            r"|sk-ant-[A-Za-z0-9_-]{20,}",
            r"|sk-proj-[A-Za-z0-9_-]{20,}",
            r"|sk_live_[A-Za-z0-9]{16,}",
            r"|xox[abprs]-[A-Za-z0-9-]{10,}",
            r"|AIza[A-Za-z0-9_-]{35}",
            r"|glpat-[A-Za-z0-9_-]{20}",
            r"|npm_[A-Za-z0-9]{36}",
            r")"
        ))
        .expect("the secret pattern is valid")
    })
}

/// Content that looks like a secret. Every byte is read (a NUL anywhere does not hide a key); a
/// file with a UTF-16 byte-order mark or any NUL is also read as UTF-16, either byte order, either
/// alignment, which turns text written by a Windows editor back into the letters of a key.
fn content_hit(bytes: &[u8]) -> bool {
    let re = secret_regex();
    if re.is_match(bytes) {
        return true;
    }
    let wide = bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) || bytes.contains(&0);
    wide && [0usize, 1].iter().any(|skip| re.is_match(&bytes.iter().skip(*skip).step_by(2).copied().collect::<Vec<u8>>()))
}

/// True when the file must stop the step: a secret by name, over 10 MB (then `bytes` is not
/// read and may be empty), or a secret by content.
pub(crate) fn scan(path: &str, size: u64, bytes: &[u8]) -> bool {
    name_hit(path) || size > MAX_BYTES || content_hit(bytes)
}

fn blocked(verb: &str, files: BTreeSet<String>, advice: &str) -> AutoStep {
    let n = files.len();
    let (noun, look) = if n == 1 { ("file looks", "is") } else { ("files look", "are") };
    AutoStep { kind: "blocked".into(), message: format!("Not {verb}: {n} {noun} like secrets or {look} over 10 MB. {advice}"), files: files.into_iter().collect() }
}

// ---------------------------------------------------------------------------------------------
// Reading the repository.
// ---------------------------------------------------------------------------------------------

/// A git command for reading history to scan it: replacement refs (`git replace`) are ignored,
/// because a push sends the real objects and not what a replacement shows in their place.
fn scan_cmd(dir: &Path, args: &[&str]) -> Command {
    let mut cmd = command(args, Some(dir));
    cmd.env("GIT_NO_REPLACE_OBJECTS", "1");
    cmd
}

/// What `args` print, with `input` on git's standard input.
fn git_fed(dir: &Path, args: &[&str], input: String) -> Result<Vec<u8>, String> {
    let mut child = scan_cmd(dir, args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("git has no input")?;
    // A thread feeds the list so a long one cannot fill the pipes and stall both sides.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let out = child.wait_with_output().map_err(|e| format!("could not run git: {e}"))?;
    let _ = writer.join();
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("git {} failed ({})", args.join(" "), out.status) } else { err })
    }
}

fn git_bytes(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    git_fed(dir, args, String::new())
}

fn strip_origin(name: &str) -> String {
    name.strip_prefix("origin/").unwrap_or(name).to_string()
}

/// The names that count as the default branch here: git.rs's default, the branch origin/HEAD
/// points to, and the status base, each without a leading `origin/`.
fn default_names(dir: &Path, st: &Status) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(d) = Git::detect().ok().and_then(|g| g.default_branch(dir)) {
        names.push(strip_origin(&d));
    }
    if let Ok(h) = run(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], Some(dir)) {
        names.push(strip_origin(&h));
    }
    if let Some(b) = &st.base {
        names.push(strip_origin(b));
    }
    names.retain(|n| !n.is_empty());
    names
}

/// What the guards found out, when they let the step go on.
struct Ctx {
    branch: String,
    st: Status,
    defaults: Vec<String>,
    top: PathBuf,
}

enum Gate {
    Go(Box<Ctx>),
    Stop(AutoStep),
}

fn head_oid(dir: &Path) -> Option<String> {
    run(&["rev-parse", "--verify", "-q", "HEAD"], Some(dir)).ok().filter(|o| is_oid(o))
}

/// The checks every step shares: a repository, a branch git itself knows by this spelling, no
/// operation in progress, no conflicts and not the default branch (in any capitalisation, since a
/// Windows disk treats `Main` and `main` as one branch).
fn gate(dir: &Path) -> Result<Gate, String> {
    let skip = |m: &str| Ok(Gate::Stop(step("skipped", m)));
    if !dir.is_dir() || run(&["rev-parse", "--is-inside-work-tree"], Some(dir)).ok().as_deref() != Some("true") {
        return skip("Skipped: this folder is not a git repository.");
    }
    let Some(branch) = run(&["symbolic-ref", "-q", "--short", "HEAD"], Some(dir)).ok().filter(|b| !b.is_empty()) else {
        return skip("Skipped: no branch is checked out (HEAD is detached).");
    };
    if branch.starts_with('-') {
        return skip(&format!("Skipped: {branch} starts with a dash, which a command line could mistake for an option."));
    }
    let st = scm::status(dir)?;
    if let Some(op) = &st.operation {
        return skip(&format!("Skipped: a {op} is in progress. Finish or abort it first."));
    }
    if !st.conflicts.is_empty() {
        return skip("Skipped: there are unresolved merge conflicts.");
    }
    let defaults = default_names(dir, &st);
    if defaults.iter().any(|d| d.eq_ignore_ascii_case(&branch)) {
        return skip(&format!("Skipped: {branch} is the default branch, and automatic pull requests only work on a branch of their own."));
    }
    // The branch must be listed under exactly this spelling (a branch that exists only as a
    // different-capitals twin of this name is another branch's ref in disguise). A branch with no
    // commit yet has no ref to list.
    if head_oid(dir).is_some() {
        let want = format!("refs/heads/{branch}");
        let listed = run(&["for-each-ref", "--format=%(refname)", &want], Some(dir))?;
        if listed.lines().collect::<Vec<_>>() != [want.as_str()] {
            return skip(&format!("Skipped: git does not list {branch} under exactly that name (check its capital letters)."));
        }
    }
    let top = run(&["rev-parse", "--show-toplevel"], Some(dir)).map(PathBuf::from).unwrap_or_else(|_| dir.to_path_buf());
    Ok(Gate::Go(Box::new(Ctx { branch, st, defaults, top })))
}

/// The one rule about a branch's upstream, for commit and push alike. No upstream, `origin/<branch>`
/// and the default branch on origin (a workspace branch cut from `origin/main` tracks it until its
/// first push, which then links it to its own branch) all go on; any other upstream skips.
fn upstream_rule(ctx: &Ctx) -> Option<AutoStep> {
    let up = ctx.st.upstream.as_deref()?;
    let own = format!("origin/{}", ctx.branch);
    if up == own || ctx.defaults.iter().any(|d| up.eq_ignore_ascii_case(&format!("origin/{d}"))) {
        None
    } else {
        Some(step("skipped", format!("Skipped: {} tracks {up}, not origin/{}.", ctx.branch, ctx.branch)))
    }
}

/// `none` without an origin remote, `github` when origin is on github.com, else `other`.
fn remote_kind(dir: &Path) -> &'static str {
    match run(&["remote", "get-url", "origin"], Some(dir)) {
        Ok(url) if !url.is_empty() => {
            if host_of(&url).is_some_and(|h| h.eq_ignore_ascii_case("github.com")) {
                "github"
            } else {
                "other"
            }
        }
        _ => "none",
    }
}

/// The host of a remote address: `scheme://[user[:password]@]host[:port]/path` or the scp form
/// `[user@]host:path`.
fn host_of(url: &str) -> Option<String> {
    let url = url.trim();
    let after_scheme = match url.split_once("://") {
        Some((_, rest)) => rest.split(['/', '?', '#']).next().unwrap_or(""),
        None => {
            let (head, _) = url.split_once(':')?;
            head
        }
    };
    let host_port = after_scheme.rsplit('@').next().unwrap_or("");
    let host = if url.contains("://") { host_port.split(':').next().unwrap_or("") } else { host_port };
    Some(host.to_string()).filter(|h| !h.is_empty())
}

/// An address reduced to host and path, so `https://h/o/r.git`, `git@h:o/r` and `ssh://h/o/r/`
/// compare equal. Two addresses that differ here point at different places.
fn address_key(url: &str) -> String {
    let u = url.trim().replace('\\', "/");
    let (host, path) = match u.split_once("://") {
        Some((_, rest)) => {
            let (auth, path) = rest.split_once('/').unwrap_or((rest, ""));
            (auth.rsplit('@').next().unwrap_or("").split(':').next().unwrap_or("").to_string(), path.to_string())
        }
        None => match u.split_once(':') {
            Some((head, path)) if !head.contains('/') => (head.rsplit('@').next().unwrap_or("").to_string(), path.to_string()),
            _ => (String::new(), u.clone()),
        },
    };
    let path = path.trim_matches('/');
    format!("{}/{}", host.to_ascii_lowercase(), path.strip_suffix(".git").unwrap_or(path).trim_end_matches('/').to_ascii_lowercase())
}

/// Does a push to origin go to a different address than a fetch from it (`remote.origin.pushurl`)?
/// Anything git cannot answer counts as different.
fn push_address_differs(dir: &Path) -> bool {
    let keys = |args: &[&str]| run(args, Some(dir)).map(|out| out.lines().map(address_key).collect::<Vec<_>>());
    match (keys(&["remote", "get-url", "--all", "origin"]), keys(&["remote", "get-url", "--push", "--all", "origin"])) {
        (Ok(fetch), Ok(push)) => push.is_empty() || fetch.is_empty() || push.iter().any(|p| fetch.iter().all(|f| f != p)),
        _ => true,
    }
}

// ---------------------------------------------------------------------------------------------
// Commit.
// ---------------------------------------------------------------------------------------------

/// Every path `git add -A` would add or change: untracked (not ignored), modified and already
/// staged, a rename by its new name. Deleted files do not count.
fn paths_to_add(st: &Status) -> BTreeSet<String> {
    st.staged.iter().chain(&st.changed).chain(&st.untracked).filter(|c| c.status != "D").map(|c| c.path.clone()).collect()
}

/// Scans the working-tree files in `paths`; the offending names. A file git lists but that cannot
/// be looked at or read is an error, never a pass.
fn scan_worktree(top: &Path, paths: &BTreeSet<String>) -> Result<BTreeSet<String>, String> {
    let mut hits = BTreeSet::new();
    for path in paths {
        let full = top.join(path);
        let meta = std::fs::symlink_metadata(&full).map_err(|e| format!("could not look at {path}: {e}"))?;
        if name_hit(path) {
            hits.insert(path.clone());
        } else if meta.is_file() {
            let size = meta.len();
            let bytes = if size > MAX_BYTES { Vec::new() } else { std::fs::read(&full).map_err(|e| format!("could not read {path}: {e}"))? };
            if scan(path, size, &bytes) {
                hits.insert(path.clone());
            }
        }
    }
    Ok(hits)
}

/// The top-level dependency or build folders (GIT-012) the commit would add files to: not ignored
/// and not already tracked, since a folder the project keeps in git on purpose is its own choice.
fn heavy_in(top: &Path, paths: &BTreeSet<String>) -> Vec<String> {
    scm::heavy_folders(top)
        .into_iter()
        .filter(|h| {
            let prefix = format!("{h}/");
            paths.iter().any(|p| p.starts_with(&prefix)) && run(&["ls-files", "--", &prefix], Some(top)).map(|tracked| tracked.is_empty()).unwrap_or(false)
        })
        .collect()
}

/// The checks that need no staging: how many files, heavy folders, then the names, sizes and
/// content of the working-tree files `git add -A` would add. `Some` is the step that stops it.
fn precheck(ctx: &Ctx, verb: &str) -> Result<Option<AutoStep>, String> {
    let paths = paths_to_add(&ctx.st);
    let heavy = heavy_in(&ctx.top, &paths);
    if !heavy.is_empty() {
        let n = paths.iter().filter(|p| heavy.iter().any(|h| p.starts_with(&format!("{h}/")))).count();
        let list = heavy.join(", ");
        let message = format!("Not {verb}: {n} files under {list} look like dependencies or build output. Add {list} to the ignore file (.gitignore) first, then try again.");
        return Ok(Some(AutoStep { kind: "blocked".into(), message, files: heavy }));
    }
    if paths.len() > MAX_FILES {
        let message = format!("Not {verb}: {} files would be added, over the limit of {MAX_FILES}. Add the generated folders to the ignore file (.gitignore) first, or commit by hand if it is really that many.", paths.len());
        return Ok(Some(AutoStep { kind: "blocked".into(), message, files: Vec::new() }));
    }
    let hits = scan_worktree(&ctx.top, &paths)?;
    if hits.is_empty() {
        Ok(None)
    } else {
        Ok(Some(blocked(verb, hits, "Nothing was staged. Add them to .gitignore or remove them, or commit by hand if they are not real secrets.")))
    }
}

/// Every blob the index holds that differs from HEAD, by id, with its path: what a commit made
/// now would add.
fn staged_blobs(dir: &Path) -> Result<BTreeMap<String, BTreeSet<String>>, String> {
    let out = git_bytes(dir, &["diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-renames"])?;
    let text = String::from_utf8_lossy(&out);
    let mut blobs: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut tokens = text.split('\0');
    while let Some(meta) = tokens.next() {
        let Some(head) = meta.strip_prefix(':') else { continue };
        let Some(path) = tokens.next() else { break };
        // :<old mode> <new mode> <old id> <new id> <status>; a deletion or a submodule adds no blob.
        if let [_, mode, _, new, status] = head.split_whitespace().collect::<Vec<_>>().as_slice() {
            if !status.starts_with('D') && *mode != "160000" && !new.bytes().all(|b| b == b'0') {
                blobs.entry(new.to_string()).or_default().insert(path.to_string());
            }
        }
    }
    Ok(blobs)
}

/// The tree the index holds, saved so a failed commit can put it back.
fn undo(dir: &Path, saved: &str, head_before: &Option<String>, mut s: AutoStep) -> AutoStep {
    // A commit that did land is not undone: the index then belongs to the new HEAD.
    if head_oid(dir) == *head_before {
        if let Err(e) = run(&["read-tree", saved], Some(dir)) {
            s.message = format!("{} The staging area could not be put back: {}", s.message, scrub(&e));
        }
    }
    s
}

/// A git killed part-way through `git add` leaves its index lock behind; Kolux killed that git.
fn clear_index_lock(dir: &Path) {
    if let Ok(lock) = run(&["rev-parse", "--git-path", "index.lock"], Some(dir)) {
        let _ = std::fs::remove_file(dir.join(lock));
    }
}

/// Is a hook installed that can refuse a commit? (`core.hooksPath` is honoured by git itself.)
fn has_commit_hook(dir: &Path) -> bool {
    let Ok(hooks) = run(&["rev-parse", "--git-path", "hooks"], Some(dir)) else { return false };
    ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-merge-commit"].iter().any(|h| dir.join(&hooks).join(h).is_file())
}

fn commit_step(dir: &Path) -> Result<AutoStep, String> {
    let ctx = match gate(dir)? {
        Gate::Stop(s) => return Ok(s),
        Gate::Go(c) => c,
    };
    if let Some(stop) = upstream_rule(&ctx) {
        return Ok(stop);
    }
    if ctx.st.staged.is_empty() && ctx.st.changed.is_empty() && ctx.st.untracked.is_empty() {
        return Ok(step("clean", "Nothing to commit."));
    }
    // The cheap checks first, before anything is staged or hashed.
    if let Some(stop) = precheck(&ctx, "committed")? {
        return Ok(stop);
    }
    let head_before = head_oid(dir);
    let saved = run(&["write-tree"], Some(dir)).map_err(|e| format!("could not save the staging area first: {e}"))?;
    let fail = |s: AutoStep| Ok(undo(dir, &saved, &head_before, s));

    match run_limited(command(&["add", "-A"], Some(dir)), PUSH_LIMIT) {
        Err(e) => {
            if e.starts_with("git did not finish") {
                clear_index_lock(dir);
            }
            return fail(step("failed", format!("Not committed: {}", scrub(&e))));
        }
        Ok((false, log)) => return fail(step("failed", format!("Not committed: git add failed: {}", scrub(&crate::git::failure_reason(&log).unwrap_or_else(|| "git gave no reason".into()))))),
        Ok((true, _)) => {}
    }
    // The authoritative scan: the blobs the commit would hold, after any filter has run.
    let hits = match staged_blobs(dir).and_then(|blobs| scan_blobs(dir, &blobs)) {
        Ok(h) => h,
        Err(e) => return fail(step("failed", format!("Not committed: {}", scrub(&e)))),
    };
    if !hits.is_empty() {
        return fail(blocked("committed", hits, "Nothing was kept staged. Add them to .gitignore or remove them, or commit by hand if they are not real secrets."));
    }

    let message = format!("Auto-commit on {} after an agent turn", ctx.branch);
    let (ok, log) = match run_limited(command(&["commit", "--quiet", "-m", &message], Some(dir)), PUSH_LIMIT) {
        Ok(r) => r,
        Err(e) => {
            if e.starts_with("git did not finish") {
                clear_index_lock(dir);
            }
            // The commit may have landed before Kolux lost sight of git.
            return match head_oid(dir) {
                Some(now) if Some(&now) != head_before.as_ref() => Ok(step("done", format!("Committed {} on {}.", &now[..now.len().min(7)], ctx.branch))),
                _ => fail(step("failed", format!("Not committed: {}", scrub(&e)))),
            };
        }
    };
    if ok {
        let id = run(&["rev-parse", "--short", "HEAD"], Some(dir))?;
        return Ok(step("done", format!("Committed {id} on {}.", ctx.branch)));
    }
    let low = log.to_lowercase();
    if low.contains("nothing to commit") || low.contains("nothing added to commit") {
        return Ok(step("clean", "Nothing to commit."));
    }
    let why = crate::git::failure_reason(&log).unwrap_or_else(|| log.lines().last().unwrap_or("git gave no reason").to_string());
    let who = if has_commit_hook(dir) { "A commit hook refused the commit" } else { "The commit failed" };
    fail(step("failed", format!("{who}: {}", scrub(&why))))
}

/// What a commit would be stopped by, found without staging anything.
fn scan_step(dir: &Path) -> Result<AutoStep, String> {
    let ctx = match gate(dir)? {
        Gate::Stop(s) => return Ok(s),
        Gate::Go(c) => c,
    };
    if let Some(stop) = upstream_rule(&ctx) {
        return Ok(stop);
    }
    if paths_to_add(&ctx.st).is_empty() {
        return Ok(step("clean", "Nothing to scan: no file would be added."));
    }
    Ok(precheck(&ctx, "committed")?.unwrap_or_else(|| step("clean", "No file looks like a secret, is over 10 MB or belongs in the ignore file.")))
}

// ---------------------------------------------------------------------------------------------
// Push.
// ---------------------------------------------------------------------------------------------

fn is_oid(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Starts `git cat-file <mode>` and feeds it the object ids from another thread, so a long list
/// cannot fill the pipes and stall both sides.
fn spawn_cat_file(dir: &Path, mode: &str, ids: Vec<String>) -> Result<(std::process::Child, std::thread::JoinHandle<()>), String> {
    let mut child = scan_cmd(dir, &["cat-file", mode]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("git has no input")?;
    let writer = std::thread::spawn(move || {
        let mut text = String::new();
        for id in ids {
            text.push_str(&id);
            text.push('\n');
        }
        let _ = stdin.write_all(text.as_bytes());
    });
    Ok((child, writer))
}

/// What a push would send: the commit being pushed, and every tip the remote already has that
/// exists here too, as `git rev-list --stdin` lines.
fn range_input(oid: &str, tips: &[String]) -> String {
    let mut text = format!("{oid}\n");
    for tip in tips {
        text.push_str(&format!("^{tip}\n"));
    }
    text
}

/// Every blob the commits in `input` add or change, by id, with the names it has there.
fn range_blobs(dir: &Path, input: &str) -> Result<BTreeMap<String, BTreeSet<String>>, String> {
    let mut blobs: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    // All objects the range introduces (merges included); the names are the first each was seen under.
    for line in String::from_utf8_lossy(&git_fed(dir, &["rev-list", "--objects", "--stdin", "--"], input.to_string())?).lines() {
        let (oid, name) = line.split_once(' ').unwrap_or((line, ""));
        if is_oid(oid) {
            let names = blobs.entry(oid.to_string()).or_default();
            if !name.is_empty() {
                names.insert(name.to_string());
            }
        }
    }
    // Every name a blob is added or changed under, commit by commit, so a copy of a secret under a
    // harmless name does not hide the secret name.
    let log = git_fed(dir, &["log", "--raw", "-z", "--no-abbrev", "--no-renames", "--no-merges", "--diff-filter=AM", "--format=", "--stdin", "--"], input.to_string())?;
    let text = String::from_utf8_lossy(&log);
    let mut tokens = text.split('\0');
    while let Some(token) = tokens.next() {
        let Some(head) = token.trim_start().strip_prefix(':') else { continue };
        let fields: Vec<&str> = head.split_whitespace().collect();
        let Some(path) = tokens.next() else { break };
        if let (Some(mode), Some(new)) = (fields.get(1), fields.get(3)) {
            if *mode != "160000" {
                if let Some(names) = blobs.get_mut(*new) {
                    names.insert(path.to_string());
                }
            }
        }
    }
    Ok(blobs)
}

/// The commits in `input` whose message looks like a secret, as `commit message <id>`.
fn scan_messages(dir: &Path, input: &str) -> Result<BTreeSet<String>, String> {
    let out = git_fed(dir, &["log", "-z", "--format=%H%x01%B", "--stdin", "--"], input.to_string())?;
    let mut hits = BTreeSet::new();
    for record in out.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let (id, body) = match record.iter().position(|b| *b == 1) {
            Some(i) => (&record[..i], &record[i + 1..]),
            None => (&record[..0], record),
        };
        if content_hit(body) {
            hits.insert(format!("commit message {}", String::from_utf8_lossy(&id[..id.len().min(12)])));
        }
    }
    Ok(hits)
}

/// Scans the blobs in `blobs` (id to the names it has); the names of the offending files. Every
/// object must be answered for: a git that dies half-way is an error, not a pass.
fn scan_blobs(dir: &Path, blobs: &BTreeMap<String, BTreeSet<String>>) -> Result<BTreeSet<String>, String> {
    if blobs.is_empty() {
        return Ok(BTreeSet::new());
    }
    // Pass 1: type and size of every object, without reading any content.
    let (mut child, writer) = spawn_cat_file(dir, "--batch-check", blobs.keys().cloned().collect())?;
    let mut sizes: BTreeMap<String, u64> = BTreeMap::new();
    let mut answered = 0usize;
    for line in BufReader::new(child.stdout.take().ok_or("git has no output")?).lines() {
        let line = line.map_err(|e| e.to_string())?;
        answered += 1;
        let f: Vec<&str> = line.split_whitespace().collect();
        match f.as_slice() {
            [oid, "blob", size] => {
                sizes.insert(oid.to_string(), size.parse().map_err(|_| "git gave an unreadable size".to_string())?);
            }
            // rev-list --objects also names the commits and trees; they hold no file content.
            [_, "commit" | "tree" | "tag", _] => {}
            [_, "missing"] | [_, "ambiguous"] => return Err("could not read an object in the commits; fetch the full history and try again".into()),
            _ => return Err("git gave an answer about an object that Kolux does not understand, so nothing was scanned".into()),
        }
    }
    let _ = writer.join();
    if !child.wait().is_ok_and(|s| s.success()) || answered != blobs.len() {
        return Err("git did not describe every object, so nothing was scanned".into());
    }

    let mut hits = BTreeSet::new();
    let mut to_read = Vec::new();
    for (oid, size) in &sizes {
        let names = &blobs[oid];
        let by_name: Vec<&String> = names.iter().filter(|n| name_hit(n)).collect();
        if !by_name.is_empty() {
            hits.extend(by_name.into_iter().cloned());
        } else if *size > MAX_BYTES {
            hits.extend(names.iter().cloned());
        } else {
            to_read.push(oid.clone());
        }
    }
    if to_read.is_empty() {
        return Ok(hits);
    }
    // Pass 2: the content of the rest, one blob at a time.
    let wanted = to_read.len();
    let (mut child, writer) = spawn_cat_file(dir, "--batch", to_read)?;
    let mut out = BufReader::new(child.stdout.take().ok_or("git has no output")?);
    let mut header = String::new();
    let mut read = 0usize;
    loop {
        header.clear();
        if out.read_line(&mut header).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let f: Vec<&str> = header.split_whitespace().collect();
        let [oid, "blob", size] = f.as_slice() else { return Err("git gave an unreadable object".into()) };
        let size: usize = size.parse().map_err(|_| "git gave an unreadable size".to_string())?;
        let mut body = vec![0u8; size];
        out.read_exact(&mut body).map_err(|e| e.to_string())?;
        let mut nl = [0u8; 1];
        out.read_exact(&mut nl).map_err(|e| e.to_string())?;
        read += 1;
        if content_hit(&body) {
            hits.extend(blobs.get(*oid).into_iter().flatten().cloned());
        }
    }
    let _ = writer.join();
    if !child.wait().is_ok_and(|s| s.success()) || read != wanted {
        return Err("git did not hand over every file, so nothing was scanned".into());
    }
    Ok(hits)
}

/// Reads git's output without waiting for it forever: a thread per pipe, and the result comes
/// back over a channel so the wait can have a deadline.
fn drain(mut r: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = r.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    rx
}

/// Runs a prepared command with a deadline; whether it succeeded and what it printed on each pipe.
/// Both the process and the wait for its pipes to close are limited: a hook that leaves a program
/// running holds the pipes open long after git has exited.
fn run_split(mut cmd: Command, limit: Duration) -> Result<(bool, Vec<u8>, Vec<u8>), String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let out = drain(child.stdout.take().ok_or("git has no output")?);
    let err = drain(child.stderr.take().ok_or("git has no output")?);
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() >= deadline => {
                crate::procs::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                let secs = limit.as_secs();
                let human = if secs >= 60 { format!("{} minutes", secs / 60) } else { format!("{secs} seconds") };
                return Err(format!("git did not finish in {human}, so Kolux stopped waiting"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("could not wait for git: {e}")),
        }
    };
    let end = Instant::now() + DRAIN_GRACE;
    let take = |rx: mpsc::Receiver<Vec<u8>>| rx.recv_timeout(end.saturating_duration_since(Instant::now())).map_err(|_| "git finished, but a program it started still holds its output open, so Kolux stopped waiting".to_string());
    let (out, err) = (take(out)?, take(err)?);
    Ok((status.success(), out, err))
}

/// `run_split` with both pipes as one text (output first, then errors).
fn run_limited(cmd: Command, limit: Duration) -> Result<(bool, String), String> {
    let (ok, out, err) = run_split(cmd, limit)?;
    Ok((ok, format!("{}{}", String::from_utf8_lossy(&out), String::from_utf8_lossy(&err))))
}

/// What origin has: the branch its HEAD names, and every branch tip.
struct Remote {
    head: Option<String>,
    tips: Vec<String>,
}

/// `git ls-remote --symref origin HEAD 'refs/heads/*'`: `ref: refs/heads/<name>\tHEAD`, then
/// `<id>\t<ref>` lines.
fn parse_remote(text: &str) -> Remote {
    let mut remote = Remote { head: None, tips: Vec::new() };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
            if let Some((name, "HEAD")) = rest.split_once('\t') {
                remote.head = Some(name.to_string());
            }
        } else if let Some((oid, name)) = line.split_once('\t') {
            if is_oid(oid) && name.starts_with("refs/heads/") {
                remote.tips.push(oid.to_string());
            }
        }
    }
    remote
}

/// The tips of `tips` that are commits in this repository.
fn tips_here(dir: &Path, tips: &[String]) -> Result<Vec<String>, String> {
    if tips.is_empty() {
        return Ok(Vec::new());
    }
    let out = git_fed(dir, &["cat-file", "--batch-check"], tips.join("\n") + "\n")?;
    Ok(String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|l| match l.split_whitespace().collect::<Vec<_>>().as_slice() {
            [oid, "commit", _] => Some(oid.to_string()),
            _ => None,
        })
        .collect())
}

/// Why a git network call failed, in words for the window.
fn explain(log: &str, branch: &str, hook: bool) -> String {
    let message = match scm::failure_kind(log, hook) {
        "non-fast-forward" => format!("Not pushed: origin has newer commits on {branch} than this computer. Sync first (pull or rebase in Source Control); nothing was changed."),
        "sign-in" => "Not pushed: signing in to origin failed. Sign in again, then the next finished turn will push.".to_string(),
        "network" => "Not pushed: could not reach origin. The next finished turn will try again.".to_string(),
        "protected" => format!("Not pushed: origin does not accept pushes to {branch}."),
        "hook" => format!("Not pushed: a push hook refused it. {}", crate::git::failure_reason(log).unwrap_or_default()),
        _ => format!("Not pushed: {}", crate::git::failure_reason(log).unwrap_or_else(|| "git gave no reason".into())),
    };
    scrub(message.trim())
}

fn push_step(dir: &Path) -> Result<AutoStep, String> {
    let ctx = match gate(dir)? {
        Gate::Stop(s) => return Ok(s),
        Gate::Go(c) => c,
    };
    if let Some(stop) = upstream_rule(&ctx) {
        return Ok(stop);
    }
    let branch = &ctx.branch;
    let own = format!("origin/{branch}");
    let linked = ctx.st.upstream.as_deref() == Some(own.as_str());
    // A branch taken from a fork's pull request, or one that pushes somewhere else, is not ours to
    // push. A workspace branch that still tracks the default branch is pushed by name below.
    if let Some(t) = crate::pr_checkout::push_target(dir) {
        if t.fork.is_some() || t.remote != "origin" || (t.remote_branch != *branch && (linked || ctx.st.upstream.is_none())) {
            return Ok(step("skipped", format!("Skipped: {branch} pushes to {}/{}, not to a branch of the same name on origin.", t.remote, t.remote_branch)));
        }
    }
    if remote_kind(dir) == "none" {
        return Ok(step("local", "Nothing pushed: this repository has no remote, so the commits stay on this computer."));
    }
    if push_address_differs(dir) {
        return Ok(step("skipped", "Skipped: origin's push address differs from its fetch address, so the commits would not go where Kolux checked them."));
    }
    // One commit is scanned and that same commit is pushed, whatever happens to the branch meanwhile.
    let Some(oid) = run(&["rev-parse", "--verify", "-q", "HEAD^{commit}"], Some(dir)).ok().filter(|o| is_oid(o)) else {
        return Ok(step("clean", "Nothing to push yet: the branch has no commits."));
    };
    // What origin has right now, not what this computer last heard.
    let mut cmd = command(&["ls-remote", "--symref", "origin", "HEAD", "refs/heads/*"], Some(dir));
    cmd.envs(NO_PROMPT);
    let (ok, listing) = match run_limited(cmd, REMOTE_LIMIT) {
        Ok(r) => r,
        Err(e) => return Ok(step("failed", format!("Not pushed: could not read origin's branches: {}", scrub(&e)))),
    };
    if !ok {
        return Ok(step("failed", explain(&listing, branch, false)));
    }
    let remote = parse_remote(&listing);
    if let Some(head) = remote.head.as_deref().filter(|h| h.eq_ignore_ascii_case(branch)) {
        return Ok(step("skipped", format!("Skipped: {branch} is origin's default branch ({head}), and automatic pull requests only work on a branch of their own.")));
    }
    let input = range_input(&oid, &tips_here(dir, &remote.tips)?);
    let ahead = String::from_utf8_lossy(&git_fed(dir, &["rev-list", "--count", "--stdin", "--"], input.clone())?).trim().parse::<u64>().unwrap_or(1);
    if ahead == 0 {
        return Ok(step("clean", "Nothing to push: every commit is already on origin."));
    }
    let mut hits = scan_blobs(dir, &range_blobs(dir, &input)?)?;
    hits.extend(scan_messages(dir, &input)?);
    if !hits.is_empty() {
        return Ok(blocked("pushed", hits, "Remove them from the commits, or push by hand if they are not real secrets."));
    }
    // The commit that was scanned, to the branch of this name, never forced; the user's hooks still run.
    let refspec = format!("{oid}:refs/heads/{branch}");
    let mut cmd = command(&["push", "origin", &refspec], Some(dir));
    cmd.envs(NO_PROMPT);
    let (ok, log) = match run_limited(cmd, PUSH_LIMIT) {
        Ok(r) => r,
        Err(e) => return Ok(step("failed", format!("Not pushed: {}", scrub(&e)))),
    };
    if ok {
        // Link the branch to its own copy on origin (it had none, or tracked the default branch).
        if !linked && run(&["branch", &format!("--set-upstream-to={own}"), branch], Some(dir)).is_err() {
            return Ok(step("done", format!("Pushed {branch} to origin. It could not be linked to {own}; the next push will try again.")));
        }
        return Ok(step("done", format!("Pushed {branch} to origin.")));
    }
    let hook = run(&["rev-parse", "--git-path", "hooks"], Some(dir)).is_ok_and(|h| dir.join(&h).join("pre-push").is_file());
    Ok(step("failed", explain(&log, branch, hook)))
}

// ---------------------------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------------------------

/// The top of the repository `folder` is in; None when it is not one.
fn toplevel(folder: &str) -> Option<String> {
    let dir = Path::new(folder);
    if !dir.is_dir() {
        return None;
    }
    run(&["rev-parse", "--show-toplevel"], Some(dir)).ok().filter(|t| !t.is_empty())
}

/// ACCT-055: the step may run only in a folder the project fence allows; `allow` is the fence.
fn fenced(top: Option<String>, allow: impl FnOnce(&str) -> Result<PathBuf, String>) -> Result<PathBuf, AutoStep> {
    let Some(top) = top else { return Err(step("skipped", "Skipped: this folder is not a git repository.")) };
    allow(&top).map_err(|_| step("skipped", "Skipped: this folder is not a Kolux workspace."))
}

/// A step's answer for the window: an error inside it is a failed step, with nothing secret in it.
fn finish(r: Result<AutoStep, String>) -> AutoStep {
    let mut s = r.unwrap_or_else(|e| step("failed", e));
    s.message = scrub(&s.message);
    s
}

async fn fenced_step(
    folder: String,
    fence: &crate::fence::Fence,
    store: &std::sync::Mutex<crate::state::Store>,
    git: &Git,
    run_step: fn(&Path) -> Result<AutoStep, String>,
) -> Result<AutoStep, String> {
    let top = tauri::async_runtime::spawn_blocking(move || toplevel(&folder)).await.map_err(|e| e.to_string())?;
    let dir = match fenced(top, |t| fence.allow(t, store, git, false)) {
        Ok(d) => d,
        Err(stop) => return Ok(stop),
    };
    tauri::async_runtime::spawn_blocking(move || finish(run_step(&dir))).await.map_err(|e| e.to_string())
}

/// `none` (no origin remote, or not a repository), `github` or `other`.
#[tauri::command]
pub async fn auto_pr_remote(worktree: String) -> String {
    tauri::async_runtime::spawn_blocking(move || remote_kind(Path::new(&worktree)).to_string()).await.unwrap_or_else(|_| "none".into())
}

/// Commits the workspace's changes on its own branch, after scanning every file the commit would add.
/// ACCT-055: only inside a project or worktree (fence.rs).
#[tauri::command]
pub async fn auto_pr_commit(worktree: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, Git>) -> Result<AutoStep, String> {
    fenced_step(worktree, &fence, &store, &git, commit_step).await
}

/// Scans every commit not yet on origin, then pushes the branch (never forced).
/// ACCT-055: only inside a project or worktree (fence.rs).
#[tauri::command]
pub async fn auto_pr_push(worktree: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, Git>) -> Result<AutoStep, String> {
    fenced_step(worktree, &fence, &store, &git, push_step).await
}

/// What `auto_pr_commit` would be stopped by (secret names and content, sizes, dependency folders,
/// too many files), without staging anything: clean, blocked (the files) or failed.
/// ACCT-055: only inside a project or worktree (fence.rs).
#[tauri::command]
pub async fn auto_pr_scan(worktree: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, Git>) -> Result<AutoStep, String> {
    fenced_step(worktree, &fence, &store, &git, scan_step).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn id() -> u32 {
        std::process::id()
    }

    /// A repository on `main` with one commit and local test identity.
    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-autopr-{name}-{}", id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        for (k, v) in [("user.email", "test@example.com"), ("user.name", "Kolux RS test"), ("core.autocrlf", "false"), ("commit.gpgsign", "false")] {
            run(&["config", k, v], Some(&dir)).unwrap();
        }
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        dir
    }

    fn url(p: &Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    fn bare_repo(name: &str, head: &str) -> PathBuf {
        let bare = std::env::temp_dir().join(format!("kolux-rs-autopr-bare-{name}-{}", id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", head], Some(&bare)).unwrap();
        bare
    }

    /// A repository whose origin is a local bare repository with `main` pushed and origin/HEAD set.
    fn with_origin(name: &str) -> (PathBuf, PathBuf) {
        let bare = bare_repo(name, "main");
        let dir = repo(name);
        run(&["remote", "add", "origin", &url(&bare)], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        (dir, bare)
    }

    fn branch(dir: &Path, name: &str) {
        run(&["checkout", "-q", "-b", name], Some(dir)).unwrap();
    }

    fn commit_file(dir: &Path, name: &str, text: &str) {
        fs::write(dir.join(name), text).unwrap();
        run(&["add", "."], Some(dir)).unwrap();
        run(&["commit", "-q", "-m", name], Some(dir)).unwrap();
    }

    fn cleanup(paths: &[&Path]) {
        for p in paths {
            let _ = fs::remove_dir_all(p);
        }
    }

    /// A GitHub-token-shaped string built at run time, so no source line matches a scanner.
    fn fake_token() -> String {
        format!("{}{}", ["gh", "p_"].concat(), "Ab1Cd2".repeat(6))
    }

    /// A Claude-key-shaped string built at run time.
    fn fake_claude_key() -> String {
        ["sk", "-ant-", &"a1".repeat(12)].concat()
    }

    fn index_of(dir: &Path) -> String {
        run(&["status", "--porcelain=v1", "--untracked-files=all"], Some(dir)).unwrap()
    }

    fn head(dir: &Path) -> String {
        run(&["rev-parse", "HEAD"], Some(dir)).unwrap()
    }

    fn remote_ref(bare: &Path, name: &str) -> Option<String> {
        run(&["rev-parse", "--verify", "-q", &format!("refs/heads/{name}")], Some(bare)).ok()
    }

    fn utf16(text: &str, big: bool, bom: bool) -> Vec<u8> {
        let mut out = Vec::new();
        if bom {
            out.extend(if big { [0xFE, 0xFF] } else { [0xFF, 0xFE] });
        }
        for unit in text.encode_utf16() {
            out.extend(if big { unit.to_be_bytes() } else { unit.to_le_bytes() });
        }
        out
    }

    fn hook(dir: &Path, name: &str, body: &str) {
        let path = dir.join(".git").join("hooks").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, body).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    // ---- the scan ---------------------------------------------------------------------------

    #[test]
    fn t652_scan_names_by_depth_and_case() {
        for hit in [
            ".env", ".ENV", "app/.env", r"app\.env.local", ".env.production", ".env.dist", "prod.env", "k/server.PEM", "a/b/tls.key", "x.p12", "x.pfx", "release.jks", "app.keystore", "id_rsa",
            "home/.ssh/ID_ED25519", "id_dsa", "id_ecdsa", "id_rsa_work", "id_ed25519-ci", ".netrc", "_netrc", "h/.git-credentials", "infra/terraform.tfstate", "terraform.tfstate.backup",
        ] {
            assert!(scan(hit, 1, b""), "{hit} should stop");
        }
        for pass in [
            ".env.example", ".env.sample", ".env.local.template", "id_rsa.pub", "id_rsa_work.pub", "id_ed25519.pub", "id_rsabc", "environment.ts", "keys.md", "monkey.txt", "README.md", "src/env.rs",
            "terraform.tfstate.md", "netrc.md",
        ] {
            assert!(!scan(pass, 1, b""), "{pass} should pass");
        }
    }

    #[test]
    fn t652_scan_content_shapes_and_boundaries() {
        let a = |parts: &[&str]| parts.concat();
        let hits = [
            a(&["-----BEGIN ", "RSA PRIVATE", " KEY-----\nabc"]),
            a(&["-----BEGIN ", "PRIVATE", " KEY-----"]),
            a(&["key=", "AK", "IA", &"A1B2".repeat(4)]),
            a(&["AS", "IA", &"Z9".repeat(8)]),
            fake_token(),
            a(&["gh", "s_", &"x".repeat(36)]),
            a(&["github", "_pat_", &"a_B1".repeat(6)]),
            fake_claude_key(),
            a(&["sk", "-proj-", &"a1".repeat(12)]),
            a(&["sk", "_live_", &"a1".repeat(8)]),
            a(&["xo", "xb-", "1234567890"]),
            a(&["AI", "za", &"a-_1".repeat(9)[..35]]),
            a(&["gl", "pat-", &"a1".repeat(10)]),
            a(&["np", "m_", &"a1".repeat(18)]),
            a(&["//registry.example.org/:_auth", "Token=", "abc123"]),
            a(&["_auth", "Token = ", "abc123"]),
        ];
        for h in &hits {
            assert!(scan("notes.txt", 10, h.as_bytes()), "should stop on a key shape");
        }
        // Too short, or glued to a longer word.
        let misses = [
            a(&["task", "-ant-", &"a1".repeat(12)]),
            a(&["sk", "-ant-", "short"]),
            a(&["gh", "p_", "tooshort"]),
            a(&["xo", "xb-", "123"]),
            a(&["the _auth", "Token setting"]),
            "plain text with token and ghp_ words".to_string(),
        ];
        for m in &misses {
            assert!(!scan("notes.txt", 10, m.as_bytes()), "should not stop: {m}");
        }
    }

    #[test]
    fn t652_scan_reads_through_nul_bytes_and_utf16() {
        let token = fake_token();
        // NUL bytes in front, or anywhere, do not hide a key.
        let mut prefixed = vec![0u8; 16];
        prefixed.extend_from_slice(token.as_bytes());
        assert!(scan("blob.bin", prefixed.len() as u64, &prefixed), "NUL-prefixed key");
        // UTF-16, either byte order, with or without a byte-order mark.
        for big in [false, true] {
            for bom in [false, true] {
                let text = utf16(&format!("TOKEN={token}\n"), big, bom);
                assert!(scan("notes.txt", text.len() as u64, &text), "utf16 big={big} bom={bom}");
                let calm = utf16("nothing secret in this text\n", big, bom);
                assert!(!scan("notes.txt", calm.len() as u64, &calm), "clean utf16 big={big} bom={bom}");
            }
        }
        // One byte in front shifts the alignment of the pairs; both alignments are read.
        let mut shifted = vec![b'x'];
        shifted.extend(utf16(&token, false, false));
        assert!(scan("n.txt", shifted.len() as u64, &shifted), "shifted utf16");
        // Size still counts without reading.
        assert!(!scan("a.txt", MAX_BYTES, b""), "exactly 10 MB is fine");
        assert!(scan("a.txt", MAX_BYTES + 1, b""), "over 10 MB stops without content");
        let mut late = token.into_bytes();
        late.extend(vec![b' '; 9000]);
        late.push(0);
        assert!(scan("a.txt", late.len() as u64, &late));
    }

    #[test]
    fn t652_the_scanner_passes_this_very_source_file() {
        let src = include_str!("auto_pr.rs");
        assert!(!scan("src/auto_pr.rs", src.len() as u64, src.as_bytes()), "the source must not hold a real-looking key");
    }

    #[test]
    fn t652_remote_classifies_the_url_forms() {
        let dir = repo("remote-kinds");
        assert_eq!(remote_kind(&dir), "none");
        for (url, want) in [
            ("https://github.com/o/r.git", "github"),
            ("https://user:pw@github.com/o/r", "github"),
            ("http://GitHub.com/o/r", "github"),
            ("git@github.com:o/r.git", "github"),
            ("ssh://git@github.com/o/r.git", "github"),
            ("ssh://git@github.com:22/o/r.git", "github"),
            ("https://gitlab.com/o/r.git", "other"),
            ("git@gitlab.com:o/github.com.git", "other"),
            ("https://github.com.evil.example/o/r", "other"),
            ("https://notgithub.com/o/r", "other"),
            ("C:/some/bare.git", "other"),
        ] {
            run(&["remote", "remove", "origin"], Some(&dir)).ok();
            run(&["remote", "add", "origin", url], Some(&dir)).unwrap();
            assert_eq!(remote_kind(&dir), want, "{url}");
        }
        let not_repo = std::env::temp_dir().join(format!("kolux-rs-autopr-norepo-{}", id()));
        fs::create_dir_all(&not_repo).unwrap();
        assert_eq!(remote_kind(&not_repo), "none");
        cleanup(&[&dir, &not_repo]);
    }

    #[test]
    fn t652_address_forms_compare_by_host_and_path() {
        let same = ["https://Example.com/o/r.git", "git@example.com:o/r", "ssh://git@example.com:22/o/r/", "https://user:pw@example.com/o/r"];
        for u in same {
            assert_eq!(address_key(u), address_key(same[0]), "{u}");
        }
        for other in ["https://example.com/o/r2", "https://example.org/o/r", "git@example.com:other/r"] {
            assert_ne!(address_key(other), address_key(same[0]), "{other}");
        }
    }

    // ---- the guards every step shares ------------------------------------------------------------

    #[test]
    fn t652_commit_is_refused_on_the_default_branch() {
        let (dir, bare) = with_origin("c-default");
        fs::write(dir.join("new.txt"), "x\n").unwrap();
        let before = head(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        assert!(s.message.contains("default branch"), "{}", s.message);
        assert_eq!(head(&dir), before);
        assert!(index_of(&dir).contains("?? new.txt"), "nothing staged");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_the_default_branch_in_other_capitals_is_refused() {
        let (dir, bare) = with_origin("a-case");
        fs::write(dir.join("new.txt"), "x\n").unwrap();
        let before = head(&dir);
        // HEAD names `Main`; a Windows disk reads that as `main`, another disk as a branch with no commits.
        run(&["symbolic-ref", "HEAD", "refs/heads/Main"], Some(&dir)).unwrap();
        for s in [commit_step(&dir).unwrap(), push_step(&dir).unwrap(), scan_step(&dir).unwrap()] {
            assert_eq!(s.kind, "skipped", "{s:?}");
            assert!(s.message.contains("default branch"), "{}", s.message);
        }
        assert_eq!(remote_ref(&bare, "main").as_deref(), Some(before.as_str()));
        assert!(index_of(&dir).contains("?? new.txt"), "nothing staged");
        cleanup(&[&dir, &bare]);
    }

    #[cfg(windows)]
    #[test]
    fn t652_a_branch_spelled_with_other_capitals_than_git_lists_is_refused() {
        let (dir, bare) = with_origin("a-spell");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        // The disk finds refs/heads/Feature, but git lists the branch as `feature`.
        run(&["symbolic-ref", "HEAD", "refs/heads/Feature"], Some(&dir)).unwrap();
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        for s in [commit_step(&dir).unwrap(), push_step(&dir).unwrap()] {
            assert_eq!(s.kind, "skipped", "{s:?}");
            assert!(s.message.contains("exactly that name"), "{}", s.message);
        }
        assert_eq!(remote_ref(&bare, "feature"), None);
        assert!(index_of(&dir).contains("?? b.txt"), "nothing staged");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_branch_name_starting_with_a_dash_is_refused() {
        let (dir, bare) = with_origin("a-dash");
        run(&["update-ref", "refs/heads/-x", "HEAD"], Some(&dir)).unwrap();
        run(&["symbolic-ref", "HEAD", "refs/heads/-x"], Some(&dir)).unwrap();
        fs::write(dir.join("new.txt"), "x\n").unwrap();
        for s in [commit_step(&dir).unwrap(), push_step(&dir).unwrap()] {
            assert_eq!(s.kind, "skipped", "{s:?}");
            assert!(s.message.contains("dash"), "{}", s.message);
        }
        assert!(index_of(&dir).contains("?? new.txt"), "nothing staged");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_other_guards_skip_detached_unfinished_and_unrepo() {
        let (dir, bare) = with_origin("c-guards");
        run(&["checkout", "-q", "--detach"], Some(&dir)).unwrap();
        assert_eq!(commit_step(&dir).unwrap().kind, "skipped");
        assert_eq!(push_step(&dir).unwrap().kind, "skipped");
        run(&["checkout", "-q", "-b", "feature"], Some(&dir)).unwrap();
        // A merge in progress.
        commit_file(&dir, "f.txt", "a\n");
        run(&["checkout", "-q", "-b", "other", "main"], Some(&dir)).unwrap();
        commit_file(&dir, "f.txt", "b\n");
        run(&["checkout", "-q", "feature"], Some(&dir)).unwrap();
        let _ = run(&["merge", "other"], Some(&dir));
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        assert_eq!(push_step(&dir).unwrap().kind, "skipped");
        let not_repo = std::env::temp_dir().join(format!("kolux-rs-autopr-guard-norepo-{}", id()));
        fs::create_dir_all(&not_repo).unwrap();
        assert_eq!(commit_step(&not_repo).unwrap().kind, "skipped");
        assert_eq!(push_step(&not_repo).unwrap().kind, "skipped");
        assert_eq!(scan_step(&not_repo).unwrap().kind, "skipped");
        cleanup(&[&dir, &bare, &not_repo]);
    }

    #[test]
    fn t652_a_workspace_that_tracks_origin_main_commits_pushes_and_is_retargeted() {
        let (dir, bare) = with_origin("b-ws");
        let ws = std::env::temp_dir().join(format!("kolux-rs-autopr-ws-{}", id()));
        let _ = fs::remove_dir_all(&ws);
        run(&["worktree", "add", "-q", "-b", "ws", &url(&ws), "origin/main"], Some(&dir)).unwrap();
        assert_eq!(scm::status(&ws).unwrap().upstream.as_deref(), Some("origin/main"), "the premise: cut from origin/main it tracks it");
        assert_eq!(push_step(&ws).unwrap().kind, "clean", "nothing new yet");
        fs::write(ws.join("work.txt"), "w\n").unwrap();
        let s = commit_step(&ws).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        let main_before = remote_ref(&bare, "main");
        let s = push_step(&ws).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        assert_eq!(remote_ref(&bare, "ws"), Some(head(&ws)), "pushed to its own branch");
        assert_eq!(remote_ref(&bare, "main"), main_before, "the default branch is untouched");
        assert_eq!(scm::status(&ws).unwrap().upstream.as_deref(), Some("origin/ws"), "linked to its own copy");
        assert_eq!(push_step(&ws).unwrap().kind, "clean");
        run(&["worktree", "remove", "--force", &url(&ws)], Some(&dir)).ok();
        cleanup(&[&dir, &bare, &ws]);
    }

    #[test]
    fn t652_any_other_upstream_skips_commit_and_push_alike() {
        let (dir, bare) = with_origin("b-odd");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        run(&["push", "-q", "origin", "main:other"], Some(&dir)).unwrap();
        run(&["branch", "--set-upstream-to=origin/other"], Some(&dir)).unwrap();
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        let before = head(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        assert!(s.message.contains("origin/other"), "{}", s.message);
        assert_eq!(push_step(&dir).unwrap().kind, "skipped");
        assert_eq!(scan_step(&dir).unwrap().kind, "skipped");
        assert_eq!(head(&dir), before);
        assert!(index_of(&dir).contains("?? b.txt"), "nothing staged");
        assert_eq!(remote_ref(&bare, "feature"), None);
        cleanup(&[&dir, &bare]);
    }

    // ---- commit ---------------------------------------------------------------------------------

    #[test]
    fn t652_a_clean_branch_is_clean_and_changes_commit_with_the_plain_message() {
        let (dir, bare) = with_origin("c-ok");
        branch(&dir, "feature");
        assert_eq!(commit_step(&dir).unwrap().kind, "clean");
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/a.rs"), "fn a() {}\n").unwrap();
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        assert!(s.message.starts_with("Committed "), "{}", s.message);
        assert_eq!(run(&["log", "-1", "--format=%s"], Some(&dir)).unwrap(), "Auto-commit on feature after an agent turn");
        assert_eq!(index_of(&dir), "", "everything committed");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_an_env_file_blocks_the_commit_and_leaves_the_index_untouched() {
        let (dir, bare) = with_origin("c-env");
        branch(&dir, "feature");
        fs::write(dir.join(".env"), "DATABASE_URL=postgres://localhost/db\n").unwrap();
        fs::write(dir.join("ok.txt"), "fine\n").unwrap();
        let before_head = head(&dir);
        let before = index_of(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "blocked", "{s:?}");
        assert_eq!(s.files, [".env"]);
        assert!(!s.message.contains("postgres"), "the value is never shown");
        assert_eq!(index_of(&dir), before, "nothing staged");
        assert_eq!(head(&dir), before_head, "nothing committed");
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_env_example_passes() {
        let (dir, bare) = with_origin("c-example");
        branch(&dir, "feature");
        fs::write(dir.join(".env.example"), "DATABASE_URL=\n").unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_key_inside_a_file_blocks_the_commit() {
        let (dir, bare) = with_origin("c-key");
        branch(&dir, "feature");
        let token = fake_token();
        fs::write(dir.join("deploy.sh"), format!("export TOKEN={token}\n")).unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["deploy.sh".to_string()].as_slice()));
        assert!(!s.message.contains(&token) && s.files.iter().all(|f| !f.contains(&token)));
        assert_eq!(index_of(&dir), "?? deploy.sh");
        // An already-staged file is scanned too.
        run(&["add", "deploy.sh"], Some(&dir)).unwrap();
        assert_eq!(commit_step(&dir).unwrap().kind, "blocked");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_file_over_10_mb_blocks_the_commit() {
        let (dir, bare) = with_origin("c-big");
        branch(&dir, "feature");
        let big = fs::File::create(dir.join("video.mov")).unwrap();
        big.set_len(MAX_BYTES + 1).unwrap();
        drop(big);
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["video.mov".to_string()].as_slice()), "{s:?}");
        assert!(s.message.contains("10 MB"));
        assert_eq!(index_of(&dir), "?? video.mov");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_deleted_secret_is_not_scanned_on_commit() {
        let (dir, bare) = with_origin("c-del");
        branch(&dir, "feature");
        commit_file(&dir, ".env", "A=1\n");
        fs::remove_file(dir.join(".env")).unwrap();
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "a deletion adds nothing: {s:?}");
        // The earlier commit still carries the secret, so the push is where it stops.
        assert_eq!(push_step(&dir).unwrap().kind, "blocked");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_utf16_and_nul_prefixed_secrets_block_the_commit_and_the_push() {
        let (dir, bare) = with_origin("d-wide");
        branch(&dir, "feature");
        let token = fake_token();
        fs::write(dir.join("notes.txt"), utf16(&format!("TOKEN={token}\n"), false, true)).unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["notes.txt".to_string()].as_slice()), "{s:?}");
        fs::remove_file(dir.join("notes.txt")).unwrap();
        let mut nul = vec![0u8; 32];
        nul.extend_from_slice(token.as_bytes());
        fs::write(dir.join("data.bin"), &nul).unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["data.bin".to_string()].as_slice()), "{s:?}");
        assert_eq!(index_of(&dir), "?? data.bin", "nothing staged");
        // The same in a commit someone made by hand: the push scan reads the raw blobs.
        fs::remove_file(dir.join("data.bin")).unwrap();
        fs::write(dir.join("wide.txt"), utf16(&format!("TOKEN={token}\n"), true, false)).unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "by hand"], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["wide.txt".to_string()].as_slice()), "{s:?}");
        assert_eq!(remote_ref(&bare, "feature"), None);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_hook_refusal_puts_the_staging_area_back() {
        let (dir, bare) = with_origin("j-hook");
        branch(&dir, "feature");
        let key = fake_claude_key();
        hook(&dir, "pre-commit", &format!("#!/bin/sh\necho \"hook says no {key}\" >&2\nexit 1\n"));
        fs::write(dir.join("ok.txt"), "fine\n").unwrap();
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let before_head = head(&dir);
        let before = index_of(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "failed", "{s:?}");
        assert!(s.message.to_lowercase().contains("hook"), "{}", s.message);
        assert!(!s.message.contains(&key), "the key in the hook output is masked: {}", s.message);
        assert_eq!(index_of(&dir), before, "the staging area is as it was");
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "");
        assert_eq!(head(&dir), before_head);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_what_the_commit_would_hold_is_what_gets_scanned() {
        let (dir, bare) = with_origin("j-filter");
        branch(&dir, "feature");
        commit_file(&dir, ".gitattributes", "*.cfg filter=addtoken\n");
        // A clean filter adds a key to the file on its way into the index; the working file has none.
        run(&["config", "filter.addtoken.clean", &format!("cat; echo TOKEN={}", fake_token())], Some(&dir)).unwrap();
        fs::write(dir.join("app.cfg"), "a=1\n").unwrap();
        let before_head = head(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["app.cfg".to_string()].as_slice()), "{s:?}");
        assert_eq!(index_of(&dir), "?? app.cfg", "the staging area is as it was");
        assert_eq!(head(&dir), before_head);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_dependency_folders_block_the_commit_until_they_are_ignored() {
        let (dir, bare) = with_origin("k-heavy");
        branch(&dir, "feature");
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), "x\n").unwrap();
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let before_head = head(&dir);
        let before = index_of(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["node_modules".to_string()].as_slice()), "{s:?}");
        assert!(s.message.contains("node_modules") && s.message.contains(".gitignore"), "{}", s.message);
        assert_eq!(index_of(&dir), before, "nothing staged");
        assert_eq!(head(&dir), before_head);
        // Ignored first, it goes through and the folder stays out.
        fs::write(dir.join(".gitignore"), "node_modules/\n").unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        assert!(!run(&["ls-files"], Some(&dir)).unwrap().contains("node_modules"));
        // A folder the project already keeps in git on purpose is its own choice.
        fs::create_dir_all(dir.join("build")).unwrap();
        commit_file(&dir, "build/a.js", "a\n");
        fs::write(dir.join("build/b.js"), "b\n").unwrap();
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_more_than_5000_files_block_the_commit() {
        let (dir, bare) = with_origin("k-count");
        branch(&dir, "feature");
        fs::create_dir_all(dir.join("gen")).unwrap();
        for i in 0..=MAX_FILES {
            fs::write(dir.join("gen").join(format!("f{i}.txt")), "x").unwrap();
        }
        let before_head = head(&dir);
        let s = commit_step(&dir).unwrap();
        assert_eq!(s.kind, "blocked", "{s:?}");
        assert!(s.message.contains("5000") && s.message.contains(".gitignore"), "{}", s.message);
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "", "nothing staged");
        assert_eq!(head(&dir), before_head);
        let s = scan_step(&dir).unwrap();
        assert_eq!(s.kind, "blocked", "{s:?}");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_auto_pr_scan_reports_without_staging_anything() {
        let (dir, bare) = with_origin("n-scan");
        assert_eq!(scan_step(&dir).unwrap().kind, "skipped", "the default branch");
        branch(&dir, "feature");
        let s = scan_step(&dir).unwrap();
        assert_eq!(s.kind, "clean", "{s:?}");
        assert!(s.message.contains("Nothing to scan"), "{}", s.message);
        fs::write(dir.join("ok.txt"), "fine\n").unwrap();
        assert_eq!(scan_step(&dir).unwrap().kind, "clean");
        assert_eq!(index_of(&dir), "?? ok.txt");
        fs::write(dir.join(".env"), "A=1\n").unwrap();
        let s = scan_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", [".env".to_string()].as_slice()), "{s:?}");
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "", "nothing staged");
        fs::remove_file(dir.join(".env")).unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/x.js"), "x\n").unwrap();
        let s = scan_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["node_modules".to_string()].as_slice()), "{s:?}");
        fs::remove_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("deploy.sh"), format!("TOKEN={}\n", fake_token())).unwrap();
        let s = scan_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["deploy.sh".to_string()].as_slice()), "{s:?}");
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "", "nothing staged");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_file_that_cannot_be_looked_at_is_an_error_not_a_pass() {
        let dir = repo("w-gone");
        let paths = BTreeSet::from(["gone.txt".to_string()]);
        assert!(scan_worktree(&dir, &paths).is_err());
        cleanup(&[&dir]);
    }

    // ---- push -------------------------------------------------------------------------------------

    #[test]
    fn t652_a_secret_added_then_deleted_still_blocks_the_push() {
        let (dir, bare) = with_origin("p-gone");
        branch(&dir, "feature");
        commit_file(&dir, "deploy.sh", &format!("TOKEN={}\n", fake_token()));
        run(&["rm", "-q", "deploy.sh"], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "remove it"], Some(&dir)).unwrap();
        commit_file(&dir, "more.txt", "fine\n");
        let s = push_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["deploy.sh".to_string()].as_slice()), "{s:?}");
        assert!(s.message.starts_with("Not pushed: 1 file looks like secrets"), "{}", s.message);
        assert_eq!(remote_ref(&bare, "feature"), None, "no new ref on the remote");
        // The same goes for a secret by name.
        let (dir2, bare2) = with_origin("p-gone2");
        branch(&dir2, "feature");
        fs::create_dir_all(dir2.join("cfg")).unwrap();
        commit_file(&dir2, "cfg/.env.production", "A=1\n");
        run(&["rm", "-q", "-r", "cfg"], Some(&dir2)).unwrap();
        run(&["commit", "-q", "-m", "remove it"], Some(&dir2)).unwrap();
        let s = push_step(&dir2).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["cfg/.env.production".to_string()].as_slice()), "{s:?}");
        assert_eq!(remote_ref(&bare2, "feature"), None);
        cleanup(&[&dir, &bare, &dir2, &bare2]);
    }

    #[test]
    fn t652_a_rewound_remote_cannot_hide_a_published_secret() {
        let (dir, bare) = with_origin("f-rewind");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        assert_eq!(push_step(&dir).unwrap().kind, "done");
        let c1 = head(&dir);
        // A secret goes up by hand, then the remote branch is moved back before it; this computer's
        // idea of origin/feature (the stale upstream) still includes the secret.
        commit_file(&dir, "deploy.sh", &format!("TOKEN={}\n", fake_token()));
        run(&["push", "-q", "origin", "feature"], Some(&dir)).unwrap();
        run(&["update-ref", "refs/heads/feature", &c1], Some(&bare)).unwrap();
        commit_file(&dir, "more.txt", "fine\n");
        let s = push_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["deploy.sh".to_string()].as_slice()), "{s:?}");
        assert_eq!(remote_ref(&bare, "feature"), Some(c1), "the remote is as it was");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_replaced_objects_do_not_hide_a_secret_from_the_push_scan() {
        let (dir, bare) = with_origin("h-replace");
        branch(&dir, "feature");
        commit_file(&dir, "deploy.sh", &format!("TOKEN={}\n", fake_token()));
        let secret = run(&["rev-parse", "HEAD:deploy.sh"], Some(&dir)).unwrap();
        commit_file(&dir, "clean.txt", "fine\n");
        let clean = run(&["rev-parse", "HEAD:clean.txt"], Some(&dir)).unwrap();
        run(&["replace", &secret, &clean], Some(&dir)).unwrap();
        assert_eq!(run(&["cat-file", "-p", &secret], Some(&dir)).unwrap(), "fine", "the premise: the replacement shows clean text");
        let s = push_step(&dir).unwrap();
        assert_eq!((s.kind.as_str(), s.files.as_slice()), ("blocked", ["deploy.sh".to_string()].as_slice()), "{s:?}");
        assert_eq!(remote_ref(&bare, "feature"), None);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_secret_in_a_commit_message_blocks_the_push() {
        let (dir, bare) = with_origin("i-message");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        let token = fake_token();
        run(&["commit", "--allow-empty", "-q", "-m", &format!("Deploy with TOKEN={token}")], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "blocked", "{s:?}");
        assert!(s.files.len() == 1 && s.files[0].starts_with("commit message "), "{:?}", s.files);
        assert!(!s.message.contains(&token) && !s.files[0].contains(&token));
        assert_eq!(remote_ref(&bare, "feature"), None);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_an_object_git_cannot_find_is_an_error_not_a_pass() {
        let dir = repo("i-missing");
        let blobs = BTreeMap::from([("0123456789abcdef0123456789abcdef01234567".to_string(), BTreeSet::from(["x.txt".to_string()]))]);
        assert!(scan_blobs(&dir, &blobs).is_err());
        cleanup(&[&dir]);
    }

    #[test]
    fn t652_the_remote_default_branch_is_refused_in_any_capitals() {
        let bare = bare_repo("f-trunk", "trunk");
        let dir = repo("f-trunk");
        run(&["remote", "add", "origin", &url(&bare)], Some(&dir)).unwrap();
        run(&["push", "-q", "origin", "main:trunk"], Some(&dir)).unwrap();
        let before = remote_ref(&bare, "trunk");
        assert!(before.is_some());
        branch(&dir, "TRUNK");
        commit_file(&dir, "a.txt", "a\n");
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        assert!(s.message.contains("origin's default branch"), "{}", s.message);
        assert_eq!(remote_ref(&bare, "trunk"), before, "the remote branch is as it was");
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_different_push_address_skips_the_push() {
        let (dir, bare) = with_origin("g-push");
        let elsewhere = bare_repo("g-push-elsewhere", "main");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        run(&["config", "remote.origin.pushurl", &url(&elsewhere)], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        assert!(s.message.contains("push address"), "{}", s.message);
        assert_eq!(remote_ref(&bare, "feature"), None);
        assert_eq!(remote_ref(&elsewhere, "feature"), None);
        // The same place under the push address is fine.
        run(&["config", "remote.origin.pushurl", &url(&bare)], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        assert_eq!(remote_ref(&bare, "feature"), Some(head(&dir)));
        cleanup(&[&dir, &bare, &elsewhere]);
    }

    #[test]
    fn t652_a_clean_feature_branch_pushes_and_the_remote_equals_head() {
        let (dir, bare) = with_origin("p-ok");
        branch(&dir, "feature");
        assert_eq!(push_step(&dir).unwrap().kind, "clean", "nothing ahead of main yet");
        commit_file(&dir, "a.txt", "a\n");
        commit_file(&dir, ".env.example", "A=\n");
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "done", "{s:?}");
        assert_eq!(remote_ref(&bare, "feature"), Some(head(&dir)));
        assert_eq!(scm::status(&dir).unwrap().upstream.as_deref(), Some("origin/feature"), "upstream set on the first push");
        assert_eq!(push_step(&dir).unwrap().kind, "clean", "nothing left to push");
        // A later turn pushes only the new commit, with the upstream already set.
        commit_file(&dir, "b.txt", "b\n");
        assert_eq!(push_step(&dir).unwrap().kind, "done");
        assert_eq!(remote_ref(&bare, "feature"), Some(head(&dir)));
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_remote_that_moved_on_fails_with_sync_first_and_changes_nothing() {
        let (dir, bare) = with_origin("p-moved");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        assert_eq!(push_step(&dir).unwrap().kind, "done");
        // Someone else pushes to the same branch.
        let other = std::env::temp_dir().join(format!("kolux-rs-autopr-other-{}", id()));
        let _ = fs::remove_dir_all(&other);
        run(&["clone", "-q", &url(&bare), &other.to_string_lossy()], None).unwrap();
        for (k, v) in [("user.email", "test@example.com"), ("user.name", "Other"), ("commit.gpgsign", "false")] {
            run(&["config", k, v], Some(&other)).unwrap();
        }
        run(&["checkout", "-q", "feature"], Some(&other)).unwrap();
        commit_file(&other, "theirs.txt", "t\n");
        run(&["push", "-q", "origin", "feature"], Some(&other)).unwrap();
        let theirs = remote_ref(&bare, "feature").unwrap();
        // This side adds its own commit.
        commit_file(&dir, "mine.txt", "m\n");
        let mine = head(&dir);
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "failed", "{s:?}");
        assert!(s.message.contains("Sync first"), "{}", s.message);
        assert_eq!(remote_ref(&bare, "feature"), Some(theirs), "the remote branch is unchanged");
        assert_eq!(head(&dir), mine, "local HEAD is unchanged");
        cleanup(&[&dir, &bare, &other]);
    }

    #[test]
    fn t652_no_origin_is_local_and_an_unreachable_origin_fails_closed() {
        let dir = repo("p-local");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "local", "{s:?}");
        assert!(s.message.contains("stay on this computer"));
        let nowhere = std::env::temp_dir().join(format!("kolux-rs-autopr-nowhere-{}", id()));
        run(&["remote", "add", "origin", &url(&nowhere)], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "failed", "{s:?}");
        assert!(s.message.starts_with("Not pushed"), "{}", s.message);
        cleanup(&[&dir]);
    }

    #[test]
    fn t652_a_branch_pushed_to_another_remote_name_is_skipped() {
        let (dir, bare) = with_origin("p-fork");
        branch(&dir, "feature");
        commit_file(&dir, "a.txt", "a\n");
        run(&["config", "branch.feature.remote", "origin"], Some(&dir)).unwrap();
        run(&["config", "branch.feature.merge", "refs/heads/renamed"], Some(&dir)).unwrap();
        let s = push_step(&dir).unwrap();
        assert_eq!(s.kind, "skipped", "{s:?}");
        run(&["config", "--unset", "branch.feature.merge"], Some(&dir)).unwrap();
        run(&["config", "branch.feature.remote", "fork"], Some(&dir)).unwrap();
        run(&["remote", "add", "fork", "https://github.com/someone/else.git"], Some(&dir)).unwrap();
        assert_eq!(push_step(&dir).unwrap().kind, "skipped");
        assert_eq!(remote_ref(&bare, "feature"), None);
        cleanup(&[&dir, &bare]);
    }

    #[test]
    fn t652_a_push_never_runs_on_the_default_branch() {
        let (dir, bare) = with_origin("p-main");
        commit_file(&dir, "a.txt", "a\n");
        let before = remote_ref(&bare, "main");
        assert_eq!(push_step(&dir).unwrap().kind, "skipped");
        assert_eq!(remote_ref(&bare, "main"), before);
        cleanup(&[&dir, &bare]);
    }

    // ---- the fence, messages and the time limit ---------------------------------------------------------

    #[test]
    fn t652_the_fence_decides_where_a_step_may_run() {
        let inside = std::env::temp_dir().join(format!("kolux-rs-autopr-fence-in-{}", id()));
        let outside = std::env::temp_dir().join(format!("kolux-rs-autopr-fence-out-{}", id()));
        for p in [&inside, &outside] {
            let _ = fs::remove_dir_all(p);
            fs::create_dir_all(p.join("sub")).unwrap();
        }
        let roots = vec![inside.clone()];
        let allow = |t: &str| crate::fence::check(Path::new(t), &roots, &[], false);
        assert!(fenced(Some(inside.join("sub").to_string_lossy().into()), allow).is_ok());
        let refused = fenced(Some(outside.join("sub").to_string_lossy().into()), allow).unwrap_err();
        assert_eq!(refused.kind, "skipped");
        assert!(refused.message.contains("not a Kolux workspace"), "{}", refused.message);
        let nowhere = fenced(None, allow).unwrap_err();
        assert_eq!(nowhere.kind, "skipped");
        assert!(nowhere.message.contains("not a git repository"), "{}", nowhere.message);
        // The folder a step is given resolves to the top of its repository.
        let dir = repo("m-top");
        fs::create_dir_all(dir.join("sub")).unwrap();
        assert!(toplevel(&dir.join("sub").to_string_lossy()).is_some_and(|t| Path::new(&t).ends_with(dir.file_name().unwrap())));
        assert_eq!(toplevel(&outside.to_string_lossy()), None);
        assert_eq!(toplevel(&outside.join("missing").to_string_lossy()), None);
        cleanup(&[&inside, &outside, &dir]);
    }

    #[test]
    fn t652_messages_from_git_are_scrubbed() {
        let key = fake_claude_key();
        let s = scrub(&format!("remote: https://user:pw@host/x failed with {key}"));
        assert!(!s.contains("user:pw") && !s.contains(&key), "{s}");
        let done = finish(Err(format!("fatal: could not read https://user:pw@host/x {key}")));
        assert_eq!(done.kind, "failed");
        assert!(!done.message.contains("user:pw") && !done.message.contains(&key), "{}", done.message);
    }

    #[test]
    fn t652_a_command_that_outlives_its_limit_is_stopped() {
        let mut cmd = if cfg!(windows) { Command::new("ping") } else { Command::new("sleep") };
        if cfg!(windows) {
            cmd.args(["-n", "8", "127.0.0.1"]);
        } else {
            cmd.arg("8");
        }
        let started = Instant::now();
        let e = run_limited(cmd, Duration::from_millis(500)).unwrap_err();
        assert!(e.starts_with("git did not finish"), "{e}");
        assert!(started.elapsed() < Duration::from_secs(6), "stopped at the limit, not at the end of the command");
        let (ok, out) = run_limited(command(&["--version"], None), Duration::from_secs(30)).unwrap();
        assert!(ok && out.starts_with("git version"), "{out}");
    }
}
