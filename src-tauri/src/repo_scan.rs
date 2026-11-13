// PROJ-012 / PROJ-013: scan a parent folder for the Git repositories inside it, then import the
// ones the user ticks as one project group or as separate projects.
//
// The scan goes level by level, each folder's children in alphabetical order. It reads `.gitignore`
// and `.ignore` files on the way down, does not enter heavy dependency folders, does not follow
// symbolic links, and recognises a bare repository without entering it. Depth, folder and
// repository counts bound it; there is no time limit. A stop keeps what was found so far.
use crate::groups::{self, Group, Groups};
use crate::projects::{self, Project};
use crate::state::Store;
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

pub struct Limits {
    /// Folder levels below the one picked.
    pub depth: usize,
    pub found: usize,
    pub visited: usize,
}

pub const LIMITS: Limits = Limits { depth: 6, found: 500, visited: 20_000 };

/// Folders that hold a package manager's dependencies, never opened.
/// ponytail: a fixed list; a repository really named like one of these is not found.
const HEAVY: [&str; 9] = ["node_modules", "target", ".venv", "venv", "__pycache__", "bower_components", "Pods", ".gradle", ".tox"];

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub name: String,
    /// A bare repository has no working folder to open as a project.
    pub bare: bool,
    /// The linked worktree folder it was found through, when `path` is its main checkout.
    pub linked: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub visited: usize,
    pub found: usize,
    pub stopped: bool,
    /// "depth", "folders" or "repositories" when a limit cut the scan short.
    pub limit: Option<&'static str>,
}

struct Rule {
    base: PathBuf,
    glob: String,
    anchored: bool,
    /// A `!` line: re-shows what an earlier line hid.
    negate: bool,
}

fn glob(pat: &[char], s: &[char]) -> bool {
    match pat.first() {
        None => s.is_empty(),
        Some('*') => (0..=s.len()).any(|i| glob(&pat[1..], &s[i..])),
        Some('?') => !s.is_empty() && glob(&pat[1..], &s[1..]),
        Some(c) => s.first() == Some(c) && glob(&pat[1..], &s[1..]),
    }
}

/// The folder rules of one ignore file, in file order; a `!` line re-shows (the last match wins).
fn rules_of(dir: &Path, file: &str) -> Vec<Rule> {
    let Ok(text) = std::fs::read_to_string(dir.join(file)) else { return Vec::new() };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            let negate = l.starts_with('!');
            let l = l.trim_start_matches('!').trim_end_matches('/');
            let anchored = l.starts_with('/') || l.contains('/');
            Rule { base: dir.to_path_buf(), glob: l.trim_start_matches('/').replace("**/", "").replace("**", "*"), anchored, negate }
        })
        .filter(|r| !r.glob.is_empty())
        .collect()
}

fn ignored(rules: &[Rule], child: &Path) -> bool {
    let name: Vec<char> = child.file_name().map(|n| n.to_string_lossy().chars().collect()).unwrap_or_default();
    rules.iter().rev().find(|r| {
        if r.anchored {
            let Ok(rel) = child.strip_prefix(&r.base) else { return false };
            let rel: Vec<char> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/").chars().collect();
            glob(&r.glob.chars().collect::<Vec<_>>(), &rel)
        } else {
            glob(&r.glob.chars().collect::<Vec<_>>(), &name)
        }
    })
    .is_some_and(|r| !r.negate)
}

/// For a `.git` file (a linked worktree), the main checkout it belongs to.
fn main_of_linked(dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dir.join(".git")).ok()?;
    let target = PathBuf::from(text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim());
    let target = if target.is_absolute() { target } else { dir.join(target) };
    let comps: Vec<_> = target.components().collect();
    let at = comps.iter().rposition(|c| c.as_os_str() == "worktrees")?;
    // <main>/.git/worktrees/<name>: the main checkout is two levels above `worktrees`.
    let git_dir: PathBuf = comps[..at].iter().collect();
    let main = git_dir.parent()?.to_path_buf();
    main.is_dir().then_some(main)
}

