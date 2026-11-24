//! LAG-03 board tests (locked; copied verbatim from the board, do not edit).
//!
//! What is measured: a settings save writes and syncs its files while the store lock is FREE.
//! Every disk change of a save goes through an injected step runner; the runner probes the store
//! lock with `try_lock` from inside the step and counts. No clock is read anywhere in this file.

use super::*;
use serde_json::json;
use std::cell::Cell;
use std::sync::Mutex;

/// A throwaway profile folder, removed (best effort) when the test lets go of it.
struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        for _ in 0..10 {
            if fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

/// An empty folder with a store opened in it. `store` is declared after `dir`, so it is dropped first.
fn open(tag: &str) -> (Dir, Mutex<Store>) {
    let path = std::env::temp_dir().join(format!("kolux-lag03-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    let store = Mutex::new(Store::open(&path).unwrap());
    (Dir(path), store)
}

fn file(dir: &Dir, name: &str) -> PathBuf {
    dir.0.join(name)
}

fn on_disk(dir: &Dir) -> serde_json::Value {
    serde_json::from_slice(&fs::read(file(dir, "settings.json")).unwrap()).unwrap()
}

/// Every `settings.json*` file in the folder with its bytes, sorted by name.
fn settings_files(dir: &Dir) -> Vec<(String, Vec<u8>)> {
    let mut all: Vec<(String, Vec<u8>)> = fs::read_dir(&dir.0)
        .unwrap()
        .flatten()
        .map(|e| (e.file_name().to_string_lossy().to_string(), e.path()))
        .filter(|(name, _)| name.starts_with("settings.json"))
        .map(|(name, path)| (name, fs::read(path).unwrap()))
        .collect();
    all.sort();
    all
}

fn is_write(step: &DiskStep) -> bool {
    matches!(step, DiskStep::WriteSynced { .. })
}

fn denied(text: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::PermissionDenied, text.to_string())
}

/// THE MEASURE. Each file write of a save (the backup copy and the new settings) runs with the
/// store lock free: a `try_lock` from inside the write succeeds every time.
#[test]
fn a_settings_write_never_holds_the_store_lock() {
    let (_dir, store) = open("free");
    store.lock().unwrap().save_settings(&json!({ "theme": "first" })).unwrap();
    let (mut writes, mut free, mut held) = (0, 0, 0);
    let out = save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["font"] = json!("big");
            old
        },
        &mut |step: &DiskStep| {
            if is_write(step) {
                writes += 1;
                match store.try_lock() {
                    Ok(_) => free += 1,
                    Err(_) => held += 1,
                }
            }
            step.run()
        },
    );
    out.unwrap();
    assert_eq!(writes, 2, "the backup copy and the new file are both written through the runner");
    assert_eq!((free, held), (2, 0), "the store lock was free during {free} of {writes} writes; it must be free during all of them");
    assert_eq!(store.lock().unwrap().settings(), json!({ "theme": "first", "font": "big" }));
}

/// The renames are the commit: they run with the store lock held (so no other save can slip in
/// between the check and the rename), and the save lane is held for the whole call.
#[test]
fn renames_land_under_the_store_lock_and_saves_take_turns() {
    let (_dir, store) = open("turns");
    store.lock().unwrap().save_settings(&json!({ "theme": "first" })).unwrap();
    let lane = store.lock().unwrap().save_lane();
    assert!(lane.try_lock().is_ok(), "nobody is saving yet, the lane is free");
    let (mut steps, mut lane_held, mut moves, mut moves_under_lock) = (0, 0, 0, 0);
    save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["font"] = json!("big");
            old
        },
        &mut |step: &DiskStep| {
            steps += 1;
            if lane.try_lock().is_err() {
                lane_held += 1;
            }
            if !is_write(step) {
                moves += 1;
                if store.try_lock().is_err() {
                    moves_under_lock += 1;
                }
            }
            step.run()
        },
    )
    .unwrap();
    assert_eq!(steps, 4, "two writes, two renames");
    assert_eq!(lane_held, 4, "the save lane is held during every step");
    assert_eq!((moves, moves_under_lock), (2, 2), "both renames ran with the store lock held");
    assert!(lane.try_lock().is_ok(), "the lane is let go at the end");
    assert!(store.try_lock().is_ok(), "the store lock is let go at the end");
    assert!(std::sync::Arc::ptr_eq(&lane, &store.lock().unwrap().save_lane()), "one lane per store, the same one every time");
    let (_dir2, other) = open("turns-other");
    assert!(!std::sync::Arc::ptr_eq(&lane, &other.lock().unwrap().save_lane()), "another store has its own lane");
}

