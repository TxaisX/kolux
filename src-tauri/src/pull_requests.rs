//! T-232-c (GIT-051): what the full pull request page reads and writes through gh: the page itself
//! (description, reviewers and their review states, reactions), its files, its checks, its review
//! threads, and the writes (close or reopen, rerun checks, reviewers, assignees, a reaction, a reply,
//! the merge). Every call is `gh api` against a plain host (the same gate as github.rs); request
//! bodies go to gh on standard input, never on its command line. Merging is an outward action: it is
//! refused unless the caller says the user confirmed it.

use crate::github::{full_name_ok, gh_json, host_allowed, login_ok, repo_path, s, COMMENT_MAX};
use crate::scm::{gh_program, gh_run, gh_words};
use serde_json::{json, Value};
use std::path::Path;

/// GitHub's limit on reviewers requested at once (people.ts keeps the same number).
const MAX_REVIEWERS: usize = 15;
/// GIT-039 (T-176-d): a file's diff over this many lines is held back (the editor's diff view asks at the
/// same numbers: src/editor/bigDiff.ts), and so is one over BIG_CHARS characters.
pub const BIG_LINES: usize = 20_000;
pub const BIG_CHARS: usize = 2 * 1024 * 1024;
/// GIT-039: the most diff text one files read sends to the window; files past it wait to be loaded
/// (smaller files first, so the budget keeps as many files as it can).
pub const DIFF_BUDGET: usize = 8 * 1024 * 1024;
/// GIT-039: the most one asked-for file diff sends; beyond it the diff ends with a note.
const LOAD_MAX: usize = 8 * 1024 * 1024;
/// One page of files, checks or comments (GitHub's largest page).
const PER_PAGE: usize = 100;
/// Files, reviews and review comments are read this many pages deep (500 each); past that the page
/// says it shows the first 500 (FIX-1, review FIX-SOON 2).
const PAGE_CAP: usize = 5;
/// What one list read can hold; sent with every answer so the page never keeps its own copy.
const READ_LIMIT: usize = PAGE_CAP * PER_PAGE;
/// The reactions GitHub accepts.
const REACTIONS: [&str; 8] = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"];

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Label {
    pub name: String,
    pub color: String,
}

/// A requested or past reviewer; `state` is requested, approved, changes_requested, dismissed or commented.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Reviewer {
    pub login: String,
    pub state: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Reaction {
    pub content: String,
    pub count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPage {
    pub number: u64,
    pub title: String,
    pub body: String,
    /// open, closed or merged.
    pub state: String,
    pub draft: bool,
    pub url: String,
    pub author: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    /// T-232-d (GIT-060): the repository the branch lives in (`owner/name`), empty when its fork was deleted;
    /// it differs from the pull request's repository when the branch comes from a fork.
    pub head_repo: String,
    /// GitHub's word for whether it can merge: clean, blocked, behind, dirty, unstable, unknown...
    pub mergeable_state: String,
    pub labels: Vec<Label>,
    pub assignees: Vec<String>,
    pub reviewers: Vec<Reviewer>,
    pub reactions: Vec<Reaction>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    /// More reviews exist than were read (the page says the reviewer states may be stale).
    pub reviews_truncated: bool,
    /// How many reviews are read at most; the page names it when `reviews_truncated`.
    pub reviews_limit: usize,
}

/// A pull request's files; `truncated` when GitHub has more than the page reads.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFiles {
    pub files: Vec<PrFile>,
    pub truncated: bool,
    /// How many files are read at most (the page says "the first N" from this, not its own copy).
    pub limit: usize,
    /// GIT-039: the limits that hold a file's diff back, so the page names them from here.
    pub diff_limits: DiffLimits,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct DiffLimits {
    pub lines: usize,
    pub chars: usize,
    pub budget: usize,
}

pub const DIFF_LIMITS: DiffLimits = DiffLimits { lines: BIG_LINES, chars: BIG_CHARS, budget: DIFF_BUDGET };

/// A pull request's review threads; `truncated` when GitHub has more comments than the page reads.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrThreads {
    pub threads: Vec<PrThread>,
    pub truncated: bool,
    /// How many review comments are read at most.
    pub limit: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub patch: String,
    /// GIT-039: why the diff text was not sent: "lines" or "size" (over the per-file limits) or
    /// "budget" (the files read had used up what one read may send). `patch` is empty then.
    pub held: Option<&'static str>,
    pub patch_lines: usize,
    pub patch_chars: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub id: u64,
    pub name: String,
    /// queued, in_progress or completed.
    pub status: String,
    /// success, failure, neutral, cancelled, skipped, timed_out, action_required or empty while running.
    pub conclusion: String,
    pub url: String,
    /// The workflow run the check belongs to (the number in its address), when it is a workflow job.
    pub run_id: Option<u64>,
}

/// T-235-b (EDIT-030): one step of a check's job; `conclusion` is None while the step has not finished.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckStep {
    pub number: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
}

/// T-235-b: one annotation a check left on a file. `path` is as GitHub sent it; the window decides
/// whether it may be opened.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAnnotation {
    pub path: String,
    pub start_line: u64,
    pub end_line: u64,
    /// notice, warning or failure.
    pub level: String,
    pub title: String,
    pub message: String,
}

/// T-235-b: what the check tab shows besides the check itself.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckDetail {
    pub steps: Vec<CheckStep>,
    pub annotations: Vec<CheckAnnotation>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub at: String,
}

/// One review thread: the comment it started with and the replies, in order.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrThread {
    pub id: u64,
    pub path: String,
    pub line: Option<u64>,
    pub comments: Vec<PrComment>,
}

fn n(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}

fn login(v: &Value) -> String {
    let l = s(&v["login"]);
    if login_ok(&l) {
        l
    } else {
        String::new()
    }
}

/// Reviewers: everyone with a pending request ("requested"), then each past reviewer by their latest
/// review that decided something (approved, changes requested, dismissed), else "commented".
/// The pull request's author is never listed; a bad login is dropped.
pub fn reviewers_of(pull: &Value, reviews: &Value) -> Vec<Reviewer> {
    let author = login(&pull["user"]);
    let mut out: Vec<Reviewer> = Vec::new();
    for r in pull["requested_reviewers"].as_array().into_iter().flatten() {
        let l = login(r);
        if !l.is_empty() && !out.iter().any(|x| x.login == l) {
            out.push(Reviewer { login: l, state: "requested".into() });
        }
    }
    let mut past: Vec<Reviewer> = Vec::new();
    for r in reviews.as_array().into_iter().flatten() {
        let l = login(&r["user"]);
        if l.is_empty() || l == author || out.iter().any(|x| x.login == l) {
            continue;
        }
        let state = match s(&r["state"]).as_str() {
            "APPROVED" => "approved",
            "CHANGES_REQUESTED" => "changes_requested",
            "DISMISSED" => "dismissed",
            _ => "commented",
        };
        match past.iter_mut().find(|x| x.login == l) {
            // A later comment-only review never hides an earlier decision.
            Some(_) if state == "commented" => {}
            Some(x) => x.state = state.into(),
            None => past.push(Reviewer { login: l, state: state.into() }),
        }
    }
    out.extend(past);
    out
}

/// The page from GitHub's pull request, its reviews and its issue record (which carries the reactions).
pub fn page_of(pull: &Value, reviews: &Value, issue: &Value) -> Result<PrPage, String> {
    let number = n(&pull["number"]);
    if number == 0 {
        return Err("GitHub did not describe this pull request; refresh and try again.".into());
    }
    let state = if pull["merged"].as_bool() == Some(true) || !pull["merged_at"].is_null() { "merged".to_string() } else { s(&pull["state"]) };
    let labels = pull["labels"].as_array().into_iter().flatten().map(|l| Label { name: s(&l["name"]), color: s(&l["color"]) }).filter(|l| !l.name.is_empty()).collect();
    let assignees = pull["assignees"].as_array().into_iter().flatten().map(login).filter(|l| !l.is_empty()).collect();
    let reactions = REACTIONS
        .iter()
        .filter_map(|c| {
            let count = n(&issue["reactions"][*c]);
            (count > 0).then(|| Reaction { content: (*c).to_string(), count })
        })
        .collect();
    Ok(PrPage {
        number,
        title: s(&pull["title"]),
        body: s(&pull["body"]),
        state,
        draft: pull["draft"].as_bool() == Some(true),
        url: s(&pull["html_url"]),
        author: login(&pull["user"]),
        head_ref: s(&pull["head"]["ref"]),
        head_sha: s(&pull["head"]["sha"]),
        base_ref: s(&pull["base"]["ref"]),
        head_repo: s(&pull["head"]["repo"]["full_name"]),
        mergeable_state: s(&pull["mergeable_state"]),
        labels,
        assignees,
        reviewers: reviewers_of(pull, reviews),
        reactions,
        additions: n(&pull["additions"]),
        deletions: n(&pull["deletions"]),
        changed_files: n(&pull["changed_files"]),
        reviews_truncated: false,
        reviews_limit: READ_LIMIT,
    })
}

