//! ORCH-055 (T-174-b): prompts typed into agents land exactly once. One `Send` is a small state
//! machine the command line drives: wait until the agent's input box has drawn and settled (a late
//! redraw restarts that wait), paste the text once, hold Enter back for a pause that grows with the
//! prompt's size (and, for a large paste, until the agent has taken it in), then press Enter exactly
//! once. Enter is held back when another writer takes the session, when a permission prompt shows,
//! or when the user cancels; nothing is pasted while a permission prompt shows. `Receipts` keeps a
//! `terminal send` receipt in the store, so a retry after a restart answers instead of sending
//! again; `lane` serialises the senders of one terminal so sixteen queued prompts give sixteen
//! turns; `proves_arrival` says a working report dated before the send is no proof it arrived.
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The store key the `terminal send` receipts live under (ORCH-034: part of the orchestration store).
pub const KEY: &str = "orchestration.sends";
/// How many receipts are kept, newest last.
pub const RECEIPTS_KEPT: usize = 100;
/// A receipt older than this is dropped when the next one is written.
pub const RECEIPT_TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// The input box has drawn and settled when the agent wrote nothing for this long.
pub const SETTLE_QUIET_MS: u64 = 250;
/// An agent that never stops writing is not waited on past this.
pub const SETTLE_MAX_MS: u64 = 5_000;
/// From this many bytes a paste counts as large: Enter waits until the agent has taken it in.
pub const LARGE_PASTE: usize = 4096;
/// The Windows pause before Enter: a floor, a step per KiB of prompt, and a cap.
pub const PAUSE_FLOOR_MS: u64 = 60;
pub const PAUSE_PER_KIB_MS: u64 = 40;
pub const PAUSE_CAP_MS: u64 = 1500;
/// Hooks states under which nothing is pasted (CLI-025's blocked states).
pub const BLOCKED_STATES: [&str; 3] = ["permission", "waiting", "blocked"];
/// How the driver sleeps between looks.
const TICK: Duration = Duration::from_millis(50);

/// The pause before Enter. On Windows it grows with the prompt's size instead of being one long
/// fixed wait; elsewhere the floor is enough, since a bracketed paste lands in one read.
pub fn enter_pause(bytes: usize, windows: bool) -> Duration {
    if !windows {
        return Duration::from_millis(PAUSE_FLOOR_MS);
    }
    let kib = bytes.div_ceil(1024) as u64;
    Duration::from_millis((PAUSE_FLOOR_MS + kib * PAUSE_PER_KIB_MS).min(PAUSE_CAP_MS))
}

/// Lines of an agent's screen that ask the user to allow or approve something. Only phrases the
/// public tools print on their permission prompts, so a prompt the user typed about permissions is
/// not mistaken for one (Claude Code asks "Do you want to proceed?" with a "Yes, and don't ask
/// again" choice; Codex asks to allow or approve a command).
const PERMISSION_MARKS: [&str; 8] = ["Do you want to proceed", "Do you want to allow", "Do you want to make this edit", "Yes, and don't ask again", "Allow once", "Allow for this session", "Allow command", "Approve this command"];

/// The permission prompt an agent shows in the tail of its output, when one does.
pub fn permission_prompt(tail: &str) -> Option<&'static str> {
    PERMISSION_MARKS.iter().copied().find(|m| tail.contains(m))
}

/// A report from the agent counts as proof the prompt arrived only when it is dated at or after
/// the send; one dated before it belongs to an earlier turn.
pub fn proves_arrival(report_ms: u64, sent_ms: u64) -> bool {
    report_ms >= sent_ms
}

// ---------------------------------------------------------------- receipts that last

/// `terminal send` receipts by terminal and `--retry-request` id, kept in the store so a retry
/// after a Kolux restart answers without sending again (ORCH-030, ORCH-055).
#[derive(Default, Debug, PartialEq)]
pub struct Receipts {
    /// (key, written at, receipt), oldest first.
    items: Vec<(String, u64, Value)>,
}

