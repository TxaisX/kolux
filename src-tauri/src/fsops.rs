// The explorer's file operations (EDIT-034, part 1): create, rename, delete to the system trash and
// bring back from it, and copy a path to the clipboard. The explorer keeps the undo history; each undo or redo is one of these calls.
// Part 2: copy (also used for files dropped in from the desktop) and move (drag in the tree).
// EDIT-045: every command fences its paths first (`links::fence`): the entry acted on must sit
// inside a project, and a folder written into must really be inside one.
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Renames run one at a time, so two racing for the same name cannot both pass the "is it free" check.
static RENAMES: Mutex<()> = Mutex::new(());

fn one_name(name: &str) -> Result<&str, String> {
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) if !name.trim().is_empty() && !name.contains(['/', '\\']) => Ok(name),
        _ => Err(format!("\"{name}\" is not a file name")),
    }
}

fn shown(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Makes an empty file or folder; never replaces anything already there.
pub fn create(dir: &Path, name: &str, folder: bool) -> Result<PathBuf, String> {
    let path = dir.join(one_name(name)?);
    let made = if folder { fs::create_dir(&path) } else { fs::OpenOptions::new().write(true).create_new(true).open(&path).map(drop) };
    made.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("{name} already exists here"),
        _ => format!("could not create {name}: {e}"),
    })?;
    Ok(path)
}

/// Whether the folder holds an entry spelled exactly `name`. A file system that ignores case or
/// Unicode normalisation reports a differently spelled name as existing; this tells the two apart.
fn spelled(dir: &Path, name: &str) -> bool {
    fs::read_dir(dir).map(|it| it.filter_map(Result::ok).any(|e| e.file_name() == name)).unwrap_or(true)
}

/// T-616: the entry itself on disk, a link counting as itself (never its target): the volume and
/// the file id on Windows (the 128-bit id where the file system has one, as ReFS does), the device
/// and the inode elsewhere. None when it cannot be read.
#[cfg(windows)]
fn identity(p: &Path) -> Option<(u64, u128)> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO};
    // No access asked for, only what it is; a folder needs the backup flag; a link opens as itself.
    let file = fs::OpenOptions::new().access_mode(0).custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(p).ok()?;
    let h = file.as_raw_handle();
    let mut id = FILE_ID_INFO::default();
    // SAFETY: a live handle, and a struct of exactly the size the call is given.
    if unsafe { GetFileInformationByHandleEx(h, FileIdInfo, (&mut id as *mut FILE_ID_INFO).cast(), std::mem::size_of::<FILE_ID_INFO>() as u32) } != 0 {
        return Some((id.VolumeSerialNumber, u128::from_le_bytes(id.FileId.Identifier)));
    }
    // FAT, exFAT and some shares have no such id; the 64-bit index still tells two entries apart now.
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: as above.
    (unsafe { GetFileInformationByHandle(h, &mut info) } != 0).then(|| (u64::from(info.dwVolumeSerialNumber), (u128::from(info.nFileIndexHigh) << 32) | u128::from(info.nFileIndexLow)))
}

#[cfg(unix)]
fn identity(p: &Path) -> Option<(u64, u128)> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(p).ok().map(|m| (m.dev(), u128::from(m.ino())))
}

/// T-616: are `a` and `b` one and the same entry (the same name spelled two ways, say)?
fn same_entry(a: &Path, b: &Path) -> bool {
    identity(a).is_some_and(|i| identity(b) == Some(i))
}

/// C24-R3-01: the entry's identity as the explorer's undo history keeps it, so an undo can hand it
/// back and the command can tell whether the path still holds the entry that action touched.
fn ident(p: &Path) -> Option<String> {
    identity(p).map(|(a, b)| format!("{a:x}:{b:x}"))
}

/// The sentence an undo gets when the path now holds a different entry than the one it recorded.
fn changed_reason(p: &Path) -> String {
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| shown(p));
    format!("{name} changed since that action, so it was not undone")
}

/// C24-R3-01: the refusal for an undo whose path no longer holds the recorded entry. `expect` is
/// None when the action recorded no identity (an older action, or one that never had a single path),
/// and then nothing is checked.
fn changed(p: &Path, expect: Option<&str>) -> Option<String> {
    let want = expect?;
    (ident(p).as_deref() != Some(want)).then(|| changed_reason(p))
}

