//! PROJ-030 (the pull-request half): open a GitHub pull request as a workspace. The pull request's
//! head is fetched into a remote-tracking branch; a local branch of the same name is reused only
//! when it already points at the pull request's latest commit, and a pull request from a fork gets
//! a remote named after the fork's owner, with a number added when that name is taken.

use crate::git::{run, Git};
use crate::projects::{Created, Place, Project};
use crate::names::safe_name;
use std::path::Path;
use std::sync::PoisonError;

/// The gh fields Kolux reads for a pull request it may open as a workspace.
pub const PR_HEAD_FIELDS: &str = "number,title,url,headRefName,headRefOid,isCrossRepository,headRepositoryOwner,headRepository";

/// A pull request's head, as `gh pr list / view --json PR_HEAD_FIELDS` gives it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrHead {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub head_ref_name: String,
    pub head_ref_oid: String,
    #[serde(default)]
    pub is_cross_repository: bool,
    #[serde(default)]
    pub head_repository_owner: Option<Login>,
    #[serde(default)]
    pub head_repository: Option<RepoName>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Login {
    pub login: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RepoName {
    pub name: String,
}

/// Reads gh's answer: one pull request (`gh pr view`) or a list (`gh pr list`).
pub fn parse_heads(text: &str) -> Result<Vec<PrHead>, String> {
    let text = text.trim();
    if text.starts_with('[') {
        serde_json::from_str(text)
    } else {
        serde_json::from_str::<PrHead>(text).map(|h| vec![h])
    }
    .map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// The open pull requests of the project's repository, newest first as gh lists them.
pub fn list(gh: &Path, repo: &Path) -> Result<Vec<PrHead>, String> {
    let text = crate::scm::gh_run(gh, repo, &["pr", "list", "--state", "open", "--limit", "50", "--json", PR_HEAD_FIELDS], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_heads(&text)
}

/// One pull request by its number.
pub fn view(gh: &Path, repo: &Path, number: u64) -> Result<PrHead, String> {
    let n = number.to_string();
    let text = crate::scm::gh_run(gh, repo, &["pr", "view", &n, "--json", PR_HEAD_FIELDS], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_heads(&text)?.into_iter().next().ok_or_else(|| format!("gh said nothing about pull request #{number}"))
}

/// The fork's address in the same form as origin's: origin's `owner/name` swapped for the fork's.
/// None when origin is not a GitHub-shaped address.
pub fn fork_url(origin: &str, owner: &str, name: &str) -> Option<String> {
    let origin = origin.trim();
    let gh = crate::scm::github_repo(origin, "")?;
    let tail = format!("{}/{}", gh.owner, gh.name);
    let at = origin.rfind(&tail)?;
    Some(format!("{}{owner}/{name}{}", &origin[..at], &origin[at + tail.len()..]))
}

/// The remote to fetch a fork's branch from: `wanted` when it is free or already points at `url`,
/// else `wanted-2`, `wanted-3`... (the first free one, or one already pointing at `url`).
pub fn remote_for(repo: &Path, wanted: &str, url: &str) -> Result<String, String> {
    let have: Vec<String> = run(&["remote"], Some(repo))?.lines().map(str::to_string).collect();
    let base = safe_name(wanted).unwrap_or_else(|| "fork".to_string());
    for n in 1.. {
        let name = if n == 1 { base.clone() } else { format!("{base}-{n}") };
        if !have.contains(&name) {
            run(&["remote", "add", &name, url], Some(repo))?;
            return Ok(name);
        }
        if run(&["remote", "get-url", &name], Some(repo)).is_ok_and(|u| u.trim() == url) {
            return Ok(name);
        }
    }
    unreachable!("1.. never ends")
}

/// PROJ-037: an issue, as `gh issue view --json number,title,url` gives it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
}

pub fn parse_issue(text: &str) -> Result<Issue, String> {
    serde_json::from_str(text.trim()).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// One issue of the project's repository by its number.
pub fn issue(gh: &Path, repo: &Path, number: u64) -> Result<Issue, String> {
    let n = number.to_string();
    let text = crate::scm::gh_run(gh, repo, &["issue", "view", &n, "--json", "number,title,url"], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_issue(&text)
}

/// PROJ-037: whether any remote in `remotes` (`git config --get-regexp` lines: key, then the
/// address as the user wrote it) is the GitHub repository `host/owner/name`. `ssh_config` is the
/// user's SSH config text, read once by the caller: an SSH alias remote (`git@work-gh:acme/app.git`)
/// is the host the alias stands for, the same reading the page's `scm_github_repo` gives, so the
/// merge gate and the page agree (stand-in review FIX-SOON 1).
pub fn has_repo_with(remotes: &str, host: &str, owner: &str, name: &str, ssh_config: &str) -> bool {
    let want = format!("{host}/{owner}/{name}").to_lowercase();
    remotes.lines().filter_map(|l| l.split_once(' ')).any(|(_, url)| crate::scm::github_repo(url, ssh_config).is_some_and(|g| g.key == want))
}

/// The remote addresses of the repository at `repo` as written (an insteadOf rewrite is not
/// applied, so a mirror still counts as the repository it stands in for).
pub fn remotes(repo: &Path) -> String {
    run(&["config", "--get-regexp", r"^remote\..*\.url$"], Some(repo)).unwrap_or_default()
}

/// GIT-010: where the branch checked out in a worktree pushes to.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTarget {
    pub branch: String,
    pub remote: String,
    /// The branch name on that remote (the upstream's), which differs from `branch` for a branch
    /// taken from a fork's pull request and renamed on the way in.
    pub remote_branch: String,
    pub url: String,
    /// `owner/name` of the fork the branch pushes to, or its address when that is not a GitHub one;
    /// None when the push goes to the project's own repository.
    pub fork: Option<String>,
}

fn same_repo(a: &str, b: &str) -> bool {
    match (crate::scm::github_repo(a, ""), crate::scm::github_repo(b, "")) {
        (Some(x), Some(y)) => x.key == y.key,
        _ => a.trim().trim_end_matches(".git").trim_end_matches('/') == b.trim().trim_end_matches(".git").trim_end_matches('/'),
    }
}

/// The settings a branch's push takes, as `git config` gives them: the branch's own push remote,
/// then the repository's default push remote, then the remote the branch tracks.
pub fn push_target(worktree: &Path) -> Option<PushTarget> {
    // The full ref, stripped: `--short` prints `heads/main` when a tag is also called `main` (T-779 review fix 7).
    let branch = run(&["symbolic-ref", "--quiet", "HEAD"], Some(worktree)).ok().and_then(|r| r.strip_prefix("refs/heads/").map(str::to_string)).filter(|b| !b.is_empty())?;
    // As written, spaces included: `origin ` is a remote of its own to git (T-779 review fix 8, P1-3).
    let conf = |key: String| crate::git::run_untrimmed(&["config", "--get", &key], Some(worktree)).ok().map(|v| v.strip_suffix('\n').unwrap_or(&v).to_string()).filter(|v| !v.is_empty());
    let remote = conf(format!("branch.{branch}.pushRemote")).or_else(|| conf("remote.pushDefault".to_string())).or_else(|| conf(format!("branch.{branch}.remote")))?;
    if remote == "." {
        return None;
    }
    let remote_branch = conf(format!("branch.{branch}.merge")).map(|m| m.strip_prefix("refs/heads/").unwrap_or(&m).to_string()).unwrap_or_else(|| branch.clone());
    let url = run(&["remote", "get-url", "--push", &remote], Some(worktree)).ok()?;
    let origin = run(&["remote", "get-url", "origin"], Some(worktree)).ok();
    let fork = (remote != "origin" && origin.as_deref().is_none_or(|o| !same_repo(o, &url))).then(|| match crate::scm::github_repo(&url, "") {
        Some(g) => format!("{}/{}", g.owner, g.name),
        None => url.clone(),
    });
    Some(PushTarget { branch, remote, remote_branch, url, fork })
}

/// GIT-010: the git arguments of a push. A branch whose remote name differs from its own (a fork
/// pull request's branch, renamed so it never clashes) is pushed to the remote name on purpose,
/// since a plain push would refuse the mismatch; any other branch takes the plain push.
pub fn push_args(t: Option<&PushTarget>, lease: bool) -> Vec<String> {
    let mut args = vec!["push".to_string()];
    if lease {
        args.push("--force-with-lease".to_string());
    }
    if let Some(t) = t.filter(|t| t.fork.is_some() && t.remote_branch != t.branch) {
        args.push(t.remote.clone());
        args.push(format!("HEAD:refs/heads/{}", t.remote_branch));
    }
    args
}

/// GIT-010: what the panel's notice reads from; None when the push is to the project's own repository.
#[tauri::command(async)]
pub fn scm_push_target(worktree: String) -> Option<PushTarget> {
    push_target(Path::new(&worktree)).filter(|t| t.fork.is_some())
}

/// SESS-036: an issue or pull request the composer can link a new workspace to.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Linkable {
    #[serde(default)]
    pub kind: String,
    pub number: u64,
    pub title: String,
    pub url: String,
}

/// GitHub's search takes at most 256 characters, so a longer lookup is refused before gh is asked.
pub const LOOKUP_MAX: usize = 256;

pub fn lookup_refused(query: &str) -> Option<String> {
    let n = query.chars().count();
    (n > LOOKUP_MAX).then(|| format!("That lookup is {n} characters long; GitHub searches take at most {LOOKUP_MAX}."))
}

/// gh's `issue list` and `pr list --json number,title,url` answers, issues first.
pub fn parse_found(issues: &str, prs: &str) -> Result<Vec<Linkable>, String> {
    let read = |text: &str, kind: &str| {
        serde_json::from_str::<Vec<Linkable>>(text.trim()).map(|v| v.into_iter().map(|l| Linkable { kind: kind.to_string(), ..l }).collect::<Vec<_>>()).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
    };
    Ok([read(issues, "issue")?, read(prs, "pull")?].concat())
}

/// The open issues and pull requests of the repository at `repo` matching `query` in GitHub's search.
// ponytail: text search only; a bare number is matched the way GitHub's search matches it.
pub fn find(gh: &Path, repo: &Path, query: &str) -> Result<Vec<Linkable>, String> {
    if let Some(why) = lookup_refused(query) {
        return Err(why);
    }
    let list = |what: &str| crate::scm::gh_run(gh, repo, &[what, "list", "--state", "open", "--limit", "8", "--search", query.trim(), "--json", "number,title,url"], None).map_err(|e| crate::scm::gh_words(&e));
    parse_found(&list("issue")?, &list("pr")?)
}

fn sha(repo: &Path, r: &str) -> Option<String> {
    run(&["rev-parse", "--verify", "--quiet", &format!("{r}^{{commit}}")], Some(repo)).ok().map(|s| s.trim().to_string())
}

/// Opens pull request `pr` as a workspace of `project`. `fork` is the fork's address for a
/// pull request from another repository (None: its head is on origin). The folder takes `folder`
/// when given, else the head branch's name, numbered when taken. The bool says whether a local
/// branch that existed before was reused (it then stays when the workspace is removed).
pub fn open(git: &Git, place: &Place, project: &Project, pr: &PrHead, fork: Option<&str>, folder: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<(Created, bool), String> {
    let repo = Path::new(&project.path);
    let head = pr.head_ref_name.trim();
    if head.is_empty() {
        return Err(format!("pull request #{} names no head branch", pr.number));
    }
    let turn = crate::projects::repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if overtaken() {
        return Err(crate::projects::OVERTAKEN.to_string());
    }
    let remote = match fork {
        Some(url) => remote_for(repo, pr.head_repository_owner.as_ref().map_or("fork", |o| o.login.as_str()), url)?,
        None => "origin".to_string(),
    };
    let tracking = format!("refs/remotes/{remote}/{head}");
    run(&["fetch", "--quiet", &remote, &format!("+refs/heads/{head}:{tracking}")], Some(repo)).map_err(|e| format!("could not fetch pull request #{} from {remote}: {e}", pr.number))?;
    let latest = if pr.head_ref_oid.is_empty() { sha(repo, &tracking).unwrap_or_default() } else { pr.head_ref_oid.clone() };
    // A local branch of the head's name is reused only when it is at the pull request's head.
    let local = sha(repo, &format!("refs/heads/{head}"));
    // GIT-010: a leftover local branch of a fork's pull request is never reused; a fresh ref is made.
    let reuse = fork.is_none() && local.as_deref() == Some(latest.as_str());
    let branch = if reuse || local.is_none() {
        head.to_string()
    } else {
        let stem = format!("{head}-pr-{}", pr.number);
        (1..).map(|n| if n == 1 { stem.clone() } else { format!("{stem}-{n}") }).find(|b| sha(repo, &format!("refs/heads/{b}")).is_none()).unwrap_or(stem)
    };
    let stem = safe_name(folder.map(str::trim).filter(|f| !f.is_empty()).unwrap_or(head)).unwrap_or_else(|| format!("pr-{}", pr.number));
    let dest = (1..)
        .map(|n| crate::projects::workspace_path(place, project, &if n == 1 { stem.clone() } else { format!("{stem}-{n}") }))
        .find(|d| !d.exists())
        .ok_or("no free folder")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let dest_s = dest.to_string_lossy().to_string();
    // SESS-038: the same retry policy as a new workspace's
    if reuse {
        crate::projects::add_retrying(repo, &dest, None, overtaken, || run(&["worktree", "add", &dest_s, &branch], Some(repo)).map(drop))?;
    } else {
        crate::projects::add_retrying(repo, &dest, Some(&branch), overtaken, || run(&["worktree", "add", "-b", &branch, &dest_s, &latest], Some(repo)).map(drop))?;
        run(&["branch", &format!("--set-upstream-to={remote}/{head}"), &branch], Some(repo))?;
        if fork.is_some() {
            run(&["config", &format!("branch.{branch}.pushRemote"), &remote], Some(repo))?;
        }
    }
    let warnings = crate::include::bring_along(repo, &dest);
    if overtaken() {
        crate::include::unlink_shared(repo, &dest);
        let _ = git.worktree_remove(repo, &dest, (!reuse).then_some(branch.as_str()));
        return Err(crate::projects::OVERTAKEN.to_string());
    }
    let note = match (reuse, local.is_some()) {
        (true, _) => Some(format!("reused the local branch {branch}, already at the pull request's head")),
        (false, true) => Some(format!("the local branch {head} is not at the pull request's head, so it was left alone and {branch} made")),
        (false, false) => None,
    };
    let worktree = git.worktrees(repo)?.into_iter().find(|w| crate::projects::same_folder(Path::new(&w.path), &dest)).ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    // T-780: a pull request's branch is never Kolux's own; its record carries the marker anyway.
    Ok((Created { worktree, base: format!("pull request #{}", pr.number), note, warnings, own: false }, reuse))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-prco-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, file: &str) -> String {
        fs::write(dir.join(file), file).unwrap();
        git_in(dir, &["add", "."]);
        git_in(dir, &["commit", "-q", "-m", file]);
        git_in(dir, &["rev-parse", "HEAD"])
    }

    /// A recorded `gh pr list --json PR_HEAD_FIELDS` answer (the fields gh documents for pr list).
    const LISTED: &str = r#"[{"headRefName":"feat/login","headRefOid":"OID1","headRepository":{"id":"R_1","name":"app"},"headRepositoryOwner":{"id":"U_1","login":"txais"},"isCrossRepository":false,"number":12,"title":"Fix the login page","url":"https://github.com/txais/app/pull/12"},{"headRefName":"main","headRefOid":"OID2","headRepository":{"id":"R_2","name":"app-fork"},"headRepositoryOwner":{"id":"U_2","login":"Someone"},"isCrossRepository":true,"number":13,"title":"Docs","url":"https://github.com/txais/app/pull/13"}]"#;

    #[test]
    fn gh_answers_are_read_as_pull_request_heads() {
        let heads = parse_heads(LISTED).unwrap();
        assert_eq!(heads.len(), 2);
        assert_eq!((heads[0].number, heads[0].head_ref_name.as_str(), heads[0].is_cross_repository), (12, "feat/login", false));
        assert_eq!(heads[1].head_repository_owner.as_ref().unwrap().login, "Someone");
        assert_eq!(heads[1].head_repository.as_ref().unwrap().name, "app-fork");
        let one = parse_heads(r#"{"number":5,"title":"t","url":"u","headRefName":"x","headRefOid":"y"}"#).unwrap();
        assert_eq!(one[0].number, 5);
        assert!(parse_heads("not json").is_err());
    }

    #[test]
    fn a_forks_address_follows_origins_form() {
        assert_eq!(fork_url("https://github.com/txais/app.git", "someone", "app-fork").as_deref(), Some("https://github.com/someone/app-fork.git"));
        assert_eq!(fork_url("git@github.com:txais/app.git", "someone", "app").as_deref(), Some("git@github.com:someone/app.git"));
        assert_eq!(fork_url("https://github.com/txais/app", "o", "n").as_deref(), Some("https://github.com/o/n"));
        assert_eq!(fork_url("C:/repos/app", "o", "n"), None);
    }

    #[test]
    fn proj037_the_project_is_the_one_with_a_remote_at_the_item_repository() {
        let remotes = "remote.origin.url https://github.com/Acme/App.git\nremote.fork.url git@github.com:me/app.git\n";
        // an empty SSH config: the user's real ~/.ssh/config cannot change these answers
        assert!(has_repo_with(remotes, "github.com", "acme", "app", ""), "case does not matter");
        assert!(has_repo_with(remotes, "github.com", "me", "app", ""), "any remote counts");
        assert!(!has_repo_with(remotes, "github.com", "acme", "other", ""));
        assert!(!has_repo_with(remotes, "ghe.corp.example", "acme", "app", ""), "the host counts");
        assert!(!has_repo_with("", "github.com", "acme", "app", ""));
        // an ssh alias is the host it stands for (the page reads remotes the same way)
        let aliased = "remote.origin.url git@work-gh:acme/app.git\n";
        assert!(has_repo_with(aliased, "github.com", "acme", "app", "Host work-gh\n  HostName github.com\n"));
        assert!(!has_repo_with(aliased, "github.com", "acme", "app", ""));
        let issue = parse_issue(r#"{"number":34,"title":"Crash on save","url":"https://github.com/acme/app/issues/34"}"#).unwrap();
        assert_eq!((issue.number, issue.title.as_str()), (34, "Crash on save"));
        assert!(parse_issue("not json").unwrap_err().contains("cannot read"));
    }

    #[test]
    fn sess036_issues_and_pull_requests_are_offered_and_overlong_lookups_refused() {
        // recorded `gh issue list` / `gh pr list --json number,title,url` answers
        let issues = r#"[{"number":34,"title":"Crash on save","url":"https://github.com/acme/app/issues/34"}]"#;
        let prs = r#"[{"number":12,"title":"Fix the login page","url":"https://github.com/acme/app/pull/12"}]"#;
        let found = parse_found(issues, prs).unwrap();
        assert_eq!(found.iter().map(|f| (f.kind.as_str(), f.number, f.title.as_str())).collect::<Vec<_>>(), [("issue", 34, "Crash on save"), ("pull", 12, "Fix the login page")]);
        assert!(parse_found("[]", "nope").unwrap_err().contains("cannot read"));
        assert_eq!(lookup_refused(&"a".repeat(LOOKUP_MAX)), None);
        assert!(lookup_refused(&"a".repeat(LOOKUP_MAX + 1)).unwrap().contains("at most 256"));
        assert_eq!(lookup_refused(&"é".repeat(LOOKUP_MAX)), None, "characters, not bytes");
    }

    #[test]
    fn proj030_a_clashing_remote_name_gets_a_suffix() {
        let repo = temp("remote");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["remote", "add", "someone", "https://example.com/other.git"]);
        assert_eq!(remote_for(&repo, "Someone", "https://example.com/fork.git").unwrap(), "someone-2");
        // Asked again, the remote already pointing at the fork is reused, not a third made.
        assert_eq!(remote_for(&repo, "Someone", "https://example.com/fork.git").unwrap(), "someone-2");
        assert_eq!(remote_for(&repo, "fresh", "https://example.com/f.git").unwrap(), "fresh");
        assert_eq!(git_in(&repo, &["remote", "get-url", "someone"]), "https://example.com/other.git", "the old remote is untouched");
        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn proj030_a_local_pr_branch_is_reused_only_at_the_pr_head() {
        let git = Git::detect().unwrap();
        let remote = temp("origin");
        git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
        let repo = temp("repo");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["config", "user.email", "t@example.com"]);
        git_in(&repo, &["config", "user.name", "t"]);
        commit(&repo, "a.txt");
        let url = remote.to_string_lossy().to_string();
        git_in(&repo, &["remote", "add", "origin", &url]);
        git_in(&repo, &["push", "-q", "origin", "main"]);
        // The pull request's branch is on origin, one commit ahead of a local copy that lags.
        git_in(&repo, &["checkout", "-q", "-b", "feat/login"]);
        let old = commit(&repo, "b.txt");
        git_in(&repo, &["push", "-q", "origin", "feat/login"]);
        let tip = commit(&repo, "c.txt");
        git_in(&repo, &["push", "-q", "origin", "feat/login"]);
        git_in(&repo, &["reset", "-q", "--hard", &old]);
        git_in(&repo, &["checkout", "-q", "main"]);
        let root = temp("root");
        let project = Project { id: "p".into(), name: "repo".into(), path: repo.to_string_lossy().to_string(), workspaces_dir: None, base: None, display_name: None };
        let place = Place { root: root.clone(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
        let pr = PrHead { number: 12, title: "Fix the login page".into(), url: "https://github.com/t/r/pull/12".into(), head_ref_name: "feat/login".into(), head_ref_oid: tip.clone(), is_cross_repository: false, head_repository_owner: None, head_repository: None };
        // Lagging local branch: left alone, a new branch made at the head.
        let (made, reused) = open(&git, &place, &project, &pr, None, None, &|| false).unwrap();
        assert!(!reused);
        assert_eq!(made.worktree.branch.as_deref(), Some("feat/login-pr-12"));
        assert_eq!(git_in(Path::new(&made.worktree.path), &["rev-parse", "HEAD"]), tip);
        assert_eq!(git_in(&repo, &["rev-parse", "feat/login"]), old, "the lagging branch is not moved");
        assert_eq!(git_in(&repo, &["rev-parse", "--abbrev-ref", "feat/login-pr-12@{upstream}"]), "origin/feat/login");
        assert!(made.note.unwrap().contains("not at the pull request's head"));
        // A local branch at the head is reused as it is.
        git_in(&repo, &["branch", "-f", "feat/login", &tip]);
        let (again, reused) = open(&git, &place, &project, &pr, None, Some("second look"), &|| false).unwrap();
        assert!(reused);
        assert_eq!(again.worktree.branch.as_deref(), Some("feat/login"));
        assert!(again.worktree.path.ends_with("second-look"));
        // From a fork: the head comes through a remote named after the fork's owner.
        let fork = temp("fork");
        git_in(&fork, &["clone", "-q", "--bare", &url, "."]);
        let pr2 = PrHead { number: 13, head_ref_name: "feat/login".into(), head_ref_oid: tip.clone(), is_cross_repository: true, head_repository_owner: Some(Login { login: "someone".into() }), ..pr.clone() };
        git_in(&repo, &["remote", "add", "someone", "https://example.com/elsewhere.git"]);
        let fork_s = fork.to_string_lossy().to_string();
        git_in(&repo, &["worktree", "remove", "--force", &again.worktree.path]);
        git_in(&repo, &["branch", "-f", "feat/login", &old]);
        let (forked, _) = open(&git, &place, &project, &pr2, Some(&fork_s), None, &|| false).unwrap();
        assert_eq!(git_in(&repo, &["remote", "get-url", "someone-2"]), fork_s);
        assert_eq!(forked.worktree.branch.as_deref(), Some("feat/login-pr-13"));
        assert_eq!(git_in(&repo, &["rev-parse", "--abbrev-ref", "feat/login-pr-13@{upstream}"]), "someone-2/feat/login");
        // Overtaken after Git made it: the folder goes and so does the branch it made.
        let asked = std::cell::Cell::new(0);
        let late = || {
            asked.set(asked.get() + 1);
            asked.get() > 1
        };
        let pr3 = PrHead { number: 14, ..pr.clone() };
        assert_eq!(open(&git, &place, &project, &pr3, None, Some("gone"), &late).unwrap_err(), crate::projects::OVERTAKEN);
        assert!(sha(&repo, "refs/heads/feat/login-pr-14").is_none());
        for d in [remote, repo, root, fork] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn git010_a_branch_from_a_fork_pushes_to_the_fork_and_a_second_open_gets_a_fresh_ref() {
        let git = Git::detect().unwrap();
        let remote = temp("g10-origin");
        git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
        let fork = temp("g10-fork");
        git_in(&fork, &["init", "-q", "--bare", "-b", "main"]);
        let repo = temp("g10-repo");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["config", "user.email", "t@example.com"]);
        git_in(&repo, &["config", "user.name", "t"]);
        commit(&repo, "a.txt");
        let url = remote.to_string_lossy().to_string();
        git_in(&repo, &["remote", "add", "origin", &url]);
        git_in(&repo, &["push", "-q", "origin", "main"]);
        // The fork holds the pull request's branch, one commit ahead of main.
        git_in(&repo, &["checkout", "-q", "-b", "feat/login"]);
        let tip = commit(&repo, "b.txt");
        let fork_s = fork.to_string_lossy().to_string();
        git_in(&repo, &["push", "-q", &fork_s, "feat/login"]);
        git_in(&repo, &["checkout", "-q", "main"]);
        let root = temp("g10-root");
        let project = Project { id: "p".into(), name: "repo".into(), path: repo.to_string_lossy().to_string(), workspaces_dir: None, base: None, display_name: None };
        let place = Place { root: root.clone(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
        let pr = PrHead { number: 21, title: "Docs".into(), url: "https://github.com/t/r/pull/21".into(), head_ref_name: "feat/login".into(), head_ref_oid: tip.clone(), is_cross_repository: true, head_repository_owner: Some(Login { login: "someone".into() }), head_repository: None };
        // The local branch of that name exists already at the head: a fork's pull request still gets a fresh ref.
        git_in(&repo, &["branch", "-f", "feat/login", &tip]);
        let (first, reused) = open(&git, &place, &project, &pr, Some(&fork_s), None, &|| false).unwrap();
        assert!(!reused);
        assert_eq!(first.worktree.branch.as_deref(), Some("feat/login-pr-21"));
        let wt = Path::new(&first.worktree.path);
        assert_eq!(git_in(wt, &["config", "--get", "branch.feat/login-pr-21.pushRemote"]), "someone");
        let target = push_target(wt).unwrap();
        assert_eq!(target.remote, "someone");
        assert_eq!(target.branch, "feat/login-pr-21");
        assert_eq!(target.remote_branch, "feat/login");
        assert_eq!(target.fork.as_deref(), Some(fork_s.as_str()), "a non-GitHub address is named as it is");
        assert_eq!(scm_push_target(first.worktree.path.clone()).map(|t| t.remote), Some("someone".to_string()));
        // The push lands on the fork's branch, not on origin.
        let mine = commit(wt, "c.txt");
        let args = push_args(Some(&target), false);
        assert_eq!(args, vec!["push", "someone", "HEAD:refs/heads/feat/login"]);
        assert_eq!(push_args(Some(&target), true), vec!["push", "--force-with-lease", "someone", "HEAD:refs/heads/feat/login"]);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        git_in(wt, &refs);
        assert_eq!(git_in(&fork, &["rev-parse", "feat/login"]), mine);
        assert!(run(&["rev-parse", "--verify", "--quiet", "refs/heads/feat/login"], Some(&remote)).is_err(), "origin is untouched");
        // A second open of the same pull request: another fresh ref, never the first one.
        let (second, _) = open(&git, &place, &project, &pr, Some(&fork_s), Some("again"), &|| false).unwrap();
        assert_eq!(second.worktree.branch.as_deref(), Some("feat/login-pr-21-2"));
        // A branch on origin is no fork; the plain push is kept.
        git_in(&repo, &["branch", "--set-upstream-to=origin/main", "main"]);
        assert!(scm_push_target(repo.to_string_lossy().to_string()).is_none());
        let plain = push_target(&repo).unwrap();
        assert_eq!(plain.fork, None);
        assert_eq!(push_args(Some(&plain), false), vec!["push"]);
        assert_eq!(push_args(None, true), vec!["push", "--force-with-lease"]);
        for d in [remote, repo, root, fork] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn git010_the_fork_is_named_by_owner_and_name_when_the_address_is_github_shaped() {
        let repo = temp("g10-name");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["remote", "add", "origin", "https://github.com/acme/app.git"]);
        git_in(&repo, &["remote", "add", "someone", "https://github.com/someone/app-fork.git"]);
        git_in(&repo, &["config", "branch.main.remote", "someone"]);
        git_in(&repo, &["config", "branch.main.merge", "refs/heads/main"]);
        let t = push_target(&repo).unwrap();
        assert_eq!(t.fork.as_deref(), Some("someone/app-fork"));
        // The same repository under another remote name is not a fork.
        git_in(&repo, &["remote", "add", "mirror", "git@github.com:acme/app.git"]);
        git_in(&repo, &["config", "branch.main.remote", "mirror"]);
        assert_eq!(push_target(&repo).unwrap().fork, None);
        // A branch with no remote has no target.
        git_in(&repo, &["config", "--unset", "branch.main.remote"]);
        assert!(push_target(&repo).is_none());
        let _ = fs::remove_dir_all(repo);
    }
}
