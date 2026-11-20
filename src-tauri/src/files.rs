// Saving a text file (EDIT-046). A save goes to a temporary file beside the target, is flushed to
// disk and is then moved over it, so a save that fails or is cut off never leaves a half-written file
// behind. Every command here takes only paths inside the user's projects and worktrees (ACCT-055,
// fence.rs); EDIT-045's `links::fence` guards `path_kind` (inside a project, never out through a
// link); the WSL and share parts of EDIT-045 are T-062.
use std::fs;
use std::io::Write;
use std::path::Path;

/// How old a leftover save copy must be before the next save of its file clears it away: far longer
/// than any save takes, so a copy belonging to a save in progress is never touched.
const STALE_COPY_SECS: u64 = 600;

pub fn write_text(path: &Path, text: &str) -> Result<(), String> {
    replace_with(path, false, |f| f.write_all(text.as_bytes()))
}

/// The same all-or-nothing save for raw bytes (row 947); a new file is owner-only on unix (row 952).
pub(crate) fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_with(path, true, |f| f.write_all(bytes))
}

/// EDIT-046: the all-or-nothing save. `put` fills a temporary file beside `path`; the file is
/// flushed to disk and only then moved over `path`. Any failure removes the temporary file and
/// leaves `path` exactly as it was. A copy left by an app that died mid-save is cleared the next
/// time that file is saved. T-617: a `path` that is a link is saved through: the file it leads to
/// gets the new text the same way (the temporary file beside it) and the link stays a link.
fn replace_with(path: &Path, private: bool, put: impl FnOnce(&mut fs::File) -> std::io::Result<()>) -> Result<(), String> {
    static COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    // A rename over the link would replace the link itself (CLAUDE.md -> AGENTS.md would split in two).
    // ponytail: the link is read again here, after the fence looked at it; a program that swaps it in
    // between is followed (it could write there itself); hand the fenced target down if that matters.
    let real = if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        // T-617b: copies named after the link itself (a save before T-617, which wrote beside the
        // link) are cleared beside it, even when the link leads nowhere and this save fails.
        if let (Some(name), Some(dir)) = (path.file_name(), path.parent()) {
            clear_stale_copies(if dir.as_os_str().is_empty() { Path::new(".") } else { dir }, &format!(".{}.kolux-save-", name.to_string_lossy()));
        }
        fs::canonicalize(path).map_err(|e| format!("could not save {}: {e}", path.display()))?
    } else {
        path.to_path_buf()
    };
    let name = real.file_name().ok_or_else(|| format!("{} is not a file path", path.display()))?;
    let dir = real.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let prefix = format!(".{}.kolux-save-", name.to_string_lossy());
    clear_stale_copies(dir, &prefix);
    let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = dir.join(format!("{prefix}{}-{n}", std::process::id()));
    let fail = |e: std::io::Error| {
        let _ = fs::remove_file(&temp);
        format!("could not save {}: {e}", path.display())
    };
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    if private {
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600); // never world-readable, even in a crash copy; an existing target's mode wins below
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut f = opts.open(&temp).map_err(fail)?;
    put(&mut f).and_then(|_| f.flush()).and_then(|_| f.sync_all()).map_err(fail)?;
    drop(f);
    #[cfg(unix)]
    if let Ok(meta) = fs::metadata(&real) {
        let _ = fs::set_permissions(&temp, meta.permissions());
    }
    fs::rename(&temp, &real).map_err(fail)?;
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all(); // the swap itself reaches the disk
    }
    Ok(())
}

fn clear_stale_copies(dir: &Path, prefix: &str) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if !e.file_name().to_string_lossy().starts_with(prefix) {
            continue;
        }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > STALE_COPY_SECS);
        if old && e.path().is_file() {
            let _ = fs::remove_file(e.path());
        }
    }
}

type Store<'a> = tauri::State<'a, std::sync::Mutex<crate::state::Store>>;

/// T-073 (EDIT-003): what a cheap disk-change check compares: the modified time in milliseconds
/// and the size in bytes. It is advisory only; a same-size rewrite inside one check or a tool that
/// puts the old modified time back slips past it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Stamp {
    pub mtime: u64,
    pub size: u64,
}

/// The stamp of a file, or None when it is gone or cannot be looked at.
pub fn stamp_of(path: &Path) -> Option<Stamp> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(Stamp { mtime, size: meta.len() })
}

/// T-073 (EDIT-003): the stamps of the files open in editor tabs, in the order asked, None for a
/// file that is gone, unreadable or outside the projects. The editor asks every two seconds for
/// the tabs in front and when the window gets focus.
/// ponytail: polling; a file watcher (the one the git-status lane adds) is the upgrade path, so the
/// two never both add a dependency.
#[tauri::command(async)]
pub fn file_stamps(paths: Vec<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Vec<Option<Stamp>> {
    // The editor asks for the tabs in front; a page cannot turn this into a whole-drive scan.
    const MAX_STAMPS: usize = 4_096;
    paths.iter().take(MAX_STAMPS).map(|p| fence.allow(p, &store, &git, true).ok().and_then(|p| stamp_of(&p))).collect()
}

/// ACCT-055: Open a file shows the system picker here, so only the file the user chose is
/// granted (never its folder); none when the picker was cancelled.
#[tauri::command]
pub async fn file_pick(app: tauri::AppHandle, default_path: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // The dialog blocks until closed; keep it off the async runtime's threads.
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut pick = app.dialog().file().set_title("Open a file");
        if let Some(dir) = default_path {
            pick = pick.set_directory(dir);
        }
        pick.blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    finish_pick(&fence, &store, &path).map(Some)
}

/// A pick the fence refuses outright (share, no drive, unresolvable, not a file) is an Err. A grant
/// that only failed to save (a poisoned grants key) still holds in memory this run, so the pick stands.
fn finish_pick(fence: &crate::fence::Fence, store: &std::sync::Mutex<crate::state::Store>, path: &Path) -> Result<String, String> {
    // Row 907: a name that is not valid Unicode cannot be saved or handed on as it is, so it is refused before grant pushes it.
    let Some(spelled) = path.to_str() else { return Err("Kolux cannot open that file because its name is not valid Unicode. Rename it and pick it again".to_string()) };
    match fence.grant(path, &*store.lock().map_err(|e| e.to_string())?) {
        Err(crate::fence::GrantError::Refused(e)) => return Err(e),
        Err(crate::fence::GrantError::SaveFailed(e)) => eprintln!("kolux: the picked file's grant was not saved: {e}"),
        Ok(()) => {}
    }
    Ok(spelled.to_owned())
}

/// Quick Open's list of the worktree's files (EDIT-036), as paths relative to the worktree with
/// forward slashes, in natural order. ripgrep lists them: it honours .gitignore and stays quick on
/// trees of 100,000 files. When it is not installed, git's own list stands in where the folder is
/// a repository (`source` says which one answered, "none" when neither could).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    files: Vec<String>,
    capped: bool,
    source: &'static str,
    rg_missing: bool,
}