impl Receipts {
    pub fn load(store: &crate::state::Store) -> Receipts {
        Self::try_load(store).unwrap_or_default()
    }

    /// For a writer: a store that cannot be read or kept aside is an Err, never an empty list.
    pub fn try_load(store: &crate::state::Store) -> Result<Receipts, String> {
        let items: Vec<Value> = crate::state::kept::load(store, KEY)?;
        Ok(Receipts { items: items.into_iter().filter_map(|v| Some((v["key"].as_str()?.to_string(), v["at"].as_u64()?, v["receipt"].clone()))).collect() })
    }

    pub fn save(&self, store: &crate::state::Store) -> Result<(), String> {
        let items: Vec<Value> = self.items.iter().map(|(k, at, r)| serde_json::json!({ "key": k, "at": at, "receipt": r })).collect();
        store.set(KEY, &Value::Array(items).to_string()).map_err(|e| e.to_string())
    }

    /// The receipt of an earlier send with this key, if one is kept.
    pub fn find(&self, key: &str) -> Option<&Value> {
        self.items.iter().rev().find(|(k, _, _)| k == key).map(|(_, _, r)| r)
    }

    /// Keeps `receipt` under `key`, replacing an older one, dropping receipts past the TTL and
    /// keeping at most `RECEIPTS_KEPT`.
    pub fn record(&mut self, key: &str, now_ms: u64, receipt: Value) {
        self.items.retain(|(k, at, _)| k != key && now_ms.saturating_sub(*at) <= RECEIPT_TTL_MS);
        self.items.push((key.to_string(), now_ms, receipt));
        if self.items.len() > RECEIPTS_KEPT {
            let extra = self.items.len() - RECEIPTS_KEPT;
            self.items.drain(..extra);
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

// ---------------------------------------------------------------- who else writes

/// What a sender holds while it types: the writer and cancel counts of the terminal when it claimed it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ticket {
    pub writer: u64,
    pub cancel: u64,
}

static WRITERS: Mutex<BTreeMap<u32, Ticket>> = Mutex::new(BTreeMap::new());

/// A sender claims terminal `id`: it gets the counts to compare against before Enter.
pub fn claim(id: u32) -> Ticket {
    let mut w = WRITERS.lock().unwrap_or_else(|p| p.into_inner());
    let t = w.entry(id).or_insert(Ticket { writer: 0, cancel: 0 });
    t.writer += 1;
    *t
}

/// Another writer (the user's own typing) wrote `data` into terminal `id`; Ctrl+C or Escape on its
/// own is also a cancel, so a prompt whose text is being checked gets no Enter.
/// ORCH-036 (T-155-b): the same typing takes the terminal over: `TAKEN` remembers when the user
/// last wrote into it, so a worker dispatched to it before then is no longer its owner.
pub fn other_writer(id: u32, data: &str) {
    let mut w = WRITERS.lock().unwrap_or_else(|p| p.into_inner());
    let t = w.entry(id).or_insert(Ticket { writer: 0, cancel: 0 });
    t.writer += 1;
    if data == "\u{3}" || data == "\u{1b}" {
        t.cancel += 1;
    }
    drop(w);
    TAKEN.lock().unwrap_or_else(|p| p.into_inner()).insert(id, wall_ms());
}

/// ORCH-036: when the user last typed into each terminal (wall-clock ms), this run of Kolux only.
static TAKEN: Mutex<BTreeMap<u32, u64>> = Mutex::new(BTreeMap::new());

/// ORCH-036: whether the user has typed into terminal `id` since `created_ms` (a dispatch's wall
/// time), so the terminal is the user's now and not the worker's to close. Ownership moves on the
/// user's input only: Kolux's own sends go through `claim`, and a click never writes.
pub fn taken_over_since(id: u32, created_ms: u64) -> bool {
    TAKEN.lock().unwrap_or_else(|p| p.into_inner()).get(&id).is_some_and(|&at| at >= created_ms)
}

fn wall_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The terminal's counts now, to compare with a `Ticket`.
pub fn current(id: u32) -> Ticket {
    WRITERS.lock().unwrap_or_else(|p| p.into_inner()).get(&id).copied().unwrap_or(Ticket { writer: 0, cancel: 0 })
}

// ---------------------------------------------------------------- one terminal, one sender at a time

static LANES: Mutex<BTreeMap<u32, Arc<Mutex<()>>>> = Mutex::new(BTreeMap::new());

/// The lock the senders of terminal `id` take in turn, so queued prompts go in one after another
/// and no Enter lands between another prompt's text and its Enter.
pub fn lane(id: u32) -> Arc<Mutex<()>> {
    LANES.lock().unwrap_or_else(|p| p.into_inner()).entry(id).or_default().clone()
}

// ---------------------------------------------------------------- the send itself

/// What the driver sees each time it looks at the terminal.
#[derive(Clone, Debug, Default)]
pub struct Look {
    pub now_ms: u64,
    /// When the agent last wrote; none when it never did.
    pub last_output_ms: Option<u64>,
    /// The pane's hooks state, when one is reported.
    pub hooks_state: Option<String>,
    /// The last lines of the screen.
    pub screen_tail: String,
    /// Another writer typed into the session since the sender claimed it.
    pub other_writer: bool,
    /// The user cancelled (Ctrl+C or Escape) since the claim.
    pub cancelled: bool,
    /// The terminal is still running.
    pub live: bool,
}

/// How a send ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Text and Enter went in, Enter once.
    Sent,
    /// The text went in; no Enter was asked for.
    TextOnly,
    /// Nothing was pasted: a permission prompt showed (what gave it away).
    Blocked(String),
    /// The text went in, Enter was held back: a permission prompt appeared mid-paste.
    HeldPermission(String),
    /// The text went in, Enter was held back: another writer took the session.
    Stale,
    /// The text went in, Enter was held back: the user cancelled.
    Cancelled,
    /// The terminal ended under the send.
    Gone,
}

impl Outcome {
    /// The receipt word for the outcome.
    pub fn word(&self) -> &'static str {
        match self {
            Outcome::Sent => "sent",
            Outcome::TextOnly => "text_only",
            Outcome::Blocked(_) => "blocked",
            Outcome::HeldPermission(_) => "held_permission",
            Outcome::Stale => "stale",
            Outcome::Cancelled => "cancelled",
            Outcome::Gone => "gone",
        }
    }
}