/// GIT-039: the files with their diff text, except the ones held back: over BIG_LINES lines or
/// BIG_CHARS characters, or past DIFF_BUDGET in all (the smallest files are kept first). A held file
/// keeps its size so the page can say how big it is.
pub fn files_of(v: &Value) -> Vec<PrFile> {
    let mut files: Vec<PrFile> = v
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            let patch = s(&f["patch"]);
            PrFile {
                filename: s(&f["filename"]),
                status: s(&f["status"]),
                additions: n(&f["additions"]),
                deletions: n(&f["deletions"]),
                patch_lines: patch.lines().count(),
                patch_chars: patch.chars().count(),
                held: None,
                patch,
            }
        })
        .filter(|f| !f.filename.is_empty())
        .collect();
    let mut order: Vec<usize> = (0..files.len()).collect();
    order.sort_by_key(|&i| files[i].patch_chars);
    let mut used = 0usize;
    for i in order {
        let f = &mut files[i];
        f.held = if f.patch_lines > BIG_LINES {
            Some("lines")
        } else if f.patch_chars > BIG_CHARS {
            Some("size")
        } else if used + f.patch_chars > DIFF_BUDGET {
            Some("budget")
        } else {
            None
        };
        if f.held.is_some() {
            f.patch = String::new();
        } else {
            used += f.patch_chars;
        }
    }
    files
}

/// GIT-039: one file's diff text on request, whatever held it back, cut at LOAD_MAX characters with a note.
pub fn patch_of(v: &Value, filename: &str) -> Option<String> {
    let text = s(&v.as_array()?.iter().find(|f| s(&f["filename"]) == filename)?["patch"]);
    if text.chars().count() <= LOAD_MAX {
        return Some(text);
    }
    let kept: String = text.chars().take(LOAD_MAX).collect();
    let cut = kept.rfind('\n').map_or(kept.len(), |e| e + 1);
    let left = text[cut..].lines().count();
    Some(format!("{}[{} more lines of this file left out]\n", &kept[..cut], left))
}

/// The workflow run in a check's address (`.../actions/runs/<run>/job/<job>`).
pub fn run_id_of(url: &str) -> Option<u64> {
    let rest = url.split("/actions/runs/").nth(1)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|n| *n > 0)
}

pub fn checks_of(v: &Value) -> Vec<PrCheck> {
    v["check_runs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            let url = s(&c["html_url"]);
            PrCheck { id: n(&c["id"]), name: s(&c["name"]), status: s(&c["status"]), conclusion: s(&c["conclusion"]), run_id: run_id_of(&url), url }
        })
        .filter(|c| !c.name.is_empty())
        .collect()
}

/// T-235-b: the steps of a job record (`GET /repos/{o}/{r}/actions/jobs/{id}`); a record without a
/// number or a name is skipped.
pub fn steps_of(v: &Value) -> Vec<CheckStep> {
    v["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let (number, name) = (n(&c["number"]), s(&c["name"]));
            let conclusion = Some(s(&c["conclusion"])).filter(|x| !x.is_empty());
            (number > 0 && !name.is_empty()).then(|| CheckStep { number, name, status: s(&c["status"]), conclusion })
        })
        .collect()
}

/// T-235-b: the annotations of a check run (`GET /repos/{o}/{r}/check-runs/{id}/annotations`, an
/// array); a record without a path or a message is skipped. A path that leaves the worktree is kept.
pub fn annotations_of(v: &Value) -> Vec<CheckAnnotation> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let (path, message) = (s(&c["path"]), s(&c["message"]));
            let start = n(&c["start_line"]);
            let end = Some(n(&c["end_line"])).filter(|e| *e >= start).unwrap_or(start);
            (!path.is_empty() && !message.is_empty()).then(|| CheckAnnotation { path, start_line: start, end_line: end, level: s(&c["annotation_level"]), title: s(&c["title"]), message })
        })
        .collect()
}

/// Review comments grouped into threads: a comment that replies to another joins that comment's thread.
pub fn threads_of(v: &Value) -> Vec<PrThread> {
    let mut threads: Vec<PrThread> = Vec::new();
    for c in v.as_array().into_iter().flatten() {
        let id = n(&c["id"]);
        let comment = PrComment { id, author: login(&c["user"]), body: s(&c["body"]), at: s(&c["created_at"]) };
        let parent = n(&c["in_reply_to_id"]);
        if parent != 0 {
            if let Some(t) = threads.iter_mut().find(|t| t.comments.iter().any(|x| x.id == parent)) {
                t.comments.push(comment);
                continue;
            }
        }
        threads.push(PrThread { id, path: s(&c["path"]), line: c["line"].as_u64().or_else(|| c["original_line"].as_u64()), comments: vec![comment] });
    }
    threads
}

fn issue_path(host: &str, repo: &str, number: u64, tail: &str) -> Result<String, String> {
    if number == 0 {
        return Err("A pull request number is more than zero.".into());
    }
    Ok(format!("{}/{tail}", repo_path(host, repo)?))
}

fn pull_path(host: &str, repo: &str, number: u64, tail: &str) -> Result<String, String> {
    if number == 0 {
        return Err("A pull request number is more than zero.".into());
    }
    let base = format!("{}/pulls/{number}", repo_path(host, repo)?);
    Ok(if tail.is_empty() { base } else { format!("{base}/{tail}") })
}

/// A list endpoint read page by page, at most PAGE_CAP pages of PER_PAGE: everything it has, and
/// whether it has more (one more page is asked for only when the last allowed page was full).
fn read_all(gh: &Path, host: &str, path: &str) -> Result<(Value, bool), String> {
    let mut all: Vec<Value> = Vec::new();
    for page in 1..=PAGE_CAP + 1 {
        let got = gh_json(gh, host, &format!("{path}?per_page={PER_PAGE}&page={page}"), &[])?;
        let items = got.as_array().cloned().unwrap_or_default();
        if page > PAGE_CAP {
            return Ok((Value::Array(all), !items.is_empty()));
        }
        let full = items.len() >= PER_PAGE;
        all.extend(items);
        if !full {
            break;
        }
    }
    Ok((Value::Array(all), false))
}

pub fn read_page(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrPage, String> {
    let pull = gh_json(gh, host, &pull_path(host, repo, number, "")?, &[])?;
    let (reviews, more) = read_all(gh, host, &pull_path(host, repo, number, "reviews")?)?;
    let issue = gh_json(gh, host, &issue_path(host, repo, number, &format!("issues/{number}"))?, &[])?;
    let mut page = page_of(&pull, &reviews, &issue)?;
    page.reviews_truncated = more;
    Ok(page)
}

pub fn read_files(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrFiles, String> {
    let (all, truncated) = read_all(gh, host, &pull_path(host, repo, number, "files")?)?;
    Ok(PrFiles { files: files_of(&all), truncated, limit: READ_LIMIT, diff_limits: DIFF_LIMITS })
}

/// GIT-039: the diff text of one file the page held back, asked for by the user.
pub fn read_file_patch(gh: &Path, host: &str, repo: &str, number: u64, filename: &str) -> Result<String, String> {
    let (all, _) = read_all(gh, host, &pull_path(host, repo, number, "files")?)?;
    patch_of(&all, filename).ok_or_else(|| format!("{filename} is not among the first {READ_LIMIT} files of this pull request"))
}

/// A commit id as GitHub prints it: 7 to 64 hex digits.
fn sha_ok(sha: &str) -> bool {
    sha.len() >= 7 && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn read_checks(gh: &Path, host: &str, repo: &str, sha: &str) -> Result<Vec<PrCheck>, String> {
    if !sha_ok(sha) {
        return Err("This pull request's latest commit cannot be read.".into());
    }
    Ok(checks_of(&gh_json(gh, host, &format!("{}/commits/{sha}/check-runs?per_page={PER_PAGE}", repo_path(host, repo)?), &[])?))
}

/// T-235-b: a check's steps (from its job, when the link names one) and annotations. A check
/// run's id is its job's number for a workflow job.
pub fn read_check_detail(gh: &Path, host: &str, repo: &str, check_id: u64, job_id: Option<u64>) -> Result<CheckDetail, String> {
    if check_id == 0 || job_id == Some(0) {
        return Err("This check cannot be read.".into());
    }
    let base = repo_path(host, repo)?;
    let steps = match job_id {
        Some(job) => steps_of(&gh_json(gh, host, &format!("{base}/actions/jobs/{job}"), &[])?),
        None => Vec::new(),
    };
    // Every page up to the cap, like the other lists; a run with more annotations than that shows the first ones.
    let (listed, _) = read_all(gh, host, &format!("{base}/check-runs/{check_id}/annotations"))?;
    let annotations = annotations_of(&listed);
    Ok(CheckDetail { steps, annotations })
}

pub fn read_threads(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrThreads, String> {
    let (all, truncated) = read_all(gh, host, &pull_path(host, repo, number, "comments")?)?;
    Ok(PrThreads { threads: threads_of(&all), truncated, limit: READ_LIMIT })
}

// ---- T-232-d: viewed marks, recent editors ------------------------------------------------------

/// GIT-052: one file's viewed mark as GitHub keeps it: `viewed`, `unviewed`, or `dismissed` (it was
/// viewed, then changed by a later commit).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ViewedFile {
    pub path: String,
    pub state: String,
}

/// The viewed marks of a pull request's files; `truncated` when it has more files than were read.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrViewed {
    pub files: Vec<ViewedFile>,
    pub truncated: bool,
    pub limit: usize,
}

/// GitHub's GraphQL reference: PullRequestChangedFile.viewerViewedState (docs.github.com/en/graphql/reference/objects).
const VIEWED_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){files(first:100,after:$after){nodes{path viewerViewedState}pageInfo{hasNextPage endCursor}}}}}";
/// docs.github.com/en/graphql/reference/mutations: markFileAsViewed and unmarkFileAsViewed.
const MARK_VIEWED: &str = "mutation($id:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$id,path:$path}){clientMutationId}}";
const UNMARK_VIEWED: &str = "mutation($id:ID!,$path:String!){unmarkFileAsViewed(input:{pullRequestId:$id,path:$path}){clientMutationId}}";