const LIST_CAP: usize = 200_000;
/// Build caches and editor settings (the Next framework's, VS Code's and JetBrains IDEs'), plus git's own folder.
const LEFT_OUT: [&str; 4] = [".git", ".next", ".vscode", ".idea"];

fn rg(root: &Path) -> std::io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new("rg");
    cmd.args(["--files", "--hidden", "--no-messages", "--no-config"]);
    for dir in LEFT_OUT {
        cmd.args(["-g", &format!("!{dir}/")]);
    }
    cmd.current_dir(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::winproc::no_window()); // CREATE_NO_WINDOW
    }
    cmd.output()
}

/// Splits a name into runs of digits and runs of anything else.
fn runs(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    for i in 1..b.len() {
        if b[i].is_ascii_digit() != b[i - 1].is_ascii_digit() {
            out.push(&s[start..i]);
            start = i;
        }
    }
    if !s.is_empty() {
        out.push(&s[start..]);
    }
    out
}

/// A sort key for natural order: "file2" before "file10", letters compared without case. Each run
/// of digits is padded to 20 places, so plain string order on the keys counts the numbers.
pub fn natural_key(s: &str) -> String {
    runs(s)
        .into_iter()
        .map(|r| if r.as_bytes()[0].is_ascii_digit() { format!("{:0>20}", r.trim_start_matches('0')) } else { r.to_lowercase() })
        .collect()
}

/// Normalises a raw listing: forward slashes, nothing inside a nested worktree (a folder holding a
/// `.git` file or folder of its own) or a left-out folder, natural order, at most `cap` names.
pub fn shape(raw: &str, cap: usize) -> (Vec<String>, bool) {
    let names: Vec<String> = raw.split(['\n', '\0']).map(|n| n.trim_end_matches('\r').replace('\\', "/")).filter(|n| !n.is_empty()).collect();
    // git lists a nested repository as "dir/"; ripgrep lists a nested worktree's ".git" file.
    let nested: Vec<String> = names.iter().filter_map(|n| n.strip_suffix("/.git").map(|d| format!("{d}/")).or_else(|| n.ends_with('/').then(|| n.clone()))).collect();
    let mut files: Vec<String> = names
        .into_iter()
        .filter(|n| !n.ends_with('/') && n != ".git" && !n.split('/').any(|s| LEFT_OUT.contains(&s)) && !nested.iter().any(|d| n.starts_with(d.as_str())))
        .collect();
    files.sort_by_cached_key(|n| (natural_key(n), n.clone()));
    let capped = files.len() > cap;
    files.truncate(cap);
    (files, capped)
}

