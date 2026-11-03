//! SKILL-023: deleting skills is all or nothing, even across a crash. Each item (a skill folder, a
//! link to one, or its install receipt) is first renamed aside next to where it sits, with a
//! journal in the app's folder saying what moved where. Only once every item is aside is the
//! journal marked done and the set-aside copies removed. A failed rename puts everything back. At
//! startup an unfinished journal is finished: not yet done means every item goes back, done means
//! the removal is completed. The skills list (T-243) leaves set-aside items out.
//!
//! SKILL-022 (T-180): the Skills page's delete. A request names 1 to 512 skills by the path the
//! list showed and the change time it showed. Each is planned first: bundled and plugin skills, a
//! skill outside Kolux's skill folders, one in a project stored in WSL, one no longer on disk and
//! one changed since the list loaded are blocked with that reason; the rest gather every folder and link that holds the same skill
//! across the scanned roots, plus its install receipt. Removing a link never touches what it points
//! at. Each skill is then deleted on its own, all or nothing, under the one lock skill installs and
//! updates share, and comes back as deleted, skipped, busy, partly removed or failed. Nothing runs inside
//! a WSL distribution (OD-12, DT-C94).

use crate::skills::{self, Places, SKILL_FILE};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

const JOURNAL: &str = "skill-delete.json";
/// Items set aside start with this, so the skills list leaves them out.
const ASIDE: &str = ".kolux-deleting-";
/// A rename Windows refuses because another program holds a file is tried this often, this far apart.
const TRIES: u32 = 20;
const PAUSE: Duration = Duration::from_millis(100);
/// SKILL-022: the one lock skill deletes, installs and updates share, in the app's folder.
const LOCK: &str = "skill-op.lock";
/// SKILL-022: one delete request covers between 1 and this many skills.
pub const MAX_PICKS: usize = 512;
/// An install receipt sits next to the skill folder it belongs to, named after it.
const RECEIPT: &str = ".receipt.json";

/// FIX-8 AFTER 1, FIX-9: a leftover kept because its skills folder is not scanned right now (`Stale`)
/// is kept through this many start-ups (counted for each leftover), then dropped from the record and
/// left on disk with the hint how to clear it by hand, so it neither sits on the record nor fills
/// the log for good.
const STALE_STARTS: u32 = 5;

#[derive(Serialize, Deserialize, Default)]
struct Journal {
    done: bool,
    moves: Vec<(PathBuf, PathBuf)>,
    /// Set-aside copies an earlier, finished delete could not remove yet. They are carried into
    /// the next delete's record so that delete can start, and are only ever removed, never put back.
    #[serde(default)]
    left: Vec<PathBuf>,
    /// FIX-5 (2), FIX-6, FIX-7: the skill folders the delete scanned. A set-aside copy is removed
    /// only when it sits under one of them, and a folder named here counts for removal only if it is
    /// an absolute folder that exists and is one the app scans right now, or at start-up really has
    /// the shape of a workspace skills folder (`Trust`). A folder named skills that exists but is
    /// neither (a home folder that moved) removes nothing and keeps its entries on record, and a
    /// not-done put-back under it still goes through, but only when the folder really is named skills
    /// where it sits (FIX-8: a link written as `skills` that leads to a folder with another name is
    /// no skills folder, so a rename through it is refused). So a damaged or hand-edited record can
    /// at most remove a folder with the set-aside name form from a skill folder; nothing elsewhere.
    /// A record without them (an older one) removes nothing; its entries are dropped, and a not-done
    /// one puts back only under a live or workspace-shaped folder.
    #[serde(default)]
    roots: Vec<PathBuf>,
    /// FIX-8 AFTER 1, FIX-9: for each kept `Stale` leftover (its set-aside path), how many start-ups
    /// have seen it so; at `STALE_STARTS` it is dropped. A leftover with no entry has been seen 0
    /// times. A delete carries the counts unchanged; only leftovers still `Stale` keep one.
    #[serde(default)]
    stale_counts: Vec<(PathBuf, u32)>,
}

/// Why the record could not be read.
#[derive(Debug)]
enum ReadError {
    /// The file could not be read (held by another program, a disk error); the next try may work.
    Io(std::io::Error),
    /// The file was read but is not a record; it stays as it is, and a hidden skill it may have
    /// named must be renamed back by hand.
    Parse(serde_json::Error),
}

/// What an earlier delete left behind, settled so a new delete can start.
struct Settled {
    /// Set-aside copies a finished delete could not remove yet. Those under a folder this delete
    /// scans are taken on; those under a workspace skills folder it does not scan (FIX-6 (2)) stay on
    /// record for the next start, which acts on them, and are left alone now.
    carry: Vec<PathBuf>,
    /// The skill folders this delete and the carried copies belong to: what goes in the record.
    roots: Vec<PathBuf>,
    /// The skill folders this delete scans: what it may act on.
    live: Vec<PathBuf>,
    /// The entries the record is rewritten without, with why; logged once that happened.
    dropped: Vec<(PathBuf, String)>,
    /// Log lines for the entries carried but left alone by this delete; written with `dropped`.
    kept: Vec<String>,
    /// The record's per-leftover counts of start-ups that saw it kept as `Stale`; carried on unchanged.
    stale_counts: Vec<(PathBuf, u32)>,
}

/// FIX-6 (4), FIX-7: which of the skill folders a record names a recovery may act on.
struct Trust {
    /// The skill folders scanned right now: a delete's, or at start-up the home ones.
    live: Vec<PathBuf>,
    /// Start-up only: a folder shaped like a workspace skills folder counts too, since the workspace
    /// that delete scanned need not be open. A delete acts only on what it scanned (FIX-6 (2)).
    idle_ok: bool,
}

impl Trust {
    fn startup(live: Vec<PathBuf>) -> Trust {
        Trust { live, idle_ok: true }
    }
    fn delete(live: &[PathBuf]) -> Trust {
        Trust { live: live.to_vec(), idle_ok: false }
    }
}

/// What a recorded skill folder is worth.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum RootClass {
    /// Not an absolute, existing folder, or not named like a skills folder: vouches for nothing.
    Bogus,
    /// FIX-7 (1), FIX-8: an existing folder named skills, both as written and where it really is, that
    /// is not scanned right now and is no workspace skills folder (a home skill folder that moved
    /// between launches): its entries are kept on the record, untouched, and a put-back inside it is
    /// allowed. A link written as skills that leads to a folder with another name is `Bogus`.
    Stale,
    /// A workspace skills folder by shape that is not scanned right now.
    Idle,
    /// A folder scanned right now.
    Live,
}

/// What to do with a record entry that is still on disk.
#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    /// Exactly what a delete here wrote, under a folder it may act on: remove (or carry) it.
    Act,
    /// Vouched for by the record, but under a skills folder not scanned right now (a workspace one
    /// the next start acts on, or a stale one): stays on record, untouched.
    Keep(String),
    /// FIX-8 AFTER 1: the same for a skills folder that is not scanned and no workspace one (`Stale`).
    /// It stays on record only through `STALE_STARTS` start-ups; a delete says nothing about it.
    KeepStale(String),
    /// Not a copy this app set aside, or not under a skill folder it scans: left alone and taken
    /// off the record, so it never blocks a delete and is never removed.
    Drop(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Deleted,
    /// Everything is gone from the list, but these set-aside copies could not be removed yet; the
    /// next start tries again.
    Partly(Vec<PathBuf>),
}

/// The app folders whose skill lock this process holds right now.
static HELD: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
#[cfg(test)]
static DIE_AFTER_ASIDE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// SKILL-017 / T-243: a folder or link set aside by an unfinished delete is not a skill.
pub fn is_set_aside(name: &str) -> bool {
    name.starts_with(ASIDE)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis())
}

/// SKILL-022: held while a skill operation runs; dropping it lets the next one in.
pub struct OpLock {
    dir: PathBuf,
    /// The open lock file holding the system's exclusive lock; closing it releases the lock.
    file: Option<std::fs::File>,
}

impl Drop for OpLock {
    fn drop(&mut self) {
        // The file stays on disk: removing it while another process waits to open it could let two
        // takers lock two different files. An unlocked file is free, whatever it says.
        if let Some(f) = self.file.take() {
            let _ = f.unlock();
        }
        if let Ok(mut held) = HELD.lock() {
            held.retain(|d| d != &self.dir);
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LockError {
    /// Another skill operation is under way.
    Busy,
    /// The lock could not be written at all.
    Failed(String),
}

/// SKILL-022: the one lock skill deletes, installs and updates share. In this process a second
/// taker is turned away at once; across processes the lock is the system's exclusive lock on a
/// file in the app's folder, so exactly one taker wins even when two try at the same moment. The
/// system drops the lock when its holder exits or crashes, so a lock is never left behind and
/// skill operations never stay stuck. The file also holds the pid and time of the last taker; on Windows the
/// system's lock keeps other programs from reading that text while the lock is held, so it is of use only once
/// the lock is free (or to a taker on another platform), and nothing here depends on it.
pub fn lock(app_dir: &Path) -> Result<OpLock, LockError> {
    let dir = app_dir.to_path_buf();
    {
        let mut held = HELD.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if held.contains(&dir) {
            return Err(LockError::Busy);
        }
        held.push(dir.clone());
    }
    // From here the guard owns the in-process claim, so every early return releases it.
    let mut guard = OpLock { dir, file: None };
    let fail = |e: std::io::Error| LockError::Failed(format!("the skill lock could not be written ({e})"));
    std::fs::create_dir_all(app_dir).map_err(fail)?;
    let mut f = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app_dir.join(LOCK)).map_err(fail)?;
    match f.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => return Err(LockError::Busy),
        Err(std::fs::TryLockError::Error(e)) => return Err(fail(e)),
    }
    // Who took it last; the lock itself does not depend on this text, and on Windows no other program can
    // read it while the lock is held.
    let _ = f.set_len(0).and_then(|()| f.write_all(format!("{} {}", std::process::id(), now_ms()).as_bytes()));
    guard.file = Some(f);
    Ok(guard)
}

/// Settles the record an earlier delete may have left, for a caller that holds the lock. Err means
/// no delete can start and says why; Ok carries what the next delete takes on.
///
/// A done record whose set-aside copies are still there (a file another program holds) hands them
/// on, so they are never forgotten and never stop a delete; an entry the record cannot vouch for
/// (FIX-4 (1), FIX-5 (2): not next to its original, not named as a set-aside copy, or not under a
/// skill folder) is dropped from the record and left on disk, and logged once the new record is
/// written without it (AFTER 3). FIX-6 (2): a vouched-for copy under a workspace skills folder this
/// delete does not scan is carried but left alone, so the next start (which acts on such folders)
/// clears it. A not-done record that could not be put back is never written over.
fn settle(app_dir: &Path, live: &[PathBuf]) -> Result<Settled, String> {
    let mut settled = Settled { carry: vec![], roots: live.to_vec(), live: live.to_vec(), dropped: vec![], kept: vec![], stale_counts: vec![] };
    let trust = Trust::delete(live);
    let path = app_dir.join(JOURNAL);
    if !path.exists() {
        return Ok(settled);
    }
    let mut stuck = recover_with(app_dir, &trust, false);
    if !path.exists() {
        return Ok(settled);
    }
    let prefix = "Nothing was deleted: an earlier delete could not be cleared up";
    match read(app_dir) {
        Ok(old) if old.done => {
            let entries = old.moves.iter().map(|(from, aside)| (aside, Some(from.as_path()))).chain(old.left.iter().map(|a| (a, None)));
            for (aside, from) in entries {
                if std::fs::symlink_metadata(aside).is_err() {
                    continue; // already gone
                }
                match verdict(&old.roots, &trust, from, aside) {
                    Verdict::Drop(why) => settled.dropped.push((aside.clone(), why)),
                    Verdict::Keep(why) => {
                        settled.kept.push(kept_line(aside, &why));
                        settled.carry.push(aside.clone());
                    }
                    // FIX-8 AFTER 1: carried and silent; start-up counts and says it.
                    Verdict::KeepStale(_) => settled.carry.push(aside.clone()),
                    Verdict::Act => settled.carry.push(aside.clone()),
                }
            }
            settled.stale_counts = old.stale_counts;
            if !settled.carry.is_empty() {
                // The carried copies stay under the folders their own delete scanned, as far as
                // those are skill folders at all (FIX-6 (4)).
                for r in old.roots {
                    if classify(&r, &trust.live) != RootClass::Bogus && !settled.roots.iter().any(|known| same(known, &r)) {
                        settled.roots.push(r);
                    }
                }
            }
            Ok(settled)
        }
        Ok(_) => {
            // FIX-5 (3): every copy was put back but the record itself could not be cleared (the
            // only lines are about the record): one more try before it is reported as in the way.
            if stuck.iter().all(|line| line.starts_with("its record")) {
                stuck = recover_with(app_dir, &trust, false);
                if !path.exists() {
                    return Ok(settled);
                }
                if stuck.is_empty() {
                    stuck.push(format!("its record {} could not be cleared; try again", path.display()));
                }
            }
            // FIX-4 (2): the error names what is in the way and where, so the user can clear it.
            Err(format!("{prefix}: {}", stuck.join("; ")))
        }
        // FIX-5 (3): a record another program holds is not a file to move away; moving it would
        // strand the hidden skills it names.
        Err(ReadError::Io(e)) => Err(format!("{prefix}: its record {} could not be read ({e}); try again", path.display())),
        Err(ReadError::Parse(e)) => Err(format!("{prefix}: its record {} is damaged ({e}); move that file away, then {RENAME_ADVICE}", path.display())),
    }
}

/// AFTER 2: how to get a hidden skill back by hand, and when not to: a finished delete leaves the
/// same folders behind, so one is only worth renaming if the user did not mean to delete that skill.
const RENAME_ADVICE: &str = "look in the skill folders for folders named .kolux-deleting-<pid>-<nanos>-<name>: each is a skill a delete hid, and <name> (what follows the second dash after the numbers) is its own name; rename one back to that name only if you did not mean to delete that skill (a delete that finished leaves such folders too)";

/// The log line for an entry a recovery leaves on the record untouched.
fn kept_line(aside: &Path, why: &str) -> String {
    format!("skill delete: kept {} on the record and left it alone for now, {why}", aside.display())
}

/// `dir` still really is, or sits in, a skill folder this delete scanned (links followed).
fn in_scanned(trust: &Trust, dir: &Path) -> bool {
    trust.live.iter().any(|r| inside(dir, r))
}

/// Deletes `items` together for a caller that holds the lock and settled the record. Err means
/// nothing changed.
fn delete_held(app_dir: &Path, settled: Settled, items: &[PathBuf]) -> Result<Outcome, String> {
    let Settled { carry, roots, live, dropped, kept, stale_counts } = settled;
    let trust = Trust::delete(&live);
    // FIX-8 AFTER 2: what settling decided is logged on every way out. When the delete stops before
    // the record is rewritten, the kept lines are still true and are said here. A refused entry
    // (`dropped`) is there only because settle's own rewrite of the record failed, and that rewrite
    // already logged it as "refused to remove ..." (FIX-9 AFTER 2), so it gets no second line.
    let say_pending = || {
        for line in &kept {
            crate::diag::write(app_dir, line);
        }
    };
    let stamp = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    let mut moves = Vec::new();
    for item in items {
        let (Some(parent), Some(name)) = (item.parent(), item.file_name()) else {
            say_pending();
            return Err(format!("{} is not something that can be deleted", item.display()));
        };
        if std::fs::symlink_metadata(item).is_err() {
            say_pending();
            return Err(format!("{} is no longer on disk; refresh the list", item.display()));
        }
        // Earlier AFTER 10: a link in the path may have been swapped since the plan, so the folder it
        // sits in must still really be a scanned one. Checked here to refuse before a record is
        // written, and again right before each rename (below), where a swap can still land.
        if !in_scanned(&trust, parent) {
            say_pending();
            return Err(format!("Nothing was deleted: {} no longer sits in a skill folder this delete scanned; refresh the list", item.display()));
        }
        moves.push((item.clone(), parent.join(format!("{ASIDE}{stamp}-{}", name.to_string_lossy()))));
    }
    let fail = |e: std::io::Error| format!("Nothing was deleted: the delete record could not be written ({e})");
    let mut journal = Journal { done: false, moves, left: carry, roots, stale_counts };
    if let Err(e) = write(app_dir, &journal) {
        say_pending();
        return Err(fail(e));
    }
    // AFTER 3: the record now really is without the refused entries (and with the kept ones).
    for (aside, why) in &dropped {
        crate::diag::write(app_dir, &format!("skill delete: dropped {} from the record and left it alone, {why}", aside.display()));
    }
    for line in &kept {
        crate::diag::write(app_dir, line);
    }
    for (i, (from, aside)) in journal.moves.iter().enumerate() {
        // FIX-8 AFTER 3, FIX-9: before every attempt of the rename (the first and each retry), the
        // folder the item sits in is judged again. A swap between that check and the system call
        // itself is still possible.
        let moved = rename_checked(from, aside, || {
            if from.parent().is_some_and(|p| in_scanned(&trust, p)) {
                Ok(())
            } else {
                Err(std::io::Error::other("it no longer sits in a skill folder this delete scanned"))
            }
        });
        if let Err(e) = moved {
            let mut stuck = false;
            for (back, held) in journal.moves[..i].iter().rev() {
                stuck |= put_back(held, back).is_err();
            }
            if stuck {
                // The not-done record stays, so the next start puts the rest back.
                return Err(format!("Nothing was deleted: {} could not be moved ({e}); what was already moved is put back at the next start", from.display()));
            }
            // The record goes back to what it was before: nothing, or only the carried copies.
            if journal.left.is_empty() {
                let _ = std::fs::remove_file(app_dir.join(JOURNAL));
            } else {
                let _ = write(app_dir, &Journal { done: true, moves: vec![], left: journal.left.clone(), roots: journal.roots.clone(), stale_counts: journal.stale_counts.clone() });
            }
            return Err(format!("Nothing was deleted: {} could not be moved ({e})", from.display()));
        }
        #[cfg(test)]
        run_hook(&AFTER_RENAME, from);
    }
    #[cfg(test)]
    if DIE_AFTER_ASIDE.load(std::sync::atomic::Ordering::SeqCst) {
        std::process::exit(9);
    }
    journal.done = true;
    write(app_dir, &journal).map_err(fail)?;
    // Only this delete's own copies decide its outcome; carried ones wait for the next try.
    let mine: Vec<PathBuf> = finish(app_dir, &journal, &trust, false).into_iter().filter(|a| journal.moves.iter().any(|(_, m)| m == a)).collect();
    Ok(if mine.is_empty() { Outcome::Deleted } else { Outcome::Partly(mine) })
}

fn read(app_dir: &Path) -> Result<Journal, ReadError> {
    let text = std::fs::read_to_string(app_dir.join(JOURNAL)).map_err(ReadError::Io)?;
    serde_json::from_str(&text).map_err(ReadError::Parse)
}

/// What the start-up recovery did.
#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    /// The lock was taken and the record (if any) was dealt with.
    Recovered,
    /// Another running instance holds the lock; its delete may be under way, so nothing was touched.
    /// The next delete and the next start recover.
    Skipped,
    /// The lock file could not be opened, twice: logged, and recovered without the lock, because
    /// leaving the record would hide a skill at every start. Another instance mid-delete cannot be
    /// ruled out (see `startup_recover`).
    RecoveredUnlocked,
}