/// One GraphQL call: the query and its variables go to gh on standard input (`gh api graphql --input -`),
/// never on the command line. GraphQL answers 200 with an `errors` list on failure; the first message is the error.
fn graphql(gh: &Path, host: &str, query: &str, variables: Value) -> Result<Value, String> {
    host_allowed(gh, host)?;
    let input = json!({ "query": query, "variables": variables }).to_string();
    let args = ["api", "graphql", "--hostname", host, "--input", "-"];
    let text = gh_run(gh, &std::env::temp_dir(), &args, Some(&input)).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    if let Some(first) = v["errors"].as_array().and_then(|e| e.first()) {
        let msg = s(&first["message"]);
        return Err(format!("{host}: {}", if msg.is_empty() { "GitHub refused the request".to_string() } else { msg }));
    }
    Ok(v)
}

fn viewed_state(raw: &str) -> Option<&'static str> {
    match raw {
        "VIEWED" => Some("viewed"),
        "UNVIEWED" => Some("unviewed"),
        "DISMISSED" => Some("dismissed"),
        _ => None,
    }
}

/// The files of one GraphQL page with their viewed marks, whether another page follows and its cursor.
pub fn viewed_page(v: &Value) -> (Vec<ViewedFile>, bool, Option<String>) {
    let files = &v["data"]["repository"]["pullRequest"]["files"];
    let list = files["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| {
            let path = n["path"].as_str().filter(|p| !p.is_empty())?;
            Some(ViewedFile { path: path.to_string(), state: viewed_state(n["viewerViewedState"].as_str().unwrap_or(""))?.to_string() })
        })
        .collect();
    let more = files["pageInfo"]["hasNextPage"].as_bool() == Some(true);
    (list, more, files["pageInfo"]["endCursor"].as_str().map(String::from))
}

fn split_repo(repo: &str) -> Result<(&str, &str), String> {
    if !full_name_ok(repo) {
        return Err("This repository's name cannot be read".into());
    }
    repo.split_once('/').ok_or_else(|| "This repository's name cannot be read".to_string())
}

/// GIT-052: which of the pull request's files the signed-in person marked viewed on GitHub (read
/// PAGE_CAP pages deep, the same 500 files the Files tab reads).
pub fn read_viewed(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrViewed, String> {
    if number == 0 {
        return Err("A pull request number is more than zero.".into());
    }
    let (owner, name) = split_repo(repo)?;
    let mut files = Vec::new();
    let mut after: Option<String> = None;
    for page in 1..=PAGE_CAP {
        let v = graphql(gh, host, VIEWED_QUERY, json!({ "owner": owner, "name": name, "number": number, "after": after }))?;
        if v["data"]["repository"]["pullRequest"].is_null() {
            return Err("GitHub did not find this pull request.".into());
        }
        let (got, more, cursor) = viewed_page(&v);
        files.extend(got);
        match (more, cursor) {
            (true, Some(c)) if page < PAGE_CAP => after = Some(c),
            (more, _) => return Ok(PrViewed { files, truncated: more, limit: READ_LIMIT }),
        }
    }
    Ok(PrViewed { files, truncated: false, limit: READ_LIMIT })
}

/// GIT-052: mark one file viewed (or clear the mark) on GitHub. The mutation needs the pull request's
/// node id, which the REST record carries. Returns the state it set.
pub fn set_viewed(gh: &Path, host: &str, repo: &str, number: u64, path: &str, viewed: bool) -> Result<String, String> {
    if path.is_empty() || path.len() > 4096 || path.contains(['\0', '\n', '\r']) {
        return Err("That file name cannot be marked.".into());
    }
    let pull = gh_json(gh, host, &pull_path(host, repo, number, "")?, &[])?;
    let id = pull["node_id"].as_str().filter(|i| !i.is_empty() && i.len() <= 128).ok_or("GitHub did not describe this pull request; refresh and try again.")?;
    graphql(gh, host, if viewed { MARK_VIEWED } else { UNMARK_VIEWED }, json!({ "id": id, "path": path }))?;
    Ok((if viewed { "viewed" } else { "unviewed" }).to_string())
}

/// GIT-053: how many of the pull request's files, and how many commits of each, are read to find who
/// recently edited them.
const EDITOR_FILES: usize = 8;
const EDITOR_COMMITS: usize = 10;

/// GIT-053: the people who recently committed to the given files' histories (`commits` is one commit
/// list per file), most commits first, each once; bots and names GitHub would not accept as logins are left out.
pub fn editors_of(commits: &[Value]) -> Vec<String> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for list in commits {
        for c in list.as_array().into_iter().flatten() {
            let a = &c["author"];
            let Some(login) = a["login"].as_str().filter(|l| login_ok(l)) else { continue };
            if a["type"].as_str() == Some("Bot") || login.ends_with("[bot]") {
                continue;
            }
            match counts.iter_mut().find(|(l, _)| l.eq_ignore_ascii_case(login)) {
                Some((_, n)) => *n += 1,
                None => counts.push((login.to_string(), 1)),
            }
        }
    }
    counts.sort_by_key(|c| std::cmp::Reverse(c.1));
    counts.into_iter().map(|(l, _)| l).collect()
}

/// GIT-053: recent editors of a pull request's first files (the default branch's history of each).
pub fn read_editors(gh: &Path, host: &str, repo: &str, number: u64) -> Result<Vec<String>, String> {
    let listed = gh_json(gh, host, &pull_path(host, repo, number, "files")?, &["-X", "GET", "-f", &format!("per_page={EDITOR_FILES}")])?;
    let base = format!("{}/commits", repo_path(host, repo)?);
    let per = format!("per_page={EDITOR_COMMITS}");
    let mut lists = Vec::new();
    for f in listed.as_array().into_iter().flatten().take(EDITOR_FILES) {
        let name = s(&f["filename"]);
        if name.is_empty() {
            continue;
        }
        lists.push(gh_json(gh, host, &base, &["-X", "GET", "-f", &format!("path={name}"), "-f", &per])?);
    }
    Ok(editors_of(&lists))
}