/// What the runner is handed is exactly the plan made under the lock, and that is what ends up on disk.
#[test]
fn what_reaches_the_disk_is_the_snapshot_taken_under_the_lock() {
    let (dir, store) = open("snapshot");
    store.lock().unwrap().save_settings(&json!({ "theme": "first", "n": 1 })).unwrap();
    let before = fs::read(file(&dir, "settings.json")).unwrap();
    let want = json!({ "theme": "second", "n": 1 });
    let plan = store.lock().unwrap().plan_settings_save(&want).unwrap();
    let mut seen: Vec<DiskStep> = Vec::new();
    let (old, new) = save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["theme"] = json!("second");
            old
        },
        &mut |step: &DiskStep| {
            seen.push(step.clone());
            step.run()
        },
    )
    .unwrap();
    assert_eq!(seen, plan, "the steps run are the plan, in order");
    assert_eq!(old, json!({ "theme": "first", "n": 1 }), "the first value returned is what the save was built on");
    assert_eq!(new, want, "the second value returned is what was saved");
    assert_eq!(fs::read(file(&dir, "settings.json")).unwrap(), serde_json::to_vec_pretty(&want).unwrap());
    assert_eq!(fs::read(file(&dir, "settings.json.bak")).unwrap(), before, "the bytes from before the save are the backup");
    assert!(!file(&dir, "settings.json.tmp2").exists() && !file(&dir, "settings.json.bak.tmp2").exists(), "no temp file is left");
    assert_eq!(store.lock().unwrap().settings(), want, "a read after the save sees it");
}

/// Planning reads, it never changes the disk; the plan lists every file write before any rename.
#[test]
fn a_plan_changes_nothing_on_disk_and_puts_the_writes_first() {
    let (dir, store) = open("plan");
    let s = store.lock().unwrap();
    let tmp = file(&dir, "settings.json.tmp2");
    let bak_tmp = file(&dir, "settings.json.bak.tmp2");
    let first = json!({ "theme": "first" });
    let plan = s.plan_settings_save(&first).unwrap();
    assert_eq!(
        plan,
        vec![
            DiskStep::WriteSynced { path: tmp.clone(), bytes: serde_json::to_vec_pretty(&first).unwrap() },
            DiskStep::Rename { from: tmp.clone(), to: file(&dir, "settings.json") },
        ],
        "no file yet: one write, one rename"
    );
    assert!(settings_files(&dir).is_empty(), "planning wrote nothing");

    s.save_settings(&first).unwrap();
    let files = settings_files(&dir);
    let second = json!({ "theme": "second" });
    let plan = s.plan_settings_save(&second).unwrap();
    assert_eq!(settings_files(&dir), files, "planning changed nothing on disk");
    assert_eq!(
        plan,
        vec![
            DiskStep::WriteSynced { path: bak_tmp.clone(), bytes: fs::read(file(&dir, "settings.json")).unwrap() },
            DiskStep::WriteSynced { path: tmp.clone(), bytes: serde_json::to_vec_pretty(&second).unwrap() },
            DiskStep::Rename { from: bak_tmp.clone(), to: file(&dir, "settings.json.bak") },
            DiskStep::Rename { from: tmp.clone(), to: file(&dir, "settings.json") },
        ],
        "a file and no backup yet: the backup copy and the new file are written first, then both renames"
    );

    // An empty set on disk never replaces a backup that exists (the copy from before a wipe survives).
    s.save_settings(&second).unwrap();
    s.save_settings(&json!({})).unwrap();
    let plan = s.plan_settings_save(&first).unwrap();
    assert_eq!(
        plan,
        vec![
            DiskStep::WriteSynced { path: tmp.clone(), bytes: serde_json::to_vec_pretty(&first).unwrap() },
            DiskStep::Rename { from: tmp.clone(), to: file(&dir, "settings.json") },
        ],
        "an empty file on disk with a backup beside it: the backup is left alone"
    );
}

