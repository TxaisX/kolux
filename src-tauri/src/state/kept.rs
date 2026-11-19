//! A saved blob that no longer reads is never saved over (after-list row 193, T-173-c follow-up).
//!
//! Every store blob used to load as "read it, or start empty", and the next save then wrote the
//! empty value over whatever was there: one unreadable blob (a half-written value, or a layout this
//! build does not know) was a silent wipe. Here an unreadable blob is first kept aside, byte for
//! byte, under `<key>.corrupt-<ms>` in the same transaction that starts the key fresh, so nothing
//! is lost and the next read does not keep it aside a second time. A store that cannot be read at
//! all is an error, never an empty value.

use crate::state::{KeepAside, Store};
use serde::{de::DeserializeOwned, Serialize};

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// The blob under `key`. No blob, or a cleared (`null`) one, is the default. A blob that does not
/// read is kept aside first (see the module note); the error cases leave the store untouched.
pub fn load<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> Result<T, String> {
    let text = store.get(key).map_err(|e| format!("{key} could not be read ({e}); nothing was changed"))?;
    let Some(text) = text.filter(|t| t.trim() != "null") else { return Ok(T::default()) };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(v),
        Err(e) => {
            let aside = set_aside_at(store, key, &text, &T::default(), now_ms())?;
            eprintln!("{}", kept_note(key, &aside, &decode_kind(&e)));
            Ok(T::default())
        }
    }
}

/// For callers that keep the default in memory or save a full replacement without re-reading: an Err poisons the key (row 881).
pub fn or_default_held<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> T {
    load(store, key).unwrap_or_else(|_| {
        store.poison(key);
        T::default()
    })
}

/// For readers with no error path: the blob, or the default when the store itself cannot be read.
/// An unreadable blob is still kept aside before the default is handed back.
pub fn or_default<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> T {
    load(store, key).unwrap_or_default()
}

/// What went wrong reading, by kind and place only: serde_json's own text can echo the input.
fn decode_kind(e: &serde_json::Error) -> String {
    format!("{:?} error at line {} column {}", e.classify(), e.line(), e.column())
}

/// The log line for a blob kept aside: the key, why it did not read (kind and place) and the copy's
/// name, never what was in it.
fn kept_note(key: &str, aside: &str, why: &str) -> String {
    format!("kolux: {key} could not be read ({why}); its bytes are kept as {aside} and it starts fresh")
}

#[cfg(test)]
/// Test aid: hides the kv table behind a second connection, as a busy or unreadable store would; the guard puts it back.
pub(crate) struct Unreadable(rusqlite::Connection);
#[cfg(test)]
impl Unreadable {
    pub(crate) fn new(dir: &std::path::Path) -> Self {
        let side = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        side.execute_batch("ALTER TABLE kv RENAME TO kv_gone").unwrap();
        Unreadable(side)
    }
    pub(crate) fn restore(&self) {
        self.0.execute_batch("ALTER TABLE kv_gone RENAME TO kv").unwrap();
    }
}
#[cfg(test)]
impl Drop for Unreadable {
    // A failed assert must not leak the renamed table; after restore() the rename finds nothing and is ignored.
    fn drop(&mut self) {
        let _ = self.0.execute_batch("ALTER TABLE kv_gone RENAME TO kv");
    }
}

#[cfg(test)]
/// Test aid: a second connection that makes the store refuse any `.corrupt-` copy, as a full disk would.
pub(crate) fn refuse_copies(dir: &std::path::Path) {
    let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER no_copies BEFORE INSERT ON kv WHEN NEW.key LIKE '%.corrupt-%' BEGIN SELECT RAISE(ABORT, 'disk full'); END;").unwrap();
}

/// Copies `text` to a free `<key>.corrupt-<ms>[-n]` name (`ms` is the time, a seam for tests) and
/// starts `key` fresh, both in one transaction: either the copy and the reset both land or neither
/// does. An existing copy is never reused, so an earlier one is never replaced.
fn set_aside_at<T: Serialize>(store: &Store, key: &str, text: &str, fresh: &T, ms: u128) -> Result<String, String> {
    let base = format!("{key}.corrupt-{ms}");
    let fresh = serde_json::to_string(fresh).map_err(|e| e.to_string())?;
    // The store takes the name only if it is free, so a taken one (even one that appeared since a
    // look) moves on to the next, and the key is reset only if it still holds what was read.
    for n in 1.. {
        let aside = if n == 1 { base.clone() } else { format!("{base}-{n}") };
        match store.keep_aside(key, text, &aside, &fresh).map_err(|e| format!("{key} could not be kept aside ({e}); nothing was changed"))? {
            KeepAside::Done => return Ok(aside),
            KeepAside::NameTaken => {}
            KeepAside::Changed => return Err(format!("{key} changed while being kept aside; nothing was changed")),
        }
    }
    unreachable!()
}

