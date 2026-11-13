//! USAGE-011: Kolux's own activity counts for the Stats & Usage page: agents started, time agents
//! spent working and pull requests created, with the date counting began. They are worked out from
//! the hook-fed pane states (`status.rs`), kept on this computer under one store key, saved in
//! batches and once more at quit.
//!
//! PROJ-051 (second half of this file): when each workspace last saw activity, for the Recent sort. A project is stamped
//! when it is added and a workspace when it is made, so a newcomer starts at the top; the sidebar
//! stamps a workspace when it is shown and when its agent's state changes. Kept in the store.
// ponytail: the map keeps every folder ever stamped; prune it if it grows past a few thousand.

use crate::state::Store;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

pub const KEY: &str = "activityCounts";

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    /// When counting began, in milliseconds.
    pub since: u64,
    /// Agent turns started: one per stretch from a prompt to the turn's end.
    pub agents_started: u64,
    pub working_ms: u64,
    /// Pull requests Kolux made (Source Control's Create pull request); linking one is not counted.
    pub prs_created: u64,
}

/// One pane's open turn and the start of its current working stretch.
#[derive(Default)]
struct Open {
    turn: bool,
    since: Option<u64>,
}

/// VIEW-013: how far back the Floor timeline reaches; "today" never needs more than a day.
pub const TIMELINE_MS: u64 = 26 * 3_600_000;
/// The state changes one pane keeps for the timeline.
const TIMELINE_MARKS: usize = 500;
/// The closed terminals one pane remembers; terminal ids are never reused within a run.
const RETIRED_KEEP: usize = 16;

/// VIEW-013: one change of a pane's state, as the Floor timeline draws it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub at: u64,
    pub state: String,
}

/// One pane's lane on the Floor: its state changes, oldest first, and when it closed.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub pane: u32,
    pub marks: Vec<Mark>,
    pub ended: Option<u64>,
    /// T-260-c FIX-2: the terminal the lane last took a state from; a close with no terminal (the
    /// quit) retires this one.
    #[serde(skip)]
    pub source: Option<u32>,
    /// The terminal the pane runs in and whether that terminal is still open (filled by the command).
    pub terminal: Option<u32>,
    pub live: bool,
    /// T-260-b: the pane of the session this one was started under, when the stored tasks and
    /// dispatches say so and that session has a lane too (filled by the command).
    pub parent: Option<u32>,
}

#[derive(Default)]
pub struct Activity {
    counts: Counts,
    open: HashMap<u32, Open>,
    /// VIEW-013: each pane's recent state changes, kept in memory only.
    tracks: BTreeMap<u32, Track>,
    /// T-260-c FIX-2: per pane, the terminals whose exit closed its lane, newest last. Their late
    /// states are dropped while the lane is ended, after another terminal reopened it, and after the
    /// lane itself went past the reach (so a straggler never brings a dropped lane back).
    // ponytail: one entry per pane key ever closed, each capped at RETIRED_KEEP terminals.
    retired: HashMap<u32, Vec<u32>>,
    dirty: bool,
    /// The save at quit went out; nothing still pending may follow it.
    closed: bool,
}

impl Activity {
    /// The counts saved last run, or a fresh start dated `now` (to be saved).
    pub fn load(saved: Option<&str>, now: u64) -> Activity {
        match saved.and_then(|t| serde_json::from_str::<Counts>(t).ok()).filter(|c| c.since > 0) {
            Some(counts) => Activity { counts, ..Activity::default() },
            None => Activity { counts: Counts { since: now, ..Counts::default() }, dirty: true, ..Activity::default() },
        }
    }

    /// A pane's resolved state changed. Working opens a turn once (a repeated working state, as
    /// after a reconnect, starts nothing); waiting, permission and blocked close the working stretch
    /// but keep the turn; done and interrupted end it.
    /// `terminal` is the terminal the state came from, when known. T-260-c FIX-1/FIX-2: a state from
    /// a terminal that closed the pane's lane (a hook still in flight, even after a Restart reopened
    /// the lane), or from an unknown terminal after the end, changes nothing at all: no mark, no
    /// turn, no working stretch.
    pub fn note(&mut self, pane: u32, terminal: Option<u32>, state: &str, now: u64) {
        if !self.mark(pane, terminal, state, now) {
            return;
        }
        let o = self.open.entry(pane).or_default();
        if state == "working" {
            if !o.turn {
                o.turn = true;
                self.counts.agents_started += 1;
                self.dirty = true;
            }
            o.since.get_or_insert(now);
            return;
        }
        if let Some(start) = o.since.take() {
            self.counts.working_ms += now.saturating_sub(start);
            self.dirty = true;
        }
        if matches!(state, "done" | "interrupted") {
            o.turn = false;
        }
    }

    /// VIEW-013: a state change on the pane's timeline; a repeat of the current state adds nothing.
    /// Marks older than the reach go, except the last of them, which says what the pane was doing
    /// when the reach begins.
    /// False when the state is dropped: it comes from a terminal whose exit closed this pane's lane
    /// (open again or not), or from an unknown terminal while the lane is ended or gone past the
    /// reach. A state from another terminal (TERM-111 Restart, or Enter after exit, on the same pane
    /// key) reopens the lane, or starts a new one when the old lane went past the reach.
    fn mark(&mut self, pane: u32, terminal: Option<u32>, state: &str, now: u64) -> bool {
        self.trim(now);
        if self.retired_from(pane, terminal) {
            return false;
        }
        let gone = self.retired.contains_key(&pane);
        let t = match self.tracks.entry(pane) {
            std::collections::btree_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::btree_map::Entry::Vacant(_) if gone && terminal.is_none() => return false,
            std::collections::btree_map::Entry::Vacant(e) => e.insert(Track { pane, ..Track::default() }),
        };
        if t.ended.is_some() {
            if terminal.is_none() {
                return false;
            }
            t.ended = None;
        }
        if terminal.is_some() {
            t.source = terminal;
        }
        if t.marks.last().is_some_and(|m| m.state == state) {
            return true;
        }
        t.marks.push(Mark { at: now, state: state.to_string() });
        let cut = now.saturating_sub(TIMELINE_MS);
        let old = t.marks.iter().take_while(|m| m.at < cut).count();
        let drop = old.saturating_sub(1).max(t.marks.len().saturating_sub(TIMELINE_MARKS));
        t.marks.drain(..drop);
        true
    }

