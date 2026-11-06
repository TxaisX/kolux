// Reading and saving the text of a file shown in an editor tab (EDIT-001, EDIT-046). A save goes
// to a temporary file beside the target, is flushed to disk and is then moved over it, so a save
// that fails or is cut off never leaves a half-written file behind. A read has an upper bound and
// samples the start of a file before treating it as text. Every command here takes only paths
// inside the user's projects and worktrees (ACCT-055, fence.rs); EDIT-045's `links::fence` guards
// the file operations and `path_kind` (inside a project or granted exactly, never out through a
// link); the WSL and share parts of EDIT-045 are T-062.
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

/// EDIT-046 (T-178): the largest file the editor opens as text. The old limit was 5 MB; a 20 MB log
/// has to open. Bigger files are refused with a plain message (the whole text travels to the window
/// and into a syntax tree, so the bound stays modest).
pub const TEXT_MAX: u64 = 32 * 1024 * 1024;

/// EDIT-046: how much of the start of a file is looked at to tell text from binary.
const SAMPLE: usize = 8192;

/// EDIT-046: true when the start of a file is plainly not text: a well-known binary signature, a
/// NUL byte, or mostly control characters. A UTF-16 text file has NULs too and is also refused (the
/// editor only reads UTF-8). "MZ" is not a signature here: it is two letters real text can start with,
/// and a Windows program always has NUL bytes in its first 64 bytes.
pub fn looks_binary(sample: &[u8]) -> bool {
    const MAGIC: [&[u8]; 8] = [b"PK\x03\x04", b"\x1f\x8b", b"%PDF-", b"\x89PNG", b"GIF8", b"\x7fELF", b"\xff\xd8\xff", b"7z\xbc\xaf"];
    if MAGIC.iter().any(|m| sample.starts_with(m)) || sample.contains(&0) {
        return true;
    }
    let control = sample.iter().filter(|b| **b < 0x20 && !matches!(**b, b'\t' | b'\n' | b'\r' | 0x0c | 0x1b)).count();
    !sample.is_empty() && control * 10 > sample.len() * 3
}

pub fn read_text(path: &Path) -> Result<String, String> {
    read_text_up_to(path, TEXT_MAX)
}

/// `read_text` with the size bound given, so the bound itself can be tested without a huge file.
pub fn read_text_up_to(path: &Path, max: u64) -> Result<String, String> {
    let io = |e: std::io::Error| format!("{}: {e}", path.display());
    let mut f = fs::File::open(path).map_err(io)?;
    let len = f.metadata().map_err(io)?.len();
    if len > max {
        return Err(format!("{} is too large to open ({} MB; the editor opens up to {} MB)", path.display(), len.div_ceil(1024 * 1024), max / (1024 * 1024)));
    }
    let mut bytes = Vec::with_capacity(len as usize);
    // Sampled first, so a big archive is turned away after 8 KB instead of after being read whole.
    (&mut f).take(SAMPLE as u64).read_to_end(&mut bytes).map_err(io)?;
    if looks_binary(&bytes) {
        return Err(format!("{} is a binary file, so it is not shown as text", path.display()));
    }
    f.read_to_end(&mut bytes).map_err(io)?;
    String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", path.display()))
}

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
type Grants<'a> = tauri::State<'a, crate::links::Grants>;

/// SAFE-021 / EDIT-045: a path on another machine, outside the projects, or leading out through a
/// link is refused before the file is touched.
// T-442-c: async, because fence.allow can ask git for every project's worktrees (a path outside
// the project roots, such as a Kolux worktree, on a cold 3 s cache) and that must never hold up typing.
#[tauri::command(async)]
pub fn file_read(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<String, String> {
    read_text(&fence.allow(&path, &store, &git, true)?)
}

/// T-235-b (EDIT-029, EDIT-009): the most a bytes read hands to the window (a picture for the image
/// viewer or a note). Coordinator default: same ceiling as the text read; Txais may overrule.
pub const BYTES_MAX: u64 = 32 * 1024 * 1024;
/// T-234-b (EDIT-009): the most one pasted or inserted picture may weigh when it is saved into a
/// worktree. Coordinator default; Txais may overrule.
pub const PICTURE_SAVE_MAX: usize = 16 * 1024 * 1024;
/// The file endings a picture may be saved under: this command writes pictures, not arbitrary files.
const PICTURE_EXT: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// The whole file as bytes, refused past `max` before it is read.
pub fn read_bytes_up_to(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let io = |e: std::io::Error| format!("{}: {e}", path.display());
    let f = fs::File::open(path).map_err(io)?;
    let meta = f.metadata().map_err(io)?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if meta.len() > max {
        return Err(format!("{} is too large to load ({} MB; up to {} MB)", path.display(), meta.len().div_ceil(1024 * 1024), max / (1024 * 1024)));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    // take(max + 1): a file that grew after the size check still cannot pass the bound.
    f.take(max + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() as u64 > max {
        return Err(format!("{} is too large to load (up to {} MB)", path.display(), max / (1024 * 1024)));
    }
    Ok(bytes)
}

/// T-235-b: a file's bytes for the image viewer and for pictures in notes, same fence as `file_read`.
#[tauri::command(async)]
pub fn file_bytes(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<tauri::ipc::Response, String> {
    read_bytes_up_to(&fence.allow(&path, &store, &git, true)?, BYTES_MAX).map(tauri::ipc::Response::new)
}

/// Saves a picture as a NEW file: refused when the ending is not a picture's, when it is empty or
/// over `max`, or when a file of that name exists (a paste never overwrites). The folder must exist.
/// A write that fails part-way leaves no file behind.
pub fn write_new_picture(path: &Path, bytes: &[u8], max: usize) -> Result<(), String> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !PICTURE_EXT.contains(&ext.as_str()) {
        return Err(format!("{} is not a picture file name (png, jpg, gif, webp or bmp)", path.display()));
    }
    if bytes.is_empty() {
        return Err("The picture is empty; nothing was saved.".into());
    }
    if bytes.len() > max {
        return Err(format!("The picture is {} MB; at most {} MB can be saved into a note's folder.", bytes.len().div_ceil(1024 * 1024), max / (1024 * 1024)));
    }
    let fail = |e: std::io::Error| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            format!("{} already exists; nothing was overwritten", path.display())
        } else {
            format!("could not save {}: {e}", path.display())
        }
    };
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(fail)?;
    if let Err(e) = f.write_all(bytes).and_then(|_| f.flush()).and_then(|_| f.sync_all()) {
        drop(f);
        let _ = fs::remove_file(path);
        return Err(fail(e));
    }
    Ok(())
}

/// The text of an `encodeURIComponent` header value back (the window sends the path that way).
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// T-234-b: a pasted or inserted picture saved beside its note. The picture is the raw request body
/// and its full path goes in the `x-file-path` header (percent-encoded); the fence is `file_write`'s.
#[tauri::command(async)]
pub fn file_write_picture(request: tauri::ipc::Request<'_>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture did not arrive; nothing was saved.".into());
    };
    let path = request.headers().get("x-file-path").and_then(|v| v.to_str().ok()).and_then(percent_decode).ok_or("The picture's file name did not arrive; nothing was saved.")?;
    let path = fence.allow(&path, &store, &git, true)?;
    let _one = WRITES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    write_new_picture(&path, bytes, PICTURE_SAVE_MAX)
}