/// Gives `from` a new name in the same folder. A symlink is renamed itself, never its target. A new
/// spelling of the same name (letter case, Unicode normalisation) is allowed; another entry's name is
/// not, in any spelling (T-616).
pub fn rename(from: &Path, name: &str) -> Result<PathBuf, String> {
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    rename_at(from, name)
}

/// Why an undo's rename did not happen: `Changed` when the path holds another entry than the one
/// recorded (nothing was done, and there is nothing to retry); `Failed` for anything else.
#[derive(Debug)]
enum RenameError {
    Changed(String),
    Failed(String),
}

/// C24-R3-01: a rename for an undo, which hands back the identity recorded when the action was made.
/// The check runs under `RENAMES` with the rename itself, so the entry cannot be swapped in between.
fn rename_checked(from: &Path, name: &str, expect: Option<&str>) -> Result<PathBuf, RenameError> {
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    // A recorded entry that is gone is the same refusal as one that was replaced: retrying an undo
    // cannot bring it back, so the history must move on rather than sit on this step.
    fs::symlink_metadata(from).map_err(|e| match expect {
        Some(_) => RenameError::Changed(changed_reason(from)),
        None => RenameError::Failed(format!("{}: {e}", from.display())),
    })?;
    if let Some(reason) = changed(from, expect) {
        return Err(RenameError::Changed(reason));
    }
    rename_at(from, name).map_err(RenameError::Failed)
}

/// The rename itself; the caller holds `RENAMES`.
fn rename_at(from: &Path, name: &str) -> Result<PathBuf, String> {
    let name = one_name(name)?;
    let dir = from.parent().ok_or_else(|| format!("{} has no folder", from.display()))?;
    let to = dir.join(name);
    fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    if to.as_os_str() == from.as_os_str() {
        return Ok(to);
    }
    // T-616: where letter case is ignored (Windows, macOS), README.md finds readme.md, which is not
    // spelled that way; unless it is `from` itself, the rename would replace it with no undo and no
    // Recycle Bin copy.
    if fs::symlink_metadata(&to).is_ok() && (spelled(dir, name) || !same_entry(from, &to)) {
        return Err(format!("{name} already exists here"));
    }
    fs::rename(from, &to).map_err(|e| format!("could not rename {}: {e}", from.display()))?;
    Ok(to)
}

/// A WSL share has no trash, so a delete there is for good.
pub fn is_wsl(p: &Path) -> bool {
    let s = shown(p).replace('/', "\\").to_lowercase();
    s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") || s.starts_with("\\\\?\\unc\\wsl$\\") || s.starts_with("\\\\?\\unc\\wsl.localhost\\")
}

#[derive(serde::Serialize, Debug)]
pub struct Gone {
    pub path: String,
    /// Deleted for good (a WSL share); there is nothing to undo.
    pub permanent: bool,
    pub error: Option<String>,
}

/// C24-R3-01: the refusal for a folder the action created that has gained something since. A folder
/// that cannot be read is refused too: it cannot be shown to be the empty one the action made.
fn not_empty(p: &Path) -> Option<String> {
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| shown(p));
    if !fs::symlink_metadata(p).map(|m| m.is_dir()).unwrap_or(false) {
        return None; // a file: nothing can have been dropped inside it
    }
    match fs::read_dir(p) {
        Ok(mut it) => it.next().is_some().then(|| format!("{name} has something in it now, so it was not undone")),
        Err(_) => Some(format!("{name} could not be read, so it was not undone")),
    }
}

/// Deletes each path on its own, so one failure leaves the rest going. C24-R3-01: each path may
/// carry the identity its action recorded, and `must_be_empty` marks a folder the action created,
/// which is only removed while it is still empty; when either check fails nothing is deleted and
/// the refusal is reported for that path alone.
pub fn trash_each(paths: &[String], expect: &[Option<String>], must_be_empty: &[bool]) -> Vec<Gone> {
    paths
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let path = Path::new(p);
            if let Some(reason) = changed(path, expect.get(i).and_then(|e| e.as_deref())) {
                return Gone { path: p.clone(), permanent: false, error: Some(reason) };
            }
            if must_be_empty.get(i).copied().unwrap_or(false) {
                if let Some(reason) = not_empty(path) {
                    return Gone { path: p.clone(), permanent: false, error: Some(reason) };
                }
            }
            let permanent = is_wsl(path);
            let done = if permanent {
                match fs::symlink_metadata(path) {
                    Ok(m) => remove_retrying(path, m.is_dir()),
                    Err(e) => Err(e),
                }
                .map_err(|e| e.to_string())
            } else {
                trash::delete(path).map_err(|e| e.to_string())
            };
            Gone { path: p.clone(), permanent, error: done.err().map(|e| format!("{p}: {e}")) }
        })
        .collect()
}