    /// VIEW-013: every pane's lane as of `now`; a pane that closed before the reach is left out.
    pub fn timeline(&mut self, now: u64) -> Vec<Track> {
        self.trim(now);
        self.tracks.values().cloned().collect()
    }

    /// T-260-c: a lane that closed before the reach goes as marks and ends are written, so lanes
    /// do not pile up while the Floor is never opened.
    fn trim(&mut self, now: u64) {
        let cut = now.saturating_sub(TIMELINE_MS);
        self.tracks.retain(|_, t| t.ended.is_none_or(|e| e >= cut));
    }

    /// Kolux made a pull request.
    pub fn pr_created(&mut self) {
        self.counts.prs_created += 1;
        self.dirty = true;
    }

    /// The pane closed with its terminal: any turn it had open ends now, and the terminal (or, with
    /// none given, the one the lane last heard from) is retired for this pane. A close from a
    /// terminal already retired changes nothing; a second close of an ended lane from another
    /// terminal keeps the first time and only retires that terminal too. The trim of old closed
    /// lanes runs in the mark the closing "done" goes through.
    pub fn end(&mut self, pane: u32, terminal: Option<u32>, now: u64) {
        if self.retired_from(pane, terminal) {
            return;
        }
        let ended = self.tracks.get(&pane).map_or(self.retired.contains_key(&pane), |t| t.ended.is_some());
        let retire = terminal.or_else(|| self.tracks.get(&pane).and_then(|t| t.source));
        if !ended {
            self.note(pane, terminal, "done", now);
            self.open.remove(&pane);
            if let Some(t) = self.tracks.get_mut(&pane) {
                t.ended = Some(now);
            }
        }
        if let Some(term) = retire {
            let r = self.retired.entry(pane).or_default();
            r.push(term);
            let over = r.len().saturating_sub(RETIRED_KEEP);
            r.drain(..over);
        }
    }

    /// The state or close comes from a terminal whose exit already closed this pane's lane.
    fn retired_from(&self, pane: u32, terminal: Option<u32>) -> bool {
        terminal.is_some_and(|t| self.retired.get(&pane).is_some_and(|r| r.contains(&t)))
    }

    /// The counts as of `now`, open working stretches included.
    pub fn snapshot(&self, now: u64) -> Counts {
        let live: u64 = self.open.values().filter_map(|o| o.since).map(|s| now.saturating_sub(s)).sum();
        Counts { working_ms: self.counts.working_ms + live, ..self.counts.clone() }
    }

    /// What to write now, if anything. A batched save writes only changed counts and never after
    /// the save at quit; the save at quit closes every open turn first and always writes.
    pub fn take_save(&mut self, at_quit: bool, now: u64) -> Option<String> {
        if self.closed {
            return None;
        }
        if at_quit {
            let panes: Vec<u32> = self.open.keys().copied().collect();
            for pane in panes {
                self.end(pane, None, now); // the app is quitting: no terminal outlives it
            }
            self.closed = true;
        } else if !self.dirty {
            return None;
        }
        self.dirty = false;
        serde_json::to_string(&self.counts).ok()
    }
}

static ACTIVITY: Mutex<Option<Activity>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut Activity) -> T) -> T {
    let mut guard = ACTIVITY.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(Activity::default))
}

fn now_ms() -> u64 {
    crate::artifacts::now_ms()
}

/// Reads last run's counts; called once at start, before any pane reports.
pub fn start(store: &Store) {
    let saved = saved_counts(store);
    with(|a| *a = Activity::load(saved.as_deref(), now_ms()));
}

/// The saved counts text, or None when there is none or it no longer reads (then it is kept aside first).
fn saved_counts(store: &Store) -> Option<String> {
    let text = store.get(KEY).ok().flatten()?;
    read_or_aside::<Counts>(store, KEY, &text, None).map(|_| text)
}

/// audit-t193 (row-193 pattern; coordinator default, Txais may overrule): a saved value that no longer reads is
/// copied to `<key>.corrupt-<ms>` before the key starts fresh (`fresh` written over it when given), so the next save
/// never writes over the only copy. When the copy cannot be written the key is left as it is.
fn read_or_aside<T: serde::de::DeserializeOwned>(store: &Store, key: &str, text: &str, fresh: Option<&str>) -> Option<T> {
    let err = match serde_json::from_str(text) {
        Ok(v) => return Some(v),
        Err(e) => e,
    };
    let aside = format!("{key}.corrupt-{}", now_ms());
    match store.set(&aside, text) {
        Ok(()) => {
            eprintln!("kolux-rs: {key} could not be read ({err}); kept as {aside}, starting fresh");
            if let Some(f) = fresh {
                let _ = store.set(key, f);
            }
        }
        Err(e) => eprintln!("kolux-rs: {key} could not be read ({err}) nor kept aside ({e})"),
    }
    None
}

/// A pane state from `terminal` (the terminal the pane's hooks last reported for, when known).
pub fn note_from(pane: u32, terminal: Option<u32>, state: &str) {
    with(|a| a.note(pane, terminal, state, now_ms()));
}

/// The terminal ended: the panes its hooks reported for end their turns.
pub fn terminal_ended(terminal: u32) {
    let panes = crate::status::panes_of(terminal);
    with(|a| panes.into_iter().for_each(|p| a.end(p, Some(terminal), now_ms())));
}

/// Writes the counts when they changed (every few seconds) or at quit.
pub fn save(store: &Mutex<Store>, at_quit: bool) {
    // the lock is held through the write, so a batched save in flight finishes before the one at quit
    let mut guard = ACTIVITY.lock().unwrap_or_else(|p| p.into_inner());
    let Some(text) = guard.get_or_insert_with(Activity::default).take_save(at_quit, now_ms()) else { return };
    if let Ok(s) = store.lock() {
        let _ = s.set(KEY, &text);
    }
}

/// Kolux made a pull request (scm.rs pr_create).
pub fn pr_created() {
    with(|a| a.pr_created());
}