#[tauri::command]
pub async fn file_list(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<FileList, String> {
    let root = fence.allow(&root, &store, &git, false)?;
    let git = git.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = root.as_path();
        // A one-off failure to start ripgrep is tried once more; only "not found" means it is missing.
        let out = rg(root).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Err(e) } else { rg(root) });
        match out {
            Ok(o) => {
                let (files, capped) = shape(&String::from_utf8_lossy(&o.stdout), LIST_CAP);
                Ok(FileList { files, capped, source: "rg", rg_missing: false })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(match git.listed_files(root) {
                Ok(raw) => {
                    let (files, capped) = shape(&raw, LIST_CAP);
                    FileList { files, capped, source: "git", rg_missing: true }
                }
                Err(_) => FileList { files: Vec::new(), capped: false, source: "none", rg_missing: true },
            }),
            Err(e) => Err(format!("could not start ripgrep: {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod list_tests {
    use super::*;

    #[test]
    fn natural_order_counts_numbers() {
        let mut v = vec!["mod10.ts", "Mod2.ts", "mod1.ts", "a/b.ts", "mod02.ts"];
        v.sort_by_cached_key(|n| (natural_key(n), n.to_string()));
        assert_eq!(v, ["a/b.ts", "mod1.ts", "Mod2.ts", "mod02.ts", "mod10.ts"]);
    }

    #[test]
    fn leaves_out_nested_worktrees_and_tool_folders() {
        let raw = "src\\main.rs\r\nwt\\.git\nwt\\sub\\w.txt\n.next\\x.js\napp\\.idea\\w.xml\n.git\nsub/\nsub/x.txt\nfile10\nfile2\n";
        assert_eq!(shape(raw, 10), (vec!["file2".to_string(), "file10".into(), "src/main.rs".into()], false));
        assert!(shape(raw, 2).1);
    }
}

/// What a path really is: "remote" (another machine, never looked up; SAFE-021), "outside" (not
/// in a project, or out through a link; EDIT-045), else following links "dir", "file" or "missing".
#[tauri::command]
pub fn path_kind(store: Store<'_>, path: String, folder_only: Option<bool>) -> &'static str {
    let roots = crate::links::roots(&store);
    match crate::links::fence(&path, &roots) {
        Ok(p) => kind_of(&p),
        Err(_) if crate::links::host_path(&path, &roots) => "remote",
        Err(_) if folder_only == Some(true) => folder_probe(&path, &roots),
        Err(_) => "outside",
    }
}

/// after-list 383: with `folder_only`, a folder under no project answers "dir" or "missing" (never "file"
/// or "outside"), so Reopen Closed Tab can tell that a terminal's old folder is still there. A share,
/// a relative path or a `..` step is never looked up.
pub fn folder_probe(path: &str, roots: &[String]) -> &'static str {
    let p = Path::new(path);
    if crate::links::host_path(path, roots) {
        return "remote";
    }
    if crate::links::refuse_host(path, roots).is_err() || !p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return "missing";
    }
    if p.is_dir() { "dir" } else { "missing" }
}

pub fn kind_of(path: &Path) -> &'static str {
    match fs::metadata(path) {
        Ok(m) if m.is_dir() => "dir",
        Ok(_) => "file",
        Err(_) => "missing",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("krs-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn card16b_a_pick_still_returns_the_path_when_the_grants_list_cannot_be_saved() {
        let d = temp_dir("pick-poisoned");
        let db = d.join("data");
        let store = std::sync::Mutex::new(crate::state::Store::open(&db).unwrap());
        store.lock().unwrap().set("file_grants", "[\"C:/picked.txt\", tru").unwrap();
        crate::state::kept::refuse_copies(&db);
        let fence = crate::fence::Fence::load(&store);
        let git = crate::git::Git { version: String::new() };
        let picked = d.join("picked.txt");
        fs::write(&picked, "p").unwrap();
        let got = finish_pick(&fence, &store, &picked).unwrap();
        assert_eq!(got, picked.to_string_lossy());
        assert!(fence.allow(&got, &store, &git, true).is_ok(), "the grant lives in memory this run");
        let _ = fs::remove_dir_all(&d);
    }

    fn project_store(d: &Path) -> (std::sync::Mutex<crate::state::Store>, std::path::PathBuf) {
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("data")).unwrap());
        let project = d.join("project");
        fs::create_dir_all(project.join("sub")).unwrap();
        let entry = crate::projects::Project { id: "p1".into(), name: "p".into(), path: project.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None };
        crate::projects::save_projects(&store.lock().unwrap(), &[entry]).unwrap();
        (store, project)
    }

    #[test]
    fn row898_a_folder_picked_under_a_project_root_is_an_error() {
        let d = temp_dir("pick-folder-in-project");
        let (store, project) = project_store(&d);
        let fence = crate::fence::Fence::load(&store);
        assert!(finish_pick(&fence, &store, &project.join("sub")).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn row898_a_file_deleted_mid_pick_under_a_project_root_is_an_error() {
        let d = temp_dir("pick-deleted-in-project");
        let (store, project) = project_store(&d);
        let fence = crate::fence::Fence::load(&store);
        assert!(finish_pick(&fence, &store, &project.join("deleted.txt")).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn card16c_a_pick_the_fence_refuses_is_an_error_not_a_returned_path() {
        let d = temp_dir("pick-refused");
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("data")).unwrap());
        let fence = crate::fence::Fence::load(&store);
        let share = Path::new(r"\\server\share\a.txt");
        assert!(finish_pick(&fence, &store, share).is_err(), "a share");
        assert!(finish_pick(&fence, &store, &d.join("gone.txt")).is_err(), "a path that does not resolve");
        assert!(finish_pick(&fence, &store, &d).is_err(), "a folder is not grantable");
        let _ = fs::remove_dir_all(&d);
    }

    /// A file name that is not valid Unicode: an unpaired surrogate on Windows, a stray byte on Linux (APFS refuses one with EILSEQ).
    #[cfg(any(windows, target_os = "linux"))]
    fn non_unicode_name() -> std::ffi::OsString {
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            std::ffi::OsString::from_wide(&[0x61, 0xD800, 0x2E, 0x74, 0x78, 0x74])
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            std::ffi::OsString::from_vec(vec![b'a', 0xFF, b'.', b't', b'x', b't'])
        }
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn row907_a_pick_that_is_not_valid_unicode_is_refused_before_the_fence_grants_it() {
        let d = temp_dir("pick-non-unicode");
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("data")).unwrap());
        let fence = crate::fence::Fence::load(&store);
        let git = crate::git::Git { version: String::new() };
        let picked = d.join(non_unicode_name());
        fs::write(&picked, "p").expect("the file system takes the name");
        assert!(picked.to_str().is_none());
        let err = finish_pick(&fence, &store, &picked).unwrap_err();
        assert!(!err.is_empty());
        assert!(store.lock().unwrap().get("file_grants").unwrap().is_none(), "nothing was granted or saved");
        assert!(fence.allow(&picked.to_string_lossy(), &store, &git, true).is_err(), "the lossy spelling is not allowed either");
        // A later ordinary pick still saves: the refused one left nothing behind to break the grants list.
        let ok = d.join("ok.txt");
        fs::write(&ok, "p").unwrap();
        let got = finish_pick(&fence, &store, &ok).unwrap();
        assert!(store.lock().unwrap().get("file_grants").unwrap().is_some_and(|g| g.contains("ok.txt")), "{got}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn row383_a_folder_under_no_project_is_found_as_a_folder_and_nothing_else_is_looked_up() {
        let d = temp_dir("probe");
        fs::write(d.join("a.txt"), "x").unwrap();
        let (dir, file) = (d.to_string_lossy().into_owned(), d.join("a.txt").to_string_lossy().into_owned());
        let roots: Vec<String> = Vec::new(); // the folder is under no project
        assert_eq!(folder_probe(&dir, &roots), "dir");
        assert_eq!(folder_probe(&file, &roots), "missing", "a file is never reported");
        assert_eq!(folder_probe(&d.join("gone").to_string_lossy(), &roots), "missing");
        assert_eq!(folder_probe("relative/dir", &roots), "missing");
        assert_eq!(folder_probe(&format!("{dir}{}..", std::path::MAIN_SEPARATOR), &roots), "missing");
        assert_eq!(folder_probe(r"\\server\share\x", &roots), "remote");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_path_is_a_folder_a_file_or_missing() {
        let d = temp_dir("kind");
        fs::write(d.join("a.txt"), "x").unwrap();
        fs::create_dir(d.join("zeta")).unwrap();
        assert_eq!(kind_of(&d.join("a.txt")), "file");
        assert_eq!(kind_of(&d.join("zeta")), "dir");
        assert_eq!(kind_of(&d.join("nope")), "missing");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t073_the_stamp_follows_a_rewrite_and_is_none_for_a_missing_file() {
        let dir = temp_dir("stamp");
        let f = dir.join("a.txt");
        fs::write(&f, "one
").unwrap();
        let first = stamp_of(&f).unwrap();
        assert_eq!(first.size, 4);
        fs::write(&f, "one two
").unwrap();
        let second = stamp_of(&f).unwrap();
        assert_ne!(first, second, "a rewrite to another size changes the stamp");
        assert_eq!(stamp_of(&dir.join("gone.txt")), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_save_replaces_the_file_and_leaves_no_temporary_behind() {
        let d = temp_dir("save");
        let f = d.join("main.rs");
        fs::write(&f, "fn main() {}\n").unwrap();
        write_text(&f, "fn main() { x }\n").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "fn main() { x }\n");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 1);
    }

    #[test]
    fn failures_name_the_file() {
        let d = temp_dir("fail");
        let missing = d.join("nope").join("a.txt");
        let err = write_text(&missing, "x").unwrap_err();
        assert!(err.starts_with("could not save") && err.contains("a.txt"), "{err}");
    }

    fn entries(d: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn edit046_a_save_that_fails_part_way_leaves_the_original_whole_and_no_temporary() {
        let d = temp_dir("cutsave");
        let f = d.join("notes.txt");
        fs::write(&f, "the original, whole\n").unwrap();
        // The writer gets half the new text out and then the disk "fails".
        let err = replace_with(&f, false, |t| {
            t.write_all(b"half of the new te")?;
            Err(std::io::Error::other("disk full"))
        })
        .unwrap_err();
        assert!(err.starts_with("could not save") && err.contains("notes.txt"), "{err}");
        assert_eq!(fs::read_to_string(&f).unwrap(), "the original, whole\n");
        assert_eq!(entries(&d), vec!["notes.txt".to_string()]);
    }

    #[test]
    fn edit046_a_swap_that_fails_leaves_the_target_and_no_temporary() {
        let d = temp_dir("badswap");
        // A folder in the file's place cannot be replaced by a file: the swap step fails.
        let target = d.join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("inside.txt"), "kept").unwrap();
        let err = write_text(&target, "new text").unwrap_err();
        assert!(err.starts_with("could not save"), "{err}");
        assert_eq!(fs::read_to_string(target.join("inside.txt")).unwrap(), "kept");
        assert_eq!(entries(&d), vec!["target".to_string()]);
    }

    #[test]
    fn edit046_saves_in_a_row_leave_one_file_and_no_temporary() {
        let d = temp_dir("twice");
        let f = d.join("new.txt");
        write_text(&f, "one").unwrap();
        write_text(&f, "two, longer").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two, longer");
        assert_eq!(entries(&d), vec!["new.txt".to_string()]);
    }

    #[test]
    fn t617_saving_through_a_link_writes_the_real_file_and_keeps_the_link() {
        let d = temp_dir("t617");
        fs::write(d.join("AGENTS.md"), "old rules\n").unwrap();
        fs::create_dir(d.join("docs")).unwrap();
        // CLAUDE.md -> AGENTS.md beside it, and docs/rules.md -> ../AGENTS.md: relative links, as repositories keep them.
        let links = [(d.join("CLAUDE.md"), PathBuf::from("AGENTS.md")), (d.join("docs").join("rules.md"), Path::new("..").join("AGENTS.md"))];
        for (link, to) in &links {
            #[cfg(unix)]
            let made = std::os::unix::fs::symlink(to, link);
            #[cfg(windows)]
            let made = std::os::windows::fs::symlink_file(to, link);
            if let Err(e) = made {
                println!("t617 NOT exercised: this system would not make a file link ({e}); on Windows that takes Developer Mode or an administrator");
                return;
            }
        }
        for (i, (link, to)) in links.iter().enumerate() {
            let text = format!("rules, take {i}\n");
            write_text(link, &text).unwrap();
            assert!(link_exists(link), "{} is still a link", link.display());
            assert_eq!(&fs::read_link(link).unwrap(), to, "and it still leads where it did");
            assert_eq!(fs::read_to_string(d.join("AGENTS.md")).unwrap(), text, "the real file has the new text");
        }
        // no save copy is left behind, beside a link or beside the real file
        assert_eq!(entries(&d), vec!["AGENTS.md".to_string(), "CLAUDE.md".to_string(), "docs".to_string()]);
        assert_eq!(entries(&d.join("docs")), vec!["rules.md".to_string()]);
    }

    #[test]
    fn row952_write_bytes_to_a_new_path_writes_exactly_those_bytes() {
        let d = temp_dir("r952-bytes");
        let f = d.join("creds.json");
        let bytes = [0u8, 159, 146, 150, b'{', 255];
        write_bytes(&f, &bytes).unwrap();
        assert_eq!(fs::read(&f).unwrap(), bytes);
        assert_eq!(entries(&d), vec!["creds.json".to_string()]);
        let _ = fs::remove_dir_all(&d);
    }

    // The two mode tests run on unix only; this Windows host cannot run them (nor see them fail first).
    #[cfg(unix)]
    #[test]
    fn row952_write_bytes_makes_a_new_file_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let d = temp_dir("r952-new");
        let f = d.join("creds.json");
        write_bytes(&f, b"secret").unwrap();
        assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn row952_write_text_over_an_existing_file_keeps_its_mode() {
        use std::os::unix::fs::PermissionsExt;
        let d = temp_dir("r952-keep");
        let f = d.join("notes.txt");
        fs::write(&f, "old").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        write_text(&f, "new").unwrap();
        assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o644);
        write_bytes(&f, b"newer").unwrap();
        assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o644, "an existing file keeps its mode even for write_bytes");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn edit046_a_copy_left_by_a_dead_save_is_cleared_by_the_next_save_but_a_fresh_one_is_not() {
        let d = temp_dir("stale");
        let f = d.join("a.txt");
        let old = d.join(".a.txt.kolux-save-1-0");
        let fresh = d.join(".a.txt.kolux-save-2-0");
        let other = d.join(".b.txt.kolux-save-1-0");
        for p in [&old, &fresh, &other] {
            fs::write(p, "x").unwrap();
        }
        let long_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(STALE_COPY_SECS + 60);
        for p in [&old, &other] {
            fs::File::options().write(true).open(p).unwrap().set_modified(long_ago).unwrap();
        }
        write_text(&f, "saved").unwrap();
        // Only this file's own old leftover goes; a recent copy (maybe a save in progress) and another file's stay.
        assert_eq!(entries(&d), vec![".a.txt.kolux-save-2-0".to_string(), ".b.txt.kolux-save-1-0".to_string(), "a.txt".to_string()]);
    }

    /// T-617b (review of PR #10): a save through a link that leads nowhere fails, and the old save
    /// copies beside the link (named after it) are still cleared, as they were before T-617; a
    /// recent copy and another file's stay. A save through a working link clears them too.
    #[test]
    fn t617b_old_save_copies_beside_a_dangling_link_are_cleared() {
        let d = temp_dir("t617b");
        let link = d.join("CLAUDE.md");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink("AGENTS.md", &link);
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file("AGENTS.md", &link);
        if let Err(e) = made {
            println!("t617b NOT exercised: this system would not make a file link ({e}); on Windows that takes Developer Mode or an administrator");
            return;
        }
        let old = d.join(".CLAUDE.md.kolux-save-1-0");
        let fresh = d.join(".CLAUDE.md.kolux-save-2-0");
        let other = d.join(".b.txt.kolux-save-1-0");
        for p in [&old, &fresh, &other] {
            fs::write(p, "x").unwrap();
        }
        let long_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(STALE_COPY_SECS + 60);
        for p in [&old, &other] {
            fs::File::options().write(true).open(p).unwrap().set_modified(long_ago).unwrap();
        }
        assert!(write_text(&link, "saved").is_err(), "the link leads nowhere");
        assert_eq!(entries(&d), vec![".CLAUDE.md.kolux-save-2-0".to_string(), ".b.txt.kolux-save-1-0".to_string(), "CLAUDE.md".to_string()]);
        // the link leads somewhere again: the copies named after the link are cleared beside it too
        fs::write(d.join("AGENTS.md"), "rules").unwrap();
        fs::File::options().write(true).open(&fresh).unwrap().set_modified(long_ago).unwrap();
        write_text(&link, "saved").unwrap();
        assert_eq!(entries(&d), vec![".b.txt.kolux-save-1-0".to_string(), "AGENTS.md".to_string(), "CLAUDE.md".to_string()]);
        let _ = fs::remove_dir_all(&d);
    }

    /// True when `p` is itself a link (a symlink, or a junction on Windows), not what it points at.
    fn link_exists(p: &Path) -> bool {
        fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
    }
}

// ---- EDIT-043 (T-237-a): Open in another app ----
use std::path::PathBuf;
/// EDIT-043 (T-237-a): opens a project folder in another app or the system file manager. `command`
/// is the app's launch command (the user's own, from General settings; the window falls back to
/// VS Code's when a row has none); none at all opens the file manager. A relative path, a path the
/// fence refuses, or anything that is not a folder is refused (in that order, so a share is never
/// touched and a program is never run), and a launch that fails comes back as an error.
#[tauri::command(async)]
pub fn open_in(path: String, command: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let command = command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    if let Some(c) = &command {
        let settings = store.lock().map_err(|e| e.to_string())?.settings();
        if !saved_command(&settings, c) {
            return Err(format!("{c} is not one of the apps under General settings, so it was not run"));
        }
    }
    let dir = open_target(&path, |p| fence.allow(p, &store, &git, false))?;
    match command.as_deref() {
        // Wave 2 (review A2): the parsed folder item, not its name, so the shell cannot pick a
        // program that shares the folder's name; the folder's own default action still applies.
        None => crate::links::open_file(&dir),
        Some(c) => launch_in(&dir, c, std::env::var_os("PATH")),
    }
}

/// EDIT-043: the folder open_in opens. The path must be full before anything else; then the
/// fence decides (it refuses shares from the spelling alone, before any file system access); only
/// then is the disk asked, and only a folder passes, so a file such as setup.bat is never run.
/// FIX-2 (council FS-2): what comes back is the folder's canonical path (links and `..` resolved,
/// the `\\?\` prefix of a disk path dropped), never the caller's spelling: Windows collapses `..`
/// before the disk sees a path, so `C:\proj\a"&x|y\..\sub` is a real folder, and its quote and
/// shell characters must not reach the app's launcher.
/// FIX-3 (council AFTER 1): the canonical folder is put to the fence again before it is returned, so
/// a junction swapped in after the fence's first look cannot send the launcher outside the projects.
pub fn open_target(path: &str, mut allow: impl FnMut(&str) -> Result<PathBuf, String>) -> Result<PathBuf, String> {
    if !Path::new(path).is_absolute() {
        return Err(format!("{path} is not a full path, so it was not opened"));
    }
    let dir = allow(path)?;
    if !dir.exists() {
        return Err(format!("{path} does not exist"));
    }
    if !dir.is_dir() {
        return Err(format!("{path} is not a folder, so it was not opened"));
    }
    let real = dir.canonicalize().map_err(|e| format!("{path}: {e}"))?;
    allow(&real.to_string_lossy())?;
    Ok(plain_disk_path(real))
}

/// The longest plain path Windows opens without the verbatim prefix (MAX_PATH less its end mark).
const PLAIN_MAX: usize = 259;

/// `\\?\C:\x` as `C:\x` while it fits in MAX_PATH (FIX-3, council AFTER 2: a longer one keeps the
/// prefix, the only spelling of it Windows opens); any other path as it is (the fence refuses shares
/// and namespace paths).
fn plain_disk_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match (s.strip_prefix(r"\\?\"), p.components().next()) {
        (Some(rest), Some(std::path::Component::Prefix(x))) if matches!(x.kind(), std::path::Prefix::VerbatimDisk(..)) && rest.encode_utf16().count() <= PLAIN_MAX => PathBuf::from(rest),
        _ => p,
    }
}

/// A launch command split into the program and its arguments; double quotes group words.
pub fn split_command(cmd: &str) -> Vec<String> {
    let (mut out, mut word, mut quoted, mut any) = (Vec::new(), String::new(), false, false);
    for ch in cmd.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut word));
                    any = false;
                }
            }
            c => {
                word.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(word);
    }
    out
}

