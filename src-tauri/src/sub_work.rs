//! GIT-013 (rule 2): removing a worktree looks for unsaved work inside its submodules first. A
//! worktree's submodule checkouts are deleted with it, so uncommitted files, untracked files and
//! commits that are not in the parent repository's record all count as work that would be lost.
//! This reads them the way `git status` reports them with submodule changes never hidden (a
//! submodule marked `ignore = all` in its settings still counts), and words them for the removal
//! dialog. `projects.rs` calls `annotate` and `note` (patch evidence/repo-T-313-b-projects.rs.patch).

use crate::git::run;
use std::path::Path;

/// A submodule with work in it, and what that work is ("new commits", "changed files", ...).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubWork {
    pub path: String,
    pub state: String,
}

const MARK: &str = " (submodule: ";

/// The submodules of `worktree` holding work, read from `git status --porcelain=2` with
/// submodule changes shown in full.
pub fn unsaved(worktree: &Path) -> Result<Vec<SubWork>, String> {
    let text = run(&["status", "--porcelain=2", "--ignore-submodules=none"], Some(worktree))?;
    Ok(parse(&text))
}

/// The submodule rows of a `git status --porcelain=2` answer: ordinary-change lines are
/// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` and the `<sub>` field is `N...` for a file and
/// `S<c><m><u>` for a submodule.
pub fn parse(text: &str) -> Vec<SubWork> {
    text.lines()
        .filter(|l| l.starts_with("1 "))
        .filter_map(|l| {
            let mut f = l.splitn(9, ' ');
            let state = crate::scm::submodule_state(f.nth(2)?)?;
            Some(SubWork { path: f.nth(5)?.to_string(), state })
        })
        .collect()
}

/// `changes` (porcelain v1 lines) with every submodule's state written on its row, and a row added
/// for a submodule that plain `git status` hid.
pub fn annotate(mut changes: Vec<String>, subs: &[SubWork]) -> Vec<String> {
    for s in subs {
        let tag = format!("{MARK}{})", s.state);
        match changes.iter_mut().find(|l| l.get(3..) == Some(s.path.as_str())) {
            Some(line) => line.push_str(&tag),
            None => changes.push(format!(" M {}{tag}", s.path)),
        }
    }
    changes
}

/// The sentence a refused removal adds when submodule work is among the changes; None without any.
pub fn note(changes: &[String]) -> Option<String> {
    let names: Vec<&str> = changes.iter().filter_map(|l| l.get(3..)).filter_map(|rest| rest.split_once(MARK).map(|(p, _)| p)).collect();
    let first = *names.first()?;
    let more = if names.len() > 1 { format!(" and {} more", names.len() - 1) } else { String::new() };
    Some(format!("Work inside {} would be lost with it: the submodule folders go with the workspace.", if names.len() == 1 { first.to_string() } else { format!("{first}{more}") }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git_in(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").args(["-c", "protocol.file.allow=always"]).args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-subwork-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q", "-b", "main"]);
        git_in(&dir, &["config", "user.email", "t@example.com"]);
        git_in(&dir, &["config", "user.name", "t"]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        git_in(&dir, &["add", "."]);
        git_in(&dir, &["commit", "-q", "-m", "a"]);
        dir
    }

    #[test]
    fn git013_the_status_answer_is_read_for_submodule_rows_only() {
        let text = "# branch.oid abc\n1 .M N... 100644 100644 100644 h1 h2 plain.txt\n1 .M SCMU 160000 160000 160000 h3 h4 vendor/my lib\n1 .M S.M. 160000 160000 160000 h3 h4 other\n? loose.txt\n";
        assert_eq!(
            parse(text),
            vec![SubWork { path: "vendor/my lib".into(), state: "new commits, changed files, untracked files".into() }, SubWork { path: "other".into(), state: "changed files".into() }]
        );
        assert_eq!(parse(""), Vec::new());
    }

    #[test]
    fn git013_rows_name_the_work_and_the_refusal_says_which_submodule() {
        let subs = vec![SubWork { path: "lib".into(), state: "changed files".into() }, SubWork { path: "hidden".into(), state: "untracked files".into() }];
        let rows = annotate(vec![" M lib".into(), "?? notes.txt".into()], &subs);
        assert_eq!(rows, vec![" M lib (submodule: changed files)", "?? notes.txt", " M hidden (submodule: untracked files)"]);
        assert_eq!(note(&rows).unwrap(), "Work inside lib and 1 more would be lost with it: the submodule folders go with the workspace.");
        assert_eq!(note(&rows[..1]).unwrap(), "Work inside lib would be lost with it: the submodule folders go with the workspace.");
        assert_eq!(note(&["?? notes.txt".to_string()]), None);
    }

    #[test]
    fn git013_work_left_inside_a_real_submodule_is_found_even_when_its_settings_hide_it() {
        let lib = repo("lib");
        let top = repo("top");
        git_in(&top, &["submodule", "add", "-q", &lib.to_string_lossy(), "vendor/lib"]);
        git_in(&top, &["commit", "-q", "-m", "add sub"]);
        assert_eq!(unsaved(&top).unwrap(), Vec::new(), "a clean submodule holds no work");
        fs::write(top.join("vendor/lib/scratch.txt"), "unsaved").unwrap();
        let found = unsaved(&top).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "vendor/lib");
        assert_eq!(found[0].state, "untracked files");
        // The submodule is marked to be ignored: plain status hides it, this still sees it.
        git_in(&top, &["config", "-f", ".gitmodules", "submodule.vendor/lib.ignore", "all"]);
        git_in(&top, &["config", "submodule.vendor/lib.ignore", "all"]);
        let plain = git_in(&top, &["status", "--porcelain"]);
        assert!(!plain.contains("vendor/lib"), "plain status hides it: {plain}");
        assert_eq!(unsaved(&top).unwrap().len(), 1);
        let rows = annotate(Vec::new(), &unsaved(&top).unwrap());
        assert_eq!(rows, vec![" M vendor/lib (submodule: untracked files)"]);
        for d in [lib, top] {
            let _ = fs::remove_dir_all(d);
        }
    }
}