/// What the driver does next.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Wait(Duration),
    Paste,
    Enter,
    Done(Outcome),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Phase {
    /// Before the paste: waiting for the input box to settle.
    Settle,
    /// Pasted at this time; for a large paste, waiting for the echo to settle.
    Pasted(u64),
    /// Pause before Enter runs out at this time.
    Pause(u64),
    Done(Outcome),
}

/// One prompt on its way into one agent.
#[derive(Clone, Debug)]
pub struct Send {
    bytes: usize,
    enter: bool,
    windows: bool,
    started_ms: u64,
    phase: Phase,
}

impl Send {
    /// A send of `bytes` of text, with or without Enter, started at `now_ms`.
    pub fn new(bytes: usize, enter: bool, windows: bool, now_ms: u64) -> Send {
        Send { bytes, enter, windows, started_ms: now_ms, phase: Phase::Settle }
    }

    /// The paste is large enough that Enter waits for the agent to take it in.
    pub fn large(&self) -> bool {
        self.bytes >= LARGE_PASTE
    }

    fn finish(&mut self, o: Outcome) -> Step {
        self.phase = Phase::Done(o.clone());
        Step::Done(o)
    }

    /// Whether the agent has been quiet long enough since `since` to count as settled, else how
    /// long to wait before looking again.
    fn settled(&self, look: &Look, since: u64) -> Result<(), Duration> {
        if look.now_ms.saturating_sub(since) >= SETTLE_MAX_MS {
            return Ok(());
        }
        let quiet = match look.last_output_ms {
            None => return Ok(()),
            Some(t) if t < since => return Ok(()),
            Some(t) => look.now_ms.saturating_sub(t),
        };
        if quiet >= SETTLE_QUIET_MS {
            Ok(())
        } else {
            Err(Duration::from_millis((SETTLE_QUIET_MS - quiet).clamp(10, TICK.as_millis() as u64)))
        }
    }

