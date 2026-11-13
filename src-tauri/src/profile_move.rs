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
/// Review (T-790): the last-good copies (`state.db.bak`, `settings.json.bak`) stay behind too: they hold
/// paths into the old profile, and recovery would restore them; the new app writes its own.
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
pub(crate) fn is_link(md: &fs::Metadata) -> bool {
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
    // Everything but the database first, then the database itself.
    copy_tree(&from, profile, true, &mut out);
    // Review (T-790): paths the old profile stored about itself (a managed Claude account's folder, a
    // Codex home) now point into the new one, so nothing keeps running from, or is lost with, the old folder.
    let settings = profile.join("settings.json");
    if let Ok(text) = fs::read_to_string(&settings) {
        let moved = repoint(&text, &from, profile);
        if moved != text {
            // Under a temporary name, then renamed: a start killed mid-write never leaves it cut short.
            let tmp = profile.join("settings.json.kolux-copying");
            if fs::write(&tmp, moved).and_then(|()| fs::rename(&tmp, &settings)).is_err() {
                let _ = fs::remove_file(&tmp);
            }
        }
    }
    let tmp = profile.join(format!("{STATE_FILE}.copying"));
    // A killed run's temporary database and its side files go first (a stale log could replay over the snapshot).
    for side in ["", "-wal", "-shm", "-journal"] {
        let _ = fs::remove_file(profile.join(format!("{STATE_FILE}.copying{side}")));
    }
    // Review (T-790): if SQLite cannot take the snapshot (a damaged or long-busy database), the files are
    // copied as they are, so the first start never comes up on an empty profile; recovery then works on them.
    let copied = copy_database(&from.join(STATE_FILE), &tmp, &from, profile).or_else(|why| {
        for side in ["-wal", "-shm", "-journal"] {
            let _ = fs::remove_file(profile.join(format!("{STATE_FILE}.copying{side}")));
        }
        out.left.push(format!("{STATE_FILE} snapshot ({why}); copied as it is"));
        copy_file(&from.join(WAL), &profile.join(WAL), &mut out);
        fs::copy(from.join(STATE_FILE), &tmp).map_err(|e| e.to_string())
    });
    match copied.and_then(|n| fs::rename(&tmp, profile.join(STATE_FILE)).map(|()| n).map_err(|e| e.to_string())) {
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

/// `text` with every path under `from` (followed by a separator, so `...-rs-smoke` is never matched)
/// moved under `to`, both as written and as JSON writes it (a Windows `\` doubled).
fn repoint(text: &str, from: &Path, to: &Path) -> String {
    let (from, to) = (from.to_string_lossy(), to.to_string_lossy());
    let mut out = text.to_string();
    for sep in ["\\", "/"] {
        out = out.replace(&format!("{from}{sep}"), &format!("{to}{sep}"));
        let (jf, jt) = (from.replace('\\', "\\\\"), to.replace('\\', "\\\\"));
        let js = sep.replace('\\', "\\\\");
        out = out.replace(&format!("{jf}{js}"), &format!("{jt}{js}"));
    }
    out
}

/// Copies the old `state.db` to `tmp` through SQLite itself (`VACUUM INTO`), so the copy is one consistent
/// snapshot (its write-ahead log included) even if the old app is still writing; then repoints the
/// stored paths (see `repoint`). The size of the copy, or why it failed.
fn copy_database(old: &Path, tmp: &Path, from: &Path, to: &Path) -> Result<u64, String> {
    use rusqlite::{Connection, OpenFlags};
    let src = Connection::open_with_flags(old, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| e.to_string())?;
    src.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    // VACUUM INTO writes one consistent snapshot (read in a single transaction) into a new file.
    src.execute("VACUUM INTO ?1", [tmp.to_string_lossy()]).map_err(|e| e.to_string())?;
    drop(src);
    let mut dst = Connection::open(tmp).map_err(|e| e.to_string())?;
    let has_kv: bool = dst.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'kv'", [], |r| r.get::<_, i64>(0)).map(|n| n > 0).map_err(|e| e.to_string())?;
    if has_kv {
        let rows: Vec<(String, String)> = {
            let mut q = dst.prepare("SELECT key, value FROM kv").map_err(|e| e.to_string())?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        let tx = dst.transaction().map_err(|e| e.to_string())?;
        for (key, value) in rows {
            let moved = repoint(&value, from, to);
            if moved != value {
                tx.execute("UPDATE kv SET value = ?1 WHERE key = ?2", rusqlite::params![moved, key]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    // One self-contained file: no log beside it to lose in the rename.
    dst.pragma_update(None, "journal_mode", "DELETE").map_err(|e| e.to_string())?;
    drop(dst);
    fs::metadata(tmp).map(|m| m.len()).map_err(|e| e.to_string())
}

fn skipped(name: &str, top: bool) -> bool {
    let lower = name.to_ascii_lowercase();
    // The database and its log are placed last by `move_profile`; `.copying` is a leftover of an earlier try.
    (top && (SKIPPED.contains(&lower.as_str()) || lower == "state.db.bak" || lower == "settings.json.bak" || lower == STATE_FILE || lower == WAL || lower == format!("{STATE_FILE}.copying") || lower == "state.db-shm")) || lower.ends_with(".lock")
}

fn copy_file(from: &Path, to: &Path, out: &mut Moved) {
    if !from.is_file() || to.exists() {
        return;
    }
    // Review (T-790): under a temporary name, then renamed, so a copy cut short by a killed start is
    // redone on the next one rather than kept half-written.
    let mut tmp = to.as_os_str().to_owned();
    tmp.push(".kolux-copying");
    let tmp = PathBuf::from(tmp);
    match fs::copy(from, &tmp).and_then(|n| fs::rename(&tmp, to).map(|()| n)) {
        Ok(n) => {
            out.files += 1;
            out.bytes += n;
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            out.left.push(format!("{} ({e})", from.file_name().and_then(|n| n.to_str()).unwrap_or("?")));
        }
    }
}

pub(crate) fn copy_tree(from: &Path, to: &Path, top: bool, out: &mut Moved) {
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

    /// A real `state.db` (as the app keeps it: write-ahead log on) holding `value` under the key `k`.
    fn db(p: &Path, value: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let c = rusqlite::Connection::open(p).unwrap();
        c.pragma_update(None, "journal_mode", "WAL").unwrap();
        c.execute_batch("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
        c.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('k', ?1)", [value]).unwrap();
    }

    fn kv(p: &Path) -> String {
        rusqlite::Connection::open(p).unwrap().query_row("SELECT value FROM kv WHERE key = 'k'", [], |r| r.get(0)).unwrap()
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
        db(&old.join("state.db"), "the database");
        put(&old.join("kolux.log"), "history");
        put(&old.join("artifacts").join("a").join("one.txt"), "nested");
        put(&old.join("cli.json"), "{\"token\":\"old\"}");
        put(&old.join("import.lock"), "x");
        let m = move_profile(&new).expect("moved");
        assert_eq!(kv(&new.join("state.db")), "the database");
        assert!(!new.join("state.db-wal").exists(), "the copy is one self-contained file");
        assert_eq!(fs::read_to_string(new.join("kolux.log")).unwrap(), "history");
        assert_eq!(fs::read_to_string(new.join("artifacts").join("a").join("one.txt")).unwrap(), "nested");
        assert!(!new.join("cli.json").exists(), "the old run's address and token stay behind");
        assert!(!new.join("import.lock").exists());
        assert!(!new.join("state.db.copying").exists());
        assert_eq!(m.files, 3, "{m:?}"); // kolux.log, artifacts/a/one.txt, state.db (its log is in the snapshot)
        assert!(m.left.is_empty(), "{m:?}");
        // The old profile is exactly as it was.
        assert_eq!(kv(&old.join("state.db")), "the database");
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
        db(&old.join("state.db"), "old db");
        put(&old.join("a.txt"), "old a");
        put(&old.join("b.txt"), "old b");
        // An earlier start copied a.txt (changed since) and was cut off before the database.
        put(&new.join("a.txt"), "new a");
        put(&new.join("state.db.copying"), "half");
        let m = move_profile(&new).expect("finished");
        assert_eq!(fs::read_to_string(new.join("a.txt")).unwrap(), "new a", "never overwritten");
        assert_eq!(fs::read_to_string(new.join("b.txt")).unwrap(), "old b");
        assert_eq!(kv(&new.join("state.db")), "old db");
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
        db(&old.join("state.db"), "db");
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

    /// Links are never followed and never copied: a link inside the old profile (to a folder or a file
    /// outside it) is left behind and named in the summary; the old profile itself as a link is not moved.
    #[cfg(unix)]
    #[test]
    fn t790_links_are_never_followed_or_copied() {
        use std::os::unix::fs::symlink;
        let r = root("links");
        let (old, new) = (r.join("com.txaisxiong.kolux-proof-rs"), r.join("com.txaisxiong.kolux-proof"));
        let outside = r.join("outside");
        put(&outside.join("secret.txt"), "not part of the profile");
        db(&old.join("state.db"), "the database");
        symlink(&outside, old.join("linked-folder")).unwrap();
        symlink(outside.join("secret.txt"), old.join("linked-file.txt")).unwrap();
        let m = move_profile(&new).expect("moved");
        assert!(fs::symlink_metadata(new.join("linked-folder")).is_err() && fs::symlink_metadata(new.join("linked-file.txt")).is_err());
        assert!(m.left.iter().any(|l| l.starts_with("linked-folder")) && m.left.iter().any(|l| l.starts_with("linked-file.txt")), "{:?}", m.left);
        assert_eq!(kv(&new.join("state.db")), "the database");
        // An old profile that is itself a link is not moved at all.
        let (old2, new2) = (r.join("com.txaisxiong.kolux-link-rs"), r.join("com.txaisxiong.kolux-link"));
        symlink(&old, &old2).unwrap();
        assert_eq!(move_profile(&new2), None);
        assert!(!new2.exists());
        let _ = fs::remove_dir_all(&r);
    }


    /// Review (T-790): what the old app wrote but had not yet folded into the database (its
    /// write-ahead log, while it still runs) is in the copy, which is one consistent snapshot.
    #[test]
    fn t790_the_database_is_copied_as_one_snapshot_with_its_unfolded_log() {
        let r = root("snapshot");
        let (old, new) = (r.join("com.txaisxiong.kolux-proof-rs"), r.join("com.txaisxiong.kolux-proof"));
        db(&old.join("state.db"), "first");
        let live = rusqlite::Connection::open(old.join("state.db")).unwrap();
        live.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        live.execute("UPDATE kv SET value = 'latest' WHERE key = 'k'", []).unwrap();
        assert!(fs::metadata(old.join("state.db-wal")).map(|m| m.len() > 0).unwrap_or(false), "premise: the change is only in the log");
        move_profile(&new).expect("moved");
        assert_eq!(kv(&new.join("state.db")), "latest");
        drop(live);
        let _ = fs::remove_dir_all(&r);
    }

    /// Review (T-790): a managed account's folder and a Codex home are stored as absolute paths in the
    /// old profile; after the copy they point into the new one (JSON-escaped Windows paths too), and a
    /// sibling profile whose name only starts the same is left as it was.
    #[test]
    fn t790_paths_into_the_old_profile_are_repointed_to_the_new_one() {
        let (from, to) = (Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs"), Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux"));
        let json = r#"[{"config_dir":"C:\\Users\\me\\AppData\\Roaming\\com.txaisxiong.kolux-rs\\claude-accounts\\a1"},{"home":"C:\\Users\\me\\AppData\\Roaming\\com.txaisxiong.kolux-rs-smoke\\x"}]"#;
        let want = r#"[{"config_dir":"C:\\Users\\me\\AppData\\Roaming\\com.txaisxiong.kolux\\claude-accounts\\a1"},{"home":"C:\\Users\\me\\AppData\\Roaming\\com.txaisxiong.kolux-rs-smoke\\x"}]"#;
        assert_eq!(repoint(json, from, to), want);
        // End to end on this system's paths: the database and settings.json both.
        let r = root("repoint");
        let (old, new) = (r.join("com.txaisxiong.kolux-proof-rs"), r.join("com.txaisxiong.kolux-proof"));
        let stored = serde_json::json!({ "config_dir": old.join("claude-accounts").join("a1") }).to_string();
        db(&old.join("state.db"), &stored);
        put(&old.join("settings.json"), &stored);
        move_profile(&new).expect("moved");
        let expect = serde_json::json!({ "config_dir": new.join("claude-accounts").join("a1") }).to_string();
        assert_eq!(kv(&new.join("state.db")), expect);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), expect);
        assert_eq!(kv(&old.join("state.db")), stored, "the old profile stays as it was");
        let _ = fs::remove_dir_all(&r);
    }


    /// Review (T-790): a database SQLite cannot snapshot (damaged) is still carried, as it is, so the first
    /// start never comes up empty (recovery takes it from there); leftovers of a killed run are cleared; the
    /// last-good copies stay behind.
    #[test]
    fn t790_a_damaged_database_is_carried_as_it_is_and_the_last_good_copies_stay_behind() {
        let r = root("damaged");
        let (old, new) = (r.join("com.txaisxiong.kolux-proof-rs"), r.join("com.txaisxiong.kolux-proof"));
        put(&old.join("state.db"), "not a database at all");
        put(&old.join("state.db.bak"), "old last-good database");
        put(&old.join("settings.json.bak"), "old last-good settings");
        put(&new.join("state.db.copying-wal"), "a stale log from a killed run");
        let m = move_profile(&new).expect("moved");
        assert_eq!(fs::read_to_string(new.join("state.db")).unwrap(), "not a database at all");
        assert!(m.left.iter().any(|l| l.contains("snapshot") && l.contains("copied as it is")), "{m:?}");
        assert!(!new.join("state.db.copying-wal").exists() && !new.join("state.db.copying").exists());
        assert!(!new.join("state.db.bak").exists() && !new.join("settings.json.bak").exists());
        let _ = fs::remove_dir_all(&r);
    }

}
