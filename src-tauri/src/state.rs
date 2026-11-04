//! The state store: SQLite for app state, one JSON file for user settings, both under the
//! profile folder. Everything the user sets up is saved as they go (LOOP.md stack; theme 9).

use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// What `Store::keep_aside` did; only `Done` wrote anything.
#[derive(Debug, PartialEq, Eq)]
pub enum KeepAside {
    Done,
    NameTaken,
    Changed,
}

pub struct Store {
    conn: Connection,
    settings_path: PathBuf,
    /// T-441-b: the last read of settings.json failed and fell back to defaults, so a save built
    /// on what that read returned would wipe the file. Saves refuse until a read succeeds again.
    read_failed: AtomicBool,
    /// after-list #39: set once per run when a read fell back to settings.json.bak; the window takes it and says so.
    fallback_notice: std::sync::Mutex<Option<String>>,
    fallback_told: AtomicBool,
    /// Row 881: keys whose blob did not read and was not copied aside. Saves to them are refused, so
    /// a registry or list that fell back to defaults cannot overwrite the original blob.
    poisoned: std::sync::Mutex<std::collections::BTreeSet<String>>,
}

impl Store {
    /// Opens (or creates) the store under `dir`. Creates the folder and the schema on first use.
    pub fn open(dir: &Path) -> rusqlite::Result<Store> {
        fs::create_dir_all(dir).map_err(|e| rusqlite::Error::InvalidPath(dir.join(e.to_string())))?;
        let conn = Connection::open(dir.join("state.db"))?;
        // Pins rusqlite's 5 s default so a future default change cannot drop it; absorbs a transient SQLITE_BUSY so held keys are not poisoned for nothing.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        let store = Store { conn, settings_path: dir.join("settings.json"), read_failed: AtomicBool::new(false), fallback_notice: std::sync::Mutex::new(None), fallback_told: AtomicBool::new(false), poisoned: Default::default() };
        store.carry_setup_policy();
        Ok(store)
    }

    /// C20-R1-01: the setup policy is one kv key, the one setup.rs reads. A profile that picked it
    /// on the settings page before this change holds it in settings.json only, so it is carried
    /// over once, when kv has no policy yet. Nothing reads the settings copy afterwards.
    fn carry_setup_policy(&self) {
        if self.get(crate::setup::POLICY_KEY).ok().flatten().is_some_and(|v| !v.trim().is_empty()) {
            return;
        }
        let stored = self.try_settings().ok().and_then(|s| s.get(crate::setup::POLICY_KEY).and_then(|v| v.as_str()).map(str::trim).filter(|p| !p.is_empty()).map(str::to_string));
        if let Some(p) = stored {
            let _ = self.set(crate::setup::POLICY_KEY, &p);
        }
    }

    /// Row 785: a settings file that lacks the look or the mode gets them, once, as the page
    /// would (SET-037, T-418: Classic for a profile that had settings, New for an empty one, Dark).
    /// Row 785-b: a profile with no file at all is an empty one and gets the file. Called once at
    /// startup, before the window, so it never waits on the page's first read, which a slow start
    /// abandons and leaves for the next launch. A file that has both is not written; an unreadable
    /// one, a last good copy and a missing file that leaves a .bak behind are left alone.
    pub fn stamp_look(&self) {
        let now = match self.read_file() {
            Ok(Read::File(_, now)) => now,
            Ok(Read::None) => serde_json::json!({}), // read_file only says None when there is no .bak either
            _ => return,
        };
        let Some(obj) = now.as_object() else { return };
        let has = |key: &str, ok: &[&str]| obj.get(key).and_then(|v| v.as_str()).is_some_and(|v| ok.contains(&v));
        let mut set = serde_json::Map::new();
        if !has("uiLook", &["classic", "new"]) {
            set.insert("uiLook".into(), (if obj.is_empty() { "new" } else { "classic" }).into());
        }
        if !has("appearanceMode", &["light", "dark", "system"]) {
            set.insert("appearanceMode".into(), "dark".into());
        }
        if !set.is_empty() {
            if let Err(e) = self.save_settings(&patched(now, &set, &[])) {
                eprintln!("kolux: could not write the look and mode into settings.json: {e}");
            }
        }
    }

    /// The profile folder the store lives in.
    pub fn dir(&self) -> PathBuf {
        self.settings_path.parent().map(Path::to_path_buf).unwrap_or_default()
    }

