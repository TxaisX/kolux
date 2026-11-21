//! The artifacts under a chat (DT-C281): the files an agent leaves in `<chat folder>/artifacts`.
//! The folder is the index. Every call reads it again and returns the files that are there now, so
//! a deleted file leaves and a rewritten one arrives with a new (modified time, size) stamp; there
//! is no database, no index file and nothing to go stale when the app or the folder is moved.
//!
//! The window draws a page, an image or a video from these rows. The kinds are only what WebView2 can
//! show: `mkv`, `avi` and `ogv` are left out because the window cannot play them, so an agent writing
//! one gets an honest nothing instead of a card that never starts. The folder holds at most 200 files
//! and 1 GB; past either limit the rest is left out and said in `skipped`, never dropped in silence,
//! because "the file I just made is not there" is the one failure a user cannot explain.
//!
//! A file is kept only when its real path, every link on the way resolved, sits inside the chat's
//! folder. A link, a junction or a network share is refused: an agent can write a link into the folder
//! that points at a key file, and a preview must never read what is outside the work the chat was
//! given. Dotfiles and half-written downloads are skipped too; they are the app's own bookkeeping or a
//! file still arriving, not something the user asked to see.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The folder a chat keeps its finished work in: `<chat folder>/artifacts`.
pub const FOLDER: &str = "artifacts";
/// The most files one scan lists. A cloned repository can hold thousands of small files there; past
/// this the rest is left out and the pane says so once, instead of drawing a strip nobody can read.
pub const MAX_FILES: usize = 200;
/// The most bytes one scan lists. Pictures and clips are large, so the file cap alone would let a
/// folder of 200 clips fill a disk's worth of memory on the window's side.
pub const MAX_BYTES: u64 = 1024 * 1024 * 1024;
/// The most `artifact_read` puts in one answer. A thumbnail is read whole; 10 MB is far more than a
/// screenshot and small enough that the base64 text and its blob URL never stall the window.
pub const MAX_READ: u64 = 10 * 1024 * 1024;

/// One file in the folder, as the pane draws it. `mtime` and `size` together are the stamp: the pane
/// compares them across scans to know a file changed, without reading it again every 3 s.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Row {
    /// The file's full path, as it will be handed back to `artifact_read`.
    pub path: String,
    /// The file's name alone, which is what the pane shows.
    pub name: String,
    /// What the file is: "page", "image" or "video".
    pub kind: &'static str,
    pub size: u64,
    /// When the file last changed, in milliseconds since 1970.
    pub mtime: u64,
}

/// One look at the folder: the files that are there now, and one plain sentence per limit that left
/// files out. An empty `skipped` means nothing was held back.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Scan {
    pub rows: Vec<Row>,
    pub skipped: Vec<String>,
}

/// What a file is, from its name. Only these three kinds are shown: a page opens in the system
/// browser, an image is previewed under the reply, and a video plays in the window. `mkv`, `avi` and
/// `ogv` are deliberately absent: WebView2 cannot play them, and a card that never starts is worse
/// than no card. Anything else (a document, a log, source code) is not an artifact of this strip.
fn kind_of(name: &str) -> Option<&'static str> {
    let (stem, ext) = name.rsplit_once('.')?;
    // `.png` is a dotfile with no name of its own, not a picture.
    if stem.is_empty() {
        return None;
    }
    match ext.to_ascii_lowercase().as_str() {
        "html" | "htm" => Some("page"),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => Some("image"),
        "mp4" | "webm" | "mov" | "m4v" => Some("video"),
        _ => None,
    }
}

/// A download or a save still in progress. The write that makes it is not finished, so it is skipped
/// until the next scan, when its final name is there and its contents are whole.
fn half_written(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "tmp" | "part" | "crdownload" | "lock")
}