fn is_bare(dir: &Path) -> bool {
    dir.join("HEAD").is_file() && dir.join("objects").is_dir() && dir.join("refs").is_dir()
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().trim_end_matches(".git").to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| p.display().to_string())
}

/// Scans `root`. `on_found` hears each repository as it is found, `on_visit` the number of folders
/// looked at so far (every 25 folders and at the end); `stop` is asked before every folder.
pub fn scan(root: &Path, limits: &Limits, stop: &dyn Fn() -> bool, on_found: &mut dyn FnMut(Found), on_visit: &mut dyn FnMut(usize)) -> Outcome {
    let mut out = Outcome { visited: 0, found: 0, stopped: false, limit: None };
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(PathBuf, usize, Rc<Vec<Rule>>)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0, Rc::new(Vec::new())));
    while let Some((dir, depth, inherited)) = queue.pop_front() {
        if stop() {
            out.stopped = true;
            break;
        }
        if out.visited >= limits.visited {
            out.limit = Some("folders");
            break;
        }
        out.visited += 1;
        if out.visited.is_multiple_of(25) {
            on_visit(out.visited);
        }
        let git = dir.join(".git");
        let kind = std::fs::symlink_metadata(&git).ok();
        let found = if let Some(m) = kind {
            if m.is_dir() {
                Some(Found { path: dir.display().to_string(), name: name_of(&dir), bare: false, linked: None })
            } else {
                match main_of_linked(&dir) {
                    Some(main) => Some(Found { path: main.display().to_string(), name: name_of(&main), bare: false, linked: Some(dir.display().to_string()) }),
                    None => Some(Found { path: dir.display().to_string(), name: name_of(&dir), bare: false, linked: None }),
                }
            }
        } else if is_bare(&dir) {
            Some(Found { path: dir.display().to_string(), name: name_of(&dir), bare: true, linked: None })
        } else {
            None
        };
        if let Some(f) = found {
            if seen.insert(f.path.to_lowercase()) {
                out.found += 1;
                on_found(f);
                if out.found >= limits.found {
                    out.limit = Some("repositories");
                    break;
                }
            }
            continue; // a repository is not entered
        }
        if depth >= limits.depth {
            out.limit = out.limit.or(Some("depth"));
            continue;
        }
        let mut rules = (*inherited).iter().map(|r| Rule { base: r.base.clone(), glob: r.glob.clone(), anchored: r.anchored, negate: r.negate }).collect::<Vec<_>>();
        rules.extend(rules_of(&dir, ".gitignore"));
        rules.extend(rules_of(&dir, ".ignore"));
        let rules = Rc::new(rules);
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        let mut kids: Vec<PathBuf> = read
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
            .map(|e| e.path())
            .filter(|p| p.file_name().is_some_and(|n| !HEAVY.contains(&n.to_string_lossy().as_ref()) || p.join(".git").exists()) && !ignored(&rules, p))
            .collect();
        kids.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
        for k in kids {
            queue.push_back((k, depth + 1, rules.clone()));
        }
    }
    on_visit(out.visited);
    out
}

/// Steady labels for the checklist: the folder name, and where two share one, enough of the path
/// below `root` to tell them apart. Depends only on the paths, never on the order found.
pub fn labels(root: &Path, repos: &[PathBuf]) -> Vec<String> {
    let parts: Vec<Vec<String>> = repos
        .iter()
        .map(|r| r.strip_prefix(root).unwrap_or(r).components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect())
        .collect();
    let mut depth = vec![1usize; repos.len()];
    let label = |i: usize, d: usize| parts[i][parts[i].len().saturating_sub(d)..].join("/");
    loop {
        let now: Vec<String> = (0..repos.len()).map(|i| label(i, depth[i])).collect();
        let mut grew = false;
        for i in 0..repos.len() {
            if depth[i] < parts[i].len() && now.iter().enumerate().any(|(j, l)| j != i && *l == now[i]) {
                depth[i] += 1;
                grew = true;
            }
        }
        if !grew {
            return (0..repos.len()).map(|i| label(i, depth[i])).collect();
        }
    }
}