/// EDIT-044: on Windows a removal that fails for a passing reason (the file locked for a moment:
/// sharing or lock violation, access denied) is tried a few more times before it counts as failed.
pub fn remove_retrying(path: &Path, dir: bool) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        let r = if dir { fs::remove_dir_all(path) } else { fs::remove_file(path) };
        match r {
            Err(e) if cfg!(windows) && tries < 5 && e.raw_os_error().is_some_and(|c| [5, 32, 33].contains(&c)) => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
            r => return r,
        }
    }
}

/// Whether a trash entry is the one deleted from `want`. Windows lists an entry by its shown name,
/// which leaves out the extension when Explorer hides extensions; the entry's own file keeps it.
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn was_at(item: &trash::TrashItem, want: &Path) -> bool {
    let same = |a: &std::ffi::OsStr, b: &std::ffi::OsStr| a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase();
    let (Some(parent), Some(name)) = (want.parent(), want.file_name()) else { return false };
    same(item.original_parent.as_os_str(), parent.as_os_str())
        && (item.name == name || (Some(item.name.as_os_str()) == want.file_stem() && Path::new(&item.id).extension() == want.extension()))
}

/// Brings paths back from the trash, the latest deletion of each.
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
pub fn restore(paths: &[String]) -> Result<(), String> {
    let mut items = trash::os_limited::list().map_err(|e| e.to_string())?;
    items.sort_by_key(|i| std::cmp::Reverse(i.time_deleted));
    let mut pick = Vec::new();
    for p in paths {
        let want = Path::new(p);
        let i = items.iter().position(|i| was_at(i, want)).ok_or_else(|| format!("{p} is not in the trash"))?;
        let mut item = items.remove(i);
        item.name = want.file_name().unwrap_or_default().to_owned(); // put back under its full name
        pick.push(item);
    }
    trash::os_limited::restore_all(pick).map_err(|e| match e {
        trash::Error::RestoreCollision { path, .. } => format!("{} exists again, so it was not put back", path.display()),
        e => e.to_string(),
    })
}

#[cfg(target_os = "macos")]
pub fn restore(_paths: &[String]) -> Result<(), String> {
    Err("putting files back from the trash needs the Finder on macOS".into()) // ponytail: no restore API in the trash crate on macOS
}

type Store<'a> = tauri::State<'a, Mutex<crate::state::Store>>;
type Grants<'a> = tauri::State<'a, crate::links::Grants>;
type Fence = (Vec<String>, std::collections::HashSet<String>);
/// ACCT-055's fence (fence.rs): the user's projects and their worktrees.
type Guard<'a> = tauri::State<'a, crate::fence::Fence>;
type GitState<'a> = tauri::State<'a, crate::git::Git>;

fn fence_of(store: &Store<'_>, grants: &Grants<'_>) -> Fence {
    (crate::links::roots(store), grants.snapshot())
}

fn fenced(f: &Fence, path: &str, follow: bool) -> Result<PathBuf, String> {
    crate::links::fence(path, &f.0, &f.1, follow)
}

/// C24-R3-01: what a create or a rename left behind: where it is, and which entry it is. The
/// explorer's undo history keeps the identity and hands it back, so an undo never acts on a later
/// entry that happens to hold the same path.
#[derive(serde::Serialize, Debug, Default)]
pub struct Made {
    pub path: String,
    pub id: Option<String>,
    /// Set when an undo was refused because the path holds a different entry: nothing was done.
    pub error: Option<String>,
}

// ACCT-055: each command below works only on paths inside the user's projects and worktrees
// (fence.rs) and, on top of that, never out through a link (EDIT-045's `links::fence`); a copy
// may also take files the user just dropped in from outside.
#[tauri::command]
pub fn fs_create(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, dir: String, name: String, folder: bool) -> Result<Made, String> {
    guard.allow(&dir, &store, &git, false)?;
    let p = create(&fenced(&fence_of(&store, &grants), &dir, true)?, &name, folder)?;
    Ok(Made { path: shown(&p), id: ident(&p), error: None })
}