    /// Anything that holds Enter back once the text is in.
    fn hold(&mut self, look: &Look) -> Option<Step> {
        if look.cancelled {
            return Some(self.finish(Outcome::Cancelled));
        }
        if look.other_writer {
            return Some(self.finish(Outcome::Stale));
        }
        if let Some(why) = blocked_by(look) {
            return Some(self.finish(Outcome::HeldPermission(why)));
        }
        None
    }

    /// The next step for what `look` shows. Enter is never returned twice.
    pub fn next(&mut self, look: &Look) -> Step {
        if let Phase::Done(o) = &self.phase {
            return Step::Done(o.clone());
        }
        if !look.live {
            return self.finish(Outcome::Gone);
        }
        match self.phase.clone() {
            Phase::Settle => {
                if look.cancelled {
                    return self.finish(Outcome::Cancelled);
                }
                if let Some(why) = blocked_by(look) {
                    return self.finish(Outcome::Blocked(why));
                }
                match self.settled(look, self.started_ms) {
                    Ok(()) => {
                        self.phase = Phase::Pasted(look.now_ms);
                        Step::Paste
                    }
                    Err(wait) => Step::Wait(wait),
                }
            }
            Phase::Pasted(at) => {
                if !self.enter {
                    return self.finish(Outcome::TextOnly);
                }
                if let Some(held) = self.hold(look) {
                    return held;
                }
                // A large paste is still being taken in while the agent echoes it: Enter waits for
                // the echo to settle, then for the pause; a small one waits for the pause alone.
                let taken_in = if self.large() { self.settled(look, at) } else { Ok(()) };
                match taken_in {
                    Ok(()) => {
                        let from = if self.large() { look.now_ms } else { at };
                        let until = from + enter_pause(self.bytes, self.windows).as_millis() as u64;
                        self.phase = Phase::Pause(until);
                        self.next(look)
                    }
                    Err(wait) => Step::Wait(wait),
                }
            }
            Phase::Pause(until) => {
                if let Some(held) = self.hold(look) {
                    return held;
                }
                if look.now_ms >= until {
                    self.phase = Phase::Done(Outcome::Sent);
                    Step::Enter
                } else {
                    Step::Wait(Duration::from_millis((until - look.now_ms).min(TICK.as_millis() as u64)))
                }
            }
            Phase::Done(o) => Step::Done(o),
        }
    }
}

/// What shows a permission or approval prompt: the hooks state, or the prompt in the output.
fn blocked_by(look: &Look) -> Option<String> {
    if let Some(s) = look.hooks_state.as_deref().filter(|s| BLOCKED_STATES.contains(s)) {
        return Some(format!("the agent's status is {s}"));
    }
    permission_prompt(&look.screen_tail).map(|m| format!("its output shows a permission prompt ({m})"))
}

/// What one send delivered and how it ended.
#[derive(Debug, PartialEq, Eq)]
pub struct Delivery {
    pub outcome: Outcome,
    pub delivered: Vec<&'static str>,
    /// When the text went in (the time a report must be dated after to prove arrival).
    pub pasted_ms: Option<u64>,
}

/// A prompt as it may go inside a bracketed paste: ESC and every other control character (C0, DEL
/// and C1) dropped except line feed and tab, so text cannot close the paste early (`ESC[201~`),
/// press Enter with a carriage return, or drive the terminal.
pub(crate) fn paste_safe(t: &str) -> String {
    t.chars().filter(|&c| c == '\n' || c == '\t' || !c.is_control()).collect()
}

