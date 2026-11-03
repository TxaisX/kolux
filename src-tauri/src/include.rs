//! What a new worktree brings along from the main checkout (GIT-067, COMPAT.md 5.6): the
//! git-ignored files named in `.worktreeinclude` at the repository root are copied in, and the
//! git-ignored folders listed under `worktree.sharedDirectories` in `kolux.yaml` are linked so
//! every worktree shares one copy (node_modules, say). Entries are tidied before anything on
//! disk changes: absolute paths, paths that leave the repository or point into Git's own folder
//! are dropped, duplicates and trailing slashes go, and wildcard or negation lines in the
//! include file are skipped with a warning. Nothing here fails the create: trouble comes back as
//! warnings the user reads.
//! PROJ-032: the copies keep to a budget of about 2 GB and 50,000 entries per worktree; what
//! would go over is left out and named (up to five), and a copy that stops part-way says partial
//! files may be left behind. The rest of kolux.yaml and its legacy twin come with PROJ-034 (T-149) and
//! HID-037, so the shared-folders list is read with a small line scanner, not a YAML parser.
use crate::git::run;
use std::path::{Path, PathBuf};

pub const INCLUDE_FILE: &str = ".worktreeinclude";
pub const CONFIG_FILE: &str = "kolux.yaml";

/// A repo-relative entry made safe: forward slashes, no trailing slash, not absolute, never
/// `..`, never inside `.git`. None means the entry is dropped.
pub fn tidy_rel(entry: &str) -> Option<String> {
    let e = entry.trim().replace('\\', "/");
    let e = e.trim_start_matches("./").trim_end_matches('/');
    let p = Path::new(e);
    if e.is_empty() || p.is_absolute() || p.has_root() || e.contains(':') {
        return None;
    }
    let parts: Vec<&str> = e.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    if parts.is_empty() || parts.contains(&"..") || parts[0].eq_ignore_ascii_case(".git") {
        return None;
    }
    Some(parts.join("/"))
}

/// The include file's literal paths plus a warning for every line that cannot be one.
pub fn include_lines(text: &str) -> (Vec<String>, Vec<String>) {
    let mut paths = Vec::new();
    let mut warnings = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('!') || line.contains(['*', '?', '[']) {
            warnings.push(format!("{INCLUDE_FILE}: `{line}` skipped, it takes literal paths only"));
        } else if let Some(rel) = tidy_rel(line) {
            if !paths.contains(&rel) {
                paths.push(rel);
            }
        } else {
            warnings.push(format!("{INCLUDE_FILE}: `{line}` skipped, it must stay inside the repository"));
        }
    }
    (paths, warnings)
}

/// `worktree.sharedDirectories` from kolux.yaml's text: a block list (`- x` lines) or an inline
/// `[a, b]`, tidied and deduplicated.
pub fn shared_dirs(yaml: &str) -> Vec<String> {
    let unquote = |s: &str| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
    let indent = |l: &str| l.len() - l.trim_start().len();
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        if let Some(rel) = tidy_rel(&unquote(s)) {
            if !out.iter().any(|o| o.eq_ignore_ascii_case(&rel)) {
                out.push(rel);
            }
        }
    };
    let (mut in_worktree, mut list_indent) = (false, None::<usize>);
    for raw in yaml.lines() {
        let line = raw.split('#').next().unwrap_or("").trim_end();
        if line.trim().is_empty() {
            continue;
        }
        let (ind, body) = (indent(line), line.trim());
        if let Some(li) = list_indent {
            if ind > li && body.starts_with("- ") {
                push(&body[2..]);
                continue;
            }
            list_indent = None;
        }
        if ind == 0 {
            in_worktree = body == "worktree:";
            continue;
        }
        if in_worktree {
            if let Some(rest) = body.strip_prefix("sharedDirectories:") {
                let rest = rest.trim();
                if let Some(inline) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    inline.split(',').for_each(&mut push);
                } else {
                    list_indent = Some(ind);
                }
            }
        }
    }
    out
}