/// When a file last changed, in milliseconds since 1970; 0 when the system cannot say, which still
/// compares the same across two scans of an unchanged file.
fn modified_ms(md: &fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A network share is never read. The spelling decides before anything is stat'ed, so a `\\host\...`
/// path never makes Windows ask that host for a credential. A share mapped to a drive letter is a
/// share too, and is asked about without touching it (GetDriveTypeW).
fn on_share(path: &Path) -> bool {
    let s = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        // `\\?\C:\...` is a disk spelled at length; `\\?\UNC\...` is a share.
        return rest.starts_with("unc\\");
    }
    // Two leading separators are a UNC share or the device namespace (`\\.\`, which reaches shares
    // too). A single leading separator is root-relative on this computer's drive, not a share.
    if s.starts_with("\\\\") {
        return true;
    }
    mapped_share(&s)
}

#[cfg(windows)]
fn mapped_share(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 2 || b[1] != b':' {
        return false;
    }
    const DRIVE_REMOTE: u32 = 4;
    let root: Vec<u16> = format!("{}:\\", b[0] as char).encode_utf16().chain([0]).collect();
    // SAFETY: a NUL-terminated wide string that lives across the call; the call only reads it.
    unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(root.as_ptr()) == DRIVE_REMOTE }
}

#[cfg(not(windows))]
fn mapped_share(_s: &str) -> bool {
    false // ponytail: a network mount on macOS and Linux is not told from a local one yet
}

/// The chat's artifacts folder as it really is, with the chat folder's own real path: the folder has
/// to be a real folder (a link or a junction where it should be is refused, because following it
/// would list a folder the chat was never given) and it has to sit inside the chat's own folder.
/// None means "no folder there", which the pane shows as no artifacts, never as an error.
fn real_folder(cwd: &Path) -> Option<(PathBuf, PathBuf)> {
    if !cwd.is_absolute() || on_share(cwd) {
        return None;
    }
    let dir = cwd.join(FOLDER);
    let md = fs::symlink_metadata(&dir).ok()?;
    // On Windows a junction reports itself as a symlink and not as a folder here, so this one check
    // refuses a link, a junction and a plain file alike.
    if !md.is_dir() || md.file_type().is_symlink() {
        return None;
    }
    let real_cwd = fs::canonicalize(cwd).ok()?;
    let real_dir = fs::canonicalize(&dir).ok()?;
    (real_dir.starts_with(&real_cwd) && !on_share(&real_cwd) && !on_share(&real_dir)).then_some((real_cwd, real_dir))
}

/// Whether a name is something the pane would show at all: not a dotfile, not a download still
/// arriving, and one of the three kinds. Checked before the caps, so a folder full of notes and
/// subfolders cannot use up the room meant for pictures.
fn is_artifact_name(name: &str) -> bool {
    !name.starts_with('.') && !half_written(name) && kind_of(name).is_some()
}

/// One look at the folder, built from `read_dir` and each file's own metadata. `max_files` and
/// `max_bytes` are passed in so a test can reach a limit without 200 files or a gigabyte.
///
/// The cap keeps the first names in order, which is the same rule the old Artifacts screen used and
/// the one a user can predict ("the folder is full"). The rest are named in `skipped`, and the pane
/// can tell the user to clear the folder rather than leave them wondering where their file went.
fn scan_folder(cwd: &Path, max_files: usize, max_bytes: u64) -> Scan {
    let mut out = Scan::default();
    let Some((real_cwd, real_dir)) = real_folder(cwd) else { return out };
    let mut names: Vec<OsString> = fs::read_dir(&real_dir).into_iter().flatten().flatten().map(|e| e.file_name()).collect();
    names.sort();
    // Only what the strip could show counts toward the file cap.
    names.retain(|raw| is_artifact_name(&raw.to_string_lossy()));
    if names.len() > max_files {
        out.skipped.push(format!("the artifacts folder holds more than {max_files} files; only the first {max_files} by name are listed"));
        names.truncate(max_files);
    }
    let dir = cwd.join(FOLDER);
    let mut used: u64 = 0;
    let mut over_bytes = false;
    for raw in names {
        let name = raw.to_string_lossy().into_owned();
        let Some(kind) = kind_of(&name) else { continue };
        let path = dir.join(&raw);
        // A name the window cannot spell exactly cannot be handed back to `artifact_read` either,
        // so it is left out rather than shown as a row that would not open.
        let Some(path_text) = path.to_str() else { continue };
        // The entry's own type, never a followed one: a link is not a deliverable. A file that
        // vanished between read_dir and here is simply not there any more.
        let Ok(md) = fs::symlink_metadata(&path) else { continue };
        if !md.is_file() || md.file_type().is_symlink() || md.len() == 0 {
            continue;
        }
        // The real path is what is trusted, not the spelling: a link inside the folder, or a link
        // anywhere on the way, must still land inside the chat's folder to be read.
        let Ok(real) = fs::canonicalize(&path) else { continue };
        if on_share(&real) || !real.starts_with(&real_cwd) {
            continue;
        }
        if used.saturating_add(md.len()) > max_bytes {
            over_bytes = true;
            continue;
        }
        used += md.len();
        out.rows.push(Row { path: path_text.to_string(), name, kind, size: md.len(), mtime: modified_ms(&md) });
    }
    if over_bytes {
        out.skipped.push(format!("the artifacts folder holds more than {} MB; the files past that are not listed", in_mb(max_bytes)));
    }
    out
}