/// The program a launch command names: a full path as it is, else the first match on `path_var`
/// of the absolute folders on `path_var`. On Windows a name without one of the launchable
/// extensions is tried only with .com, .exe, .bat and .cmd, in that order (the default PATHEXT),
/// never bare: VS Code's bin folder holds an extensionless `code` shell script next to code.cmd.
pub fn find_program(program: &str, path_var: Option<std::ffi::OsString>) -> Option<PathBuf> {
    const LAUNCHABLE: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];
    let given = Path::new(program);
    let has_ext = given.extension().and_then(|e| e.to_str()).is_some_and(|e| LAUNCHABLE.iter().any(|l| l[1..].eq_ignore_ascii_case(e)));
    let exts: &[&str] = if cfg!(windows) && !has_ext { &LAUNCHABLE } else { &[""] };
    if given.components().count() > 1 || given.is_absolute() {
        return exts.iter().map(|e| PathBuf::from(format!("{program}{e}"))).find(|p| p.is_file());
    }
    let dirs = path_var.map(|v| std::env::split_paths(&v).filter(|d| d.is_absolute()).collect::<Vec<_>>()).unwrap_or_default();
    dirs.iter().flat_map(|d| exts.iter().map(move |e| d.join(format!("{program}{e}")))).find(|p| p.is_file())
}