#[derive(Default)]
struct Node {
    repos: Vec<String>,
    dirs: BTreeMap<String, Node>,
}

fn insert(node: &mut Node, comps: &[String], id: &str) {
    if comps.len() <= 1 {
        node.repos.push(id.to_string());
    } else {
        insert(node.dirs.entry(comps[0].clone()).or_default(), &comps[1..], id);
    }
}

/// A folder that only leads on to one other folder is folded into it: one sub-group per place the
/// layout really branches or holds a repository, named by the folders joined with "/".
fn collapse<'a>(name: &str, mut n: &'a Node) -> (String, &'a Node) {
    let mut label = name.to_string();
    while n.repos.is_empty() && n.dirs.len() == 1 {
        let (k, c) = n.dirs.iter().next().expect("one entry");
        label = format!("{label}/{k}");
        n = c;
    }
    (label, n)
}

fn apply(g: &mut Groups, node: &Node, parent: Option<&str>) -> Result<(), String> {
    for id in &node.repos {
        g.put(id, parent)?;
    }
    for (name, child) in &node.dirs {
        let (label, leaf) = collapse(name, child);
        let sub = g.create(&label, parent)?;
        apply(g, leaf, Some(&sub.id))?;
    }
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub projects: Vec<Project>,
    pub group: Option<Group>,
    pub groups: Groups,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, serde::Serialize)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

/// PROJ-013: registers each located repository (`top`, `main`) and, grouped, puts them in one new
/// group named `name` (blank: the scanned folder's name) with sub-groups mirroring the folder
/// layout below `root`. Separate leaves each one a top-level project. A repository already a
/// project is reused, not added twice.
pub fn import(store: &Store, root: &Path, located: Vec<(PathBuf, PathBuf)>, grouped: bool, name: &str) -> Result<Imported, String> {
    let mut projects_in = Vec::new();
    let mut layout = Node::default();
    for (top, main) in located {
        let rel: Vec<String> = match top.strip_prefix(root) {
            Ok(r) if r.components().count() > 0 => r.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect(),
            _ => vec![name_of(&top)],
        };
        let p = projects::register_project(store, (top, main))?;
        insert(&mut layout, &rel, &p.id);
        projects_in.push(p);
    }
    if !grouped || projects_in.is_empty() {
        return Ok(Imported { projects: projects_in, group: None, groups: groups::load(store), skipped: Vec::new() });
    }
    let label = if name.trim().is_empty() { name_of(root) } else { name.trim().to_string() };
    let (groups, group) = groups::change(store, |g| {
        let top = g.create(&label, None)?;
        apply(g, &layout, Some(&top.id))?;
        Ok(top)
    })?;
    Ok(Imported { projects: projects_in, group: Some(group), groups, skipped: Vec::new() })
}

/// A scan the window asked to stop.
fn stops() -> &'static Mutex<HashSet<u64>> {
    static STOPS: OnceLock<Mutex<HashSet<u64>>> = OnceLock::new();
    STOPS.get_or_init(Default::default)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanEvent {
    scan_id: u64,
    found: Option<Found>,
    visited: usize,
    count: usize,
    done: bool,
    stopped: bool,
    limit: Option<&'static str>,
}