    pub fn get(&self, key: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |r| r.get(0))
            .map(Some)
            .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
    }

    /// Marks `key` as holding a blob that could not be read or kept aside; saves to it are refused.
    /// Only a successful `keep_aside` of the key clears it (a later plain read does not).
    pub fn poison(&self, key: &str) {
        self.poisoned.lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string());
    }

    fn refuse_poisoned<'a>(&self, keys: impl IntoIterator<Item = &'a str>) -> rusqlite::Result<()> {
        let bad = self.poisoned.lock().unwrap_or_else(|e| e.into_inner());
        match keys.into_iter().find(|k| bad.contains(*k)) {
            None => Ok(()),
            Some(k) => Err(rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!("{k} could not be read and was not kept aside; not saving over it. If the failure was temporary, restarting Kolux reads it again"))))),
        }
    }

    pub fn set(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.refuse_poisoned([key])?;
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Several keys in one transaction: all of them land, or none do.
    pub fn set_all(&self, pairs: &[(&str, &str)]) -> rusqlite::Result<()> {
        self.refuse_poisoned(pairs.iter().map(|(k, _)| *k))?;
        let tx = self.conn.unchecked_transaction()?;
        for (k, v) in pairs {
            tx.execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![k, v])?;
        }
        tx.commit()
    }

    /// Row 875, in one transaction: copy `read` to the new key `aside` (a plain insert, never an
    /// upsert) and set `key` to `fresh`, but only while `key` still holds `read`. Any other outcome
    /// than `Done` changes nothing.
    pub fn keep_aside(&self, key: &str, read: &str, aside: &str, fresh: &str) -> rusqlite::Result<KeepAside> {
        let tx = self.conn.unchecked_transaction()?;
        match tx.execute("INSERT INTO kv (key, value) VALUES (?1, ?2)", params![aside, read]) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY || e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
            {
                return Ok(KeepAside::NameTaken);
            }
            Err(e) => return Err(e),
        }
        if tx.execute("UPDATE kv SET value = ?1 WHERE key = ?2 AND value = ?3", params![fresh, key, read])? == 0 {
            return Ok(KeepAside::Changed);
        }
        tx.commit()?;
        self.poisoned.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
        Ok(KeepAside::Done)
    }

    /// User settings as JSON. No file and no .bak yet reads as an empty object; a file that is missing beside a .bak, cannot be read or
    /// is not a JSON object is an error, never an empty set (T-441), unless the last good copy
    /// (settings.json.bak) still reads: then that copy is what the user gets (T-075, APP-048).
    pub fn try_settings(&self) -> std::io::Result<serde_json::Value> {
        let read = self.read_file();
        self.read_failed.store(read.is_err(), Ordering::SeqCst);
        Ok(match read? {
            Read::None => serde_json::json!({}),
            Read::File(_, v) | Read::Backup(v) => v,
        })
    }

    /// after-list #38: a free `settings.json.corrupt-<ms>[-n]` name, so a second set-aside never replaces the first.
    fn corrupt_path(&self) -> PathBuf {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
        (0..).map(|n| self.settings_path.with_extension(if n == 0 { format!("json.corrupt-{ms}") } else { format!("json.corrupt-{ms}-{n}") })).find(|p| !p.exists()).unwrap_or_default()
    }

    /// after-list #39: what the window tells the user when settings came from the last good copy; handed out once.
    pub fn take_fallback_notice(&self) -> Option<String> {
        self.fallback_notice.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
    }

    fn bak_path(&self) -> PathBuf {
        self.settings_path.with_extension("json.bak")
    }

    /// What a settings read found: no file yet, the file itself (its bytes kept for the backup), or
    /// the last good copy because the file itself is corrupt or half-written (T-075, APP-048).
    fn read_file(&self) -> std::io::Result<Read> {
        // Row 944: a missing file beside a .bak is a lost file, not a first run: it takes the corrupt path.
        let e = match Self::read_json(&self.settings_path) {
            Ok(Some((bytes, v))) => return Ok(Read::File(bytes, v)),
            Ok(None) if !self.bak_path().exists() => return Ok(Read::None),
            Ok(None) => std::io::Error::new(std::io::ErrorKind::NotFound, "it is missing"),
            Err(e) => e,
        };
        match Self::read_json(&self.bak_path()) {
            Ok(Some((_, v))) => {
                eprintln!("kolux: {} could not be read ({e}); using the last good copy {}", self.settings_path.display(), self.bak_path().display());
                if !self.fallback_told.swap(true, Ordering::SeqCst) {
                    *self.fallback_notice.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(format!("Kolux could not read your settings file ({e}), so it is using the last good copy, {}. A change made since that copy may be missing.", self.bak_path().display()));
                }
                Ok(Read::Backup(v))
            }
            // read_json never errs with NotFound, so that kind is the missing-file case above.
            _ => {
                let e = if e.kind() == std::io::ErrorKind::NotFound {
                    std::io::Error::new(std::io::ErrorKind::NotFound, "it is missing, and its last good copy could not be read")
                } else {
                    e
                };
                self.tell_settings_unreadable(&e);
                Err(e)
            }
        }
    }

    /// C22-R2-01: the read failed and there is no readable last good copy, so the window is told
    /// once, at start, that it is on defaults and that saving is refused. Without this the only
    /// trace was stderr, and the first save blamed a change the user never made.
    fn tell_settings_unreadable(&self, e: &std::io::Error) {
        if !self.fallback_told.swap(true, Ordering::SeqCst) {
            *self.fallback_notice.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(format!(
                "Kolux could not read {} ({e}), so it is showing defaults and changes will not save. Nothing is written over the unreadable file.",
                self.settings_path.display()
            ));
        }
    }

    /// The file's bytes and the object they hold; `None` when there is no file yet.
    fn read_json(path: &Path) -> std::io::Result<Option<(Vec<u8>, serde_json::Value)>> {
        let bytes = match fs::read(path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) if v.is_object() => Ok(Some((bytes, crate::import::without_retired(v)))), // HID-036
            Ok(_) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "it is not a JSON object")),
            Err(e) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        }
    }

    fn refused(&self, why: impl std::fmt::Display, kind: std::io::ErrorKind) -> std::io::Error {
        let bak = self.bak_path();
        // C22-R2-01: name a last good copy only when one actually reads; the old sentence promised
        // a .bak that may not exist, or may itself be the unreadable file.
        let copy = if Self::read_json(&bak).ok().flatten().is_some() {
            format!("The last good copy is {}.", bak.display())
        } else {
            format!("There is no readable last good copy at {}.", bak.display())
        };
        std::io::Error::new(kind, format!("Kolux could not read {} ({why}), so it left the file untouched and saved nothing. {copy}", self.settings_path.display()))
    }

    /// C22-R2-01: the one explicit repair. Every file that cannot be read (settings.json and an
    /// unreadable settings.json.bak) is renamed to settings.json.corrupt-<ms>[-n], never deleted,
    /// and the refusal is cleared so the next save writes fresh defaults. Returns the names kept.
    pub fn repair_settings(&self) -> std::io::Result<Vec<PathBuf>> {
        let mut kept = Vec::new();
        for path in [self.settings_path.clone(), self.bak_path()] {
            if !path.exists() || Self::read_json(&path).ok().flatten().is_some() {
                continue;
            }
            let to = self.corrupt_path();
            fs::rename(&path, &to)?;
            kept.push(to);
        }
        self.read_failed.store(false, Ordering::SeqCst);
        Ok(kept)
    }

    /// User settings for reading. An unreadable file reads as empty here so the app still starts on
    /// defaults; every save refuses until the file reads again, so the empty copy never lands on disk.
    pub fn settings(&self) -> serde_json::Value {
        self.try_settings().unwrap_or_else(|e| {
            eprintln!("kolux: settings.json could not be read, using defaults and saving nothing: {e}");
            serde_json::json!({})
        })
    }

    /// Writes settings whole or not at all. Refuses while the file on disk cannot be read, and
    /// after a read that fell back to defaults (T-441-b: a read that failed once and worked on the
    /// retry would otherwise save the defaults over the real file). The bytes just read and checked
    /// become settings.json.bak, except that an empty set never replaces a backup, so the copy from
    /// before a wipe survives the saves after it. Both files are synced to disk; the new one is
    /// renamed into place.
    pub fn save_settings(&self, value: &serde_json::Value) -> std::io::Result<()> {
        if self.read_failed.load(Ordering::SeqCst) {
            return Err(self.refused("an earlier read of it failed", std::io::ErrorKind::InvalidData));
        }
        let current = self.read_file().map_err(|e| self.refused(&e, e.kind()))?;
        let write_synced = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
            use std::io::Write;
            let mut f = fs::File::create(path)?;
            f.write_all(bytes)?;
            f.sync_all()
        };
        match current {
            Read::File(bytes, old) => {
                let bak = self.bak_path();
                if !bak.exists() || old.as_object().is_some_and(|o| !o.is_empty()) {
                    // after-list #39: the backup goes in by tmp + rename too, so a crash mid-write never leaves a half .bak
                    let bak_tmp = self.settings_path.with_extension("json.bak.tmp");
                    write_synced(&bak_tmp, &bytes)?;
                    fs::rename(&bak_tmp, &bak)?;
                }
            }
            // T-075 (APP-048): the save is built on the last good copy, so that copy stays as it is
            // until the main file reads again; the corrupt bytes are set aside, never deleted.
            Read::Backup(_) => {
                // after-list #38: the corrupt file must be set aside before the save may land; a failed move refuses
                // the save (the corrupt bytes are never overwritten), and two set-asides in one second get two names.
                if self.settings_path.exists() {
                    fs::rename(&self.settings_path, self.corrupt_path()).map_err(|e| self.refused(format!("it could not be set aside: {e}"), e.kind()))?;
                }
            }
            Read::None => {}
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        write_synced(&tmp, &serde_json::to_vec_pretty(&crate::import::without_retired(value.clone()))?)?; // HID-036: never written back
        fs::rename(&tmp, &self.settings_path)
    }

    /// Writes only the keys in `set` and drops those in `remove`, over what is on disk now, so a
    /// writer holding an older copy of the settings does not undo anyone else's keys. A failed read
    /// fails the patch; it is never laid over an empty set.
    pub fn patch_settings(&self, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> std::io::Result<()> {
        let now = self.try_settings().map_err(|e| self.refused(&e, e.kind()))?;
        self.save_settings(&patched(now, set, remove))
    }
}