/// One write: `method` on `path`, the JSON body (when there is one) on standard input.
fn write(gh: &Path, host: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    host_allowed(gh, host)?;
    let input = body.map(|b| b.to_string());
    let mut args = vec!["api", "-X", method, path, "--hostname", host];
    if input.is_some() {
        args.extend(["--input", "-"]);
    }
    let text = gh_run(gh, &std::env::temp_dir(), &args, input.as_deref()).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// Close or reopen a pull request.
pub fn set_state(gh: &Path, host: &str, repo: &str, number: u64, open: bool) -> Result<String, String> {
    let path = pull_path(host, repo, number, "")?;
    let v = write(gh, host, "PATCH", &path, Some(json!({ "state": if open { "open" } else { "closed" } })))?;
    Ok(if v["state"].is_string() { s(&v["state"]) } else { (if open { "open" } else { "closed" }).to_string() })
}

/// Rerun every job of a workflow run, or only its failed jobs.
pub fn rerun(gh: &Path, host: &str, repo: &str, run_id: u64, failed_only: bool) -> Result<(), String> {
    if run_id == 0 {
        return Err("This check has no workflow run to rerun.".into());
    }
    let path = format!("{}/actions/runs/{run_id}/{}", repo_path(host, repo)?, if failed_only { "rerun-failed-jobs" } else { "rerun" });
    write(gh, host, "POST", &path, None).map(|_| ())
}

fn logins_ok(list: &[String]) -> Result<(), String> {
    match list.iter().find(|l| !login_ok(l)) {
        Some(bad) => Err(format!("{bad} is not a GitHub login.")),
        None => Ok(()),
    }
}

/// Ask people for a review, or take a request back. More than fifteen asked at once is refused here
/// too (GitHub's limit); the page checks the total against the requests already there.
pub fn reviewers(gh: &Path, host: &str, repo: &str, number: u64, add: &[String], remove: &[String]) -> Result<(), String> {
    logins_ok(add)?;
    logins_ok(remove)?;
    if add.len() > MAX_REVIEWERS {
        return Err(format!("A pull request can have at most {MAX_REVIEWERS} reviewers."));
    }
    let path = pull_path(host, repo, number, "requested_reviewers")?;
    if !remove.is_empty() {
        write(gh, host, "DELETE", &path, Some(json!({ "reviewers": remove })))?;
    }
    if !add.is_empty() {
        write(gh, host, "POST", &path, Some(json!({ "reviewers": add })))?;
    }
    Ok(())
}

/// Add or remove assignees on an issue or a pull request (GitHub keeps both under issues).
pub fn assignees(gh: &Path, host: &str, repo: &str, number: u64, add: &[String], remove: &[String]) -> Result<(), String> {
    logins_ok(add)?;
    logins_ok(remove)?;
    let path = issue_path(host, repo, number, &format!("issues/{number}/assignees"))?;
    if !remove.is_empty() {
        write(gh, host, "DELETE", &path, Some(json!({ "assignees": remove })))?;
    }
    if !add.is_empty() {
        write(gh, host, "POST", &path, Some(json!({ "assignees": add })))?;
    }
    Ok(())
}

pub fn react(gh: &Path, host: &str, repo: &str, number: u64, content: &str) -> Result<(), String> {
    if !REACTIONS.contains(&content) {
        return Err(format!("GitHub has no reaction called {content}."));
    }
    let path = issue_path(host, repo, number, &format!("issues/{number}/reactions"))?;
    write(gh, host, "POST", &path, Some(json!({ "content": content }))).map(|_| ())
}

pub fn reply(gh: &Path, host: &str, repo: &str, number: u64, comment: u64, body: &str) -> Result<(), String> {
    if comment == 0 {
        return Err("Pick the comment to reply to.".into());
    }
    if body.trim().is_empty() {
        return Err("Write a reply first.".into());
    }
    if body.chars().count() > COMMENT_MAX {
        return Err(format!("A reply can be at most {COMMENT_MAX} characters."));
    }
    let path = pull_path(host, repo, number, &format!("comments/{comment}/replies"))?;
    write(gh, host, "POST", &path, Some(json!({ "body": body }))).map(|_| ())
}

/// Merge a pull request. Outward: nothing is sent unless `confirmed` (the page asks first), and the
/// merge is pinned to `sha`, the head commit the page showed: GitHub refuses (409) when someone has
/// pushed since, so commits the user never saw are never merged.
pub fn merge(gh: &Path, host: &str, repo: &str, number: u64, method: &str, confirmed: bool, sha: &str) -> Result<String, String> {
    if !confirmed {
        return Err("Merging changes the repository on GitHub; confirm it first.".into());
    }
    if !["merge", "squash", "rebase"].contains(&method) {
        return Err(format!("{method} is not a way to merge; use merge, squash or rebase."));
    }
    if !sha_ok(sha) {
        return Err("This pull request's latest commit cannot be read. Reload it before merging.".into());
    }
    let path = pull_path(host, repo, number, "merge")?;
    let v = write(gh, host, "PUT", &path, Some(json!({ "merge_method": method, "sha": sha }))).map_err(|e| {
        if e.contains("HTTP 409") || e.contains("Head branch was modified") {
            "The pull request changed. Reload it before merging.".to_string()
        } else {
            e
        }
    })?;
    if v["merged"].as_bool() == Some(false) {
        return Err(if s(&v["message"]).is_empty() { "GitHub did not merge it.".into() } else { s(&v["message"]) });
    }
    Ok(s(&v["sha"]))
}

/// The merge, only for a repository added in Kolux (stand-in review FIX-BEFORE 3): `added` is one
/// `git config --get-regexp` text per added project plus the user's SSH config text, and
/// `host/owner/name` must be a GitHub remote of one of them (an SSH alias counts as the host it
/// stands for, as on the page). The page already hides Merge for other repositories; this keeps the
/// rule when the command is called any other way. Nothing reaches gh when it is refused.
pub fn merge_in_added(gh: &Path, added: (&[String], &str), (host, repo): (&str, &str), number: u64, method: &str, confirmed: bool, sha: &str) -> Result<String, String> {
    let (remotes, ssh_config) = added;
    let is_added = repo.split_once('/').is_some_and(|(owner, name)| remotes.iter().any(|r| crate::pr_checkout::has_repo_with(r, host, owner, name, ssh_config)));
    if !is_added {
        return Err("Add this repository in Kolux to merge from here.".into());
    }
    merge(gh, host, repo, number, method, confirmed, sha)
}

/// The folders of the projects added in Kolux. The store lock is held only to read that list.
pub fn added_paths(store: &std::sync::Mutex<crate::state::Store>) -> Result<Vec<String>, String> {
    Ok(crate::projects::load_projects(&*store.lock().map_err(|e| e.to_string())?).into_iter().map(|p| p.path).collect())
}

/// `merge_in_added` over the added projects' folders: their remotes are read from git here, outside
/// any lock.
pub fn merge_in_paths(gh: &Path, (paths, ssh_config): (&[String], &str), target: (&str, &str), number: u64, method: &str, confirmed: bool, sha: &str) -> Result<String, String> {
    let remotes: Vec<String> = paths.iter().map(|p| crate::pr_checkout::remotes(Path::new(p))).collect();
    merge_in_added(gh, (&remotes, ssh_config), target, number, method, confirmed, sha)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce(&Path) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&gh_program()?)).await.map_err(|e| e.to_string())?
}

fn repo_ok(repo: &str) -> Result<(), String> {
    if full_name_ok(repo) {
        Ok(())
    } else {
        Err("This repository's name cannot be read".into())
    }
}