/// Is `rel` git-ignored in `repo`? Tracked files are not, so they are never copied over.
fn ignored(repo: &Path, rel: &str) -> bool {
    run(&["check-ignore", "-q", "--", rel], Some(repo)).is_ok()
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// PROJ-032: the most one worktree receives from the include file.
pub const BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const BUDGET_ENTRIES: u64 = 50_000;

/// Bytes and entries (files and folders) under `p`; stops counting once past either cap.
fn measure(p: &Path, cap_bytes: u64, cap_entries: u64) -> (u64, u64) {
    let (mut bytes, mut entries) = (0u64, 0u64);
    let mut stack = vec![p.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(meta) = std::fs::symlink_metadata(&next) else { continue };
        entries += 1;
        if meta.is_dir() {
            stack.extend(std::fs::read_dir(&next).into_iter().flatten().flatten().map(|e| e.path()));
        } else {
            bytes += meta.len();
        }
        if bytes > cap_bytes || entries > cap_entries {
            break;
        }
    }
    (bytes, entries)
}

/// Copies each of `rels` from `repo` into `dest` while the budget lasts, in list order; an
/// entry that would go over it is left out. Returns the warnings.
fn copy_within(repo: &Path, dest: &Path, rels: &[String], mut bytes: u64, mut entries: u64) -> Vec<String> {
    let (mut warnings, mut skipped) = (Vec::new(), Vec::new());
    for rel in rels {
        let (b, e) = measure(&repo.join(rel), bytes, entries);
        if b > bytes || e > entries {
            skipped.push(rel.as_str());
            continue;
        }
        (bytes, entries) = (bytes - b, entries - e);
        if let Err(err) = copy_tree(&repo.join(rel), &dest.join(rel)) {
            warnings.push(format!("{INCLUDE_FILE}: copying `{rel}` stopped part-way ({err}); partial files may be left behind in the new worktree"));
        }
    }
    if !skipped.is_empty() {
        let more = if skipped.len() > 5 { format!(" and {} more", skipped.len() - 5) } else { String::new() };
        let names = skipped.iter().take(5).map(|s| format!("`{s}`")).collect::<Vec<_>>().join(", ");
        warnings.push(format!("{INCLUDE_FILE}: left out to stay within the copy budget (about 2 GB and 50,000 entries): {names}{more}"));
    }
    warnings
}

/// A folder link `link` → `target`. On Windows a junction: it needs no privilege (symlinks do,
/// on most accounts) and git sees it as a folder, so a `node_modules/` ignore line still matches
/// it; a symlink is the fallback when `mklink` is not there.
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new(crate::pty::system_program("cmd.exe")); // T-663
        cmd.raw_arg(format!("/C mklink /J \"{}\" \"{}\"", link.display(), target.display())).creation_flags(0x0800_0000);
        match cmd.output() {
            Ok(out) if out.status.success() => Ok(()),
            Ok(out) => Err(std::io::Error::other(String::from_utf8_lossy(&out.stderr).trim().to_string())),
            Err(_) => std::os::windows::fs::symlink_dir(target, link),
        }
    }
    #[cfg(not(windows))]
    std::os::unix::fs::symlink(target, link)
}

/// Copies the include file's ignored files into `dest` and links the shared folders; returns
/// the warnings. `repo` is the main checkout.
pub fn bring_along(repo: &Path, dest: &Path) -> Vec<String> {
    let mut warnings = Vec::new();
    if let Ok(text) = std::fs::read_to_string(repo.join(INCLUDE_FILE)) {
        let (paths, warned) = include_lines(&text);
        warnings.extend(warned);
        let mut copy = Vec::new();
        for rel in paths {
            if !repo.join(&rel).exists() {
                warnings.push(format!("{INCLUDE_FILE}: `{rel}` is not in the main checkout"));
            } else if ignored(repo, &rel) {
                copy.push(rel);
            }
        }
        warnings.extend(copy_within(repo, dest, &copy, BUDGET_BYTES, BUDGET_ENTRIES));
    }
    if let Ok(yaml) = std::fs::read_to_string(repo.join(CONFIG_FILE)) {
        for rel in shared_dirs(&yaml) {
            let (src, link): (PathBuf, PathBuf) = (repo.join(&rel), dest.join(&rel));
            // the trailing slash lets a folder-only pattern (`node_modules/`) match before the folder exists
            if !ignored(repo, &format!("{rel}/")) {
                warnings.push(format!("{CONFIG_FILE}: `{rel}` is not git-ignored, so it is not shared"));
            } else if link.exists() {
                warnings.push(format!("{CONFIG_FILE}: `{rel}` already exists in the new worktree, so it is not shared"));
            } else if let Err(e) = std::fs::create_dir_all(&src).and_then(|_| link.parent().map(std::fs::create_dir_all).unwrap_or(Ok(()))).and_then(|_| link_dir(&src, &link)) {
                warnings.push(format!("{CONFIG_FILE}: `{rel}` could not be linked: {e}"));
            }
        }
    }
    warnings
}