/// after-list 781: file types Explorer (or a link/script host behind it) would run rather than show.
const EXPLORER_REFUSED: [&str; 22] = [
    "bat", "cmd", "exe", "com", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msc", "scr", "lnk", "url", "hta", "cpl", "reg", "pif", "appref-ms",
];

/// True when the launch command is Windows Explorer, which runs (not just shows) a file it is handed.
fn is_explorer(name: &str, program: &Path) -> bool {
    let stem = |p: &Path| p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("explorer"));
    stem(Path::new(name)) || stem(program)
}

/// True for a file name Explorer must not be handed: a trailing dot or space (Windows drops them, so
/// `RUN.BAT.` is `RUN.BAT`), a stream suffix, or a program/script/link extension, in any letter case.
fn explorer_refuses_name(name: &str) -> bool {
    let trimmed = name.trim_end_matches(['.', ' ']);
    name.contains(':') || Path::new(trimmed).extension().and_then(|e| e.to_str()).is_some_and(|e| EXPLORER_REFUSED.iter().any(|r| r.eq_ignore_ascii_case(e)))
}

/// after-list 781: what Explorer is handed. A folder opens as it is; a file is only revealed
/// (`/select,`), which never runs it, and a program, script or link is refused outright. The path is
/// resolved first (`..`, links, 8.3 short names, trailing dots), so the check sees the real name.
pub fn explorer_target(target: &Path) -> Result<std::ffi::OsString, String> {
    let real = plain_disk_path(target.canonicalize().map_err(|e| format!("{}: {e}", target.display()))?);
    if real.is_dir() {
        return Ok(real.into_os_string());
    }
    let name = real.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !real.is_file() || explorer_refuses_name(&name) {
        return Err(format!("{name} is a program, script or link, so Explorer was not asked to open it"));
    }
    let mut select = std::ffi::OsString::from("/select,");
    select.push(real);
    Ok(select)
}

