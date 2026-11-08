//! T-790 (DT-C212): the product's identifier changed from `com.txaisxiong.kolux-rs` to
//! `com.txaisxiong.kolux`, and the profile folder is named after the identifier
//! (`%APPDATA%\<identifier>`). The first start under the new identifier copies the old profile in, so
//! projects, settings and history are all still there.
//!
//! The rules, each with a test below:
//! - the old folder is the new folder's name plus `-rs`, beside it (`com.txaisxiong.kolux-proof` finds
//!   `com.txaisxiong.kolux-proof-rs`). Any other folder is never looked at, so the lane, smoke and backup
//!   profiles (`com.txaisxiong.kolux-rs-smoke`, ...) are never carried and never touched;
//! - it copies and never deletes: the old profile stays exactly as it was, so going back is possible;
//! - it runs only when the new profile has no `state.db` yet, and `state.db` is written last (under a
//!   temporary name, then renamed), so an interrupted copy is finished by the next start and a finished
//!   one is never repeated;
//! - a file already in the new profile is never overwritten;
//! - links are never followed and never copied;
//! - `cli.json` (the old run's address and token) and lock files are not copied;
//! - a development or test build never copies (`cfg!(debug_assertions)`): only an installed release does.
//!
//! ponytail: the WebView's own storage (`%LOCALAPPDATA%\<identifier>\EBWebView`, the interface's remembered
//! conveniences such as the last Settings page) starts fresh under the new identifier; upgrade: copy that
//! folder the same way if a user misses them.
use std::fs;
use std::path::{Path, PathBuf};

use crate::resources::recovery::STATE_FILE;

/// What the old profile's name is, relative to the new one's.
pub const FORMER_SUFFIX: &str = "-rs";

/// Left out of the copy: the old run's address and token, and anything that is only a lock.
const SKIPPED: &[&str] = &["cli.json"];

/// The write-ahead log that belongs to `state.db`.
const WAL: &str = "state.db-wal";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Moved {
    pub from: PathBuf,
    pub files: usize,
    pub bytes: u64,
    /// Entries that could not be copied or were links, by name; the copy goes on without them.
    pub left: Vec<String>,
}

impl Moved {
    pub fn summary(&self) -> String {
        format!("profile copied from {} ({} files, {} bytes{}) (T-790)", self.from.display(), self.files, self.bytes, if self.left.is_empty() { String::new() } else { format!("; not copied: {}", self.left.join(", ")) })
    }
}

/// The old profile folder for `profile` (the new one): its name plus `-rs`, in the same folder.
pub fn former_of(profile: &Path) -> Option<PathBuf> {
    let name = profile.file_name()?.to_str()?;
    Some(profile.parent()?.join(format!("{name}{FORMER_SUFFIX}")))
}

/// Whether `md` is a link of any kind (a symbolic link or a junction); the copy never follows one.
fn is_link(md: &fs::Metadata) -> bool {
    md.file_type().is_symlink() || reparse_point(md)
}