#[tauri::command]
pub fn fs_rename(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, path: String, name: String, expect: Option<String>) -> Result<Made, String> {
    guard.allow(&path, &store, &git, false)?;
    let from = fenced(&fence_of(&store, &grants), &path, false)?;
    Ok(match rename_checked(&from, &name, expect.as_deref()) {
        Ok(to) => Made { path: shown(&to), id: ident(&to), error: None },
        // A changed entry is a final answer, not a failure to retry: handing it back as an error
        // would keep the undo stack on this step for good.
        Err(RenameError::Changed(reason)) => Made { path: shown(&from), id: None, error: Some(reason) },
        Err(RenameError::Failed(e)) => return Err(e),
    })
}

#[tauri::command]
pub async fn fs_trash(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>, expect: Option<Vec<Option<String>>>, must_be_empty: Option<Vec<bool>>) -> Result<Vec<Gone>, String> {
    let f = fence_of(&store, &grants);
    let expect = expect.unwrap_or_default();
    let must_be_empty = must_be_empty.unwrap_or_default();
    let refused = paths.iter().map(|p| guard.allow(p, &store, &git, false).err()).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .zip(refused)
            .enumerate()
            .map(|(i, (p, refused))| match refused.map_or_else(|| fenced(&f, &p, false), Err) {
                Ok(_) => trash_each(std::slice::from_ref(&p), &[expect.get(i).cloned().flatten()], &[must_be_empty.get(i).copied().unwrap_or(false)]).remove(0),
                Err(e) => Gone { path: p, permanent: false, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_restore(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>) -> Result<(), String> {
    guard.allow_all(&paths, &store, &git)?;
    let f = fence_of(&store, &grants);
    for p in &paths {
        fenced(&f, p, false)?;
    }
    tauri::async_runtime::spawn_blocking(move || restore(&paths)).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, Debug, Default)]
pub struct Placed {
    pub from: String,
    /// Where it landed; None when it failed.
    pub to: Option<String>,
    /// C24-R3-01: which entry landed there, so its undo can refuse a later file at the same path.
    pub id: Option<String>,
    pub error: Option<String>,
}

/// "a.txt", then "a copy.txt", "a copy 2.txt" and on; a folder or a dot file keeps its whole name.
fn nth_name(name: &str, n: usize) -> String {
    if n == 0 {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    };
    if n == 1 { format!("{stem} copy{ext}") } else { format!("{stem} copy {n}{ext}") }
}

fn is_link(md: &fs::Metadata) -> bool {
    md.file_type().is_symlink() // on Windows a junction counts too
}

/// Copies a folder's contents into an empty `to`, skipping links inside it; returns how many it skipped.
fn fill(from: &Path, to: &Path) -> std::io::Result<usize> {
    let mut skipped = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let md = fs::symlink_metadata(entry.path())?;
        let dest = to.join(entry.file_name());
        if is_link(&md) {
            skipped += 1;
        } else if md.is_dir() {
            fs::create_dir(&dest)?;
            skipped += fill(&entry.path(), &dest)?;
        } else {
            let mut src = fs::File::open(entry.path())?;
            let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&dest)?;
            std::io::copy(&mut src, &mut out)?;
        }
    }
    Ok(skipped)
}

/// Copies a file or a whole folder into `dir`. It never overwrites: a taken name gets " copy",
/// " copy 2" and so on. A link is refused, and links inside a folder are left out.
pub fn copy_into(from: &Path, dir: &Path) -> Result<(PathBuf, usize), String> {
    let md = fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or_else(|| format!("{} has no name", from.display()))?;
    if is_link(&md) {
        return Err(format!("{name} is a link; links are not copied"));
    }
    if md.is_dir() && dir.starts_with(from) {
        return Err(format!("{name} cannot be copied into itself"));
    }
    for n in 0..1000 {
        let to = dir.join(nth_name(&name, n));
        let made = if md.is_dir() { fs::create_dir(&to) } else { fs::OpenOptions::new().write(true).create_new(true).open(&to).map(drop) };
        match made {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not copy {name}: {e}")),
            Ok(()) => {}
        }
        let filled = if md.is_dir() { fill(from, &to) } else { fs::File::open(from).and_then(|mut src| std::io::copy(&mut src, &mut fs::OpenOptions::new().write(true).truncate(true).open(&to)?)).map(|_| 0) };
        return filled.map(|skipped| (to.clone(), skipped)).map_err(|e| {
            let _ = if md.is_dir() { fs::remove_dir_all(&to) } else { fs::remove_file(&to) }; // only the half-made copy
            format!("could not copy {name}: {e}")
        });
    }
    Err(format!("could not find a free name for {name}"))
}

/// EDIT-039: the bytes in a file or folder, counted only until they pass `cap` (links are not followed or counted).
pub fn total_bytes(path: &Path, cap: u64) -> u64 {
    let mut sum = 0u64;
    let mut todo = vec![path.to_path_buf()];
    while let Some(p) = todo.pop() {
        let Ok(md) = fs::symlink_metadata(&p) else { continue };
        if is_link(&md) {
            continue;
        }
        if md.is_dir() {
            if let Ok(rd) = fs::read_dir(&p) {
                todo.extend(rd.filter_map(Result::ok).map(|e| e.path()));
            }
        } else {
            sum = sum.saturating_add(md.len());
        }
        if sum > cap {
            return sum;
        }
    }
    sum
}

/// EDIT-039: how many bytes a desktop drop holds, so a drop that is too big is refused before anything is copied.
#[tauri::command]
pub async fn fs_bytes(store: Store<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>, cap: u64) -> Result<u64, String> {
    let allowed = paths.iter().map(|p| guard.allow_source(p, &store, &git)).collect::<Result<Vec<_>, _>>()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut sum = 0u64;
        for p in allowed {
            sum = sum.saturating_add(total_bytes(&p, cap.saturating_sub(sum)));
            if sum > cap {
                break;
            }
        }
        sum
    })
    .await
    .map_err(|e| e.to_string())
}

