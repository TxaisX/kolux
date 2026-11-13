//! PROJ-003 and PROJ-004: copying a project from a web address into a suggested folder, and
//! starting a brand-new empty project from a name.
use crate::git::{Git, NO_PROMPT};
use crate::projects::{add_project, non_blank, Project, WORKSPACES_DIR_ENV, WORKSPACES_DIR_SETTING};
use crate::state::Store;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Condvar, Mutex, OnceLock, PoisonError};
use tauri::{AppHandle, Emitter, Manager, State};

const NOT_INSTALLED: &str = "Git is not installed on this computer, or Kolux cannot find it. Install Git from https://git-scm.com, then try again.";

/// PROJ-003: the address Git is given. A user name, password or token in a web address is taken
/// out (an ssh login name stays, since ssh signs in with it, but a password goes); relative
/// addresses and ones with `.` or `..` path parts are refused.
pub fn clean_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("Paste the project's web address first.".into());
    }
    let refuse = || Err(format!("{url} is not a full web address; paste one like https://github.com/owner/project.git"));
    let (head, path) = if let Some(at) = url.find("://") {
        let scheme = &url[..at];
        if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
            return refuse();
        }
        let rest = &url[at + 3..];
        let (auth, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
        let host = match auth.rfind('@') {
            Some(i) if scheme.to_ascii_lowercase().contains("ssh") => format!("{}@{}", auth[..i].split(':').next().unwrap_or(""), &auth[i + 1..]),
            Some(i) => auth[i + 1..].to_string(),
            None => auth.to_string(),
        };
        if host.is_empty() && !scheme.eq_ignore_ascii_case("file") {
            return refuse();
        }
        (format!("{scheme}://{host}"), path)
    } else if Path::new(url).is_absolute() {
        (String::new(), url)
    } else {
        // scp-like `user@host:path`: a colon before any slash, after more than a drive letter.
        match url.find(':') {
            Some(c) if c > 1 && !url[..c].contains(['/', '\\']) => (url[..=c].to_string(), &url[c + 1..]),
            _ => return refuse(),
        }
    };
    if path.split(['/', '\\']).any(|s| s == "." || s == "..") {
        return Err(format!("{url} has a . or .. part in its path; paste the project's own address"));
    }
    Ok(format!("{head}{path}"))
}

/// The project's folder name from its address: the last part, without `.git`.
fn repo_name(url: &str) -> Result<String, String> {
    let url = clean_url(url)?;
    let tail = url.trim_end_matches(['/', '\\']);
    let after_host = tail.find("://").map(|i| &tail[i + 3..]).unwrap_or(tail);
    let name = after_host.rsplit(['/', '\\', ':']).next().unwrap_or("").trim_end_matches(".git");
    if name.is_empty() || !after_host.contains(['/', '\\', ':']) {
        return Err(format!("{url} does not name a project; paste the address of the project itself"));
    }
    Ok(name.to_string())
}

/// PROJ-003: where the copy goes unless the user changes it: the folder above the workspaces
/// folder when one is set (so a final `workspaces` part is dropped), else the home folder.
pub fn suggest_target(set: Option<&str>, home: &Path, url: &str) -> Result<PathBuf, String> {
    let base = non_blank(set).map(|s| Path::new(s).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(s))).unwrap_or_else(|| home.to_path_buf());
    Ok(base.join(repo_name(url)?))
}

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

#[derive(Default)]
struct Clones {
    running: Mutex<HashMap<String, u32>>,
    cancelled: Mutex<HashSet<String>>,
    busy: Mutex<HashSet<String>>,
    freed: Condvar,
}

fn clones() -> &'static Clones {
    static C: OnceLock<Clones> = OnceLock::new();
    C.get_or_init(Clones::default)
}

/// PROJ-003: one clone at a time per target folder; a second one waits until the first is done.
struct Turn(String);
impl Turn {
    fn take(dir: &Path) -> Turn {
        let key = dir.to_string_lossy().trim_end_matches(['/', '\\']).replace('\\', "/");
        let key = if cfg!(windows) { key.to_lowercase() } else { key };
        let c = clones();
        let mut busy = c.busy.lock().unwrap_or_else(PoisonError::into_inner);
        while busy.contains(&key) {
            busy = c.freed.wait(busy).unwrap_or_else(PoisonError::into_inner);
        }
        busy.insert(key.clone());
        Turn(key)
    }
}
impl Drop for Turn {
    fn drop(&mut self) {
        let c = clones();
        c.busy.lock().unwrap_or_else(PoisonError::into_inner).remove(&self.0);
        c.freed.notify_all();
    }
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).output();
    }
    #[cfg(not(windows))]
    {
        let _ = crate::winproc::command("kill").args(["-9", &pid.to_string()]).output();
    }
}