/// Starts `command` with `dir` as its last argument, without a console window. Batch launchers
/// (VS Code's `code` is one) get the standard library's batch-argument escaping, which refuses an
/// argument it cannot pass safely instead of handing it to the shell.
pub fn launch_in(dir: &Path, command: &str, path_var: Option<std::ffi::OsString>) -> Result<(), String> {
    let parts = split_command(command);
    let Some(name) = parts.first() else { return Err("the launch command is empty".into()) };
    let program = find_program(name, path_var).ok_or_else(|| format!("{name} was not found; check the app's launch command in General settings"))?;
    let target = if is_explorer(name, &program) { explorer_target(dir)? } else { dir.as_os_str().to_owned() };
    let mut cmd = std::process::Command::new(program);
    cmd.args(&parts[1..]).arg(target).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::winproc::no_window()); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("{name} did not start: {e}"))
}

/// after-list 435: the presets of General settings > Open in (src/settings/openIn.ts). They are the list
/// before anything is saved, and a preset row saved with an id sends the preset's command, so all of them run.
const PRESET_COMMANDS: [&str; 8] = ["explorer", "code", "cursor", "windsurf", "zed", "subl", "idea", "wt -d"];

/// EDIT-043: the window may only run a preset's command or one saved under General settings
/// (openInApps). This keeps a stray or mistyped command out; it is not a wall against the window
/// itself, which can also write openInApps through the settings patch (the window is trusted code).
pub fn saved_command(settings: &serde_json::Value, cmd: &str) -> bool {
    PRESET_COMMANDS.contains(&cmd) || settings["openInApps"].as_array().is_some_and(|a| a.iter().any(|r| r["command"].as_str().map(str::trim) == Some(cmd)))
}