#[test]
fn two_saves_in_a_row_end_with_the_newest_state_on_disk() {
    let (dir, store) = open("two");
    let mut real = |step: &DiskStep| step.run();
    save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["a"] = json!(1);
            old
        },
        &mut real,
    )
    .unwrap();
    let after_first = fs::read(file(&dir, "settings.json")).unwrap();
    let (old, new) = save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["b"] = json!(2);
            old
        },
        &mut real,
    )
    .unwrap();
    assert_eq!(old, json!({ "a": 1 }));
    assert_eq!(new, json!({ "a": 1, "b": 2 }));
    assert_eq!(on_disk(&dir), json!({ "a": 1, "b": 2 }), "the newest state is on disk");
    assert_eq!(fs::read(file(&dir, "settings.json.bak")).unwrap(), after_first, "the state before it is the backup");
    // The direct path still saves on top of it.
    let mut set = serde_json::Map::new();
    set.insert("c".into(), json!(3));
    store.lock().unwrap().patch_settings(&set, &[]).unwrap();
    assert_eq!(on_disk(&dir), json!({ "a": 1, "b": 2, "c": 3 }));
    assert_eq!(store.lock().unwrap().settings(), json!({ "a": 1, "b": 2, "c": 3 }));
}

/// Two threads, five saves each, every save adds its own key: all ten keys are on disk at the end.
#[test]
fn saves_from_two_threads_all_land() {
    let (dir, store) = open("threads");
    std::thread::scope(|scope| {
        for who in ["x", "y"] {
            let store = &store;
            scope.spawn(move || {
                for n in 0..5 {
                    let key = format!("{who}{n}");
                    save_settings_released(
                        store,
                        &|mut old: serde_json::Value| {
                            old[key.as_str()] = json!(n);
                            old
                        },
                        &mut |step: &DiskStep| step.run(),
                    )
                    .unwrap();
                }
            });
        }
    });
    let disk = on_disk(&dir);
    for who in ["x", "y"] {
        for n in 0..5 {
            assert_eq!(disk[format!("{who}{n}").as_str()], json!(n), "the save of {who}{n} is on disk: {disk}");
        }
    }
    assert_eq!(disk.as_object().unwrap().len(), 10);
}

/// A direct save (`Store::save_settings` under the lock, as other modules do) that lands while the
/// released save is writing its temp files is kept: the stale snapshot is thrown away and the
/// change is made again on top of what is on disk now.
#[test]
fn a_save_that_lands_in_between_is_not_lost() {
    let (dir, store) = open("between");
    store.lock().unwrap().save_settings(&json!({ "theme": "first" })).unwrap();
    let calls = Cell::new(0);
    let (mut tried, mut got_in, mut moves_after) = (false, false, 0);
    let out = save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            calls.set(calls.get() + 1);
            old["released"] = json!(true);
            old
        },
        &mut |step: &DiskStep| {
            if is_write(step) {
                if !tried {
                    tried = true;
                    // try_lock, so a save that still holds the lock here fails the test instead of hanging it.
                    if let Ok(s) = store.try_lock() {
                        let mut set = serde_json::Map::new();
                        set.insert("direct".into(), json!(true));
                        s.patch_settings(&set, &[]).unwrap();
                        got_in = true;
                    }
                }
            } else if tried {
                moves_after += 1;
            }
            step.run()
        },
    );
    let (old, new) = out.unwrap();
    assert!(got_in, "the store lock was free during the first write, so the direct save got in");
    assert_eq!(on_disk(&dir), json!({ "theme": "first", "direct": true, "released": true }), "both saves are on disk");
    assert_eq!(new, on_disk(&dir), "the value returned is the one that was saved");
    assert_eq!(old, json!({ "theme": "first", "direct": true }), "the old value returned is the one the final save was built on");
    assert_eq!(calls.get(), 2, "the change was made again on the newer settings");
    assert_eq!(moves_after, 0, "no rename of the stale snapshot was run");
    assert_eq!(store.lock().unwrap().settings(), json!({ "theme": "first", "direct": true, "released": true }));
}

