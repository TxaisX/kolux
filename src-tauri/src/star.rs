// ONB-037 / ONB-038 (T-322-b): starring the Kolux repository through the user's own gh sign-in. It runs only when
// the user clicks the star button, never by itself. STAR_REPO is empty until Kolux has a public repository
// (OD-16, confirmed 2026-10-13); empty means the star prompt is off and nothing here talks to GitHub.
use crate::github::full_name_ok;
use crate::scm::{gh_program, gh_run, gh_words};
use std::path::Path;

pub const STAR_REPO: &str = "";
const HOST: &str = "github.com";

/// What the page learns about the prompt: the repository (empty = off) and whether the user already starred it
/// (None when that could not be checked).
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct StarInfo {
    pub repo: String,
    pub starred: Option<bool>,
}

/// gh's arguments for "has this user starred it": 204 is a yes, a 404 is a no.
fn check_args(repo: &str) -> Vec<String> {
    vec!["api".into(), format!("user/starred/{repo}"), "--hostname".into(), HOST.into(), "--silent".into()]
}

fn put_args(repo: &str) -> Vec<String> {
    vec!["api".into(), "-X".into(), "PUT".into(), format!("user/starred/{repo}"), "--hostname".into(), HOST.into(), "--silent".into()]
}

/// `run` is gh with the given arguments (a fake in the tests).
pub fn starred_with(run: &dyn Fn(&[String]) -> Result<String, String>, repo: &str) -> Option<bool> {
    if !full_name_ok(repo) {
        return None;
    }
    match run(&check_args(repo)) {
        Ok(_) => Some(true),
        Err(e) if e.contains("404") || e.to_lowercase().contains("not found") => Some(false),
        Err(_) => None,
    }
}

pub fn star_with(run: &dyn Fn(&[String]) -> Result<String, String>, repo: &str) -> Result<(), String> {
    if !full_name_ok(repo) {
        return Err("Kolux has no repository to star yet.".into());
    }
    run(&put_args(repo)).map(|_| ()).map_err(|e| gh_words(&e))
}

fn real(gh: &Path) -> impl Fn(&[String]) -> Result<String, String> + '_ {
    move |args: &[String]| {
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        gh_run(gh, &std::env::temp_dir(), &a, None)
    }
}

#[tauri::command]
pub async fn star_info() -> Result<StarInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if STAR_REPO.is_empty() {
            return Ok(StarInfo { repo: String::new(), starred: None });
        }
        let starred = gh_program().ok().and_then(|gh| starred_with(&real(&gh), STAR_REPO));
        Ok(StarInfo { repo: STAR_REPO.into(), starred })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Only the star button calls this.
#[tauri::command]
pub async fn star_put() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| star_with(&real(&gh_program()?), STAR_REPO)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn fake<'a>(seen: &'a RefCell<Vec<Vec<String>>>, answer: Result<String, String>) -> impl Fn(&[String]) -> Result<String, String> + 'a {
        move |a: &[String]| {
            seen.borrow_mut().push(a.to_vec());
            answer.clone()
        }
    }

    #[test]
    fn the_prompt_is_off_until_a_repository_is_set() {
        assert_eq!(STAR_REPO, "");
        let seen = RefCell::new(vec![]);
        assert_eq!(star_with(&fake(&seen, Ok(String::new())), STAR_REPO), Err("Kolux has no repository to star yet.".into()));
        assert_eq!(starred_with(&fake(&seen, Ok(String::new())), STAR_REPO), None);
        assert!(seen.borrow().is_empty(), "gh must not run with no repository");
    }

    #[test]
    fn checking_reads_a_yes_a_no_and_a_cannot_tell() {
        let seen = RefCell::new(vec![]);
        assert_eq!(starred_with(&fake(&seen, Ok(String::new())), "owner/kolux"), Some(true));
        assert_eq!(starred_with(&fake(&seen, Err("gh: Not Found (HTTP 404)".into())), "owner/kolux"), Some(false));
        assert_eq!(starred_with(&fake(&seen, Err("gh: To get started with GitHub CLI, please run: gh auth login".into())), "owner/kolux"), None);
        let first = &seen.borrow()[0];
        assert_eq!(first[..2], ["api".to_string(), "user/starred/owner/kolux".to_string()]);
        assert!(!first.contains(&"PUT".to_string()), "a check never writes");
    }

    #[test]
    fn starring_is_one_put_and_a_failure_comes_back_in_words() {
        let seen = RefCell::new(vec![]);
        assert_eq!(star_with(&fake(&seen, Ok(String::new())), "owner/kolux"), Ok(()));
        assert_eq!(seen.borrow()[0][..4], ["api".to_string(), "-X".to_string(), "PUT".to_string(), "user/starred/owner/kolux".to_string()]);
        assert!(star_with(&fake(&seen, Err("HTTP 401".into())), "owner/kolux").is_err());
        assert!(star_with(&fake(&seen, Ok(String::new())), "not a repo").is_err());
    }
}
