//! Tasks' own GitHub reads (T-314): a repository's fork parent (GIT-055) and the people who can be
//! assigned, mentioned or asked for a review (GIT-053, GIT-054's people pickers). Every call goes
//! through gh, like the rest of Tasks (scm.rs).

use crate::scm::{gh_program, gh_run, gh_words};
use std::path::Path;

// T-232-c: the pull request page's reads and writes live in their own file, mounted here so lib.rs
// needs no new `mod` line (only the command names in its handler list: evidence/tasks-T-232-c-lib.patch).
#[allow(dead_code)] // until the handler list names the commands (the patch above)
#[path = "pull_requests.rs"]
pub(crate) mod pull_requests;

/// One person on a GitHub host, with their avatar address (empty when GitHub gave none, so the
/// page falls back to initials, which is also what GitHub Enterprise without avatars gets).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Person {
    pub login: String,
    pub avatar: String,
}

/// `owner/name` checked to plain GitHub names, and the host to a plain host name; anything else is
/// refused before gh sees it.
pub(crate) fn repo_path(host: &str, repo: &str) -> Result<String, String> {
    if !host_ok(host) {
        return Err("This repository's GitHub host cannot be read".into());
    }
    if !full_name_ok(repo) {
        return Err("This repository's name cannot be read".into());
    }
    Ok(format!("repos/{repo}"))
}

/// The owner/name rule: exactly two plain GitHub name parts (letters, digits, `-`, `_`, `.`, never
/// `.` or `..` alone). Used for what Kolux sends to gh and for what GitHub answers (FIX-1), so a
/// parent name can never break the `repo:owner/name` search it goes into.
pub fn full_name_ok(repo: &str) -> bool {
    let plain = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    matches!(repo.split_once('/'), Some((o, n)) if plain(o) && plain(n))
}

/// FIX-1: a GitHub login: letters and digits joined by single hyphens, no hyphen at either end
/// (github.com's rule); `_` is also allowed because GitHub Enterprise managed users carry an
/// `_shortcode` suffix. Nothing that could break the query's quoting (spaces, quotes, colons) passes.
pub fn login_ok(login: &str) -> bool {
    let b = login.as_bytes();
    !b.is_empty()
        && b.len() <= 39 + 1 + 39
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-' || *c == b'_')
        && b[0] != b'-'
        && b[b.len() - 1] != b'-'
        && !login.contains("--")
}

pub(crate) fn gh_json(gh: &Path, host: &str, path: &str, extra: &[&str]) -> Result<serde_json::Value, String> {
    host_allowed(gh, host)?;
    let args: Vec<&str> = ["api", path, "--hostname", host].into_iter().chain(extra.iter().copied()).collect();
    let text = gh_run(gh, &std::env::temp_dir(), &args, None).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// GIT-055: the parent (`owner/name`) of a fork, from GitHub's repository record; None when the
/// repository is not a fork or its parent is gone.
pub fn parent_of(v: &serde_json::Value) -> Option<String> {
    if v["fork"].as_bool() != Some(true) {
        return None;
    }
    v["parent"]["full_name"].as_str().filter(|s| full_name_ok(s)).map(String::from)
}

/// GIT-055: the fork parent of `repo` on `host`.
pub fn repo_parent(gh: &Path, host: &str, repo: &str) -> Result<Option<String>, String> {
    Ok(parent_of(&gh_json(gh, host, &repo_path(host, repo)?, &[])?))
}

/// T-232-d (GIT-060): a repository and, when it is a fork, its parent: a fork knows its own owner and
/// its parent's. `parent` is `owner/name`; `parent_owner` is the owner part (the login GitHub reports,
/// else the part of the name before the slash).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lineage {
    pub owner: String,
    pub name: String,
    pub fork: bool,
    pub parent: Option<String>,
    pub parent_owner: Option<String>,
}

/// GIT-060: the lineage from GitHub's repository record (the same record the parent read uses, so one call
/// gives both owners). A name outside the owner/name rule is dropped, like the parent read.
pub fn lineage_of(v: &serde_json::Value) -> Option<Lineage> {
    let full = v["full_name"].as_str().filter(|s| full_name_ok(s))?;
    let (owner, name) = full.split_once('/')?;
    let parent = parent_of(v);
    let parent_owner = parent.as_deref().and_then(|p| {
        let from_name = p.split_once('/').map(|(o, _)| o.to_string());
        match v["parent"]["owner"]["login"].as_str().filter(|l| login_ok(l)) {
            Some(l) if from_name.as_deref().is_some_and(|o| o.eq_ignore_ascii_case(l)) => Some(l.to_string()),
            _ => from_name,
        }
    });
    Some(Lineage { owner: owner.to_string(), name: name.to_string(), fork: v["fork"].as_bool() == Some(true), parent, parent_owner })
}

/// GIT-060: the lineage of `repo` on `host`.
pub fn repo_lineage(gh: &Path, host: &str, repo: &str) -> Result<Lineage, String> {
    lineage_of(&gh_json(gh, host, &repo_path(host, repo)?, &[])?).ok_or_else(|| "GitHub did not describe this repository.".to_string())
}