/// A step that fails ends the save with that very error; nothing after it runs, the settings
/// file is as it was, both locks are free and the next save works.
#[test]
fn a_failed_write_reports_the_error_and_changes_nothing() {
    let (dir, store) = open("fail");
    store.lock().unwrap().save_settings(&json!({ "theme": "first" })).unwrap();
    let before = fs::read(file(&dir, "settings.json")).unwrap();
    let lane = store.lock().unwrap().save_lane();
    let change = |mut old: serde_json::Value| {
        old["theme"] = json!("second");
        old
    };

    // The first write fails.
    let (mut failed, mut after) = (false, 0);
    let err = save_settings_released(&store, &change, &mut |step: &DiskStep| {
        if failed {
            after += 1;
            return step.run();
        }
        failed = true;
        Err(denied("the disk says no"))
    })
    .unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    assert_eq!(err.to_string(), "the disk says no", "the error of the failed step is returned as it is");
    assert_eq!(after, 0, "no step runs after a failed one");
    assert_eq!(fs::read(file(&dir, "settings.json")).unwrap(), before, "the settings file is untouched");
    assert!(!file(&dir, "settings.json.bak").exists(), "no backup was put in place");
    assert!(store.try_lock().is_ok() && lane.try_lock().is_ok(), "both locks are free after a failed save");
    assert_eq!(store.lock().unwrap().settings(), json!({ "theme": "first" }));

    // The last rename (the new file into place) fails.
    let mut after = 0;
    let target = file(&dir, "settings.json");
    let mut failed = false;
    let err = save_settings_released(&store, &change, &mut |step: &DiskStep| {
        if failed {
            after += 1;
        }
        if matches!(step, DiskStep::Rename { to, .. } if *to == target) {
            failed = true;
            return Err(denied("the rename says no"));
        }
        step.run()
    })
    .unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    assert_eq!(err.to_string(), "the rename says no");
    assert_eq!(after, 0);
    assert_eq!(fs::read(file(&dir, "settings.json")).unwrap(), before, "the settings file is untouched");
    assert!(store.try_lock().is_ok() && lane.try_lock().is_ok(), "both locks are free after a failed rename");
    assert_eq!(store.lock().unwrap().settings(), json!({ "theme": "first" }));

    // And the next save goes through.
    save_settings_released(&store, &change, &mut |step: &DiskStep| step.run()).unwrap();
    assert_eq!(on_disk(&dir), json!({ "theme": "second" }));
}