/// A byte count in whole MB, at least 1 so a small test limit never reads "0 MB".
fn in_mb(bytes: u64) -> u64 {
    (bytes / (1024 * 1024)).max(1)
}

/// One file, read whole and base64-encoded for a blob URL. The path is checked again here, not only
/// in the scan the caller got it from: the pane may hand back a path seconds later, and the folder,
/// the file or a link in the way may have changed since. The file also has to be directly in the
/// folder, so a path through a subfolder cannot reach a page's assets or a test's screenshots.
fn read_file(cwd: &Path, path: &Path, cap: u64) -> Result<String, String> {
    use base64::Engine as _;
    let cap = cap.min(MAX_READ);
    let (real_cwd, real_dir) = real_folder(cwd).ok_or_else(|| "the artifacts folder is not there, or it is a link or a network share".to_string())?;
    if !path.is_absolute() {
        return Err("the artifact path must be a full path".to_string());
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    let md = fs::symlink_metadata(path).map_err(|e| format!("could not read {name}: {e}"))?;
    if md.file_type().is_symlink() {
        return Err(format!("{name} is a link, so it is not shown"));
    }
    if !md.is_file() {
        return Err(format!("{name} is not a file"));
    }
    let real = fs::canonicalize(path).map_err(|e| format!("could not read {name}: {e}"))?;
    if on_share(&real) || !real.starts_with(&real_cwd) || real.parent() != Some(real_dir.as_path()) {
        return Err(format!("{name} is outside this chat's artifacts folder"));
    }
    if md.len() > cap {
        return Err(format!("{name} is bigger than the {} MB preview limit", in_mb(cap)));
    }
    let bytes = fs::read(&real).map_err(|e| format!("could not read {name}: {e}"))?;
    // The file may have grown between the check and the read; an over-cap answer is refused, never
    // silently cut, because half a picture is not a preview.
    if bytes.len() as u64 > cap {
        return Err(format!("{name} is bigger than the {} MB preview limit", in_mb(cap)));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// The files in `<cwd>/artifacts` right now, newest state every time. Called when a chat opens, when
/// a turn finishes and every few seconds while the pane is visible; it is cheap enough to be the
/// only source of truth, and it cannot disagree with the folder.
#[tauri::command]
pub async fn artifacts_scan(cwd: String) -> Result<Scan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_folder(Path::new(&cwd), MAX_FILES, MAX_BYTES)).await.map_err(|e| e.to_string())
}

/// One artifact's bytes as base64, for a blob URL the window can show. `cap` lets the caller ask for
/// less than the 10 MB preview limit; asking for more is cut to it here, so the window can never pull
/// an unbounded file into memory through this door.
#[tauri::command]
pub async fn artifact_read(cwd: String, path: String, cap: u64) -> Result<String, String> {
    // The await gives the read's own answer, or a message when its worker could not run.
    tauri::async_runtime::spawn_blocking(move || read_file(Path::new(&cwd), Path::new(&path), cap)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;
    use std::time::{Duration, SystemTime};

    fn names(scan: &Scan) -> Vec<&str> {
        scan.rows.iter().map(|r| r.name.as_str()).collect()
    }

    #[test]
    fn the_kinds_are_only_what_the_window_can_show() {
        for (name, kind) in [
            ("a.html", "page"),
            ("a.HTM", "page"),
            ("a.png", "image"),
            ("a.JPG", "image"),
            ("a.jpeg", "image"),
            ("a.gif", "image"),
            ("a.webp", "image"),
            ("a.svg", "image"),
            ("a.avif", "image"),
            ("a.bmp", "image"),
            ("a.ico", "image"),
            ("a.mp4", "video"),
            ("a.WEBM", "video"),
            ("a.mov", "video"),
            ("a.m4v", "video"),
        ] {
            assert_eq!(kind_of(name), Some(kind), "{name}");
        }
        // WebView2 cannot play these, so a card for them would never start.
        for name in ["a.mkv", "a.avi", "a.ogv", "a.txt", "a.pdf", "a.json", "a", ".png", "a.png.tmp"] {
            assert_eq!(kind_of(name), None, "{name}");
        }
    }

    #[test]
    fn a_scan_lists_the_folder_fresh_with_a_stamp_for_each_file() {
        let t = temp("artifacts-fresh");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("page.html"), "<title>A</title>").unwrap();
        fs::write(dir.join("pic.png"), "png").unwrap();

        let scan = scan_folder(&ws, MAX_FILES, MAX_BYTES);
        assert_eq!(names(&scan), ["page.html", "pic.png"], "in name order, so the cap is predictable");
        assert_eq!(scan.skipped, Vec::<String>::new());
        assert_eq!(scan.rows[0].kind, "page");
        assert_eq!(scan.rows[1].kind, "image");
        assert_eq!(scan.rows[1].path, dir.join("pic.png").to_string_lossy().as_ref());
        assert_eq!(scan.rows[1].size, 3);
        assert!(scan.rows[1].mtime > 0, "a fresh file has a time");

        // Nothing changed: the next look gives the very same rows, stamps included.
        assert_eq!(scan_folder(&ws, MAX_FILES, MAX_BYTES), scan);
    }

    #[test]
    fn a_changed_file_changes_its_stamp_even_with_an_older_time() {
        let t = temp("artifacts-stamp");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        let pic = dir.join("pic.png");
        fs::write(&pic, "png").unwrap();
        let before = scan_folder(&ws, MAX_FILES, MAX_BYTES).rows[0].clone();

        // A restore from a backup (robocopy /COPY:DAT, cp -p) keeps an older time; the length and the
        // content are new. The stamp has to move, or the pane would keep showing the old picture.
        fs::write(&pic, "pngpng").unwrap();
        let older = SystemTime::now() - Duration::from_secs(3600);
        fs::File::options().write(true).open(&pic).unwrap().set_modified(older).unwrap();
        let after = scan_folder(&ws, MAX_FILES, MAX_BYTES).rows[0].clone();
        assert_eq!(after.size, 6);
        assert_ne!((after.mtime, after.size), (before.mtime, before.size));
        assert!(after.mtime < before.mtime, "an older time still counts as changed");
    }

    #[test]
    fn a_deleted_file_leaves_on_the_next_scan() {
        let t = temp("artifacts-gone");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("keep.png"), "png").unwrap();
        fs::write(dir.join("gone.png"), "png").unwrap();
        assert_eq!(names(&scan_folder(&ws, MAX_FILES, MAX_BYTES)), ["gone.png", "keep.png"]);
        fs::remove_file(dir.join("gone.png")).unwrap();
        assert_eq!(names(&scan_folder(&ws, MAX_FILES, MAX_BYTES)), ["keep.png"], "the folder is the index, so a deleted file cannot linger");
    }

    #[test]
    fn an_empty_dot_half_written_or_other_file_is_skipped() {
        let t = temp("artifacts-skip");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("ok.PNG"), "ok").unwrap();
        fs::write(dir.join(".hidden.png"), "png").unwrap();
        fs::write(dir.join("empty.png"), "").unwrap();
        fs::write(dir.join("download.png.part"), "png").unwrap();
        fs::write(dir.join("save.png.tmp"), "png").unwrap();
        fs::write(dir.join("notes.txt"), "text").unwrap();
        fs::write(dir.join("clip.mkv"), "video").unwrap();
        fs::write(dir.join("sub/nested.png"), "png").unwrap();
        assert_eq!(names(&scan_folder(&ws, MAX_FILES, MAX_BYTES)), ["ok.PNG"], "an empty, hidden, half-written or unshowable file is not an artifact");
    }

    #[test]
    fn the_folder_caps_are_reported_not_dropped() {
        assert_eq!((MAX_FILES, MAX_BYTES), (200, 1024 * 1024 * 1024), "200 files and 1 GB per folder");
        let t = temp("artifacts-caps");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        for i in 0..5 {
            fs::write(dir.join(format!("f{i}.png")), "x").unwrap();
        }
        let scan = scan_folder(&ws, 3, MAX_BYTES);
        assert_eq!(names(&scan), ["f0.png", "f1.png", "f2.png"]);
        assert_eq!(scan.skipped.len(), 1, "{:?}", scan.skipped);
        assert!(scan.skipped[0].contains("more than 3 files") && scan.skipped[0].contains("only the first 3"), "{:?}", scan.skipped);

        // The file cap counts what the strip could show: notes and a subfolder do not use up the
        // room that is meant for pictures.
        let t3 = temp("artifacts-cap-kind");
        let ws3 = t3.join("Project");
        let dir3 = ws3.join(FOLDER);
        fs::create_dir_all(dir3.join("shots")).unwrap();
        for n in ["a.txt", "b.txt", "c.txt"] {
            fs::write(dir3.join(n), "text").unwrap();
        }
        for n in ["p1.png", "p2.png", "p3.png"] {
            fs::write(dir3.join(n), "png").unwrap();
        }
        let scan = scan_folder(&ws3, 3, MAX_BYTES);
        assert_eq!(names(&scan), ["p1.png", "p2.png", "p3.png"]);
        assert!(scan.skipped.is_empty(), "three pictures fit under a three-file cap: {:?}", scan.skipped);

        // Bytes: four 10-byte files under a 25-byte cap keep two, and the rest is said, not lost.
        let t2 = temp("artifacts-bytecap");
        let ws2 = t2.join("Project");
        let dir2 = ws2.join(FOLDER);
        fs::create_dir_all(&dir2).unwrap();
        for n in ["a", "b", "c", "d"] {
            fs::write(dir2.join(format!("{n}.png")), "0123456789").unwrap();
        }
        let scan = scan_folder(&ws2, MAX_FILES, 25);
        assert_eq!(names(&scan), ["a.png", "b.png"]);
        assert_eq!(scan.skipped.len(), 1, "{:?}", scan.skipped);
        assert!(scan.skipped[0].contains("holds more than") && scan.skipped[0].contains("not listed"), "{:?}", scan.skipped);
    }

    #[test]
    fn a_share_is_judged_by_its_spelling_before_anything_is_touched() {
        for share in [r"\\server\share", r"\\server\share\ws\artifacts", "//server/share/ws", r"\\?\UNC\server\share\ws", r"\\.\UNC\server\share\ws", r"\\.\C:\Windows"] {
            assert!(on_share(Path::new(share)), "{share}");
        }
        for local in [r"C:\ws", r"c:\ws\artifacts\a.png", r"\\?\C:\ws\artifacts"] {
            assert!(!on_share(Path::new(local)), "{local}");
        }
        // A share path is refused as text; the scan and the read never stat it, so the host is never
        // asked for a credential.
        let share = Path::new(r"\\kolux-none.invalid\share\ws");
        assert!(scan_folder(share, MAX_FILES, MAX_BYTES).rows.is_empty());
        assert!(read_file(share, &share.join(FOLDER).join("a.png"), MAX_READ).is_err());
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) -> bool {
        std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().is_ok_and(|o| o.status.success())
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_where_the_folder_should_be_is_never_followed() {
        let t = temp("artifacts-junction");
        let ws = t.join("Project");
        let outside = t.join("outside");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("id_rsa.png"), "SECRET").unwrap();
        assert!(junction(&ws.join(FOLDER), &outside), "mklink /J needs no privilege");
        let scan = scan_folder(&ws, MAX_FILES, MAX_BYTES);
        assert!(scan.rows.is_empty(), "a junction artifacts/ folder is not the chat's folder");
        assert!(read_file(&ws, &outside.join("id_rsa.png"), MAX_READ).is_err(), "nothing behind the junction is read");
        // rmdir removes the junction itself, not the folder it points at.
        fs::remove_dir(ws.join(FOLDER)).unwrap();
        assert!(outside.join("id_rsa.png").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_linked_file_is_not_listed_and_not_read() {
        let t = temp("artifacts-link");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        let outside = t.join("outside");
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("id_rsa.png"), "SECRET").unwrap();
        fs::write(dir.join("a.png"), "png").unwrap();
        let link = dir.join("key.png");
        if std::os::windows::fs::symlink_file(outside.join("id_rsa.png"), &link).is_err() {
            eprintln!("skipped: a file link needs developer mode or an administrator");
            return;
        }
        assert_eq!(names(&scan_folder(&ws, MAX_FILES, MAX_BYTES)), ["a.png"], "a link is not a deliverable");
        assert!(read_file(&ws, &link, MAX_READ).is_err(), "a link is refused at read too, not only by its path");
        assert!(read_file(&ws, &dir.join("a.png"), MAX_READ).is_ok(), "a plain file still reads");
    }

    #[test]
    fn a_read_returns_the_file_as_base64_and_never_more_than_its_cap() {
        let t = temp("artifacts-read");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("pic.png"), "png").unwrap();
        assert_eq!(read_file(&ws, &dir.join("pic.png"), MAX_READ).unwrap(), "cG5n");
        let err = read_file(&ws, &dir.join("pic.png"), 2).unwrap_err();
        assert!(err.contains("preview limit"), "{err}");
        // A sparse file over the preview limit is refused from its length, never read into memory
        // whole because the caller asked for a bigger cap.
        let huge = dir.join("huge.png");
        fs::File::create(&huge).unwrap().set_len(MAX_READ + 1).unwrap();
        assert!(read_file(&ws, &huge, u64::MAX).is_err(), "asking for more than 10 MB still reads at most 10 MB");
    }

    #[test]
    fn a_read_checks_the_path_again() {
        let t = temp("artifacts-recheck");
        let ws = t.join("Project");
        let dir = ws.join(FOLDER);
        let outside = t.join("outside");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(dir.join("a.png"), "png").unwrap();
        fs::write(dir.join("sub").join("b.png"), "png").unwrap();
        fs::write(outside.join("secret.png"), "SECRET").unwrap();
        assert!(read_file(&ws, &dir.join("a.png"), MAX_READ).is_ok());
        for bad in [
            outside.join("secret.png"),                                  // outside the chat's folder
            dir.join("sub").join("b.png"),                               // a file below it, not directly in it
            dir.join("..").join("..").join("outside").join("secret.png"), // a path that climbs out
            PathBuf::from("a.png"),                                      // not a full path
            dir.clone(),                                                 // a folder is not a file
            dir.join("not-there.png"),                                   // gone since the scan
        ] {
            assert!(read_file(&ws, &bad, MAX_READ).is_err(), "{}", bad.display());
        }
        // A file that is real but belongs to another chat's folder is refused as well.
        let other = t.join("Other");
        fs::create_dir_all(other.join(FOLDER)).unwrap();
        fs::write(other.join(FOLDER).join("a.png"), "png").unwrap();
        assert!(read_file(&other, &dir.join("a.png"), MAX_READ).is_err());
    }
}
