//! ORCH-007 (T-030-b): an idle agent gets a one-line pointer typed in when mail arrives. Each new
//! message queues an arrival for every pane that reads its mailbox; one runner per pane waits
//! until the pane's hook state says the agent is idle, then types a single line that gives the
//! count and the exact check command (with the Run when all of the waiting mail is the pane's own
//! Run's), and presses Enter except in Cursor panes. The line goes through `sendonce`, so it lands
//! once, Enter is held back when another writer takes the pane in the pause, and nothing is pasted
//! over a permission prompt.
//!
//! Rules kept here: busy agents hold the line; a live waiting check takes the mail instead; mail
//! for a Run the pane has since left is never pointed into it; a dead pane is never written to; a
//! check made before the line goes out drops it; arrivals while a line is being typed or right
//! after one was typed never type a second one; mail sent straight to a pane names no Run.

use super::sendonce as so;
use super::{finished, terminal_of, Mail, Peer, CLI};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

/// How often a runner looks at a pane while it holds a line.
pub const POLL: Duration = Duration::from_millis(1_000);
/// A waiting check asks again every half second (`cli::wait_for_mail`); one seen this recently is live.
pub const WAITER_FRESH_MS: u64 = 2_000;
/// With no hook state reported, the pane counts as idle after this long without output.
pub const QUIET_MS: u64 = 3_000;
/// After a line went in, new mail waits this long for the agent to wake (hooks say working)
/// before another line may be typed, so one sleeping pane gets one line.
pub const GRACE_MS: u64 = 15_000;

/// One message waiting for a pane. `run` is set only for mail to a Run's mailbox.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Arrival {
    pub id: String,
    pub run: Option<String>,
}

#[derive(Default, Debug)]
struct Pending {
    arrivals: Vec<Arrival>,
    /// Message ids already pointed at or dropped; a repeat notice for one never queues it again.
    seen: BTreeSet<String>,
    typing: bool,
    runner: bool,
    pointed_ms: Option<u64>,
    woke: bool,
}