/// Takes the shared-folder links out of `dest` before the worktree goes: git leaves a junction
/// where it stands (and then the folder), so the links go first and the folders behind them never.
pub fn unlink_shared(repo: &Path, dest: &Path) {
    if let Ok(yaml) = std::fs::read_to_string(repo.join(CONFIG_FILE)) {
        for rel in shared_dirs(&yaml) {
            let link = dest.join(rel);
            if std::fs::symlink_metadata(&link).is_ok_and(|m| m.file_type().is_symlink()) {
                let _ = std::fs::remove_dir(&link);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_keep_to_the_budget_and_a_stopped_copy_says_so() {
        let root = std::env::temp_dir().join(format!("kolux-rs-budget-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, dest) = (root.join("repo"), root.join("dest"));
        std::fs::create_dir_all(repo.join("deps/pkg")).unwrap();
        std::fs::write(repo.join(".env"), "KEY=1").unwrap();
        std::fs::write(repo.join("deps/pkg/big.bin"), vec![0u8; 4000]).unwrap();
        for i in 0..7 {
            std::fs::write(repo.join(format!("x{i}")), vec![0u8; 900]).unwrap();
        }
        let rels: Vec<String> = [".env", "deps"].iter().map(|s| s.to_string()).chain((0..7).map(|i| format!("x{i}"))).collect();
        // 1,000 bytes: the env file fits, the dependency folder and six of the seven others do not.
        let w = copy_within(&repo, &dest, &rels, 1000, 100);
        assert_eq!(std::fs::read_to_string(dest.join(".env")).unwrap(), "KEY=1");
        assert!(!dest.join("deps").exists() && dest.join("x0").exists() && !dest.join("x1").exists());
        assert_eq!(w.len(), 1, "{w:?}");
        assert!(w[0].contains("`deps`, `x1`, `x2`, `x3`, `x4` and 2 more"), "{}", w[0]);
        // The entry cap counts too: the folder is three entries.
        assert!(copy_within(&repo, &root.join("d2"), &["deps".into()], u64::MAX, 2)[0].contains("`deps`"));
        // A copy that cannot finish (a file stands where a folder must go) warns about leftovers.
        std::fs::create_dir_all(root.join("d3/deps")).unwrap();
        std::fs::write(root.join("d3/deps/pkg"), "in the way").unwrap();
        let w = copy_within(&repo, &root.join("d3"), &["deps".into()], u64::MAX, u64::MAX);
        assert!(w.len() == 1 && w[0].contains("stopped part-way") && w[0].contains("partial files may be left behind"), "{w:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn entries_are_tidied_and_unsafe_ones_dropped() {
        assert_eq!(tidy_rel(" node_modules/ ").as_deref(), Some("node_modules"));
        assert_eq!(tidy_rel("./a\\b/").as_deref(), Some("a/b"));
        for bad in ["", "/", "/abs", "C:\\x", "C:/x", "../x", "a/../../x", ".git", ".GIT/hooks", "."] {
            assert_eq!(tidy_rel(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn include_file_takes_literal_lines_and_warns_about_the_rest() {
        let (paths, warnings) = include_lines("# secrets\n.env\n\n!keep\n*.log\nlogs/[a]\n../out\n.env\n  .env.local  \n");
        assert_eq!(paths, vec![".env", ".env.local"]);
        assert_eq!(warnings.len(), 4, "{warnings:?}");
        assert!(warnings[0].contains("`!keep`") && warnings[1].contains("`*.log`") && warnings[2].contains("`logs/[a]`"));
        assert!(warnings[3].contains("`../out`") && warnings[3].contains("inside the repository"));
    }

    #[test]
    fn shared_directories_come_from_the_worktree_block_or_an_inline_list() {
        let block = "scripts:\n  setup: pnpm i\nworktree:\n  other: 1\n  sharedDirectories: # one copy\n    - node_modules/\n    - 'node_modules'\n    - /abs\n    - ../x\n    - .git/hooks\n    - \"packages/app/node_modules\"\n  after: 2\ndefaultTabs: []\n";
        assert_eq!(shared_dirs(block), vec!["node_modules", "packages/app/node_modules"]);
        assert_eq!(shared_dirs("worktree:\n  sharedDirectories: [node_modules, .cache/, node_modules]\n"), vec!["node_modules", ".cache"]);
        assert!(shared_dirs("sharedDirectories:\n  - node_modules\n").is_empty(), "the key counts only under worktree");
        assert!(shared_dirs("worktree:\n  sharedDirectories:\nscripts:\n  - node_modules\n").is_empty(), "the list ends with the block");
    }
}