#[cfg(test)]
type Hook = Box<dyn FnOnce() + Send>;
/// Tests: run once, for that app folder, right before start-up recovery tries the lock again.
#[cfg(test)]
static ON_RETRY: Mutex<Vec<(PathBuf, Hook)>> = Mutex::new(Vec::new());
/// Tests: run once, keyed by an item's original path, right after a delete renamed that item (so
/// before it renames the next one).
#[cfg(test)]
static AFTER_RENAME: Mutex<Vec<(PathBuf, Hook)>> = Mutex::new(Vec::new());
/// Tests: run once, keyed by the path being renamed, after a rename attempt failed and before the next.
#[cfg(test)]
static BETWEEN_ATTEMPTS: Mutex<Vec<(PathBuf, Hook)>> = Mutex::new(Vec::new());

/// Takes the hook registered for `key` out of `list` and runs it. The position is looked up and the
/// hook removed under one lock (FIX-9 AFTER 5), so tests running in parallel cannot shift the index
/// in between; the lock is let go before the hook runs, so a hook may use the list itself.
#[cfg(test)]
fn run_hook(list: &Mutex<Vec<(PathBuf, Hook)>>, key: &Path) {
    let hook = {
        let mut hooks = list.lock().unwrap();
        hooks.iter().position(|(k, _)| k == key).map(|i| hooks.remove(i).1)
    };
    if let Some(hook) = hook {
        hook();
    }
}

/// SKILL-023: what the app runs at start. An interrupted delete is undone or completed under the
/// skill lock, so a second instance never puts back a delete the first one is still running.
pub fn startup_recover(app_dir: &Path) -> Startup {
    // FIX-6 (4): at start-up the record may act on the home skill folders of this environment and
    // on folders shaped like a workspace skills folder; nothing else it names counts.
    startup_recover_as(app_dir, &Trust::startup(skills::home_roots(&skills::Env::current())))
}

fn startup_recover_as(app_dir: &Path, trust: &Trust) -> Startup {
    let mut tried = false;
    loop {
        match lock(app_dir) {
            Ok(_one) => {
                recover(app_dir, trust);
                return Startup::Recovered;
            }
            Err(LockError::Busy) => {
                crate::diag::write(app_dir, "skill delete: start-up recovery skipped, another instance holds the skill lock");
                return Startup::Skipped;
            }
            // Busy is the usual answer while another instance holds the lock, but Failed does not
            // rule one out: a backup or antivirus tool that opens the lock file without sharing, or
            // sets it read-only, makes a second instance's open fail while the first is mid-delete.
            // So one more try after a pause for a passing holder of the file; if it still fails,
            // recovery runs without the lock, because leaving the record would hide a skill at every
            // start. The only data that could then be put back or half-removed is what the other
            // instance's user chose to delete.
            Err(LockError::Failed(why)) if !tried => {
                tried = true;
                crate::diag::write(app_dir, &format!("skill delete: {why}; retrying the skill lock once"));
                #[cfg(test)]
                run_hook(&ON_RETRY, app_dir);
                std::thread::sleep(PAUSE);
            }
            Err(LockError::Failed(why)) => {
                crate::diag::write(app_dir, &format!("skill delete: {why}; recovering without it"));
                recover(app_dir, trust);
                return Startup::RecoveredUnlocked;
            }
        }
    }
}

/// `<pid>-<nanos>`: the stamp a delete puts between the prefix and the name (see `delete_held`).
fn stamped(s: &str) -> bool {
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    s.split_once('-').is_some_and(|(pid, nanos)| digits(pid) && digits(nanos))
}

/// The exact form of a set-aside copy's name, `.kolux-deleting-<pid>-<nanos>-<name>`, for an entry
/// with no original on record (a carried copy). `is_set_aside` is looser on purpose: the list hides
/// anything with the prefix.
fn set_aside_name(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_prefix(ASIDE)).is_some_and(|rest| {
        let mut parts = rest.splitn(3, '-');
        matches!((parts.next(), parts.next(), parts.next()), (Some(pid), Some(nanos), Some(name)) if stamped(&format!("{pid}-{nanos}")) && !name.is_empty())
    })
}

/// An entry of the record is trusted only if it is exactly what a delete here would have written:
/// the set-aside copy sits next to the original and is named `.kolux-deleting-<pid>-<nanos>-<its name>`
/// (FIX-4: not merely ending in its name, so `...-xalpha` is not alpha's copy).
fn aside_of(from: &Path, aside: &Path) -> bool {
    let (Some(f), Some(a)) = (from.file_name().and_then(|n| n.to_str()), aside.file_name().and_then(|n| n.to_str())) else { return false };
    let same_parent = match (from.parent(), aside.parent()) {
        (Some(x), Some(y)) => same(x, y),
        _ => false,
    };
    same_parent && a.strip_prefix(ASIDE).and_then(|r| r.strip_suffix(f)).and_then(|r| r.strip_suffix('-')).is_some_and(stamped)
}

/// FIX-6 (3): a skill folder a record may name is an absolute folder that exists. An empty root
/// would otherwise match everything (its key is "", which every path starts with), a relative one
/// would resolve against whatever folder the process runs in, and a missing one is not a skill folder.
fn usable_root(root: &Path) -> bool {
    !root.as_os_str().is_empty() && root.is_absolute() && root.is_dir()
}

/// FIX-5 (2): the copy sits in one of the given skill folders (or below one); a folder that is not
/// `usable_root` counts for nothing.
fn under_root(aside: &Path, roots: &[PathBuf]) -> bool {
    aside.parent().is_some_and(|parent| roots.iter().any(|root| usable_root(root) && inside(parent, root)))
}

/// FIX-7 AFTER 3: `p` has the workspace skills shape as written and also where it really is, so a
/// link written as `.../.claude/skills` that leads elsewhere is not taken for one.
fn shaped(p: &Path) -> bool {
    skills::workspace_skills_shape(p) && std::fs::canonicalize(p).is_ok_and(|real| skills::workspace_skills_shape(&real))
}

/// A folder named skills, as every skill folder the app scans is.
fn named_skills(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case("skills"))
}

/// FIX-8 FIX-SOON 1: named skills as written and where it really is, the way `shaped` judges the
/// workspace shape. A link written as skills that leads to `D:my-skills` is no skills folder:
/// renaming "inside" it would reach a folder that is not one.
fn really_named_skills(p: &Path) -> bool {
    named_skills(p) && std::fs::canonicalize(p).is_ok_and(|real| named_skills(&real))
}

/// FIX-8 FIX-SOON 1: a recorded folder written as skills that exists but leads to a folder with
/// another name (a home skills folder that is a link to `D:my-skills`) and holds `aside`: refused
/// as a skills folder (`Bogus`), which is said with the hint how to put the copy back by hand.
fn linked_off_name<'a>(roots: &'a [PathBuf], aside: &Path) -> Option<&'a Path> {
    roots.iter().find(|r| usable_root(r) && named_skills(r) && !really_named_skills(r) && under_root(aside, std::slice::from_ref(r))).map(PathBuf::as_path)
}

/// FIX-6 (4): what a recorded skill folder is worth against the folders scanned right now.
fn classify(root: &Path, live: &[PathBuf]) -> RootClass {
    if !usable_root(root) {
        RootClass::Bogus
    } else if live.iter().any(|l| same(l, root) || skills::key(l) == skills::key(root)) {
        RootClass::Live
    } else if shaped(root) {
        RootClass::Idle
    } else if really_named_skills(root) {
        RootClass::Stale
    } else {
        RootClass::Bogus
    }
}

/// FIX-7 (2): a record without skill folders (an older one) may put a copy back only in a folder
/// scanned right now or one shaped like a workspace skills folder.
fn rootless_ok(aside: &Path, live: &[PathBuf]) -> bool {
    aside.parent().is_some_and(|p| matches!(classify(p, live), RootClass::Live | RootClass::Idle) || (usable_root(p) && live.iter().any(|l| inside(p, l))))
}

/// The best of the recorded skill folders the copy sits under, with its class; None when it sits
/// under none that counts (`under_root`).
fn cover<'a>(roots: &'a [PathBuf], live: &[PathBuf], aside: &Path) -> Option<(RootClass, &'a Path)> {
    roots.iter().filter(|r| under_root(aside, std::slice::from_ref(r))).map(|r| (classify(r, live), r.as_path())).max_by_key(|(c, _)| *c)
}

/// Whether a record entry is exactly what a delete here writes (named
/// `.kolux-deleting-<pid>-<nanos>-<name>`, next to its original when one is on record, `aside_of`)
/// and under a skill folder the record names that counts right now (`classify`): act on it, keep it
/// for the next start, or drop it. A record without skill folders (an older one) vouches for nothing.
fn verdict(roots: &[PathBuf], trust: &Trust, from: Option<&Path>, aside: &Path) -> Verdict {
    match from {
        Some(f) if !aside_of(f, aside) => return Verdict::Drop(format!("it is not a copy set aside from {}", f.display())),
        None if !set_aside_name(aside) => return Verdict::Drop("it is not a copy this app set aside".into()),
        _ => {}
    }
    match cover(roots, &trust.live, aside) {
        Some((RootClass::Live, _)) => Verdict::Act,
        Some((RootClass::Idle, _)) if trust.idle_ok => Verdict::Act,
        Some((RootClass::Idle, root)) => Verdict::Keep(format!("it is under {}, a workspace skills folder this delete did not scan; the next start clears it", root.display())),
        Some((RootClass::Stale, root)) => Verdict::KeepStale(format!("it is under {}, a skills folder this app does not scan right now; it is not removed while that stays so", root.display())),
        _ => Verdict::Drop("it is not under a skill folder this app scans".into()),
    }
}

/// At startup: an unfinished delete is undone (not yet done) or completed (done). Returns one line
/// per entry that is in the way, or about the record itself when it could not be cleared (also
/// written to the log); empty when the record is cleared or done.
fn recover(app_dir: &Path, trust: &Trust) -> Vec<String> {
    recover_with(app_dir, trust, true)
}