#[tauri::command]
pub async fn github_repo_lineage(host: String, repo: String) -> Result<Lineage, String> {
    tauri::async_runtime::spawn_blocking(move || repo_lineage(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

/// GIT-053: people from a GitHub user list, each once, in GitHub's order.
pub fn people_of(v: &serde_json::Value) -> Vec<Person> {
    let mut out: Vec<Person> = Vec::new();
    for u in v.as_array().into_iter().flatten() {
        let Some(login) = u["login"].as_str().filter(|l| login_ok(l)) else { continue };
        if out.iter().all(|p| !p.login.eq_ignore_ascii_case(login)) {
            let avatar = u["avatar_url"].as_str().filter(|a| a.starts_with("https://")).unwrap_or("");
            out.push(Person { login: login.into(), avatar: avatar.into() });
        }
    }
    out
}

/// GIT-053: an avatar is shown only from the GitHub host's own avatar addresses (avatars.githubusercontent.com
/// for github.com; the host itself or its avatars. subdomain for GitHub Enterprise); anything else
/// falls back to initials, so a repository's people list cannot make the page load other sites.
pub fn avatar_ok(url: &str, host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let mut allowed = vec![format!("https://{host}/"), format!("https://avatars.{host}/")];
    if host == "github.com" {
        allowed.push("https://avatars.githubusercontent.com/".into());
    }
    let url = url.to_ascii_lowercase();
    allowed.iter().any(|a| url.starts_with(a.as_str()))
}

/// GIT-053: the people who can be assigned in `repo` (GitHub's assignees list, first 100), which
/// is who the mention, assignee and reviewer pickers offer.
// ponytail: one page of 100; recent editors of a PR's files join the reviewer list with T-232-c.
pub fn repo_people(gh: &Path, host: &str, repo: &str) -> Result<Vec<Person>, String> {
    let path = format!("{}/assignees", repo_path(host, repo)?);
    let mut people = people_of(&gh_json(gh, host, &path, &["-X", "GET", "-f", "per_page=100"])?);
    for p in &mut people {
        if !avatar_ok(&p.avatar, host) {
            p.avatar.clear();
        }
    }
    Ok(people)
}

#[tauri::command]
pub async fn github_repo_parent(host: String, repo: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || repo_parent(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_people(host: String, repo: String) -> Result<Vec<Person>, String> {
    tauri::async_runtime::spawn_blocking(move || repo_people(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

// ---- T-314-c: GitHub Projects as an editable table (GIT-056) and the roadmap views (GIT-057) ----
// Projects (v2) are read and edited only through GitHub's GraphQL API, sent to gh as a JSON body on
// standard input (`gh api graphql --input -`), so no query text ever goes through a command line.

/// A plain host name: what `repo_path` and every GraphQL call check before gh sees it.
pub(crate) fn host_ok(host: &str) -> bool {
    !host.is_empty() && !host.starts_with('-') && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
}

/// FIX-1 (council FB 1): the one gate in front of every gh call this file makes. Kolux talks only to
/// github.com, to the host GH_HOST names, or to a host gh is signed in to (gh keeps a user for it in
/// its own config: `gh config get -h <host> user`, which reads gh's config and goes nowhere). Any
/// other host, from a pasted project address or from a repository's remote, is refused before gh
/// runs, so gh never sends an Enterprise token or even a bare request to it.
pub(crate) fn host_allowed(gh: &Path, host: &str) -> Result<(), String> {
    host_allowed_with(gh, host, std::env::var("GH_HOST").ok().as_deref())
}

/// How long one `gh config get` may take (it reads gh's own config files and goes nowhere).
const GH_CONFIG_LIMIT: std::time::Duration = std::time::Duration::from_secs(5);

pub(crate) fn host_allowed_with(gh: &Path, host: &str, gh_host: Option<&str>) -> Result<(), String> {
    host_allowed_within(gh, host, gh_host, GH_CONFIG_LIMIT)
}

fn host_allowed_within(gh: &Path, host: &str, gh_host: Option<&str>, limit: std::time::Duration) -> Result<(), String> {
    host_allowed_reading(gh, host, gh_host, &|args| gh_config(gh, args, limit))
}

/// The gate with the `gh config get` reader handed in, so a test can make a read fail.
pub(crate) fn host_allowed_reading(gh: &Path, host: &str, gh_host: Option<&str>, read: &dyn Fn(&[&str]) -> ConfigRead) -> Result<(), String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    if !host_ok(host) {
        return Err("This repository's GitHub host cannot be read".into());
    }
    let h = host.to_ascii_lowercase();
    if h == "github.com" || gh_host.is_some_and(|g| g.trim().eq_ignore_ascii_case(&h)) {
        return Ok(());
    }
    // FIX-2 (council AFTER 4): a host found signed in stays allowed for a minute, so a gh auth
    // logout takes effect soon; a refusal is asked again next time, so signing in needs no restart.
    static SIGNED_IN: OnceLock<Mutex<HashMap<(std::path::PathBuf, String), Instant>>> = OnceLock::new();
    const KEEP: Duration = Duration::from_secs(60);
    let known = SIGNED_IN.get_or_init(Default::default);
    let key = (gh.to_path_buf(), h.clone());
    if known.lock().map(|k| k.get(&key).is_some_and(|t| t.elapsed() < KEEP)).unwrap_or(false) {
        return Ok(());
    }
    // FIX-2 (council FS 3): gh answers `config get -h <host> user` with the top-level user when
    // the host has none of its own, so an answer equal to plain `config get user` is no sign-in.
    // A host whose own user is the same login as the top-level one is refused too (safe side).
    // FIX-3 (reliability review FIX-SOON 6): a read that fails or times out is no answer, and no
    // answer refuses the host (it is never taken for "gh has no top-level user", which would sign
    // in a host that has none of its own). Only a refusal that gh really gave is the plain one.
    let cannot_check = || Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them (gh did not answer its config read; try again in a moment)."));
    match read(&["config", "get", "-h", &h, "user"]) {
        ConfigRead::Value(user) => match read(&["config", "get", "user"]) {
            ConfigRead::Value(top) if top == user => {
                // FIX-3 (review AFTER 2): name the real reason; gh gives every host the top-level user.
                return Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them: the user gh reports for it is gh's top-level `user` setting, which every host falls back to (gh auth login --hostname {h} signs in)."));
            }
            ConfigRead::Value(_) | ConfigRead::Unset => {}
            ConfigRead::Failed => return cannot_check(),
        },
        ConfigRead::Unset => {
            return Err(format!("Kolux only talks to GitHub hosts gh is signed in to, and {h} is not one of them (gh auth login --hostname {h} signs in)."));
        }
        ConfigRead::Failed => return cannot_check(),
    }
    if let Ok(mut k) = known.lock() {
        k.insert(key, Instant::now());
    }
    Ok(())
}

/// What one `gh config get` came to.
pub(crate) enum ConfigRead {
    Value(String),
    Unset,
    Failed,
}

/// FIX-3 / FIX-4: one `gh config get` through the bounded runner in scm.rs, which ends the whole
/// process tree gh started at the limit (never only gh itself). A read that cannot run or does not
/// answer in time is `Failed`; so is a non-zero exit that is not gh's "could not find key" answer.
fn gh_config(gh: &Path, args: &[&str], limit: std::time::Duration) -> ConfigRead {
    match crate::scm::gh_config_within(gh, args, limit) {
        Ok(r) => config_read(r.ok, &r.out, &r.err),
        Err(_) => ConfigRead::Failed,
    }
}

/// FIX-4 (council FIX-SOON 1): what one finished read means. Exit 0 with a value is the value, exit
/// 0 with nothing is "not set" (an older gh prints nothing for a key that is not set). A non-zero
/// exit is "not set" only when gh's own error says it could not find the key (the text gh's config
/// library gives; an unexpected wording fails closed to `Failed`, which refuses the host). Any other
/// non-zero exit (a config file being rewritten, a lock, a shim error) is no answer, never "no
/// top-level user", which would sign in a host that has none of its own.
/// FIX-5 (council AFTER 1-2) and FIX-6: only gh's quoted `could not find key "` counts (a wider "key not found" also matches
/// a wrapper's own error), and a value of more than one line is no answer: a login is one line, and
/// two reads that differ only in an extra line must not compare unequal and let a host through.
fn config_read(ok: bool, out: &str, err: &str) -> ConfigRead {
    if ok {
        return if out.is_empty() {
            ConfigRead::Unset
        } else if out.contains('\n') || out.contains('\r') {
            ConfigRead::Failed
        } else {
            ConfigRead::Value(out.to_string())
        };
    }
    // FIX-6 (council FIX-SOON 2): the quoted form, in gh's own case; a bare prefix also matched
    // "could not find keyring entry" from a wrapper or credential helper.
    if err.contains("could not find key \"") { ConfigRead::Unset } else { ConfigRead::Failed }
}

/// A GraphQL node id as GitHub gives them (letters, digits, `_`, `-`, `=`), so an id from the page
/// can never change the request it goes into.
pub fn node_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '=')
}

/// FIX-1 (council FS 4): one browse answer: the 30 most recently changed projects, and
/// whether the owner has more than that, so the page can say the list stops there.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct ProjectList {
    pub projects: Vec<ProjectRef>,
    pub more: bool,
}

/// One project in a picker list (GIT-056: browsing an owner's projects).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub closed: bool,
    pub url: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub number: u64,
    pub name: String,
    /// "table", "board" or "roadmap" (GitHub's layout without the `_LAYOUT` suffix, lower case).
    pub layout: String,
}

/// A single-select option or an iteration (`start` and `days` only for iterations).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldOption {
    pub id: String,
    pub name: String,
    pub start: String,
    pub days: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectField {
    pub id: String,
    pub name: String,
    /// GitHub's data type in lower case: text, number, date, single_select, iteration (editable here),
    /// title, assignees, labels, repository, milestone and the rest (read-only columns).
    pub kind: String,
    pub options: Vec<FieldOption>,
}

/// One cell: `text` is what shows (a date as YYYY-MM-DD), `id` the option or iteration id, and a
/// date's or an iteration's `start` (with an iteration's `days`) places it on a roadmap (GIT-057).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub text: String,
    pub id: String,
    pub start: String,
    pub days: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    pub id: String,
    /// issue, pr, draft, or restricted (an item the user cannot see: GitHub's REDACTED).
    pub kind: String,
    pub title: String,
    pub number: Option<u64>,
    pub url: String,
    pub repo: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    /// T-314-d: an issue's own type (Bug, Task, ...); empty for pull requests and issues without one.
    pub issue_type: String,
    /// Field id to cell, for the fields that have a value on this item.
    pub values: std::collections::BTreeMap<String, Cell>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub closed: bool,
    pub views: Vec<ProjectView>,
    pub fields: Vec<ProjectField>,
    pub items: Vec<ProjectItem>,
    /// True when the project holds more items than Kolux read (PROJECT_PAGES pages of 100).
    pub more: bool,
}

const PROJECT_PAGES: usize = 5;
/// Longest issue type name Kolux reads or sends (GitHub's own names are far shorter).
const ISSUE_TYPE_MAX: usize = 100;

const PROJECT_QUERY: &str = "query($owner:String!,$number:Int!,$after:String){repositoryOwner(login:$owner){login ...on Organization{projectV2(number:$number){...P}} ...on User{projectV2(number:$number){...P}}}} \
fragment P on ProjectV2{id title url number closed views(first:30){nodes{number name layout}} \
fields(first:50){nodes{...on ProjectV2Field{id name dataType} ...on ProjectV2IterationField{id name dataType configuration{iterations{id title startDate duration} completedIterations{id title startDate duration}}} ...on ProjectV2SingleSelectField{id name dataType options{id name}}}} \
items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id type content{__typename ...on DraftIssue{title} \
...on Issue{number title url state issueType{name} repository{nameWithOwner} labels(first:20){nodes{name}} assignees(first:10){nodes{login}}} \
...on PullRequest{number title url state repository{nameWithOwner} labels(first:20){nodes{name}} assignees(first:10){nodes{login}}}} \
fieldValues(first:50){nodes{__typename ...on ProjectV2ItemFieldTextValue{text field{...F}} ...on ProjectV2ItemFieldNumberValue{number field{...F}} \
...on ProjectV2ItemFieldDateValue{date field{...F}} ...on ProjectV2ItemFieldSingleSelectValue{name optionId field{...F}} \
...on ProjectV2ItemFieldIterationValue{title iterationId startDate duration field{...F}}}}}}} \
fragment F on ProjectV2FieldConfiguration{...on ProjectV2FieldCommon{id}}";

const PROJECTS_OF_OWNER: &str = "query($owner:String!){repositoryOwner(login:$owner){login ...on Organization{projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage} nodes{number title closed url}}} ...on User{projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage} nodes{number title closed url}}}}}";
const PROJECTS_OF_VIEWER: &str = "query{viewer{login projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage} nodes{number title closed url}}}}";
const SET_FIELD: &str = "mutation($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){projectV2Item{id}}}";
const CLEAR_FIELD: &str = "mutation($project:ID!,$item:ID!,$field:ID!){clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}){projectV2Item{id}}}";

/// One GraphQL request through gh; the answer's `data`.
fn graphql(gh: &Path, host: &str, query: &str, variables: serde_json::Value) -> Result<serde_json::Value, String> {
    host_allowed(gh, host)?;
    let body = serde_json::json!({ "query": query, "variables": variables }).to_string();
    let text = gh_run(gh, &std::env::temp_dir(), &["api", "graphql", "--hostname", host, "--input", "-"], Some(&body)).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    Ok(v["data"].clone())
}

pub(crate) fn s(v: &serde_json::Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn names(v: &serde_json::Value, key: &str) -> Vec<String> {
    v["nodes"].as_array().into_iter().flatten().filter_map(|n| n[key].as_str()).map(String::from).collect()
}

/// GIT-056: a project's header, views and fields from one answer page.
pub fn project_of(owner: &str, p: &serde_json::Value) -> Option<Project> {
    let id = p["id"].as_str().filter(|i| node_id_ok(i))?;
    let views = p["views"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            let layout = v["layout"].as_str()?.trim_end_matches("_LAYOUT").to_ascii_lowercase();
            Some(ProjectView { number: v["number"].as_u64()?, name: s(&v["name"]), layout })
        })
        .collect();
    let fields = p["fields"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let id = f["id"].as_str().filter(|i| node_id_ok(i))?;
            let mut options: Vec<FieldOption> = f["options"].as_array().into_iter().flatten().map(|o| FieldOption { id: s(&o["id"]), name: s(&o["name"]), ..Default::default() }).collect();
            for key in ["iterations", "completedIterations"] {
                for it in f["configuration"][key].as_array().into_iter().flatten() {
                    options.push(FieldOption { id: s(&it["id"]), name: s(&it["title"]), start: s(&it["startDate"]), days: it["duration"].as_u64().unwrap_or(0) });
                }
            }
            options.retain(|o| node_id_ok(&o.id));
            Some(ProjectField { id: id.into(), name: s(&f["name"]), kind: s(&f["dataType"]).to_ascii_lowercase(), options })
        })
        .collect();
    Some(Project {
        id: id.into(),
        owner: owner.into(),
        number: p["number"].as_u64().unwrap_or(0),
        title: s(&p["title"]),
        url: s(&p["url"]),
        closed: p["closed"].as_bool().unwrap_or(false),
        views,
        fields,
        items: Vec::new(),
        more: false,
    })
}

/// GIT-056: the items of one answer page. An item whose content GitHub withholds is "restricted":
/// it keeps its row but shows no title, link or values.
pub fn items_of(p: &serde_json::Value) -> Vec<ProjectItem> {
    let mut out = Vec::new();
    for n in p["items"]["nodes"].as_array().into_iter().flatten() {
        let Some(id) = n["id"].as_str().filter(|i| node_id_ok(i)) else { continue };
        let c = &n["content"];
        let kind = match (n["type"].as_str(), c["__typename"].as_str()) {
            (Some("ISSUE"), Some("Issue")) => "issue",
            (Some("PULL_REQUEST"), Some("PullRequest")) => "pr",
            (Some("DRAFT_ISSUE"), Some("DraftIssue")) => "draft",
            _ => "restricted",
        };
        let mut item = ProjectItem { id: id.into(), kind: kind.into(), ..Default::default() };
        if kind != "restricted" {
            item.title = s(&c["title"]);
            item.number = c["number"].as_u64();
            item.url = s(&c["url"]);
            if !item.url.starts_with("https://") {
                item.url.clear();
            }
            item.repo = c["repository"]["nameWithOwner"].as_str().filter(|r| full_name_ok(r)).unwrap_or("").into();
            item.state = s(&c["state"]).to_ascii_lowercase();
            item.labels = names(&c["labels"], "name");
            item.assignees = names(&c["assignees"], "login").into_iter().filter(|l| login_ok(l)).collect();
            item.issue_type = s(&c["issueType"]["name"]).chars().filter(|ch| !ch.is_control()).take(ISSUE_TYPE_MAX).collect();
            for v in n["fieldValues"]["nodes"].as_array().into_iter().flatten() {
                let Some(field) = v["field"]["id"].as_str() else { continue };
                let cell = match v["__typename"].as_str().unwrap_or("") {
                    "ProjectV2ItemFieldTextValue" => Cell { text: s(&v["text"]), ..Default::default() },
                    "ProjectV2ItemFieldNumberValue" => Cell { text: v["number"].as_f64().map(|x| x.to_string()).unwrap_or_default(), ..Default::default() },
                    "ProjectV2ItemFieldDateValue" => {
                        let d: String = s(&v["date"]).chars().take(10).collect();
                        Cell { start: d.clone(), text: d, ..Default::default() }
                    }
                    "ProjectV2ItemFieldSingleSelectValue" => Cell { text: s(&v["name"]), id: s(&v["optionId"]), ..Default::default() },
                    "ProjectV2ItemFieldIterationValue" => Cell { text: s(&v["title"]), id: s(&v["iterationId"]), start: s(&v["startDate"]), days: v["duration"].as_u64().unwrap_or(0) },
                    _ => continue,
                };
                item.values.insert(field.into(), cell);
            }
        }
        out.push(item);
    }
    out
}

/// GIT-056: project `number` of `owner` (an organization or a user) with its views, fields and up to
/// PROJECT_PAGES pages of items.
pub fn read_project(gh: &Path, host: &str, owner: &str, number: u64) -> Result<Project, String> {
    if !login_ok(owner) || number == 0 {
        return Err("That project owner or number cannot be read".into());
    }
    let mut after: Option<String> = None;
    let mut project: Option<Project> = None;
    for _ in 0..PROJECT_PAGES {
        let data = graphql(gh, host, PROJECT_QUERY, serde_json::json!({ "owner": owner, "number": number, "after": after }))?;
        let p = &data["repositoryOwner"]["projectV2"];
        if project.is_none() {
            project = Some(project_of(owner, p).ok_or_else(|| format!("{host} has no project {number} for {owner}, or this account cannot see it"))?);
        }
        let Some(page) = project.as_mut() else { break };
        page.items.extend(items_of(p));
        let info = &p["items"]["pageInfo"];
        page.more = info["hasNextPage"].as_bool().unwrap_or(false);
        match info["endCursor"].as_str() {
            Some(c) if page.more => after = Some(c.into()),
            _ => break,
        }
    }
    project.ok_or_else(|| "GitHub gave no project".into())
}

/// GIT-056 browsing: an owner's projects, newest change first; `@me` lists the signed-in account's.
pub fn list_projects(gh: &Path, host: &str, owner: &str) -> Result<ProjectList, String> {
    let holder = if owner == "@me" {
        graphql(gh, host, PROJECTS_OF_VIEWER, serde_json::json!({}))?["viewer"].clone()
    } else if login_ok(owner) {
        graphql(gh, host, PROJECTS_OF_OWNER, serde_json::json!({ "owner": owner }))?["repositoryOwner"].clone()
    } else {
        return Err("That project owner cannot be read".into());
    };
    let login = holder["login"].as_str().filter(|l| login_ok(l)).ok_or_else(|| format!("{host} has no account or organization called {owner}"))?;
    let projects = holder["projectsV2"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some(ProjectRef { owner: login.into(), number: p["number"].as_u64()?, title: s(&p["title"]), closed: p["closed"].as_bool().unwrap_or(false), url: s(&p["url"]) }))
        .collect();
    Ok(ProjectList { projects, more: holder["projectsV2"]["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) })
}

/// GIT-056: the GraphQL value for one edited cell; None for an empty value (the cell is cleared).
pub fn field_value(kind: &str, value: &str) -> Result<Option<serde_json::Value>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let date_ok = |d: &str| d.len() == 10 && d.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    Ok(Some(match kind {
        "text" => serde_json::json!({ "text": value }),
        "number" => match value.parse::<f64>() {
            Ok(n) if n.is_finite() => serde_json::json!({ "number": n }),
            _ => return Err(format!("{value} is not a number")),
        },
        "date" if date_ok(value) => serde_json::json!({ "date": value }),
        "date" => return Err(format!("{value} is not a date (year-month-day)")),
        "single_select" if node_id_ok(value) => serde_json::json!({ "singleSelectOptionId": value }),
        "iteration" if node_id_ok(value) => serde_json::json!({ "iterationId": value }),
        _ => return Err("This column cannot be edited here".into()),
    }))
}

/// GIT-056: write one cell to GitHub (or clear it when `value` is empty).
pub fn set_project_field(gh: &Path, host: &str, project: &str, item: &str, field: &str, kind: &str, value: &str) -> Result<(), String> {
    if ![project, item, field].iter().all(|i| node_id_ok(i)) {
        return Err("That project cell cannot be edited".into());
    }
    let mut vars = serde_json::json!({ "project": project, "item": item, "field": field });
    match field_value(kind, value)? {
        Some(v) => {
            vars["value"] = v;
            graphql(gh, host, SET_FIELD, vars)?;
        }
        None => {
            graphql(gh, host, CLEAR_FIELD, vars)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn github_project(host: String, owner: String, number: u64) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || read_project(&gh_program()?, &host, &owner, number)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_projects(host: String, owner: String) -> Result<ProjectList, String> {
    tauri::async_runtime::spawn_blocking(move || list_projects(&gh_program()?, &host, &owner)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_project_set(host: String, project: String, item: String, field: String, kind: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_project_field(&gh_program()?, &host, &project, &item, &field, &kind, &value)).await.map_err(|e| e.to_string())?
}

// GIT-047: close an issue (as completed, not planned, or a duplicate of another number), reopen it,
// comment on it. Everything goes through GraphQL with the request on standard input, so neither a
// comment nor a number can reach a command line. A duplicate target is checked before anything is
// sent: it must exist in the same repository, be an issue and not the issue itself.

const ISSUE_ID: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issueOrPullRequest(number:$number){__typename ... on Issue{id state}}}}";
const CLOSE_ISSUE: &str = "mutation($id:ID!,$reason:IssueClosedStateReason!,$dup:ID){closeIssue(input:{issueId:$id,stateReason:$reason,duplicateIssueId:$dup}){issue{state}}}";
const REOPEN_ISSUE: &str = "mutation($id:ID!){reopenIssue(input:{issueId:$id}){issue{state}}}";
const ADD_COMMENT: &str = "mutation($id:ID!,$body:String!){addComment(input:{subjectId:$id,body:$body}){clientMutationId}}";

/// GitHub's own limit on a comment's length.
pub const COMMENT_MAX: usize = 65_536;

/// FIX-2 (council A3): what a failed issue lookup says. GitHub answers a missing repository with
/// "Could not resolve to a Repository" and a missing number with "Could not resolve to an issue or
/// pull request"; both carry NOT_FOUND, so the repository case is told apart first.
fn lookup_error(e: String, number: u64, repo: &str) -> String {
    if e.contains("Could not resolve to a Repository") {
        format!("There is no repository {repo} on this GitHub host, or your gh account cannot see it.")
    } else if e.contains("NOT_FOUND") || e.contains("Could not resolve") {
        format!("There is no issue #{number} in {repo}.")
    } else {
        e
    }
}

/// The node id of issue `number` in `repo`, or a plain message when there is no such issue.
fn issue_id(gh: &Path, host: &str, repo: &str, number: u64) -> Result<String, String> {
    repo_path(host, repo)?;
    let (owner, name) = repo.split_once('/').unwrap_or_default();
    let missing = || format!("There is no issue #{number} in {repo}.");
    let data = graphql(gh, host, ISSUE_ID, serde_json::json!({ "owner": owner, "name": name, "number": number })).map_err(|e| lookup_error(e, number, repo))?;
    let node = &data["repository"]["issueOrPullRequest"];
    match node["__typename"].as_str() {
        Some("Issue") => Some(s(&node["id"])).filter(|id| node_id_ok(id)).ok_or_else(missing),
        Some("PullRequest") => Err(format!("#{number} in {repo} is a pull request, not an issue.")),
        _ => Err(missing()),
    }
}

/// GIT-047: close (`open` false, with `reason` completed / not_planned / duplicate) or reopen an
/// issue; answers its new state as the list shows it ("open" or "closed").
pub fn set_issue_state(gh: &Path, host: &str, repo: &str, number: u64, open: bool, reason: &str, duplicate_of: Option<u64>) -> Result<String, String> {
    let reason = match (open, reason) {
        (true, _) => "",
        (false, "completed") => "COMPLETED",
        (false, "not_planned") => "NOT_PLANNED",
        (false, "duplicate") => "DUPLICATE",
        _ => return Err("Choose why the issue is closed: completed, not planned or duplicate.".into()),
    };
    let dup = match (reason, duplicate_of) {
        ("DUPLICATE", None | Some(0)) => return Err("Give the number of the issue this one duplicates.".into()),
        ("DUPLICATE", Some(d)) if d == number => return Err("An issue cannot be a duplicate of itself.".into()),
        ("DUPLICATE", Some(d)) => Some(issue_id(gh, host, repo, d)?),
        _ => None,
    };
    let id = issue_id(gh, host, repo, number)?;
    let data = if open {
        graphql(gh, host, REOPEN_ISSUE, serde_json::json!({ "id": id }))?["reopenIssue"].clone()
    } else {
        graphql(gh, host, CLOSE_ISSUE, serde_json::json!({ "id": id, "reason": reason, "dup": dup }))?["closeIssue"].clone()
    };
    let st = s(&data["issue"]["state"]).to_lowercase();
    Ok(if !st.is_empty() { st } else if open { "open".into() } else { "closed".into() })
}

/// GIT-047: post a comment on an issue.
pub fn comment_issue(gh: &Path, host: &str, repo: &str, number: u64, body: &str) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("Write a comment first.".into());
    }
    if body.chars().count() > COMMENT_MAX {
        return Err(format!("A comment can be at most {COMMENT_MAX} characters."));
    }
    let id = issue_id(gh, host, repo, number)?;
    graphql(gh, host, ADD_COMMENT, serde_json::json!({ "id": id, "body": body })).map(|_| ())
}

/// T-231-d (GIT-046): the issue GitHub opened.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct CreatedIssue {
    pub number: u64,
    pub url: String,
    pub title: String,
}

/// GIT-046: open an issue in `repo` with its labels and assignees in one REST call; the title and
/// text go to gh on stdin, never on its command line.
pub fn create_issue(gh: &Path, host: &str, repo: &str, title: &str, body: &str, labels: &[String], assignees: &[String]) -> Result<CreatedIssue, String> {
    let path = format!("{}/issues", repo_path(host, repo)?);
    let title = title.trim();
    if title.is_empty() {
        return Err("Give the issue a title first.".into());
    }
    if body.chars().count() > COMMENT_MAX {
        return Err(format!("An issue's description can be at most {COMMENT_MAX} characters."));
    }
    if let Some(bad) = assignees.iter().find(|a| !login_ok(a)) {
        return Err(format!("{bad} is not a GitHub login."));
    }
    if labels.iter().any(|l| l.trim().is_empty()) {
        return Err("A label needs a name.".into());
    }
    host_allowed(gh, host)?;
    let input = serde_json::json!({ "title": title, "body": body, "labels": labels, "assignees": assignees }).to_string();
    let text = gh_run(gh, &std::env::temp_dir(), &["api", "-X", "POST", &path, "--hostname", host, "--input", "-"], Some(&input)).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    match v["number"].as_u64() {
        Some(number) if number > 0 => Ok(CreatedIssue { number, url: s(&v["html_url"]), title: s(&v["title"]) }),
        _ => Err("GitHub did not say which issue it opened; refresh the list to see whether it is there.".into()),
    }
}

#[tauri::command]
pub async fn github_issue_create(host: String, repo: String, title: String, body: String, labels: Vec<String>, assignees: Vec<String>) -> Result<CreatedIssue, String> {
    tauri::async_runtime::spawn_blocking(move || create_issue(&gh_program()?, &host, &repo, &title, &body, &labels, &assignees)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_issue_state(host: String, repo: String, number: u64, open: bool, reason: String, duplicate_of: Option<u64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || set_issue_state(&gh_program()?, &host, &repo, number, open, &reason, duplicate_of)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_issue_comment(host: String, repo: String, number: u64, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || comment_issue(&gh_program()?, &host, &repo, number, &body)).await.map_err(|e| e.to_string())?
}

// T-314-d (GIT-056): the issue's own type in the Projects table. The types a repository offers come
// from GraphQL; the change goes to the issue's REST update with the name on standard input, and an
// empty name clears the type.

const ISSUE_TYPES: &str = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issueTypes(first:50){nodes{name}}}}";

/// The issue types `repo` offers (empty when its owner has none).
pub fn issue_types(gh: &Path, host: &str, repo: &str) -> Result<Vec<String>, String> {
    repo_path(host, repo)?;
    let (owner, name) = repo.split_once('/').unwrap_or_default();
    let data = graphql(gh, host, ISSUE_TYPES, serde_json::json!({ "owner": owner, "name": name }))?;
    Ok(names(&data["repository"]["issueTypes"], "name").into_iter().filter(|n| !n.is_empty() && n.chars().count() <= ISSUE_TYPE_MAX).collect())
}

/// Set (or, with an empty `name`, clear) issue `number`'s type; answers the type GitHub now shows.
pub fn set_issue_type(gh: &Path, host: &str, repo: &str, number: u64, name: &str) -> Result<String, String> {
    let path = format!("{}/issues/{number}", repo_path(host, repo)?);
    let name = name.trim();
    if number == 0 || name.chars().count() > ISSUE_TYPE_MAX || name.chars().any(|c| c.is_control()) {
        return Err("That issue type cannot be set".into());
    }
    host_allowed(gh, host)?;
    let input = serde_json::json!({ "type": if name.is_empty() { serde_json::Value::Null } else { name.into() } }).to_string();
    let text = gh_run(gh, &std::env::temp_dir(), &["api", "-X", "PATCH", &path, "--hostname", host, "--input", "-"], Some(&input)).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    Ok(s(&v["type"]["name"]))
}

#[tauri::command]
pub async fn github_issue_types(host: String, repo: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || issue_types(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_issue_type_set(host: String, repo: String, number: u64, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || set_issue_type(&gh_program()?, &host, &repo, number, &name)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn a_fork_names_its_parent_and_a_plain_repository_has_none() {
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": "up/stream"}})), Some("up/stream".into()));
        assert_eq!(parent_of(&json!({"fork": false, "parent": {"full_name": "up/stream"}})), None);
        assert_eq!(parent_of(&json!({"fork": true})), None, "a fork whose parent is gone has no parent");
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": ""}})), None);
    }

    #[test]
    fn a_fork_knows_its_own_owner_and_its_parents() {
        let fork = json!({"full_name": "me/app", "fork": true, "parent": {"full_name": "Up/stream", "owner": {"login": "Up"}}});
        let l = lineage_of(&fork).unwrap();
        assert_eq!((l.owner.as_str(), l.name.as_str(), l.fork), ("me", "app", true));
        assert_eq!((l.parent.as_deref(), l.parent_owner.as_deref()), (Some("Up/stream"), Some("Up")));
        // the owner comes from the name when the record has no owner object, and a mismatching login is not trusted
        let bare = json!({"full_name": "me/app", "fork": true, "parent": {"full_name": "up/stream"}});
        assert_eq!(lineage_of(&bare).unwrap().parent_owner.as_deref(), Some("up"));
        let odd = json!({"full_name": "me/app", "fork": true, "parent": {"full_name": "up/stream", "owner": {"login": "other"}}});
        assert_eq!(lineage_of(&odd).unwrap().parent_owner.as_deref(), Some("up"));
        let plain = lineage_of(&json!({"full_name": "me/app", "fork": false})).unwrap();
        assert_eq!((plain.fork, plain.parent, plain.parent_owner), (false, None, None));
        let gone = lineage_of(&json!({"full_name": "me/app", "fork": true})).unwrap();
        assert_eq!((gone.fork, gone.parent_owner), (true, None), "a fork whose parent is gone knows only itself");
        assert!(lineage_of(&json!({"full_name": "bad name", "fork": true})).is_none());
        assert!(lineage_of(&json!({})).is_none());
    }

    #[test]
    fn the_lineage_read_is_one_call_for_the_repository_record() {
        let dir = crate::test_dir::temp("gh-lineage");
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho {\"full_name\":\"me/app\",\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}\r\nexit /b 0\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\necho '{\"full_name\":\"me/app\",\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}'\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        let l = repo_lineage(&gh, "github.com", "me/app").unwrap();
        assert_eq!((l.owner.as_str(), l.parent_owner.as_deref()), ("me", Some("up")));
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert_eq!(calls.lines().count(), 1, "{calls}");
        assert!(calls.contains("api repos/me/app --hostname github.com"), "{calls}");
        assert!(repo_lineage(&gh, "github.com", "bad").is_err());
    }

    #[test]
    fn a_parent_name_outside_the_owner_name_rule_is_dropped() {
        for bad in ["up", "up/stream/x", "up/stream x", "up/stream\"", "../stream", "up/..", "up/stream repo:evil/x", "/stream", "up/"] {
            assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": bad}})), None, "{bad}");
        }
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": "Up-1/stream.rs_2"}})), Some("Up-1/stream.rs_2".into()));
    }

    #[test]
    fn logins_outside_github_login_characters_are_dropped() {
        let got = people_of(&json!([
            {"login": "ana-b"}, {"login": "x\"y"}, {"login": "a b"}, {"login": "-lead"}, {"login": "trail-"},
            {"login": "two--dash"}, {"login": "author:evil"}, {"login": "emu_acme"}, {"login": "Z9"}
        ]));
        assert_eq!(got.iter().map(|p| p.login.as_str()).collect::<Vec<_>>(), ["ana-b", "emu_acme", "Z9"]);
    }

    #[test]
    fn people_come_once_each_and_a_missing_avatar_falls_back_to_none() {
        let got = people_of(&json!([
            {"login": "txais", "avatar_url": "https://avatars.example/u/1"},
            {"login": "TXAIS", "avatar_url": "https://avatars.example/u/1"},
            {"login": "ghe-user"},
            {"login": "", "avatar_url": "https://x"},
            {"login": "odd", "avatar_url": "javascript:alert(1)"}
        ]));
        assert_eq!(got.iter().map(|p| p.login.as_str()).collect::<Vec<_>>(), ["txais", "ghe-user", "odd"]);
        assert_eq!(got[0].avatar, "https://avatars.example/u/1");
        assert_eq!(got[1].avatar, "", "GitHub Enterprise without avatars falls back cleanly");
        assert_eq!(got[2].avatar, "", "only https avatars are kept");
        assert!(people_of(&json!({"message": "Not Found"})).is_empty());
    }

    #[test]
    fn avatars_come_only_from_the_github_host_s_own_avatar_addresses() {
        assert!(avatar_ok("https://avatars.githubusercontent.com/u/1?v=4", "github.com"));
        assert!(!avatar_ok("https://evil.example/u/1", "github.com"));
        assert!(!avatar_ok("https://avatars.githubusercontent.com.evil.example/u/1", "github.com"));
        assert!(avatar_ok("https://ghe.corp/avatars/u/2", "ghe.corp"));
        assert!(avatar_ok("https://avatars.ghe.corp/u/2", "GHE.corp"));
        assert!(!avatar_ok("https://avatars.githubusercontent.com/u/1", "ghe.corp"), "Enterprise people do not borrow github.com avatars");
        assert!(!avatar_ok("http://ghe.corp/u/2", "ghe.corp"));
        assert!(!avatar_ok("", "github.com"));
    }

    #[test]
    fn odd_hosts_and_repository_names_never_reach_gh() {
        assert_eq!(repo_path("github.com", "o/r").unwrap(), "repos/o/r");
        for (h, r) in [("github.com", "o"), ("github.com", "../r"), ("github.com", "o/r/x"), ("github.com", "o/.."), ("git hub", "o/r"), ("", "o/r"), ("github.com", "o/r?x=1")] {
            assert!(repo_path(h, r).is_err(), "{h} {r}");
        }
    }

    #[test]
    fn the_parent_and_people_reads_ask_gh_for_the_right_addresses() {
        let dir = crate::test_dir::temp("github-reads");
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(
                &f,
                "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho %2| findstr assignees >nul && goto people\r\necho {\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}\r\nexit /b 0\r\n:people\r\necho [{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]\r\nexit /b 0\r\n",
            )
            .unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncase \"$2\" in *assignees*) echo '[{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]';; *) echo '{\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}';; esac\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        assert_eq!(repo_parent(&gh, "github.com", "me/fork").unwrap(), Some("up/stream".into()));
        assert_eq!(repo_people(&gh, "github.com", "up/stream").unwrap(), vec![Person { login: "ana".into(), avatar: String::new() }], "an avatar off GitHub's avatar host falls back to initials");
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("api repos/me/fork --hostname github.com"), "{calls}");
        // cmd.exe quoting may wrap the field in quotes, so the field is checked on its own.
        assert!(calls.contains("api repos/up/stream/assignees --hostname github.com -X GET -f ") && calls.contains("per_page=100"), "{calls}");
        assert!(repo_parent(&gh, "github.com", "bad").is_err());
    }

    /// T-314-c: a stand-in gh that keeps every call's arguments and request body and answers with
    /// `answer.json`.
    fn graphql_stand_in(name: &str, answer: &serde_json::Value) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        fs::write(dir.join("answer.json"), answer.to_string()).unwrap();
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            // FIX-1 (council FS 5): call n answers with answer<n>.json when there is one, so a test can
            // tell one call's answer from the next; answer.json otherwise.
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

    fn sample_project(more: bool) -> serde_json::Value {
        json!({ "data": { "repositoryOwner": { "login": "acme", "projectV2": {
            "id": "PVT_1", "title": "Roadmap", "url": "https://github.com/orgs/acme/projects/3", "number": 3, "closed": false,
            "views": { "nodes": [
                { "number": 1, "name": "Table", "layout": "TABLE_LAYOUT" },
                { "number": 2, "name": "Board", "layout": "BOARD_LAYOUT" },
                { "number": 3, "name": "Timeline", "layout": "ROADMAP_LAYOUT" }
            ] },
            "fields": { "nodes": [
                { "id": "F_title", "name": "Title", "dataType": "TITLE" },
                { "id": "F_status", "name": "Status", "dataType": "SINGLE_SELECT", "options": [{ "id": "o1", "name": "Todo" }, { "id": "o2", "name": "Done" }] },
                { "id": "F_sprint", "name": "Sprint", "dataType": "ITERATION", "configuration": { "iterations": [{ "id": "it2", "title": "Sprint 2", "startDate": "2026-10-12", "duration": 14 }], "completedIterations": [{ "id": "it1", "title": "Sprint 1", "startDate": "2026-09-28", "duration": 14 }] } },
                { "id": "F_due", "name": "Due", "dataType": "DATE" },
                {}
            ] },
            "items": { "pageInfo": { "hasNextPage": more, "endCursor": "Y3Vyc29y" }, "nodes": [
                { "id": "PVTI_a", "type": "ISSUE", "content": { "__typename": "Issue", "number": 7, "title": "Fix login", "url": "https://github.com/acme/app/issues/7", "state": "OPEN", "issueType": { "name": "Bug" },
                    "repository": { "nameWithOwner": "acme/app" }, "labels": { "nodes": [{ "name": "bug" }] }, "assignees": { "nodes": [{ "login": "ana" }, { "login": "bad login" }] } },
                  "fieldValues": { "nodes": [
                    { "__typename": "ProjectV2ItemFieldSingleSelectValue", "name": "Todo", "optionId": "o1", "field": { "id": "F_status" } },
                    { "__typename": "ProjectV2ItemFieldIterationValue", "title": "Sprint 2", "iterationId": "it2", "startDate": "2026-10-12", "duration": 14, "field": { "id": "F_sprint" } },
                    { "__typename": "ProjectV2ItemFieldDateValue", "date": "2026-10-20", "field": { "id": "F_due" } },
                    { "__typename": "ProjectV2ItemFieldNumberValue", "number": 3.0, "field": { "id": "F_points" } },
                    { "__typename": "ProjectV2ItemFieldTextValue", "text": "Fix login", "field": { "id": "F_title" } }
                  ] } },
                { "id": "PVTI_b", "type": "REDACTED", "content": null, "fieldValues": { "nodes": [] } },
                { "id": "PVTI_c", "type": "DRAFT_ISSUE", "content": { "__typename": "DraftIssue", "title": "Idea" }, "fieldValues": { "nodes": [] } },
                { "id": "bad id!", "type": "ISSUE", "content": {} }
            ] }
        } } } })
    }

    #[test]
    fn a_project_reads_its_views_fields_and_items_and_restricted_items_keep_a_bare_row() {
        let v = sample_project(false);
        let p = &v["data"]["repositoryOwner"]["projectV2"];
        let project = project_of("acme", p).unwrap();
        assert_eq!(project.views.iter().map(|v| v.layout.as_str()).collect::<Vec<_>>(), ["table", "board", "roadmap"]);
        assert_eq!(project.fields.iter().map(|f| f.kind.as_str()).collect::<Vec<_>>(), ["title", "single_select", "iteration", "date"], "a field GitHub gave no id is left out");
        let sprint = &project.fields[2].options;
        assert_eq!((sprint.len(), sprint[1].name.as_str(), sprint[1].days), (2, "Sprint 1", 14), "completed iterations stay choosable");
        let items = items_of(p);
        assert_eq!(items.iter().map(|i| i.kind.as_str()).collect::<Vec<_>>(), ["issue", "restricted", "draft"], "an item with an odd id is dropped");
        let a = &items[0];
        assert_eq!((a.repo.as_str(), a.state.as_str(), a.number), ("acme/app", "open", Some(7)));
        assert_eq!(a.assignees, ["ana"], "a login outside GitHub's characters is dropped");
        assert_eq!((a.issue_type.as_str(), items[2].issue_type.as_str()), ("Bug", ""), "an issue's type is read; a draft has none");
        assert_eq!(a.values["F_status"], Cell { text: "Todo".into(), id: "o1".into(), ..Default::default() });
        assert_eq!(a.values["F_sprint"].start, "2026-10-12");
        assert_eq!(a.values["F_due"], Cell { text: "2026-10-20".into(), start: "2026-10-20".into(), ..Default::default() });
        assert_eq!(a.values["F_points"].text, "3");
        let r = &items[1];
        assert!(r.title.is_empty() && r.url.is_empty() && r.values.is_empty(), "{r:?}");
    }

    #[test]
    fn a_cell_edit_turns_into_github_s_value_shape_and_odd_values_are_refused() {
        assert_eq!(field_value("text", " hi ").unwrap(), Some(json!({ "text": "hi" })));
        assert_eq!(field_value("number", "2.5").unwrap(), Some(json!({ "number": 2.5 })));
        assert!(field_value("number", "NaN").is_err() && field_value("number", "two").is_err());
        assert_eq!(field_value("date", "2026-10-20").unwrap(), Some(json!({ "date": "2026-10-20" })));
        assert!(field_value("date", "20/10/2026").is_err());
        assert_eq!(field_value("single_select", "o2").unwrap(), Some(json!({ "singleSelectOptionId": "o2" })));
        assert_eq!(field_value("iteration", "it1").unwrap(), Some(json!({ "iterationId": "it1" })));
        assert!(field_value("single_select", "o2\"}").is_err());
        assert!(field_value("title", "x").is_err() && field_value("labels", "bug").is_err(), "read-only columns are not edited through the field mutation");
        assert_eq!(field_value("text", "  ").unwrap(), None, "an empty cell is a clear");
    }

    #[test]
    fn a_project_is_read_in_pages_up_to_the_cap_and_edits_post_the_mutation_on_standard_input() {
        let (gh, dir) = graphql_stand_in("github-project", &sample_project(true));
        let p = read_project(&gh, "github.com", "acme", 3).unwrap();
        assert_eq!((p.items.len(), p.more), (3 * PROJECT_PAGES, true), "five pages of an answer that always says there is more");
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert_eq!(calls.lines().filter(|l| l.contains("api graphql --hostname github.com --input -")).count(), PROJECT_PAGES, "{calls}");
        let body = fs::read_to_string(dir.join("body.txt")).unwrap();
        assert!(body.contains("\"after\":\"Y3Vyc29y\"") && body.contains("\"owner\":\"acme\"") && body.contains("\"number\":3"), "{body}");

        let (gh, dir) = graphql_stand_in("github-project-set", &json!({ "data": { "updateProjectV2ItemFieldValue": { "projectV2Item": { "id": "PVTI_a" } } } }));
        set_project_field(&gh, "github.com", "PVT_1", "PVTI_a", "F_status", "single_select", "o2").unwrap();
        set_project_field(&gh, "github.com", "PVT_1", "PVTI_a", "F_due", "date", "").unwrap();
        let body = fs::read_to_string(dir.join("body.txt")).unwrap();
        assert!(body.contains("updateProjectV2ItemFieldValue") && body.contains("\"singleSelectOptionId\":\"o2\""), "{body}");
        assert!(body.contains("clearProjectV2ItemFieldValue") && body.contains("\"field\":\"F_due\""), "{body}");
        assert!(set_project_field(&gh, "github.com", "PVT_1", "x y", "F", "text", "a").is_err());
        assert!(read_project(&gh, "github.com", "bad owner", 3).is_err() && read_project(&gh, "bad host!", "acme", 3).is_err());
    }

    #[test]
    fn browsing_lists_an_owner_s_projects_or_the_signed_in_account_s() {
        let (gh, dir) = graphql_stand_in("github-projects", &json!({ "data": { "repositoryOwner": { "login": "acme", "projectsV2": { "pageInfo": { "hasNextPage": true }, "nodes": [{ "number": 3, "title": "Roadmap", "closed": false, "url": "https://github.com/orgs/acme/projects/3" }] } } } }));
        let list = list_projects(&gh, "github.com", "acme").unwrap();
        assert_eq!((list.projects.len(), list.projects[0].owner.as_str(), list.projects[0].number), (1, "acme", 3));
        assert!(list.more, "an owner with more than 30 projects says the list stops there (FIX-1, council FS 4)");
        assert!(list_projects(&gh, "github.com", "@me").is_err(), "the owner answer has no viewer");
        let body = fs::read_to_string(dir.join("body.txt")).unwrap();
        assert!(body.contains("viewer{login projectsV2") && body.contains("pageInfo{hasNextPage}"), "{body}");
        let (gh, _keep) = graphql_stand_in("github-projects-none", &json!({ "data": { "repositoryOwner": null } }));
        let err = list_projects(&gh, "github.com", "ghost").unwrap_err();
        assert!(err.contains("no account or organization called ghost"), "{err}");
    }
    #[test]
    fn an_issue_closes_as_a_duplicate_only_after_the_target_is_checked_and_reopens_and_takes_comments() {
        // FIX-1 (council FS 5): every call gets its own answer, so the target (#3, I_dup3) and the
        // issue itself (#7, I_kw7) are told apart and the order of the three calls is checked.
        let close = json!({ "data": { "closeIssue": { "issue": { "state": "CLOSED" } } } });
        let (gh, dir) = graphql_stand_in("github-issue-dup", &close);
        fs::write(dir.join("answer1.json"), json!({ "data": { "repository": { "issueOrPullRequest": { "__typename": "Issue", "id": "I_dup3", "state": "OPEN" } } } }).to_string()).unwrap();
        fs::write(dir.join("answer2.json"), json!({ "data": { "repository": { "issueOrPullRequest": { "__typename": "Issue", "id": "I_kw7", "state": "OPEN" } } } }).to_string()).unwrap();
        assert_eq!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "duplicate", Some(3)).unwrap(), "closed");
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert_eq!(calls.lines().count(), 3, "the target, the issue, then the close: {calls}");
        let body = fs::read_to_string(dir.join("body.txt")).unwrap();
        let sent: Vec<serde_json::Value> = body.lines().filter(|l| l.trim_start().starts_with('{')).map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(sent.len(), 3, "{body}");
        assert_eq!(sent[0]["variables"]["number"], 3, "the duplicate target is checked first: {body}");
        assert_eq!(sent[1]["variables"]["number"], 7, "then the issue itself: {body}");
        assert!(sent[2]["query"].as_str().unwrap().contains("closeIssue"), "{body}");
        assert_eq!((sent[2]["variables"]["id"].as_str(), sent[2]["variables"]["dup"].as_str(), sent[2]["variables"]["reason"].as_str()), (Some("I_kw7"), Some("I_dup3"), Some("DUPLICATE")), "the issue is closed as a duplicate of the target, not the other way round");

        let issue = json!({ "data": { "repository": { "issueOrPullRequest": { "__typename": "Issue", "id": "I_kw1", "state": "OPEN" } }, "closeIssue": { "issue": { "state": "CLOSED" } }, "reopenIssue": { "issue": { "state": "OPEN" } } } });
        let (gh, dir) = graphql_stand_in("github-issue-more", &issue);
        assert_eq!(set_issue_state(&gh, "github.com", "acme/app", 7, true, "", None).unwrap(), "open");
        assert_eq!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "not_planned", None).unwrap(), "closed");
        comment_issue(&gh, "github.com", "acme/app", 7, "Fixed in \"main\"; see `x`").unwrap();
        let body = fs::read_to_string(dir.join("body.txt")).unwrap();
        assert!(body.contains("reopenIssue") && body.contains("\"reason\":\"NOT_PLANNED\"") && body.contains("addComment") && body.contains("Fixed in \\\"main\\\""), "{body}");
    }

    /// FIX-1 (council FB 1): a stand-in gh that is signed in to ghe.corp only (gh config get -h
    /// <host> user answers a login there and fails everywhere else) and keeps every call. FIX-2
    /// (council FS 3): like real gh, a top-level user (top.txt, what `gh config set user` writes)
    /// is the answer for every host that has none of its own, with or without -h.
    fn gate_stand_in(name: &str) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" goto config\r\necho {\"fork\":false,\"data\":{}}\r\nexit /b 0\r\n:config\r\nif /i \"%3\"==\"-h\" if /i \"%4\"==\"ghe.corp\" (echo ana& exit /b 0)\r\nif exist \"%~dp0top.txt\" (type \"%~dp0top.txt\"& exit /b 0)\r\nif exist \"%~dp0locked.txt\" (echo gh: the config file is busy 1>&2& exit /b 1)\r\necho could not find key \"user\" 1>&2\r\nexit /b 1\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$1\" = config ]; then if [ \"$3\" = -h ] && [ \"$4\" = ghe.corp ]; then echo ana; exit 0; fi; [ -f \"$(dirname \"$0\")/top.txt\" ] && cat \"$(dirname \"$0\")/top.txt\" && exit 0; if [ -f \"$(dirname \"$0\")/locked.txt\" ]; then echo 'gh: the config file is busy' >&2; exit 1; fi; echo 'could not find key \"user\"' >&2; exit 1; fi\necho '{\"fork\":false,\"data\":{}}'\n").unwrap();
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
    fn a_host_gh_is_not_signed_in_to_never_gets_a_request() {
        let (gh, dir) = gate_stand_in("github-host-gate");
        let api_calls = || fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().filter(|l| l.starts_with("api")).map(String::from).collect::<Vec<_>>();
        // A pasted project address on an unknown host: reads and writes are refused before gh runs.
        let err = read_project(&gh, "evil.example", "acme", 3).unwrap_err();
        assert!(err.contains("signed in to"), "{err}");
        assert!(list_projects(&gh, "evil.example", "acme").is_err());
        assert!(set_project_field(&gh, "Evil.Example", "PVT_1", "PVTI_a", "F_status", "single_select", "o2").is_err());
        assert!(comment_issue(&gh, "evil.example", "acme/app", 7, "hello").is_err());
        // The same gate covers a host taken from a repository's remote (the fork parent and people reads).
        assert!(repo_parent(&gh, "evil.example", "acme/app").unwrap_err().contains("signed in to"));
        assert!(repo_people(&gh, "evil.example", "acme/app").is_err());
        assert!(read_project(&gh, "-x.corp", "acme", 3).is_err(), "a host that starts with a dash is not a host");
        assert_eq!(api_calls(), Vec::<String>::new(), "nothing reached gh api for a host it is not signed in to");
        let before = fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().count();
        assert!(host_allowed_with(&gh, "env.corp", Some("ENV.corp")).is_ok() && host_allowed_with(&gh, "GitHub.com", None).is_ok(), "GH_HOST and github.com need no check");
        assert!(host_allowed_with(&gh, "env.corp", Some("other.corp")).is_err());
        assert_eq!(fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().count(), before + 1, "only the refused env.corp asked gh config");
        // A host gh is signed in to goes through.
        assert_eq!(repo_parent(&gh, "ghe.corp", "acme/app").unwrap(), None);
        let _ = read_project(&gh, "ghe.corp", "acme", 3);
        let got = api_calls();
        assert!(got.iter().any(|c| c.starts_with("api repos/acme/app --hostname ghe.corp")) && got.iter().any(|c| c.starts_with("api graphql --hostname ghe.corp")), "{got:?}");
    }

    #[test]
    fn a_missing_repository_is_not_reported_as_a_missing_issue() {
        let repo = "gh: Could not resolve to a Repository with the name 'acme/gone'. (NOT_FOUND)".to_string();
        assert_eq!(lookup_error(repo, 7, "acme/gone"), "There is no repository acme/gone on this GitHub host, or your gh account cannot see it.");
        let issue = "gh: Could not resolve to an issue or pull request with the number of 999. (NOT_FOUND)".to_string();
        assert_eq!(lookup_error(issue, 999, "acme/app"), "There is no issue #999 in acme/app.");
        assert_eq!(lookup_error("github.com: gh did not answer within 30 seconds".into(), 1, "acme/app"), "github.com: gh did not answer within 30 seconds");
    }

    #[test]
    fn a_top_level_gh_user_does_not_sign_in_every_host() {
        let (gh, dir) = gate_stand_in("github-host-gate-top");
        fs::write(dir.join("top.txt"), "zed
").unwrap();
        let api_calls = || fs::read_to_string(dir.join("calls.txt")).unwrap_or_default().lines().filter(|l| l.starts_with("api")).count();
        // gh config get -h evil.example user falls back to the top-level user, the same answer as
        // gh config get user: that is no sign-in, so nothing goes to evil.example, create included.
        let why = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(why.contains("signed in to") && why.contains("top-level `user` setting"), "the refusal names the top-level setting: {why}");
        assert!(read_project(&gh, "evil.example", "acme", 3).is_err());
        assert!(create_issue(&gh, "evil.example", "acme/app", "Leak", "internal text", &[], &[]).unwrap_err().contains("signed in to"));
        assert!(repo_parent(&gh, "evil.example", "acme/app").is_err());
        assert_eq!(api_calls(), 0, "nothing reached gh api for a host known only through the top-level user");
        // A host with its own user in gh's hosts still passes.
        assert!(host_allowed_with(&gh, "ghe.corp", None).is_ok());
        assert_eq!(repo_parent(&gh, "ghe.corp", "acme/app").unwrap(), None);
        assert_eq!(api_calls(), 1);
    }

    /// FIX-4 (council FIX-SOON 1): gh failing a config read for a reason other than "key not set"
    /// (a config file being rewritten, a lock, a shim error) is no answer, so it refuses the host;
    /// only gh's own "could not find key" answer counts as the key being unset.
    #[test]
    fn a_config_read_that_fails_for_another_reason_is_no_answer_and_refuses_the_host() {
        let (gh, dir) = gate_stand_in("github-host-gate-locked");
        let busy = || dir.join("locked.txt");
        // ghe.corp has its own user; the top-level read exits 1 with an error that is not "key not found".
        fs::write(busy(), "x").unwrap();
        let why = host_allowed_with(&gh, "ghe.corp", None).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
        // The host's own read failing the same way is no answer either, not the plain refusal.
        let why = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
        // gh saying the key is not set is an answer: ghe.corp's own user stands, evil.example is plainly refused.
        fs::remove_file(busy()).unwrap();
        assert!(host_allowed_with(&gh, "ghe.corp", None).is_ok());
        let plain = host_allowed_with(&gh, "evil.example", None).unwrap_err();
        assert!(plain.contains("is not one of them") && !plain.contains("did not answer"), "{plain}");
    }

    #[test]
    fn only_gh_s_key_not_found_answer_reads_as_unset() {
        let read = |ok: bool, out: &str, err: &str| match config_read(ok, out, err) {
            ConfigRead::Value(v) => format!("value:{v}"),
            ConfigRead::Unset => "unset".into(),
            ConfigRead::Failed => "failed".into(),
        };
        assert_eq!(read(true, "ana", ""), "value:ana");
        assert_eq!(read(true, "", ""), "unset", "an older gh prints nothing for a key that is not set");
        assert_eq!(read(false, "", "could not find key \"user\""), "unset");
        assert_eq!(read(false, "", "Could not find key \"user\""), "failed", "FIX-6: gh's own case only");
        assert_eq!(read(false, "", "gh: could not find key: user"), "failed", "FIX-6: only the quoted-key form is gh's");
        assert_eq!(read(false, "", ""), "failed", "a bare non-zero exit says nothing about the key");
        assert_eq!(read(false, "", "gh: the config file is busy"), "failed");
        assert_eq!(read(false, "ana", "permission denied"), "failed", "output on a failed read is not an answer");
    }

    /// FIX-5 (council AFTER 1): "key not found" alone is wider than gh's wording; a wrapper or shim
    /// saying "secret key not found" must not read as "no such key", because an unset top-level
    /// key lets a host through.
    #[test]
    fn a_shim_s_key_not_found_is_no_answer_only_gh_s_could_not_find_key_is() {
        let read = |err: &str| matches!(config_read(false, "", err), ConfigRead::Unset);
        assert!(!read("secret key not found"));
        assert!(!read("key not found"));
        assert!(!read("gh: signing key not found in the keychain"));
        assert!(read("could not find key \"user\""));
        assert!(read("gh: could not find key \"user\" in the config"));
    }

    /// FIX-6 (council FIX-SOON 2): the bare prefix "could not find key" also matches a wrapper or
    /// credential helper saying "could not find keyring entry", and an unset top-level key lets
    /// a host through. Only the quoted form (`could not find key "`), in gh's own case, is "unset".
    #[test]
    fn a_wrapper_s_could_not_find_keyring_is_no_answer() {
        let read = |err: &str| matches!(config_read(false, "", err), ConfigRead::Unset);
        assert!(!read("could not find keyring entry"));
        assert!(!read("gh: could not find keyring"));
        assert!(!read("Could not find keychain item"));
        assert!(!read("gh: Could Not Find Key: user"), "unquoted wording is no answer");
        assert!(!read("Could not find key \"user\""), "case-sensitive");
        assert!(!read("could not find key: user"));
        assert!(read("could not find key \"user\""));
    }

    /// FIX-5 (council AFTER 2): a config answer of more than one line is no answer. A value that
    /// carries an extra line would compare unequal to the other read and let the host through.
    #[test]
    fn a_config_answer_of_more_than_one_line_is_no_answer_and_refuses_the_host() {
        for out in ["ana\nbob", "ana\r\nbob", "ana\n\nbob"] {
            assert!(matches!(config_read(true, out, ""), ConfigRead::Failed), "{out:?}");
        }
        assert!(matches!(config_read(true, "ana", ""), ConfigRead::Value(ref v) if v == "ana"));
        let gh = Path::new("fix5-multiline-gh");
        let host = |args: &[&str]| args.contains(&"-h");
        // Both reads print the same first line plus a different extra line: with the whole text
        // compared they differ and the host would be let through; it is refused instead.
        let why = host_allowed_reading(gh, "ghe.corp", None, &|a| config_read(true, if host(a) { "ana\nx" } else { "ana\ny" }, "")).unwrap_err();
        assert!(why.contains("did not answer its config read"), "{why}");
    }

    /// FIX-3 (reliability review FIX-SOON 6): a gh_config read that fails or times out is no answer,
    /// and no answer refuses the host; it never reads as "no top-level user" (which would sign in
    /// a host that has none of its own).
    #[test]
    fn a_failed_gh_config_read_refuses_the_host_instead_of_allowing_it() {
        use std::cell::RefCell;
        let gh = Path::new("fix3-failed-read-gh");
        let host = |args: &[&str]| args.contains(&"-h");
        // The host's own user reads fine; the top-level read fails: refused, with its own wording.
        let err = host_allowed_reading(gh, "ghe.corp", None, &|a| if host(a) { ConfigRead::Value("ana".into()) } else { ConfigRead::Failed }).unwrap_err();
        assert!(err.contains("did not answer its config read"), "{err}");
        // The host's own read fails: refused too.
        assert!(host_allowed_reading(gh, "ghe.corp", None, &|_| ConfigRead::Failed).unwrap_err().contains("did not answer its config read"));
        // A host gh answers "no user" for is the plain not-signed-in refusal.
        let plain = host_allowed_reading(gh, "ghe.corp", None, &|_| ConfigRead::Unset).unwrap_err();
        assert!(plain.contains("signed in to") && !plain.contains("did not answer"), "{plain}");
        // gh saying it has no top-level user is an answer: the host's own user stands.
        let seen = RefCell::new(0);
        let ok = host_allowed_reading(gh, "ghe.corp", None, &|a| {
            *seen.borrow_mut() += 1;
            if host(a) { ConfigRead::Value("ana".into()) } else { ConfigRead::Unset }
        });
        assert!(ok.is_ok() && *seen.borrow() == 2, "{ok:?}");
    }

    /// The gh_config read that hangs: the gate answers inside its limit, refuses, and the whole
    /// tree gh started ends with it (a program gh left running would leave a mark seconds later).
    #[cfg(windows)]
    #[test]
    fn a_gh_config_read_that_times_out_refuses_the_host_and_ends_the_whole_tree() {
        let dir = crate::test_dir::temp("github-config-timeout");
        fs::write(dir.join("late.cmd"), "@echo off\r\nping -n 4 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
        let gh = dir.join("gh.cmd");
        fs::write(&gh, "@echo off\r\nif /i \"%3\"==\"-h\" (echo ana& exit /b 0)\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\nping -n 30 127.0.0.1 >nul\r\n").unwrap();
        timed_out_read_refuses_and_leaves_no_mark(&gh, &dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_gh_config_read_that_times_out_refuses_the_host_and_ends_the_whole_tree() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::test_dir::temp("github-config-timeout");
        let gh = dir.join("gh");
        fs::write(&gh, "#!/bin/sh\nd=\"$(dirname \"$0\")\"\nif [ \"$3\" = -h ]; then echo ana; exit 0; fi\n( sleep 3; echo late > \"$d/late.txt\" ) &\nsleep 30\n").unwrap();
        fs::set_permissions(&gh, fs::Permissions::from_mode(0o755)).unwrap();
        timed_out_read_refuses_and_leaves_no_mark(&gh, &dir);
    }

    fn timed_out_read_refuses_and_leaves_no_mark(gh: &Path, dir: &Path) {
        let limit = std::time::Duration::from_secs(1);
        let started = std::time::Instant::now();
        let err = host_allowed_within(gh, "ghe.corp", None, limit).unwrap_err();
        assert!(err.contains("did not answer its config read"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(4), "took {:?}", started.elapsed());
        std::thread::sleep(std::time::Duration::from_millis(4500));
        assert!(!dir.join("late.txt").exists(), "a program gh started outlived the timed-out read");
    }

    #[test]
    fn a_bad_duplicate_target_or_comment_reads_as_a_plain_message_and_nothing_is_sent() {
        let (gh, dir) = graphql_stand_in("github-issue-missing", &json!({ "data": { "repository": { "issueOrPullRequest": null } } }));
        assert_eq!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "duplicate", Some(999)).unwrap_err(), "There is no issue #999 in acme/app.");
        assert_eq!(fs::read_to_string(dir.join("calls.txt")).unwrap().lines().count(), 1, "only the check went out");
        let (gh, _keep) = graphql_stand_in("github-issue-pr", &json!({ "data": { "repository": { "issueOrPullRequest": { "__typename": "PullRequest" } } } }));
        assert_eq!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "duplicate", Some(4)).unwrap_err(), "#4 in acme/app is a pull request, not an issue.");
        let (gh, dir) = graphql_stand_in("github-issue-refused", &json!({}));
        assert!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "duplicate", Some(7)).unwrap_err().contains("itself"));
        assert!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "duplicate", None).unwrap_err().contains("number"));
        assert!(set_issue_state(&gh, "github.com", "acme/app", 7, false, "wontfix", None).is_err());
        assert!(comment_issue(&gh, "github.com", "acme/app", 7, "  \n").is_err());
        assert!(comment_issue(&gh, "github.com", "acme/app", 7, &"x".repeat(COMMENT_MAX + 1)).is_err());
        assert!(set_issue_state(&gh, "github.com", "acme/../app", 7, true, "", None).is_err());
        assert!(!dir.join("calls.txt").exists(), "nothing was sent for a refused request");
    }

    #[test]
    fn a_new_issue_goes_to_the_chosen_repository_with_its_labels_and_assignees_on_stdin() {
        let (gh, dir) = graphql_stand_in("github-issue-create", &json!({ "number": 12, "html_url": "https://github.com/acme/app/issues/12", "title": "Crash on start" }));
        let got = create_issue(&gh, "github.com", "acme/app", " Crash on start ", "Steps \"quoted\" & more", &["bug".into()], &["ana".into()]).unwrap();
        assert_eq!(got, CreatedIssue { number: 12, url: "https://github.com/acme/app/issues/12".into(), title: "Crash on start".into() });
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("api -X POST repos/acme/app/issues --hostname github.com --input -"), "{calls}");
        assert!(!calls.contains("quoted"), "the text goes on stdin, never on the command line: {calls}");
        let body: serde_json::Value = serde_json::from_str(fs::read_to_string(dir.join("body.txt")).unwrap().trim()).unwrap();
        assert_eq!(body, json!({ "title": "Crash on start", "body": "Steps \"quoted\" & more", "labels": ["bug"], "assignees": ["ana"] }));

        let (gh, dir) = graphql_stand_in("github-issue-create-refused", &json!({}));
        assert!(create_issue(&gh, "github.com", "acme/app", "  ", "", &[], &[]).unwrap_err().contains("title"));
        assert!(create_issue(&gh, "github.com", "acme/app", "t", &"x".repeat(COMMENT_MAX + 1), &[], &[]).is_err());
        assert!(create_issue(&gh, "github.com", "acme/app", "t", "", &[], &["bad login".into()]).is_err());
        assert!(create_issue(&gh, "github.com", "acme/app", "t", "", &[" ".into()], &[]).is_err());
        assert!(create_issue(&gh, "github.com", "acme/../app", "t", "", &[], &[]).is_err());
        assert!(!dir.join("calls.txt").exists(), "nothing was sent for a refused issue");

        let (gh, _keep) = graphql_stand_in("github-issue-create-odd", &json!({ "message": "?" }));
        assert!(create_issue(&gh, "github.com", "acme/app", "t", "", &[], &[]).unwrap_err().contains("refresh"));
    }

    #[test]
    fn an_issue_type_is_offered_from_the_repository_and_set_or_cleared_with_the_name_on_stdin() {
        let (gh, dir) = graphql_stand_in("github-issue-types", &json!({ "data": { "repository": { "issueTypes": { "nodes": [{ "name": "Bug" }, { "name": "" }, { "name": "Task" }] } } } }));
        assert_eq!(issue_types(&gh, "github.com", "acme/app").unwrap(), ["Bug", "Task"]);
        assert!(issue_types(&gh, "github.com", "acme/../app").is_err());
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert_eq!(calls.lines().count(), 1, "the refused repository sent nothing: {calls}");

        let (gh, dir) = graphql_stand_in("github-issue-type-set", &json!({ "type": { "name": "Bug" } }));
        assert_eq!(set_issue_type(&gh, "github.com", "acme/app", 7, " Bug ").unwrap(), "Bug");
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("api -X PATCH repos/acme/app/issues/7 --hostname github.com --input -"), "{calls}");
        assert!(!calls.contains("Bug"), "the name goes on stdin, never on the command line: {calls}");
        let body: serde_json::Value = serde_json::from_str(fs::read_to_string(dir.join("body.txt")).unwrap().trim()).unwrap();
        assert_eq!(body, json!({ "type": "Bug" }));

        let (gh, dir) = graphql_stand_in("github-issue-type-clear", &json!({ "type": null }));
        assert_eq!(set_issue_type(&gh, "github.com", "acme/app", 7, "").unwrap(), "");
        let body: serde_json::Value = serde_json::from_str(fs::read_to_string(dir.join("body.txt")).unwrap().trim()).unwrap();
        assert_eq!(body, json!({ "type": null }), "an empty name clears the type");

        let (gh, dir) = graphql_stand_in("github-issue-type-refused", &json!({}));
        assert!(set_issue_type(&gh, "github.com", "acme/app", 0, "Bug").is_err());
        assert!(set_issue_type(&gh, "github.com", "acme/app", 7, "Bu\u{7}g").is_err());
        assert!(set_issue_type(&gh, "github.com", "acme/app", 7, &"x".repeat(ISSUE_TYPE_MAX + 1)).is_err());
        assert!(set_issue_type(&gh, "github.com", "acme/../app", 7, "Bug").is_err());
        assert!(!dir.join("calls.txt").exists(), "nothing was sent for a refused change");
    }
}