/// One settings read (see `Store::read_file`).
enum Read {
    None,
    File(Vec<u8>, serde_json::Value),
    Backup(serde_json::Value),
}

/// `value` with the keys in `set` laid over it and the keys in `remove` taken out.
pub fn patched(mut value: serde_json::Value, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> serde_json::Value {
    if !value.is_object() {
        value = serde_json::json!({});
    }
    if let Some(obj) = value.as_object_mut() {
        for k in remove {
            obj.remove(k);
        }
        for (k, v) in set {
            obj.insert(k.clone(), v.clone());
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn values_survive_reopening() {
        let dir = temp_dir("kv");
        {
            let s = Store::open(&dir).unwrap();
            assert_eq!(s.get("starts").unwrap(), None);
            s.set("starts", "1").unwrap();
            s.set("starts", "2").unwrap();
        }
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.get("starts").unwrap().as_deref(), Some("2"));
        drop(s); // Windows will not delete a folder while SQLite holds the db open
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn settings_round_trip_and_default_to_empty() {
        let dir = temp_dir("settings");
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.settings(), serde_json::json!({}));
        s.save_settings(&serde_json::json!({ "theme": "classic" })).unwrap();
        assert_eq!(s.settings()["theme"], "classic");
        assert!(!dir.join("settings.json.tmp").exists());
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn t441_a_corrupt_settings_file_is_never_overwritten() {
        let dir = temp_dir("corrupt");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "defaultAgent": "codex" })).unwrap();
        s.patch_settings(&serde_json::Map::from_iter([("theme".into(), serde_json::json!("new"))]), &[]).unwrap();
        // The backup holds the file as it was before the last save.
        let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
        assert_eq!(bak["theme"], "classic");

        // T-075: with no readable backup either, the read fails closed as T-441 had it.
        fs::write(dir.join("settings.json.bak"), b"{ not json").unwrap();
        for planted in [&b"{\"theme\": \"new\", \"defaultAg"[..], b"", b"[1,2]"] {
            fs::write(dir.join("settings.json"), planted).unwrap();
            assert!(s.try_settings().is_err());
            assert_eq!(s.settings(), serde_json::json!({}), "reads fall back to defaults");
            let err = s.patch_settings(&serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]), &[]).unwrap_err();
            assert!(err.to_string().contains("settings.json.bak"), "{err}");
            assert!(s.save_settings(&serde_json::json!({})).is_err());
            assert_eq!(fs::read(dir.join("settings.json")).unwrap(), planted, "the planted file is untouched");
            assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), b"{ not json", "the backup is untouched too");
        }
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn after39_a_read_that_fell_back_to_the_backup_leaves_one_notice_for_the_window() {
        let dir = temp_dir("after39");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic" })).unwrap();
        s.patch_settings(&serde_json::Map::from_iter([("theme".into(), serde_json::json!("new"))]), &[]).unwrap();
        assert_eq!(s.take_fallback_notice(), None, "a healthy file says nothing");
        fs::write(dir.join("settings.json"), b"{ half").unwrap();
        assert_eq!(s.settings()["theme"], "classic");
        let notice = s.take_fallback_notice().expect("the fallback is told");
        assert!(notice.contains("settings.json.bak"), "{notice}");
        assert_eq!(s.settings()["theme"], "classic");
        assert_eq!(s.take_fallback_notice(), None, "told once");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// C22-R2-01: an unreadable settings file with no readable backup is told at start, once, and
    /// the sentence says defaults and "will not save" instead of naming a copy that is not there.
    #[test]
    fn c22r2_01_an_unreadable_file_with_no_readable_backup_is_told_at_start_once() {
        let dir = temp_dir("c22r2-01");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic" })).unwrap();
        fs::write(dir.join("settings.json.bak"), b"{ not json").unwrap();
        fs::write(dir.join("settings.json"), b"{ half").unwrap();

        assert_eq!(s.settings(), serde_json::json!({}), "reads still fall back to defaults");
        let note = s.take_fallback_notice().expect("the window is told the file could not be read");
        assert!(note.contains("settings.json") && note.contains("defaults") && note.contains("will not save"), "{note}");
        assert!(!note.contains("last good copy is"), "it must not name a copy that cannot be read: {note}");
        assert_eq!(s.take_fallback_notice(), None, "told once per run");

        let set = serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]);
        assert!(s.patch_settings(&set, &[]).is_err(), "fail-closed stays");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{ half", "the bytes are kept");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// C22-R2-01: the repair sets both unreadable files aside (never deletes them) and saving works
    /// again on fresh defaults. Moving only settings.json would leave saving broken, because a
    /// missing file beside a present .bak is a failure too (row 944).
    #[test]
    fn c22r2_01_repair_sets_both_unreadable_files_aside_and_saving_resumes() {
        let dir = temp_dir("c22r2-01-repair");
        let s = Store::open(&dir).unwrap();
        fs::write(dir.join("settings.json.bak"), b"{ not json").unwrap();
        fs::write(dir.join("settings.json"), b"{ half").unwrap();
        assert_eq!(s.settings(), serde_json::json!({}));

        let kept = s.repair_settings().unwrap();
        assert_eq!(kept.len(), 2, "main file and the unreadable backup both kept: {kept:?}");
        assert!(kept.iter().all(|p| p.to_string_lossy().contains("settings.json.corrupt-")), "{kept:?}");
        assert!(kept.iter().any(|p| fs::read(p).unwrap() == b"{ half"), "the bad bytes are never deleted");

        s.save_settings(&serde_json::json!({ "theme": "light" })).unwrap();
        assert_eq!(s.settings()["theme"], "light", "saving works again");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// C22-R2-01: a refusal names a last good copy only when one reads.
    #[test]
    fn c22r2_01_a_refusal_does_not_name_a_copy_that_cannot_be_read() {
        let dir = temp_dir("c22r2-01-why");
        let s = Store::open(&dir).unwrap();
        fs::write(dir.join("settings.json.bak"), b"{ not json").unwrap();
        fs::write(dir.join("settings.json"), b"{ half").unwrap();
        assert_eq!(s.settings(), serde_json::json!({}));
        let err = s.save_settings(&serde_json::json!({})).unwrap_err().to_string();
        assert!(!err.contains("last good copy is"), "{err}");
        assert!(err.contains("no readable last good copy"), "{err}");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// T-075 (APP-048): a corrupt or half-written settings.json falls back to the last good copy.
    /// Reads give the backup's settings, a save lays the change over them and sets the corrupt bytes
    /// aside (never deletes them), and the backup is not replaced until the main file reads again.
    /// after-list #38: two corrupt files set aside within one second are both kept (no name collision), and no
    /// `.bak.tmp` is left behind by the backup write.
    #[test]
    fn after38_two_corrupt_set_asides_in_one_second_are_both_kept() {
        let dir = temp_dir("after38");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic" })).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "zoom": 2 })).unwrap();
        for planted in [&b"first corrupt"[..], b"second corrupt"] {
            fs::write(dir.join("settings.json"), planted).unwrap();
            s.patch_settings(&serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]), &[]).unwrap();
        }
        let mut kept: Vec<Vec<u8>> = fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.corrupt-")).map(|e| fs::read(e.path()).unwrap()).collect();
        kept.sort();
        assert_eq!(kept, [b"first corrupt".to_vec(), b"second corrupt".to_vec()]);
        assert!(!dir.join("settings.json.bak.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t075_a_corrupt_or_half_written_settings_fall_back_to_the_last_good_copy_without_wiping_it() {
        let dir = temp_dir("t075-bak");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "defaultAgent": "codex" })).unwrap();
        s.patch_settings(&serde_json::Map::from_iter([("zoom".into(), serde_json::json!(1.5))]), &[]).unwrap();
        let good = fs::read(dir.join("settings.json")).unwrap();
        let bak_bytes = fs::read(dir.join("settings.json.bak")).unwrap();
        // Half-written: the first half of the good file, as a torn write or a cut drive leaves it.
        let half = &good[..good.len() / 2];
        for planted in [half, &b"\0\0\0\0"[..], b"", b"[1,2]"] {
            fs::write(dir.join("settings.json"), planted).unwrap();
            let read = s.try_settings().unwrap();
            assert_eq!(read["theme"], "classic", "reads come from the last good copy");
            assert_eq!(read["defaultAgent"], "codex");
            assert!(read.get("zoom").is_none(), "the backup predates the last save");
            assert_eq!(fs::read(dir.join("settings.json")).unwrap(), planted, "a read changes nothing on disk");
            // A save lays the change over the good copy; the corrupt bytes are set aside, the backup kept.
            s.patch_settings(&serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]), &[]).unwrap();
            let now = s.try_settings().unwrap();
            assert_eq!((now["theme"].as_str(), now["uiLook"].as_str(), now["defaultAgent"].as_str()), (Some("classic"), Some("new"), Some("codex")));
            assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), bak_bytes, "the last good copy was not replaced");
            let aside: Vec<_> = fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.corrupt-")).collect();
            assert!(aside.iter().any(|e| fs::read(e.path()).unwrap() == planted), "the corrupt bytes are kept aside, not deleted");
            for e in aside {
                fs::remove_file(e.path()).unwrap();
            }
            // The next save, built on a file that reads, moves the backup on as usual.
            s.patch_settings(&serde_json::Map::from_iter([("zoom".into(), serde_json::json!(2))]), &[]).unwrap();
            let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
            assert_eq!(bak["uiLook"], "new");
            // Back to the starting point for the next planted file.
            fs::write(dir.join("settings.json"), &good).unwrap();
            fs::write(dir.join("settings.json.bak"), &bak_bytes).unwrap();
        }
        // A quit mid-write leaves settings.json.tmp behind: the main file is still the good one and
        // the next save replaces the leftover.
        fs::write(dir.join("settings.json.tmp"), b"{ \"theme\": \"half").unwrap();
        assert_eq!(s.try_settings().unwrap()["zoom"], 1.5);
        s.save_settings(&serde_json::json!({ "theme": "classic", "zoom": 3 })).unwrap();
        assert!(!dir.join("settings.json.tmp").exists());
        assert_eq!(s.try_settings().unwrap()["zoom"], 3);
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// T-075 (APP-048): everything saved as the user goes (settings, the layout inside them, and the
    /// key/value rows the projects and worktrees live in) reads back the same after a reopen.
    #[test]
    fn t075_a_settings_layout_and_kv_rows_round_trip_through_a_reopen() {
        let dir = temp_dir("t075-trip");
        let layout = serde_json::json!({ "panes": [{ "key": 1, "cwd": "C:\\w\\a", "branch": null, "agent": "shell", "program": null, "args": [] }, { "key": 2, "cwd": "C:\\w\\a", "branch": null, "agent": "shell", "program": null, "args": [], "kind": "editor", "path": "C:\\w\\a\\README.md" }], "activeTab": { "1": 2 }, "focused": 2, "activeDir": "C:\\w\\a", "stacked": {} });
        {
            let s = Store::open(&dir).unwrap();
            s.save_settings(&serde_json::json!({ "theme": "classic", "savedLayout": layout })).unwrap();
            s.set_all(&[("projects", "[{\"path\":\"C:\\\\w\\\\a\"}]"), ("worktrees", "[\"C:\\\\w\\\\a\"]")]).unwrap();
        }
        let s = Store::open(&dir).unwrap();
        let settings = s.try_settings().unwrap();
        assert_eq!(settings["theme"], "classic");
        assert_eq!(settings["savedLayout"], layout);
        assert_eq!(s.get("projects").unwrap().as_deref(), Some("[{\"path\":\"C:\\\\w\\\\a\"}]"));
        assert_eq!(s.get("worktrees").unwrap().as_deref(), Some("[\"C:\\\\w\\\\a\"]"));
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn t441b_a_read_that_failed_is_never_saved_over_and_the_first_backup_is_kept() {
        let dir = temp_dir("t441b");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "defaultAgent": "codex" })).unwrap();
        let good = fs::read(dir.join("settings.json")).unwrap();

        // A corrupt file: the patch fails loudly and neither file changes.
        fs::write(dir.join("settings.json"), b"{\"theme\": \"cla").unwrap();
        let bak_before = fs::read(dir.join("settings.json.bak")).ok();
        let set = serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]);
        assert!(s.patch_settings(&set, &[]).is_err());
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{\"theme\": \"cla");
        assert_eq!(fs::read(dir.join("settings.json.bak")).ok(), bak_before);

        // The read fails, the file is mended before the save: the save built on defaults is refused.
        let defaults = s.settings();
        assert_eq!(defaults, serde_json::json!({}));
        fs::write(dir.join("settings.json"), &good).unwrap();
        let err = s.save_settings(&defaults).unwrap_err();
        assert!(err.to_string().contains("an earlier read of it failed"), "{err}");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), good, "the real file was not wiped");

        // A fresh read clears the refusal; patches work again and keep every key.
        s.patch_settings(&set, &[]).unwrap();
        let now = s.settings();
        assert_eq!((now["theme"].as_str(), now["uiLook"].as_str()), (Some("classic"), Some("new")));

        // Settings saved empty on purpose: the backup from before stays, through later saves too.
        s.save_settings(&serde_json::json!({})).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "x" })).unwrap();
        let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
        assert_eq!(bak["defaultAgent"], "codex", "the empty set never replaced the backup");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// T-441-b for lib.rs write_settings, which reads with settings() and saves under one store
    /// lock: the read that fell back to defaults sets read_failed on that same Store, so the save
    /// built on the defaults is refused even after the file reads again, and no other read can
    /// clear the flag in between while the lock is held.
    #[test]
    fn t441b_write_settings_shape_a_failed_read_then_a_good_one_saves_nothing() {
        let dir = temp_dir("t441b-write");
        let store = std::sync::Mutex::new(Store::open(&dir).unwrap());
        store.lock().unwrap().save_settings(&serde_json::json!({ "theme": "classic", "apiKey": "sealed" })).unwrap();
        let good = fs::read(dir.join("settings.json")).unwrap();
        fs::write(dir.join("settings.json"), b"{ half a file").unwrap();
        let set = serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]);
        let s = store.lock().unwrap();
        let old = s.settings();
        fs::write(dir.join("settings.json"), &good).unwrap();
        let value = crate::secrets::keep_stored_secrets(&old, patched(old.clone(), &set, &[]));
        assert!(s.save_settings(&value).is_err(), "the save built on defaults is refused");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), good, "the real file is kept");
        // The next write_settings reads the mended file and keeps every key.
        let old = s.settings();
        s.save_settings(&crate::secrets::keep_stored_secrets(&old, patched(old.clone(), &set, &[]))).unwrap();
        let now = s.settings();
        assert_eq!((now["theme"].as_str(), now["uiLook"].as_str()), (Some("classic"), Some("new")));
        drop(s);
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// A settings.json in a fresh profile folder, and the store opened over it.
    fn open_over(name: &str, file: &[u8]) -> (PathBuf, Store) {
        let dir = temp_dir(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), file).unwrap();
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        (dir, s)
    }

    fn done(dir: PathBuf, s: Store) {
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn row785_a_file_the_app_saved_with_look_and_mode_is_not_touched_at_startup() {
        let dir = temp_dir("r785-same");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "uiLook": "classic", "appearanceMode": "light", "theme": "x" })).unwrap();
        let saved = fs::read(dir.join("settings.json")).unwrap();
        let baks = fs::read_dir(&dir).unwrap().count();
        drop(s);
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), saved, "same bytes");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), baks, "no new file beside it");
        done(dir, s);
    }

    #[test]
    fn row785_an_old_file_without_look_and_mode_gets_them_once_at_startup_and_then_stays_put() {
        let (dir, s) = open_over("r785-old", br#"{"confirmCloseRunning": false, "agentStatusHooks": true}"#);
        let now = s.settings();
        assert_eq!((now["uiLook"].as_str(), now["appearanceMode"].as_str(), now["confirmCloseRunning"].as_bool()), (Some("classic"), Some("dark"), Some(false)));
        let first = fs::read(dir.join("settings.json")).unwrap();
        drop(s);
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), first, "the next start rewrites nothing");
        done(dir, s);
    }

    #[test]
    fn row785_an_empty_file_starts_new_and_a_chosen_look_is_kept() {
        let (dir, s) = open_over("r785-empty", b"{}");
        let now = s.settings();
        assert_eq!((now["uiLook"].as_str(), now["appearanceMode"].as_str()), (Some("new"), Some("dark")));
        done(dir, s);
        let (dir, s) = open_over("r785-kept", br#"{"uiLook": "new", "other": 1}"#);
        let now = s.settings();
        assert_eq!((now["uiLook"].as_str(), now["appearanceMode"].as_str(), now["other"].as_i64()), (Some("new"), Some("dark"), Some(1)));
        done(dir, s);
    }

    #[test]
    fn row785_a_corrupt_file_is_left_alone() {
        let (dir, s) = open_over("r785-corrupt", b"{ half a file");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{ half a file", "never overwritten");
        assert!(!dir.join("settings.json.bak").exists());
        done(dir, s);
    }

    #[test]
    fn row785_a_file_read_from_its_last_good_copy_is_left_alone() {
        let dir = temp_dir("r785-bak");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), b"{ half a file").unwrap();
        fs::write(dir.join("settings.json.bak"), br#"{"theme":"mine"}"#).unwrap();
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{ half a file");
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), br#"{"theme":"mine"}"#);
        assert_eq!(fs::read_dir(&dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("corrupt")).count(), 0, "nothing set aside");
        done(dir, s);
    }

    #[test]
    fn row785b_a_profile_with_no_file_gets_one_with_look_and_mode_and_a_second_start_keeps_its_bytes() {
        let dir = temp_dir("r785b-none");
        let s = Store::open(&dir).unwrap();
        assert!(!dir.join("settings.json").exists());
        s.stamp_look();
        let first = fs::read(dir.join("settings.json")).expect("the file is there after the stamp");
        let now: serde_json::Value = serde_json::from_slice(&first).unwrap();
        assert_eq!(now, serde_json::json!({ "uiLook": "new", "appearanceMode": "dark" }));
        let names = |d: &Path| {
            let mut v: Vec<_> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name()).collect();
            v.sort();
            v
        };
        let listing = names(&dir);
        s.stamp_look();
        drop(s);
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), first, "later starts rewrite nothing");
        assert_eq!(names(&dir), listing, "and add no file beside it");
        done(dir, s);
    }

    #[test]
    fn row785b_a_missing_file_with_a_last_good_copy_beside_it_is_left_alone() {
        let dir = temp_dir("r785b-bak-only");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json.bak"), br#"{"theme":"mine"}"#).unwrap();
        let s = Store::open(&dir).unwrap();
        s.stamp_look();
        assert!(!dir.join("settings.json").exists(), "the only copy of someone's settings is not buried under a new file");
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), br#"{"theme":"mine"}"#);
        done(dir, s);
    }

    fn bak_only(name: &str, bak: &[u8]) -> (PathBuf, Store) {
        let dir = temp_dir(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json.bak"), bak).unwrap();
        let s = Store::open(&dir).unwrap();
        (dir, s)
    }

    // Row 944 R1: a missing settings.json beside a .bak is read like a corrupt one, so the next write cannot drop the proxy.
    #[test]
    fn row944_a_write_after_the_settings_file_went_missing_keeps_the_proxy_from_the_last_good_copy() {
        let bak = br#"{"httpProxy":"http://127.0.0.1:8080","theme":"mine"}"#;
        let (dir, s) = bak_only("r944-patch", bak);
        let mut set = serde_json::Map::new();
        set.insert("other".into(), 1.into());
        s.patch_settings(&set, &[]).unwrap();
        let on_disk: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(on_disk["httpProxy"], "http://127.0.0.1:8080", "the proxy is not lost");
        assert_eq!((on_disk["theme"].as_str(), on_disk["other"].as_i64()), (Some("mine"), Some(1)));
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), bak, "the last good copy stays as it was");
        done(dir, s);
    }

    #[test]
    fn row944_a_missing_settings_file_reads_the_last_good_copy_and_says_so() {
        let (dir, s) = bak_only("r944-read", br#"{"httpProxy":"http://127.0.0.1:8080"}"#);
        assert_eq!(s.settings()["httpProxy"], "http://127.0.0.1:8080");
        assert!(s.take_fallback_notice().is_some_and(|n| n.contains("settings.json.bak")), "the window is told");
        assert!(!dir.join("settings.json").exists(), "a read writes nothing");
        done(dir, s);
    }

    #[test]
    fn row944_a_missing_settings_file_beside_an_unreadable_last_good_copy_saves_nothing() {
        let (dir, s) = bak_only("r944-corrupt-bak", b"{ not json");
        let mut set = serde_json::Map::new();
        set.insert("other".into(), 1.into());
        let msg = s.patch_settings(&set, &[]).unwrap_err().to_string();
        assert!(msg.contains("it is missing, and its last good copy could not be read"), "{msg}");
        assert!(s.save_settings(&serde_json::json!({ "other": 1 })).is_err());
        assert!(!dir.join("settings.json").exists());
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), b"{ not json");
        done(dir, s);
    }

    #[test]
    fn row944_a_missing_settings_file_with_no_last_good_copy_is_still_a_normal_first_run() {
        let dir = temp_dir("r944-first-run");
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.settings(), serde_json::json!({}));
        assert!(s.take_fallback_notice().is_none());
        let mut set = serde_json::Map::new();
        set.insert("other".into(), 1.into());
        s.patch_settings(&set, &[]).unwrap();
        assert_eq!(s.settings()["other"], 1);
        done(dir, s);
    }

    #[test]
    fn card16b_the_store_waits_out_a_busy_second_process() {
        let dir = temp_dir("busy");
        let s = Store::open(&dir).unwrap();
        let ms: i64 = s.conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0)).unwrap();
        assert_eq!(ms, 5000);
        drop(s);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn card16b_a_refused_save_tells_the_user_a_restart_reads_the_key_again() {
        let dir = temp_dir("refusal");
        let s = Store::open(&dir).unwrap();
        s.poison("demo.list");
        let err = s.set("demo.list", "[]").unwrap_err().to_string();
        assert!(err.contains("not saving over it") && err.contains("restarting Kolux") && err.contains("temporary"), "{err}");
        drop(s);
        let _ = fs::remove_dir_all(dir);
    }
}