/// The same, for a caller that is a delete: it passes false for `say_kept` and says the kept lines
/// itself, so one delete never says them twice.
fn recover_with(app_dir: &Path, trust: &Trust, say_kept: bool) -> Vec<String> {
    let mut stuck = vec![];
    let path = app_dir.join(JOURNAL);
    let journal = match read(app_dir) {
        Ok(j) => j,
        Err(ReadError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return stuck,
        // FIX-5 (3): an unreadable record is left as it is and said so; the next start or delete tries again.
        Err(ReadError::Io(e)) => {
            crate::diag::write(app_dir, &format!("skill delete: the record {} could not be read ({e}); tried again at the next start or delete", path.display()));
            return stuck;
        }
        Err(ReadError::Parse(e)) => {
            crate::diag::write(app_dir, &format!("skill delete: the record {} is damaged ({e}) and is left in place; {RENAME_ADVICE}", path.display()));
            return stuck;
        }
    };
    if journal.done {
        finish(app_dir, &journal, trust, say_kept);
        return stuck;
    }
    let mut dropped = vec![];
    for (from, aside) in journal.moves.iter().rev() {
        if std::fs::symlink_metadata(aside).is_err() {
            continue; // never moved, or already put back
        }
        // FIX-5 (1): an entry that is not a copy set aside from its original can never be put back,
        // so keeping it would only stop every later delete. It is left on disk as it is and dropped
        // from the record, which is said once the record is really without it. AFTER 3 (FIX-6): when
        // the record names its skill folders, the copy must also sit under one that counts (a put-back
        // is a rename, so a workspace folder not scanned now is fine); older records put back as before.
        // FIX-7: a recorded folder that exists and is named skills is enough, even if it is no home
        // folder now (it moved between launches, and leaving the copy would hide the skill for good);
        // a record without folders needs a live or workspace-shaped one (`rootless_ok`).
        let covered = if journal.roots.is_empty() { rootless_ok(aside, &trust.live) } else { cover(&journal.roots, &trust.live, aside).is_some_and(|(c, _)| c != RootClass::Bogus) };
        let refused = if !aside_of(from, aside) {
            Some(format!("it is not a copy set aside from {}", from.display()))
        } else if !covered {
            Some(match linked_off_name(&journal.roots, aside) {
                // FIX-8 FIX-SOON 1: a link written as skills that leads to a folder with another name.
                Some(link) => format!("it is not under a skill folder this app scans: {} is a link to a folder that is not named skills, so nothing is put back through it; {RENAME_ADVICE}", link.display()),
                None => "it is not under a skill folder this app scans".to_string(),
            })
        } else {
            None
        };
        if let Some(why) = refused {
            dropped.push(format!("skill delete: dropped {} from the record and left it alone, {why}", aside.display()));
            continue;
        }
        let why = if std::fs::symlink_metadata(from).is_err() {
            match rename(aside, from) {
                Ok(()) => continue,
                Err(e) => format!("{} could not be put back as {} ({e}); close what holds it or move it by hand", aside.display(), from.display()),
            }
        } else {
            // Both are there: the original came back after the delete set the copy aside. Neither is
            // overwritten or removed; the record stays so this is looked into, not forgotten.
            format!("{} and its set-aside copy {} both exist; move one of them out of the way", from.display(), aside.display())
        };
        crate::diag::write(app_dir, &format!("skill delete: {why}"));
        stuck.push(why);
    }
    if !stuck.is_empty() {
        return stuck;
    }
    // FIX-5 (3): a record that was put back but could not be cleared is reported as such, never as
    // unreadable; its line starts with "its record" so the next delete knows to try once more.
    let cleared = if journal.left.is_empty() {
        std::fs::remove_file(&path).map_err(|e| format!("its record {} could not be removed ({e}); try again", path.display()))
    } else {
        // Copies carried from an earlier finished delete are never put back, only removed.
        let rest = Journal { done: true, moves: vec![], left: journal.left, roots: journal.roots, stale_counts: journal.stale_counts };
        write(app_dir, &rest).map_err(|e| format!("its record {} could not be rewritten ({e}); try again", path.display())).map(|()| {
            finish(app_dir, &rest, trust, say_kept);
        })
    };
    match cleared {
        Ok(()) => {
            for line in dropped {
                crate::diag::write(app_dir, &line);
            }
        }
        Err(why) => {
            crate::diag::write(app_dir, &format!("skill delete: {why}"));
            stuck.push(why);
        }
    }
    stuck
}

/// Removes every set-aside copy the record names that it may act on; returns the ones still on the
/// record: not removable yet, or kept for the next start. The record is removed once none is left.
fn finish(app_dir: &Path, journal: &Journal, trust: &Trust, say_kept: bool) -> Vec<PathBuf> {
    // T-441-c: only a path Kolux set aside itself is ever removed. The journal is read back at every
    // launch, so an entry naming anything else (a damaged or hand-edited file) is left on disk and
    // (AFTER 1, FIX-6) taken off the record, logged once the record is really without it, so it is
    // neither removed nor reported again at every start. What "set aside itself" means is
    // `verdict`: the exact name form, next to its original when one is on record, and under a skill
    // folder the record names that counts right now (FIX-5 (2), FIX-6 (4)).
    let (mut moves, mut left, mut dropped, mut kept, mut removed) = (vec![], vec![], vec![], vec![], false);
    // FIX-8 AFTER 1: kept `Stale` leftovers are decided after the loop, once it is known whether this
    // start-up is the one that retires them: (original, copy, why).
    let mut stale: Vec<(Option<PathBuf>, PathBuf, String)> = vec![];
    let entries = journal.moves.iter().map(|(from, aside)| (aside, Some(from))).chain(journal.left.iter().map(|a| (a, None)));
    for (a, from) in entries {
        if std::fs::symlink_metadata(a).is_err() {
            continue; // already gone
        }
        let stays = match verdict(&journal.roots, trust, from.map(PathBuf::as_path), a) {
            Verdict::Drop(why) => {
                dropped.push((a.clone(), why));
                false
            }
            Verdict::Keep(why) => {
                kept.push(kept_line(a, &why));
                true
            }
            Verdict::KeepStale(why) => {
                stale.push((from.cloned(), a.clone(), why));
                false
            }
            Verdict::Act => {
                let failed = remove(a).is_err();
                removed |= !failed;
                failed
            }
        };
        if stays {
            match from {
                Some(f) => moves.push((f.clone(), a.clone())),
                None => left.push(a.clone()),
            }
        }
    }
    // FIX-8 AFTER 1, FIX-9: a start-up counts each `Stale` leftover it sees, on its own count; the
    // `STALE_STARTS`th start retires that leftover from the record (it stays on disk, with the hint
    // how to clear it), so one that only just became `Stale` is not retired with an older one. A
    // delete only carries them, silently and with their counts unchanged. Counts of anything no
    // longer `Stale` are not carried.
    let (mut stale_counts, mut counted) = (vec![], false);
    for (from, a, why) in stale {
        let seen = journal.stale_counts.iter().find(|(p, _)| *p == a).map_or(0, |(_, n)| *n);
        let n = if say_kept { seen + 1 } else { seen };
        if say_kept && n >= STALE_STARTS {
            dropped.push((a, format!("{why}; it has stayed so through {STALE_STARTS} starts, so it is left on disk and taken off the record: {RENAME_ADVICE}")));
            continue;
        }
        if say_kept {
            counted = true;
            kept.push(kept_line(&a, &format!("{why} (start {n} of {STALE_STARTS})")));
        }
        stale_counts.push((a.clone(), n));
        match from {
            Some(f) => moves.push((f, a)),
            None => left.push(a),
        }
    }
    let still: Vec<PathBuf> = moves.iter().map(|(_, a)| a.clone()).chain(left.iter().cloned()).collect();
    let cleared = if still.is_empty() {
        std::fs::remove_file(app_dir.join(JOURNAL))
    } else if dropped.is_empty() && !removed && !counted {
        Ok(()) // nothing changed on disk, so the record is right as it is
    } else {
        write(app_dir, &Journal { done: true, moves, left, roots: journal.roots.clone(), stale_counts })
    };
    match cleared {
        Ok(()) => {
            for (a, why) in dropped {
                crate::diag::write(app_dir, &format!("skill delete: dropped {} from the record and left it alone, {why}", a.display()));
            }
        }
        Err(e) => {
            // The record still names them: said as a refusal, not as a drop that did not happen.
            for (a, why) in dropped {
                crate::diag::write(app_dir, &format!("skill delete: refused to remove {}, {why}; the record could not be rewritten without it ({e})", a.display()));
            }
        }
    }
    // FIX-7 AFTER 1: a delete says it once (from `delete_held`, which has the lines from `settle`);
    // start-up recovery has no other place to say it.
    if say_kept {
        for line in kept {
            crate::diag::write(app_dir, &line);
        }
    }
    still
}

/// A link goes without what it points at; a folder goes with its contents.
fn remove(path: &Path) -> std::io::Result<()> {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return Ok(()) };
    if meta.is_dir() && !meta.file_type().is_symlink() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))
    }
}

fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    rename_checked(from, to, || Ok(()))
}

/// `rename`, but `check` runs before every attempt, the first and each retry; an Err from it ends the
/// rename at once (it is not retried). The check and the system call are still two steps: a swap that
/// lands between them is not caught (FIX-9 FIX-SOON 1).
fn rename_checked(from: &Path, to: &Path, check: impl Fn() -> std::io::Result<()>) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        check()?;
        match std::fs::rename(from, to) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound && tries + 1 < TRIES => {
                tries += 1;
                #[cfg(test)]
                run_hook(&BETWEEN_ATTEMPTS, from);
                std::thread::sleep(PAUSE);
            }
            r => return r,
        }
    }
}

#[cfg(test)]
thread_local! {
    /// Tests: every put-back on this thread fails, as when another program holds the moved item.
    static FAIL_PUT_BACK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Puts a set-aside item back where it was, after a later move in the same delete failed.
fn put_back(held: &Path, back: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_PUT_BACK.with(std::cell::Cell::get) {
        return Err(std::io::Error::other("held by a test"));
    }
    rename(held, back)
}

fn write(app_dir: &Path, journal: &Journal) -> std::io::Result<()> {
    let path = app_dir.join(JOURNAL);
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(app_dir)?;
    std::fs::write(&tmp, serde_json::to_vec(journal).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, &path)
}

/// SKILL-022: one skill the user chose, by the path and change time the list showed.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub path: String,
    pub updated: Option<u64>,
}

/// One thing a delete removes: a skill folder, a link to one, or an install receipt.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub path: String,
    /// folder | link | receipt
    pub kind: &'static str,
}

/// What a delete would do with one chosen skill.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub path: String,
    /// bundled | plugin | outside | gone | changed | wsl; None when it can go.
    pub blocked: Option<&'static str>,
    pub items: Vec<Item>,
    /// Where the skill's content stays when only links to it are removed.
    pub remains: Option<String>,
    /// Links outside the skill folders that point at a folder this delete removes. They are never
    /// removed; afterwards each points at nothing.
    pub dangling: Vec<String>,
}

/// How the delete went for one chosen skill.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub path: String,
    /// deleted | skipped | busy | partly | failed
    pub outcome: &'static str,
    pub note: Option<String>,
}

/// The same path as written, ignoring slash direction, a trailing slash and (on Windows) case.
fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = skills::plain(p).replace('/', "\\");
        let s = s.trim_end_matches('\\').to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// `p` is `root` or somewhere below it, both followed through links to where they really are.
fn inside(p: &Path, root: &Path) -> bool {
    let (p, r) = (skills::key(p), skills::key(root));
    let r = r.trim_end_matches(['\\', '/']);
    p == r || p.strip_prefix(r).is_some_and(|rest| rest.starts_with(['\\', '/']))
}

fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