/// Drives `send` to its end: `look` is asked each time round, `write` types, `sleep` waits. An agent
/// takes the text as one bracketed paste so its line breaks do not send it early; a shell takes it
/// as typed.
pub fn drive(send: &mut Send, text: Option<&str>, agent: bool, mut look: impl FnMut() -> Look, mut write: impl FnMut(&str) -> Result<(), String>, mut sleep: impl FnMut(Duration)) -> Result<Delivery, String> {
    let mut delivered = Vec::new();
    let mut pasted_ms = None;
    loop {
        let l = look();
        match send.next(&l) {
            Step::Wait(d) => sleep(d),
            Step::Paste => {
                if let Some(t) = text {
                    if agent {
                        write(&format!("\u{1b}[200~{}\u{1b}[201~", paste_safe(t)))?;
                    } else {
                        write(t)?;
                    }
                    delivered.push("text");
                }
                pasted_ms = Some(l.now_ms);
            }
            Step::Enter => {
                write("\r")?;
                delivered.push("enter");
            }
            Step::Done(outcome) => return Ok(Delivery { outcome, delivered, pasted_ms }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn idle(now: u64, last: Option<u64>) -> Look {
        Look { now_ms: now, last_output_ms: last, live: true, ..Look::default() }
    }

    #[test]
    fn orch055_the_windows_pause_grows_with_the_prompt_and_is_capped() {
        assert_eq!(enter_pause(0, true), Duration::from_millis(60));
        assert_eq!(enter_pause(1024, true), Duration::from_millis(100));
        assert_eq!(enter_pause(10 * 1024, true), Duration::from_millis(460));
        assert_eq!(enter_pause(1024 * 1024, true), Duration::from_millis(1500));
        // Elsewhere the floor is the whole pause, whatever the size.
        assert_eq!(enter_pause(1024 * 1024, false), Duration::from_millis(60));
    }

    #[test]
    fn orch055_a_permission_prompt_in_the_output_is_seen_and_a_plain_box_is_not() {
        assert_eq!(permission_prompt("Bash(rm -rf build)\n Do you want to proceed?\n > 1. Yes\n   2. Yes, and don't ask again"), Some("Do you want to proceed"));
        assert_eq!(permission_prompt("codex\n Allow command? [y/N]"), Some("Allow command"));
        assert_eq!(permission_prompt("> \n? for shortcuts"), None);
        assert_eq!(permission_prompt("I set the file permissions to 644 as asked."), None);
    }

    #[test]
    fn orch055_a_report_dated_before_the_send_proves_nothing() {
        assert!(!proves_arrival(999, 1000));
        assert!(proves_arrival(1000, 1000));
        assert!(proves_arrival(1500, 1000));
    }

    #[test]
    fn orch055_the_paste_waits_for_the_input_box_to_settle_and_a_redraw_restarts_the_wait() {
        let mut s = Send::new(20, true, true, 0);
        // The agent wrote at 0: not settled until 250 ms of quiet.
        assert!(matches!(s.next(&idle(100, Some(0))), Step::Wait(_)));
        // A redraw at 200 restarts the wait: at 300 still waiting, at 450 settled.
        assert!(matches!(s.next(&idle(300, Some(200))), Step::Wait(_)));
        assert_eq!(s.next(&idle(450, Some(200))), Step::Paste);
        // An agent that never wrote has nothing to settle: the paste goes at once.
        let mut quiet = Send::new(20, true, true, 0);
        assert_eq!(quiet.next(&idle(0, None)), Step::Paste);
    }

    #[test]
    fn orch055_a_chatty_agent_is_not_waited_on_past_the_cap() {
        let mut s = Send::new(20, true, true, 0);
        for now in (0..SETTLE_MAX_MS).step_by(100) {
            assert!(matches!(s.next(&idle(now, Some(now))), Step::Wait(_)), "at {now}");
        }
        assert_eq!(s.next(&idle(SETTLE_MAX_MS, Some(SETTLE_MAX_MS))), Step::Paste);
    }

    #[test]
    fn orch055_nothing_is_pasted_while_a_permission_prompt_shows() {
        let mut by_hooks = Send::new(20, true, true, 0);
        let look = Look { hooks_state: Some("permission".into()), ..idle(0, None) };
        assert_eq!(by_hooks.next(&look), Step::Done(Outcome::Blocked("the agent's status is permission".into())));
        let mut by_screen = Send::new(20, true, true, 0);
        let look = Look { screen_tail: "Do you want to proceed?\n > 1. Yes".into(), ..idle(0, None) };
        assert!(matches!(by_screen.next(&look), Step::Done(Outcome::Blocked(w)) if w.contains("permission prompt")));
        // Nothing further: the send stays blocked, no paste, no Enter.
        assert!(matches!(by_screen.next(&idle(1000, None)), Step::Done(Outcome::Blocked(_))));
    }

    #[test]
    fn orch055_enter_is_held_back_when_a_permission_prompt_appears_mid_paste() {
        let mut s = Send::new(20, true, true, 0);
        assert_eq!(s.next(&idle(0, None)), Step::Paste);
        let look = Look { hooks_state: Some("permission".into()), ..idle(10, Some(5)) };
        assert!(matches!(s.next(&look), Step::Done(Outcome::HeldPermission(_))));
        assert!(matches!(s.next(&idle(5000, Some(5))), Step::Done(Outcome::HeldPermission(_))));
    }

    #[test]
    fn orch055_enter_is_held_back_when_another_writer_takes_the_session_or_the_user_cancels() {
        let mut taken = Send::new(20, true, true, 0);
        assert_eq!(taken.next(&idle(0, None)), Step::Paste);
        assert_eq!(taken.next(&Look { other_writer: true, ..idle(30, Some(5)) }), Step::Done(Outcome::Stale));
        let mut cancelled = Send::new(20, true, true, 0);
        assert_eq!(cancelled.next(&idle(0, None)), Step::Paste);
        assert_eq!(cancelled.next(&Look { cancelled: true, ..idle(30, Some(5)) }), Step::Done(Outcome::Cancelled));
        // The hold also applies during the pause, after the paste settled.
        let mut late = Send::new(20, true, true, 0);
        assert_eq!(late.next(&idle(0, None)), Step::Paste);
        assert!(matches!(late.next(&idle(10, Some(5))), Step::Wait(_)));
        assert_eq!(late.next(&Look { other_writer: true, ..idle(50, Some(5)) }), Step::Done(Outcome::Stale));
    }

    #[test]
    fn orch055_enter_is_pressed_once_and_a_late_redraw_does_not_press_it_again() {
        let mut s = Send::new(20, true, true, 0);
        assert_eq!(s.next(&idle(0, None)), Step::Paste);
        // 20 bytes on Windows: a 100 ms pause (floor 60 + one KiB step 40).
        assert!(matches!(s.next(&idle(50, Some(5))), Step::Wait(_)));
        assert_eq!(s.next(&idle(100, Some(5))), Step::Enter);
        // Output after Enter (the agent redraws) changes nothing: Done, never Enter again.
        assert_eq!(s.next(&idle(200, Some(150))), Step::Done(Outcome::Sent));
        assert_eq!(s.next(&idle(10_000, Some(9_000))), Step::Done(Outcome::Sent));
    }

    #[test]
    fn orch055_a_large_paste_waits_until_the_agent_has_taken_it_in_before_enter() {
        let mut s = Send::new(LARGE_PASTE, true, true, 0);
        assert_eq!(s.next(&idle(0, None)), Step::Paste);
        // The agent echoes the paste: output keeps moving, Enter waits.
        for now in [100u64, 300, 600, 900] {
            assert!(matches!(s.next(&idle(now, Some(now))), Step::Wait(_)), "at {now}");
        }
        // Quiet from 900: settled at 1150, then the pause (4 KiB: 60 + 4 * 40 = 220 ms) runs to 1370.
        assert!(matches!(s.next(&idle(1150, Some(900))), Step::Wait(_)));
        assert!(matches!(s.next(&idle(1300, Some(900))), Step::Wait(_)));
        assert_eq!(s.next(&idle(1370, Some(900))), Step::Enter);
        // A small paste does not wait for the echo: the pause alone, from the paste.
        let mut small = Send::new(LARGE_PASTE - 1, true, true, 0);
        assert_eq!(small.next(&idle(0, None)), Step::Paste);
        assert_eq!(small.next(&idle(220, Some(200))), Step::Enter);
    }

    #[test]
    fn orch055_the_driver_types_a_bracketed_paste_then_enter_and_a_text_only_send_no_enter() {
        let clock = AtomicU64::new(0);
        let mut typed = Vec::new();
        let mut s = Send::new(5, true, true, 0);
        let d = drive(&mut s, Some("hello"), true, || idle(clock.load(Ordering::SeqCst), None), |t| { typed.push(t.to_string()); Ok(()) }, |w| { clock.fetch_add(w.as_millis() as u64, Ordering::SeqCst); }).unwrap();
        assert_eq!(typed, vec!["\u{1b}[200~hello\u{1b}[201~".to_string(), "\r".to_string()]);
        assert_eq!(d, Delivery { outcome: Outcome::Sent, delivered: vec!["text", "enter"], pasted_ms: Some(0) });
        let mut typed = Vec::new();
        let mut s = Send::new(5, false, true, 0);
        let d = drive(&mut s, Some("hello"), false, || idle(0, None), |t| { typed.push(t.to_string()); Ok(()) }, |_| {}).unwrap();
        assert_eq!(typed, vec!["hello".to_string()]);
        assert_eq!((d.outcome, d.delivered), (Outcome::TextOnly, vec!["text"]));
        // A terminal that ends under the send.
        let mut s = Send::new(5, true, true, 0);
        let d = drive(&mut s, Some("hello"), true, || Look { live: false, ..idle(0, None) }, |_| Ok(()), |_| {}).unwrap();
        assert_eq!((d.outcome, d.delivered), (Outcome::Gone, vec![]));
    }

    /// T-605 review of PR #15: a prompt cannot end the bracketed paste early or drive the
    /// terminal: ESC and every other control character except line feed and tab is dropped first,
    /// so a hidden `ESC[201~` followed by a carriage return cannot send a command of its own.
    #[test]
    fn t605_a_pasted_prompt_loses_escapes_and_control_characters_but_keeps_lines_and_tabs() {
        let clock = AtomicU64::new(0);
        let mut typed = Vec::new();
        let mut s = Send::new(5, true, true, 0);
        let text = "fix it\u{1b}[201~\rrm -rf ~\r\n\u{7}\u{0}line two\tend\u{9b}2J";
        drive(&mut s, Some(text), true, || idle(clock.load(Ordering::SeqCst), None), |t| { typed.push(t.to_string()); Ok(()) }, |w| { clock.fetch_add(w.as_millis() as u64, Ordering::SeqCst); }).unwrap();
        assert_eq!(typed[0], "\u{1b}[200~fix it[201~rm -rf ~\nline two\tend2J\u{1b}[201~");
        assert_eq!(typed[0].matches('\u{1b}').count(), 2, "{:?}", typed[0]);
    }

    #[test]
    fn orch055_sixteen_queued_prompts_give_sixteen_turns_in_order_with_one_enter_each() {
        let id = 55_016u32;
        let typed: Arc<Mutex<Vec<String>>> = Arc::default();
        let clock = Arc::new(AtomicU64::new(0));
        let handles: Vec<_> = (0..16)
            .map(|n| {
                let (typed, clock) = (typed.clone(), clock.clone());
                std::thread::spawn(move || {
                    let turn = lane(id);
                    let _turn = turn.lock().unwrap_or_else(|p| p.into_inner());
                    let text = format!("prompt {n:02}");
                    let mut s = Send::new(text.len(), true, true, clock.load(Ordering::SeqCst));
                    let t2 = typed.clone();
                    drive(&mut s, Some(&text), true, || idle(clock.load(Ordering::SeqCst), None), |t| { t2.lock().unwrap().push(t.to_string()); Ok(()) }, |w| { clock.fetch_add(w.as_millis() as u64, Ordering::SeqCst); }).unwrap()
                })
            })
            .collect();
        let outcomes: Vec<Delivery> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(outcomes.iter().all(|d| d.outcome == Outcome::Sent && d.delivered == ["text", "enter"]));
        let typed = typed.lock().unwrap();
        assert_eq!(typed.len(), 32);
        assert_eq!(typed.iter().filter(|t| *t == "\r").count(), 16, "sixteen Enters, none doubled");
        // Every paste is followed by its own Enter: no prompt's Enter lands inside another's text.
        for pair in typed.chunks(2) {
            assert!(pair[0].starts_with("\u{1b}[200~prompt ") && pair[1] == "\r", "{pair:?}");
        }
        // Each prompt went in once.
        let mut seen: Vec<&String> = typed.iter().filter(|t| *t != "\r").collect();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), 16);
    }

    #[test]
    fn orch055_another_writer_and_a_cancel_are_told_apart_by_the_ticket() {
        let id = 55_002u32;
        let t = claim(id);
        assert_eq!(current(id), t);
        other_writer(id, "x");
        assert_ne!(current(id).writer, t.writer);
        assert_eq!(current(id).cancel, t.cancel);
        other_writer(id, "\u{1b}");
        assert_ne!(current(id).cancel, t.cancel);
        // A fresh claim starts clean against what came before.
        let t2 = claim(id);
        assert_eq!(current(id), t2);
    }

    #[test]
    fn orch055_a_terminal_send_receipt_lasts_across_a_reload_and_is_bounded() {
        let dir = std::env::temp_dir().join(format!("kolux-sendonce-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = crate::state::Store::open(&dir).unwrap();
        let mut r = Receipts::load(&store);
        assert!(r.is_empty());
        r.record("term-1|req-a", 1_000, serde_json::json!({ "delivered": ["text", "enter"] }));
        r.save(&store).unwrap();
        // A new process loads the same receipt: the retry answers without sending again.
        let again = Receipts::load(&store);
        assert_eq!(again.find("term-1|req-a").unwrap()["delivered"][1], "enter");
        assert_eq!(again.find("term-1|req-b"), None);
        // The same key written again replaces, never doubles.
        r.record("term-1|req-a", 2_000, serde_json::json!({ "x": 2 }));
        assert_eq!((r.len(), r.find("term-1|req-a").unwrap()["x"].as_u64()), (1, Some(2)));
        // Past the TTL a receipt is dropped; at most RECEIPTS_KEPT are kept, oldest first out.
        r.record("term-1|req-old", 2_000, serde_json::json!({}));
        r.record("term-1|req-new", 2_000 + RECEIPT_TTL_MS + 1, serde_json::json!({}));
        assert_eq!(r.find("term-1|req-old"), None);
        for n in 0..(RECEIPTS_KEPT + 5) {
            r.record(&format!("term-2|req-{n}"), 3_000_000_000, serde_json::json!({}));
        }
        assert_eq!(r.len(), RECEIPTS_KEPT);
        assert_eq!(r.find("term-2|req-0"), None);
        assert!(r.find(&format!("term-2|req-{}", RECEIPTS_KEPT + 4)).is_some());
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card13_receipts_that_could_not_be_kept_aside_are_never_saved_over() {
        let dir = std::env::temp_dir().join(format!("kolux-sendonce-c13-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        let broken = "[{\"key\": \"term-1|r\", \"at\": 5";
        store.set(KEY, broken).unwrap();
        crate::state::kept::refuse_copies(&dir);
        assert!(Receipts::try_load(&store).unwrap_err().contains(KEY));
        assert!(Receipts::load(&store).is_empty(), "a read still answers");
        assert_eq!(store.get(KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