/// PROJ-003: stops the clone with this ticket (or, if it has not started yet, stops it as it starts).
pub fn cancel_clone(ticket: &str) {
    let c = clones();
    c.cancelled.lock().unwrap_or_else(PoisonError::into_inner).insert(ticket.to_string());
    if let Some(pid) = c.running.lock().unwrap_or_else(PoisonError::into_inner).get(ticket) {
        kill_tree(*pid);
    }
}

fn is_empty_dir(dir: &Path) -> bool {
    std::fs::read_dir(dir).map(|mut r| r.next().is_none()).unwrap_or(false)
}

/// Puts the target back as it was: a folder this clone made is removed; one that was there (and,
/// since Git only clones into an empty one, was empty) is emptied again. Retries while a killed
/// Git's children let go of their files.
fn undo(dest: &Path, existed: bool) {
    for _ in 0..50 {
        let gone = if existed {
            std::fs::read_dir(dest).map(|r| r.flatten().all(|e| std::fs::remove_dir_all(e.path()).or_else(|_| std::fs::remove_file(e.path())).is_ok())).unwrap_or(true)
        } else {
            !dest.exists() || std::fs::remove_dir_all(dest).is_ok()
        };
        if gone {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// PROJ-003: clones `url` (cleaned first) into `dest`, handing each progress line to `on_line`.
/// Git never asks for a password; a failure returns Git's complete error text.
pub fn clone_into(url: &str, dest: &Path, ticket: &str, on_line: impl FnMut(&str)) -> Result<(), String> {
    clone_with(url, dest, ticket, &[], on_line)
}

/// clone_into with `extra` arguments for git clone (the tests point it at a stand-in upload-pack).
fn clone_with(url: &str, dest: &Path, ticket: &str, extra: &[&str], mut on_line: impl FnMut(&str)) -> Result<(), String> {
    let url = clean_url(url)?;
    if !dest.is_absolute() {
        return Err(format!("{} is not a full path; choose the folder the copy goes in", dest.display()));
    }
    let _turn = Turn::take(dest);
    let existed = dest.exists();
    if existed && !is_empty_dir(dest) {
        return Err(format!("{} already has files in it; choose an empty or new folder", dest.display()));
    }
    let target = dest.to_string_lossy().into_owned();
    let mut args = vec!["-c", "credential.interactive=never", "clone", "--progress"];
    args.extend_from_slice(extra);
    args.extend(["--", url.as_str(), target.as_str()]);
    let mut cmd = crate::git::command(&args, None);
    cmd.envs(NO_PROMPT).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|_| NOT_INSTALLED.to_string())?;
    // T-562: everything Git starts (git-upload-pack and its helpers) joins a kill-on-close job, so a
    // cancel ends the whole tree, even a process whose parent is already gone. ponytail: one started
    // in the few ms before the assignment escapes the job; the error output below never waits on it.
    let mut job = crate::procs::Job::new().ok().filter(|j| j.assign_pid(child.id()).is_ok());
    let c = clones();
    c.running.lock().unwrap_or_else(PoisonError::into_inner).insert(ticket.to_string(), child.id());
    let is_cancelled = || c.cancelled.lock().unwrap_or_else(PoisonError::into_inner).contains(ticket);
    // T-562: the error output is read on its own thread, because a leftover process can hold the pipe
    // open long after Git has gone; this side only waits for it while Git runs, and briefly after.
    let chunks = child.stderr.take().map(|mut e| {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n @ 1..) = e.read(&mut buf) {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        rx
    });
    // Progress overwrites its own line with \r; the error text keeps each line's last state.
    let mut log: Vec<String> = vec![];
    let mut line = String::new();
    let tick = std::time::Duration::from_millis(50);
    let mut ended: Option<std::time::Instant> = None;
    let mut stopped = false;
    loop {
        if !stopped && is_cancelled() {
            stopped = true;
            drop(job.take()); // closing the job ends every process in it
            kill_tree(child.id());
            let _ = child.kill();
        }
        if ended.is_none() && matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
            ended = Some(std::time::Instant::now());
        }
        // A cancelled clone stops listening at once; a finished one gives the pipe 2 s to drain.
        if stopped || ended.is_some_and(|t| t.elapsed() > std::time::Duration::from_secs(2)) {
            break;
        }
        let Some(rx) = chunks.as_ref() else {
            if ended.is_some() {
                break;
            }
            std::thread::sleep(tick);
            continue;
        };
        let chunk = match rx.recv_timeout(tick) {
            Ok(chunk) => chunk,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) if ended.is_some() => break,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                std::thread::sleep(tick);
                continue;
            }
        };
        for ch in String::from_utf8_lossy(&chunk).chars() {
            if ch == '\r' || ch == '\n' {
                if !line.trim().is_empty() {
                    on_line(line.trim());
                }
                if ch == '\n' {
                    log.push(std::mem::take(&mut line));
                } else {
                    line.clear();
                }
            } else {
                line.push(ch);
            }
        }
    }
    log.push(line);
    let status = child.wait();
    // Whatever Git left behind ends with it, so it lets go of the folder before any undo.
    drop(job);
    c.running.lock().unwrap_or_else(PoisonError::into_inner).remove(ticket);
    let cancelled = c.cancelled.lock().unwrap_or_else(PoisonError::into_inner).remove(ticket);
    if cancelled {
        undo(dest, existed);
        return Err("Cancelled; the copy was stopped and its folder put back as it was.".into());
    }
    match status {
        Ok(s) if s.success() => Ok(()),
        other => {
            undo(dest, existed);
            // GIT-062: one line of reason, never the progress output.
            Err(crate::git::failure_reason(&log.join("\n")).unwrap_or_else(|| format!("git clone failed ({other:?})")))
        }
    }
}