/// Moves an entry into another folder; refused when that folder already holds the name, or when a
/// folder would go inside itself.
pub fn move_into(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = from.file_name().ok_or_else(|| format!("{} has no name", from.display()))?;
    let to = dir.join(name);
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    if from.parent() == Some(dir) {
        return Ok(to);
    }
    if dir.starts_with(from) {
        return Err(format!("{} cannot go inside itself", name.to_string_lossy()));
    }
    if fs::symlink_metadata(&to).is_ok() {
        return Err(format!("{} already exists in {}", name.to_string_lossy(), dir.display()));
    }
    // ponytail: a move to another drive fails here; copy then delete when the tree spans drives
    fs::rename(from, &to).map_err(|e| format!("could not move {}: {e}", name.to_string_lossy()))?;
    Ok(to)
}

#[tauri::command]
pub async fn fs_copy(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>, dir: String) -> Result<Vec<Placed>, String> {
    guard.allow(&dir, &store, &git, false)?;
    let f = fence_of(&store, &grants);
    // Ok(true): a file the user just dropped in from outside, copied as it is.
    let sources = paths.iter().map(|p| guard.allow_source(p, &store, &git).map(|_| guard.was_dropped(Path::new(p)))).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .zip(sources)
            .map(|(p, source)| match source.and_then(|dropped| if dropped { Ok(PathBuf::from(&p)) } else { fenced(&f, &p, false) }).and_then(|from| fenced(&f, &dir, true).and_then(|d| copy_into(&from, &d))) {
                Ok((to, 0)) => Placed { from: p, to: Some(shown(&to)), id: ident(&to), error: None },
                Ok((to, n)) => Placed { from: p, error: Some(format!("{}: {n} link(s) inside were left out", shown(&to))), to: Some(shown(&to)), id: ident(&to) },
                Err(e) => Placed { from: p, to: None, id: None, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Each move is (entry, folder to move it into).
#[tauri::command]
pub async fn fs_move(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, moves: Vec<(String, String)>) -> Result<Vec<Placed>, String> {
    guard.allow_all(moves.iter().flat_map(|(p, d)| [p, d]), &store, &git)?;
    let f = fence_of(&store, &grants);
    tauri::async_runtime::spawn_blocking(move || {
        moves
            .into_iter()
            .map(|(p, dir)| match fenced(&f, &p, false).and_then(|from| fenced(&f, &dir, true).and_then(|d| move_into(&from, &d))) {
                Ok(to) => Placed { from: p, to: Some(shown(&to)), id: None, error: None },
                Err(e) => Placed { from: p, to: None, id: None, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("krs-fsops-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn edit039_a_drops_bytes_are_counted_through_folders_and_stop_once_past_the_cap() {
        let d = temp_dir("bytes");
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        fs::write(d.join("sub").join("b.bin"), vec![0u8; 50]).unwrap();
        assert_eq!(total_bytes(&d, u64::MAX), 150);
        assert_eq!(total_bytes(&d.join("a.bin"), u64::MAX), 100);
        assert!(total_bytes(&d, 120) > 120, "past the cap it reports more than the cap");
        assert_eq!(total_bytes(&d.join("missing"), 10), 0);
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(windows)]
    #[test]
    fn edit044_a_removal_blocked_for_a_moment_is_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = temp_dir("retry");
        let file = d.join("busy.txt");
        fs::write(&file, "x").unwrap();
        // Held open with no sharing for 150 ms: the first removals fail with a sharing violation.
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();
        let t = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            drop(held);
        });
        let started = std::time::Instant::now();
        remove_retrying(&file, false).unwrap();
        assert!(started.elapsed() >= std::time::Duration::from_millis(100), "it had to wait for the lock");
        assert!(!file.exists());
        t.join().unwrap();
        // A real failure still comes back once the retries are spent.
        assert!(remove_retrying(&d.join("absent.txt"), false).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn creating_never_replaces_and_names_must_be_one_part() {
        let d = temp_dir("create");
        fs::write(d.join("a.txt"), "keep").unwrap();
        assert!(create(&d, "a.txt", false).unwrap_err().contains("already exists"));
        assert!(create(&d, "a.txt", true).is_err());
        assert_eq!(fs::read_to_string(d.join("a.txt")).unwrap(), "keep");
        for bad in ["", "..", "x/y", "x\\y", " "] {
            assert!(create(&d, bad, false).is_err(), "{bad:?}");
        }
        assert!(create(&d, "sub", true).unwrap().is_dir());
        assert!(create(&d, "b.txt", false).unwrap().is_file());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn renaming_refuses_another_entry_but_allows_a_new_case() {
        let d = temp_dir("rename");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("b.txt"), "b").unwrap();
        assert!(rename(&d.join("a.txt"), "b.txt").unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(d.join("b.txt")).unwrap(), "b");
        let to = rename(&d.join("a.txt"), "A.txt").unwrap();
        assert!(fs::read_dir(&d).unwrap().any(|e| e.unwrap().file_name() == "A.txt"));
        assert_eq!(rename(&to, "c.txt").unwrap(), d.join("c.txt"));
        assert!(!d.join("A.txt").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t616_renaming_onto_another_files_name_in_other_capitals_is_refused() {
        let d = temp_dir("t616-clash");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("b.txt"), "b").unwrap();
        // A file system that ignores letter case (Windows, macOS) finds b.txt when asked for B.txt.
        let folds = d.join("B.txt").exists();
        let got = rename(&d.join("a.txt"), "B.txt");
        assert_eq!(fs::read_to_string(d.join("b.txt")).unwrap(), "b", "b.txt is never replaced");
        if folds {
            assert!(got.unwrap_err().contains("already exists here"));
            assert_eq!(fs::read_to_string(d.join("a.txt")).unwrap(), "a", "a.txt stays as it was");
        } else {
            // A disk that keeps letter case apart (Linux) holds both names; the identity test below covers the check there.
            assert_eq!(got.unwrap(), d.join("B.txt"));
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t616_a_case_only_rename_of_one_file_or_folder_still_works() {
        let d = temp_dir("t616-case");
        fs::write(d.join("notes.md"), "n").unwrap();
        fs::create_dir(d.join("src")).unwrap();
        let to = rename(&d.join("notes.md"), "NOTES.md").unwrap();
        assert_eq!(fs::read_to_string(&to).unwrap(), "n");
        rename(&d.join("src"), "Src").unwrap();
        let mut names: Vec<String> = fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["NOTES.md", "Src"], "the new spellings, and nothing else");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t616_the_identity_check_tells_one_entry_from_another() {
        let d = temp_dir("t616-identity");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("b.txt"), "b").unwrap();
        fs::create_dir(d.join("sub")).unwrap();
        // The same file under a second name: what a lookup that ignores case reaches for "A.TXT".
        fs::hard_link(d.join("a.txt"), d.join("also-a.txt")).unwrap();
        assert!(same_entry(&d.join("a.txt"), &d.join("a.txt")));
        assert!(same_entry(&d.join("a.txt"), &d.join("also-a.txt")), "one file, two spellings: a rename may go ahead");
        assert!(!same_entry(&d.join("a.txt"), &d.join("b.txt")), "another file: the rename is refused");
        assert!(!same_entry(&d.join("a.txt"), &d.join("missing.txt")));
        assert!(same_entry(&d.join("sub"), &d.join("sub")) && !same_entry(&d.join("sub"), &d.join("a.txt")));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.join("b.txt"), d.join("link")).unwrap();
            assert!(!same_entry(&d.join("link"), &d.join("b.txt")), "a link is itself, never its target");
        }
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn two_renames_to_one_name_leave_one_winner() {
        let d = temp_dir("race");
        fs::write(d.join("x"), "x").unwrap();
        fs::write(d.join("y"), "y").unwrap();
        let (dx, dy) = (d.join("x"), d.join("y"));
        let a = std::thread::spawn(move || rename(&dx, "z").is_ok());
        let b = std::thread::spawn(move || rename(&dy, "z").is_ok());
        assert_eq!([a.join().unwrap(), b.join().unwrap()].iter().filter(|w| **w).count(), 1);
        assert_eq!(fs::read_dir(&d).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn copies_never_overwrite_and_take_a_new_name() {
        let d = temp_dir("copy");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::create_dir_all(d.join("f").join("deep")).unwrap();
        fs::write(d.join("f").join("deep").join("x"), "x").unwrap();
        fs::create_dir(d.join("in")).unwrap();
        fs::write(d.join("in").join("a.txt"), "keep").unwrap();
        assert_eq!(copy_into(&d.join("a.txt"), &d.join("in")).unwrap().0, d.join("in").join("a copy.txt"));
        assert_eq!(copy_into(&d.join("a.txt"), &d.join("in")).unwrap().0, d.join("in").join("a copy 2.txt"));
        assert_eq!(fs::read_to_string(d.join("in").join("a.txt")).unwrap(), "keep");
        assert_eq!(fs::read_to_string(d.join("in").join("a copy.txt")).unwrap(), "a");
        let (to, skipped) = copy_into(&d.join("f"), &d.join("in")).unwrap();
        assert_eq!((to.clone(), skipped), (d.join("in").join("f"), 0));
        assert_eq!(fs::read_to_string(to.join("deep").join("x")).unwrap(), "x");
        assert_eq!(copy_into(&d.join("f"), &d.join("in")).unwrap().0, d.join("in").join("f copy"));
        assert!(copy_into(&d.join("f"), &d.join("f").join("deep")).unwrap_err().contains("into itself"));
        assert_eq!(nth_name(".env", 1), ".env copy");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn moves_refuse_a_taken_name_and_a_folder_into_itself() {
        let d = temp_dir("move");
        fs::create_dir_all(d.join("f").join("sub")).unwrap();
        fs::create_dir(d.join("g")).unwrap();
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("g").join("a.txt"), "keep").unwrap();
        assert!(move_into(&d.join("a.txt"), &d.join("g")).unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(d.join("g").join("a.txt")).unwrap(), "keep");
        assert!(move_into(&d.join("f"), &d.join("f").join("sub")).unwrap_err().contains("inside itself"));
        assert_eq!(move_into(&d.join("f"), &d.join("g")).unwrap(), d.join("g").join("f"));
        assert!(d.join("g").join("f").join("sub").is_dir() && !d.join("f").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_copied() {
        let d = temp_dir("links");
        fs::write(d.join("t"), "t").unwrap();
        std::os::unix::fs::symlink(d.join("t"), d.join("l")).unwrap();
        fs::create_dir(d.join("in")).unwrap();
        assert!(copy_into(&d.join("l"), &d.join("in")).unwrap_err().contains("link"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn wsl_shares_are_known() {
        assert!(is_wsl(Path::new(r"\\wsl$\Ubuntu\home\a")));
        assert!(is_wsl(Path::new(r"\\wsl.localhost\Ubuntu\x")));
        assert!(!is_wsl(Path::new(r"C:\wsl$\x")));
    }

    #[test]
    fn c24_a_created_entry_carries_the_identity_its_undo_hands_back() {
        let d = temp_dir("c24-id");
        let file = create(&d, "notes.md", false).unwrap();
        assert!(ident(&file).is_some(), "a file has an id the undo history can keep");
        fs::create_dir(d.join("sub")).unwrap();
        assert!(ident(&d.join("sub")).is_some(), "a folder too");
        assert_ne!(ident(&file), ident(&d.join("sub")), "two entries do not share an id");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_undo_refuses_to_trash_a_replaced_file_and_leaves_it_alone() {
        let d = temp_dir("c24-trash");
        let file = d.join("notes.md");
        fs::write(&file, "the empty file New file made").unwrap();
        let recorded = ident(&file).expect("the id the create records");
        // The agent writes its own notes.md: a new entry at the same path.
        fs::remove_file(&file).unwrap();
        fs::write(&file, "the agent's work").unwrap();
        let gone = trash_each(&[shown(&file)], &[Some(recorded)], &[false]);
        assert_eq!(gone.len(), 1);
        assert_eq!(gone[0].error.as_deref().unwrap_or_default(), "notes.md changed since that action, so it was not undone");
        assert!(!gone[0].permanent, "a refusal is not a delete");
        assert_eq!(fs::read_to_string(&file).unwrap(), "the agent's work", "the agent's file is still there");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_undo_refuses_to_rename_a_replaced_file_and_leaves_both_names_alone() {
        let d = temp_dir("c24-rename");
        fs::write(d.join("a.ts"), "the user's file").unwrap();
        let b = d.join("b.ts");
        fs::rename(d.join("a.ts"), &b).unwrap();
        let recorded = ident(&b).expect("the id the rename records");
        fs::remove_file(&b).unwrap();
        fs::write(&b, "the agent's file").unwrap();
        let why = match rename_checked(&b, "a.ts", Some(&recorded)) {
            Err(RenameError::Changed(why)) => why,
            other => panic!("the undo must refuse a changed entry, got {other:?}"),
        };
        assert_eq!(why, "b.ts changed since that action, so it was not undone");
        assert_eq!(fs::read_to_string(&b).unwrap(), "the agent's file", "the agent's file keeps its name");
        assert!(!d.join("a.ts").exists(), "nothing was renamed back");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_undo_refuses_to_trash_a_created_folder_that_has_gained_files() {
        let d = temp_dir("c24-folder");
        let folder = create(&d, "notes", true).unwrap();
        let recorded = ident(&folder).expect("the id the create records");
        // The agent writes its own files inside the folder the user made.
        fs::write(folder.join("agent.md"), "the agent's work").unwrap();
        let gone = trash_each(&[shown(&folder)], &[Some(recorded)], &[true]);
        assert_eq!(gone.len(), 1);
        assert_eq!(gone[0].error.as_deref().unwrap_or_default(), "notes has something in it now, so it was not undone");
        assert!(!gone[0].permanent, "a refusal is not a delete");
        assert_eq!(fs::read_to_string(folder.join("agent.md")).unwrap(), "the agent's work", "the agent's file is still there");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_an_empty_created_folder_is_still_removable() {
        let d = temp_dir("c24-folder-empty");
        let folder = create(&d, "notes", true).unwrap();
        assert_eq!(not_empty(&folder), None, "an empty folder the action made is not refused");
        fs::write(folder.join("agent.md"), "x").unwrap();
        assert_eq!(not_empty(&folder).as_deref(), Some("notes has something in it now, so it was not undone"));
        // A file is never refused for being "not empty": only a folder can gain something inside.
        let file = create(&d, "a.md", false).unwrap();
        assert_eq!(not_empty(&file), None);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_a_gone_entry_is_refused_with_the_same_reason() {
        let d = temp_dir("c24-gone");
        let b = d.join("b.ts");
        fs::write(&b, "x").unwrap();
        let recorded = ident(&b).unwrap();
        fs::remove_file(&b).unwrap();
        let why = match rename_checked(&b, "a.ts", Some(&recorded)) {
            Err(RenameError::Changed(why)) => why,
            other => panic!("a gone entry is a refusal too, got {other:?}"),
        };
        assert_eq!(why, "b.ts changed since that action, so it was not undone");
        // Without a recorded entry the error stays an ordinary failure, as before.
        assert!(matches!(rename_checked(&b, "a.ts", None), Err(RenameError::Failed(_))));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn c24_an_unchanged_entry_still_undoes_in_both_directions() {
        let d = temp_dir("c24-ok");
        fs::write(d.join("a.ts"), "mine").unwrap();
        let b = rename(&d.join("a.ts"), "b.ts").unwrap();
        let recorded = ident(&b).unwrap();
        let back = rename_checked(&b, "a.ts", Some(&recorded)).unwrap();
        assert_eq!(back, d.join("a.ts"));
        assert_eq!(fs::read_to_string(&back).unwrap(), "mine");
        // A rename keeps the entry, so the same identity still matches on the way back (a redo).
        assert_eq!(rename_checked(&back, "b.ts", Some(&recorded)).unwrap(), d.join("b.ts"));
        // An action that recorded no identity keeps the old behaviour.
        assert_eq!(rename_checked(&d.join("b.ts"), "c.ts", None).unwrap(), d.join("c.ts"));
        let _ = fs::remove_dir_all(&d);
    }
}