// Async: off the window's thread, with the usage page's other first read (`token_usage`).
#[tauri::command(async)]
pub fn activity_counts() -> Counts {
    with(|a| a.snapshot(now_ms()))
}

// ---- PROJ-051: workspace activity times for the Recent sort ----

const WORKSPACE_KEY: &str = "workspaceActivity";

/// The workspace folders one store keeps stamps for. Every touch reads and rewrites the whole map,
/// so it must not grow with every folder the user has ever opened.
const WORKSPACE_KEEP: usize = 2_000;

/// The same key the sidebar's `pathKey` makes: forward slashes, no trailing slash, lower case.
pub fn key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn workspace_times(store: &Store) -> BTreeMap<String, u64> {
    let Some(text) = store.get(WORKSPACE_KEY).ok().flatten() else { return BTreeMap::new() };
    read_or_aside(store, WORKSPACE_KEY, &text, Some("{}")).unwrap_or_default()
}

pub fn touch(store: &Store, path: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut map = workspace_times(store);
    // Newer than every stamp, not just this key's: a touch in the same millisecond as another
    // workspace's still sorts above it.
    let top = map.values().copied().max().unwrap_or(0);
    map.insert(key(path), (top + 1).max(now));
    // PROJ-051: prune to the folders used most recently. The map is read and rewritten on every
    // touch, so keeping every folder ever opened makes each stamp slower and the store bigger for
    // no benefit — the Recent sort only ever shows a handful. Ties break by key so the same map
    // always prunes the same way.
    if map.len() > WORKSPACE_KEEP {
        let mut by_age: Vec<(String, u64)> = map.into_iter().collect();
        by_age.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        by_age.truncate(WORKSPACE_KEEP);
        map = by_age.into_iter().collect();
    }
    store.set(WORKSPACE_KEY, &serde_json::to_string(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

#[tauri::command]
pub fn activity_get(store: StoreState<'_>) -> Result<BTreeMap<String, u64>, String> {
    Ok(workspace_times(&*store.lock().map_err(|e| e.to_string())?))
}

/// VIEW-013 (T-260-b): child sessions nest under their parent. A lane is a child when the dispatch
/// that runs in its terminal belongs to a task with a parent task (same Run) and a dispatch of that
/// parent task ran in the terminal of another lane. Dispatches stamped by an earlier start of Kolux
/// are ignored (terminal ids count up again), the newest dispatch of the parent that has a lane
/// wins, and a lane is never its own ancestor. A worker whose task names no parent task nests under
/// the pane whose terminal the dispatch records as having started it (`fromTerminal`, T-260-d).
pub fn nest_lanes(lanes: &mut [Track], tasks: &[serde_json::Value], dispatches: &[serde_json::Value], runtime: u64) {
    let mine = |d: &&serde_json::Value| d["runtime"].as_u64().is_none_or(|r| r == runtime);
    let pane_of = |terminal: u64| lanes.iter().find(|l| l.terminal.is_some_and(|t| u64::from(t) == terminal)).map(|l| l.pane);
    let mut parent: Vec<Option<u32>> = lanes
        .iter()
        .map(|l| {
            let own = dispatches.iter().rev().filter(mine).find(|d| d["terminal"].as_u64().is_some() && d["terminal"].as_u64() == l.terminal.map(u64::from))?;
            // T-260-d: a task with no parent task nests under the pane whose terminal started it.
            let named = tasks.iter().find(|t| t["id"] == own["taskId"] && t["runId"] == own["runId"]);
            if named.is_none_or(|t| t["parent"].as_str().is_none()) {
                return own["fromTerminal"].as_u64().and_then(pane_of).filter(|p| *p != l.pane);
            }
            // A record with no runId (null == null in Value equality) is never "the same Run".
            let task = named.filter(|t| t["runId"].is_string())?;
            let up = task["parent"].as_str()?;
            dispatches
                .iter()
                .rev()
                .filter(mine)
                .filter(|d| d["taskId"] == up && d["runId"] == task["runId"])
                .find_map(|d| d["terminal"].as_u64().and_then(pane_of))
                .filter(|p| *p != l.pane)
        })
        .collect();
    // Drop every link that sits on a loop (two tasks naming each other).
    let panes: Vec<u32> = lanes.iter().map(|l| l.pane).collect();
    let up = |p: u32, parent: &[Option<u32>]| panes.iter().position(|x| *x == p).and_then(|i| parent[i]);
    let looped: Vec<bool> = panes
        .iter()
        .map(|start| {
            let mut at = *start;
            (0..=panes.len()).any(|_| match up(at, &parent) {
                Some(p) if p == *start => true,
                Some(p) => {
                    at = p;
                    false
                }
                None => false,
            })
        })
        .collect();
    for (i, l) in lanes.iter_mut().enumerate() {
        l.parent = if looped[i] { None } else { parent[i].take() };
    }
}

/// VIEW-013: the Floor timeline's lanes. A lane whose terminal is no longer open is not live: the
/// page shows its quiet stretches as unverifiable rather than idle.
#[tauri::command]
pub fn activity_timeline(terminals: tauri::State<'_, crate::terminal::Terminals>, store: StoreState<'_>) -> Vec<Track> {
    let mut lanes = with(|a| a.timeline(now_ms()));
    for l in &mut lanes {
        l.terminal = crate::status::terminal_of(l.pane);
        l.live = l.ended.is_none() && l.terminal.is_some_and(|t| terminals.started(t).is_some());
    }
    // T-260-b: the store is read once, apart from the activity lock; unreadable means flat lanes.
    let load = |k: &str| -> Vec<serde_json::Value> {
        store.lock().ok().and_then(|s| s.get(k).ok().flatten()).and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
    };
    nest_lanes(&mut lanes, &load(crate::orchestration::TASKS_KEY), &load(crate::orchestration::DISPATCHES_KEY), u64::from(std::process::id()));
    lanes
}

#[tauri::command]
pub fn activity_touch(store: StoreState<'_>, path: String) -> Result<(), String> {
    touch(&*store.lock().map_err(|e| e.to_string())?, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-067-b (USAGE-011): losing the connection to the background terminal service ends the open
    /// turn of every pane that connection carried, through the same end a closed pane takes, once;
    /// the same status repeated after a reconnect starts nothing. Another pane's turn stays open.
    #[test]
    fn t067b_a_lost_service_connection_ends_the_open_turn_of_each_pane_it_carried_once() {
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::Arc;
        const PANE: u32 = 967_101;
        const OTHER: u32 = 967_102;
        const TERM: u32 = 967_201;
        const LOCAL: u32 = 967_202;
        let (link, cut) = crate::pty::link::tests::losable_link(&[3]);
        let ends = Arc::new(AtomicU32::new(0));
        let e = ends.clone();
        link.register(3, Box::new(|_: &[u8]| {}), Box::new(move |code| {
            assert_eq!(code, None, "a lost connection says nothing of how the terminal ended");
            crate::terminal::turns_end(TERM); // the exit every pane's handler runs
            e.fetch_add(1, Ordering::SeqCst); // counted after the turn ends, so the test never reads a half-done exit
        }));
        link.flush(3);
        let go = serde_json::json!({ "hook_event_name": "UserPromptSubmit", "prompt": "go" });
        crate::status::report(PANE, Some(TERM), crate::status::Agent::Claude, &go);
        crate::status::report(OTHER, Some(LOCAL), crate::status::Agent::Claude, &go);
        let lane = |p: u32| with(|a| (a.open.get(&p).map(|o| o.turn), a.tracks.get(&p).map(|t| t.ended.is_some())));
        assert_eq!((lane(PANE), lane(OTHER)), ((Some(true), Some(false)), (Some(true), Some(false))), "both turns open");
        cut.send(()).unwrap();
        let t0 = std::time::Instant::now();
        while ends.load(Ordering::SeqCst) == 0 && t0.elapsed() < std::time::Duration::from_secs(15) {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(!link.alive());
        assert_eq!(lane(PANE), (None, Some(true)), "the carried pane's turn ended with the connection");
        assert_eq!(lane(OTHER), (Some(true), Some(false)), "a pane the connection did not carry keeps its turn");
        // The same status again (a reconnect re-sending it) neither reopens the lane nor starts a turn.
        crate::status::report(PANE, Some(TERM), crate::status::Agent::Claude, &go);
        assert_eq!(lane(PANE), (None, Some(true)));
        assert_eq!(crate::status::state_of(TERM), None);
        assert_eq!(ends.load(Ordering::SeqCst), 1, "the end ran once");
        crate::terminal::turns_end(LOCAL);
        assert_eq!(lane(OTHER).0, None);
    }

    #[test]
    fn view013_each_pane_keeps_its_state_changes_for_the_floor_and_old_ones_go() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        a.note(3, Some(3), "working", 10 * h);
        a.note(3, Some(3), "working", 10 * h + 5); // a restated state adds nothing
        a.note(3, Some(3), "permission", 11 * h);
        a.note(3, Some(3), "working", 11 * h + 300_000); // blocked on approval for 5 minutes
        a.note(4, Some(4), "waiting", 12 * h);
        a.end(4, Some(4), 13 * h);
        let lanes = a.timeline(13 * h);
        let marks: Vec<(u64, &str)> = lanes[0].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!(marks, vec![(10 * h, "working"), (11 * h, "permission"), (11 * h + 300_000, "working")]);
        assert_eq!((lanes[1].pane, lanes[1].ended), (4, Some(13 * h)));
        // A day later (the reach starts at 11:00:00.001): pane 3's older changes go but the last one
        // before the reach stays (it says what the pane was
        // doing when the reach begins); pane 4 closed before the reach and leaves the Floor.
        a.note(3, Some(3), "done", 37 * h + 1);
        let lanes = a.timeline(40 * h);
        assert_eq!(lanes.len(), 1);
        let marks: Vec<(u64, &str)> = lanes[0].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!(marks, vec![(11 * h, "permission"), (11 * h + 300_000, "working"), (37 * h + 1, "done")]);
        // T-260-c: a state reported after the pane closed never reopens its lane.
        a.end(3, Some(3), 40 * h);
        a.note(3, Some(3), "working", 40 * h + 1);
        assert_eq!(a.timeline(40 * h + 2)[0].ended, Some(40 * h));
    }

    #[test]
    fn t260c_ended_lanes_go_as_they_are_written_and_a_late_state_changes_nothing() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        a.note(1, Some(1), "working", h);
        a.end(1, Some(1), 2 * h);
        // A hook still in flight after the pane closed: no mark, no reopened lane.
        a.note(1, Some(1), "working", 2 * h + 50);
        a.note(1, Some(1), "done", 2 * h + 60);
        assert_eq!(a.tracks[&1].ended, Some(2 * h));
        assert_eq!(a.tracks[&1].marks.last().map(|m| m.state.as_str()), Some("done"));
        // Past the reach, another pane's mark drops the closed lane without the Floor ever reading.
        a.note(2, Some(2), "working", 2 * h + TIMELINE_MS + 1);
        assert!(!a.tracks.contains_key(&1));
        // Two more lanes close; a mark a day and more later drops both.
        a.note(3, Some(3), "working", 30 * h);
        a.end(2, Some(2), 60 * h);
        a.end(3, Some(3), 60 * h + 1);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![2, 3]);
        a.note(5, Some(5), "working", 2 * 60 * h);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![5]);
    }

    // T-260-c FIX-1 tests go through these two, so the same scenarios can be run on the old code.
    fn hook(a: &mut Activity, pane: u32, term: Option<u32>, state: &str, now: u64) {
        a.note(pane, term, state, now);
    }

    fn close(a: &mut Activity, pane: u32, term: Option<u32>, now: u64) {
        a.end(pane, term, now);
    }

    fn last(a: &Activity, pane: u32) -> Option<(u64, &str)> {
        a.tracks[&pane].marks.last().map(|m| (m.at, m.state.as_str()))
    }

    #[test]
    fn t260c_fix1_a_restart_on_the_same_key_reopens_the_lane_and_the_ended_terminal_changes_nothing() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 7, Some(3), "working", h);
        close(&mut a, 7, Some(3), 2 * h);
        // A hook still in flight from terminal 3, and a state from no known terminal: dropped.
        hook(&mut a, 7, Some(3), "working", 2 * h + 10);
        hook(&mut a, 7, None, "working", 2 * h + 20);
        assert_eq!((a.tracks[&7].ended, last(&a, 7)), (Some(2 * h), Some((2 * h, "done"))));
        // TERM-111 Restart (or Enter after exit) runs a new terminal 4 on the same pane key.
        hook(&mut a, 7, Some(4), "working", 3 * h);
        assert_eq!((a.tracks[&7].ended, last(&a, 7)), (None, Some((3 * h, "working"))));
        assert_eq!(a.timeline(3 * h + 1)[0].ended, None, "the Floor shows lane 7 open again");
        close(&mut a, 7, Some(4), 4 * h);
        assert_eq!(a.tracks[&7].ended, Some(4 * h));
    }

    #[test]
    fn t260c_fix1_a_late_state_from_the_ended_terminal_leaves_the_counts_alone() {
        let mut a = Activity::load(None, 1);
        hook(&mut a, 1, Some(3), "working", 0);
        close(&mut a, 1, Some(3), 1_000);
        let before = a.snapshot(1_000);
        assert_eq!((before.agents_started, before.working_ms), (1, 1_000));
        hook(&mut a, 1, Some(3), "working", 1_050);
        assert_eq!(a.snapshot(500_000), before, "no extra turn and no stretch left running");
        hook(&mut a, 1, Some(3), "done", 1_100);
        assert!(!a.open.contains_key(&1), "a late done leaves no open entry behind");
        assert_eq!(a.take_save(true, 900_000).map(|s| Activity::load(Some(&s), 1).counts), Some(before), "the quit save banks nothing extra");
    }

    #[test]
    fn t260c_fix1_a_second_close_keeps_the_first_time_and_adds_no_mark() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 2, Some(5), "working", h);
        close(&mut a, 2, Some(5), 2 * h);
        close(&mut a, 2, Some(5), 3 * h);
        let marks: Vec<(u64, &str)> = a.tracks[&2].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!((a.tracks[&2].ended, marks), (Some(2 * h), vec![(h, "working"), (2 * h, "done")]));
    }

    #[test]
    fn t260c_fix1_closing_a_pane_alone_drops_lanes_that_closed_before_the_reach() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 1, Some(1), "working", h);
        close(&mut a, 1, Some(1), 2 * h);
        hook(&mut a, 2, Some(2), "working", 2 * h);
        // The only write past the reach is pane 2's close; no other mark and no Floor read.
        close(&mut a, 2, Some(2), 2 * h + TIMELINE_MS + 1);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![2]);
    }

    #[test]
    fn t260c_fix2_a_straggler_from_the_retired_terminal_after_a_reopen_changes_nothing() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 7, Some(3), "working", h);
        close(&mut a, 7, Some(3), 2 * h);
        hook(&mut a, 7, Some(4), "working", 3 * h); // Restart: terminal 4 reopens lane 7
        // Terminal 3's Stop hook was still in flight and lands 50 ms after the reopen.
        hook(&mut a, 7, Some(3), "done", 3 * h + 50);
        assert_eq!((a.tracks[&7].ended, last(&a, 7)), (None, Some((3 * h, "working"))));
        assert_eq!(a.snapshot(4 * h).working_ms, 2 * h, "terminal 4's stretch is still running");
        // A repeated close from terminal 3 leaves terminal 4's open lane and turn alone too.
        close(&mut a, 7, Some(3), 3 * h + 60);
        assert_eq!((a.tracks[&7].ended, a.open.get(&7).is_some_and(|o| o.turn)), (None, true));
        close(&mut a, 7, Some(4), 4 * h);
        assert_eq!((a.tracks[&7].ended, a.counts.agents_started, a.counts.working_ms), (Some(4 * h), 2, 2 * h));
    }

    #[test]
    fn t260c_fix2_a_second_close_from_another_terminal_keeps_the_first_end_and_retires_both() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 2, Some(5), "working", h);
        close(&mut a, 2, Some(5), 2 * h);
        close(&mut a, 2, Some(6), 3 * h);
        let marks: Vec<(u64, &str)> = a.tracks[&2].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!((a.tracks[&2].ended, marks), (Some(2 * h), vec![(h, "working"), (2 * h, "done")]));
        hook(&mut a, 2, Some(5), "working", 3 * h + 1);
        hook(&mut a, 2, Some(6), "working", 3 * h + 2);
        assert_eq!((a.tracks[&2].ended, a.counts.agents_started), (Some(2 * h), 1), "neither closed terminal reopens the lane");
    }

    #[test]
    fn t260c_fix2_quit_ends_the_open_lane_and_its_last_terminal_stays_retired() {
        let mut a = Activity::load(None, 1);
        hook(&mut a, 1, Some(4), "working", 0);
        assert!(a.take_save(true, 1_000).is_some());
        assert_eq!((a.tracks[&1].ended, last(&a, 1)), (Some(1_000), Some((1_000, "done"))));
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (1, 1_000));
        // Hooks that arrive while Kolux is shutting down change nothing.
        hook(&mut a, 1, Some(4), "working", 2_000);
        hook(&mut a, 1, None, "working", 2_001);
        assert_eq!((a.tracks[&1].ended, last(&a, 1), a.snapshot(9_000).working_ms), (Some(1_000), Some((1_000, "done")), 1_000));
    }

    #[test]
    fn t260c_fix2_d_a_lane_dropped_after_the_reach_never_comes_back_through_a_late_state() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 1, Some(1), "working", h);
        close(&mut a, 1, Some(1), 2 * h);
        let past = 2 * h + TIMELINE_MS + 1;
        hook(&mut a, 2, Some(2), "working", past); // drops lane 1
        assert!(!a.tracks.contains_key(&1));
        hook(&mut a, 1, Some(1), "working", past + 1);
        hook(&mut a, 1, None, "working", past + 2);
        assert!(!a.tracks.contains_key(&1), "a straggler from the closed terminal, or from none, adds no lane");
        assert_eq!(a.counts.agents_started, 2, "and no turn");
        hook(&mut a, 1, Some(9), "working", past + 3); // a new program on the same key a day later
        assert_eq!((a.tracks[&1].ended, a.counts.agents_started), (None, 3));
    }

    /// The path a Restart takes in the app: hooks through status::report, then terminal.rs's exit
    /// closure (activity first, then status), then the new terminal's hooks, then a late hook from the old one.
    #[test]
    fn t260c_fix2_b_restart_reopens_the_lane_through_status_report_and_a_late_hook_changes_nothing() {
        const PANE: u32 = 926_007;
        const OLD: u32 = 926_003;
        const NEW: u32 = 926_004;
        let ev = |j: &str| serde_json::from_str::<serde_json::Value>(j).unwrap();
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        let stop = ev(r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#);
        let lane = || with(|a| a.tracks.get(&PANE).map(|t| (t.ended.is_some(), t.marks.last().map(|m| m.state.clone()))));
        let claude = crate::status::Agent::Claude;
        crate::status::report(PANE, Some(OLD), claude, &go);
        assert_eq!(lane(), Some((false, Some("working".to_string()))));
        terminal_ended(OLD);
        crate::status::terminal_ended(OLD);
        assert_eq!(lane(), Some((true, Some("done".to_string()))), "the agent exited: lane ended");
        crate::status::report(PANE, Some(NEW), claude, &go);
        assert_eq!(lane(), Some((false, Some("working".to_string()))), "Restart: the new terminal reopens the lane");
        crate::status::report(PANE, Some(OLD), claude, &stop);
        assert_eq!(lane(), Some((false, Some("working".to_string()))), "the old terminal's late Stop changes nothing");
        // hooks FIX-4/5: the dropped hook does not take the pane's session back to OLD either, so
        // NEW's exit finds the pane and ends the lane.
        assert_eq!(crate::status::terminal_of(PANE), Some(NEW), "the late hook is not adopted by the session");
        terminal_ended(NEW);
        crate::status::terminal_ended(NEW);
        assert_eq!(lane(), Some((true, Some("done".to_string()))), "the new terminal's exit ends the lane");
        assert_eq!(crate::status::terminal_of(PANE), None, "and the pane's session is gone");
        with(|a| {
            a.tracks.remove(&PANE);
            a.open.remove(&PANE);
        });
    }

    #[test]
    fn usage_011_two_turns_with_a_reconnect_count_two() {
        let mut a = Activity::load(None, 1);
        a.note(7, Some(7), "working", 1_000);
        a.note(7, Some(7), "working", 2_000); // the same turn restated after a reconnect
        a.note(7, Some(7), "done", 4_000);
        a.note(7, Some(7), "working", 10_000);
        a.note(7, Some(7), "working", 11_000);
        a.note(7, Some(7), "done", 13_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (2, 6_000));
    }

    #[test]
    fn usage_011_waiting_closes_a_stretch_without_starting_another_turn() {
        let mut a = Activity::load(None, 1);
        a.note(1, Some(1), "working", 0);
        a.note(1, Some(1), "permission", 1_000);
        a.note(1, Some(1), "waiting", 50_000); // waiting adds no working time
        a.note(1, Some(1), "working", 60_000);
        a.note(1, Some(1), "blocked", 61_000);
        a.note(1, Some(1), "working", 70_000);
        a.note(1, Some(1), "interrupted", 72_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (1, 4_000));
        assert_eq!(a.snapshot(99_000).working_ms, 4_000, "nothing open");
    }

    #[test]
    fn usage_011_closing_a_pane_ends_its_turn_and_open_time_shows_live() {
        let mut a = Activity::load(None, 1);
        a.note(1, Some(1), "working", 0);
        a.note(2, Some(2), "working", 0);
        assert_eq!(a.snapshot(5_000).working_ms, 10_000);
        a.end(1, Some(1), 5_000);
        a.note(1, Some(11), "working", 6_000); // a new program on the same key (its own terminal) is a new turn
        assert_eq!(a.counts.agents_started, 3);
    }

    #[test]
    fn usage_011_a_pull_request_kolux_creates_is_counted_and_saved() {
        let mut a = Activity::load(Some(r#"{"since":5,"agentsStarted":2,"workingMs":9,"prsCreated":3}"#), 7);
        assert!(a.take_save(false, 8).is_none());
        a.pr_created();
        assert_eq!(a.snapshot(9).prs_created, 4);
        let saved = a.take_save(false, 10).expect("a new pull request is saved with the next batch");
        assert_eq!(Activity::load(Some(&saved), 11).counts.prs_created, 4);
    }

    #[test]
    fn usage_011_counts_survive_a_restart_and_the_quit_save_is_last() {
        let mut a = Activity::load(None, 42);
        assert!(a.take_save(false, 42).is_some(), "a fresh start is saved with its date");
        assert!(a.take_save(false, 43).is_none(), "nothing changed, nothing written");
        a.note(1, Some(1), "working", 100);
        a.counts.prs_created = 1;
        let at_quit = a.take_save(true, 400).unwrap();
        a.note(1, Some(1), "working", 500);
        assert!(a.take_save(false, 600).is_none(), "a save still pending never follows the one at quit");
        let back = Activity::load(Some(&at_quit), 9_999);
        assert_eq!(back.counts, Counts { since: 42, agents_started: 1, working_ms: 300, prs_created: 1 });
        assert!(Activity::load(Some("not json"), 7).counts.since == 7, "unreadable counts start again");
    }

    fn lane(pane: u32, terminal: Option<u32>) -> Track {
        Track { pane, terminal, live: true, ..Track::default() }
    }

    fn parents(lanes: &[Track]) -> Vec<(u32, Option<u32>)> {
        lanes.iter().map(|l| (l.pane, l.parent)).collect()
    }

    #[test]
    fn t260b_a_child_session_nests_under_the_pane_of_its_parent_task_and_nothing_else_does() {
        use serde_json::json;
        let me = u64::from(std::process::id());
        let tasks = vec![
            json!({ "id": "task-1", "runId": "run-1" }),
            json!({ "id": "task-2", "runId": "run-1", "parent": "task-1" }),
            json!({ "id": "task-3", "runId": "run-1", "parent": "task-2" }),
            json!({ "id": "task-4", "runId": "run-1" }),
        ];
        let dispatches = vec![
            json!({ "id": "dispatch-1", "runtime": me, "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 10 }),
            json!({ "id": "dispatch-2", "runtime": me, "runId": "run-1", "taskId": "task-2", "status": "running", "terminal": 11 }),
            json!({ "id": "dispatch-3", "runtime": me, "runId": "run-1", "taskId": "task-3", "status": "running", "terminal": 12 }),
            json!({ "id": "dispatch-4", "runtime": me, "runId": "run-1", "taskId": "task-4", "status": "running", "terminal": 13 }),
        ];
        // The panes are not numbered like the terminals, and the child comes before its parent.
        let mut lanes = vec![lane(7, Some(12)), lane(5, Some(11)), lane(3, Some(10)), lane(9, Some(13)), lane(8, None)];
        nest_lanes(&mut lanes, &tasks, &dispatches, me);
        assert_eq!(parents(&lanes), vec![(7, Some(5)), (5, Some(3)), (3, None), (9, None), (8, None)], "a grandchild nests under the child, a task with no parent stays on top");
        let json = serde_json::to_value(&lanes[1]).unwrap();
        assert_eq!(json["parent"], 3, "the Floor reads the parent as a pane number");
        assert!(serde_json::to_value(&lanes[2]).unwrap()["parent"].is_null());
    }

    #[test]
    fn t260b_a_link_nobody_can_vouch_for_leaves_the_lane_on_top() {
        use serde_json::json;
        let me = u64::from(std::process::id());
        let task = |id: &str, parent: Option<&str>, run: &str| json!({ "id": id, "runId": run, "parent": parent });
        let dispatch = |id: &str, task: &str, run: &str, terminal: u32, runtime: u64| json!({ "id": id, "runtime": runtime, "runId": run, "taskId": task, "status": "running", "terminal": terminal });
        // A dispatch stamped by an earlier start of Kolux names a terminal that is someone else now.
        let mut lanes = vec![lane(1, Some(10)), lane(2, Some(11))];
        let tasks = vec![task("task-1", None, "run-1"), task("task-2", Some("task-1"), "run-1")];
        nest_lanes(&mut lanes, &tasks, &[dispatch("d-1", "task-1", "run-1", 10, me + 1), dispatch("d-2", "task-2", "run-1", 11, me)], me);
        assert_eq!(parents(&lanes), vec![(1, None), (2, None)], "the parent's dispatch is from another start");
        // A parent task of another Run is not the parent.
        let tasks = vec![task("task-1", None, "run-2"), task("task-2", Some("task-1"), "run-1")];
        nest_lanes(&mut lanes, &tasks, &[dispatch("d-1", "task-1", "run-2", 10, me), dispatch("d-2", "task-2", "run-1", 11, me)], me);
        assert_eq!(parents(&lanes), vec![(1, None), (2, None)]);
        // A parent whose worker has no lane (its terminal never reported) leaves the child on top, and a retry picks the newest dispatch that has a lane.
        let tasks = vec![task("task-1", None, "run-1"), task("task-2", Some("task-1"), "run-1")];
        let ds = vec![dispatch("d-1", "task-1", "run-1", 10, me), dispatch("d-2", "task-2", "run-1", 11, me), dispatch("d-3", "task-1", "run-1", 99, me)];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert_eq!(parents(&lanes), vec![(1, None), (2, Some(1))], "the retry's terminal 99 has no lane, so the earlier dispatch's lane is the parent");
        // Two tasks that name each other, and a task that names itself, never make a lane its own ancestor.
        let tasks = vec![task("task-1", Some("task-2"), "run-1"), task("task-2", Some("task-1"), "run-1"), task("task-3", Some("task-3"), "run-1")];
        let mut lanes = vec![lane(1, Some(10)), lane(2, Some(11)), lane(3, Some(12))];
        let ds = vec![dispatch("d-1", "task-1", "run-1", 10, me), dispatch("d-2", "task-2", "run-1", 11, me), dispatch("d-3", "task-3", "run-1", 12, me)];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert!(lanes.iter().all(|l| l.parent.is_none()), "{:?}", parents(&lanes));
        // Nothing stored at all: every lane stays on top.
        nest_lanes(&mut lanes, &[], &[], me);
        assert!(lanes.iter().all(|l| l.parent.is_none()));
    }

    #[test]
    fn fix1_a_task_and_a_dispatch_with_no_run_id_never_count_as_the_same_run() {
        use serde_json::json;
        let me = u64::from(std::process::id());
        // Legacy records: a null runId on either side. null == null is not a match.
        for (parent_run, child_run, d_parent, d_child) in [
            (json!(null), json!(null), json!(null), json!(null)),
            (json!(null), json!("run-1"), json!(null), json!("run-1")),
            (json!("run-1"), json!(null), json!("run-1"), json!(null)),
        ] {
            let tasks = vec![json!({ "id": "task-1", "runId": parent_run }), json!({ "id": "task-2", "runId": child_run, "parent": "task-1" })];
            let ds = vec![
                json!({ "id": "d-1", "runtime": me, "runId": d_parent, "taskId": "task-1", "terminal": 10 }),
                json!({ "id": "d-2", "runtime": me, "runId": d_child, "taskId": "task-2", "terminal": 11 }),
            ];
            let mut lanes = vec![lane(1, Some(10)), lane(2, Some(11))];
            nest_lanes(&mut lanes, &tasks, &ds, me);
            assert_eq!(parents(&lanes), vec![(1, None), (2, None)], "tasks {tasks:?} dispatches {ds:?}");
        }
        // A real runId on both sides still nests.
        let tasks = vec![json!({ "id": "task-1", "runId": "run-1" }), json!({ "id": "task-2", "runId": "run-1", "parent": "task-1" })];
        let ds = vec![
            json!({ "id": "d-1", "runtime": me, "runId": "run-1", "taskId": "task-1", "terminal": 10 }),
            json!({ "id": "d-2", "runtime": me, "runId": "run-1", "taskId": "task-2", "terminal": 11 }),
        ];
        let mut lanes = vec![lane(1, Some(10)), lane(2, Some(11))];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert_eq!(parents(&lanes), vec![(1, None), (2, Some(1))]);
    }

    #[test]
    fn t260d_a_worker_with_no_parent_task_nests_under_the_pane_that_started_it() {
        use serde_json::json;
        let me = u64::from(std::process::id());
        let tasks = vec![json!({ "id": "task-1", "runId": "run-1" }), json!({ "id": "task-2", "runId": "run-1", "parent": "task-9" })];
        // The coordinator (terminal 10, pane 4) has no task of its own; its workers ran in 11 and 12.
        let ds = vec![
            json!({ "id": "d-1", "runtime": me, "runId": "run-1", "taskId": "task-1", "terminal": 11, "fromTerminal": 10 }),
            json!({ "id": "d-2", "runtime": me, "runId": "run-1", "taskId": "task-1", "terminal": 12 }),
        ];
        let mut lanes = vec![lane(4, Some(10)), lane(5, Some(11)), lane(6, Some(12))];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert_eq!(parents(&lanes), vec![(4, None), (5, Some(4)), (6, None)], "a dispatch with a starting terminal nests, one without stays on top");
        // A starting terminal with no lane, the worker's own terminal, or a dispatch from another start leaves it on top.
        for (from, runtime) in [(json!(99), me), (json!(11), me), (json!(10), me + 1), (json!(null), me)] {
            let ds = vec![json!({ "id": "d-1", "runtime": runtime, "runId": "run-1", "taskId": "task-1", "terminal": 11, "fromTerminal": from })];
            let mut lanes = vec![lane(4, Some(10)), lane(5, Some(11))];
            nest_lanes(&mut lanes, &tasks, &ds, me);
            assert_eq!(parents(&lanes), vec![(4, None), (5, None)], "fromTerminal {from} runtime {runtime}");
        }
        // A task that names a parent task follows the parent task, never the starting terminal.
        let ds = vec![json!({ "id": "d-2", "runtime": me, "runId": "run-1", "taskId": "task-2", "terminal": 11, "fromTerminal": 10 })];
        let mut lanes = vec![lane(4, Some(10)), lane(5, Some(11))];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert_eq!(parents(&lanes), vec![(4, None), (5, None)], "the parent task has no lane, so the worker stays on top");
        // Two coordinators that started each other never make a lane its own ancestor.
        let ds = vec![
            json!({ "id": "d-1", "runtime": me, "runId": "run-1", "taskId": "task-1", "terminal": 11, "fromTerminal": 10 }),
            json!({ "id": "d-3", "runtime": me, "runId": "run-1", "taskId": "task-1", "terminal": 10, "fromTerminal": 11 }),
        ];
        let mut lanes = vec![lane(4, Some(10)), lane(5, Some(11))];
        nest_lanes(&mut lanes, &tasks, &ds, me);
        assert!(lanes.iter().all(|l| l.parent.is_none()), "{:?}", parents(&lanes));
    }

    #[test]
    fn proj051_stamps_last_across_restarts_and_one_folder_has_one_key() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        touch(&s, "C:\\Repo\\Old\\").unwrap();
        touch(&s, "C:\\Repo\\New").unwrap();
        touch(&s, "c:/repo/old").unwrap();
        drop(s);
        let map = workspace_times(&Store::open(&dir).unwrap());
        assert_eq!(map.len(), 2, "both spellings of Old share a key: {map:?}");
        assert!(map["c:/repo/old"] > map["c:/repo/new"], "working in Old again moves it above New");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn proj051_keeps_only_the_most_recently_used_folders() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        // Seed a full map directly. Touching WORKSPACE_KEEP times would rewrite the whole store that
        // many times, which makes the test about disk speed rather than about the prune.
        let seeded: BTreeMap<String, u64> = (0..WORKSPACE_KEEP).map(|i| (format!("c:/repo/s{i}"), i as u64 + 1)).collect();
        s.set(WORKSPACE_KEY, &serde_json::to_string(&seeded).unwrap()).unwrap();
        touch(&s, "C:\\Repo\\New").unwrap();
        let map = workspace_times(&Store::open(&dir).unwrap());
        assert_eq!(map.len(), WORKSPACE_KEEP, "the map is capped at the limit, not one over: {map:?}");
        assert!(map.contains_key("c:/repo/new"), "the folder just used is kept");
        assert!(!map.contains_key("c:/repo/s0"), "the oldest stamp falls off");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The `<key>.corrupt-*` copies in the store, read straight from its table.
    fn asides(dir: &std::path::Path, key: &str) -> Vec<String> {
        let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        let mut q = conn.prepare("SELECT value FROM kv WHERE key LIKE ?1 ORDER BY key").unwrap();
        q.query_map([format!("{key}.corrupt-%")], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    /// audit-t193 (row-193 pattern): unreadable workspace times are copied aside before the key starts fresh, so
    /// the next touch never writes over the only copy; a second read does not copy them again.
    #[test]
    fn audit_t193_unreadable_workspace_times_are_kept_aside_before_the_key_starts_fresh() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-t193w-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = Store::open(&dir).unwrap();
        s.set(WORKSPACE_KEY, "{\"c:/repo\": oops").unwrap();
        assert!(workspace_times(&s).is_empty());
        touch(&s, "C:\\Repo\\New").unwrap();
        assert!(workspace_times(&s).contains_key("c:/repo/new"));
        drop(s);
        assert_eq!(asides(&dir, WORKSPACE_KEY), ["{\"c:/repo\": oops"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// audit-t193: unreadable activity counts are copied aside at start, before the first save replaces them.
    #[test]
    fn audit_t193_unreadable_counts_are_kept_aside_at_start() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-t193c-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = Store::open(&dir).unwrap();
        s.set(KEY, "not counts").unwrap();
        assert_eq!(saved_counts(&s), None);
        let good = serde_json::to_string(&Counts { since: 5, ..Counts::default() }).unwrap();
        s.set(KEY, &good).unwrap();
        assert_eq!(saved_counts(&s).as_deref(), Some(good.as_str()));
        drop(s);
        assert_eq!(asides(&dir, KEY), ["not counts"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