/// PROJ-012: starts a scan in the background; `repo-scan` events carry each repository found,
/// the running count of folders looked at, and a last one with `done`.
#[tauri::command]
pub fn repo_scan_start(app: tauri::AppHandle, root: String, scan_id: u64) -> Result<(), String> {
    use tauri::Emitter;
    let root = PathBuf::from(root.trim());
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("{} is not an existing folder", root.display()));
    }
    stops().lock().unwrap_or_else(|e| e.into_inner()).remove(&scan_id);
    std::thread::spawn(move || {
        let count = std::cell::Cell::new(0usize);
        let visited = std::cell::Cell::new(0usize);
        let stop = || stops().lock().unwrap_or_else(|e| e.into_inner()).contains(&scan_id);
        let ev = |found: Option<Found>, done: bool, stopped: bool, limit| ScanEvent { scan_id, found, visited: visited.get(), count: count.get(), done, stopped, limit };
        let end = scan(
            &root,
            &LIMITS,
            &stop,
            &mut |f| {
                count.set(count.get() + 1);
                let _ = app.emit("repo-scan", ev(Some(f), false, false, None));
            },
            &mut |n| {
                visited.set(n);
                let _ = app.emit("repo-scan", ev(None, false, false, None));
            },
        );
        visited.set(end.visited);
        let _ = app.emit("repo-scan", ev(None, true, end.stopped, end.limit));
        stops().lock().unwrap_or_else(|e| e.into_inner()).remove(&scan_id);
    });
    Ok(())
}

/// PROJ-012: stops a scan; what it found stays selectable.
#[tauri::command]
pub fn repo_scan_stop(scan_id: u64) {
    stops().lock().unwrap_or_else(|e| e.into_inner()).insert(scan_id);
}

/// PROJ-013: steady checklist labels for the found paths.
#[tauri::command]
pub fn repo_scan_labels(root: String, paths: Vec<String>) -> Vec<String> {
    labels(Path::new(&root), &paths.iter().map(PathBuf::from).collect::<Vec<_>>())
}