#[cfg(windows)]
fn reparse_point(md: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_REPARSE_POINT
    md.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn reparse_point(_: &fs::Metadata) -> bool {
    false
}

/// The start-up step (lib.rs setup, before anything writes into the profile). An installed release only.
pub fn run(profile: &Path) -> Option<Moved> {
    if cfg!(debug_assertions) {
        return None;
    }
    move_profile(profile)
}

/// Copies the former profile into `profile` when it exists and `profile` holds no `state.db` yet.
pub fn move_profile(profile: &Path) -> Option<Moved> {
    if profile.join(STATE_FILE).exists() {
        return None;
    }
    let from = former_of(profile)?;
    let md = fs::symlink_metadata(&from).ok()?;
    if !md.is_dir() || is_link(&md) || !from.join(STATE_FILE).is_file() {
        return None;
    }
    let mut out = Moved { from: from.clone(), ..Moved::default() };
    fs::create_dir_all(profile).ok()?;
    // Everything but the database first, then the log beside it, then the database itself.
    copy_tree(&from, profile, true, &mut out);
    copy_file(&from.join(WAL), &profile.join(WAL), &mut out);
    let tmp = profile.join(format!("{STATE_FILE}.copying"));
    let _ = fs::remove_file(&tmp);
    match fs::copy(from.join(STATE_FILE), &tmp).and_then(|n| fs::rename(&tmp, profile.join(STATE_FILE)).map(|()| n)) {
        Ok(n) => {
            out.files += 1;
            out.bytes += n;
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            out.left.push(format!("{STATE_FILE} ({e})"));
            // Without the database the profile is not complete: the next start tries again.
            return Some(out);
        }
    }
    Some(out)
}

fn skipped(name: &str, top: bool) -> bool {
    let lower = name.to_ascii_lowercase();
    // The database and its log are placed last by `move_profile`; `.copying` is a leftover of an earlier try.
    (top && (SKIPPED.contains(&lower.as_str()) || lower == STATE_FILE || lower == WAL || lower == format!("{STATE_FILE}.copying") || lower == "state.db-shm")) || lower.ends_with(".lock")
}

fn copy_file(from: &Path, to: &Path, out: &mut Moved) {
    if !from.is_file() || to.exists() {
        return;
    }
    match fs::copy(from, to) {
        Ok(n) => {
            out.files += 1;
            out.bytes += n;
        }
        Err(e) => out.left.push(format!("{} ({e})", from.file_name().and_then(|n| n.to_str()).unwrap_or("?"))),
    }
}

fn copy_tree(from: &Path, to: &Path, top: bool, out: &mut Moved) {
    let Ok(entries) = fs::read_dir(from) else {
        out.left.push(format!("{} (unreadable)", from.display()));
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if skipped(&name, top) {
            continue;
        }
        let Ok(md) = fs::symlink_metadata(e.path()) else { continue };
        if is_link(&md) {
            out.left.push(format!("{name} (a link)"));
        } else if md.is_dir() {
            let dest = to.join(&name);
            if fs::create_dir_all(&dest).is_ok() {
                copy_tree(&e.path(), &dest, false, out);
            } else {
                out.left.push(format!("{name} (folder not made)"));
            }
        } else {
            copy_file(&e.path(), &to.join(&name), out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-t790-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(p: &Path, text: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn t790_the_former_folder_is_the_new_name_plus_rs_and_nothing_else() {
        let new = Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux");
        assert_eq!(former_of(new).unwrap(), Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs"));
        let scratch = Path::new(r"C:\x\com.txaisxiong.kolux-proof");
        assert_eq!(former_of(scratch).unwrap(), Path::new(r"C:\x\com.txaisxiong.kolux-proof-rs"));
    }

    #[test]
    fn t790_the_profile_is_copied_once_and_the_old_one_stays_as_it_was() {
        let r = root("copy");
        let (old, new) = (r.join("com.txaisxiong.kolux-proof-rs"), r.join("com.txaisxiong.kolux-proof"));
        put(&old.join("state.db"), "the database");
        put(&old.join("state.db-wal"), "the log");
        put(&old.join("kolux.log"), "history");
        put(&old.join("artifacts").join("a").join("one.txt"), "nested");
        put(&old.join("cli.json"), "{\"token\":\"old\"}");
        put(&old.join("import.lock"), "x");
        let m = move_profile(&new).expect("moved");
        assert_eq!(fs::read_to_string(new.join("state.db")).unwrap(), "the database");
        assert_eq!(fs::read_to_string(new.join("state.db-wal")).unwrap(), "the log");
        assert_eq!(fs::read_to_string(new.join("kolux.log")).unwrap(), "history");
        assert_eq!(fs::read_to_string(new.join("artifacts").join("a").join("one.txt")).unwrap(), "nested");
        assert!(!new.join("cli.json").exists(), "the old run's address and token stay behind");
        assert!(!new.join("import.lock").exists());
        assert!(!new.join("state.db.copying").exists());
        assert_eq!(m.files, 4, "{m:?}");
        assert!(m.left.is_empty(), "{m:?}");
        // The old profile is exactly as it was.
        assert_eq!(fs::read_to_string(old.join("state.db")).unwrap(), "the database");
        assert!(old.join("cli.json").exists() && old.join("import.lock").exists() && old.join("artifacts").join("a").join("one.txt").exists());
        // Done once: the new profile keeps its own changes on the next start.
        put(&new.join("state.db"), "changed in the new app");
        put(&old.join("kolux.log"), "history, later");
        assert_eq!(move_profile(&new), None);
        assert_eq!(fs::read_to_string(new.join("state.db")).unwrap(), "changed in the new app");
        assert_eq!(fs::read_to_string(new.join("kolux.log")).unwrap(), "history");
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn t790_a_new_profile_that_already_has_data_is_never_overwritten_and_an_interrupted_copy_is_finished() {
        let r = root("finish");
        let (old, new) = (r.join("com.txaisxiong.kolux-rs"), r.join("com.txaisxiong.kolux"));
        put(&old.join("state.db"), "old db");
        put(&old.join("a.txt"), "old a");
        put(&old.join("b.txt"), "old b");
        // An earlier start copied a.txt (changed since) and was cut off before the database.
        put(&new.join("a.txt"), "new a");
        put(&new.join("state.db.copying"), "half");
        let m = move_profile(&new).expect("finished");
        assert_eq!(fs::read_to_string(new.join("a.txt")).unwrap(), "new a", "never overwritten");
        assert_eq!(fs::read_to_string(new.join("b.txt")).unwrap(), "old b");
        assert_eq!(fs::read_to_string(new.join("state.db")).unwrap(), "old db");
        assert!(!new.join("state.db.copying").exists());
        assert_eq!(m.files, 2, "b.txt and the database: {m:?}");
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn t790_only_the_exact_former_folder_is_carried_not_the_lane_smoke_or_backup_profiles() {
        let r = root("others");
        for other in ["com.txaisxiong.kolux-rs-smoke", "com.txaisxiong.kolux-rs-backup", "com.txaisxiong.kolux-rs-lane7"] {
            put(&r.join(other).join("state.db"), other);
        }
        // No `com.txaisxiong.kolux-rs` here at all: nothing is carried, and nothing is made.
        let new = r.join("com.txaisxiong.kolux");
        assert_eq!(move_profile(&new), None);
        assert!(!new.exists());
        // A smoke identifier looks for its own former folder only.
        let smoke = r.join("com.txaisxiong.kolux-smoke");
        assert_eq!(move_profile(&smoke), None);
        assert!(!smoke.exists());
        for other in ["com.txaisxiong.kolux-rs-smoke", "com.txaisxiong.kolux-rs-backup", "com.txaisxiong.kolux-rs-lane7"] {
            assert_eq!(fs::read_to_string(r.join(other).join("state.db")).unwrap(), other, "untouched");
        }
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn t790_a_former_folder_without_a_database_or_a_file_in_its_place_is_left_alone() {
        let r = root("shapes");
        let (old, new) = (r.join("com.txaisxiong.kolux-rs"), r.join("com.txaisxiong.kolux"));
        put(&old.join("kolux.log"), "a log and no database");
        assert_eq!(move_profile(&new), None, "no state.db there: nothing to carry");
        assert!(!new.exists());
        fs::remove_dir_all(&old).unwrap();
        put(&old, "a file named like the folder");
        assert_eq!(move_profile(&new), None);
        assert!(!new.exists());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn t790_a_development_or_test_build_never_copies() {
        let r = root("debug");
        put(&r.join("com.txaisxiong.kolux-rs").join("state.db"), "real");
        let new = r.join("com.txaisxiong.kolux");
        assert_eq!(run(&new), None, "cfg!(debug_assertions) holds in a test build");
        assert!(!new.exists());
        let _ = fs::remove_dir_all(&r);
    }

    #[cfg(windows)]
    #[test]
    fn t790_a_junction_is_never_followed() {
        let r = root("link");
        let (old, new) = (r.join("com.txaisxiong.kolux-rs"), r.join("com.txaisxiong.kolux"));
        let elsewhere = r.join("elsewhere");
        put(&elsewhere.join("secret.txt"), "not part of the profile");
        put(&old.join("state.db"), "db");
        // mklink /J makes a junction without needing a privilege.
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(old.join("linked")).arg(&elsewhere).output().map(|o| o.status.success()).unwrap_or(false);
        if !made {
            eprintln!("t790: the junction could not be made here; the link case is not run");
            let _ = fs::remove_dir_all(&r);
            return;
        }
        let m = move_profile(&new).expect("moved");
        assert!(!new.join("linked").exists(), "the link was not followed");
        assert!(m.left.iter().any(|l| l.starts_with("linked")), "{m:?}");
        assert!(elsewhere.join("secret.txt").exists(), "what the link pointed at is untouched");
        let _ = std::process::Command::new("cmd").args(["/C", "rmdir"]).arg(old.join("linked")).output();
        let _ = fs::remove_dir_all(&r);
    }
}