fn git_ready(ident: &[&str]) -> Result<(), String> {
    crate::git::run(&["--version"], None).map_err(|_| NOT_INSTALLED.to_string())?;
    let known = |key: &str| {
        let mut args = ident.to_vec();
        args.extend(["config", key]);
        crate::git::run(&args, None).is_ok_and(|v| !v.is_empty())
    };
    if !known("user.name") || !known("user.email") {
        return Err("Git does not know your name and email yet, and every commit carries them. Set them once in a terminal with git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\", then try again.".into());
    }
    Ok(())
}

/// PROJ-004: a new folder `name` under `parent` holding a fresh repository with one empty first
/// commit (`ident` is extra `-c` settings, for tests). A failed create undoes what it made.
pub fn create_project(parent: &Path, name: &str, ident: &[&str]) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("Choose a project name that is not . or .. and has no / or \\ in it.".into());
    }
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(format!("{} is not an existing folder; choose the folder the project goes in", parent.display()));
    }
    let target = parent.join(name);
    let existed = target.exists();
    if existed && !is_empty_dir(&target) {
        return Err(format!("{} already has files in it; choose another name or folder", target.display()));
    }
    git_ready(ident)?;
    if !existed {
        std::fs::create_dir(&target).map_err(|e| format!("could not make {}: {e}", target.display()))?;
    }
    let made = crate::git::run(&["init", "-q"], Some(&target)).and_then(|_| {
        let mut args = ident.to_vec();
        args.extend(["commit", "-q", "--allow-empty", "-m", "First commit"]);
        crate::git::run(&args, Some(&target))
    });
    if let Err(e) = made {
        undo(&target, existed);
        return Err(e);
    }
    Ok(target)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneSuggestion {
    url: String,
    dest: String,
}

/// PROJ-003: the cleaned address and the suggested target folder for a pasted address.
#[tauri::command]
pub fn clone_suggest(store: State<'_, Mutex<Store>>, url: String) -> Result<CloneSuggestion, String> {
    let setting = store.lock().map_err(|e| e.to_string())?.settings()[WORKSPACES_DIR_SETTING].as_str().map(str::to_string);
    let set = non_blank(setting.as_deref()).map(str::to_string).or_else(|| std::env::var(WORKSPACES_DIR_ENV).ok());
    let dest = suggest_target(set.as_deref(), &home(), &url)?;
    let dest = dest.display().to_string();
    let dest = if cfg!(windows) { dest.replace('/', "\\") } else { dest };
    Ok(CloneSuggestion { url: clean_url(&url)?, dest })
}

#[derive(Serialize, Clone)]
struct CloneLine {
    ticket: String,
    line: String,
}