/// T-317 (EDIT-048): the branches of the repository a worktree belongs to (local ones, then remote ones
/// by short name), for the pull request composer's searchable Base box. The worktree must pass the
/// fence like any folder open_in opens; a branch list is read-only.
#[tauri::command(async)]
pub fn worktree_branches(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<String>, String> {
    let dir = open_target(&path, |p| fence.allow(p, &store, &git, false))?;
    crate::projects::branches(&dir)
}

#[cfg(test)]
mod open_in_tests {
    use super::*;

    // after-list 781: the explorer preset must never be handed a program, script or link.
    #[test]
    fn fix781_explorer_refuses_programs_scripts_and_links_but_takes_folders() {
        let base = std::env::temp_dir().join(format!("kolux-fix781-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        for bad in ["run.bat", "RUN.BAT", "a.exe", "b.cmd", "c.ps1", "d.lnk", "e.Vbs", "f.hta", "g.url", "h.msi"] {
            let f = base.join(bad);
            std::fs::write(&f, "x").unwrap();
            assert!(explorer_target(&f).unwrap_err().contains("not asked to open"), "{bad}");
        }
        assert!(explorer_target(&base).unwrap().to_string_lossy().ends_with(base.file_name().unwrap().to_str().unwrap()));
        let note = base.join("notes.txt");
        std::fs::write(&note, "x").unwrap();
        let shown = explorer_target(&note).unwrap().to_string_lossy().to_string();
        assert!(shown.starts_with("/select,") && shown.ends_with("notes.txt"), "{shown}");
        assert!(explorer_target(&base.join("gone.txt")).is_err());
        // `..` is resolved before the name is judged
        std::fs::create_dir_all(base.join("sub")).unwrap();
        assert!(explorer_target(&base.join("sub").join("..").join("run.bat")).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn fix781_a_trailing_dot_or_space_or_stream_does_not_hide_the_extension() {
        for bad in ["RUN.BAT.", "run.bat ", "run.bat. .", "x.txt:evil.bat", "x.exe::$DATA"] {
            assert!(explorer_refuses_name(bad), "{bad:?}");
        }
        assert!(!explorer_refuses_name("notes.txt") && !explorer_refuses_name("README"));
        assert!(is_explorer("explorer", Path::new(r"C:\Windows\explorer.exe")) && is_explorer("EXPLORER.EXE", Path::new("x")));
        assert!(!is_explorer("code", Path::new(r"C:\bin\code.cmd")));
    }

    // The refusal sits in launch_in, so scm_open_with and open_in both get it; it fires before a spawn.
    #[cfg(windows)]
    #[test]
    fn fix781_launch_in_refuses_a_script_for_explorer_before_starting_anything() {
        let base = std::env::temp_dir().join(format!("kolux-fix781launch-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("explorer.exe"), "").unwrap();
        let bat = base.join("Run.Bat");
        std::fs::write(&bat, "@echo off\r\n").unwrap();
        let path = Some(std::env::join_paths([base.clone()]).unwrap());
        let err = launch_in(&bat, "explorer", path).unwrap_err();
        assert!(err.contains("not asked to open"), "{err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn fix781_windows_resolves_a_trailing_dot_to_the_real_script_name() {
        let base = std::env::temp_dir().join(format!("kolux-fix781dot-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("run.bat"), "x").unwrap();
        let spelled = format!("{}\\RUN.BAT.", base.display());
        assert!(explorer_target(Path::new(&spelled)).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn edit043_relative_or_missing_paths_are_refused() {
        let pass = |p: &str| Ok(PathBuf::from(p));
        assert!(open_target("relative\\folder", pass).unwrap_err().contains("not a full path"));
        let gone = std::env::temp_dir().join("kolux-edit043-not-there-7f3a");
        assert!(open_target(&gone.to_string_lossy(), pass).unwrap_err().contains("does not exist"));
        assert!(open_target(&std::env::temp_dir().to_string_lossy(), pass).is_ok());
    }

    #[test]
    fn edit043_the_fence_decides_before_the_disk_and_only_a_folder_opens() {
        // the fence runs first: its refusal comes back even for a path that does not exist, so a
        // share is refused from its spelling and never reached
        let share = r"\\host\share\proj";
        let mut asked = None;
        let err = open_target(share, |p| {
            asked = Some(p.to_string());
            Err(format!("Kolux does not open files from other computers' shares: {p}"))
        })
        .unwrap_err();
        assert_eq!(asked.as_deref(), Some(share));
        assert!(err.contains("shares"), "{err}");
        let relative = open_target("proj", |_| panic!("the fence is not asked about a relative path"));
        assert!(relative.unwrap_err().contains("not a full path"));
        // a file inside the project (setup.bat) is refused, never handed to the system to run
        let base = std::env::temp_dir().join(format!("kolux-edit043-file-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let bat = base.join("setup.bat");
        std::fs::write(&bat, "@echo off\r\n").unwrap();
        let err = open_target(&bat.to_string_lossy(), |p| Ok(PathBuf::from(p))).unwrap_err();
        assert!(err.contains("is not a folder"), "{err}");
        assert_eq!(open_target(&base.to_string_lossy(), |p| Ok(PathBuf::from(p))).unwrap(), plain_disk_path(base.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&base);
    }

    // FIX-2 (council FS-2): the launcher gets the canonical folder, never the caller's spelling.
    // Windows collapses `..` before the disk sees the path, so a spelling with a quote and shell
    // characters in a component that `..` cancels is a real folder; none of it may come back.
    // FIX-3 (council AFTER 1): the canonical folder is fenced again before it is launched, so a
    // junction swapped in between the fence's look and the launch cannot carry the launcher outside.
    #[test]
    fn edit043_the_canonical_folder_is_fenced_again_before_it_opens() {
        let base = std::env::temp_dir().join(format!("kolux-edit043-refence-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let spelled = base.to_string_lossy().to_string();
        let canonical = base.canonicalize().unwrap().to_string_lossy().to_string();
        let mut asked = Vec::new();
        assert!(open_target(&spelled, |p| {
            asked.push(p.to_string());
            Ok(PathBuf::from(p))
        })
        .is_ok());
        assert_eq!(asked, vec![spelled.clone(), canonical.clone()]);
        // a fence that lets the spelling in but not where it really leads refuses the open
        let err = open_target(&spelled, |p| if p == spelled { Ok(PathBuf::from(p)) } else { Err(format!("{p} is outside them")) }).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    // FIX-3 (council AFTER 2): the launcher gets a plain C:\ path only while it fits in MAX_PATH;
    // a longer one keeps its verbatim prefix, which is the only spelling of it Windows opens.
    #[cfg(windows)]
    #[test]
    fn edit043_a_folder_path_over_max_path_keeps_its_verbatim_prefix() {
        let short = PathBuf::from(r"\\?\C:\proj\sub");
        assert_eq!(plain_disk_path(short), PathBuf::from(r"C:\proj\sub"));
        let fits = format!(r"\\?\C:\{}", "a".repeat(256));
        assert_eq!(plain_disk_path(PathBuf::from(&fits)).to_string_lossy().chars().count(), 259);
        let long = format!(r"\\?\C:\{}", "a".repeat(257));
        assert_eq!(plain_disk_path(PathBuf::from(&long)), PathBuf::from(&long));
        let share = PathBuf::from(r"\\?\UNC\host\share");
        assert_eq!(plain_disk_path(share.clone()), share);
    }

    #[cfg(windows)]
    #[test]
    fn edit043_the_folder_opened_is_the_canonical_one_not_the_callers_spelling() {
        let base = std::env::temp_dir().join(format!("kolux-edit043-canon-{}", std::process::id()));
        std::fs::create_dir_all(base.join("sub")).unwrap();
        let canonical = base.join("sub").canonicalize().unwrap();
        let spelled = format!(r#"{}\a"&x|y<z>\..\sub"#, base.display());
        assert!(Path::new(&spelled).is_dir(), "Windows resolves the dot-dot first: {spelled}");
        let got = open_target(&spelled, |p| Ok(PathBuf::from(p))).unwrap();
        let s = got.to_string_lossy().to_string();
        assert!(!s.contains(['"', '&', '|', '<', '>']) && !s.contains(".."), "{s}");
        assert!(!s.starts_with(r"\\?\"), "a plain disk path for the launcher: {s}");
        assert_eq!(got, plain_disk_path(canonical));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn edit043_an_extensionless_script_next_to_the_cmd_is_never_picked() {
        // VS Code's bin folder: an extensionless `code` shell script beside code.cmd
        let bin = std::env::temp_dir().join(format!("kolux-edit043-pathext-{}", std::process::id()));
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("fakeed"), "#!/usr/bin/env sh\n").unwrap();
        std::fs::write(bin.join("fakeed.cmd"), "@echo off\r\n").unwrap();
        let path = Some(std::env::join_paths([PathBuf::from("relative-bin"), bin.clone()]).unwrap());
        assert_eq!(find_program("fakeed", path.clone()), Some(bin.join("fakeed.cmd")));
        assert_eq!(find_program("fakeed.cmd", path.clone()), Some(bin.join("fakeed.cmd")));
        std::fs::write(bin.join("fakeed.exe"), "").unwrap();
        assert_eq!(find_program("fakeed", path.clone()), Some(bin.join("fakeed.exe")), ".exe comes before .cmd, as in PATHEXT");
        std::fs::remove_file(bin.join("fakeed.cmd")).unwrap();
        std::fs::remove_file(bin.join("fakeed.exe")).unwrap();
        assert_eq!(find_program("fakeed", path), None, "the bare script alone is not launchable");
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn edit043_launch_commands_split_on_spaces_with_quotes_grouping() {
        assert_eq!(split_command("code"), vec!["code"]);
        assert_eq!(split_command("  code   -n "), vec!["code", "-n"]);
        assert_eq!(split_command(r#""C:\Program Files\Zed\zed.exe" --new"#), vec![r"C:\Program Files\Zed\zed.exe", "--new"]);
        assert_eq!(split_command(r#"app """#), vec!["app", ""]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn edit043_a_launcher_runs_with_the_folder_and_a_missing_one_is_reported() {
        let base = std::env::temp_dir().join(format!("kolux-edit043-{}", std::process::id()));
        let bin = base.join("bin");
        let work = base.join("my work");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        let out = base.join("got.txt");
        #[cfg(windows)]
        std::fs::write(bin.join("fakeed.cmd"), format!("@echo %~1> \"{}\"\r\n", out.display())).unwrap();
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let f = bin.join("fakeed");
            std::fs::write(&f, format!("#!/bin/sh\necho \"$1\" > \"{}\"\n", out.display())).unwrap();
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = Some(bin.clone().into_os_string());
        assert!(find_program("fakeed", path.clone()).is_some());
        launch_in(&work, "fakeed", path.clone()).unwrap();
        let mut got = String::new();
        for _ in 0..100 {
            if let Ok(s) = std::fs::read_to_string(&out) {
                if !s.trim().is_empty() {
                    got = s;
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(got.trim(), work.to_string_lossy());
        let err = launch_in(&work, "no-such-editor-edit043", path).unwrap_err();
        assert!(err.contains("no-such-editor-edit043 was not found"), "{err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn edit043_only_vs_code_or_a_saved_app_command_is_run() {
        let none = serde_json::json!({});
        assert!(saved_command(&none, "code"));
        assert!(!saved_command(&none, "cmd /c calc"));
        let saved = serde_json::json!({ "openInApps": [{ "label": "Zed", "command": " zed " }] });
        assert!(saved_command(&saved, "zed"));
        assert!(!saved_command(&saved, "zed --evil"));
    }

    #[test]
    fn row435_the_apps_listed_before_anything_is_saved_are_allowed_and_a_made_up_command_still_is_not() {
        let none = serde_json::json!({});
        for preset in ["explorer", "code", "cursor", "windsurf", "zed", "subl", "idea", "wt -d"] {
            assert!(saved_command(&none, preset), "{preset}");
        }
        let custom = serde_json::json!({ "openInApps": [{ "name": "Mine", "command": "myedit" }] });
        assert!(saved_command(&custom, "myedit") && saved_command(&custom, "zed"));
        assert!(!saved_command(&custom, "explorer /e,") && !saved_command(&none, "powershell"));
    }
}