/// What a runner sees of the pane each time it looks.
#[derive(Clone, Debug, Default)]
pub struct PaneLook {
    pub now_ms: u64,
    pub live: bool,
    pub hooks_state: Option<String>,
    /// How long the pane has been without output; none when it never wrote.
    pub quiet_ms: Option<u64>,
    /// A chat view is handing the pane back to the terminal.
    pub chat_handing_back: bool,
    /// The pane belongs to a chat session with no attachment on this computer.
    pub chat_detached: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Nothing waits for this pane.
    Nothing,
    Hold(&'static str),
    Drop(&'static str),
    Type { line: String, enter: bool },
}

/// Is the agent idle, by its hook state (or, without one, by a quiet screen)?
pub fn idle(look: &PaneLook) -> bool {
    match look.hooks_state.as_deref() {
        Some("done" | "interrupted" | "idle") => true,
        Some(_) => false,
        None => look.quiet_ms.is_some_and(|q| q >= QUIET_MS),
    }
}

fn busy(look: &PaneLook) -> bool {
    look.hooks_state.as_deref() == Some("working")
}

/// The line typed into the pane.
pub fn line(count: usize, run: Option<&str>) -> String {
    let what = if count == 1 { "1 orchestration message is".to_string() } else { format!("{count} orchestration messages are") };
    match run {
        Some(r) => format!("{what} waiting for you in {r}; read them with: {CLI} orchestration check --run {r}"),
        None => format!("{what} waiting for you; read them with: {CLI} orchestration check"),
    }
}

/// Every pane's waiting pointer, the waiting checks seen, and which Run each pane is tied to.
#[derive(Default, Debug)]
pub struct Pointers {
    panes: BTreeMap<String, Pending>,
    waiting: BTreeMap<String, u64>,
    bound: BTreeMap<String, String>,
}

impl Pointers {
    /// Mail arrived for `pane`. True when the pane needs a runner started.
    pub fn arrive(&mut self, pane: &str, a: Arrival) -> bool {
        if a.run.as_ref().is_some_and(|r| self.bound.get(pane) != Some(r)) {
            return false;
        }
        let p = self.panes.entry(pane.to_string()).or_default();
        if p.seen.contains(&a.id) || p.arrivals.iter().any(|x| x.id == a.id) {
            return false;
        }
        p.arrivals.push(a);
        !std::mem::replace(&mut p.runner, true)
    }

    /// The pane read its own mail (`waiting` when the check waits for more): any line not yet
    /// typed is dropped.
    pub fn checked(&mut self, pane: &str, waiting: bool, now_ms: u64) {
        if waiting {
            self.waiting.insert(pane.to_string(), now_ms);
        }
        if let Some(p) = self.panes.get_mut(pane) {
            let gone: Vec<String> = p.arrivals.drain(..).map(|a| a.id).collect();
            p.seen.extend(gone);
            p.pointed_ms = None;
        }
    }

    /// Which Run each pane is tied to now (`Mail::bindings`).
    pub fn rebind(&mut self, bound: impl IntoIterator<Item = (String, String)>) {
        self.bound = bound.into_iter().collect();
    }

    /// What the runner of `pane` does now.
    pub fn decide(&mut self, pane: &str, look: &PaneLook, cursor: bool) -> Decision {
        let fresh = self.waiting.get(pane).is_some_and(|t| look.now_ms.saturating_sub(*t) <= WAITER_FRESH_MS);
        let bound = self.bound.get(pane).cloned();
        let Some(p) = self.panes.get_mut(pane) else { return Decision::Nothing };
        if !look.live {
            self.panes.remove(pane);
            return Decision::Drop("the terminal is gone");
        }
        let (keep, moved): (Vec<Arrival>, Vec<Arrival>) = p.arrivals.drain(..).partition(|a| a.run.is_none() || a.run == bound);
        p.arrivals = keep;
        p.seen.extend(moved.into_iter().map(|a| a.id));
        if p.typing {
            return Decision::Hold("a line is being typed");
        }
        if busy(look) && p.pointed_ms.is_some() {
            p.woke = true;
        }
        if p.arrivals.is_empty() {
            p.runner = false;
            return Decision::Nothing;
        }
        if fresh {
            let gone: Vec<String> = p.arrivals.drain(..).map(|a| a.id).collect();
            p.seen.extend(gone);
            p.runner = false;
            return Decision::Drop("a waiting check takes the mail");
        }
        if !idle(look) {
            return Decision::Hold("the agent is busy");
        }
        if look.chat_handing_back || look.chat_detached {
            return Decision::Hold("the chat view has the pane");
        }
        if p.pointed_ms.is_some_and(|t| !p.woke && look.now_ms.saturating_sub(t) < GRACE_MS) {
            return Decision::Hold("a line already points at this mail");
        }
        let runs: BTreeSet<Option<&str>> = p.arrivals.iter().map(|a| a.run.as_deref()).collect();
        let run = match runs.into_iter().collect::<Vec<_>>()[..] {
            [Some(r)] => Some(r),
            _ => None,
        };
        let text = line(p.arrivals.len(), run);
        p.typing = true;
        Decision::Type { line: text, enter: !cursor }
    }

    /// The line's send ended: `landed` when its text went in. A line that never went in leaves its
    /// mail waiting for the next look.
    pub fn typed(&mut self, pane: &str, landed: bool, now_ms: u64) {
        let Some(p) = self.panes.get_mut(pane) else { return };
        p.typing = false;
        if landed {
            let gone: Vec<String> = p.arrivals.drain(..).map(|a| a.id).collect();
            p.seen.extend(gone);
            p.pointed_ms = Some(now_ms);
            p.woke = false;
        }
    }
}

/// The panes that read the mailbox `to`, the sender left out: a terminal reads its own box, a
/// worker its active dispatch's box, and every pane tied to a Run that Run's box.
pub fn readers(m: &Mail, to: &str, dispatches: &[Value], from: &str) -> Vec<String> {
    let out: Vec<String> = if let Some(h) = to.strip_prefix("term:") {
        vec![h.to_string()]
    } else if let Some(id) = to.strip_prefix("dispatch:") {
        dispatches.iter().filter(|d| d["id"] == id && !finished(d)).filter_map(terminal_of).collect()
    } else if let Some(r) = to.strip_prefix("run:") {
        m.bindings.iter().filter(|(_, b)| b.run.as_deref() == Some(r)).map(|(h, _)| h.clone()).collect()
    } else {
        Vec::new()
    };
    out.into_iter().filter(|h| h != from).collect()
}

/// Drives one pane's pointer until nothing waits: `look` reads the pane, `type_line` sends the line
/// (true when its text went in), `sleep` waits between looks.
pub fn pump(pointers: &Mutex<Pointers>, pane: &str, cursor: bool, mut look: impl FnMut() -> PaneLook, mut type_line: impl FnMut(&str, bool) -> bool, mut sleep: impl FnMut(Duration)) {
    loop {
        let l = look();
        let d = pointers.lock().unwrap_or_else(|e| e.into_inner()).decide(pane, &l, cursor);
        match d {
            Decision::Nothing | Decision::Drop(_) => return,
            Decision::Hold(_) => sleep(POLL),
            Decision::Type { line, enter } => {
                let landed = type_line(&line, enter);
                let now = look().now_ms;
                pointers.lock().unwrap_or_else(|e| e.into_inner()).typed(pane, landed, now);
            }
        }
    }
}

static POINTERS: LazyLock<Mutex<Pointers>> = LazyLock::new(Mutex::default);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn id_of(handle: &str) -> Option<u32> {
    handle.strip_prefix("term-")?.parse().ok()
}

/// After a mail command: the store's Run bindings, so mail for a Run a pane has left is dropped.
pub fn rebind(m: &Mail) {
    let bound = m.bindings.iter().filter_map(|(h, b)| b.run.clone().map(|r| (h.clone(), r)));
    POINTERS.lock().unwrap_or_else(|e| e.into_inner()).rebind(bound);
}

/// After `check` by `pane` on its own mail.
pub fn after_check(pane: &str, reader: &str, waiting: bool) {
    if pane == reader {
        POINTERS.lock().unwrap_or_else(|e| e.into_inner()).checked(pane, waiting, now_ms());
    }
}

/// After a send made the messages `ids`: queue a pointer for every reading agent pane and start
/// its runner on a thread of its own.
pub fn after_send(terminals: &crate::terminal::Terminals, m: &Mail, dispatches: &[Value], ids: &[String], peers: &[Peer], from: &str) {
    rebind(m);
    for msg in m.messages.iter().filter(|x| ids.contains(&x.id)) {
        let run = msg.to.starts_with("run:").then(|| msg.run.clone()).flatten();
        for pane in readers(m, &msg.to, dispatches, from) {
            let Some(peer) = peers.iter().find(|p| p.handle == pane && p.agent.is_some()) else { continue };
            let start = POINTERS.lock().unwrap_or_else(|e| e.into_inner()).arrive(&pane, Arrival { id: msg.id.clone(), run: run.clone() });
            if start {
                let cursor = peer.agent.as_deref().is_some_and(|a| a.eq_ignore_ascii_case("cursor"));
                let t = terminals.clone();
                std::thread::spawn(move || run_pane(t, pane, cursor));
            }
        }
    }
}

fn run_pane(terminals: crate::terminal::Terminals, pane: String, cursor: bool) {
    let Some(id) = id_of(&pane) else {
        POINTERS.lock().unwrap_or_else(|e| e.into_inner()).panes.remove(&pane);
        return;
    };
    // B-23: the agent may have quit since the mail was queued; a pane without one is gone for the pointer.
    let agent = || runs_agent(&crate::agents::inventory::tabs(&terminals), &pane);
    let look = || PaneLook {
        now_ms: now_ms(),
        live: terminals.live(&pane) && agent(),
        hooks_state: crate::status::state_of(id).map(str::to_string),
        quiet_ms: terminals.quiet_for(id).map(|d| d.as_millis() as u64),
        // ponytail: no chat view takes a pane over yet, so neither hold applies (after-list row).
        chat_handing_back: false,
        chat_detached: false,
    };
    let type_line = |text: &str, enter: bool| {
        let turn = so::lane(id);
        let _turn = turn.lock().unwrap_or_else(|p| p.into_inner());
        let ticket = so::claim(id);
        let mut send = so::Send::new(text.len(), enter, cfg!(windows), now_ms());
        let so_look = || {
            let now = now_ms();
            let tail = terminals.read(id, None, Some(8)).map(|r| r.lines.iter().map(|l| l.text.clone()).chain(std::iter::once(r.pending)).collect::<Vec<_>>().join("\n")).unwrap_or_default();
            let seen = so::current(id);
            so::Look {
                now_ms: now,
                last_output_ms: terminals.quiet_for(id).map(|q| now.saturating_sub(q.as_millis() as u64)),
                hooks_state: crate::status::state_of(id).map(str::to_string),
                screen_tail: tail,
                other_writer: seen.writer != ticket.writer,
                cancelled: seen.cancel != ticket.cancel,
                live: terminals.live(&pane),
            }
        };
        // B-23: checked again right before typing; a miss leaves the mail waiting and the next look drops it.
        if !agent() {
            return false;
        }
        so::drive(&mut send, Some(text), true, so_look, |s| terminals.write(id, s), std::thread::sleep).is_ok_and(|d| d.pasted_ms.is_some())
    };
    pump(&POINTERS, &pane, cursor, look, type_line, std::thread::sleep);
}

/// The pane `pane` still runs an agent: one Kolux started, or one the foreground poll finds in front of its shell.
fn runs_agent(tabs: &[crate::agents::inventory::Tab], pane: &str) -> bool {
    tabs.iter().any(|t| t.handle == pane && t.agent.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestration::Binding;
    use serde_json::json;

    fn look(now: u64, state: Option<&str>) -> PaneLook {
        PaneLook { now_ms: now, live: true, hooks_state: state.map(str::to_string), quiet_ms: Some(0), ..PaneLook::default() }
    }

    fn arr(id: &str, run: Option<&str>) -> Arrival {
        Arrival { id: id.into(), run: run.map(str::to_string) }
    }

    fn tied(pane: &str, run: &str) -> Pointers {
        let mut p = Pointers::default();
        p.rebind([(pane.to_string(), run.to_string())]);
        p
    }

    #[test]
    fn b23_a_pane_whose_agent_quit_is_not_typed_into() {
        let tab = |handle: &str, agent: Option<&'static str>| crate::agents::inventory::Tab { handle: handle.into(), agent, program: None, cwd: None, title: None, placement: None };
        let tabs = [tab("term-1", Some("claude")), tab("term-2", None)];
        assert!(runs_agent(&tabs, "term-1"));
        assert!(!runs_agent(&tabs, "term-2"), "the agent quit: a plain shell is left");
        assert!(!runs_agent(&tabs, "term-3"), "the terminal is gone");
        // The pump then drops the mail instead of typing it.
        let p = Mutex::new(tied("term-2", "run-1"));
        p.lock().unwrap().arrive("term-2", arr("m1", Some("run-1")));
        let mut typed = 0;
        pump(&p, "term-2", false, || PaneLook { live: false, ..look(10_000, Some("idle")) }, |_, _| { typed += 1; true }, |_| {});
        assert_eq!(typed, 0);
    }

    #[test]
    fn an_idle_coordinator_gets_one_line_with_the_count_and_the_run() {
        let mut p = tied("term-1", "run-1");
        assert!(p.arrive("term-1", arr("msg-1", Some("run-1"))), "the first arrival starts a runner");
        assert!(!p.arrive("term-1", arr("msg-2", Some("run-1"))), "a second arrival rides the same runner");
        let d = p.decide("term-1", &look(10, Some("done")), false);
        assert_eq!(d, Decision::Type { line: format!("2 orchestration messages are waiting for you in run-1; read them with: {CLI} orchestration check --run run-1"), enter: true });
    }

    #[test]
    fn a_busy_agent_holds_the_line_until_its_hooks_say_idle() {
        let mut p = tied("term-1", "run-1");
        p.arrive("term-1", arr("msg-1", Some("run-1")));
        assert_eq!(p.decide("term-1", &look(10, Some("working")), false), Decision::Hold("the agent is busy"));
        assert_eq!(p.decide("term-1", &look(20, Some("permission")), false), Decision::Hold("the agent is busy"));
        assert_eq!(p.decide("term-1", &look(30, Some("waiting")), false), Decision::Hold("the agent is busy"));
        assert!(matches!(p.decide("term-1", &look(40, Some("done")), false), Decision::Type { .. }));
    }

    #[test]
    fn without_hook_state_a_quiet_screen_counts_as_idle() {
        let mut p = Pointers::default();
        p.arrive("term-2", arr("msg-1", None));
        let mut l = look(10, None);
        l.quiet_ms = Some(QUIET_MS - 1);
        assert_eq!(p.decide("term-2", &l, false), Decision::Hold("the agent is busy"));
        l.quiet_ms = Some(QUIET_MS);
        assert!(matches!(p.decide("term-2", &l, false), Decision::Type { .. }));
    }

    #[test]
    fn a_live_waiting_check_takes_the_mail_and_nothing_is_typed() {
        let mut p = Pointers::default();
        p.checked("term-1", true, 1_000);
        p.arrive("term-1", arr("msg-1", None));
        assert_eq!(p.decide("term-1", &look(1_000 + WAITER_FRESH_MS, Some("done")), false), Decision::Drop("a waiting check takes the mail"));
        // A waiter that stopped asking is no longer live: the next mail is pointed.
        p.arrive("term-1", arr("msg-2", None));
        assert!(matches!(p.decide("term-1", &look(1_001 + WAITER_FRESH_MS, Some("done")), false), Decision::Type { .. }));
    }

    #[test]
    fn a_sleeping_pane_gets_one_line_not_one_per_message() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        assert!(matches!(p.decide("term-1", &look(0, Some("done")), false), Decision::Type { .. }));
        // A second arrival during the pause before Enter never types the line twice.
        p.arrive("term-1", arr("msg-2", None));
        assert_eq!(p.decide("term-1", &look(5, Some("done")), false), Decision::Hold("a line is being typed"));
        p.typed("term-1", true, 10);
        p.arrive("term-1", arr("msg-3", None));
        assert_eq!(p.decide("term-1", &look(20, Some("done")), false), Decision::Hold("a line already points at this mail"));
        // Once the agent woke (working) and went idle again, new mail is pointed.
        assert_eq!(p.decide("term-1", &look(30, Some("working")), false), Decision::Hold("the agent is busy"));
        // msg-2 came in during the first line's pause, so the check that line asks for reads it.
        assert_eq!(p.decide("term-1", &look(40, Some("done")), false), Decision::Type { line: line(1, None), enter: true });
    }

    #[test]
    fn a_line_that_never_went_in_leaves_the_mail_waiting() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        assert!(matches!(p.decide("term-1", &look(0, Some("done")), false), Decision::Type { .. }));
        p.typed("term-1", false, 5);
        assert_eq!(p.decide("term-1", &look(6, Some("done")), false), Decision::Type { line: line(1, None), enter: true });
    }

    #[test]
    fn reading_the_mail_first_drops_the_pending_line() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        assert_eq!(p.decide("term-1", &look(0, Some("working")), false), Decision::Hold("the agent is busy"));
        p.checked("term-1", false, 1);
        assert_eq!(p.decide("term-1", &look(9_999, Some("done")), false), Decision::Nothing);
        assert!(!p.arrive("term-1", arr("msg-1", None)), "a repeat notice for read mail is not queued again");
    }

