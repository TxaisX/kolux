// One rename for the orchestration tools (orchestration/runtime.rs): a new name in the same folder
// that never replaces another entry. The explorer's file operations and their Recycle Bin delete and
// restore went with the explorer (slim-down wave B).
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

/// Gives `from` a new name in the same folder. A symlink is renamed itself, never its target. A new
/// spelling of the same name (letter case, Unicode normalisation) is allowed; another entry's name is
/// not, in any spelling (T-616).
pub fn rename(from: &Path, name: &str) -> Result<PathBuf, String> {
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    rename_at(from, name)
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
}