/// T-073-a (EDIT-003): the SHA-256 of a file's bytes as lowercase hex. The editor hashes the UTF-8
/// bytes of the text it loaded the same way (file_read hands the bytes back unchanged).
pub fn text_hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Why file_write did not save. `Failed` goes to the window as the plain message it always was;
/// `ChangedOnDisk` goes as `{ kind: "stale", message, path, diskHash }` (diskHash null
/// when the file is gone), so the editor can offer to reload or overwrite.
#[derive(Debug, PartialEq)]
pub enum WriteError {
    ChangedOnDisk { path: String, disk_hash: Option<String> },
    Failed(String),
}

impl From<String> for WriteError {
    fn from(message: String) -> Self {
        WriteError::Failed(message)
    }
}

impl serde::Serialize for WriteError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            WriteError::Failed(message) => s.serialize_str(message),
            WriteError::ChangedOnDisk { path, disk_hash } => serde_json::json!({
                "kind": "stale", // the kind the editor's isStale (src/editor/buffers.ts) looks for
                "message": format!("{path} changed on disk since it was opened, so it was not saved"),
                "path": path,
                "diskHash": disk_hash,
            })
            .serialize(s),
        }
    }
}

/// Saves `text` over `path`. With `loaded_hash` (the `text_hash` of the text the editor loaded)
/// the save is refused when the file on disk no longer has that hash, so an agent's edit is never
/// overwritten unseen. Without it the save goes ahead as before.
/// ponytail: the check and the rename are not one atomic step; a write landing in between is lost.
pub fn write_checked(path: &Path, text: &str, loaded_hash: Option<&str>) -> Result<(), WriteError> {
    if let Some(want) = loaded_hash {
        let disk_hash = match fs::read(path) {
            Ok(bytes) => Some(text_hash(&bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(WriteError::Failed(format!("could not check {} before saving: {e}", path.display()))),
        };
        if disk_hash.as_deref() != Some(want.trim()) {
            return Err(WriteError::ChangedOnDisk { path: path.display().to_string(), disk_hash });
        }
    }
    Ok(write_text(path, text)?)
}

/// Saves run one at a time (T-442-c): the disk-hash check and the write happen under one lock,
/// so two saves that now run on worker threads can never both pass the check and land out of
/// order; the later one is refused as changed on disk instead.
// ponytail: one lock for every path; saves are milliseconds, a per-path map if that ever shows.
static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// T-073 (EDIT-003): answers with the stamp of the file it just wrote, taken under the same lock,
/// so the editor remembers its own save and the disk-change check never takes it for an agent's.
#[tauri::command(async)]
pub fn file_write(path: String, text: String, loaded_hash: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Option<Stamp>, WriteError> {
    if text.len() as u64 > TEXT_MAX {
        return Err(WriteError::Failed(format!("The text is larger than the {TEXT_MAX} bytes the editor can write.")));
    }
    let path = fence.allow(&path, &store, &git, true)?;
    let _one = WRITES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    write_checked(&path, &text, loaded_hash.as_deref())?;
    Ok(stamp_of(&path))
}

/// T-073 (EDIT-003): what a cheap disk-change check compares: the modified time in milliseconds
/// and the size in bytes. It is advisory only (the banner); a same-size rewrite inside one check
/// or a tool that puts the old modified time back slips past it, and the save's hash check
/// (`write_checked`) is the guard that still refuses then.
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
        Err(crate::fence::GrantError::SaveFailed(e)) => eprintln!("kolux-rs: the picked file's grant was not saved: {e}"),
        Ok(()) => {}
    }
    Ok(spelled.to_owned())
}

/// The worktree's markdown files for the Mod+Shift+O picker (EDIT-012), at most 2000 of them.
#[derive(serde::Serialize)]
pub struct Notes {
    files: Vec<String>,
    capped: bool,
}

// TERM-115: async, so listing a big worktree through git never holds typing in another pane.
#[tauri::command(async)]
pub fn md_list(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Notes, String> {
    let (files, capped) = git.markdown_files(&fence.allow(&root, &store, &git, false)?, 2000)?;
    Ok(Notes { files, capped })
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
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
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

/// The two texts of a diff tab (EDIT-027); see Git::diff_sides.
#[derive(serde::Serialize)]
pub struct Sides {
    original: String,
    modified: String,
}

#[tauri::command]
pub async fn diff_sides(path: String, staged: bool, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Sides, String> {
    let (original, modified) = git.diff_sides(&fence.allow(&path, &store, &git, false)?, staged)?;
    Ok(Sides { original, modified })
}

/// The changed files the diff picker lists (EDIT-027).
#[tauri::command(async)]
pub fn git_changes(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Change>, String> {
    git.changes(&fence.allow(&root, &store, &git, false)?)
}

/// Every change of the worktree for All Changes (EDIT-029); see Git::change_entries.
#[tauri::command]
pub async fn change_entries(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Entry>, String> {
    git.change_entries(&fence.allow(&root, &store, &git, false)?)
}

/// One side of a changed image, as bytes (EDIT-029: images load on their own); empty when the
/// file is not on that side.
#[tauri::command(async)]
pub fn diff_image(path: String, staged: bool, new: bool, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<tauri::ipc::Response, String> {
    let (old, now) = git.diff_bytes(&fence.allow(&path, &store, &git, false)?, staged)?;
    Ok(tauri::ipc::Response::new(if new { now } else { old }))
}

/// Mod+Shift+M: a note at the worktree root named untitled.md, then untitled-2.md and onwards. It
/// never overwrites a file and gives up after 100 taken names. With a `template` (one of
/// `md_templates`' paths, EDIT-055) the note starts with that template's text, placeholders filled;
/// without one it is empty. Naming it on the first save is EDIT-054 (T-237).
#[tauri::command(async)]
pub fn md_new(root: String, template: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<String, String> {
    let root = fence.allow(&root, &store, &git, false)?;
    match template {
        None => new_note(&root),
        Some(t) => new_note_from(&root, &t, &jiff::Zoned::now()),
    }
}

pub fn new_note(root: &Path) -> Result<String, String> {
    new_note_with(root, |_| String::new())
}

/// The first free untitled name gets `body(file name)`. The file is made new (never over another),
/// and a body that cannot be written takes the half-made file away again.
fn new_note_with(root: &Path, body: impl Fn(&str) -> String) -> Result<String, String> {
    for n in 1..=100 {
        let name = if n == 1 { "untitled.md".to_string() } else { format!("untitled-{n}.md") };
        let path = root.join(&name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                let text = body(&name);
                if let Err(e) = f.write_all(text.as_bytes()).and_then(|_| f.sync_all()) {
                    drop(f);
                    let _ = fs::remove_file(&path);
                    return Err(format!("could not create a note in {}: {e}", root.display()));
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not create a note in {}: {e}", root.display())),
        }
    }
    Err(format!("{} already has 100 untitled notes; rename or delete some first", root.display()))
}

// ---- EDIT-055 (T-318): new notes from the repository's own templates ----

/// A markdown template found in the repository's templates folder: the readable name shown in the
/// picker and the full path.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct Template {
    pub name: String,
    pub path: String,
}

/// The templates folder inside the repository's hidden Kolux folder (COMPAT EDIT-055).
const TEMPLATE_DIR: [&str; 2] = [".kolux", "templates"];
/// Dependency and tool folders a template search never goes into.
const DEPENDENCY_DIRS: [&str; 9] = ["node_modules", "bower_components", "vendor", "target", ".git", ".venv", "venv", "__pycache__", "site-packages"];
const TEMPLATE_CAP: usize = 200;
const TEMPLATE_DEPTH: usize = 6;

/// A template's picker name from its file name: no extension, dashes and underscores turned into
/// spaces, and a capital first letter ("meeting-notes.md" is "Meeting notes").
pub fn template_name(file: &str) -> String {
    let stem = file.rsplit_once('.').filter(|(s, _)| !s.is_empty()).map_or(file, |(s, _)| s);
    let words = stem.replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = words.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or(words)
}

fn is_markdown(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

fn walk_templates(dir: &Path, depth: usize, out: &mut Vec<Template>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if out.len() >= TEMPLATE_CAP {
            return;
        }
        // file_type does not follow links: a symlink or junction, to a file or a folder, is skipped.
        let Ok(kind) = e.file_type() else { continue };
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            if depth < TEMPLATE_DEPTH && !DEPENDENCY_DIRS.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
                walk_templates(&path, depth + 1, out);
            }
        } else if kind.is_file() && is_markdown(&path) {
            out.push(Template { name: template_name(&name), path: path.to_string_lossy().into_owned() });
        }
    }
}

/// The templates of the repository at `root`, by readable name in natural order (equal names keep a
/// fixed order by path). No templates folder, or a link where it should be, gives an empty list.
pub fn list_templates(root: &Path) -> Vec<Template> {
    let mut dir = root.to_path_buf();
    for part in TEMPLATE_DIR {
        dir.push(part);
        if !fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
            return Vec::new();
        }
    }
    let mut out = Vec::new();
    walk_templates(&dir, 0, &mut out);
    out.sort_by_cached_key(|t| (natural_key(&t.name), t.path.to_lowercase()));
    out
}

/// The value of a placeholder such as `{{ Date }}`, or None for one Kolux does not know. Names ignore
/// case, spaces, dashes and underscores; dates are year-month-day, times 24-hour hours and minutes.
fn placeholder(name: &str, title: &str, file_name: &str, now: &jiff::Zoned) -> Option<String> {
    let key: String = name.chars().filter(|c| !matches!(c, ' ' | '-' | '_')).flat_map(char::to_lowercase).collect();
    match key.as_str() {
        "title" => Some(title.to_string()),
        "filename" => Some(file_name.to_string()),
        "date" => Some(now.strftime("%Y-%m-%d").to_string()),
        "time" => Some(now.strftime("%H:%M").to_string()),
        "datetime" => Some(now.strftime("%Y-%m-%d %H:%M").to_string()),
        _ => None,
    }
}

/// Fills a template's placeholders (`{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{filename}}`,
/// spaces allowed inside the braces); any other `{{...}}` stays exactly as typed.
pub fn fill_template(text: &str, title: &str, file_name: &str, now: &jiff::Zoned) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        match after.find("}}") {
            Some(j) if !after[..j].contains(['{', '}', '\n']) => {
                match placeholder(&after[..j], title, file_name, now) {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&rest[i..i + 2 + j + 2]),
                }
                rest = &after[j + 2..];
            }
            _ => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// EDIT-055: the templates of the worktree, for the picker Mod+Shift+M opens. Empty means no picker.
#[tauri::command(async)]
pub fn md_templates(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<Template>, String> {
    Ok(list_templates(&fence.allow(&root, &store, &git, false)?))
}

/// The note made from one of the worktree's templates: only a path that `list_templates` itself
/// lists is accepted, so a caller cannot make Kolux copy some other file into a note.
pub fn new_note_from(root: &Path, template: &str, now: &jiff::Zoned) -> Result<String, String> {
    let wanted = Path::new(template);
    let found = list_templates(root).into_iter().find(|t| Path::new(&t.path) == wanted).ok_or_else(|| format!("{template} is not one of this repository's templates"))?;
    let text = read_text(Path::new(&found.path))?;
    new_note_with(root, |file| fill_template(&text, file.strip_suffix(".md").unwrap_or(file), file, now))
}

/// One row of the explorer (EDIT-033). A symlink (or junction) is `link` until it is opened, so it
/// expands only once `path_kind` has confirmed it points at a folder.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
}

/// A folder's entries for the explorer: folders first, then by name ignoring case; `.git` is left out.
pub fn list_dir(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .filter(|e| e.file_name() != ".git")
        .map(|e| {
            let kind = match e.file_type() {
                Ok(t) if t.is_symlink() => "link",
                Ok(t) if t.is_dir() => "dir",
                _ => "file",
            };
            DirEntry { name: e.file_name().to_string_lossy().into_owned(), path: e.path().to_string_lossy().into_owned(), kind }
        })
        .collect();
    // EDIT-011: folders first, then natural order (file2 before file10); names that tie settle by their exact
    // spelling, never by the order the disk returned them.
    out.sort_by_cached_key(|e| (e.kind != "dir", natural_key(&e.name), e.name.clone()));
    Ok(out)
}

#[tauri::command(async)]
pub fn dir_list(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<DirEntry>, String> {
    list_dir(&fence.allow(&path, &store, &git, false)?)
}

/// EDIT-035: which of the names in a folder git ignores (empty outside a repository or when git is missing).
/// A folder is asked as `name/` so a rule that only names folders counts. One `check-ignore` answers the batch.
pub fn ignored_in(dir: &Path) -> Vec<String> {
    use std::io::Write;
    use std::process::Stdio;
    let Ok(list) = list_dir(dir) else { return Vec::new() };
    if list.is_empty() {
        return Vec::new();
    }
    let Ok(mut child) = crate::git::command(&["check-ignore", "--stdin", "-z", "-v", "-n"], Some(dir)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return Vec::new() };
    if let Some(mut stdin) = child.stdin.take() {
        for e in &list {
            let slash = if e.kind == "dir" { "/" } else { "" };
            if stdin.write_all(format!("{}{slash}\0", e.name).as_bytes()).is_err() {
                break;
            }
        }
    }
    let Ok(out) = child.wait_with_output() else { return Vec::new() };
    if !matches!(out.status.code(), Some(0 | 1)) {
        return Vec::new();
    }
    let names: Vec<String> = list.iter().map(|e| e.name.clone()).collect();
    let flags = crate::scm::watch::parse_check_ignore(&String::from_utf8_lossy(&out.stdout), &names);
    names.into_iter().zip(flags).filter(|(_, ignored)| *ignored).map(|(n, _)| n).collect()
}

/// EDIT-035: the names in a folder that git ignores, for the explorer's "hide git-ignored files" switch.
#[tauri::command(async)]
pub fn dir_ignored(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<String>, String> {
    Ok(ignored_in(&fence.allow(&path, &store, &git, false)?))
}

/// What a path really is: "remote" (another machine, never looked up; SAFE-021), "outside" (not
/// in a project, or out through a link; EDIT-045), else following links "dir", "file" or "missing".
#[tauri::command]
pub fn path_kind(store: Store<'_>, grants: Grants<'_>, path: String, folder_only: Option<bool>) -> &'static str {
    let roots = crate::links::roots(&store);
    match crate::links::fence(&path, &roots, &grants.snapshot(), true) {
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
        crate::orchestration::kept::refuse_copies(&db);
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
    fn edit035_a_folder_outside_a_repository_has_no_ignored_names_and_a_repository_names_its_ignored_files_and_folders() {
        let d = temp_dir("ignored");
        fs::write(d.join("a.txt"), "x").unwrap();
        assert!(ignored_in(&d).is_empty());
        let git = |args: &[&str]| crate::git::command(args, Some(&d)).output().map(|o| o.status.success()).unwrap_or(false);
        if !git(&["init", "-q"]) {
            return; // no git on this machine: nothing more to prove
        }
        fs::write(d.join(".gitignore"), "*.log\nbuild/\n").unwrap();
        fs::write(d.join("run.log"), "x").unwrap();
        fs::create_dir_all(d.join("build")).unwrap();
        fs::create_dir_all(d.join("src")).unwrap();
        let mut got = ignored_in(&d);
        got.sort();
        assert_eq!(got, vec!["build".to_string(), "run.log".to_string()]);
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
    fn edit011_numbered_names_list_in_natural_order_and_ties_settle_the_same_way_every_time() {
        let d = temp_dir("natural");
        for f in ["file10.txt", "file2.txt", "file1.txt", "file02.txt"] {
            fs::write(d.join(f), "x").unwrap();
        }
        fs::create_dir(d.join("sub")).unwrap();
        let names = |d: &Path| list_dir(d).unwrap().into_iter().map(|e| e.name).collect::<Vec<_>>();
        let got = names(&d);
        // A folder above files; 2 before 10; file02 and file2 count the same, so their exact spelling settles it.
        assert_eq!(got, ["sub", "file1.txt", "file02.txt", "file2.txt", "file10.txt"]);
        assert_eq!(names(&d), got);
    }

    #[test]
    fn the_explorer_lists_folders_first_by_name_and_leaves_out_git() {
        let d = temp_dir("list");
        for f in ["b.txt", "A.txt"] {
            fs::write(d.join(f), "x").unwrap();
        }
        for f in ["zeta", "Alpha", ".git"] {
            fs::create_dir(d.join(f)).unwrap();
        }
        let got: Vec<_> = list_dir(&d).unwrap().into_iter().map(|e| (e.name, e.kind)).collect();
        assert_eq!(got, [("Alpha".to_string(), "dir"), ("zeta".to_string(), "dir"), ("A.txt".to_string(), "file"), ("b.txt".to_string(), "file")]);
        assert_eq!(kind_of(&d.join("zeta")), "dir");
        assert_eq!(kind_of(&d.join("nope")), "missing");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t073a_a_save_with_the_loaded_hash_is_refused_once_the_file_changed_on_disk() {
        let d = temp_dir("t073a");
        let f = d.join("notes.md");
        fs::write(&f, "first\n").unwrap();
        let loaded = text_hash(read_text(&f).unwrap().as_bytes());
        // SHA-256, lowercase hex: the standard test vector, so the editor's crypto.subtle digest matches.
        assert_eq!(text_hash(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

        // Unchanged on disk: the save goes through, and the new text's hash is the next one to send.
        write_checked(&f, "second\n", Some(&loaded)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "second\n");
        let loaded = text_hash(b"second\n");

        // An agent edits the file: the save with the old hash is refused and the agent's text stays.
        fs::write(&f, "agent\n").unwrap();
        let err = write_checked(&f, "mine\n", Some(&loaded)).unwrap_err();
        assert_eq!(err, WriteError::ChangedOnDisk { path: f.display().to_string(), disk_hash: Some(text_hash(b"agent\n")) });
        assert_eq!(fs::read_to_string(&f).unwrap(), "agent\n");
        let sent = serde_json::to_value(&err).unwrap();
        assert_eq!((sent["kind"].as_str(), sent["diskHash"].as_str()), (Some("stale"), Some(text_hash(b"agent\n").as_str())));

        // Deleted on disk: refused with no disk hash. No hash given: saves as before.
        fs::remove_file(&f).unwrap();
        let gone = serde_json::to_value(write_checked(&f, "mine\n", Some(&loaded)).unwrap_err()).unwrap();
        assert!(gone["diskHash"].is_null() && !f.exists());
        write_checked(&f, "mine\n", None).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "mine\n");

        // Any other failure reaches the window as the plain message it always was.
        assert_eq!(serde_json::to_value(WriteError::Failed("could not save x".into())).unwrap(), serde_json::json!("could not save x"));
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
    fn t073_council_the_hash_check_refuses_even_when_the_stamp_says_unchanged() {
        // The banner's stamp is advisory: a same-size rewrite that puts the old modified time
        // back looks unchanged to it, and the save must still be refused by the hash check.
        let dir = temp_dir("stamp-equal");
        let f = dir.join("a.txt");
        fs::write(&f, "aaaa
").unwrap();
        let loaded = text_hash(b"aaaa
");
        let before = stamp_of(&f).unwrap();
        let mtime = fs::metadata(&f).unwrap().modified().unwrap();
        fs::write(&f, "bbbb
").unwrap();
        fs::OpenOptions::new().write(true).open(&f).unwrap().set_modified(mtime).unwrap();
        assert_eq!(stamp_of(&f).unwrap(), before, "same size and the old modified time: the stamp cannot tell");
        let refused = write_checked(&f, "mine
", Some(&loaded));
        assert_eq!(refused, Err(WriteError::ChangedOnDisk { path: f.display().to_string(), disk_hash: Some(text_hash(b"bbbb
")) }));
        assert_eq!(fs::read_to_string(&f).unwrap(), "bbbb
", "the agent's text stays on disk");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_save_replaces_the_file_and_leaves_no_temporary_behind() {
        let d = temp_dir("save");
        let f = d.join("main.rs");
        fs::write(&f, "fn main() {}\n").unwrap();
        write_text(&f, "fn main() { x }\n").unwrap();
        assert_eq!(read_text(&f).unwrap(), "fn main() { x }\n");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 1);
    }

    #[test]
    fn new_notes_count_up_and_never_overwrite() {
        let d = temp_dir("notes");
        fs::write(d.join("untitled-2.md"), "keep").unwrap();
        let a = new_note(&d).unwrap();
        let b = new_note(&d).unwrap();
        assert!(a.ends_with("untitled.md") && b.ends_with("untitled-3.md"), "{a} {b}");
        assert_eq!(read_text(&d.join("untitled-2.md")).unwrap(), "keep");
        for n in 4..=100 {
            fs::write(d.join(format!("untitled-{n}.md")), "").unwrap();
        }
        assert!(new_note(&d).unwrap_err().contains("100 untitled notes"));
    }

    #[test]
    fn failures_name_the_file() {
        let d = temp_dir("fail");
        let missing = d.join("nope").join("a.txt");
        assert!(read_text(&missing).unwrap_err().contains("a.txt"));
        assert!(write_text(&missing, "x").unwrap_err().starts_with("could not save"));
        fs::write(d.join("latin"), [b'c', b'a', b'f', 0xe9]).unwrap();
        assert!(read_text(&d.join("latin")).unwrap_err().contains("not UTF-8"));
    }

    // The bound is above the old 5 MB limit (checked when this compiles).
    const _: () = assert!(TEXT_MAX > 5 * 1024 * 1024);

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
        let mut loaded = String::from("old rules\n");
        for (i, (link, to)) in links.iter().enumerate() {
            let text = format!("rules, take {i}\n");
            write_checked(link, &text, Some(&text_hash(loaded.as_bytes()))).unwrap();
            assert!(link_exists(link), "{} is still a link", link.display());
            assert_eq!(&fs::read_link(link).unwrap(), to, "and it still leads where it did");
            assert_eq!(fs::read_to_string(d.join("AGENTS.md")).unwrap(), text, "the real file has the new text");
            loaded = text;
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

    #[test]
    fn edit046_a_20_mb_log_opens() {
        let d = temp_dir("biglog");
        let f = d.join("big.log");
        let line = "2026-10-19 12:00:00 INFO request handled in 12 ms\n";
        let text = line.repeat(20 * 1024 * 1024 / line.len() + 1);
        assert!(text.len() > 20 * 1024 * 1024);
        fs::write(&f, &text).unwrap();
        assert_eq!(read_text(&f).unwrap().len(), text.len());
    }

    #[test]
    fn edit046_a_file_over_the_bound_is_refused_by_size_and_one_at_the_bound_opens() {
        let d = temp_dir("bound");
        let f = d.join("t.txt");
        fs::write(&f, "x".repeat(100)).unwrap();
        assert_eq!(read_text_up_to(&f, 100).unwrap().len(), 100);
        let err = read_text_up_to(&f, 99).unwrap_err();
        assert!(err.contains("too large to open") && err.contains("t.txt"), "{err}");
    }

    #[test]
    fn edit046_an_archive_or_other_binary_is_never_shown_as_text() {
        let d = temp_dir("binary");
        // A zip starts with its signature and is mostly packed bytes.
        let mut zip = b"PK\x03\x04\x14\x00\x00\x00".to_vec();
        zip.extend((0u32..4000).map(|i| (i * 7 % 251) as u8));
        fs::write(d.join("a.zip"), &zip).unwrap();
        fs::write(d.join("noext"), [b'a', b'b', 0, b'c']).unwrap(); // a NUL in the sample
        fs::write(d.join("ctl"), vec![0x01u8; 200]).unwrap(); // mostly control characters
        fs::write(d.join("wide.txt"), "hi".encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>()).unwrap(); // UTF-16
        for n in ["a.zip", "noext", "ctl", "wide.txt"] {
            let err = read_text(&d.join(n)).unwrap_err();
            assert!(err.contains("is a binary file"), "{n}: {err}");
        }
        // Text with tabs, a form feed, an escape and CRLF is still text, and so is an empty file.
        fs::write(d.join("ok.txt"), "col\tcol\r\n\x0c\x1b[0m done\n").unwrap();
        fs::write(d.join("empty"), "").unwrap();
        assert!(read_text(&d.join("ok.txt")).unwrap().contains("done"));
        assert_eq!(read_text(&d.join("empty")).unwrap(), "");
    }

    #[test]
    fn edit046_mz_at_the_start_is_text_but_a_program_header_is_still_binary() {
        // FIX-1: "MZ" is no signature on its own; a country-code CSV starting with it opens as text.
        let d = temp_dir("mz");
        fs::write(d.join("codes.csv"), "MZ,Mozambique\n").unwrap();
        fs::write(d.join("MZ-notes.txt"), "MZ is the start of this note\n").unwrap();
        assert_eq!(read_text(&d.join("codes.csv")).unwrap(), "MZ,Mozambique\n");
        assert!(read_text(&d.join("MZ-notes.txt")).unwrap().starts_with("MZ is"));
        assert!(!looks_binary(b"MZ,Mozambique\n"));
        // A Windows program has NUL bytes in its first 64 bytes, which the NUL check catches.
        let mut exe = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00".to_vec();
        exe.extend([0u8; 48]);
        assert!(looks_binary(&exe));
        fs::write(d.join("prog.exe"), &exe).unwrap();
        let err = read_text(&d.join("prog.exe")).unwrap_err();
        assert!(err.contains("is a binary file"), "{err}");
    }

    #[test]
    fn edit046_only_the_start_is_sampled_so_a_big_binary_is_turned_away_by_its_first_bytes() {
        let d = temp_dir("sampled");
        let f = d.join("big.bin");
        let mut head = vec![0u8; 100];
        head.extend(vec![b'a'; 1024 * 1024]);
        fs::write(&f, &head).unwrap();
        assert!(read_text(&f).unwrap_err().contains("is a binary file"));
        // A NUL after the sample is not seen: text with a stray NUL late on still opens.
        let mut late = vec![b'a'; SAMPLE + 10];
        late.push(0);
        fs::write(d.join("late"), &late).unwrap();
        assert_eq!(read_text(&d.join("late")).unwrap().len(), SAMPLE + 11);
    }

    fn noon() -> jiff::Zoned {
        jiff::civil::date(2026, 10, 9).at(7, 5, 0, 0).in_tz("UTC").unwrap()
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn edit055_a_template_is_named_from_its_file_name() {
        assert_eq!(template_name("meeting-notes.md"), "Meeting notes");
        assert_eq!(template_name("bug_report.markdown"), "Bug report");
        assert_eq!(template_name("daily.MD"), "Daily");
        assert_eq!(template_name("already Fine.md"), "Already Fine");
        assert_eq!(template_name("é-note.md"), "É note");
        assert_eq!(template_name(".md"), ".md");
    }

    #[test]
    fn edit055_only_markdown_counts_subfolders_are_searched_and_links_and_dependencies_are_skipped() {
        let d = temp_dir("tpl");
        let t = d.join(".kolux").join("templates");
        put(&t.join("meeting-notes.md"), "m");
        put(&t.join("notes.txt"), "no");
        put(&t.join("sub").join("bug-report.markdown"), "b");
        put(&t.join("node_modules").join("dep").join("readme.md"), "dep");
        put(&t.join(".git").join("x.md"), "git");
        put(&t.join("vendor").join("v.md"), "v");
        put(&t.join("file10.md"), "10");
        put(&t.join("file2.md"), "2");
        // A link to a folder holding a template, a link to a template file and a junction to a folder
        // are all skipped. Each link is checked to exist before the skip is asserted; when none could
        // be made (a PC refusing links) the test says so and stops instead of passing silently.
        let outside = d.join("elsewhere");
        put(&outside.join("linked.md"), "l");
        let mut made = Vec::new();
        for (name, junction) in [("dirlink", false), ("junction", true)] {
            if make_dir_link(&t.join(name), &outside, junction) {
                made.push(name);
            }
        }
        #[cfg(unix)]
        let _ = std::os::unix::fs::symlink(outside.join("linked.md"), t.join("filelink.md"));
        #[cfg(windows)]
        let _ = std::os::windows::fs::symlink_file(outside.join("linked.md"), t.join("filelink.md"));
        if link_exists(&t.join("filelink.md")) {
            made.push("filelink.md");
        }
        if made.is_empty() {
            println!("edit055 link skip NOT exercised: no link or junction could be made here");
            return;
        }
        for name in &made {
            assert!(link_exists(&t.join(name)), "{name} was made but is not a link");
        }
        println!("edit055 link skip exercised with: {made:?}");
        let names: Vec<String> = list_templates(&d).into_iter().map(|t| t.name).collect();
        // Take the links away again (remove_dir on a junction or folder link leaves its target alone) before asserting.
        for name in &made {
            let at = t.join(name);
            fs::remove_dir(&at).or_else(|_| fs::remove_file(&at)).unwrap();
        }
        assert_eq!(names, ["Bug report", "File2", "File10", "Meeting notes"]);
    }

    #[test]
    fn edit055_no_templates_folder_or_a_link_in_its_place_means_no_picker() {
        let d = temp_dir("tplnone");
        assert!(list_templates(&d).is_empty());
        fs::create_dir_all(d.join(".kolux")).unwrap();
        assert!(list_templates(&d).is_empty());
        put(&d.join("templates").join("x.md"), "x"); // a templates folder at the wrong place does not count
        assert!(list_templates(&d).is_empty());
        let real = d.join("real-templates");
        put(&real.join("a.md"), "a");
        let at = d.join(".kolux").join("templates");
        let mut exercised = 0;
        for junction in [false, true] {
            if make_dir_link(&at, &real, junction) {
                assert!(link_exists(&at), "the link in place of templates must exist");
                assert!(list_templates(&d).is_empty(), "a templates folder that is a link (junction: {junction}) gives no templates");
                exercised += 1;
                fs::remove_dir(&at).or_else(|_| fs::remove_file(&at)).unwrap();
            }
        }
        if exercised == 0 {
            println!("edit055 link-in-place NOT exercised: no link or junction could be made here");
        }
    }

    /// True when `p` is itself a link (a symlink, or a junction on Windows), not what it points at.
    fn link_exists(p: &Path) -> bool {
        fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
    }

    /// Makes a folder link at `link` to `target`; `junction` asks for a Windows junction (made with
    /// `mklink /J`, which needs no privilege) rather than a symlink. True only when the link exists.
    fn make_dir_link(link: &Path, target: &Path, junction: bool) -> bool {
        #[cfg(unix)]
        {
            let _ = junction;
            let _ = std::os::unix::fs::symlink(target, link);
        }
        #[cfg(windows)]
        {
            if junction {
                let _ = std::process::Command::new("cmd").arg("/c").arg("mklink").arg("/J").arg(link).arg(target).output();
            } else {
                let _ = std::os::windows::fs::symlink_dir(target, link);
            }
        }
        link_exists(link)
    }

    #[test]
    fn edit055_placeholders_are_filled_with_spaces_allowed_and_unknown_ones_stay_as_typed() {
        let now = noon();
        let out = fill_template("# {{title}} ({{ Date }})\nAt {{time}} / {{ date time }} / {{datetime}} in {{file name}} {{filename}}\n{{unknown}} {{ other thing }} {{ {{date}} {{", "untitled", "untitled.md", &now);
        assert_eq!(
            out,
            "# untitled (2026-10-09)\nAt 07:05 / 2026-10-09 07:05 / 2026-10-09 07:05 in untitled.md untitled.md\n{{unknown}} {{ other thing }} {{ 2026-10-09 {{"
        );
        // Nothing to fill, braces that never close, and a lone brace are all left alone.
        assert_eq!(fill_template("plain {x} {{open", "t", "f", &now), "plain {x} {{open");
        // 24-hour clock: an afternoon time is 15:30, not 3:30.
        let late = jiff::civil::date(2026, 1, 2).at(15, 30, 0, 0).in_tz("UTC").unwrap();
        assert_eq!(fill_template("{{time}} {{date}}", "t", "f", &late), "15:30 2026-01-02");
    }

    #[test]
    fn edit055_a_note_from_a_template_has_its_text_filled_and_is_a_file_on_disk() {
        let d = temp_dir("tplnote");
        let t = d.join(".kolux").join("templates").join("daily.md");
        put(&t, "# {{title}}\nDate: {{date}}\nFile: {{filename}}\n");
        let path = new_note_from(&d, &t.to_string_lossy(), &noon()).unwrap();
        assert!(path.ends_with("untitled.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# untitled\nDate: 2026-10-09\nFile: untitled.md\n");
        // The next note counts up and never overwrites the first; its file name is the second's.
        let second = new_note_from(&d, &t.to_string_lossy(), &noon()).unwrap();
        assert!(second.ends_with("untitled-2.md"));
        assert_eq!(fs::read_to_string(&second).unwrap(), "# untitled-2\nDate: 2026-10-09\nFile: untitled-2.md\n");
        assert_eq!(fs::read_to_string(&path).unwrap(), "# untitled\nDate: 2026-10-09\nFile: untitled.md\n");
    }

    #[test]
    fn edit055_only_a_listed_template_can_be_used() {
        let d = temp_dir("tplguard");
        put(&d.join(".kolux").join("templates").join("ok.md"), "ok");
        put(&d.join("secret.md"), "do not copy");
        let err = new_note_from(&d, &d.join("secret.md").to_string_lossy(), &noon()).unwrap_err();
        assert!(err.contains("not one of this repository's templates"), "{err}");
        assert!(!d.join("untitled.md").exists());
    }

    #[test]
    fn edit055_a_blank_note_is_still_empty() {
        let d = temp_dir("tplblank");
        let p = new_note(&d).unwrap();
        assert_eq!(fs::read_to_string(p).unwrap(), "");
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
        None => crate::artifacts::system_open(&dir.to_string_lossy()),
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
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
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

/// after-list 499: the file variant of open_in for a file the fence does not cover (the shortcuts file in
/// the user's home): `file` opens in `command` (a preset or a saved app) and nothing else is run.
pub fn open_file_in(file: &Path, command: &str, settings: &serde_json::Value, path_var: Option<std::ffi::OsString>) -> Result<(), String> {
    let command = command.trim();
    if !saved_command(settings, command) {
        return Err(format!("{command} is not one of the apps under General settings, so it was not run"));
    }
    if !file.exists() {
        return Err(format!("{} does not exist", file.display()));
    }
    if !file.is_file() {
        return Err(format!("{} is not a file, so it was not opened", file.display()));
    }
    launch_in(file, command, path_var)
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

    // The refusal sits in launch_in, so scm_open_with, open_in and open_file_in all get it; it fires before a spawn.
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

    #[test]
    fn row499_a_single_file_opens_only_in_an_allowed_app_and_only_when_it_is_a_file() {
        let d = temp_dir("openfile");
        fs::write(d.join("keys.json"), "{}").unwrap();
        let file = d.join("keys.json");
        let none = serde_json::json!({});
        let refused = open_file_in(&file, "cmd /c calc", &none, None).unwrap_err();
        assert!(refused.contains("not one of the apps"), "{refused}");
        let folder = open_file_in(&d, "zed", &none, None).unwrap_err();
        assert!(folder.contains("not a file"), "{folder}");
        let gone = open_file_in(&d.join("gone.json"), "zed", &none, None).unwrap_err();
        assert!(gone.contains("does not exist"), "{gone}");
        // allowed and a file: the launch itself is tried, and this machine has no such app on an empty PATH
        let tried = open_file_in(&file, "zed", &none, None).unwrap_err();
        assert!(tried.contains("zed was not found"), "{tried}");
        let _ = fs::remove_dir_all(&d);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("krs-files-pic-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn edit029_a_bytes_read_hands_back_the_file_unchanged_and_refuses_one_over_the_bound() {
        let d = temp_dir("bytes");
        let png = [0x89u8, b'P', b'N', b'G', 0, 1, 2, 255];
        fs::write(d.join("a.png"), png).unwrap();
        assert_eq!(read_bytes_up_to(&d.join("a.png"), 1024).unwrap(), png);
        let err = read_bytes_up_to(&d.join("a.png"), 4).unwrap_err();
        assert!(err.contains("too large"), "{err}");
        assert!(read_bytes_up_to(&d, 1024).is_err()); // a folder is never handed back as bytes
        assert!(read_bytes_up_to(&d.join("gone.png"), 1024).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn edit009_a_picture_is_saved_as_a_new_file_and_never_over_an_existing_one() {
        let d = temp_dir("picture");
        let p = d.join("pasted image.png");
        write_new_picture(&p, &[1, 2, 3], 100).unwrap();
        assert_eq!(fs::read(&p).unwrap(), [1, 2, 3]);
        let err = write_new_picture(&p, &[9], 100).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(fs::read(&p).unwrap(), [1, 2, 3]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn edit009_only_picture_names_non_empty_and_within_the_bound_are_saved_and_a_missing_folder_reports() {
        let d = temp_dir("picture-refused");
        assert!(write_new_picture(&d.join("run.sh"), &[1], 100).unwrap_err().contains("not a picture"));
        assert!(write_new_picture(&d.join("noext"), &[1], 100).is_err());
        assert!(write_new_picture(&d.join("a.PNG"), &[], 100).unwrap_err().contains("empty"));
        assert!(write_new_picture(&d.join("b.png"), &[0; 101], 100).unwrap_err().contains("at most"));
        assert!(!d.join("b.png").exists() && !d.join("a.PNG").exists());
        assert!(write_new_picture(&d.join("no-such-folder").join("c.png"), &[1], 100).unwrap_err().contains("could not save"));
        write_new_picture(&d.join("d.JPG"), &[1], 100).unwrap();
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn edit009_the_path_header_decodes_spaces_unicode_and_refuses_a_broken_escape() {
        assert_eq!(percent_decode("C%3A%5Cnotes%5Cmy%20pic%20%C3%A9.png").as_deref(), Some("C:\\notes\\my pic \u{e9}.png"));
        assert_eq!(percent_decode("plain.png").as_deref(), Some("plain.png"));
        assert_eq!(percent_decode("bad%2"), None);
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("%ff%fe"), None);
    }
}