    #[test]
    fn mail_for_a_run_the_pane_left_is_never_pointed_into_it() {
        let mut p = tied("term-1", "run-1");
        p.arrive("term-1", arr("msg-1", Some("run-1")));
        p.rebind([("term-1".to_string(), "run-2".to_string())]);
        assert_eq!(p.decide("term-1", &look(0, Some("done")), false), Decision::Nothing);
        assert!(!p.arrive("term-1", arr("msg-2", Some("run-1"))), "new mail for the old Run is not queued");
    }

    #[test]
    fn a_dead_pane_is_never_written_to() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        let mut l = look(0, Some("done"));
        l.live = false;
        assert_eq!(p.decide("term-1", &l, false), Decision::Drop("the terminal is gone"));
    }

    #[test]
    fn cursor_panes_get_the_line_without_enter() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        assert_eq!(p.decide("term-1", &look(0, Some("done")), true), Decision::Type { line: line(1, None), enter: false });
    }

    #[test]
    fn a_chat_view_handing_back_or_detached_holds_the_line() {
        let mut p = Pointers::default();
        p.arrive("term-1", arr("msg-1", None));
        let mut l = look(0, Some("done"));
        l.chat_handing_back = true;
        assert_eq!(p.decide("term-1", &l, false), Decision::Hold("the chat view has the pane"));
        l.chat_handing_back = false;
        l.chat_detached = true;
        assert_eq!(p.decide("term-1", &l, false), Decision::Hold("the chat view has the pane"));
    }

    #[test]
    fn direct_mail_names_no_run_and_mixed_mail_uses_the_plain_check() {
        let mut p = tied("term-1", "run-1");
        p.arrive("term-1", arr("msg-1", Some("run-1")));
        p.arrive("term-1", arr("msg-2", None));
        assert_eq!(p.decide("term-1", &look(0, Some("done")), false), Decision::Type { line: line(2, None), enter: true });
        assert_eq!(line(1, None), format!("1 orchestration message is waiting for you; read them with: {CLI} orchestration check"));
    }

    #[test]
    fn readers_follow_the_mailbox_and_leave_the_sender_out() {
        let mut m = Mail::default();
        m.bindings.insert("term-1".into(), Binding { run: Some("run-1".into()), epoch: 1 });
        m.bindings.insert("term-2".into(), Binding { run: Some("run-1".into()), epoch: 1 });
        m.bindings.insert("term-3".into(), Binding { run: Some("run-9".into()), epoch: 1 });
        let ds = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 4 }), json!({ "id": "dispatch-2", "status": "completed", "terminal": 5 })];
        assert_eq!(readers(&m, "run:run-1", &ds, "term-2"), ["term-1"]);
        assert_eq!(readers(&m, "dispatch:dispatch-1", &ds, "term-1"), ["term-4"]);
        assert_eq!(readers(&m, "term:term-7", &ds, "term-1"), ["term-7"]);
        assert_eq!(readers(&m, "dispatch:dispatch-2", &ds, "term-1"), Vec::<String>::new(), "a finished worker gets no pointer");
        assert_eq!(readers(&m, "@all", &ds, "term-1"), Vec::<String>::new());
    }

    #[test]
    fn the_runner_types_once_and_stops_when_nothing_waits() {
        // Stand-in hook events: busy for three looks, then the Stop hook's idle state.
        let pointers = Mutex::new(Pointers::default());
        pointers.lock().unwrap().arrive("term-1", arr("msg-1", None));
        let states = std::cell::RefCell::new(vec!["working", "working", "working", "done", "done", "done"].into_iter());
        let clock = std::cell::Cell::new(0u64);
        let mut typed = Vec::new();
        let mut sleeps = 0;
        pump(
            &pointers,
            "term-1",
            false,
            || {
                clock.set(clock.get() + 100);
                let s = states.borrow_mut().next().unwrap_or("done");
                look(clock.get(), Some(s))
            },
            |l, enter| {
                typed.push((l.to_string(), enter));
                true
            },
            |_| sleeps += 1,
        );
        assert_eq!(typed, [(line(1, None), true)]);
        assert_eq!(sleeps, 3, "held while the hooks said working");
        assert!(pointers.lock().unwrap().arrive("term-1", arr("msg-2", None)), "the runner ended, so new mail starts a fresh one");
    }
}