#[tauri::command]
pub async fn pr_page(host: String, repo: String, number: u64) -> Result<PrPage, String> {
    blocking(move |gh| read_page(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_files(host: String, repo: String, number: u64) -> Result<PrFiles, String> {
    blocking(move |gh| read_files(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_file_patch(host: String, repo: String, number: u64, filename: String) -> Result<String, String> {
    blocking(move |gh| read_file_patch(gh, &host, &repo, number, &filename)).await
}

#[tauri::command]
pub async fn pr_checks(host: String, repo: String, sha: String) -> Result<Vec<PrCheck>, String> {
    blocking(move |gh| read_checks(gh, &host, &repo, &sha)).await
}

#[tauri::command]
pub async fn pr_threads(host: String, repo: String, number: u64) -> Result<PrThreads, String> {
    blocking(move |gh| read_threads(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_viewed(host: String, repo: String, number: u64) -> Result<PrViewed, String> {
    blocking(move |gh| read_viewed(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_set_viewed(host: String, repo: String, number: u64, path: String, viewed: bool) -> Result<String, String> {
    repo_ok(&repo)?;
    blocking(move |gh| set_viewed(gh, &host, &repo, number, &path, viewed)).await
}

#[tauri::command]
pub async fn pr_editors(host: String, repo: String, number: u64) -> Result<Vec<String>, String> {
    blocking(move |gh| read_editors(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_set_state(host: String, repo: String, number: u64, open: bool) -> Result<String, String> {
    blocking(move |gh| set_state(gh, &host, &repo, number, open)).await
}

#[tauri::command]
pub async fn pr_rerun(host: String, repo: String, run_id: u64, failed_only: bool) -> Result<(), String> {
    repo_ok(&repo)?;
    blocking(move |gh| rerun(gh, &host, &repo, run_id, failed_only)).await
}

#[tauri::command]
pub async fn pr_reviewers(host: String, repo: String, number: u64, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    blocking(move |gh| reviewers(gh, &host, &repo, number, &add, &remove)).await
}

#[tauri::command]
pub async fn pr_assignees(host: String, repo: String, number: u64, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    blocking(move |gh| assignees(gh, &host, &repo, number, &add, &remove)).await
}

#[tauri::command]
pub async fn pr_react(host: String, repo: String, number: u64, content: String) -> Result<(), String> {
    blocking(move |gh| react(gh, &host, &repo, number, &content)).await
}

#[tauri::command]
pub async fn pr_reply(host: String, repo: String, number: u64, comment: u64, body: String) -> Result<(), String> {
    blocking(move |gh| reply(gh, &host, &repo, number, comment, &body)).await
}

#[tauri::command]
pub async fn pr_merge(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, host: String, repo: String, number: u64, method: String, confirmed: bool, sha: String) -> Result<String, String> {
    let paths = added_paths(&store)?;
    blocking(move |gh| merge_in_paths(gh, (&paths, &crate::scm::ssh_config()), (&host, &repo), number, &method, confirmed, &sha)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A stand-in gh: keeps every call's arguments and request body; call n answers with answer<n>.json
    /// when there is one, else answer.json. Never Txais's real GitHub.
    fn stand_in(name: &str, answer: &Value) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        fs::write(dir.join("answer.json"), answer.to_string()).unwrap();
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nmore >>\"%~dp0body.txt\"\r\nset /a n=0\r\nif exist \"%~dp0n.txt\" set /p n=<\"%~dp0n.txt\"\r\nset /a n+=1\r\n>\"%~dp0n.txt\" echo %n%\r\nif exist \"%~dp0answer%n%.json\" (type \"%~dp0answer%n%.json\") else (type \"%~dp0answer.json\")\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncat >> \"$d/body.txt\"\necho >> \"$d/body.txt\"\nn=$(( $(cat \"$d/n.txt\" 2>/dev/null || echo 0) + 1 ))\necho $n > \"$d/n.txt\"\nif [ -f \"$d/answer$n.json\" ]; then cat \"$d/answer$n.json\"; else cat \"$d/answer.json\"; fi\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        (gh, dir)
    }

    fn calls(dir: &std::path::Path) -> String {
        fs::read_to_string(dir.join("calls.txt")).unwrap_or_default()
    }

    fn body(dir: &std::path::Path) -> Value {
        serde_json::from_str(fs::read_to_string(dir.join("body.txt")).unwrap().trim()).unwrap()
    }

    fn pull() -> Value {
        json!({
            "number": 7, "title": "Fix login", "body": "Closes #3", "state": "open", "merged": false, "merged_at": null, "draft": true,
            "html_url": "https://github.com/acme/app/pull/7", "user": { "login": "ana" }, "mergeable_state": "blocked",
            "head": { "ref": "fix-login", "sha": "abc1234" }, "base": { "ref": "main" },
            "labels": [{ "name": "bug", "color": "d73a4a" }, { "name": "" }],
            "assignees": [{ "login": "bo" }, { "login": "bad login" }],
            "requested_reviewers": [{ "login": "cy" }],
            "additions": 10, "deletions": 2, "changed_files": 3
        })
    }

    #[test]
    fn the_page_reads_state_reviewers_reactions_and_drops_bad_logins() {
        let reviews = json!([
            { "user": { "login": "dee" }, "state": "CHANGES_REQUESTED" },
            { "user": { "login": "dee" }, "state": "COMMENTED" },
            { "user": { "login": "eve" }, "state": "APPROVED" },
            { "user": { "login": "eve" }, "state": "DISMISSED" },
            { "user": { "login": "cy" }, "state": "APPROVED" },
            { "user": { "login": "ana" }, "state": "COMMENTED" },
            { "user": { "login": "fay" }, "state": "COMMENTED" }
        ]);
        let issue = json!({ "reactions": { "+1": 2, "heart": 0, "rocket": 1 } });
        let p = page_of(&pull(), &reviews, &issue).unwrap();
        assert_eq!((p.number, p.state.as_str(), p.draft, p.author.as_str()), (7, "open", true, "ana"));
        assert_eq!((p.head_ref.as_str(), p.head_sha.as_str(), p.base_ref.as_str(), p.mergeable_state.as_str()), ("fix-login", "abc1234", "main", "blocked"));
        assert_eq!(p.labels, vec![Label { name: "bug".into(), color: "d73a4a".into() }]);
        assert_eq!(p.assignees, vec!["bo".to_string()]);
        let who: Vec<(&str, &str)> = p.reviewers.iter().map(|r| (r.login.as_str(), r.state.as_str())).collect();
        // a pending request wins over the same person's past review; a later comment keeps an earlier decision; the author is not a reviewer
        assert_eq!(who, vec![("cy", "requested"), ("dee", "changes_requested"), ("eve", "dismissed"), ("fay", "commented")]);
        assert_eq!(p.reactions, vec![Reaction { content: "+1".into(), count: 2 }, Reaction { content: "rocket".into(), count: 1 }]);
        assert_eq!((p.additions, p.deletions, p.changed_files), (10, 2, 3));
        let mut merged = pull();
        merged["merged"] = json!(true);
        merged["state"] = json!("closed");
        assert_eq!(page_of(&merged, &json!([]), &json!({})).unwrap().state, "merged");
        assert!(page_of(&json!({}), &json!([]), &json!({})).is_err());
    }

    #[test]
    fn big_diffs_are_held_back_with_their_size_and_a_budget_caps_what_is_sent() {
        let lines = "+a\n".repeat(BIG_LINES + 1);
        let size = "x".repeat(BIG_CHARS + 1);
        let held = files_of(&json!([
            { "filename": "lines.txt", "patch": lines },
            { "filename": "size.txt", "patch": size },
            { "filename": "ok.txt", "patch": "+a\n" }
        ]));
        assert_eq!(held[0].held, Some("lines"));
        assert_eq!((held[0].patch.as_str(), held[0].patch_lines, held[0].patch_chars), ("", BIG_LINES + 1, 3 * (BIG_LINES + 1)));
        assert_eq!(held[1].held, Some("size"));
        assert_eq!(held[1].patch_chars, BIG_CHARS + 1);
        assert_eq!(held[2].held, None);
        // the limit itself is allowed
        let edge = files_of(&json!([{ "filename": "e", "patch": "+\n".repeat(BIG_LINES) }]));
        assert_eq!(edge[0].held, None);

        // 5 files of 1.9 MB: the budget (8 MB) keeps four, the fifth waits; the smallest are kept first
        let chunk = "y".repeat(BIG_CHARS - 150_000);
        let many = files_of(&json!([
            { "filename": "a", "patch": chunk }, { "filename": "b", "patch": chunk }, { "filename": "c", "patch": chunk },
            { "filename": "d", "patch": chunk }, { "filename": "e", "patch": chunk }, { "filename": "tiny", "patch": "+z\n" }
        ]));
        let sent: usize = many.iter().map(|f| f.patch.chars().count()).sum();
        assert!(sent <= DIFF_BUDGET, "sent {sent}");
        assert_eq!(many.iter().filter(|f| f.held == Some("budget")).count(), 1);
        assert_eq!(many[5].held, None);
        assert_eq!(many[4].held, Some("budget"));
        assert!(many[4].patch.is_empty() && many[4].patch_chars == chunk.len());
        assert_eq!(DIFF_LIMITS, DiffLimits { lines: 20_000, chars: 2 * 1024 * 1024, budget: 8 * 1024 * 1024 });
    }

    #[test]
    fn a_held_diff_loads_on_request_and_a_huge_one_ends_with_a_note() {
        let v = json!([{ "filename": "a.rs", "patch": "+one\n+two\n" }, { "filename": "b.rs", "patch": "é\n".repeat(LOAD_MAX) }]);
        assert_eq!(patch_of(&v, "a.rs").as_deref(), Some("+one\n+two\n"));
        assert_eq!(patch_of(&v, "nope.rs"), None);
        let big = patch_of(&v, "b.rs").unwrap();
        assert!(big.chars().count() <= LOAD_MAX + 60, "{}", big.chars().count());
        assert!(big.ends_with(" more lines of this file left out]\n"));
        assert!(big.contains("[") && !big.starts_with('['));
    }

    #[test]
    fn files_checks_and_threads_are_read_from_githubs_answers() {
        let files = files_of(&json!([{ "filename": "a.rs", "status": "modified", "additions": 3, "deletions": 1, "patch": "x\ny\n" }, { "status": "added" }]));
        assert_eq!(files.len(), 1);
        assert_eq!((files[0].patch.as_str(), files[0].held, files[0].patch_lines), ("x\ny\n", None, 2));

        assert_eq!(run_id_of("https://github.com/acme/app/actions/runs/123456/job/789"), Some(123456));
        assert_eq!(run_id_of("https://github.com/acme/app/runs/55"), None);
        let checks = checks_of(&json!({ "check_runs": [
            { "id": 1, "name": "build", "status": "completed", "conclusion": "failure", "html_url": "https://github.com/acme/app/actions/runs/42/job/9" },
            { "id": 2, "name": "lint", "status": "in_progress", "conclusion": null, "html_url": "https://ci.example/x" },
            { "id": 3 }
        ] }));
        assert_eq!(checks.len(), 2);
        assert_eq!((checks[0].run_id, checks[0].conclusion.as_str()), (Some(42), "failure"));
        assert_eq!((checks[1].run_id, checks[1].conclusion.as_str()), (None, ""));

        let threads = threads_of(&json!([
            { "id": 10, "path": "a.rs", "line": 4, "body": "why?", "user": { "login": "ana" }, "created_at": "2026-10-01T00:00:00Z" },
            { "id": 11, "path": "b.rs", "line": null, "original_line": 9, "body": "nit", "user": { "login": "bo" }, "created_at": "2026-10-01T00:01:00Z" },
            { "id": 12, "path": "a.rs", "in_reply_to_id": 10, "body": "because", "user": { "login": "bo" }, "created_at": "2026-10-01T00:02:00Z" },
            { "id": 13, "path": "a.rs", "in_reply_to_id": 12, "body": "ok", "user": { "login": "ana" }, "created_at": "2026-10-01T00:03:00Z" }
        ]));
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].comments.iter().map(|c| c.id).collect::<Vec<_>>(), vec![10, 12, 13]);
        assert_eq!((threads[1].path.as_str(), threads[1].line), ("b.rs", Some(9)));
    }

    #[test]
    fn a_checks_steps_and_annotations_are_read_and_bad_records_skipped() {
        // T-235-b (EDIT-030): a job record's steps; a running step has no conclusion yet.
        let steps = steps_of(&json!({ "steps": [
            { "number": 1, "name": "Set up job", "status": "completed", "conclusion": "success" },
            { "number": 2, "name": "Run tests", "status": "in_progress", "conclusion": null },
            { "number": 3, "status": "queued" },
            "junk",
            { "name": "no number", "status": "completed" }
        ] }));
        assert_eq!(steps.len(), 2);
        assert_eq!((steps[0].number, steps[0].name.as_str(), steps[0].conclusion.as_deref()), (1, "Set up job", Some("success")));
        assert_eq!((steps[1].status.as_str(), steps[1].conclusion.as_deref()), ("in_progress", None));
        assert!(steps_of(&json!({ "steps": [] })).is_empty());
        assert!(steps_of(&json!({ "name": "job without steps" })).is_empty());
        assert!(steps_of(&json!(null)).is_empty());

        let notes = annotations_of(&json!([
            { "path": "src/a.rs", "start_line": 4, "end_line": 6, "annotation_level": "failure", "title": "E0308", "message": "mismatched types" },
            { "path": "../../etc/passwd", "start_line": 1, "end_line": 1, "annotation_level": "warning", "message": "climbs out" },
            { "path": "/abs/y.txt", "start_line": 2, "annotation_level": "notice", "message": "absolute" },
            { "start_line": 9, "message": "no path" },
            42
        ]));
        assert_eq!(notes.len(), 3);
        assert_eq!((notes[0].path.as_str(), notes[0].start_line, notes[0].end_line, notes[0].level.as_str()), ("src/a.rs", 4, 6, "failure"));
        assert_eq!((notes[0].title.as_str(), notes[0].message.as_str()), ("E0308", "mismatched types"));
        // the parser keeps a path that leaves the worktree; the window refuses to open it
        assert_eq!(notes[1].path, "../../etc/passwd");
        assert_eq!((notes[2].end_line, notes[2].title.as_str()), (2, ""));
        assert!(annotations_of(&json!({ "message": "not an array" })).is_empty());
    }

    #[test]
    fn a_check_detail_asks_for_the_job_and_the_annotations_and_a_link_without_a_job_gets_annotations_only() {
        let (gh, dir) = stand_in("pr-check-detail", &json!({ "steps": [{ "number": 1, "name": "Build", "status": "completed", "conclusion": "failure" }] }));
        fs::write(dir.join("answer2.json"), json!([{ "path": "a.rs", "start_line": 3, "end_line": 3, "annotation_level": "failure", "message": "boom" }]).to_string()).unwrap();
        let d = read_check_detail(&gh, "github.com", "acme/app", 9, Some(9)).unwrap();
        assert_eq!((d.steps.len(), d.annotations.len()), (1, 1));
        let c = calls(&dir).replace('"', "");
        assert!(c.contains("api repos/acme/app/actions/jobs/9 --hostname github.com"), "{c}");
        assert!(c.contains("api repos/acme/app/check-runs/9/annotations?per_page=100&page=1 --hostname github.com"), "{c}");

        let (gh, dir) = stand_in("pr-check-detail-nojob", &json!([{ "path": "b.rs", "start_line": 1, "end_line": 1, "annotation_level": "notice", "message": "hm" }]));
        let d = read_check_detail(&gh, "github.com", "acme/app", 12, None).unwrap();
        assert!(d.steps.is_empty());
        assert_eq!(d.annotations.len(), 1);
        assert!(!calls(&dir).contains("actions/jobs"), "{}", calls(&dir));
        assert!(read_check_detail(&gh, "github.com", "acme/../app", 12, None).is_err());
        assert!(read_check_detail(&gh, "github.com", "acme/app", 0, None).is_err());
    }

    #[test]
    fn reading_the_page_asks_for_the_pull_its_reviews_and_its_issue_record() {
        let (gh, dir) = stand_in("pr-page-reads", &pull());
        fs::write(dir.join("answer2.json"), "[]").unwrap();
        fs::write(dir.join("answer3.json"), "{\"reactions\":{\"eyes\":1}}").unwrap();
        let p = read_page(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!(p.reactions, vec![Reaction { content: "eyes".into(), count: 1 }]);
        let c = calls(&dir);
        assert!(c.contains("api repos/acme/app/pulls/7 --hostname github.com"), "{c}");
        assert!(c.replace('"', "").contains("api repos/acme/app/pulls/7/reviews?per_page=100&page=1 --hostname github.com"), "{c}");
        assert!(c.contains("api repos/acme/app/issues/7 --hostname github.com"), "{c}");
        assert!(read_page(&gh, "github.com", "acme/../app", 7).is_err());
        assert!(read_page(&gh, "github.com", "acme/app", 0).is_err());
        assert!(read_checks(&gh, "github.com", "acme/app", "not a sha").is_err());
    }

    #[test]
    fn close_reopen_and_rerun_send_the_right_calls_and_refuse_nonsense() {
        let (gh, dir) = stand_in("pr-state-rerun", &json!({ "state": "closed" }));
        assert_eq!(set_state(&gh, "github.com", "acme/app", 7, false).unwrap(), "closed");
        assert!(calls(&dir).contains("api -X PATCH repos/acme/app/pulls/7 --hostname github.com --input -"));
        assert_eq!(body(&dir), json!({ "state": "closed" }));

        let (gh, dir) = stand_in("pr-rerun", &json!({}));
        rerun(&gh, "github.com", "acme/app", 42, true).unwrap();
        rerun(&gh, "github.com", "acme/app", 42, false).unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X POST repos/acme/app/actions/runs/42/rerun-failed-jobs --hostname github.com"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/actions/runs/42/rerun --hostname github.com"), "{c}");
        assert!(!c.contains("--input"), "a rerun has no body: {c}");
        let (gh, dir) = stand_in("pr-rerun-refused", &json!({}));
        assert!(rerun(&gh, "github.com", "acme/app", 0, true).is_err());
        assert!(!dir.join("calls.txt").exists());
    }

    #[test]
    fn reviewers_and_assignees_go_on_stdin_and_bad_logins_send_nothing() {
        let (gh, dir) = stand_in("pr-people", &json!({}));
        reviewers(&gh, "github.com", "acme/app", 7, &["cy".into(), "dee".into()], &["eve".into()]).unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X DELETE repos/acme/app/pulls/7/requested_reviewers --hostname github.com --input -"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/pulls/7/requested_reviewers --hostname github.com --input -"), "{c}");
        assert!(!c.contains("cy"), "logins go on stdin: {c}");
        assign_check(&gh, &dir);

        let (gh, dir) = stand_in("pr-people-refused", &json!({}));
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &["bad login".into()], &[]).is_err());
        let sixteen: Vec<String> = (0..16).map(|i| format!("u{i}")).collect();
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &sixteen, &[]).unwrap_err().contains("15"));
        let fifteen: Vec<String> = (0..15).map(|i| format!("u{i}")).collect();
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &fifteen, &[]).is_ok());
        assert!(assignees(&gh, "github.com", "acme/app", 7, &["a/b".into()], &[]).is_err());
        assert_eq!(calls(&dir).lines().count(), 1, "only the fifteen were sent");
    }

    fn assign_check(gh: &Path, dir: &Path) {
        assignees(gh, "github.com", "acme/app", 9, &["ana".into()], &["bo".into()]).unwrap();
        let c = calls(dir);
        assert!(c.contains("api -X DELETE repos/acme/app/issues/9/assignees --hostname github.com --input -"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/issues/9/assignees --hostname github.com --input -"), "{c}");
    }

    #[test]
    fn a_reaction_and_a_reply_are_checked_before_they_are_sent() {
        let (gh, dir) = stand_in("pr-react-reply", &json!({}));
        react(&gh, "github.com", "acme/app", 7, "+1").unwrap();
        assert!(calls(&dir).contains("api -X POST repos/acme/app/issues/7/reactions --hostname github.com --input -"));
        assert!(react(&gh, "github.com", "acme/app", 7, "thumbsup").is_err());
        reply(&gh, "github.com", "acme/app", 7, 10, "Because \"x\"").unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X POST repos/acme/app/pulls/7/comments/10/replies --hostname github.com --input -"), "{c}");
        assert!(!c.contains("Because"), "the text goes on stdin: {c}");
        assert!(reply(&gh, "github.com", "acme/app", 7, 0, "x").is_err());
        assert!(reply(&gh, "github.com", "acme/app", 7, 10, "  ").is_err());
        assert!(reply(&gh, "github.com", "acme/app", 7, 10, &"x".repeat(COMMENT_MAX + 1)).is_err());
        assert_eq!(calls(&dir).lines().count(), 2, "only the two good ones were sent");
    }

    #[test]
    fn merging_is_refused_until_the_user_confirmed_it() {
        let (gh, dir) = stand_in("pr-merge", &json!({ "merged": true, "sha": "deadbeef" }));
        assert!(merge(&gh, "github.com", "acme/app", 7, "squash", false, "abc1234").unwrap_err().contains("confirm"));
        assert!(merge(&gh, "github.com", "acme/app", 7, "fast-forward", true, "abc1234").is_err());
        let long = "a".repeat(65);
        for bad in ["", "xyz1234", "abc12", long.as_str()] {
            assert!(merge(&gh, "github.com", "acme/app", 7, "squash", true, bad).unwrap_err().contains("Reload"), "{bad}");
        }
        assert!(!dir.join("calls.txt").exists(), "nothing reached gh without a confirmation");
        assert_eq!(merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap(), "deadbeef");
        assert!(calls(&dir).contains("api -X PUT repos/acme/app/pulls/7/merge --hostname github.com --input -"));
        // FIX-1 (review FIX-BEFORE 3): the merge is pinned to the head commit the page showed
        assert_eq!(body(&dir), json!({ "merge_method": "squash", "sha": "abc1234" }));

        let (gh, _keep) = stand_in("pr-merge-not", &json!({ "merged": false, "message": "Pull Request is not mergeable" }));
        assert!(merge(&gh, "github.com", "acme/app", 7, "merge", true, "abc1234").unwrap_err().contains("not mergeable"));
    }

    /// A stand-in gh that fails: prints `said` on standard error and exits 1, keeping the call and body.
    fn failing_stand_in(name: &str, said: &str) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, format!("@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nmore >>\"%~dp0body.txt\"\r\necho {said} 1>&2\r\nexit /b 1\r\n")).unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, format!("#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncat >> \"$d/body.txt\"\necho '{said}' >&2\nexit 1\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        (gh, dir)
    }

    #[test]
    fn a_merge_is_refused_for_a_repository_no_added_project_has_as_a_remote() {
        let (gh, dir) = stand_in("pr-merge-added", &json!({ "merged": true, "sha": "deadbeef" }));
        let mine = vec!["remote.origin.url https://github.com/Acme/App.git\n".to_string(), "remote.origin.url git@github.com:corp/lib.git\nremote.up.url https://github.com/other/thing\n".to_string()];
        let go = |host: &str, repo: &str| merge_in_added(&gh, (&mine, ""), (host, repo), 7, "squash", true, "abc1234");
        let refused = "Add this repository in Kolux to merge from here.";
        // another host with the same name, a stranger, no projects at all, a malformed name
        assert_eq!(go("git.corp.example", "acme/app").unwrap_err(), refused);
        assert_eq!(go("git.corp.example", "corp/lib").unwrap_err(), refused);
        assert_eq!(go("github.com", "nobody/nothing").unwrap_err(), refused);
        assert_eq!(merge_in_added(&gh, (&[], ""), ("github.com", "acme/app"), 7, "squash", true, "abc1234").unwrap_err(), refused);
        assert_eq!(go("github.com", "acme").unwrap_err(), refused);
        assert!(!dir.join("calls.txt").exists(), "a refused merge never reached gh");
        // added: https in another case, ssh, a second remote of the same checkout
        assert_eq!(go("github.com", "acme/app").unwrap(), "deadbeef");
        assert_eq!(go("github.com", "corp/lib").unwrap(), "deadbeef");
        assert_eq!(go("github.com", "other/thing").unwrap(), "deadbeef");
        assert_eq!(calls(&dir).lines().count(), 3);
        // being added does not skip the other checks
        assert!(merge_in_added(&gh, (&mine, ""), ("github.com", "acme/app"), 7, "squash", false, "abc1234").unwrap_err().contains("confirm"));
    }

    const SSH_CONFIG: &str = "Host work-gh\n  HostName github.com\n  User git\n\nHost corp-gh\n  HostName git.corp.example\n";

    #[test]
    fn a_remote_through_an_ssh_alias_is_the_host_the_alias_stands_for_as_on_the_page() {
        let (gh, dir) = stand_in("pr-merge-alias", &json!({ "merged": true, "sha": "deadbeef" }));
        let mine = vec!["remote.origin.url git@work-gh:acme/app.git\n".to_string(), "remote.origin.url ssh://git@corp-gh/corp/lib.git\n".to_string()];
        let go = |ssh: &str, host: &str, repo: &str| merge_in_added(&gh, (&mine, ssh), (host, repo), 7, "squash", true, "abc1234");
        let merges = |d: &std::path::Path| calls(d).lines().filter(|l| l.contains("/merge")).count();
        let refused = "Add this repository in Kolux to merge from here.";
        // the page's own reading (scm_github_repo) gives github.com/acme/app for this remote; so does the gate
        assert_eq!(crate::scm::github_repo("git@work-gh:acme/app.git", SSH_CONFIG).unwrap().key, "github.com/acme/app");
        assert_eq!(go(SSH_CONFIG, "github.com", "acme/app").unwrap(), "deadbeef");
        // an alias for another host is added too; gh then only has to be signed in there (it is not, in this stand-in)
        assert_ne!(go(SSH_CONFIG, "git.corp.example", "corp/lib").unwrap_err(), refused);
        assert_eq!(merges(&dir), 1);
        // the alias is not the host itself, and an alias for one host is not another host
        assert_eq!(go(SSH_CONFIG, "work-gh", "acme/app").unwrap_err(), refused);
        assert_eq!(go(SSH_CONFIG, "github.com", "corp/lib").unwrap_err(), refused);
        assert_eq!(go(SSH_CONFIG, "git.corp.example", "acme/app").unwrap_err(), refused);
        assert_eq!(merges(&dir), 1, "a refused merge never reached gh");
        // without an ssh config the alias is unknown, so it matches no real host
        assert_eq!(go("", "github.com", "acme/app").unwrap_err(), refused);
    }

    fn repo_with_origin(name: &str, url: &str) -> crate::test_dir::TempDir {
        let dir = crate::test_dir::temp(name);
        for args in [vec!["init", "-q"], vec!["remote", "add", "origin", url]] {
            let ok = std::process::Command::new("git").args(&args).current_dir(&*dir).output().unwrap().status.success();
            assert!(ok, "git {args:?}");
        }
        dir
    }

    #[test]
    fn the_merge_command_reads_the_added_projects_from_the_store_and_their_remotes_from_git() {
        let (gh, calls_dir) = stand_in("pr-merge-wrap", &json!({ "merged": true, "sha": "deadbeef" }));
        let aliased = repo_with_origin("pr-merge-wrap-a", "git@work-gh:acme/app.git");
        let plain = repo_with_origin("pr-merge-wrap-b", "https://github.com/Corp/Lib.git");
        let not_a_repo = crate::test_dir::temp("pr-merge-wrap-c"); // an added folder that is gone as a repository
        let profile = crate::test_dir::temp("pr-merge-wrap-profile");
        let store = std::sync::Mutex::new(crate::state::Store::open(&profile).unwrap());
        // nothing added yet: nothing is read, nothing is merged
        assert_eq!(added_paths(&store).unwrap(), Vec::<String>::new());
        {
            let s = store.lock().unwrap();
            for d in [&aliased, &plain, &not_a_repo] {
                crate::projects::register_project(&s, ((**d).clone(), (**d).clone())).unwrap();
            }
        }
        let paths = added_paths(&store).unwrap();
        assert_eq!(paths.len(), 3);
        assert!(store.try_lock().is_ok(), "the store lock is not held after the paths are read");
        let go = |ssh: &str, host: &str, repo: &str| merge_in_paths(&gh, (&paths, ssh), (host, repo), 7, "squash", true, "abc1234");
        let refused = "Add this repository in Kolux to merge from here.";
        // an aliased origin is merged when the user's ssh config names the alias, refused when it does not
        assert_eq!(go(SSH_CONFIG, "github.com", "acme/app").unwrap(), "deadbeef");
        assert_eq!(go("", "github.com", "acme/app").unwrap_err(), refused);
        assert_eq!(go("", "github.com", "corp/lib").unwrap(), "deadbeef");
        assert_eq!(go(SSH_CONFIG, "github.com", "nobody/else").unwrap_err(), refused);
        assert_eq!(calls(&calls_dir).lines().count(), 2);
        drop(store);
    }

    #[test]
    fn a_merge_after_someone_pushed_reads_as_changed_and_other_failures_stay_as_they_are() {
        let (gh, dir) = failing_stand_in("pr-merge-409", "gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
        assert_eq!(merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err(), "The pull request changed. Reload it before merging.");
        assert!(calls(&dir).contains("api -X PUT repos/acme/app/pulls/7/merge"));
        let (gh, _keep) = failing_stand_in("pr-merge-500", "gh: Server Error (HTTP 500)");
        let e = merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err();
        assert!(e.contains("HTTP 500") && !e.contains("changed"), "{e}");
    }

    fn file_items(n: usize) -> Vec<Value> {
        (0..n).map(|i| json!({ "filename": format!("f{i}.rs"), "status": "modified", "additions": 1, "deletions": 0, "patch": "x" })).collect()
    }

    #[test]
    fn files_past_a_hundred_are_read_page_by_page_and_a_cap_says_so() {
        // 100 on the first page, 3 on the second: all 103, nothing cut, two calls.
        let (gh, dir) = stand_in("pr-files-103", &json!(file_items(100)));
        fs::write(dir.join("answer2.json"), json!(file_items(3)).to_string()).unwrap();
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (103, false));
        assert_eq!(got.limit, 500, "the page cap travels with the answer");
        let c = calls(&dir).replace('"', "");
        assert!(c.contains("pulls/7/files?per_page=100&page=1") && c.contains("pulls/7/files?per_page=100&page=2"), "{c}");
        assert_eq!(c.lines().count(), 2, "{c}");

        // every page full: five pages are read, one more is asked for, and the answer says there is more.
        let (gh, dir) = stand_in("pr-files-cap", &json!(file_items(100)));
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (PAGE_CAP * PER_PAGE, true));
        assert_eq!(calls(&dir).lines().count(), PAGE_CAP + 1);

        // exactly five full pages and then nothing: not cut.
        let (gh, dir) = stand_in("pr-files-exact", &json!(file_items(100)));
        fs::write(dir.join(format!("answer{}.json", PAGE_CAP + 1)), "[]").unwrap();
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (PAGE_CAP * PER_PAGE, false));
    }

    #[test]
    fn reviews_and_review_comments_past_a_hundred_are_read_too() {
        let many_reviews: Vec<Value> = (0..100).map(|i| json!({ "user": { "login": format!("u{i}") }, "state": "APPROVED" })).collect();
        let (gh, dir) = stand_in("pr-reviews-101", &pull());
        fs::write(dir.join("answer2.json"), json!(many_reviews).to_string()).unwrap();
        fs::write(dir.join("answer3.json"), json!([{ "user": { "login": "late" }, "state": "CHANGES_REQUESTED" }]).to_string()).unwrap();
        fs::write(dir.join("answer4.json"), "{}").unwrap();
        let p = read_page(&gh, "github.com", "acme/app", 7).unwrap();
        assert!(p.reviewers.iter().any(|r| r.login == "late" && r.state == "changes_requested"), "{:?}", p.reviewers);
        assert!(!p.reviews_truncated);
        assert_eq!(p.reviews_limit, 500);
        assert_eq!(p.reviewers.len(), 102, "cy requested + 100 + late");

        let comments: Vec<Value> = (0..100).map(|i| json!({ "id": i + 1, "path": "a.rs", "line": 1, "body": "c", "user": { "login": "ana" }, "created_at": "t" })).collect();
        let (gh, dir) = stand_in("pr-comments-cap", &json!(comments));
        let got = read_threads(&gh, "github.com", "acme/app", 7).unwrap();
        assert!(got.truncated);
        assert_eq!(got.limit, 500);
        assert_eq!(calls(&dir).lines().count(), PAGE_CAP + 1);
    }

    fn bodies(dir: &std::path::Path) -> Vec<Value> {
        fs::read_to_string(dir.join("body.txt")).unwrap_or_default().lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l.trim()).unwrap()).collect()
    }

    fn viewed_answer(files: &[(&str, &str)], more: bool, cursor: Option<&str>) -> Value {
        let nodes: Vec<Value> = files.iter().map(|(p, st)| json!({ "path": p, "viewerViewedState": st })).collect();
        json!({ "data": { "repository": { "pullRequest": { "files": { "nodes": nodes, "pageInfo": { "hasNextPage": more, "endCursor": cursor } } } } } })
    }

    #[test]
    fn viewed_marks_are_read_from_the_graphql_answer_and_unknown_states_are_dropped() {
        let v = viewed_answer(&[("a.rs", "VIEWED"), ("b.rs", "UNVIEWED"), ("c.rs", "DISMISSED"), ("d.rs", "SOMETHING_NEW"), ("", "VIEWED")], true, Some("c1"));
        let (files, more, cursor) = viewed_page(&v);
        let got: Vec<(&str, &str)> = files.iter().map(|f| (f.path.as_str(), f.state.as_str())).collect();
        assert_eq!(got, vec![("a.rs", "viewed"), ("b.rs", "unviewed"), ("c.rs", "dismissed")]);
        assert!(more);
        assert_eq!(cursor.as_deref(), Some("c1"));
        let (none, more, cursor) = viewed_page(&json!({ "data": { "repository": { "pullRequest": null } } }));
        assert!(none.is_empty() && !more && cursor.is_none());
    }

    #[test]
    fn reading_viewed_marks_follows_the_cursor_and_sends_the_query_on_stdin() {
        let (gh, dir) = stand_in("pr-viewed-read", &viewed_answer(&[("a.rs", "VIEWED")], true, Some("cur1")));
        fs::write(dir.join("answer2.json"), viewed_answer(&[("b.rs", "UNVIEWED")], false, None).to_string()).unwrap();
        let got = read_viewed(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!(got.files.len(), 2);
        assert!(!got.truncated);
        let c = calls(&dir);
        assert_eq!(c.lines().count(), 2, "{c}");
        assert!(c.lines().all(|l| l.contains("api graphql --hostname github.com --input -")), "{c}");
        assert!(!c.contains("acme") && !c.contains("query"), "the query and its variables go on stdin: {c}");
        let b = bodies(&dir);
        assert_eq!(b[0]["variables"], json!({ "owner": "acme", "name": "app", "number": 7, "after": null }));
        assert_eq!(b[1]["variables"]["after"], json!("cur1"));
        assert!(b[0]["query"].as_str().unwrap().contains("viewerViewedState"));
        assert!(read_viewed(&gh, "github.com", "acme/../app", 7).is_err());
        assert!(read_viewed(&gh, "github.com", "acme/app", 0).is_err());
        assert_eq!(calls(&dir).lines().count(), 2, "a refused name or number sends nothing");
    }

    #[test]
    fn viewed_marks_past_the_page_cap_are_reported_as_cut_and_a_graphql_error_is_the_error() {
        let (gh, dir) = stand_in("pr-viewed-cap", &viewed_answer(&[("a.rs", "VIEWED")], true, Some("again")));
        let got = read_viewed(&gh, "github.com", "acme/app", 7).unwrap();
        assert!(got.truncated);
        assert_eq!(calls(&dir).lines().count(), PAGE_CAP);

        let (gh, _dir) = stand_in("pr-viewed-err", &json!({ "errors": [{ "message": "Could not resolve to a PullRequest" }] }));
        let e = read_viewed(&gh, "github.com", "acme/app", 7).unwrap_err();
        assert!(e.contains("Could not resolve"), "{e}");
        let (gh, _dir) = stand_in("pr-viewed-null", &json!({ "data": { "repository": { "pullRequest": null } } }));
        assert!(read_viewed(&gh, "github.com", "acme/app", 7).unwrap_err().contains("did not find"));
    }

    #[test]
    fn marking_a_file_viewed_looks_up_the_node_id_then_sends_the_matching_mutation() {
        let (gh, dir) = stand_in("pr-viewed-set", &json!({ "node_id": "PR_kwDOabc", "data": {} }));
        assert_eq!(set_viewed(&gh, "github.com", "acme/app", 7, "src/a b.rs", true).unwrap(), "viewed");
        assert_eq!(set_viewed(&gh, "github.com", "acme/app", 7, "src/a b.rs", false).unwrap(), "unviewed");
        let c = calls(&dir);
        assert_eq!(c.lines().count(), 4, "{c}");
        assert!(c.contains("api repos/acme/app/pulls/7 --hostname github.com"), "{c}");
        let b = bodies(&dir);
        assert!(b[0]["query"].as_str().unwrap().contains("markFileAsViewed"));
        assert!(b[1]["query"].as_str().unwrap().contains("unmarkFileAsViewed"));
        assert_eq!(b[0]["variables"], json!({ "id": "PR_kwDOabc", "path": "src/a b.rs" }));
        assert!(!c.contains("a b.rs"), "the file name goes on stdin: {c}");
    }

    #[test]
    fn marking_refuses_odd_file_names_and_a_pull_request_without_a_node_id() {
        let (gh, dir) = stand_in("pr-viewed-refused", &json!({ "node_id": "PR_x" }));
        assert!(set_viewed(&gh, "github.com", "acme/app", 7, "", true).is_err());
        assert!(set_viewed(&gh, "github.com", "acme/app", 7, "a\nb", true).is_err());
        assert!(set_viewed(&gh, "github.com", "acme/app", 7, &"x".repeat(4097), true).is_err());
        assert!(set_viewed(&gh, "github.com", "acme/app", 0, "a.rs", true).is_err());
        assert!(!dir.join("calls.txt").exists());
        let (gh, dir) = stand_in("pr-viewed-noid", &json!({ "number": 7 }));
        assert!(set_viewed(&gh, "github.com", "acme/app", 7, "a.rs", true).is_err());
        assert_eq!(calls(&dir).lines().count(), 1, "no mutation was sent");
    }

    #[test]
    fn recent_editors_are_ranked_by_commits_and_bots_and_odd_names_are_left_out() {
        let by = |l: &str| json!({ "author": { "login": l, "type": "User" } });
        let lists = vec![
            json!([by("ana"), by("bo"), json!({ "author": { "login": "dependabot[bot]", "type": "Bot" } }), json!({ "author": null }), by("bad login")]),
            json!([by("BO"), by("cy"), json!({ "author": { "login": "ci", "type": "Bot" } })]),
            json!([by("cy"), by("cy")]),
        ];
        // cy has 3 commits, bo 2 (the second spelled BO), ana 1; the bots, the missing author and the name with a space are not people
        assert_eq!(editors_of(&lists), vec!["cy".to_string(), "bo".to_string(), "ana".to_string()]);
        assert!(editors_of(&[]).is_empty());
    }

    #[test]
    fn reading_editors_asks_for_each_changed_files_history_with_the_name_as_a_gh_field() {
        let (gh, dir) = stand_in("pr-editors", &json!([{ "filename": "src/a.rs" }, { "filename": "b.rs" }, { "filename": "" }]));
        fs::write(dir.join("answer2.json"), json!([{ "author": { "login": "ana", "type": "User" } }]).to_string()).unwrap();
        fs::write(dir.join("answer3.json"), json!([{ "author": { "login": "bo", "type": "User" } }, { "author": { "login": "ana", "type": "User" } }]).to_string()).unwrap();
        let got = read_editors(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!(got, vec!["ana".to_string(), "bo".to_string()]);
        let c = calls(&dir).replace('"', "");
        assert!(c.contains("api repos/acme/app/pulls/7/files --hostname github.com -X GET -f per_page=8"), "{c}");
        assert!(c.contains("api repos/acme/app/commits --hostname github.com -X GET -f path=src/a.rs -f per_page=10"), "{c}");
        assert!(c.contains("-f path=b.rs"), "{c}");
        assert_eq!(c.lines().count(), 3, "the empty name asked nothing: {c}");
        assert!(read_editors(&gh, "github.com", "acme/../app", 7).is_err());
    }

    #[test]
    fn the_page_names_the_repository_the_branch_lives_in() {
        let mut p = pull();
        p["head"]["repo"] = json!({ "full_name": "me/app" });
        assert_eq!(page_of(&p, &json!([]), &json!({})).unwrap().head_repo, "me/app");
        assert_eq!(page_of(&pull(), &json!([]), &json!({})).unwrap().head_repo, "", "a deleted fork has no repository");
    }
}