fn changed_at(file: &Path) -> Option<u64> {
    std::fs::metadata(file).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

fn real(p: &Path) -> String {
    skills::plain(&std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
}

fn count_ok(n: usize) -> Result<(), String> {
    if n == 0 || n > MAX_PICKS {
        return Err(format!("A delete covers between 1 and {MAX_PICKS} skills; {n} were chosen"));
    }
    Ok(())
}

/// SKILL-022: what deleting `picks` would remove, skill by skill, without changing anything.
pub fn plan(places: &Places, picks: &[Pick]) -> Result<Vec<Planned>, String> {
    count_ok(picks.len())?;
    let mut found: Vec<PathBuf> = vec![];
    // A root handed in twice (or two roots that are one folder) is read once.
    let mut roots = HashSet::new();
    for root in places.deletable.iter().filter(|r| roots.insert(skills::key(r))) {
        found.extend(skills::occurrences(root)?);
    }
    let mut out = vec![];
    let mut taken: HashSet<String> = HashSet::new();
    for pick in picks {
        let blocked = |why: &'static str| Planned { path: pick.path.clone(), blocked: Some(why), items: vec![], remains: None, dangling: vec![] };
        if pick.path.starts_with("kolux:") {
            out.push(blocked("bundled"));
            continue;
        }
        let file = PathBuf::from(&pick.path);
        // T-666: a skill on another computer is refused by its text (or a link's target) before
        // anything below resolves it, which would make Windows sign in to that machine. A WSL path
        // by its text is answered first, so its share is not touched either.
        if skills::wsl_text(&file) {
            out.push(blocked("wsl"));
            continue;
        }
        if skills::remote_path(&file) {
            out.push(blocked("outside"));
            continue;
        }
        // DT-C94: a skill in a project stored in WSL, by any spelling or a drive or link that leads
        // there, is refused before it is planned.
        if skills::in_wsl(&file) {
            out.push(blocked("wsl"));
            continue;
        }
        let Some(dir) = file.parent().filter(|_| file.file_name().is_some_and(|n| n == SKILL_FILE)) else {
            out.push(blocked("outside"));
            continue;
        };
        if places.plugin.iter().any(|r| inside(dir, r)) {
            out.push(blocked("plugin"));
            continue;
        }
        if std::fs::symlink_metadata(&file).is_err() {
            out.push(blocked("gone"));
            continue;
        }
        // The list may show a skill by any path that reaches it; one that resolves to a folder found
        // in the roots is the same skill.
        let Some(me) = found.iter().find(|f| same(f, dir)).or_else(|| found.iter().find(|f| skills::key(f) == skills::key(dir))) else {
            out.push(blocked("outside"));
            continue;
        };
        if changed_at(&file) != pick.updated {
            out.push(blocked("changed"));
            continue;
        }
        let k = skills::key(me);
        if !taken.insert(k.clone()) {
            continue; // the same skill chosen twice is planned once
        }
        let mut items = vec![];
        let mut remains = None;
        let mut outside_links = vec![];
        // One folder per real location: the same folder reached twice moves once.
        let mut folder = false;
        let mut links = HashSet::new();
        for occ in found.iter().filter(|f| skills::key(f) == k) {
            if is_link(occ) {
                // A link is removed only where it really sits inside a skills root; one reached
                // through a linked folder that lives elsewhere stays, and so does its content.
                let Some(parent) = occ.parent().filter(|p| places.deletable.iter().any(|r| inside(p, r))) else {
                    remains = Some(real(occ));
                    // Named by where it really sits, not by the way the list reached it.
                    if let (Some(up), Some(name)) = (occ.parent(), occ.file_name()) {
                        outside_links.push(skills::plain(&PathBuf::from(real(up)).join(name)));
                    }
                    continue;
                };
                // The same link reached twice moves once.
                if links.insert(format!("{}/{}", skills::key(parent), occ.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())) {
                    items.push(Item { path: skills::plain(occ), kind: "link" });
                }
            } else if places.deletable.iter().any(|r| inside(occ, r)) {
                if std::mem::replace(&mut folder, true) {
                    continue;
                }
                items.push(Item { path: skills::plain(occ), kind: "folder" });
                let receipt = occ.with_file_name(format!("{}{RECEIPT}", occ.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
                if receipt.is_file() {
                    items.push(Item { path: skills::plain(&receipt), kind: "receipt" });
                }
            } else {
                // Reached through a linked folder: the content lives outside the skill folders.
                remains = Some(real(occ));
            }
        }
        if items.is_empty() {
            out.push(Planned { remains, ..blocked("outside") });
            continue;
        }
        let mut dangling = vec![];
        if items.iter().any(|i| i.kind == "folder") {
            // The content goes with the folder, even when an outside link pointed at it; that link
            // stays and points at nothing, which the confirmation says.
            remains = None;
            outside_links.sort();
            outside_links.dedup();
            dangling = outside_links;
        } else {
            remains = remains.or_else(|| Some(real(me)));
        }
        out.push(Planned { path: pick.path.clone(), blocked: None, items, remains, dangling });
    }
    Ok(out)
}

/// SKILL-022: deletes `picks` skill by skill under the shared lock, each all or nothing.
pub fn run(app_dir: &Path, places: &Places, picks: &[Pick]) -> Result<Vec<Done>, String> {
    count_ok(picks.len())?;
    let every = |outcome: &'static str, note: String| picks.iter().map(|p| Done { path: p.path.clone(), outcome, note: Some(note.clone()) }).collect();
    let _one = match lock(app_dir) {
        Ok(l) => l,
        Err(LockError::Busy) => return Ok(every("busy", "Another skill operation is under way; try again in a moment".into())),
        Err(LockError::Failed(why)) => return Ok(every("failed", format!("Nothing was deleted: {why}"))),
    };
    let planned = plan(places, picks)?;
    let mut out = vec![];
    // AFTER 5: the record an earlier delete left is settled once per request, not once per skill. A
    // stuck one gives every skill the same answer, logged once, with the put-back retries paid once;
    // after a failed delete it is settled once more for the skills still to come.
    let mut next = Some(settle(app_dir, &places.deletable));
    for p in planned {
        if let Some(why) = p.blocked {
            out.push(Done { path: p.path, outcome: "skipped", note: Some(why.into()) });
            continue;
        }
        let settled = match next.take().unwrap_or_else(|| settle(app_dir, &places.deletable)) {
            Ok(s) => s,
            Err(e) => {
                out.push(Done { path: p.path, outcome: "failed", note: Some(e.clone()) });
                next = Some(Err(e));
                continue;
            }
        };
        let items: Vec<PathBuf> = p.items.iter().map(|i| PathBuf::from(&i.path)).collect();
        out.push(match delete_held(app_dir, settled, &items) {
            Ok(Outcome::Deleted) => Done { path: p.path, outcome: "deleted", note: None },
            Ok(Outcome::Partly(left)) => {
                let n = left.len();
                Done { path: p.path, outcome: "partly", note: Some(format!("{n} hidden staged {} left over; Kolux clears {} at the next start", if n == 1 { "copy is" } else { "copies are" }, if n == 1 { "it" } else { "them" })) }
            }
            Err(e) => Done { path: p.path, outcome: "failed", note: Some(e) },
        });
    }
    skills::forget_scans();
    Ok(out)
}

/// SKILL-022: the confirmation's facts for the chosen skills; changes nothing.
#[tauri::command]
pub async fn skills_delete_plan(workspace: Option<String>, picks: Vec<Pick>) -> Result<Vec<Planned>, String> {
    tauri::async_runtime::spawn_blocking(move || plan(&skills::places(&skills::Env::current(), workspace.as_deref().map(Path::new)), &picks)).await.map_err(|e| e.to_string())?
}

/// SKILL-022: deletes the chosen skills once the user confirmed; one outcome per skill.
#[tauri::command]
pub async fn skills_delete(app: tauri::AppHandle, workspace: Option<String>, picks: Vec<Pick>) -> Result<Vec<Done>, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || run(&dir, &skills::places(&skills::Env::current(), workspace.as_deref().map(Path::new)), &picks)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;

    /// The journal's own tests take the lock and delete a hand-picked set, as `run` does per skill,
    /// with the items' own folders as the scanned skill folders.
    fn delete(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
        let _one = lock(app_dir).map_err(|e| format!("{e:?}"))?;
        let mut roots: Vec<PathBuf> = items.iter().filter_map(|i| i.parent().map(Path::to_path_buf)).collect();
        roots.dedup();
        delete_held(app_dir, settle(app_dir, &roots)?, items)
    }

    fn skill(root: &Path, name: &str) -> PathBuf {
        let d = root.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("SKILL.md"), format!("# {name}")).unwrap();
        d
    }

    fn names(root: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    /// Start-up recovery that treats `root` as the one home skill folder.
    fn trust(root: &Path) -> Trust {
        Trust::startup(vec![root.to_path_buf()])
    }

    #[test]
    fn skill023_a_delete_removes_the_skills_and_their_receipts_and_leaves_no_record() {
        let t = temp("skill023-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let b = skill(&root, "beta");
        skill(&root, "gamma");
        let receipt = root.join("alpha.receipt.json");
        std::fs::write(&receipt, "{}").unwrap();
        assert_eq!(delete(&app, &[a, b, receipt]), Ok(Outcome::Deleted));
        assert_eq!(names(&root), ["gamma"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn skill023_a_missing_item_changes_nothing() {
        let t = temp("skill023-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let err = delete(&app, &[a, root.join("gone")]).unwrap_err();
        assert!(err.contains("no longer on disk"), "{err}");
        assert_eq!(names(&root), ["alpha"]);
    }

    #[test]
    fn skill023_set_aside_items_are_not_skills() {
        assert!(is_set_aside(".kolux-deleting-12-34-alpha"));
        assert!(!is_set_aside("alpha"));
    }

    /// The child half of the crash test: sets the skills aside, then the process dies before the
    /// delete completes (exit without unwinding, like a kill).
    #[test]
    #[ignore]
    fn skill023_child_dies_mid_delete() {
        let Ok(dir) = std::env::var("KOLUX_SKILL023_DIR") else { return };
        let t = PathBuf::from(dir);
        DIE_AFTER_ASIDE.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = delete(&t.join("app"), &[t.join("skills/alpha"), t.join("skills/beta")]);
    }

    #[test]
    fn skill023_killed_after_setting_aside_the_skills_come_back_on_restart() {
        let t = temp("skill023-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        skill(&root, "alpha");
        skill(&root, "beta");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "skill_delete::tests::skill023_child_dies_mid_delete", "--ignored", "--nocapture"])
            .env("KOLUX_SKILL023_DIR", &*t.0)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(9), "the child must die mid-delete");
        let mid = names(&root);
        assert!(mid.len() == 2 && mid.iter().all(|n| is_set_aside(n)), "both set aside: {mid:?}");
        recover(&app, &trust(&root));
        assert_eq!(names(&root), ["alpha", "beta"]);
        assert_eq!(std::fs::read_to_string(root.join("alpha/SKILL.md")).unwrap(), "# alpha");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn skill023_a_done_delete_left_half_removed_is_completed_on_restart() {
        let t = temp("skill023-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-1-2-alpha");
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), aside)], left: vec![], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert!(names(&root).is_empty());
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn t441c_a_journal_naming_a_plain_folder_never_deletes_it() {
        let t = temp("t441c-plain");
        let (app, root) = (t.join("app"), t.join("skills"));
        let plain = skill(&root, "alpha");
        let aside = skill(&root, ".kolux-deleting-1-2-beta");
        write(&app, &Journal { done: true, moves: vec![(root.join("x"), plain.clone()), (root.join("beta"), aside)], left: vec![], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert_eq!(names(&root), vec!["alpha".to_string()], "the plain folder is kept, the set-aside one goes");
        assert!(plain.join("SKILL.md").exists());
        // AFTER 1 (FIX-6): the refused entry is taken off the record, which then has nothing left.
        assert!(!app.join(JOURNAL).exists(), "the refused entry is dropped, so the record goes");
        assert!(log_of(&app).contains(&format!("dropped {} from the record and left it alone", plain.display())), "{}", log_of(&app));
    }

    #[test]
    fn skill023_a_failed_rename_puts_back_what_moved() {
        let t = temp("skill023-e");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let b = skill(&root, "beta");
        // A second delete of the same item: alpha is moved first, then cannot be found the second
        // time, so the first move is rolled back.
        let err = delete(&app, &[a.clone(), b, a]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted"), "{err}");
        assert_eq!(names(&root), ["alpha", "beta"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[cfg(windows)]
    #[test]
    fn skill023_a_briefly_locked_skill_file_is_retried_and_deleted() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("skill023-f");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(a.join("SKILL.md")).unwrap();
        assert!(std::fs::rename(&a, root.join("probe")).is_err(), "the lock must block a rename");
        let hold = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            drop(held);
        });
        assert_eq!(delete(&app, &[a]), Ok(Outcome::Deleted));
        hold.join().unwrap();
        assert!(names(&root).is_empty());
    }

    // SKILL-022 (T-180)

    fn link_dir(link: &Path, target: &Path) {
        #[cfg(windows)]
        {
            let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
            assert!(ok, "could not make a junction");
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn pick(dir: &Path) -> Pick {
        let file = dir.join(SKILL_FILE);
        Pick { path: skills::plain(&file), updated: changed_at(&file) }
    }

    fn places(deletable: &[&Path], plugin: &[&Path]) -> Places {
        Places { deletable: deletable.iter().map(|p| p.to_path_buf()).collect(), plugin: plugin.iter().map(|p| p.to_path_buf()).collect() }
    }

    #[test]
    fn skill022_a_bundled_or_plugin_skill_is_blocked_and_only_the_home_skill_goes() {
        let t = temp("skill022-a");
        let (app, home, plug) = (t.join("app"), t.join("home"), t.join("plugin"));
        let alpha = skill(&home, "alpha");
        let p = skill(&plug, "planner");
        let at = places(&[&home], &[&plug]);
        let picks = [pick(&alpha), Pick { path: "kolux:orchestration".into(), updated: None }, pick(&p)];
        let plan = plan(&at, &picks).unwrap();
        assert_eq!(plan.iter().map(|p| p.blocked).collect::<Vec<_>>(), [None, Some("bundled"), Some("plugin")]);
        assert_eq!(plan[0].items, [Item { path: skills::plain(&alpha), kind: "folder" }]);
        assert_eq!(plan[0].remains, None);
        let done = run(&app, &at, &picks).unwrap();
        assert_eq!(done.iter().map(|d| d.outcome).collect::<Vec<_>>(), ["deleted", "skipped", "skipped"]);
        assert_eq!(done[1].note.as_deref(), Some("bundled"));
        assert!(names(&home).is_empty(), "the home skill is gone");
        assert!(p.join(SKILL_FILE).is_file(), "the plugin's skill stays");
        assert!(!app.join(JOURNAL).exists(), "no record left");
        drop(lock(&app).expect("the lock is free again"));
    }

    #[test]
    fn skill022_a_skill_changed_on_disk_before_confirming_is_reported_and_left_alone() {
        let t = temp("skill022-b");
        let (app, home) = (t.join("app"), t.join("home"));
        let alpha = skill(&home, "alpha");
        let mut seen = pick(&alpha);
        seen.updated = seen.updated.map(|ms| ms - 5_000); // the list loaded before the last change
        let at = places(&[&home], &[]);
        assert_eq!(plan(&at, std::slice::from_ref(&seen)).unwrap()[0].blocked, Some("changed"));
        let done = run(&app, &at, &[seen]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("skipped", Some("changed")));
        assert_eq!(std::fs::read_to_string(alpha.join(SKILL_FILE)).unwrap(), "# alpha");
    }

    #[test]
    fn skill022_deleting_a_link_removes_the_link_and_keeps_the_folder_it_points_at() {
        let t = temp("skill022-c");
        let (app, home, elsewhere) = (t.join("app"), t.join("home"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(&home).unwrap();
        let link = home.join("beta");
        link_dir(&link, &target);
        let at = places(&[&home], &[]);
        let plan = plan(&at, &[pick(&link)]).unwrap();
        assert_eq!(plan[0].items, [Item { path: skills::plain(&link), kind: "link" }]);
        assert!(plan[0].remains.as_deref().is_some_and(|r| same(Path::new(r), &target)), "names where the content stays: {:?}", plan[0].remains);
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&link).is_err(), "the link is gone");
        assert_eq!(std::fs::read_to_string(target.join(SKILL_FILE)).unwrap(), "# beta", "the target folder remains");
    }

    #[test]
    fn skill022_a_skill_and_a_link_to_it_in_another_root_go_together() {
        let t = temp("skill022-d");
        let (app, claude, shared) = (t.join("app"), t.join("claude"), t.join("shared"));
        let alpha = skill(&claude, "alpha");
        std::fs::create_dir_all(&shared).unwrap();
        link_dir(&shared.join("alpha"), &alpha);
        std::fs::write(claude.join("alpha.receipt.json"), "{}").unwrap();
        let at = places(&[&claude, &shared], &[]);
        let plan = plan(&at, &[pick(&alpha)]).unwrap();
        let kinds: Vec<&str> = plan[0].items.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, ["folder", "receipt", "link"], "{:?}", plan[0].items);
        assert_eq!(plan[0].remains, None);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&claude).is_empty() && names(&shared).is_empty());
    }

    /// DT-C94 (T-658): a skill in a project stored in WSL, by either share spelling, is blocked as
    /// "wsl" and skipped by a delete; the made-up distribution name proves no share is opened.
    #[test]
    fn t658_a_skill_in_a_project_stored_in_wsl_is_refused_without_touching_the_share() {
        let t = temp("t658-wsl");
        let home = t.join("home");
        let alpha = skill(&home, "alpha");
        let at = places(&[&home], &[]);
        let wsl = |s: &str| Pick { path: format!(r"{s}\krs-t658-none\home\me\repo\.claude\skills\lint\SKILL.md"), updated: None };
        let picks = [wsl(r"\\wsl.localhost"), wsl(r"\\wsl$"), wsl(r"\\?\UNC\wsl.localhost"), pick(&alpha)];
        let plan_of = plan(&at, &picks).unwrap();
        assert_eq!(plan_of.iter().map(|p| p.blocked).collect::<Vec<_>>(), [Some("wsl"), Some("wsl"), Some("wsl"), None]);
        let done = run(&t.join("app"), &at, &picks[..1]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("skipped", Some("wsl")));
        assert!(alpha.exists());
    }

    #[test]
    fn skill022_gone_and_outside_skills_are_blocked_and_a_request_holds_1_to_512() {
        let t = temp("skill022-e");
        let (home, stray) = (t.join("home"), t.join("stray"));
        let alpha = skill(&home, "alpha");
        let lost = pick(&alpha);
        std::fs::remove_dir_all(&alpha).unwrap();
        let out = skill(&stray, "omega");
        let at = places(&[&home], &[]);
        let plan_of = plan(&at, &[lost, pick(&out)]).unwrap();
        assert_eq!(plan_of.iter().map(|p| p.blocked).collect::<Vec<_>>(), [Some("gone"), Some("outside")]);
        assert!(plan(&at, &[]).unwrap_err().contains("between 1 and 512"));
        let many: Vec<Pick> = (0..=MAX_PICKS).map(|i| Pick { path: format!("kolux:{i}"), updated: None }).collect();
        assert!(plan(&at, &many).is_err());
        assert_eq!(plan(&at, &many[..MAX_PICKS]).unwrap().len(), MAX_PICKS);
    }

    #[test]
    fn skill022_two_skills_with_one_name_are_chosen_one_by_one() {
        let t = temp("skill022-f");
        let (app, a, b) = (t.join("app"), t.join("claude"), t.join("codex"));
        let one = skill(&a, "review");
        let two = skill(&b, "review");
        let at = places(&[&a, &b], &[]);
        assert_eq!(run(&app, &at, &[pick(&two)]).unwrap()[0].outcome, "deleted");
        assert!(one.join(SKILL_FILE).is_file() && !two.exists());
    }

    #[test]
    fn skill022_a_delete_while_another_skill_operation_runs_is_busy_and_changes_nothing() {
        let t = temp("skill022-g");
        let (app, home) = (t.join("app"), t.join("home"));
        let alpha = skill(&home, "alpha");
        let at = places(&[&home], &[]);
        let held = lock(&app).unwrap();
        let done = run(&app, &at, &[pick(&alpha)]).unwrap();
        assert_eq!(done[0].outcome, "busy");
        assert!(alpha.join(SKILL_FILE).is_file());
        drop(held);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
    }

    #[test]
    fn skill022_a_lock_left_behind_is_taken_back_and_a_live_one_is_respected() {
        let t = temp("skill022-h");
        let app = t.join("app");
        std::fs::create_dir_all(&app).unwrap();
        // A file left by a holder that is gone, whatever it says (here a fresh time and another
        // process): nobody holds the system lock, so it is taken at once.
        std::fs::write(app.join(LOCK), format!("4294967000 {}", now_ms())).unwrap();
        drop(lock(&app).expect("a lock nobody holds is taken back"));
        // A live holder elsewhere (its own open handle with the system lock): busy, file untouched.
        let other = std::fs::OpenOptions::new().read(true).write(true).open(app.join(LOCK)).unwrap();
        other.lock().unwrap();
        assert_eq!(lock(&app).err(), Some(LockError::Busy));
        assert!(app.join(LOCK).exists());
        drop(other);
        let l = lock(&app).expect("free once the other holder lets go");
        assert_eq!(lock(&app).err(), Some(LockError::Busy), "a second taker in this process waits its turn");
        drop(l);
        drop(lock(&app).expect("free again after the drop"));
    }

    /// The child half of the dead-holder test: takes the lock and dies holding it.
    #[test]
    #[ignore]
    fn fixsoon4_child_dies_holding_the_lock() {
        let Ok(dir) = std::env::var("KOLUX_FIXSOON4_DIR") else { return };
        std::mem::forget(lock(Path::new(&dir)).expect("the child takes the lock"));
        std::process::exit(9);
    }

    #[test]
    fn fixsoon4_a_lock_whose_holder_crashed_is_free_at_once() {
        let t = temp("fixsoon4");
        let app = t.join("app");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "skill_delete::tests::fixsoon4_child_dies_holding_the_lock", "--ignored", "--nocapture"])
            .env("KOLUX_FIXSOON4_DIR", &app)
            .spawn()
            .unwrap();
        let pid = child.id();
        assert_eq!(child.wait().unwrap().code(), Some(9), "the child must die holding the lock");
        let text = std::fs::read_to_string(app.join(LOCK)).unwrap();
        assert!(text.starts_with(&format!("{pid} ")), "the file names the dead child {pid}: {text}");
        let began = std::time::Instant::now();
        drop(lock(&app).expect("a crashed holder's lock is taken back"));
        assert!(began.elapsed() < Duration::from_secs(1), "no waiting out a timeout: {:?}", began.elapsed());
    }

    #[test]
    fn fixsoon4_the_system_lock_admits_one_handle_at_a_time() {
        let t = temp("fixsoon4-race");
        let app = t.join("app");
        std::fs::create_dir_all(&app).unwrap();
        // Two handles on the one file, as two processes would hold: only one gets the system lock.
        let open = || std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app.join(LOCK)).unwrap();
        let (a, b) = (open(), open());
        let wins = [a.try_lock().is_ok(), b.try_lock().is_ok()];
        assert_eq!(wins.iter().filter(|w| **w).count(), 1, "{wins:?}");
        assert_eq!(lock(&app).err(), Some(LockError::Busy), "and the app's own taker is the third, turned away");
    }

    // FIX-SOON 3: a finished delete's leftovers never block later deletes.

    #[cfg(windows)]
    #[test]
    fn fixsoon3_a_leftover_that_cannot_be_removed_yet_is_carried_and_later_deletes_go_through() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fixsoon3-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        let alpha = skill(&root, "alpha");
        let beta = skill(&root, "beta");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![(root.join("old"), old.clone())], left: vec![], roots: vec![root.clone()], ..Default::default() }).unwrap();
        // Another program holds a file in the leftover, so it cannot be removed for now.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(old.join(SKILL_FILE)).unwrap();
        let at = places(&[&root], &[]);
        let done = run(&app, &at, &[pick(&alpha), pick(&beta)]).unwrap();
        assert_eq!(done.iter().map(|d| (d.outcome, d.note.clone())).collect::<Vec<_>>(), [("deleted", None), ("deleted", None)]);
        assert_eq!(names(&root), [".kolux-deleting-1-2-old"], "only the held leftover is on disk");
        let kept = read(&app).expect("the record still names the leftover");
        assert!(kept.done && kept.left.contains(&old), "carried: {:?}", kept.left);
        drop(held);
        recover(&app, &trust(&root));
        assert!(names(&root).is_empty(), "the leftover goes at the next start");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn fixsoon3_a_crash_mid_delete_puts_its_own_items_back_and_still_removes_the_carried_copies() {
        let t = temp("fixsoon3-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-3-4-alpha");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: false, moves: vec![(root.join("alpha"), aside)], left: vec![old], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert_eq!(names(&root), ["alpha"], "alpha is back, the carried copy is gone");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    /// A record from before carried copies existed still reads. FIX-5 (2): one from before the
    /// skill folders were on record names none, so it vouches for nothing: its copy is refused and
    /// left on disk, and the next delete drops it from the record instead of removing it.
    fn fixsoon3_a_record_written_before_carried_copies_existed_is_still_read_and_removes_nothing() {
        let t = temp("fixsoon3-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-1-2-alpha");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join(JOURNAL), serde_json::json!({ "done": true, "moves": [[root.join("alpha"), aside]] }).to_string()).unwrap();
        recover(&app, &trust(&root));
        assert_eq!(names(&root), [".kolux-deleting-1-2-alpha"], "left on disk");
        assert!(!app.join(JOURNAL).exists(), "AFTER 1: dropped at start-up, so the record goes");
        assert!(log_of(&app).contains("dropped") && log_of(&app).contains("not under a skill folder"), "{}", log_of(&app));
        let beta = skill(&root, "beta");
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        assert_eq!(names(&root), [".kolux-deleting-1-2-alpha"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[cfg(windows)]
    #[test]
    fn fixsoon3_a_failed_move_puts_the_record_back_to_the_carried_copies() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fixsoon3-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![], left: vec![old.clone()], roots: vec![root.clone()], ..Default::default() }).unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(old.join(SKILL_FILE)).unwrap();
        // The same item twice: the second move finds nothing, so the first is put back.
        let err = delete(&app, &[a.clone(), a]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted"), "{err}");
        assert_eq!(names(&root), [".kolux-deleting-1-2-old", "alpha"]);
        let kept = read(&app).expect("the carried copy stays on record");
        assert!(kept.done && kept.moves.is_empty() && kept.left == [old], "{:?} {:?}", kept.moves, kept.left);
        drop(held);
        recover(&app, &trust(&root));
        assert_eq!(names(&root), ["alpha"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn skill022_set_aside_copies_are_not_listed_for_delete() {
        let t = temp("skill022-i");
        let home = t.join("home");
        skill(&home, "alpha");
        skill(&home, ".kolux-deleting-1-2-beta");
        let found = skills::occurrences(&home).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("alpha"));
    }

    // Council d2 review of 950ba36, FIX-BEFORE 1 and 2.

    fn env(home: &Path) -> skills::Env {
        skills::Env { home: home.to_path_buf(), claude: None, codex: None, grok: None, hermes: None, local_app_data: Some(home.join("AppData").join("Local")), windows: true }
    }

    fn kinds(p: &Planned) -> Vec<&'static str> {
        p.items.iter().map(|i| i.kind).collect()
    }

    #[test]
    fn t666_a_workspace_or_a_skill_on_another_computer_counts_as_outside_before_anything_resolves_it() {
        let home = temp("t666").join("home");
        std::fs::create_dir_all(home.join(".claude").join("skills")).unwrap();
        // A workspace on a share: none of its folders is a place a delete acts in.
        let at = skills::places(&env(&home), Some(Path::new(r"\\kolux-unc-test.invalid\share\proj")));
        assert!(at.deletable.iter().chain(&at.plugin).all(|p| !skills::remote_path(p)), "{:?}", at.deletable);
        assert!(at.deletable.iter().any(|p| p.starts_with(&home)), "the home folders stay: {:?}", at.deletable);
        // A pick on a share is "outside", not "gone": refused by its text before it is looked up.
        let at = places(&[&home], &[]);
        for p in [r"\\kolux-unc-test.invalid\share\skills\alpha\SKILL.md", "//kolux-unc-test.invalid/share/skills/alpha/SKILL.md", r"\\?\UNC\kolux-unc-test.invalid\share\skills\alpha\SKILL.md"] {
            let got = plan(&at, &[Pick { path: p.into(), updated: None }]).unwrap();
            assert_eq!(got[0].blocked, Some("outside"), "{p}");
        }
        // A project stored in WSL keeps its own answer.
        let wsl = plan(&at, &[Pick { path: r"\\wsl.localhost\Ubuntu\home\u\.claude\skills\a\SKILL.md".into(), updated: None }]).unwrap();
        assert_eq!(wsl[0].blocked, Some("wsl"));
        // A plugin installed on a share is not a plugin folder the delete resolves.
        let claude = home.join(".claude");
        std::fs::create_dir_all(claude.join("plugins")).unwrap();
        std::fs::write(claude.join("settings.json"), r#"{"enabledPlugins":{"p@m":true}}"#).unwrap();
        std::fs::write(claude.join("plugins").join("installed_plugins.json"), r#"{"plugins":{"p@m":[{"scope":"user","installPath":"\\\\kolux-unc-test.invalid\\share\\p"}]}}"#).unwrap();
        let at = skills::places(&env(&home), None);
        assert_eq!(at.plugin.len(), 1, "only the Codex cache on this computer: {:?}", at.plugin);
        assert!(at.plugin.iter().all(|p| !skills::remote_path(p)), "{:?}", at.plugin);
        // A home folder on a share (a redirected profile) gives no place to delete in.
        let far = skills::places(&env(Path::new(r"\\kolux-unc-test.invalid\share\home")), None);
        assert!(far.deletable.is_empty(), "{:?}", far.deletable);
        // A skill reached through a local link to a share is "outside" too (Windows: needs link rights).
        #[cfg(windows)]
        {
            let link = claude.join("skills").join("far");
            if std::os::windows::fs::symlink_dir(r"\\kolux-unc-test.invalid\share\skills", &link).is_ok() {
                let got = plan(&places(&[&home], &[]), &[Pick { path: skills::plain(&link.join(SKILL_FILE)), updated: None }]).unwrap();
                assert_eq!(got[0].blocked, Some("outside"), "through a link");
            } else {
                eprintln!("t666: no symlink rights here, the link case was not run");
            }
        }
    }

    #[test]
    fn fixb1_the_home_folder_opened_as_the_workspace_counts_a_skill_once_and_deletes_it() {
        let t = temp("fixb1-a");
        let (app, home) = (t.join("app"), t.join("home"));
        let root = home.join(".claude").join("skills");
        let alpha = skill(&root, "alpha");
        std::fs::write(root.join("alpha.receipt.json"), "{}").unwrap();
        let at = skills::places(&env(&home), Some(&home));
        let keys: Vec<String> = at.deletable.iter().map(|p| skills::key(p)).collect();
        assert_eq!(keys.iter().collect::<HashSet<_>>().len(), keys.len(), "each deletable root once: {:?}", at.deletable);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder", "receipt"], "{:?}", plan_of[0].items);
        // The same root handed in twice still plans one folder.
        let twice = places(&[&root, &root], &[]);
        assert_eq!(kinds(&plan(&twice, &[pick(&alpha)]).unwrap()[0]), ["folder", "receipt"]);
        let done = run(&app, &at, &[pick(&alpha)]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("deleted", None));
        assert!(names(&root).is_empty());
    }

    #[test]
    fn fixb1_a_skills_root_that_is_a_junction_to_another_counts_a_skill_once_and_deletes_it() {
        let t = temp("fixb1-b");
        let (app, home) = (t.join("app"), t.join("home"));
        let claude = home.join(".claude").join("skills");
        let alpha = skill(&claude, "alpha");
        std::fs::create_dir_all(home.join(".agents")).unwrap();
        let shared = home.join(".agents").join("skills");
        link_dir(&shared, &claude);
        let at = skills::places(&env(&home), None);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder"], "{:?}", plan_of[0].items);
        // Picked through the junctioned root: the same one folder.
        let via = plan(&at, &[pick(&shared.join("alpha"))]).unwrap();
        assert_eq!((via[0].blocked, kinds(&via[0])), (None, vec!["folder"]), "{:?}", via[0]);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&claude).is_empty());
        assert!(is_link(&shared), "the root junction itself stays");
    }

    #[test]
    fn fixb1_a_folder_reached_twice_inside_one_root_is_taken_once() {
        let t = temp("fixb1-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let alpha = skill(&root.join("team"), "alpha");
        link_dir(&root.join("mirror"), &root.join("team"));
        let at = places(&[&root], &[]);
        assert_eq!(kinds(&plan(&at, &[pick(&alpha)]).unwrap()[0]), ["folder"]);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&root.join("team")).is_empty());
    }

    #[test]
    fn fixb2_a_link_inside_a_junctioned_folder_outside_every_root_is_never_removed() {
        let t = temp("fixb2-a");
        let (app, root, repo, shared) = (t.join("app"), t.join("skills"), t.join("team-repo").join("skills"), t.join("shared"));
        let target = skill(&shared, "alpha");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&repo).unwrap();
        // root/team is a junction to a folder outside every root; inside it, alpha links on again.
        link_dir(&repo.join("alpha"), &target);
        link_dir(&root.join("team"), &repo);
        let at = places(&[&root], &[]);
        let shown = root.join("team").join("alpha");
        let plan_of = plan(&at, &[pick(&shown)]).unwrap();
        assert!(plan_of[0].items.is_empty(), "nothing outside the roots is planned: {:?}", plan_of[0].items);
        assert_eq!(plan_of[0].blocked, Some("outside"));
        assert!(plan_of[0].remains.as_deref().is_some_and(|r| same(Path::new(r), &target)), "{:?}", plan_of[0].remains);
        let done = run(&app, &at, &[pick(&shown)]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("skipped", Some("outside")));
        assert!(is_link(&repo.join("alpha")), "the link in the outside folder stays");
        assert_eq!(std::fs::read_to_string(target.join(SKILL_FILE)).unwrap(), "# alpha");
    }

    #[test]
    fn fixb2_a_link_whose_folder_really_sits_in_a_root_is_removed_once() {
        let t = temp("fixb2-b");
        let (app, root, elsewhere) = (t.join("app"), t.join("skills"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(root.join("team")).unwrap();
        let link = root.join("team").join("beta");
        link_dir(&link, &target);
        link_dir(&root.join("mirror"), &root.join("team"));
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&link)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["link"], "the link reached twice is one item: {:?}", plan_of[0].items);
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&link).is_err());
        assert!(target.join(SKILL_FILE).is_file());
    }

    // Stand-in review of 921b6c7, FIX-BEFORE 2: a folder that is deleted is never called "stays".
    #[test]
    fn fix2_an_outside_link_back_into_a_root_never_says_the_deleted_folder_stays() {
        let t = temp("fix2-a");
        let (app, root, repo) = (t.join("app"), t.join("skills"), t.join("team-repo").join("skills"));
        let alpha = skill(&root, "alpha");
        std::fs::create_dir_all(&repo).unwrap();
        // root/team is a junction to a folder outside every root, and its alpha links back to root/alpha.
        link_dir(&repo.join("alpha"), &alpha);
        link_dir(&root.join("team"), &repo);
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder"], "{:?}", plan_of[0].items);
        assert_eq!(plan_of[0].remains, None, "the folder is deleted, so nothing stays");
        assert_eq!(plan_of[0].dangling.len(), 1, "the outside link is named as left pointing at nothing: {:?}", plan_of[0].dangling);
        assert!(same(Path::new(&plan_of[0].dangling[0]), &PathBuf::from(real(&repo)).join("alpha")), "{:?}", plan_of[0].dangling);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&alpha).is_err());
        assert!(is_link(&repo.join("alpha")), "the link outside the roots is never removed");
    }

    // Stand-in review of 921b6c7, FIX-SOON 3: a failed put-back keeps the record that can undo it.
    #[test]
    fn fix2_a_put_back_that_fails_keeps_the_not_done_record_and_the_next_start_restores_it() {
        let t = temp("fix2-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        // The same item twice: the second move finds nothing, and putting the first back fails.
        FAIL_PUT_BACK.with(|f| f.set(true));
        let err = delete(&app, &[a.clone(), a.clone()]).unwrap_err();
        FAIL_PUT_BACK.with(|f| f.set(false));
        assert!(err.starts_with("Nothing was deleted") && err.contains("next start"), "{err}");
        let kept = read(&app).expect("the record that can put alpha back stays");
        assert!(!kept.done && kept.moves.len() == 2, "{:?} {:?}", kept.moves, kept.left);
        recover(&app, &trust(&root));
        assert_eq!(names(&root), ["alpha"], "alpha is back");
        assert!(!app.join(JOURNAL).exists());
    }

    // Fix round 3 (stand-in review of 87d34ec).
    /// What a delete writes before its done mark: the record names the folder it scanned (FIX-5); the
    /// start-up tests run in the real environment, where `root` is no home folder (FIX-7 (2)).
    fn not_done_record(app: &Path, root: &Path) -> PathBuf {
        let aside = skill(root, ".kolux-deleting-1-2-alpha");
        write(app, &Journal { done: false, moves: vec![(root.join("alpha"), aside.clone())], left: vec![], roots: vec![root.to_path_buf()], ..Default::default() }).unwrap();
        aside
    }

    fn log_of(app: &Path) -> String {
        std::fs::read_to_string(app.join("logs").join("kolux.log")).unwrap_or_default()
    }

    #[test]
    fn fix3_start_up_recovery_under_the_lock_puts_a_hidden_skill_back() {
        let t = temp("fix3-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        assert_eq!(startup_recover(&app), Startup::Recovered);
        assert_eq!(names(&root), ["alpha"]);
        assert!(!app.join(JOURNAL).exists());
        assert!(lock(&app).is_ok(), "the lock is released again");
    }

    #[test]
    fn fix3_start_up_recovery_leaves_everything_alone_and_says_so_while_another_instance_holds_the_lock() {
        let t = temp("fix3-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = not_done_record(&app, &root);
        // FIX-4 (6): the other instance is a second handle holding the system lock on the file, not
        // this process's own guard, so the Busy comes from the system lock as it would across processes.
        std::fs::create_dir_all(&app).unwrap();
        let other = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app.join(LOCK)).unwrap();
        other.lock().unwrap();
        assert!(!HELD.lock().unwrap().contains(&app), "nothing in this process holds it");
        assert_eq!(startup_recover(&app), Startup::Skipped);
        assert_eq!(names(&root), [aside.file_name().unwrap().to_string_lossy().into_owned()], "nothing moved");
        assert!(app.join(JOURNAL).exists());
        assert!(log_of(&app).contains("skipped, another instance holds the skill lock"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_start_up_recovery_logs_and_still_recovers_when_the_lock_cannot_be_opened() {
        let t = temp("fix3-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        // A folder where the lock file should be: the lock can never be opened.
        std::fs::create_dir_all(app.join(LOCK)).unwrap();
        assert!(matches!(lock(&app), Err(LockError::Failed(_))));
        assert_eq!(startup_recover(&app), Startup::RecoveredUnlocked);
        assert_eq!(names(&root), ["alpha"], "the skill is not left hidden");
        assert!(!app.join(JOURNAL).exists());
        assert!(log_of(&app).contains("recovering without it"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_a_set_aside_copy_whose_original_came_back_counts_as_stuck_and_nothing_is_overwritten() {
        let t = temp("fix3-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = not_done_record(&app, &root);
        let back = skill(&root, "alpha");
        std::fs::write(back.join(SKILL_FILE), "# new alpha").unwrap();
        recover(&app, &trust(&root));
        assert!(app.join(JOURNAL).exists(), "the record stays, so the hidden copy is not orphaned");
        assert_eq!(std::fs::read_to_string(back.join(SKILL_FILE)).unwrap(), "# new alpha");
        assert!(aside.join(SKILL_FILE).is_file(), "the hidden copy is untouched");
        assert!(log_of(&app).contains("both exist"), "{}", log_of(&app));
        // A later delete is refused rather than writing over the record, and (FIX-4) the error names
        // the cause and both paths instead of asking for a restart that would not help.
        let other = skill(&root, "beta");
        let err = delete(&app, &[other]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("both exist") && err.contains(&back.display().to_string()) && err.contains(&aside.display().to_string()), "{err}");
        assert!(!err.contains("restart"), "{err}");
        assert!(root.join("beta").is_dir());
        // Once the user clears the original, the next start puts the copy back.
        std::fs::remove_dir_all(&back).unwrap();
        recover(&app, &trust(&root));
        assert_eq!(std::fs::read_to_string(root.join("alpha").join(SKILL_FILE)).unwrap(), "# .kolux-deleting-1-2-alpha");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn fix3_a_record_naming_a_copy_that_is_not_next_to_its_original_is_neither_moved_nor_removed() {
        let t = temp("fix3-e");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        // Not done: putting it back would move a folder from outside the skill folders into one.
        // FIX-6 (5): the record names both folders, so only the sibling check can refuse the entry.
        let both = Trust::startup(vec![root.clone(), other.clone()]);
        write(&app, &Journal { done: false, moves: vec![(root.join("alpha"), stray.clone())], left: vec![], roots: vec![root.clone(), other.clone()], ..Default::default() }).unwrap();
        assert!(recover(&app, &both).is_empty(), "FIX-5 (1): not stuck, the entry is dropped");
        assert!(stray.is_dir() && !root.join("alpha").exists());
        assert!(!app.join(JOURNAL).exists(), "the refused entry is dropped with the record, so later deletes go through");
        assert!(log_of(&app).contains("dropped") && log_of(&app).contains("not a copy set aside from"), "{}", log_of(&app));
        // Done: removing it would delete a folder that is not the original's neighbour. AFTER 1
        // (FIX-6): it is dropped from the record at start-up, not reported again at every start.
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), stray.clone())], left: vec![], roots: vec![root.clone(), other.clone()], ..Default::default() }).unwrap();
        recover(&app, &both);
        assert!(stray.is_dir(), "kept");
        assert!(!app.join(JOURNAL).exists());
        assert_eq!(log_of(&app).matches("not a copy set aside from").count(), 2, "{}", log_of(&app));
    }

    // Fix round 4 (stand-in review of 0a444d4).

    /// FIX-SOON 1: the fix3_e fixture, then a delete. The refused entry used to be carried into the
    /// new record's `left` list, which is checked by name alone, and removed from `elsewhere`.
    #[test]
    fn fix4_a_refused_record_entry_is_dropped_by_the_next_delete_and_only_exact_set_aside_copies_next_to_their_originals_go() {
        let t = temp("fix4-a");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        let plain = skill(&other, "plain");
        let beta = skill(&root, "beta");
        // FIX-6 (5), FIX-7 AFTER 2: the delete helper scans only `root`, so `other` is no skill folder
        // here and the root check would refuse both entries as well; but `verdict` checks the name and
        // the sibling first, so the asserted reasons below are the sibling check (stray) and the name
        // check (plain). No start-up recovery first: since AFTER 1 (FIX-6) that would drop them itself.
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), stray.clone())], left: vec![plain.clone()], roots: vec![root.clone(), other.clone()], ..Default::default() }).unwrap();
        assert_eq!(delete(&app, &[beta]).unwrap(), Outcome::Deleted);
        assert_eq!(names(&other), [".kolux-deleting-1-2-alpha", "plain"], "neither refused entry was removed");
        assert!(names(&root).is_empty(), "the chosen skill is gone");
        assert!(!app.join(JOURNAL).exists(), "the refused entries are dropped, not carried");
        let log = log_of(&app);
        assert!(log.contains(&format!("dropped {} from the record and left it alone, it is not a copy set aside from {}", stray.display(), root.join("alpha").display())), "{log}");
        assert!(log.contains(&format!("dropped {} from the record and left it alone, it is not a copy this app set aside", plain.display())), "{log}");
        assert!(!log.contains("not under a skill folder"), "the root check never got to refuse them: {log}");
    }

    /// FIX-4 FIX-SOON 2, then FIX-5 FIX-SOON 1: a refused entry in a NOT-done record can never be put
    /// back, so it is dropped from the record (logged, left on disk) and a later delete goes through,
    /// instead of every delete failing until the user acts on a folder outside the skill folders.
    #[test]
    fn fix5_a_refused_entry_in_a_not_done_record_is_dropped_and_a_later_delete_goes_through() {
        let t = temp("fix4-b");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        let from = root.join("alpha");
        write(&app, &Journal { done: false, moves: vec![(from.clone(), stray.clone())], left: vec![], roots: vec![], ..Default::default() }).unwrap();
        let beta = skill(&root, "beta");
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        assert!(names(&root).is_empty(), "the chosen skill is gone");
        assert!(stray.is_dir() && !from.exists(), "the refused entry is neither put back nor removed");
        assert!(!app.join(JOURNAL).exists(), "the refused entry is dropped with the record");
        let log = log_of(&app);
        assert!(log.contains(&format!("dropped {} from the record", stray.display())) && log.contains(&from.display().to_string()), "{log}");
        assert!(!log.contains("remove"), "no line tells the user to remove a folder the app does not vouch for: {log}");
    }

    // Fix round 5 (stand-in review of ed8df8ed).

    /// FIX-SOON 3 (I/O): a record another program holds is reported with the OS error and "try
    /// again", never as a file to move away (moving it would strand the hidden skills it names).
    #[cfg(windows)]
    #[test]
    fn fix5_c_a_record_that_cannot_be_read_names_the_os_error_and_says_try_again() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix5-c1");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        let beta = skill(&root, "beta");
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(app.join(JOURNAL)).unwrap();
        let err = delete(&app, std::slice::from_ref(&beta)).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("could not be read") && err.contains("try again") && err.contains(&app.join(JOURNAL).display().to_string()), "{err}");
        assert!(!err.contains("move that file away") && !err.contains("damaged"), "{err}");
        assert_eq!(names(&root), [".kolux-deleting-1-2-alpha", "beta"], "nothing moved");
        drop(held);
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted), "the same request goes through once the file is free");
        assert_eq!(names(&root), ["alpha"], "the hidden skill came back first");
    }

    /// FIX-SOON 3 (parse): a damaged record is named as such, and the message says that folders
    /// named `.kolux-deleting-*` in the skill folders are hidden skills to rename back by hand.
    #[test]
    fn fix5_c_a_damaged_record_says_so_and_names_the_hidden_folders_to_rename_back() {
        let t = temp("fix5-c2");
        let (app, root) = (t.join("app"), t.join("skills"));
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join(JOURNAL), "{not json").unwrap();
        let beta = skill(&root, "beta");
        let err = delete(&app, std::slice::from_ref(&beta)).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("damaged") && err.contains(&app.join(JOURNAL).display().to_string()), "{err}");
        assert!(err.contains(ASIDE) && err.contains("rename"), "{err}");
        assert!(!err.contains("could not be read") && !err.contains("try again"), "{err}");
        assert!(root.join("beta").is_dir() && app.join(JOURNAL).exists());
        assert_eq!(startup_recover(&app), Startup::Recovered, "start-up logs the damaged record and goes on");
        assert!(log_of(&app).contains("damaged"), "{}", log_of(&app));
    }

    /// FIX-SOON 3 (rewrite): a not-done record whose copies were all put back but which could not be
    /// removed is retried and reported as such; it is never called unreadable (it reads fine).
    #[cfg(windows)]
    #[test]
    fn fix5_c_a_record_cleared_but_not_rewritten_is_retried_and_never_called_unreadable() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix5-c3");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        let beta = skill(&root, "beta");
        // Readable, but not removable or replaceable: the holder shares reads only.
        let held = std::fs::OpenOptions::new().read(true).share_mode(1).open(app.join(JOURNAL)).unwrap();
        let err = delete(&app, std::slice::from_ref(&beta)).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("could not be removed") && err.contains("try again"), "{err}");
        assert!(!err.contains("cannot be read") && !err.contains("could not be read") && !err.contains("damaged"), "{err}");
        assert_eq!(names(&root), ["alpha", "beta"], "the hidden skill was put back, only the record is in the way");
        assert!(app.join(JOURNAL).exists());
        drop(held);
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        assert_eq!(names(&root), ["alpha"]);
        assert!(!app.join(JOURNAL).exists());
    }

    /// FIX-SOON 2: a copy with the exact set-aside form, next to its original, is still never removed
    /// when it does not sit under a skill folder the record names; a record naming no skill folders
    /// (an older one) removes nothing; one under the named folder is removed.
    #[test]
    fn fix5_b_a_set_aside_copy_outside_every_skill_folder_on_record_is_never_removed() {
        let t = temp("fix5-b");
        let (app, root, work) = (t.join("app"), t.join("skills"), t.join("work"));
        let src_copy = skill(&work, ".kolux-deleting-1-2-src");
        let doc_copy = skill(&work, ".kolux-deleting-1-2-doc");
        // A damaged or hand-edited done record: both entries pass the name and sibling checks.
        write(&app, &Journal { done: true, moves: vec![(work.join("doc"), doc_copy.clone())], left: vec![src_copy.clone()], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert!(src_copy.is_dir() && doc_copy.is_dir(), "start-up removes neither");
        assert!(!app.join(JOURNAL).exists(), "AFTER 1: both are dropped at start-up, and the record with them");
        let log = log_of(&app);
        assert_eq!(log.matches("dropped").count(), 2, "{log}");
        assert_eq!(log.matches("not under a skill folder").count(), 2, "{log}");
        // The next delete still removes nothing in `work`.
        let beta = skill(&root, "beta");
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        assert!(src_copy.is_dir() && doc_copy.is_dir() && names(&root).is_empty());
        assert!(!app.join(JOURNAL).exists());
        assert_eq!(log_of(&app).matches("dropped").count(), 2, "{}", log_of(&app));
        // The same form under the named skill folder is removed.
        let mine = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![], left: vec![mine.clone()], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert!(!mine.exists() && !app.join(JOURNAL).exists());
        // An older record names no skill folders and so vouches for nothing: dropped, left on disk.
        let older = skill(&root, ".kolux-deleting-1-2-older");
        write(&app, &Journal { done: true, moves: vec![], left: vec![older.clone()], roots: vec![], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert!(older.is_dir() && !app.join(JOURNAL).exists());
        // What `run` writes names the scanned folders, so its own copies are removed (see every
        // other delete test); a copy carried from an earlier record keeps that record's folders.
        assert!(under_root(&mine, std::slice::from_ref(&root)) && !under_root(&src_copy, std::slice::from_ref(&root)) && !under_root(&mine, &[]));
    }

    /// AFTER 3, then FIX-6 AFTER 4: "dropped ... from the record" is logged only once the record was
    /// really rewritten without the entry. Here every record write fails (a folder sits where the
    /// record's temporary file goes), both at start-up recovery and in the delete itself, so the
    /// entry is reported as refused, not dropped, until a write goes through.
    #[test]
    fn fix5_d_a_drop_is_logged_only_after_the_record_was_rewritten() {
        let t = temp("fix5-d");
        let (app, root, other, ws) = (t.join("app"), t.join("skills"), t.join("elsewhere"), t.join("repo").join(".claude").join("skills"));
        let plain = skill(&other, "plain");
        // A vouched-for copy under a workspace skills folder the delete does not scan keeps the record
        // alive (FIX-6 (2)), so dropping `plain` needs a rewrite, not a removal of the record.
        let idle = skill(&ws, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![], left: vec![plain.clone(), idle.clone()], roots: vec![root.clone(), other.clone(), ws.clone()], ..Default::default() }).unwrap();
        let beta = skill(&root, "beta");
        std::fs::create_dir_all(app.join(JOURNAL).with_extension("json.tmp")).unwrap();
        let err = delete(&app, std::slice::from_ref(&beta)).unwrap_err();
        assert!(err.contains("record could not be written"), "{err}");
        let log = log_of(&app);
        assert!(!log.contains("dropped"), "the record still holds the entry, so nothing was dropped yet: {log}");
        assert!(log.contains(&format!("refused to remove {}", plain.display())) && log.contains("could not be rewritten"), "{log}");
        // FIX-9 AFTER 2: the failed record write is a way out of the delete too: the kept entry is
        // said, and the refused one is said once (by the rewrite that failed), not twice.
        assert!(log.contains(&format!("kept {} on the record and left it alone for now", idle.display())), "{log}");
        assert_eq!(log.matches(&plain.display().to_string()).count(), 1, "one line for the refused entry: {log}");
        assert!(!log.contains("stays on the record for now"), "{log}");
        assert!(beta.is_dir() && plain.is_dir() && idle.is_dir() && app.join(JOURNAL).exists());
        std::fs::remove_dir(app.join(JOURNAL).with_extension("json.tmp")).unwrap();
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        let log = log_of(&app);
        assert_eq!(log.matches("dropped").count(), 1, "{log}");
        assert!(log.contains(&format!("kept {} on the record", idle.display())), "{log}");
        assert!(plain.is_dir() && idle.is_dir() && names(&root).is_empty());
        let kept = read(&app).expect("the kept copy stays on record");
        assert!(kept.done && kept.left == [idle.clone()] && kept.roots.iter().any(|r| same(r, &ws)), "{:?} {:?}", kept.left, kept.roots);
        // The next start acts on a workspace skills folder by shape and clears it.
        recover(&app, &trust(&root));
        assert!(!idle.exists() && !app.join(JOURNAL).exists());
    }

    /// AFTER 5: a stuck record is checked once per request, not once per chosen skill: every skill
    /// gets the same answer and the log says it once. (The stuck case here is "both exist", which
    /// makes no rename retries; that the put-back retries are paid once follows from the one call.)
    #[test]
    fn fix5_e_a_stuck_record_is_checked_once_per_request_not_once_per_skill() {
        let t = temp("fix5-e");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        skill(&root, "alpha"); // the original came back: both exist, so the record is stuck
        let (beta, gamma) = (skill(&root, "beta"), skill(&root, "gamma"));
        let done = run(&app, &places(&[&root], &[]), &[pick(&beta), pick(&gamma)]).unwrap();
        assert_eq!(done.iter().map(|d| d.outcome).collect::<Vec<_>>(), ["failed", "failed"]);
        assert!(done[0].note.as_deref().is_some_and(|n| n.contains("both exist")) && done[0].note == done[1].note, "{done:?}");
        assert_eq!(log_of(&app).matches("both exist").count(), 1, "{}", log_of(&app));
        assert!(beta.is_dir() && gamma.is_dir());
    }

    /// FIX-SOON 2 (put-back case): the error says what could not be put back, and where.
    #[cfg(windows)]
    #[test]
    fn fix4_a_delete_behind_a_failed_put_back_names_the_copy_and_its_place() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix4-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        FAIL_PUT_BACK.with(|f| f.set(true));
        assert!(delete(&app, &[a.clone(), a.clone()]).is_err());
        FAIL_PUT_BACK.with(|f| f.set(false));
        let aside = read(&app).expect("the not-done record stays").moves[0].1.clone();
        assert!(aside.is_dir(), "alpha is still set aside as {}", aside.display());
        // Another program holds a file in the copy, so the put-back at the next delete fails too.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(aside.join(SKILL_FILE)).unwrap();
        let beta = skill(&root, "beta");
        let err = delete(&app, &[beta]).unwrap_err();
        assert!(err.contains("could not be put back as") && err.contains(&a.display().to_string()) && err.contains(&aside.display().to_string()), "{err}");
        assert!(root.join("beta").is_dir() && aside.is_dir());
        drop(held);
        assert!(recover(&app, &trust(&root)).is_empty());
        assert_eq!(names(&root), ["alpha", "beta"]);
    }

    /// AFTER 2: a copy is the original's only when its name is exactly `.kolux-deleting-<pid>-<nanos>-<name>`.
    #[test]
    fn fix4_a_copy_named_after_a_longer_name_is_not_the_originals_copy() {
        let root = Path::new("C:\\s");
        let alpha = root.join("alpha");
        assert!(aside_of(&alpha, &root.join(".kolux-deleting-1-2-alpha")));
        assert!(aside_of(&alpha, &root.join(".kolux-deleting-4294967295-1760000000000000000-alpha")));
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-2-xalpha")), "ends with the name but is another skill's copy");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-x-2-alpha")), "no stamp");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-alpha")), "half a stamp");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-2-alpha-x")));
        assert!(!aside_of(&alpha, &Path::new("C:\\t").join(".kolux-deleting-1-2-alpha")), "not next to the original");
        assert!(set_aside_name(&root.join(".kolux-deleting-1-2-old")) && set_aside_name(&root.join(".kolux-deleting-1-2-a-b")));
        assert!(!set_aside_name(&root.join(".kolux-deleting-1-2-")) && !set_aside_name(&root.join(".kolux-deleting-old")) && !set_aside_name(&root.join("plain")));
        // On disk: a not-done record naming xalpha's copy as alpha's is refused, and xalpha's copy is not renamed to alpha.
        let t = temp("fix4-d");
        let (app, skills) = (t.join("app"), t.join("skills"));
        let copy = skill(&skills, ".kolux-deleting-1-2-xalpha");
        write(&app, &Journal { done: false, moves: vec![(skills.join("alpha"), copy.clone())], left: vec![], roots: vec![], ..Default::default() }).unwrap();
        assert!(recover(&app, &trust(&skills)).is_empty(), "FIX-5 (1): dropped, not stuck");
        assert_eq!(names(&skills), [".kolux-deleting-1-2-xalpha"], "not moved");
        assert!(!app.join(JOURNAL).exists() && log_of(&app).contains("dropped"), "{}", log_of(&app));
        // Done: not removed either. FIX-6 (5): the record names the folder, so only the name check
        // refuses it; AFTER 1: the refused entry is dropped at start-up and the record goes with it.
        write(&app, &Journal { done: true, moves: vec![(skills.join("alpha"), copy.clone())], left: vec![], roots: vec![skills.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&skills));
        assert!(copy.is_dir() && !app.join(JOURNAL).exists());
        assert!(log_of(&app).contains(&format!("dropped {} from the record and left it alone, it is not a copy set aside from", copy.display())), "{}", log_of(&app));
    }

    // Fix round 6 (stand-in review of efa2f15a).

    /// FIX-6 (3): a skill folder a record names counts only when it is an absolute folder that exists.
    /// An empty one would match every path, a relative one whatever folder the process runs in.
    #[test]
    fn fix6_a_an_empty_relative_or_missing_root_vouches_for_nothing() {
        let t = temp("fix6-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        let copy = skill(&root, ".kolux-deleting-1-2-alpha");
        assert!(under_root(&copy, std::slice::from_ref(&root)), "the real folder counts");
        assert!(!under_root(&copy, &[PathBuf::from("")]), "empty");
        assert!(!under_root(&copy, &[PathBuf::from("skills")]), "relative");
        assert!(!under_root(&copy, &[PathBuf::from(".")]), "relative, the working folder");
        assert!(!under_root(&copy, &[t.join("missing")]), "not on disk");
        assert!(!under_root(&copy, &[PathBuf::from(""), PathBuf::from("skills"), t.join("missing")]), "none of them");
        // On disk, each as a hand-edited record: the copy stays, the record is dropped and the log says why.
        // FIX-7 AFTER 2: this half would still pass without `usable_root` (`classify` of a bad root is
        // not Live either way); only the direct `under_root` asserts above isolate that guard.
        for (i, bad) in ["", "skills", ".", &t.join("missing").display().to_string()].iter().enumerate() {
            std::fs::create_dir_all(&app).unwrap();
            std::fs::write(app.join(JOURNAL), serde_json::json!({ "done": true, "moves": [], "left": [copy], "roots": [bad] }).to_string()).unwrap();
            recover(&app, &trust(&root));
            assert!(copy.is_dir(), "root {bad:?} must not make the app remove the copy");
            assert!(!app.join(JOURNAL).exists(), "root {bad:?}: dropped");
            assert_eq!(log_of(&app).matches("not under a skill folder this app scans").count(), i + 1, "root {bad:?}: {}", log_of(&app));
        }
    }

    /// FIX-6 (4), FIX-SOON 1 scenario A: at start-up only the home skill folders of this environment
    /// and folders shaped like a workspace skills folder count; a record naming any other folder
    /// never makes the app remove anything under it.
    #[test]
    fn fix6_b_start_up_acts_only_on_home_skill_folders_and_workspace_shaped_ones() {
        let t = temp("fix6-b");
        let (app, home, work) = (t.join("app"), t.join("home"), t.join("work"));
        let claude = home.join(".claude").join("skills");
        let ws = t.join("repo").join(".agents").join("skills");
        let in_home = skill(&claude, ".kolux-deleting-1-2-a");
        let in_ws = skill(&ws, ".kolux-deleting-1-2-b");
        let in_work = skill(&work, ".kolux-deleting-1-2-c");
        let live = skills::home_roots(&env(&home));
        assert!(live.iter().any(|r| same(r, &claude)), "{live:?}");
        assert_eq!(classify(&claude, &live), RootClass::Live);
        assert_eq!(classify(&ws, &live), RootClass::Idle);
        assert_eq!(classify(&work, &live), RootClass::Bogus, "an existing folder that is no skill folder");
        assert_eq!(classify(&t.join("repo").join(".claude"), &live), RootClass::Bogus, "shape needs the skills folder itself");
        write(&app, &Journal { done: true, moves: vec![], left: vec![in_home.clone(), in_ws.clone(), in_work.clone()], roots: vec![claude.clone(), ws.clone(), work.clone()], ..Default::default() }).unwrap();
        assert_eq!(startup_recover_as(&app, &Trust::startup(live)), Startup::Recovered);
        assert!(!in_home.exists() && !in_ws.exists(), "the home and workspace-shaped copies go");
        assert!(in_work.is_dir(), "the copy under a plain folder stays, whatever the record says");
        assert!(!app.join(JOURNAL).exists(), "dropped, so it is not reported again at every start");
        assert!(log_of(&app).contains(&format!("dropped {} from the record and left it alone, it is not under a skill folder this app scans", in_work.display())), "{}", log_of(&app));
    }

    /// FIX-6 (2): a delete carries a leftover only when it sits under a folder the delete scans; one
    /// under a workspace skills folder it does not scan stays on the record, untouched and logged,
    /// and the next start clears it. One under a folder that is no skill folder is dropped.
    #[test]
    fn fix6_c_a_delete_keeps_a_leftover_from_a_workspace_it_does_not_scan_and_drops_one_from_elsewhere() {
        let t = temp("fix6-c");
        let (app, root, work) = (t.join("app"), t.join("skills"), t.join("work"));
        let ws = t.join("repo").join(".claude").join("skills");
        let mine = skill(&root, ".kolux-deleting-1-2-old");
        let idle = skill(&ws, ".kolux-deleting-1-2-ws");
        let stray = skill(&work, ".kolux-deleting-1-2-elsewhere");
        write(&app, &Journal { done: true, moves: vec![], left: vec![mine.clone(), idle.clone(), stray.clone()], roots: vec![root.clone(), ws.clone(), work.clone()], ..Default::default() }).unwrap();
        let beta = skill(&root, "beta");
        let done = run(&app, &places(&[&root], &[]), &[pick(&beta)]).unwrap();
        assert_eq!(done[0].outcome, "deleted", "{done:?}");
        assert!(!mine.exists() && names(&root).is_empty(), "the carried copy under the scanned folder goes with the delete");
        assert!(idle.is_dir() && stray.is_dir());
        let kept = read(&app).expect("the record stays for the kept copy");
        assert!(kept.done && kept.moves.is_empty() && kept.left == [idle.clone()], "{:?} {:?}", kept.moves, kept.left);
        assert!(kept.roots.iter().any(|r| same(r, &ws)) && !kept.roots.iter().any(|r| same(r, &work)), "{:?}", kept.roots);
        let log = log_of(&app);
        assert!(log.contains(&format!("kept {} on the record and left it alone for now, it is under {}", idle.display(), ws.display())), "{log}");
        assert!(log.contains(&format!("dropped {} from the record and left it alone, it is not under a skill folder this app scans", stray.display())), "{log}");
        assert!(!log.contains("refused to remove"), "{log}");
        assert_eq!(log.matches("kept").count(), 1, "FIX-7 AFTER 1: one delete says it once: {log}");
        assert_eq!(log.matches("dropped").count(), 1, "{log}");
        recover(&app, &trust(&root));
        assert!(!idle.exists() && stray.is_dir() && !app.join(JOURNAL).exists(), "the next start clears the kept copy");
    }

    /// FIX-6 (5): with the folder on record, a wrongly named `left` entry is refused by the name check
    /// alone: kept on disk, taken off the record, logged. The exact form next to it is removed.
    #[test]
    fn fix6_d_a_wrongly_named_left_entry_under_a_recorded_folder_is_kept_and_logged() {
        let t = temp("fix6-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let no_stamp = skill(&root, ".kolux-deleting-old");
        let no_name = skill(&root, ".kolux-deleting-1-2-");
        let exact = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![], left: vec![no_stamp.clone(), no_name.clone(), exact.clone()], roots: vec![root.clone()], ..Default::default() }).unwrap();
        recover(&app, &trust(&root));
        assert_eq!(names(&root), [".kolux-deleting-1-2-", ".kolux-deleting-old"], "only the exact form went");
        assert!(!app.join(JOURNAL).exists());
        let log = log_of(&app);
        for p in [&no_stamp, &no_name] {
            assert!(log.contains(&format!("dropped {} from the record and left it alone, it is not a copy this app set aside", p.display())), "{log}");
        }
        assert!(!log.contains(&exact.display().to_string()), "{log}");
    }

    /// AFTER 3 (FIX-6): a not-done record that names its skill folders puts a copy back only when it
    /// sits under one that counts; FIX-7 (2): an older record without them does so only under a live
    /// or workspace-shaped skill folder.
    #[test]
    fn fix6_e_a_not_done_record_puts_back_only_under_a_skill_folder_it_names() {
        let t = temp("fix6-e");
        let (app, root, work) = (t.join("app"), t.join("skills"), t.join("work"));
        let stray = skill(&work, ".kolux-deleting-1-2-alpha");
        write(&app, &Journal { done: false, moves: vec![(work.join("alpha"), stray.clone())], left: vec![], roots: vec![root.clone()], ..Default::default() }).unwrap();
        assert!(recover(&app, &trust(&root)).is_empty(), "dropped, not stuck");
        assert!(stray.is_dir() && !work.join("alpha").exists(), "not renamed");
        assert!(!app.join(JOURNAL).exists());
        assert!(log_of(&app).contains(&format!("dropped {} from the record and left it alone, it is not under a skill folder this app scans", stray.display())), "{}", log_of(&app));
        // A workspace skills folder the delete did not scan still puts back: a put-back is a rename.
        let ws = t.join("repo").join(".claude").join("skills");
        let hidden = skill(&ws, ".kolux-deleting-1-2-beta");
        write(&app, &Journal { done: false, moves: vec![(ws.join("beta"), hidden.clone())], left: vec![], roots: vec![root.clone(), ws.clone()], ..Default::default() }).unwrap();
        assert!(recover(&app, &Trust::delete(std::slice::from_ref(&root))).is_empty());
        assert!(ws.join("beta").is_dir() && !hidden.exists() && !app.join(JOURNAL).exists());
        // An older record names no folders: FIX-7 (2) it puts back only under a skill folder (see
        // fix7_c); a copy in a plain folder is dropped, as it is with a record that names folders.
        write(&app, &Journal { done: false, moves: vec![(work.join("alpha"), stray.clone())], left: vec![], roots: vec![], ..Default::default() }).unwrap();
        assert!(recover(&app, &trust(&root)).is_empty());
        assert!(stray.is_dir() && !work.join("alpha").exists() && !app.join(JOURNAL).exists());
    }

    // Fix round 7 (stand-in review of d9e2c699).

    /// FIX-7 (1), not-done half: a delete in a skill folder that has stopped being a home folder (here
    /// a Hermes folder: the app-data one appeared since) crashed before its done mark. The hidden copy
    /// is put back at the next start, because the root it recorded is an existing skills folder.
    #[test]
    fn fix7_a_a_not_done_put_back_goes_through_when_its_recorded_root_is_no_longer_a_home_root() {
        let t = temp("fix7-a");
        let (app, home) = (t.join("app"), t.join("home"));
        let old = home.join(".hermes").join("skills");
        let aside = skill(&old, ".kolux-deleting-1-2-alpha");
        std::fs::create_dir_all(env(&home).local_app_data.unwrap().join("hermes")).unwrap();
        let live = skills::home_roots(&env(&home));
        assert!(!live.iter().any(|l| same(l, &old)), "the old Hermes folder is not a home root now: {live:?}");
        write(&app, &Journal { done: false, moves: vec![(old.join("alpha"), aside.clone())], left: vec![], roots: vec![old.clone()], ..Default::default() }).unwrap();
        assert_eq!(startup_recover_as(&app, &Trust::startup(live.clone())), Startup::Recovered);
        assert_eq!(names(&old), ["alpha"], "the skill is back under its own name");
        assert!(!app.join(JOURNAL).exists());
        assert!(!log_of(&app).contains("dropped"), "{}", log_of(&app));
        // A root that is no skills folder at all still puts nothing back: the copy is dropped.
        let work = t.join("work");
        let stray = skill(&work, ".kolux-deleting-1-2-beta");
        write(&app, &Journal { done: false, moves: vec![(work.join("beta"), stray.clone())], left: vec![], roots: vec![work.clone()], ..Default::default() }).unwrap();
        assert!(recover(&app, &Trust::startup(live)).is_empty());
        assert!(stray.is_dir() && !work.join("beta").exists() && !app.join(JOURNAL).exists());
    }

    /// FIX-7 (1), done half: a finished delete's leftover under such a root is not dropped from the
    /// record, at start-up or in a later delete: it stays, untouched, with its root, and is said once.
    #[test]
    fn fix7_b_a_done_entry_under_a_root_that_is_no_longer_a_home_root_is_kept_not_dropped() {
        let t = temp("fix7-b");
        let (app, home, root) = (t.join("app"), t.join("home"), t.join("skills"));
        let old = home.join(".hermes").join("skills");
        let hidden = skill(&old, ".kolux-deleting-1-2-alpha");
        std::fs::create_dir_all(env(&home).local_app_data.unwrap().join("hermes")).unwrap();
        let live = skills::home_roots(&env(&home));
        assert!(!live.iter().any(|l| same(l, &old)), "{live:?}");
        write(&app, &Journal { done: true, moves: vec![(old.join("alpha"), hidden.clone())], left: vec![], roots: vec![old.clone()], ..Default::default() }).unwrap();
        assert_eq!(startup_recover_as(&app, &Trust::startup(live)), Startup::Recovered);
        assert!(hidden.is_dir(), "nothing outside a skill folder the app scans is removed");
        let kept = read(&app).expect("the record keeps the entry");
        assert!(kept.done && kept.moves == [(old.join("alpha"), hidden.clone())] && kept.roots.iter().any(|r| same(r, &old)), "{:?} {:?}", kept.moves, kept.roots);
        let log = log_of(&app);
        assert_eq!(log.matches("kept").count(), 1, "{log}");
        assert!(!log.contains("dropped"), "{log}");
        // A later delete elsewhere carries it, with its root, and does not block on it.
        let beta = skill(&root, "beta");
        assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
        assert!(hidden.is_dir());
        let kept = read(&app).expect("still on the record after a delete");
        assert!(kept.left == [hidden.clone()] && kept.roots.iter().any(|r| same(r, &old)), "{:?} {:?}", kept.left, kept.roots);
        assert!(!log_of(&app).contains("dropped"), "{}", log_of(&app));
        // Once that folder is a home root again, the entry is removed as any other.
        recover(&app, &Trust::startup(vec![old.clone()]));
        assert!(!hidden.exists() && !app.join(JOURNAL).exists());
    }

    /// FIX-7 (2): a record without skill folders (an older one) puts a copy back only when it sits in
    /// a folder scanned right now or one shaped like a workspace skills folder; a hand-edited one
    /// naming any other folder renames nothing.
    #[test]
    fn fix7_c_a_roots_less_not_done_record_puts_back_only_under_a_live_or_shaped_skill_folder() {
        let t = temp("fix7-c");
        let (app, root, work) = (t.join("app"), t.join("skills"), t.join("work"));
        let ws = t.join("repo").join(".agents").join("skills");
        let rootless = |from: PathBuf, aside: &Path| write(&app, &Journal { done: false, moves: vec![(from, aside.to_path_buf())], left: vec![], roots: vec![], ..Default::default() }).unwrap();
        // Live folder: put back.
        let a = skill(&root, ".kolux-deleting-1-2-alpha");
        rootless(root.join("alpha"), &a);
        assert!(recover(&app, &trust(&root)).is_empty());
        assert!(root.join("alpha").is_dir() && !a.exists() && !app.join(JOURNAL).exists());
        // Shaped workspace folder, not scanned now: put back.
        let b = skill(&ws, ".kolux-deleting-1-2-beta");
        rootless(ws.join("beta"), &b);
        assert!(recover(&app, &trust(&root)).is_empty());
        assert!(ws.join("beta").is_dir() && !b.exists());
        // Any other folder: not renamed, dropped from the record, said in the log.
        let c = skill(&work, ".kolux-deleting-1-2-gamma");
        rootless(work.join("gamma"), &c);
        assert!(recover(&app, &trust(&root)).is_empty());
        assert!(c.is_dir() && !work.join("gamma").exists() && !app.join(JOURNAL).exists());
        assert!(log_of(&app).contains(&format!("dropped {} from the record and left it alone, it is not under a skill folder this app scans", c.display())), "{}", log_of(&app));
        // The hand-edited record from the review: a same-folder rename in a plain folder.
        let d = skill(&work, ".kolux-deleting-1-2-foo");
        std::fs::write(app.join(JOURNAL), serde_json::json!({ "done": false, "moves": [[work.join("foo"), d]] }).to_string()).unwrap();
        recover(&app, &trust(&root));
        assert!(d.is_dir() && !work.join("foo").exists());
    }

    /// FIX-7 AFTER 3: the workspace shape is judged on where the folder really is. A folder written
    /// as `.../.claude/skills` that is a link to somewhere else is no workspace skills folder, so a
    /// start-up record cannot make the app remove set-aside look-alikes from the linked place.
    #[test]
    fn fix7_d_a_linked_folder_written_in_workspace_shape_is_not_a_workspace_skills_folder() {
        let t = temp("fix7-d");
        let (app, root, target) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let look_alike = skill(&target, ".kolux-deleting-1-2-alpha");
        let dot_claude = t.join("repo").join(".claude");
        std::fs::create_dir_all(&dot_claude).unwrap();
        let linked = dot_claude.join("skills");
        link_dir(&linked, &target);
        let live = vec![root.clone()];
        assert!(skills::workspace_skills_shape(&linked) && usable_root(&linked));
        assert_eq!(classify(&linked, &live), RootClass::Bogus, "the shape and the name are judged on the real folder");
        write(&app, &Journal { done: true, moves: vec![], left: vec![look_alike.clone()], roots: vec![linked.clone()], ..Default::default() }).unwrap();
        recover(&app, &Trust::startup(live));
        assert!(look_alike.is_dir(), "not removed through the link");
        // The same shape as a real folder is still a workspace skills folder.
        let real_ws = t.join("repo2").join(".claude").join("skills");
        std::fs::create_dir_all(&real_ws).unwrap();
        assert_eq!(classify(&real_ws, std::slice::from_ref(&root)), RootClass::Idle);
        // FIX-8 FIX-SOON 1, not-done half: a record naming that link as its skills folder puts nothing
        // back through it (it would rename inside `elsewhere`, which is no skills folder); the copy
        // is dropped, left on disk, and the log says how to put it back by hand.
        write(&app, &Journal { done: false, moves: vec![(target.join("alpha"), look_alike.clone())], left: vec![], roots: vec![linked.clone()], ..Default::default() }).unwrap();
        assert!(recover(&app, &Trust::startup(vec![root.clone()])).is_empty(), "dropped, not stuck");
        assert!(look_alike.is_dir() && !target.join("alpha").exists(), "not renamed through the link");
        assert!(!app.join(JOURNAL).exists());
        let log = log_of(&app);
        assert!(log.contains(&format!("dropped {} from the record and left it alone, it is not under a skill folder this app scans", look_alike.display())), "{log}");
        assert!(log.contains(&format!("{} is a link to a folder that is not named skills", linked.display())) && log.contains("look in the skill folders for folders named .kolux-deleting-"), "{log}");
        // A link written as skills that leads to a folder really named skills is still a skills folder.
        let (real_skills, via) = (t.join("real").join("skills"), t.join("via"));
        std::fs::create_dir_all(&real_skills).unwrap();
        std::fs::create_dir_all(&via).unwrap();
        link_dir(&via.join("skills"), &real_skills);
        assert_eq!(classify(&via.join("skills"), std::slice::from_ref(&root)), RootClass::Stale);
        let held = skill(&real_skills, ".kolux-deleting-1-2-gamma");
        write(&app, &Journal { done: false, moves: vec![(real_skills.join("gamma"), held.clone())], left: vec![], roots: vec![via.join("skills")], ..Default::default() }).unwrap();
        assert!(recover(&app, &Trust::startup(vec![root])).is_empty());
        assert!(real_skills.join("gamma").is_dir() && !held.exists(), "put back through a link whose real folder is named skills");
    }

    /// Earlier AFTER 10: the delete acts on the path the list showed; if a link in that path was
    /// swapped after the plan, the item now sits outside the folders the delete scanned and nothing
    /// is renamed.
    #[test]
    fn fix7_e_an_item_that_no_longer_sits_in_a_scanned_folder_is_not_renamed() {
        let t = temp("fix7-e");
        let (app, root, elsewhere) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let mine = skill(&root, "alpha");
        let theirs = skill(&elsewhere, "beta");
        let _one = lock(&app).unwrap();
        let settled = settle(&app, std::slice::from_ref(&root)).unwrap();
        let err = delete_held(&app, settled, &[mine.clone(), theirs.clone()]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains(&theirs.display().to_string()) && err.contains("refresh the list"), "{err}");
        assert!(mine.is_dir() && theirs.is_dir() && !app.join(JOURNAL).exists(), "nothing moved, no record written");
        let settled = settle(&app, std::slice::from_ref(&root)).unwrap();
        assert_eq!(delete_held(&app, settled, std::slice::from_ref(&mine)), Ok(Outcome::Deleted));
    }

    // Fix round 8 (stand-in review of ccb2b3e0).

    /// FIX-8 AFTER 1: a leftover kept because its skills folder is not scanned is counted at each
    /// start-up (said once per start); a delete in between neither counts nor says it. At the
    /// `STALE_STARTS`th start it is taken off the record, left on disk, and the hint is logged.
    #[test]
    fn fix8_b_a_stale_leftover_is_kept_for_a_few_starts_then_dropped_with_the_hint() {
        let t = temp("fix8-b");
        let (app, home, root) = (t.join("app"), t.join("home"), t.join("skills"));
        let old = home.join(".hermes").join("skills");
        let hidden = skill(&old, ".kolux-deleting-1-2-alpha");
        std::fs::create_dir_all(env(&home).local_app_data.unwrap().join("hermes")).unwrap();
        let live = skills::home_roots(&env(&home));
        assert!(!live.iter().any(|l| same(l, &old)), "{live:?}");
        write(&app, &Journal { done: true, moves: vec![(old.join("alpha"), hidden.clone())], left: vec![], roots: vec![old.clone()], ..Default::default() }).unwrap();
        for n in 1..STALE_STARTS {
            assert_eq!(startup_recover_as(&app, &Trust::startup(live.clone())), Startup::Recovered);
            assert_eq!(read(&app).expect("still on the record").stale_counts, [(hidden.clone(), n)]);
            assert_eq!(log_of(&app).matches("kept").count(), n as usize, "one kept line per start: {}", log_of(&app));
            if n == 2 {
                // A delete elsewhere carries it, says nothing about it and does not count it.
                let beta = skill(&root, "beta");
                assert_eq!(delete(&app, &[beta]), Ok(Outcome::Deleted));
                let kept = read(&app).expect("still on the record after a delete");
                assert!(kept.left == [hidden.clone()] && kept.stale_counts == [(hidden.clone(), 2)], "{:?} {:?}", kept.left, kept.stale_counts);
                assert_eq!(log_of(&app).matches("kept").count(), 2, "{}", log_of(&app));
            }
        }
        assert!(hidden.is_dir());
        assert_eq!(startup_recover_as(&app, &Trust::startup(live)), Startup::Recovered);
        assert!(hidden.is_dir(), "left on disk");
        assert!(!app.join(JOURNAL).exists(), "off the record");
        let log = log_of(&app);
        assert!(log.contains(&format!("dropped {} from the record and left it alone", hidden.display())) && log.contains("look in the skill folders for folders named .kolux-deleting-"), "{log}");
        assert_eq!(log.matches("kept").count(), (STALE_STARTS - 1) as usize, "{log}");
    }

    /// FIX-8 AFTER 2: when a delete stops before it rewrites the record (an item gone, an item outside
    /// the scanned folders), what settling decided is still logged: the kept lines as they are, the
    /// refused entries as staying on the record until the next delete or start.
    #[test]
    fn fix8_c_what_settling_decided_is_logged_when_the_delete_stops_early() {
        let t = temp("fix8-c");
        let (app, root, work, elsewhere) = (t.join("app"), t.join("skills"), t.join("work"), t.join("elsewhere"));
        let ws = t.join("repo").join(".claude").join("skills");
        let idle = skill(&ws, ".kolux-deleting-1-2-ws");
        let stray = skill(&work, ".kolux-deleting-1-2-elsewhere");
        write(&app, &Journal { done: true, moves: vec![], left: vec![idle.clone(), stray.clone()], roots: vec![root.clone(), ws.clone(), work.clone()], ..Default::default() }).unwrap();
        let theirs = skill(&elsewhere, "beta");
        // The record cannot be rewritten (as in fix5_d), so settling finds the stray entry still on it.
        std::fs::create_dir_all(app.join(JOURNAL).with_extension("json.tmp")).unwrap();
        let _one = lock(&app).unwrap();
        for (item, why) in [(root.join("gone"), "no longer on disk"), (theirs.clone(), "no longer sits in a skill folder")] {
            let before = log_of(&app);
            let settled = settle(&app, std::slice::from_ref(&root)).unwrap();
            let err = delete_held(&app, settled, &[item]).unwrap_err();
            assert!(err.contains(why), "{err}");
            let log = log_of(&app);
            let new = log.strip_prefix(&before).unwrap_or(&log);
            assert!(new.contains(&format!("kept {} on the record and left it alone for now", idle.display())), "{new}");
            // The refused entry is said once, by the rewrite of the record that failed (FIX-9 AFTER 2).
            assert_eq!(new.matches(&format!("refused to remove {}", stray.display())).count(), 1, "{new}");
            assert_eq!(new.matches(&stray.display().to_string()).count(), 1, "{new}");
            assert!(!new.contains("dropped"), "the record was not rewritten, so nothing was dropped: {new}");
            let rec = read(&app).expect("the record is as it was");
            assert!(rec.left == [idle.clone(), stray.clone()], "{:?}", rec.left);
        }
        assert!(theirs.is_dir());
    }

    /// FIX-8 AFTER 3, FIX-9 AFTER 3: a link in an item's path swapped after the first item was
    /// renamed, before the second: the folder is judged again right before each rename, so the
    /// swapped item is not renamed, what was already moved is put back and nothing is deleted. (The
    /// swap lands between two renames, so one check made once before the renames would not catch it.)
    #[test]
    fn fix8_d_a_link_swapped_between_two_renames_leaves_everything_in_place() {
        let t = temp("fix8-d");
        let (app, root, elsewhere, link) = (t.join("app"), t.join("skills"), t.join("elsewhere"), t.join("lnk"));
        let alpha = skill(&root, "alpha");
        let inside_beta = skill(&root, "beta");
        let outside_beta = skill(&elsewhere, "beta");
        link_dir(&link, &root);
        let (swap_link, swap_to) = (link.clone(), elsewhere.clone());
        AFTER_RENAME.lock().unwrap().push((
            alpha.clone(),
            Box::new(move || {
                std::fs::remove_dir(&swap_link).unwrap();
                link_dir(&swap_link, &swap_to);
            }),
        ));
        let _one = lock(&app).unwrap();
        let settled = settle(&app, std::slice::from_ref(&root)).unwrap();
        let err = delete_held(&app, settled, &[alpha.clone(), link.join("beta")]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("could not be moved") && err.contains("no longer sits in a skill folder"), "{err}");
        assert!(alpha.is_dir() && inside_beta.is_dir() && outside_beta.is_dir(), "nothing was deleted");
        assert_eq!(names(&elsewhere), ["beta"], "nothing was renamed through the swapped link");
        assert_eq!(names(&root), ["alpha", "beta"], "the first item was put back");
        assert!(!app.join(JOURNAL).exists(), "the record is back to nothing");
        assert!(AFTER_RENAME.lock().unwrap().iter().all(|(k, _)| k != &alpha), "the swap ran after the first rename");
    }

    /// FIX-9 FIX-SOON 1: the check also runs before every retry of a rename. The first attempt fails
    /// because another program holds a file in the item; before the second the link is swapped to
    /// another folder (and the holder lets go, so a retry that did not look again would go through).
    /// Nothing is renamed in the other folder and nothing is deleted.
    #[cfg(windows)]
    #[test]
    fn fix9_a_a_link_swapped_between_the_attempts_of_one_rename_stops_it() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix9-a");
        let (app, root, elsewhere, link) = (t.join("app"), t.join("skills"), t.join("elsewhere"), t.join("lnk"));
        let inside_beta = skill(&root, "beta");
        let outside_beta = skill(&elsewhere, "beta");
        link_dir(&link, &root);
        let item = link.join("beta");
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(inside_beta.join("SKILL.md")).unwrap();
        assert!(std::fs::rename(&inside_beta, root.join("probe")).is_err(), "the held file must block a rename");
        let (swap_link, swap_to) = (link.clone(), elsewhere.clone());
        BETWEEN_ATTEMPTS.lock().unwrap().push((
            item.clone(),
            Box::new(move || {
                std::fs::remove_dir(&swap_link).unwrap();
                link_dir(&swap_link, &swap_to);
                drop(held);
            }),
        ));
        let _one = lock(&app).unwrap();
        let settled = settle(&app, std::slice::from_ref(&root)).unwrap();
        let err = delete_held(&app, settled, std::slice::from_ref(&item)).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("could not be moved") && err.contains("no longer sits in a skill folder"), "{err}");
        assert!(BETWEEN_ATTEMPTS.lock().unwrap().iter().all(|(k, _)| k != &item), "the swap ran between two attempts");
        assert!(inside_beta.is_dir() && outside_beta.is_dir(), "nothing was deleted");
        assert_eq!(names(&elsewhere), ["beta"], "nothing was renamed through the swapped link");
        assert_eq!(names(&root), ["beta"]);
        assert!(!app.join(JOURNAL).exists(), "the record is back to nothing");
    }

    /// FIX-9 AFTER 1: the count of start-ups belongs to each leftover, not to the record: a leftover
    /// that only now sits under a skills folder that is not scanned starts at 1, while an older one
    /// next to it is retired at its own 5th start.
    #[test]
    fn fix9_b_a_newly_stale_leftover_is_not_retired_with_an_older_one() {
        let t = temp("fix9-b");
        let (app, home) = (t.join("app"), t.join("home"));
        let (old1, old2) = (home.join(".hermes").join("skills"), home.join(".other").join("skills"));
        let first = skill(&old1, ".kolux-deleting-1-2-alpha");
        let later = skill(&old2, ".kolux-deleting-1-2-beta");
        std::fs::create_dir_all(env(&home).local_app_data.unwrap().join("hermes")).unwrap();
        let live = skills::home_roots(&env(&home));
        assert!(!live.iter().any(|l| same(l, &old1) || same(l, &old2)), "{live:?}");
        write(&app, &Journal { done: true, moves: vec![(old1.join("alpha"), first.clone())], left: vec![], roots: vec![old1.clone()], ..Default::default() }).unwrap();
        for _ in 1..STALE_STARTS {
            assert_eq!(startup_recover_as(&app, &Trust::startup(live.clone())), Startup::Recovered);
        }
        // Only now does a second leftover join the record (as if its skills folder had just moved away).
        let mut rec = read(&app).expect("the first is still on the record");
        rec.left.push(later.clone());
        rec.roots.push(old2.clone());
        write(&app, &rec).unwrap();
        let before = log_of(&app);
        assert_eq!(startup_recover_as(&app, &Trust::startup(live)), Startup::Recovered);
        let log = log_of(&app);
        // Only what this last start wrote counts: the older leftover's first start already said "(start 1 of".
        let new = log.strip_prefix(&before).unwrap_or(&log);
        assert!(new.contains(&format!("dropped {} from the record", first.display())), "the older one is retired: {new}");
        assert!(!new.contains(&format!("dropped {} from the record", later.display())), "the newer one is not: {new}");
        assert!(first.is_dir() && later.is_dir(), "nothing is deleted");
        let rec = read(&app).expect("the newer one stays on the record");
        assert!(rec.left == [later.clone()], "{:?}", rec.left);
        assert!(new.contains(&format!("kept {} on the record", later.display())) && new.contains("(start 1 of"), "{new}");
        assert!(rec.stale_counts == [(later.clone(), 1)], "the newer one is on its own first start: {:?}", rec.stale_counts);
    }

    /// FIX-9 AFTER 5: `run_hook` takes its hook out of the list under one lock, so threads that each
    /// register and run their own hook never run another's or miss their own.
    #[test]
    fn fix9_c_run_hook_takes_its_own_hook_even_when_other_threads_use_the_list() {
        static LIST: Mutex<Vec<(PathBuf, Hook)>> = Mutex::new(Vec::new());
        static RAN: Mutex<Vec<usize>> = Mutex::new(Vec::new());
        let threads: Vec<_> = (0..16usize)
            .map(|n| {
                std::thread::spawn(move || {
                    for round in 0..300usize {
                        let (key, id) = (PathBuf::from(format!("key-{n}")), n * 1000 + round);
                        LIST.lock().unwrap().push((key.clone(), Box::new(move || RAN.lock().unwrap().push(id))));
                        run_hook(&LIST, &key);
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().expect("no thread panicked");
        }
        let mut ran = RAN.lock().unwrap().clone();
        ran.sort_unstable();
        ran.dedup();
        assert_eq!(ran.len(), 16 * 300, "every hook ran exactly once");
        assert!(LIST.lock().unwrap().is_empty());
    }

    /// AFTER 1: a passing holder of the lock file (a backup or antivirus tool) gets one retry before
    /// recovery runs without the lock.
    #[cfg(windows)]
    #[test]
    fn fix4_start_up_recovery_tries_the_lock_once_more_before_going_without_it() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix4-e");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        let held = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(app.join(LOCK)).unwrap();
        assert!(matches!(lock(&app), Err(LockError::Failed(_))), "the file cannot be opened while it is held without sharing");
        // FIX-5 AFTER 2: the holder lets go only once the first try has failed and the retry is
        // about to happen, so the test proves the retry ran (and not a release that beat the first try).
        ON_RETRY.lock().unwrap().push((app.clone(), Box::new(move || drop(held))));
        let start = std::time::Instant::now();
        assert_eq!(startup_recover(&app), Startup::Recovered, "the second try gets the lock");
        assert!(start.elapsed() >= PAUSE, "the retry waited {:?}", start.elapsed());
        assert!(log_of(&app).contains("retrying the skill lock"), "{}", log_of(&app));
        assert!(ON_RETRY.lock().unwrap().iter().all(|(dir, _)| dir != &app), "the hook ran");
        assert_eq!(names(&root), ["alpha"]);
        assert!(!log_of(&app).contains("recovering without it"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_a_link_only_delete_names_no_dangling_link() {
        let t = temp("fix3-f");
        let (app, root, elsewhere) = (t.join("app"), t.join("skills"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(&root).unwrap();
        let link = root.join("beta");
        link_dir(&link, &target);
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&link)]).unwrap();
        assert!(plan_of[0].dangling.is_empty());
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
    }
}