/// T-075 / after-list 38 kept: a corrupt settings.json beside a good backup is set aside before the
/// save lands; when the set-aside fails the save is refused with the same words as today.
#[test]
fn a_failed_set_aside_refuses_as_before() {
    let (dir, store) = open("aside");
    store.lock().unwrap().save_settings(&json!({ "theme": "first" })).unwrap();
    store.lock().unwrap().save_settings(&json!({ "theme": "second" })).unwrap();
    let bak = fs::read(file(&dir, "settings.json.bak")).unwrap();
    fs::write(file(&dir, "settings.json"), b"{ half").unwrap();
    let change = |mut old: serde_json::Value| {
        old["font"] = json!("big");
        old
    };

    let mut kinds: Vec<&str> = Vec::new();
    let err = save_settings_released(&store, &change, &mut |step: &DiskStep| match step {
        DiskStep::WriteSynced { .. } => {
            kinds.push("write");
            step.run()
        }
        DiskStep::SetAside { from, .. } => {
            kinds.push("aside");
            assert_eq!(*from, file(&dir, "settings.json"));
            Err(denied("held by a scanner"))
        }
        DiskStep::Rename { .. } => {
            kinds.push("rename");
            step.run()
        }
    })
    .unwrap_err();
    assert_eq!(kinds, ["write", "aside"], "the new file is written, the set-aside fails, nothing is renamed into place");
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    let text = err.to_string();
    assert!(text.contains("it could not be set aside: held by a scanner") && text.contains("saved nothing"), "{text}");
    assert_eq!(fs::read(file(&dir, "settings.json")).unwrap(), b"{ half", "the corrupt bytes are never overwritten");

    // With a disk that works: the corrupt bytes are kept under a corrupt- name, the save is built on the backup.
    let (old, new) = save_settings_released(&store, &change, &mut |step: &DiskStep| step.run()).unwrap();
    assert_eq!(old, json!({ "theme": "first" }), "the save is built on the last good copy");
    assert_eq!(new, json!({ "theme": "first", "font": "big" }));
    assert_eq!(on_disk(&dir), new);
    assert_eq!(fs::read(file(&dir, "settings.json.bak")).unwrap(), bak, "the last good copy stays as it is");
    let kept: Vec<_> = settings_files(&dir).into_iter().filter(|(name, _)| name.starts_with("settings.json.corrupt-")).collect();
    assert!(kept.iter().any(|(_, bytes)| bytes == b"{ half"), "the corrupt bytes are kept aside, not deleted");
}

/// T-441 kept: a settings file that cannot be read, with no backup, refuses the save before any step.
#[test]
fn an_unreadable_file_refuses_before_any_step() {
    let (dir, store) = open("unreadable");
    fs::write(file(&dir, "settings.json"), b"{ half").unwrap();
    let mut steps = 0;
    let err = save_settings_released(
        &store,
        &|mut old: serde_json::Value| {
            old["theme"] = json!("second");
            old
        },
        &mut |step: &DiskStep| {
            steps += 1;
            step.run()
        },
    )
    .unwrap_err();
    assert_eq!(steps, 0, "a refused save runs no step");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    assert!(err.to_string().contains("saved nothing"), "{err}");
    assert_eq!(settings_files(&dir), vec![("settings.json".to_string(), b"{ half".to_vec())], "nothing was written");
    assert!(store.lock().unwrap().plan_settings_save(&json!({ "theme": "x" })).is_err(), "planning refuses too");
    assert!(store.try_lock().is_ok(), "the store lock is free after a refused save");
    let lane = store.lock().unwrap().save_lane();
    assert!(lane.try_lock().is_ok(), "the lane is free after a refused save");
}

/// `DiskStep::run` is the real disk: a synced write, and a rename that replaces its target.
#[test]
fn the_real_step_runner_writes_and_renames() {
    let (dir, _store) = open("run");
    let (a, b, c) = (file(&dir, "a.txt"), file(&dir, "b.txt"), file(&dir, "c.txt"));
    DiskStep::WriteSynced { path: a.clone(), bytes: b"one".to_vec() }.run().unwrap();
    assert_eq!(fs::read(&a).unwrap(), b"one");
    DiskStep::WriteSynced { path: a.clone(), bytes: b"2".to_vec() }.run().unwrap();
    assert_eq!(fs::read(&a).unwrap(), b"2", "a write replaces the whole file");
    fs::write(&b, b"old").unwrap();
    DiskStep::Rename { from: a.clone(), to: b.clone() }.run().unwrap();
    assert!(!a.exists());
    assert_eq!(fs::read(&b).unwrap(), b"2", "a rename replaces its target");
    DiskStep::SetAside { from: b.clone(), to: c.clone() }.run().unwrap();
    assert!(!b.exists());
    assert_eq!(fs::read(&c).unwrap(), b"2");
    assert!(DiskStep::Rename { from: a.clone(), to: b.clone() }.run().is_err(), "renaming a file that is not there is an error");
    assert!(DiskStep::WriteSynced { path: file(&dir, "no-such-folder").join("x"), bytes: vec![1] }.run().is_err());
}
