#![allow(dead_code)] // wired in the chat-app screens stage
//! Starting a project: a new folder with git set up (and, when asked, a private copy on GitHub), or
//! a folder that already exists, added as it is. Also the GitHub badge, the one word a project shows
//! for where its work is kept.
//!
//! Nothing here asks for a sign-in or a setting the user has not given: a failed GitHub step leaves
//! the local folder working and says so in plain words.

use crate::git::Git;
use crate::projects::{self, Project};
use crate::scm;
use crate::state::Store;
use std::path::Path;
use std::time::Duration;

/// How long gh may take to say which account it is signed in with (a read of its own config).
const SIGNED_IN_LIMIT: Duration = Duration::from_secs(5);
/// What the first commit of a new project says.
const FIRST_COMMIT: &str = "Start the project";
/// The name and address a first commit uses when git has none of the user's own (git refuses to commit without them).
const FALLBACK_IDENTITY: [(&str, &str); 4] = [("GIT_AUTHOR_NAME", "Kolux"), ("GIT_AUTHOR_EMAIL", "kolux@localhost"), ("GIT_COMMITTER_NAME", "Kolux"), ("GIT_COMMITTER_EMAIL", "kolux@localhost")];

/// What starting a project gave: the project, where it lives on GitHub when it was put there, and a
/// plain sentence when something the user asked for did not happen.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub project: Project,
    pub github_url: Option<String>,
    pub note: Option<String>,
}

/// Where a project's work is kept, as the badge shows it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Badge {
    /// On GitHub, and only the owner's people can see it.
    Private { url: String },
    /// On GitHub, and anyone can see it.
    Public { url: String },
    /// A git folder with no GitHub copy.
    LocalOnly,
    /// Not a git folder at all.
    NotGit,
    /// Has a GitHub address, but gh is missing or not signed in, so the visibility cannot be read.
    SignInNeeded,
}

// ---------------------------------------------------------------------------------------------
// New project and existing project.
// ---------------------------------------------------------------------------------------------

/// Makes `parent_path/name`, starts git in it on `main` with a first commit (a `.gitignore` that keeps
/// `.worktrees/` out), registers it as a Kolux project and, when `make_github` is set and gh is signed
/// in, puts a private copy on GitHub. A GitHub step that fails leaves the working local folder and a
/// plain message in `note`.
pub fn project_new(git: &Git, store: &Store, parent_path: &Path, name: &str, make_github: bool) -> Result<NewProject, String> {
    let gh = if make_github { scm::gh_program().ok() } else { None };
    project_new_with(git, store, gh.as_deref(), parent_path, name, make_github)
}

/// `project_new` with the gh program handed in (None: gh is not installed), so a test can stand one in.
pub(crate) fn project_new_with(git: &Git, store: &Store, gh: Option<&Path>, parent_path: &Path, name: &str, make_github: bool) -> Result<NewProject, String> {
    let name = name.trim();
    check_name(name)?;
    if !parent_path.is_dir() {
        return Err(format!("{} is not a folder, so a project cannot be made in it.", parent_path.display()));
    }
    let folder = parent_path.join(name);
    if folder.exists() {
        return Err(format!("There is already something called \"{name}\" in {}. Pick another name.", parent_path.display()));
    }
    std::fs::create_dir(&folder).map_err(|e| format!("The folder \"{name}\" could not be made: {e}"))?;
    if let Err(e) = start_repository(&folder) {
        let _ = std::fs::remove_dir(&folder); // only an empty folder goes; anything git wrote stays for the user to see
        return Err(e);
    }
    let located = projects::locate_repo(git, &folder)?;
    let project = projects::register_project(store, located)?;
    let mut out = NewProject { project, github_url: None, note: None };
    if make_github {
        match publish(gh, &folder, name) {
            Ok(url) => out.github_url = Some(url),
            Err(why) => out.note = Some(format!("The project is ready on this computer, but it is not on GitHub: {why}")),
        }
    }
    Ok(out)
}

/// Adds the folder as a Kolux project exactly as it is: no `git init`, no commit, nothing written.
/// The folder must already be a git repository; Kolux's project list is what changes.
pub fn project_add_existing(git: &Git, store: &Store, path: &Path) -> Result<Project, String> {
    if !path.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }
    projects::add_project(git, store, path)
}

/// A name that is one plain folder name: no separators, nothing Windows refuses, nothing git or a
/// command line could mistake for something else.
fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Give the project a name.".into());
    }
    if name.chars().count() > 100 {
        return Err("A project name can be at most 100 characters.".into());
    }
    if let Some(c) = name.chars().find(|c| c.is_control() || "\\/:*?\"<>|".contains(*c)) {
        return Err(format!("A project name cannot contain {}.", if c.is_control() { "a control character".to_string() } else { format!("\"{c}\"") }));
    }
    if name.starts_with('.') || name.starts_with('-') || name.ends_with('.') || name.ends_with(' ') {
        return Err("A project name cannot start with a dot or a dash, or end with a dot or a space.".into());
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];
    if reserved.contains(&stem.as_str()) {
        return Err(format!("\"{name}\" is a name Windows keeps for itself. Pick another."));
    }
    Ok(())
}