/// PROJ-003: clones and adds the copy as a project; progress arrives as `clone-progress` events.
#[tauri::command]
pub async fn project_clone(app: AppHandle, url: String, dest: String, ticket: String) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = PathBuf::from(dest.trim());
        clone_into(&url, &dest, &ticket, |line| {
            let _ = app.emit("clone-progress", CloneLine { ticket: ticket.clone(), line: line.to_string() });
        })?;
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        add_project(&app.state::<Git>(), &store, &dest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn clone_cancel(ticket: String) {
    cancel_clone(&ticket);
}

#[derive(Serialize)]
pub struct NewDefaults {
    parent: String,
    problem: Option<String>,
}

/// PROJ-004: the folder a new project goes in unless the user changes it (always the home
/// folder), and what stops a create before it starts: Git missing, or no name and email set.
#[tauri::command]
pub fn project_new_defaults() -> NewDefaults {
    NewDefaults { parent: home().display().to_string(), problem: git_ready(&[]).err() }
}

/// PROJ-004: makes the new project and adds it.
#[tauri::command]
pub async fn project_create(app: AppHandle, name: String, parent: String) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let made = create_project(Path::new(parent.trim()), &name, &[])?;
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        add_project(&app.state::<Git>(), &store, &made)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-newproj-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} in {}", dir.display());
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn file_url(dir: &Path) -> String {
        format!("file:///{}", dir.display().to_string().replace('\\', "/").trim_start_matches('/'))
    }

    const IDENT: [&str; 4] = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

    #[test]
    fn proj003_a_pasted_address_loses_its_user_name_and_token_and_bad_ones_are_refused() {
        assert_eq!(clean_url(" https://me:ghp_secret@github.com/owner/project.git ").unwrap(), "https://github.com/owner/project.git");
        assert_eq!(clean_url("https://ghp_token@github.com/owner/project").unwrap(), "https://github.com/owner/project");
        // An ssh login name is how ssh signs in, so only a password goes.
        assert_eq!(clean_url("ssh://git:pw@host.example/owner/p.git").unwrap(), "ssh://git@host.example/owner/p.git");
        assert_eq!(clean_url("git@github.com:owner/project.git").unwrap(), "git@github.com:owner/project.git");
        assert_eq!(clean_url("file:///G:/Temp/repo").unwrap(), "file:///G:/Temp/repo");
        for bad in ["", "owner/project", "../project", "./project", "https://github.com/owner/../other", "https://github.com/./owner/p", "https:///owner/p"] {
            assert!(clean_url(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn proj003_the_target_is_the_folder_above_the_workspaces_folder_or_home() {
        let home = Path::new("C:/Users/me");
        assert_eq!(suggest_target(Some("D:/code/workspaces"), home, "https://github.com/o/project.git").unwrap(), Path::new("D:/code").join("project"));
        assert_eq!(suggest_target(None, home, "git@github.com:o/tool").unwrap(), home.join("tool"));
        assert_eq!(suggest_target(Some("  "), home, "https://github.com/o/app/").unwrap(), home.join("app"));
        assert!(suggest_target(None, home, "https://github.com/").is_err());
    }

    #[test]
    fn proj003_a_clone_copies_the_project_and_refuses_a_folder_with_files() {
        let root = temp("clone");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        git_in(&src, &["init", "-q", "-b", "main"]);
        fs::write(src.join("a.txt"), "a").unwrap();
        git_in(&src, &["add", "."]);
        git_in(&src, &["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "first"]);
        let url = file_url(&src);
        let dest = root.join("copy");
        let mut lines = vec![];
        clone_into(&url, &dest, "t1", |l| lines.push(l.to_string())).unwrap();
        assert!(dest.join("a.txt").is_file());
        assert!(lines.iter().any(|l| l.contains("Cloning into")), "{lines:?}");
        let err = clone_into(&url, &dest, "t2", |_| {}).unwrap_err();
        assert!(err.contains("already has files"), "{err}");
        assert!(dest.join("a.txt").is_file());
        // GIT-062: a failed clone comes back as git's one fatal reason, with no progress lines.
        let err = clone_into(&format!("{url}-missing"), &root.join("none"), "t3", |_| {}).unwrap_err();
        assert!(!err.contains('\n') && !err.contains("Cloning into") && !err.is_empty(), "{err}");
        assert!(!root.join("none").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj003_cancel_removes_only_a_folder_the_clone_made() {
        let root = temp("cancel");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        git_in(&src, &["init", "-q"]);
        git_in(&src, &["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "first"]);
        let url = file_url(&src);
        let fresh = root.join("fresh");
        cancel_clone("c1");
        assert!(clone_into(&url, &fresh, "c1", |_| {}).unwrap_err().contains("Cancelled"));
        assert!(!fresh.exists(), "a folder this clone made is gone");
        let kept = root.join("kept");
        fs::create_dir_all(&kept).unwrap();
        cancel_clone("c2");
        assert!(clone_into(&url, &kept, "c2", |_| {}).unwrap_err().contains("Cancelled"));
        assert!(kept.is_dir() && fs::read_dir(&kept).unwrap().next().is_none(), "a folder that was there is left as it was");
        let _ = fs::remove_dir_all(&root);
    }

    /// T-562: a cancel mid-clone returns within a bound even when a process the clone started has
    /// lost its parent and still holds Git's error output open (as an orphan git-upload-pack does).
    #[test]
    fn proj003_a_cancelled_clone_returns_at_once_though_an_orphan_holds_its_error_output() {
        let root = temp("orphan");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        git_in(&src, &["init", "-q"]);
        git_in(&src, &["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "first"]);
        // A stand-in upload-pack: it leaves a child whose parent is already gone (holding the error
        // output it was given), says it has started, then never answers.
        let marker = root.join("started");
        let slow = root.join("slow-upload-pack.sh");
        let fwd = |p: &Path| p.display().to_string().replace('\\', "/");
        fs::write(&slow, format!("(sleep 40 >/dev/null </dev/null &)\necho up > '{}'\nsleep 40 >/dev/null\n", fwd(&marker))).unwrap();
        let pack = format!("sh '{}'", fwd(&slow));
        let (url, dest) = (file_url(&src), root.join("copy"));
        let (tx, rx) = std::sync::mpsc::channel();
        let clone = std::thread::spawn(move || {
            let r = clone_with(&url, &dest, "orphan-1", &["--upload-pack", &pack], |_| {});
            tx.send((r, dest.exists())).unwrap();
        });
        let start = std::time::Instant::now();
        while !marker.exists() {
            assert!(start.elapsed() < std::time::Duration::from_secs(60), "the stand-in upload-pack never started");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        let cancelled = std::time::Instant::now();
        cancel_clone("orphan-1");
        let (r, left) = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("a cancelled clone returns within 10 s");
        eprintln!("T-562 cancel returned in {:?}", cancelled.elapsed());
        assert!(r.unwrap_err().contains("Cancelled"));
        assert!(!left, "the folder the clone made is gone");
        clone.join().unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj003_two_clones_aimed_at_one_folder_wait_for_each_other() {
        let dir = std::env::temp_dir().join("kolux-newproj-turn");
        let first = Turn::take(&dir);
        let (tx, rx) = std::sync::mpsc::channel();
        let other = dir.clone();
        let waiter = std::thread::spawn(move || {
            let _second = Turn::take(&other);
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(std::time::Duration::from_millis(300)).is_err(), "the second clone waits");
        drop(first);
        assert!(rx.recv_timeout(std::time::Duration::from_secs(5)).is_ok(), "and goes once the first is done");
        waiter.join().unwrap();
    }

    #[test]
    fn proj004_a_new_project_gets_one_empty_commit_and_bad_names_or_full_folders_are_refused() {
        let root = temp("create");
        let made = create_project(&root, "demo", &IDENT).unwrap();
        assert_eq!(made, root.join("demo"));
        assert_eq!(git_in(&made, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(git_in(&made, &["ls-files"]), "");
        for bad in ["", " ", ".", "..", "a/b", "a\\b"] {
            assert!(create_project(&root, bad, &IDENT).is_err(), "{bad:?} should be refused");
        }
        let full = root.join("full");
        fs::create_dir_all(&full).unwrap();
        fs::write(full.join("keep.txt"), "k").unwrap();
        assert!(create_project(&root, "full", &IDENT).unwrap_err().contains("already has files"));
        assert_eq!(fs::read_dir(&full).unwrap().count(), 1, "nothing is written");
        // No name or email: a plain explanation, and nothing left behind.
        let err = create_project(&root, "nobody", &["-c", "user.name=", "-c", "user.email="]).unwrap_err();
        assert!(err.contains("git config --global user.name"), "{err}");
        assert!(!root.join("nobody").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
