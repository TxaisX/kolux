//! LAG-11-BUSY board tests (locked): asking "is anything running in this terminal" for many
//! terminals at once reads the system's process list ONCE, not once per terminal.
//! Declared at the end of procs.rs as `mod busy_board_tests`; reaches the new items through `super::`.
//! No real process is started or listed here: the process list is a fake table, the snapshot a counted closure.

use super::{children_in, has_children_each};
use std::cell::Cell;

/// A fake process list: (process id, parent id) pairs.
/// 100 runs 200 and 201, 103 runs 203, 107 runs 207; 105 names itself as its own parent (not a child).
fn table() -> Vec<(u32, u32)> {
    vec![
        (4, 0),
        (100, 4),
        (200, 100),
        (201, 100),
        (103, 4),
        (203, 103),
        (105, 105),
        (107, 4),
        (207, 107),
        (300, 999),
    ]
}

/// The answer for one id, worked out by hand from `table()`.
fn by_hand(pid: u32) -> bool {
    matches!(pid, 100 | 103 | 107 | 999)
}

/// A1: twelve terminals asked in one batch take one snapshot of the process list, not twelve.
#[test]
fn twelve_busy_checks_take_one_snapshot() {
    let snapshots = Cell::new(0u32);
    let pids: Vec<Option<u32>> = (100u32..112).map(Some).collect();
    let got = has_children_each(&pids, || {
        snapshots.set(snapshots.get() + 1);
        Some(table())
    });
    assert_eq!(snapshots.get(), 1, "12 busy checks in one batch must read the process list once, not {} times", snapshots.get());
    assert_eq!(got.len(), 12, "one answer per id, in order");
    let want: Vec<Option<bool>> = (100u32..112).map(|p| Some(by_hand(p))).collect();
    assert_eq!(got, want, "the shared snapshot gives every id its own right answer");
}

/// A2: the shared answers equal the answers of one check per id against the same table.
#[test]
fn shared_answers_match_one_check_per_id() {
    let t = table();
    // Ids with children, without, unknown, self-parented, a parent that is not itself listed, and a repeat.
    let ids = [100u32, 4, 200, 103, 105, 999, 12345, 107, 100, 0];
    for &pid in &ids {
        assert_eq!(children_in(&t, pid), by_hand(pid) || pid == 4 || pid == 0, "children_in({pid}) is wrong");
    }
    let pids: Vec<Option<u32>> = ids.iter().copied().map(Some).collect();
    let snapshots = Cell::new(0u32);
    let got = has_children_each(&pids, || {
        snapshots.set(snapshots.get() + 1);
        Some(t.clone())
    });
    let one_by_one: Vec<Option<bool>> = ids.iter().map(|&p| Some(children_in(&t, p))).collect();
    assert_eq!(got, one_by_one, "sharing one snapshot must not change any answer");
    assert_eq!(snapshots.get(), 1);
}

/// A2: a process that names itself as its parent is not its own child; an empty table has no children.
#[test]
fn a_process_is_not_its_own_child() {
    assert!(!children_in(&[(105, 105)], 105), "a self-parented entry is not a child");
    assert!(children_in(&[(105, 105), (106, 105)], 105), "a real child still counts next to a self entry");
    assert!(!children_in(&[], 1), "an empty table has no children");
    assert!(!children_in(&[(1, 2)], 1), "being a child is not having one");
}

/// A3: ids that have no process (ended or never started) need no snapshot at all, and read as unknown.
#[test]
fn ids_without_a_process_take_no_snapshot() {
    let snapshots = Cell::new(0u32);
    let none: Vec<Option<u32>> = vec![None; 12];
    let got = has_children_each(&none, || {
        snapshots.set(snapshots.get() + 1);
        Some(table())
    });
    assert_eq!(snapshots.get(), 0, "no process id, no snapshot");
    assert_eq!(got, vec![None; 12]);
    let got = has_children_each(&[], || {
        snapshots.set(snapshots.get() + 1);
        Some(table())
    });
    assert_eq!(snapshots.get(), 0, "an empty batch takes no snapshot");
    assert!(got.is_empty());
    // A mixed batch: one snapshot, and the ids without a process stay unknown in their places.
    let mixed = [None, Some(100), None, Some(200), None];
    let got = has_children_each(&mixed, || {
        snapshots.set(snapshots.get() + 1);
        Some(table())
    });
    assert_eq!(snapshots.get(), 1, "a mixed batch takes one snapshot");
    assert_eq!(got, vec![None, Some(true), None, Some(false), None]);
}

/// A4: when the process list cannot be read, every check reads as unknown (the caller fails open),
/// and the failed read is not retried once per id.
#[test]
fn a_failed_snapshot_reads_as_unknown_for_every_check() {
    let snapshots = Cell::new(0u32);
    let pids: Vec<Option<u32>> = vec![Some(100), None, Some(103), Some(7)];
    let got = has_children_each(&pids, || {
        snapshots.set(snapshots.get() + 1);
        None
    });
    assert_eq!(snapshots.get(), 1, "a failed read is tried once per batch, not once per id");
    assert_eq!(got, vec![None, None, None, None]);
}

/// A5: each batch reads the list again, so a program started between two asks is seen by the second.
#[test]
fn each_batch_takes_its_own_fresh_snapshot() {
    let snapshots = Cell::new(0u32);
    let pids = [Some(500u32), Some(100)];
    let first = has_children_each(&pids, || {
        snapshots.set(snapshots.get() + 1);
        Some(table())
    });
    assert_eq!(first, vec![Some(false), Some(true)]);
    let mut later = table();
    later.push((501, 500)); // 500 started a program since
    later.retain(|e| e.1 != 100); // and 100's programs ended
    let second = has_children_each(&pids, || {
        snapshots.set(snapshots.get() + 1);
        Some(later.clone())
    });
    assert_eq!(snapshots.get(), 2, "the next batch reads the list again; nothing is kept between batches");
    assert_eq!(second, vec![Some(true), Some(false)], "the second batch sees the new list");
}