/// PROJ-013: imports the ticked repositories. Git runs with the store let go.
#[tauri::command(async)]
pub fn repo_import(git: tauri::State<'_, crate::git::Git>, store: tauri::State<'_, Mutex<Store>>, root: String, paths: Vec<String>, grouped: bool, name: String) -> Result<Imported, String> {
    let mut located = Vec::new();
    let mut skipped = Vec::new();
    for p in paths {
        match projects::locate_repo(&git, Path::new(&p)) {
            Ok(pair) => located.push(pair),
            Err(reason) => skipped.push(Skipped { path: p, reason }),
        }
    }
    let mut done = import(&*store.lock().map_err(|e| e.to_string())?, Path::new(&root), located, grouped, &name)?;
    done.skipped = skipped;
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-reposcan-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn repo(at: &Path) {
        fs::create_dir_all(at.join(".git")).unwrap();
    }

    fn run(root: &Path, limits: &Limits, stop: &dyn Fn() -> bool) -> (Vec<Found>, Outcome) {
        let found = RefCell::new(Vec::new());
        let out = scan(root, limits, stop, &mut |f| found.borrow_mut().push(f), &mut |_| {});
        (found.into_inner(), out)
    }

    fn rel(root: &Path, f: &[Found]) -> Vec<String> {
        f.iter().map(|f| Path::new(&f.path).strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| f.path.clone())).collect()
    }

    #[test]
    fn proj012_three_repositories_and_a_dependency_folder_lists_three_and_never_opens_the_dependency_folder() {
        let root = temp("three");
        for n in ["a", "b", "c"] {
            repo(&root.join(n));
        }
        repo(&root.join("node_modules").join("pkg")); // would be found if the folder were opened
        fs::create_dir_all(root.join("docs")).unwrap();
        let (found, out) = run(&root, &LIMITS, &|| false);
        assert_eq!(rel(&root, &found), ["a", "b", "c"]);
        assert_eq!(out.visited, 5, "the folder itself, a, b, c and docs; node_modules was skipped");
        assert!(!out.stopped && out.limit.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj012_goes_level_by_level_in_alphabetical_order_and_does_not_enter_a_repository() {
        let root = temp("order");
        repo(&root.join("b"));
        repo(&root.join("c"));
        repo(&root.join("a").join("deep"));
        repo(&root.join("b").join("inner")); // inside a repository: not entered
        let (found, _) = run(&root, &LIMITS, &|| false);
        assert_eq!(rel(&root, &found), ["b", "c", "a/deep"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj012_ignore_files_hide_folders_and_a_bare_repository_is_recognised_without_being_entered() {
        let root = temp("ignore");
        fs::write(root.join(".gitignore"), "scratch/\n# note\n/gen*\n").unwrap();
        fs::write(root.join(".ignore"), "tmp\n").unwrap();
        for n in ["scratch/x", "generated/y", "tmp/z", "kept"] {
            repo(&root.join(n));
        }
        let bare = root.join("origin.git");
        fs::create_dir_all(bare.join("objects").join("inner").join(".git")).unwrap();
        fs::create_dir_all(bare.join("refs")).unwrap();
        fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let (found, _) = run(&root, &LIMITS, &|| false);
        assert_eq!(rel(&root, &found), ["kept", "origin.git"]);
        assert!(found[1].bare && !found[0].bare);
        assert_eq!(found[1].name, "origin");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn row103_a_re_shown_folder_is_scanned_and_a_repository_named_like_a_dependency_folder_is_found() {
        let root = temp("reshow");
        fs::write(root.join(".gitignore"), "gen*\n!gen-keep\n").unwrap();
        for n in ["gen-keep/r", "gen-x/r", "target"] {
            repo(&root.join(n));
        }
        repo(&root.join("node_modules").join("pkg")); // a plain dependency folder is still not opened
        let (found, _) = run(&root, &LIMITS, &|| false);
        assert_eq!(rel(&root, &found), ["target", "gen-keep/r"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj012_stopping_early_keeps_what_was_found_and_limits_bound_the_scan() {
        let root = temp("stop");
        for n in ["a", "b", "c", "d"] {
            repo(&root.join(n));
        }
        let hits = Cell::new(0usize);
        let found = RefCell::new(Vec::new());
        let stop = || hits.get() >= 2;
        let out = scan(&root, &LIMITS, &stop, &mut |f| (hits.set(hits.get() + 1), found.borrow_mut().push(f)).1, &mut |_| {});
        assert!(out.stopped);
        assert_eq!(rel(&root, &found.borrow()), ["a", "b"], "the two found before the stop are kept");
        let (f, out) = run(&root, &Limits { depth: 6, found: 3, visited: 100 }, &|| false);
        assert_eq!((f.len(), out.limit), (3, Some("repositories")));
        let (_, out) = run(&root, &Limits { depth: 6, found: 100, visited: 2 }, &|| false);
        assert_eq!(out.limit, Some("folders"));
        let deep = temp("deep");
        repo(&deep.join("l1").join("l2").join("l3"));
        let (f, out) = run(&deep, &Limits { depth: 2, found: 10, visited: 100 }, &|| false);
        assert_eq!((f.len(), out.limit), (0, Some("depth")));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&deep);
    }

    #[test]
    fn proj012_symbolic_links_are_not_followed() {
        let root = temp("links");
        let outside = temp("links-outside");
        repo(&outside.join("secret"));
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, root.join("link")).is_ok();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, root.join("link")).is_ok();
        if made {
            let (found, _) = run(&root, &LIMITS, &|| false);
            assert!(found.is_empty(), "a repository behind a link is not found");
        }
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn proj013_a_linked_worktree_found_by_the_scan_is_mapped_to_its_main_checkout() {
        let root = temp("linked");
        let main = root.join("main");
        repo(&main);
        fs::create_dir_all(main.join(".git").join("worktrees").join("wt")).unwrap();
        let wt = root.join("wt");
        fs::create_dir_all(&wt).unwrap();
        let gitdir = main.join(".git").join("worktrees").join("wt");
        fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();
        let (found, _) = run(&root, &LIMITS, &|| false);
        assert_eq!(rel(&root, &found), ["main"], "the worktree maps to the main checkout already found");
        // a worktree whose main checkout is outside the scanned folder lists that main checkout
        let other = temp("linked-other");
        let (found, _) = run(&other, &LIMITS, &|| false);
        assert!(found.is_empty());
        fs::remove_dir_all(&main).unwrap();
        let outer = temp("linked-main");
        repo(&outer);
        fs::create_dir_all(outer.join(".git").join("worktrees").join("wt")).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", outer.join(".git").join("worktrees").join("wt").display())).unwrap();
        let (found, _) = run(&root, &LIMITS, &|| false);
        assert_eq!((found.len(), Path::new(&found[0].path) == outer, found[0].linked.is_some()), (1, true, true));
        for d in [root, other, outer] {
            let _ = fs::remove_dir_all(&d);
        }
    }

    fn located(root: &Path, rels: &[&str]) -> Vec<(PathBuf, PathBuf)> {
        rels.iter().map(|r| (root.join(r), root.join(r))).collect()
    }

    fn store(base: &Path) -> Store {
        Store::open(&base.join("db")).unwrap()
    }

    #[test]
    fn proj013_one_group_mirrors_the_layout_x_directly_and_z_inside_a_sub_group_for_y() {
        let root = temp("group");
        let s = store(&root);
        let done = import(&s, &root.join("work"), located(&root.join("work"), &["x", "y/z"]), true, "  ").unwrap();
        let top = done.group.expect("a group");
        assert_eq!(top.name, "work", "a blank name falls back to the parent folder's name");
        let by_name = |n: &str| done.projects.iter().find(|p| p.name == n).unwrap().id.clone();
        assert_eq!(done.groups.members[&by_name("x")], top.id);
        let sub = done.groups.groups.iter().find(|g| g.name == "y").expect("sub-group y");
        assert_eq!(sub.parent.as_deref(), Some(top.id.as_str()));
        assert_eq!(done.groups.members[&by_name("z")], sub.id);
        assert_eq!(done.groups.groups.len(), 2);
        // importing again reuses the projects
        let again = import(&s, &root.join("work"), located(&root.join("work"), &["x"]), false, "").unwrap();
        assert_eq!(again.projects[0].id, by_name("x"));
        assert_eq!(projects::load_projects(&s).len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj013_in_between_folders_fold_into_one_sub_group_and_separate_projects_stay_top_level() {
        let root = temp("fold");
        let s = store(&root);
        let done = import(&s, &root.join("src"), located(&root.join("src"), &["a/b/c/app", "a/b/c/lib", "solo/tool"]), true, "Mine").unwrap();
        let names: Vec<&str> = done.groups.groups.iter().map(|g| g.name.as_str()).collect();
        assert!(names.contains(&"Mine") && names.contains(&"a/b/c") && names.contains(&"solo"), "{names:?}");
        assert_eq!(done.groups.groups.len(), 3, "no empty a or a/b group");
        let s2 = store(&temp("fold2"));
        let sep = import(&s2, &root.join("src"), located(&root.join("src"), &["a", "b"]), false, "ignored").unwrap();
        assert!(sep.group.is_none() && sep.groups.groups.is_empty() && sep.groups.members.is_empty());
        assert_eq!(sep.projects.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj013_repositories_sharing_a_name_get_steady_labels_that_tell_them_apart() {
        let root = Path::new("C:/code");
        let a = vec![root.join("one/app"), root.join("two/app"), root.join("lib")];
        let labels_a = labels(root, &a);
        assert_eq!(labels_a, ["one/app", "two/app", "lib"]);
        let b = vec![root.join("lib"), root.join("two/app"), root.join("one/app")];
        assert_eq!(labels(root, &b), ["lib", "two/app", "one/app"], "the same label for the same path in any order");
        let deep = vec![root.join("a/x/app"), root.join("b/x/app")];
        assert_eq!(labels(root, &deep), ["a/x/app", "b/x/app"]);
    }
}
