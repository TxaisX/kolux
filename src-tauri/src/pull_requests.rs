//! The pull request reads and writes through gh that the kept engine uses: a check's steps and
//! annotations (pr_review.rs `scm_check_detail`) and the merge (chat_finish.rs). Every call is
//! `gh api` against a plain host (the same gate as github.rs); request bodies go to gh on standard
//! input, never on its command line. Merging is an outward action: it is refused unless the caller
//! says the user confirmed it.

use crate::github::{gh_json, host_allowed, repo_path, s};
use crate::scm::{gh_run, gh_words};
use serde_json::{json, Value};
use std::path::Path;

/// One page of files, checks or comments (GitHub's largest page).
const PER_PAGE: usize = 100;
/// Files, reviews and review comments are read this many pages deep (500 each); past that the page
/// says it shows the first 500 (FIX-1, review FIX-SOON 2).
const PAGE_CAP: usize = 5;

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

fn n(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
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

/// A commit id as GitHub prints it: 7 to 64 hex digits.
fn sha_ok(sha: &str) -> bool {
    sha.len() >= 7 && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
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
    fn a_merge_after_someone_pushed_reads_as_changed_and_other_failures_stay_as_they_are() {
        let (gh, dir) = failing_stand_in("pr-merge-409", "gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
        assert_eq!(merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err(), "The pull request changed. Reload it before merging.");
        assert!(calls(&dir).contains("api -X PUT repos/acme/app/pulls/7/merge"));
        let (gh, _keep) = failing_stand_in("pr-merge-500", "gh: Server Error (HTTP 500)");
        let e = merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err();
        assert!(e.contains("HTTP 500") && !e.contains("changed"), "{e}");
    }
}