#[cfg(test)]
/// Test aid: every value kept aside for `key`, read straight from the store's table. (It used to
/// probe the last 5 s of millisecond names one query each, so a PC slow enough to take 5 s over
/// the first call missed the copy on the second.)
pub(crate) fn asides(store: &Store, key: &str) -> Vec<String> {
    let conn = rusqlite::Connection::open(store.dir().join("state.db")).unwrap();
    let mut q = conn.prepare("SELECT value FROM kv WHERE key LIKE ?1 ORDER BY key").unwrap();
    q.query_map([format!("{key}.corrupt-%")], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

/// Whether any copy of `key` was ever kept aside (row 911). An exact, case-sensitive prefix match:
/// LIKE would read `_` in a key as a wildcard and ignore case.
pub(crate) fn has_aside(store: &Store, key: &str) -> Result<bool, String> {
    let conn = rusqlite::Connection::open(store.dir().join("state.db")).map_err(|e| e.to_string())?;
    conn.query_row("SELECT EXISTS(SELECT 1 FROM kv WHERE substr(key, 1, length(?1)) = ?1)", [format!("{key}.corrupt-")], |r| r.get(0)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fresh(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-kept-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    #[test]
    fn row193_an_unreadable_blob_is_kept_aside_byte_for_byte_and_the_key_starts_fresh() {
        let (store, dir) = fresh("aside");
        let broken = "{\"runs\": [tru\u{0}\u{fffd} half written";
        store.set("demo.list", broken).unwrap();
        let got: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(got.is_empty());
        assert_eq!(asides(&store, "demo.list"), vec![broken.to_string()], "the original bytes survive under a corrupt- name");
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("[]"), "the key starts fresh, so a second read keeps nothing aside again");
        let again: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(again.is_empty());
        assert_eq!(asides(&store, "demo.list").len(), 1);
        // A second unreadable blob in the same millisecond window gets its own name, never the first one's.
        store.set("demo.list", "{oops").unwrap();
        let _: Vec<Value> = load(&store, "demo.list").unwrap();
        let mut kept = asides(&store, "demo.list");
        kept.sort();
        assert_eq!(kept, vec![broken.to_string(), "{oops".to_string()]);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_unreadable_orchestration_mail_survives_the_next_save() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("mail");
        let broken = "{\"runs\": [{\"id\": \"run-1\", \"objective\": \"ship\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        let mut m = Mail::load(&store);
        assert!(!m.unread && m.runs.is_empty(), "an unreadable blob is kept aside, then the mail starts fresh");
        m.seq = 7;
        m.save(&store).unwrap();
        assert_eq!(asides(&store, "orchestration.mail"), vec![broken.to_string()], "the save did not wipe the original bytes");
        assert_eq!(Mail::load(&store).seq, 7);
        // A mail that was loaded from a store that could not be read refuses to be saved over it.
        let blind = Mail { unread: true, ..Mail::default() };
        assert!(blind.save(&store).unwrap_err().message.contains("could not be read"));
        assert_eq!(Mail::load(&store).seq, 7, "the refused save changed nothing");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_absent_cleared_and_readable_blobs_are_left_alone() {
        let (store, dir) = fresh("plain");
        let none: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(none.is_empty() && store.get("demo.list").unwrap().is_none(), "reading writes nothing");
        store.set("demo.list", "null").unwrap();
        let cleared: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(cleared.is_empty() && asides(&store, "demo.list").is_empty());
        store.set("demo.list", "[1,2]").unwrap();
        let read: Vec<Value> = or_default(&store, "demo.list");
        assert_eq!(read, vec![Value::from(1), Value::from(2)]);
        assert!(asides(&store, "demo.list").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_a_second_set_aside_in_the_same_millisecond_takes_a_free_name_and_the_first_copy_stays() {
        let (store, dir) = fresh("collide");
        store.set("demo.list", "first broken").unwrap();
        let a = set_aside_at(&store, "demo.list", "first broken", &Vec::<Value>::new(), 42).unwrap();
        store.set("demo.list", "second broken").unwrap();
        let b = set_aside_at(&store, "demo.list", "second broken", &Vec::<Value>::new(), 42).unwrap();
        store.set("demo.list", "third broken").unwrap();
        let c = set_aside_at(&store, "demo.list", "third broken", &Vec::<Value>::new(), 42).unwrap();
        assert_eq!((a.as_str(), b.as_str(), c.as_str()), ("demo.list.corrupt-42", "demo.list.corrupt-42-2", "demo.list.corrupt-42-3"));
        assert_eq!(store.get(&a).unwrap().as_deref(), Some("first broken"));
        assert_eq!(store.get(&b).unwrap().as_deref(), Some("second broken"));
        assert_eq!(store.get(&c).unwrap().as_deref(), Some("third broken"));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_saves_never_touch_or_prune_a_kept_copy() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("noprune");
        let broken = "{\"runs\": [{\"id\": \"run-1\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        let mut m = Mail::load(&store);
        for i in 1..=5 {
            m.seq = i;
            m.finish(&format!("k{i}"), Some(Value::from(i)));
            m.save(&store).unwrap();
            m = Mail::load(&store);
        }
        assert_eq!(asides(&store, "orchestration.mail"), vec![broken.to_string()], "five loads and saves later the copy is the same bytes, once");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_when_the_copy_cannot_be_made_the_original_stays_and_the_save_is_refused() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("nocopy");
        let broken = "{\"runs\": [{\"id\": \"secret-run\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        refuse_copies(&dir);
        let err = load::<Vec<Value>>(&store, "orchestration.mail").unwrap_err();
        assert!(err.contains("orchestration.mail") && err.contains("nothing was changed"), "{err}");
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        let m = Mail::load(&store);
        assert!(m.unread, "a load that could not keep the blob aside marks the mail unread");
        let refused = m.save(&store).unwrap_err();
        assert!(refused.message.contains("orchestration.mail") && refused.message.contains("nothing was saved over it"), "{}", refused.message);
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the refused save left the original alone");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_the_messages_name_the_key_and_never_the_blob() {
        let secret = "SECRET-TOKEN-abc123";
        let (store, dir) = fresh("notice");
        let blob = format!("{{\"runs\": \"{secret}\" nope");
        store.set("demo.list", &blob).unwrap();
        let aside = set_aside_at(&store, "demo.list", &blob, &Vec::<Value>::new(), 7).unwrap();
        let why = decode_kind(&serde_json::from_str::<Vec<Value>>(&blob).unwrap_err());
        let kept = kept_note("demo.list", &aside, &why);
        assert!(kept.contains("demo.list") && kept.contains(&aside) && !kept.contains(secret), "{kept}");
        assert!(kept.contains("Data error at line 1 column 0"), "the decode error's kind and place are named: {kept}");
        let torn = serde_json::from_str::<Vec<Value>>(&format!("[\"{secret}\" nope")).unwrap_err();
        let torn_note = kept_note("demo.list", &aside, &decode_kind(&torn));
        assert!(torn_note.contains("Syntax error at line 1 column ") && !torn_note.contains(secret), "{torn_note}");
        // serde_json's own text can echo the input (a type mismatch quotes the value), so it is never used.
        let shaped = serde_json::from_str::<Vec<u8>>(&format!("[\"{secret}\"]")).unwrap_err();
        assert!(shaped.to_string().contains(secret), "this Display text does echo the input: {shaped}");
        let shaped_note = kept_note("demo.list", &aside, &decode_kind(&shaped));
        assert!(shaped_note.contains("Data error at line 1 column ") && !shaped_note.contains(secret), "{shaped_note}");
        store.set("demo.list", &blob).unwrap();
        refuse_copies(&dir);
        let failed = load::<Vec<Value>>(&store, "demo.list").unwrap_err();
        assert!(failed.contains("demo.list") && !failed.contains(secret), "{failed}");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_reset_all_keeps_an_unread_mail_unread_so_the_original_is_never_overwritten() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("resetall");
        let broken = "{\"runs\": [{\"id\": \"run-9\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        refuse_copies(&dir);
        let mut m = Mail::load(&store);
        assert!(m.unread);
        m.reset("all").unwrap();
        assert!(m.unread, "reset --all must not clear the unread mark");
        let refused = m.save(&store).unwrap_err();
        assert!(refused.message.contains("orchestration.mail") && refused.message.contains("nothing was saved over it"), "{}", refused.message);
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        assert!(asides(&store, "orchestration.mail").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_when_starting_the_key_fresh_fails_the_copy_is_rolled_back_too() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("rollback");
        let broken = "{\"runs\": [{\"id\": \"run-9\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        // The copy (first statement) is allowed; only the write to the original key aborts.
        let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER keep_orig_upd BEFORE UPDATE ON kv WHEN NEW.key = 'orchestration.mail' BEGIN SELECT RAISE(ABORT, 'locked'); END;
             CREATE TRIGGER keep_orig_ins BEFORE INSERT ON kv WHEN NEW.key = 'orchestration.mail' BEGIN SELECT RAISE(ABORT, 'locked'); END;",
        )
        .unwrap();
        let m = Mail::load(&store);
        assert!(m.unread, "a load whose reset could not land marks the mail unread");
        let copies: i64 = conn.query_row("SELECT count(*) FROM kv WHERE key LIKE '%.corrupt-%'", [], |r| r.get(0)).unwrap();
        assert_eq!(copies, 0, "the copy rolled back with the failed reset");
        assert!(asides(&store, "orchestration.mail").is_empty());
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        assert!(m.save(&store).unwrap_err().message.contains("nothing was saved over it"));
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_a_clean_mail_round_trips_unchanged_and_keeps_nothing_aside() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("clean");
        let mut m = Mail { seq: 9, ..Mail::default() };
        m.finish("a|b|c", Some(Value::from("done")));
        m.save(&store).unwrap();
        let back = Mail::load(&store);
        assert_eq!(back, m);
        assert!(!back.unread && asides(&store, "orchestration.mail").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row874_a_mail_from_a_newer_build_keeps_its_unknown_fields_through_load_and_save() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("newer");
        let blob = r#"{"seq":3,"threads":[{"id":"t1","note":"x"}],"future":{"a":[1,2]}}"#;
        store.set("orchestration.mail", blob).unwrap();
        let mut m = Mail::load(&store);
        assert!(!m.unread && m.seq == 3 && asides(&store, "orchestration.mail").is_empty(), "a readable newer blob is not kept aside");
        m.seq = 4;
        m.save(&store).unwrap();
        let saved: Value = serde_json::from_str(&store.get("orchestration.mail").unwrap().unwrap()).unwrap();
        let want: Value = serde_json::from_str(blob).unwrap();
        assert_eq!(saved["threads"], want["threads"], "the unknown field survives the save");
        assert_eq!(saved["future"], want["future"]);
        assert_eq!(saved["seq"], 4);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row875_an_existing_kept_copy_is_never_overwritten() {
        let (store, dir) = fresh("noover");
        store.set("demo.list.corrupt-42", "earlier copy").unwrap();
        store.set("demo.list", "broken now").unwrap();
        let got = set_aside_at(&store, "demo.list", "broken now", &Vec::<Value>::new(), 42).unwrap();
        assert_eq!(got, "demo.list.corrupt-42-2");
        assert_eq!(store.get("demo.list.corrupt-42").unwrap().as_deref(), Some("earlier copy"));
        assert_eq!(store.get(&got).unwrap().as_deref(), Some("broken now"));
        // The store's own step refuses a taken name rather than upserting over it.
        assert_eq!(store.keep_aside("demo.list", "broken now", "demo.list.corrupt-42", "[]").unwrap(), KeepAside::NameTaken);
        assert_eq!(store.get("demo.list.corrupt-42").unwrap().as_deref(), Some("earlier copy"));
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("[]"), "the earlier set_aside_at already reset it; the refused step changes nothing");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row875_the_key_is_not_reset_when_it_changed_after_it_was_read() {
        let (store, dir) = fresh("changed");
        store.set("demo.list", "broken as read").unwrap();
        // Another connection writes new data after the read and before the reset.
        let other = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        other.execute("UPDATE kv SET value = 'written since' WHERE key = 'demo.list'", []).unwrap();
        let err = set_aside_at(&store, "demo.list", "broken as read", &Vec::<Value>::new(), 5).unwrap_err();
        assert!(err.contains("changed while being kept aside; nothing was changed"), "{err}");
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("written since"), "the newer value stays");
        assert!(asides(&store, "demo.list").is_empty(), "the copy rolled back with the refused reset");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row874_a_mail_blob_of_the_wrong_type_is_kept_aside_never_read_as_empty() {
        use crate::orchestration::Mail;
        for (i, blob) in ["[]", "\"x\"", "7", "[1,2]", "true"].into_iter().enumerate() {
            let (store, dir) = fresh(&format!("wrongtype{i}"));
            store.set("orchestration.mail", blob).unwrap();
            let m = Mail::load(&store);
            assert!(!m.unread && m == Mail::default(), "{blob}: the load is the fresh default");
            assert_eq!(asides(&store, "orchestration.mail"), vec![blob.to_string()], "{blob}: a byte-identical copy is kept");
            assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(serde_json::to_string(&Mail::default()).unwrap().as_str()));
            drop(store);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn row881_an_unread_uncopied_key_is_poisoned_until_a_keep_aside_succeeds() {
        let (store, dir) = fresh("poison");
        let broken = "{\"runs\": [tru";
        store.set("demo.list", broken).unwrap();
        store.set("demo.other", "[1]").unwrap();
        refuse_copies(&dir);
        assert!(or_default_held::<Vec<Value>>(&store, "demo.list").is_empty());
        let err = store.set("demo.list", "[]").unwrap_err().to_string();
        assert!(err.contains("demo.list") && err.contains("not kept aside") && err.contains("not saving over it"), "{err}");
        assert!(store.set_all(&[("demo.other", "[2]"), ("demo.list", "[]")]).is_err(), "a batch naming the key is refused whole");
        assert_eq!(store.get("demo.other").unwrap().as_deref(), Some("[1]"), "nothing of the refused batch landed");
        store.set("demo.other", "[3]").unwrap();
        store.set_all(&[("demo.other", "[4]")]).unwrap();
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        // A plain read that works does not clear it: here the key reads as a different type, which is Err again, still uncopied.
        assert!(load::<Vec<Value>>(&store, "demo.list").is_err());
        assert!(store.set("demo.list", "[]").is_err());
        // Keeping it aside is how it clears, and keep_aside itself is never blocked by the poison.
        let aside = set_aside_at(&store, "demo.list", broken, &Vec::<Value>::new(), 5);
        assert!(aside.is_err(), "the disk still refuses copies");
        rusqlite::Connection::open(dir.join("state.db")).unwrap().execute_batch("DROP TRIGGER no_copies").unwrap();
        let got: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(got.is_empty());
        assert_eq!(asides(&store, "demo.list"), vec![broken.to_string()]);
        store.set("demo.list", "[7]").unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn card16b_a_failed_plain_load_does_not_poison_but_a_failed_held_read_does() {
        let (store, dir) = fresh("poison-get");
        store.set("demo.list", "[1]").unwrap();
        let side = Unreadable::new(&dir);
        assert!(load::<Vec<Value>>(&store, "demo.list").is_err());
        assert!(or_default::<Vec<Value>>(&store, "demo.list").is_empty());
        side.restore();
        store.set("demo.list", "[2]").unwrap();
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("[2]"), "a transient read failure poisoned nothing");
        let side = Unreadable::new(&dir);
        assert!(or_default_held::<Vec<Value>>(&store, "demo.list").is_empty(), "the caller still gets the default");
        side.restore();
        assert!(store.set("demo.list", "[]").is_err(), "a default handed out after a failed read is never saved over the blob");
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("[2]"));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn card16b_a_good_decode_after_a_failed_held_read_does_not_clear_the_poison() {
        let (store, dir) = fresh("poison-good");
        store.set("demo.list", "[1]").unwrap();
        let side = Unreadable::new(&dir);
        let _: Vec<Value> = or_default_held(&store, "demo.list");
        side.restore();
        let again: Vec<Value> = or_default_held(&store, "demo.list");
        assert_eq!(again, vec![Value::from(1)], "the blob now decodes fine");
        assert!(load::<Vec<Value>>(&store, "demo.list").is_ok());
        assert!(store.set("demo.list", "[]").is_err(), "only a keep-aside clears the poison, not a good read");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row911_has_aside_matches_the_exact_key_only() {
        let (store, dir) = fresh("has-aside");
        store.set("aXb.corrupt-1", "x").unwrap();
        store.set("A_B.corrupt-1", "x").unwrap();
        store.set("a_bc.corrupt-1", "x").unwrap();
        assert!(!has_aside(&store, "a_b").unwrap(), "`_` is not a wildcard, case counts, and a longer key is another key");
        store.set("a_b.corrupt-2", "x").unwrap();
        assert!(has_aside(&store, "a_b").unwrap());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