/// `git init -b main`, the `.gitignore`, the first commit.
fn start_repository(folder: &Path) -> Result<(), String> {
    crate::git::run(&["init", "-q", "-b", "main"], Some(folder)).map_err(|e| format!("Git could not start the project: {e}"))?;
    std::fs::write(folder.join(".gitignore"), ".worktrees/\n").map_err(|e| format!("The .gitignore could not be written: {e}"))?;
    crate::git::run(&["add", "--", ".gitignore"], Some(folder)).map_err(|e| format!("Git could not stage the first file: {e}"))?;
    // A first commit needs a name and an address; use the user's own, and a stand-in only when git has none.
    let has_identity = ["user.name", "user.email"].iter().all(|k| crate::git::run(&["config", k], Some(folder)).is_ok_and(|v| !v.is_empty()));
    let env: &[(&str, &str)] = if has_identity { &[] } else { &FALLBACK_IDENTITY };
    crate::git::run_within_env(&["commit", "-q", "-m", FIRST_COMMIT], Some(folder), Duration::from_secs(60), env).map(drop).map_err(|e| format!("Git could not make the first commit: {e}"))
}

/// gh is signed in to `host`: it names an account there in its own config (no network).
pub(crate) fn signed_in(gh: &Path, host: &str) -> bool {
    scm::gh_config_within(gh, &["config", "get", "-h", host, "user"], SIGNED_IN_LIMIT).is_ok_and(|r| r.ok && !r.out.is_empty())
}

/// `gh repo create <name> --private --source . --push`; Ok with the repository's address.
fn publish(gh: Option<&Path>, folder: &Path, name: &str) -> Result<String, String> {
    let Some(gh) = gh else { return Err("the GitHub CLI (gh) is not installed. Install it, run gh auth login, and put the project on GitHub from its page.".into()) };
    if !signed_in(gh, "github.com") {
        return Err("you are not signed in to GitHub. Run gh auth login, then put the project on GitHub from its page.".into());
    }
    let said = scm::gh_run(gh, folder, &["repo", "create", name, "--private", "--source", ".", "--push"], None).map_err(|e| one_line(&e))?;
    let from_gh = said.split_whitespace().find(|w| w.starts_with("https://")).map(|w| w.trim_end_matches(".git").to_string());
    let from_git = || crate::git::run(&["remote", "get-url", "origin"], Some(folder)).ok().map(|u| u.trim_end_matches(".git").to_string()).filter(|u| !u.is_empty());
    from_gh.or_else(from_git).ok_or_else(|| "GitHub made the repository, but its address could not be read.".to_string())
}

/// The first line of a failure, as a plain sentence fragment.
fn one_line(e: &str) -> String {
    let line = e.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("GitHub gave no reason");
    let line: String = line.chars().take(240).collect();
    line.trim_end_matches('.').to_string() + "."
}

// ---------------------------------------------------------------------------------------------
// The badge.
// ---------------------------------------------------------------------------------------------

/// Where `path`'s work is kept: Private or Public on GitHub (with the repository's address),
/// LocalOnly, NotGit, or SignInNeeded when gh cannot say. Read-only: it asks git for the remote and
/// gh for the repository's visibility, and changes nothing.
#[tauri::command]
pub async fn github_badge(path: String) -> Badge {
    tauri::async_runtime::spawn_blocking(move || badge_with(scm::gh_program().ok().as_deref(), Path::new(&path))).await.unwrap_or(Badge::NotGit)
}

/// `github_badge` with the gh program handed in (None: gh is not installed).
pub(crate) fn badge_with(gh: Option<&Path>, path: &Path) -> Badge {
    if !path.is_dir() || crate::git::run(&["rev-parse", "--is-inside-work-tree"], Some(path)).ok().as_deref() != Some("true") {
        return Badge::NotGit;
    }
    let Ok(origin) = crate::git::run(&["remote", "get-url", "origin"], Some(path)) else { return Badge::LocalOnly };
    if origin.trim().is_empty() {
        return Badge::LocalOnly;
    }
    // "host/owner/name" of a GitHub origin; a remote that is not GitHub has no GitHub copy to describe.
    let Some(repo) = scm::gh_repo_arg(path, &scm::ssh_config()) else { return Badge::LocalOnly };
    let host = repo.split('/').next().unwrap_or("").to_string();
    let Some(gh) = gh else { return Badge::SignInNeeded };
    if !signed_in(gh, &host) || crate::github::host_allowed(gh, &host).is_err() {
        return Badge::SignInNeeded;
    }
    // The repository goes by its address, so gh_run adds no --repo flag (`gh repo view` has none).
    let address = format!("https://{repo}");
    match scm::gh_run(gh, path, &["repo", "view", &address, "--json", "visibility,url"], None) {
        Ok(text) => read_visibility(&text, &address),
        Err(e) => {
            let e = e.to_lowercase();
            if e.contains("auth login") || e.contains("authentication") || e.contains("401") || e.contains("not logged in") {
                Badge::SignInNeeded
            } else {
                Badge::LocalOnly // GitHub does not know the address: the copy is gone or was never made
            }
        }
    }
}

fn read_visibility(text: &str, fallback_url: &str) -> Badge {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return Badge::SignInNeeded };
    let url = v["url"].as_str().filter(|u| u.starts_with("https://")).unwrap_or(fallback_url).to_string();
    match v["visibility"].as_str().map(str::to_ascii_uppercase).as_deref() {
        Some("PUBLIC") => Badge::Public { url },
        Some("PRIVATE") | Some("INTERNAL") => Badge::Private { url },
        _ => Badge::SignInNeeded,
    }
}

#[cfg(test)]
#[path = "project_new_tests.rs"]
mod tests;
