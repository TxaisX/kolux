//! Perf stream (DT-C243): output chunks reach the web view in one event per frame window instead of
//! one event per chunk. Every event is one script the window process hands WebView2 to run
//! (`ExecuteScript`: a cross-process call, then a parse and a run in the renderer), so with six panes
//! each printing 20 lines a second the window sent about 120 of them a second, and the three
//! processes spent more time carrying the chunks than drawing them.
//!
//! The first chunk after a quiet moment goes at once (no added latency); the chunks that arrive within
//! `WINDOW` of a send wait for the window's end and go together, every pane's in one event, in arrival
//! order. So the event rate is capped at one per frame (~60/s) and a chunk waits at most one frame,
//! which the web view's own frame queue (frame.ts) already spends aligning the draw. Order is kept
//! across panes, no byte is dropped, and each chunk keeps its own count (`seq`), so a snapshot resync
//! (ORCH-057) still drops exactly the chunks it holds. `flush_now` empties the queue on the caller's
//! thread, for the exit note that should not overtake output already read. A queue past `FLUSH_BYTES`
//! (a flood) goes without waiting for the window, so one event never grows past a few reads.
//!
//! The flusher is one thread. When it is not running (it could not start, or it ended), `push` sends
//! on its own thread instead, one event per chunk as before this change, so output never stops. A
//! sender that panics loses that one batch and is noted once; the flusher goes on.
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// One frame at 60 Hz: the most a chunk waits here.
pub(crate) const WINDOW: Duration = Duration::from_millis(16);
/// Queued output bytes past which the batch goes at once (DT-C246: raw bytes; the same volume as the
/// 256 KB of base64 text it was before).
pub(crate) const FLUSH_BYTES: usize = 192 * 1024;
/// A chunk up to this size from a quiet session (a typed key's echo, a prompt) goes at once even while
/// other sessions are batching.
pub(crate) const EXPRESS_MAX: usize = 4 * 1024;

/// One chunk of program output: the PTY's own bytes (DT-C246), so a multi-byte character split across two
/// chunks survives the trip and is reassembled by xterm's decoder. On the channel the bytes go as they are
/// (output_frame.rs); in the `terminal-output` event, the fallback when no page has subscribed, they go as
/// base64 text, the only shape JSON has for bytes.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub(crate) struct OutputItem {
    pub id: u32,
    #[serde(serialize_with = "as_base64")]
    pub data: Vec<u8>,
    /// TERM-098: the pane's own key, so output that arrives before the pane has learned its
    /// terminal id (the shell's first frame and its cursor question) is not dropped.
    pub pane: Option<u32>,
    /// APP-052: the run of the terminal service that wrote it; a window drops chunks from a replaced run.
    /// Per chunk, not per event, so a run replaced mid-window changes nothing for the window.
    pub generation: u64,
    /// ORCH-057: the session's output count after this chunk; a viewer that redrew from a snapshot drops
    /// the chunks it already holds (seq not past the snapshot's).
    pub seq: u64,
}

fn as_base64<S: serde::Serializer>(data: &[u8], s: S) -> Result<S::Ok, S::Error> {
    use base64::Engine as _;
    s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(data))
}

/// What one `terminal-output` event carries: the chunks of a frame window, in arrival order.
#[derive(serde::Serialize, Clone)]
pub(crate) struct OutputBatch {
    pub items: Vec<OutputItem>,
}

pub(crate) type Sink = Box<dyn Fn(Vec<OutputItem>) + Send + Sync>;

#[derive(Default)]
struct Queue {
    items: Vec<OutputItem>,
    bytes: usize,
    /// When the queued items go; None while nothing is queued.
    due: Option<Instant>,
    last_sent: Option<Instant>,
    /// When each session last had a chunk sent, kept for one window: a session absent here and with
    /// nothing queued is quiet.
    sent_by: std::collections::HashMap<u32, Instant>,
}

pub(crate) struct Batcher {
    queue: Mutex<Queue>,
    wake: Condvar,
    /// Held from taking a batch to the end of its send, by the flusher and by `flush_now` alike, so two
    /// sends never run at once and the events keep arrival order.
    send: Mutex<()>,
    /// True while the flusher thread runs. False: `push` sends on its own thread.
    flusher: AtomicBool,
    /// Batches lost to a panicking sender (the first is noted on stderr).
    sink_panics: AtomicUsize,
    window: Duration,
    cap: usize,
    sink: Sink,
}

/// Clears the flusher flag when the thread ends, however it ends.
struct Alive<'a>(&'a AtomicBool);
impl Drop for Alive<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Batcher {
    /// Starts the flusher thread; `sink` sends one batch (never empty).
    pub(crate) fn new(window: Duration, cap: usize, sink: Sink) -> Arc<Batcher> {
        Self::build(window, cap, sink, true)
    }

    fn build(window: Duration, cap: usize, sink: Sink, threaded: bool) -> Arc<Batcher> {
        let b = Arc::new(Batcher {
            queue: Mutex::new(Queue::default()),
            wake: Condvar::new(),
            send: Mutex::new(()),
            flusher: AtomicBool::new(false),
            sink_panics: AtomicUsize::new(0),
            window,
            cap,
            sink,
        });
        if threaded {
            // Set before the spawn so a push that lands first waits for the thread rather than sending
            // past it; the thread's own guard clears it if the thread ends.
            b.flusher.store(true, Ordering::SeqCst);
            let flusher = b.clone();
            let started = std::thread::Builder::new().name("terminal-output-batch".into()).spawn(move || flusher.run()).is_ok();
            if !started {
                b.flusher.store(false, Ordering::SeqCst);
            }
        }
        b
    }

    /// Queues one chunk. The first after a quiet moment is due now; the rest of the window waits for its
    /// end. Without a running flusher the chunk is sent here, at once. (The app pushes with `push_echo`.)
    #[cfg(test)]
    pub(crate) fn push(&self, item: OutputItem) {
        self.push_echo(item, false);
    }

    /// `push` for a chunk that answers typing (`echo`: its session was typed into a moment ago). Such a
    /// chunk from a quiet session goes at once even while other sessions are batching (see below).
    pub(crate) fn push_echo(&self, item: OutputItem, echo: bool) {
        let len = item.data.len();
        let mut q = lock(&self.queue);
        let now = Instant::now();
        // Latency: for typing, "the first chunk after quiet goes at once" holds per session, so a key's echo
        // in a quiet pane does not wait out a window another pane's flood set. The whole queue goes with it,
        // in arrival order (so no session's chunks are ever reordered); a session that is itself streaming
        // is never quiet, so a flood still goes once per window plus at most one early frame per typing
        // session. Only echoes: untyped output of many slow panes stays batched (DT-C243).
        let quiet = echo && len <= EXPRESS_MAX && !q.items.iter().any(|i| i.id == item.id) && q.sent_by.get(&item.id).is_none_or(|t| now >= *t + self.window);
        q.bytes += len;
        q.items.push(item);
        // The flusher is woken only when this push changed what it waits for: it set the due time, or it
        // took the queue over the byte cap. Pushes within a window otherwise leave it sleeping.
        let mut wake = false;
        if q.due.is_none() {
            q.due = Some(match q.last_sent {
                Some(t) if now < t + self.window => t + self.window,
                _ => now,
            });
            wake = true;
        }
        if quiet && q.due.is_some_and(|due| due > now) {
            q.due = Some(now);
            wake = true;
        }
        if q.bytes >= self.cap && q.bytes - len < self.cap {
            wake = true;
        }
        drop(q);
        if !self.flusher.load(Ordering::SeqCst) {
            let _sending = lock(&self.send);
            self.send_taken(Instant::now());
            return;
        }
        if wake {
            self.wake.notify_one();
        }
    }

    /// Sends everything queued, on this thread, before returning (the exit path).
    pub(crate) fn flush_now(&self) {
        let _sending = lock(&self.send);
        self.send_taken(Instant::now());
    }

    /// Chunks waiting to go (tests and diagnostics).
    #[cfg(test)]
    pub(crate) fn pending(&self) -> usize {
        lock(&self.queue).items.len()
    }

    fn run(&self) {
        let _alive = Alive(&self.flusher);
        loop {
            let mut q = lock(&self.queue);
            loop {
                let Some(due) = q.due else {
                    q = self.wake.wait(q).unwrap_or_else(std::sync::PoisonError::into_inner);
                    continue;
                };
                let now = Instant::now();
                if now >= due || q.bytes >= self.cap {
                    break;
                }
                q = self.wake.wait_timeout(q, due - now).unwrap_or_else(std::sync::PoisonError::into_inner).0;
            }
            drop(q);
            let _sending = lock(&self.send);
            self.send_taken(Instant::now());
        }
    }

    /// Takes the queue and hands it to the sink; the caller holds `send`. A sender that panics loses
    /// this batch only.
    fn send_taken(&self, now: Instant) {
        let items = {
            let mut q = lock(&self.queue);
            if q.items.is_empty() {
                return;
            }
            q.bytes = 0;
            q.due = None;
            q.last_sent = Some(now);
            let window = self.window;
            q.sent_by.retain(|_, t| now < *t + window);
            let items = std::mem::take(&mut q.items);
            for i in &items {
                q.sent_by.insert(i.id, now);
            }
            items
        };
        let count = items.len();
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.sink)(items))).is_err() {
            let before = self.sink_panics.fetch_add(1, Ordering::SeqCst);
            if before == 0 {
                eprintln!("terminal output: the sender panicked; {count} chunk(s) of one event lost, output goes on");
            }
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    type Sent = Arc<Mutex<Vec<(Instant, Vec<OutputItem>)>>>;

    fn batcher(window_ms: u64, cap: usize) -> (Arc<Batcher>, Sent) {
        let sent: Sent = Arc::default();
        let log = sent.clone();
        let b = Batcher::new(Duration::from_millis(window_ms), cap, Box::new(move |items| log.lock().unwrap().push((Instant::now(), items))));
        (b, sent)
    }

    fn item(id: u32, seq: u64, text: &str) -> OutputItem {
        OutputItem { id, data: text.as_bytes().to_vec(), pane: Some(id * 10), generation: 1, seq }
    }

    fn wait_until(sent: &Sent, batches: usize) {
        let give_up = Instant::now() + Duration::from_secs(5);
        while sent.lock().unwrap().len() < batches && Instant::now() < give_up {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn flat(sent: &Sent) -> Vec<OutputItem> {
        sent.lock().unwrap().iter().flat_map(|(_, b)| b.clone()).collect()
    }

    #[test]
    fn dt_c246_in_the_event_fallback_a_chunk_is_still_base64_text() {
        let json = serde_json::to_string(&OutputBatch { items: vec![OutputItem { id: 3, data: b"ko\xc3".to_vec(), pane: None, generation: 2, seq: 9 }] }).unwrap();
        assert_eq!(json, r#"{"items":[{"id":3,"data":"a2/D","pane":null,"generation":2,"seq":9}]}"#);
    }

    #[test]
    fn a_lone_chunk_goes_at_once() {
        let (b, sent) = batcher(50, usize::MAX);
        let at = Instant::now();
        b.push(item(1, 5, "hello"));
        wait_until(&sent, 1);
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 1, "one event");
        assert_eq!(got[0].1, vec![item(1, 5, "hello")]);
        assert!(got[0].0 - at < Duration::from_millis(40), "sent in {:?}, not after the window", got[0].0 - at);
    }

    #[test]
    fn chunks_within_the_window_go_together_in_arrival_order_across_panes() {
        let (b, sent) = batcher(60, usize::MAX);
        b.push(item(1, 1, "a"));
        wait_until(&sent, 1);
        // Within the window of that send: six panes, interleaved, each chunk with its own count.
        let mut pushed = vec![item(1, 1, "a")];
        for round in 0..3u64 {
            for id in 1..=6u32 {
                let it = item(id, 10 + round * 10 + u64::from(id), &format!("p{id}r{round}"));
                pushed.push(it.clone());
                b.push(it);
            }
        }
        wait_until(&sent, 2);
        std::thread::sleep(Duration::from_millis(80));
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 2, "the lone first chunk, then one event for the window: {}", got.len());
        assert_eq!(got[1].1.len(), 18, "every chunk of the window in the one event");
        assert!(got[1].0 - got[0].0 >= Duration::from_millis(55), "the second event waited for the window's end ({:?})", got[1].0 - got[0].0);
        drop(got);
        assert_eq!(flat(&sent), pushed, "arrival order kept, nothing dropped, counts kept");
    }

    #[test]
    fn a_steady_stream_is_capped_at_one_event_per_window_and_loses_nothing() {
        let (b, sent) = batcher(20, usize::MAX);
        let start = Instant::now();
        let mut pushed = Vec::new();
        // 6 panes x ~20 lines/s for 400 ms, as the stress phase c does, but faster.
        for n in 0..240u64 {
            let id = (n % 6) as u32 + 1;
            let it = item(id, n, &format!("line {n}"));
            pushed.push(it.clone());
            b.push(it);
            std::thread::sleep(Duration::from_micros(1500));
        }
        let took = start.elapsed();
        std::thread::sleep(Duration::from_millis(60));
        let got = sent.lock().unwrap();
        let most = took.as_millis() as usize / 20 + 2;
        assert!(got.len() <= most, "{} events for {} chunks over {took:?}: more than one per window", got.len(), pushed.len());
        assert!(got.len() >= 3, "{} events: the stream was not held back as one", got.len());
        drop(got);
        assert_eq!(flat(&sent), pushed, "every chunk once, in order");
    }

    #[test]
    fn flush_now_sends_what_waits_before_it_returns() {
        let (b, sent) = batcher(5_000, usize::MAX);
        b.push(item(3, 1, "first"));
        wait_until(&sent, 1);
        b.push(item(3, 2, "last line"));
        b.push(item(4, 7, "other pane"));
        assert_eq!(b.pending(), 2, "held for the window");
        b.flush_now();
        assert_eq!(b.pending(), 0);
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[1].1, vec![item(3, 2, "last line"), item(4, 7, "other pane")], "the exit note can follow");
    }

    #[test]
    fn flush_now_with_nothing_waiting_sends_nothing() {
        let (b, sent) = batcher(50, usize::MAX);
        b.flush_now();
        std::thread::sleep(Duration::from_millis(20));
        assert!(sent.lock().unwrap().is_empty());
    }

    #[test]
    fn a_flood_past_the_byte_cap_goes_without_waiting_for_the_window() {
        let (b, sent) = batcher(5_000, 1000);
        b.push(item(1, 1, "x"));
        wait_until(&sent, 1);
        let at = Instant::now();
        b.push(item(1, 2, &"y".repeat(600)));
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(sent.lock().unwrap().len(), 1, "under the cap: still waiting for the window");
        b.push(item(2, 3, &"z".repeat(600)));
        wait_until(&sent, 2);
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 2, "over the cap: sent now");
        assert!(got[1].0 - at < Duration::from_millis(500));
        assert_eq!(got[1].1.len(), 2);
    }

    #[test]
    fn no_pane_starves_another_every_pane_is_in_every_window_it_wrote_in() {
        let (b, sent) = batcher(30, usize::MAX);
        b.push(item(9, 0, "lead"));
        wait_until(&sent, 1);
        for n in 0..12u64 {
            b.push(item(1, n, "loud loud loud loud loud loud loud loud"));
            if n % 6 == 5 {
                b.push(item(2, n, "quiet"));
            }
        }
        wait_until(&sent, 2);
        let got = sent.lock().unwrap();
        let second = &got[1].1;
        assert_eq!(second.iter().filter(|i| i.id == 1).count(), 12);
        assert_eq!(second.iter().filter(|i| i.id == 2).count(), 2, "the quiet pane's chunks ride in the same event");
        let quiet: Vec<u64> = second.iter().filter(|i| i.id == 2).map(|i| i.seq).collect();
        assert_eq!(quiet, vec![5, 11]);
    }

    #[test]
    fn a_sender_that_panics_loses_one_batch_and_the_flusher_goes_on() {
        let sent: Sent = Arc::default();
        let log = sent.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let n = calls.clone();
        let b = Batcher::new(
            Duration::from_millis(20),
            usize::MAX,
            Box::new(move |items| {
                if n.fetch_add(1, Ordering::SeqCst) == 0 {
                    panic!("the first send fails");
                }
                log.lock().unwrap().push((Instant::now(), items));
            }),
        );
        b.push(item(1, 1, "lost"));
        let give_up = Instant::now() + Duration::from_secs(5);
        while calls.load(Ordering::SeqCst) < 1 && Instant::now() < give_up {
            std::thread::sleep(Duration::from_millis(1));
        }
        std::thread::sleep(Duration::from_millis(30));
        assert!(b.flusher.load(Ordering::SeqCst), "the flusher survived the panic");
        b.push(item(1, 2, "after"));
        b.push(item(2, 3, "other"));
        // "after" can leave alone on the leading edge (a slow runner idles past the window), so wait for both chunks.
        let give_up = Instant::now() + Duration::from_secs(5);
        while flat(&sent).len() < 2 && Instant::now() < give_up {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(flat(&sent), vec![item(1, 2, "after"), item(2, 3, "other")], "later chunks still arrive, in order");
        assert_eq!(b.sink_panics.load(Ordering::SeqCst), 1);
        b.flush_now();
        assert_eq!(b.pending(), 0);
    }

    /// A steady flood from session 1, one chunk every 2 ms for `ms`, with `echo` chunks from session 2
    /// pushed at the given offsets; returns what was sent.
    fn flood_beside(window_ms: u64, ms: u64, quiet_at: &[u64], echo: bool) -> (Vec<(Instant, Vec<OutputItem>)>, Instant) {
        let (b, sent) = batcher(window_ms, usize::MAX);
        let start = Instant::now();
        let mut n = 0u64;
        let mut quiet = quiet_at.iter().peekable();
        while start.elapsed() < Duration::from_millis(ms) {
            b.push(item(1, n, "flood flood flood flood"));
            n += 1;
            if quiet.peek().is_some_and(|at| start.elapsed() >= Duration::from_millis(**at)) {
                quiet.next();
                b.push_echo(item(2, n, "k"), echo);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        std::thread::sleep(Duration::from_millis(window_ms * 3));
        b.flush_now();
        let got = sent.lock().unwrap().clone();
        (got, start)
    }

    #[test]
    fn latency_a_typed_echo_beside_a_flood_goes_without_waiting_for_the_window() {
        let window = 200;
        let (b, sent) = batcher(window, usize::MAX);
        b.push(item(1, 1, "flood"));
        wait_until(&sent, 1);
        b.push(item(1, 2, "flood more"));
        let at = Instant::now();
        b.push_echo(item(2, 1, "k"), true);
        wait_until(&sent, 2);
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 2);
        assert!(got[1].0 - at < Duration::from_millis(100), "the echo waited {:?}", got[1].0 - at);
        assert_eq!(got[1].1, vec![item(1, 2, "flood more"), item(2, 1, "k")], "the queue goes with it, in arrival order");
        drop(got);
        // The same session typing again within the window is not quiet: it waits like any chunk.
        b.push_echo(item(2, 2, "kk"), true);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(sent.lock().unwrap().len(), 2, "a session that just sent is batched");
        b.flush_now();
        // Untyped output from a quiet pane stays batched (DT-C243).
        let (b, sent) = batcher(window, usize::MAX);
        b.push(item(1, 1, "a"));
        wait_until(&sent, 1);
        b.push(item(3, 1, "untyped"));
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(sent.lock().unwrap().len(), 1, "no echo, no early frame");
        b.flush_now();
    }

    #[test]
    fn latency_a_flood_keeps_its_frames_per_window_and_every_session_its_order() {
        let window = 20;
        let (alone, alone_start) = flood_beside(window, 400, &[], true);
        let (untyped, untyped_start) = flood_beside(window, 400, &[50, 150, 250, 350], false);
        let (typed, typed_start) = flood_beside(window, 400, &[50, 150, 250, 350], true);
        // The bound follows the time the flood really took: a busy machine can hold the pushing thread
        // past its 400 ms, and each window of that extra time is one more frame by design.
        let most = |got: &[(Instant, Vec<OutputItem>)], start: Instant, extra: usize| {
            let ran = got.last().map_or(Duration::ZERO, |(at, _)| at.saturating_duration_since(start));
            (ran.as_millis() as usize).max(400) / window as usize + 3 + extra
        };
        assert!(alone.len() <= most(&alone, alone_start, 0), "{} frames alone", alone.len());
        assert!(untyped.len() <= most(&untyped, untyped_start, 0), "{} frames with an untyped quiet pane", untyped.len());
        assert!(typed.len() <= most(&typed, typed_start, 4), "{} frames with four echoes: at most one early frame each", typed.len());
        for got in [&alone, &untyped, &typed] {
            for id in [1u32, 2] {
                let seqs: Vec<u64> = got.iter().flat_map(|(_, b)| b.iter()).filter(|i| i.id == id).map(|i| i.seq).collect();
                assert!(seqs.windows(2).all(|w| w[0] < w[1]), "session {id} in order: {seqs:?}");
            }
        }
        assert_eq!(typed.iter().flat_map(|(_, b)| b.iter()).filter(|i| i.id == 2).count(), 4, "nothing dropped");
    }

    #[test]
    fn latency_the_end_note_still_follows_the_last_bytes_after_an_echo() {
        let (b, sent) = batcher(5_000, usize::MAX);
        b.push(item(1, 1, "lead"));
        wait_until(&sent, 1);
        b.push_echo(item(2, 1, "echo"), true);
        wait_until(&sent, 2);
        b.push(item(2, 2, "last line"));
        assert_eq!(b.pending(), 1, "the session's next chunk is batched");
        b.flush_now();
        assert_eq!(b.pending(), 0, "flush_now sent it before the end note can go");
        assert_eq!(flat(&sent), vec![item(1, 1, "lead"), item(2, 1, "echo"), item(2, 2, "last line")]);
    }

    #[test]
    fn without_a_flusher_thread_every_push_sends_on_its_own_thread() {
        let sent: Sent = Arc::default();
        let log = sent.clone();
        let b = Batcher::build(Duration::from_millis(5_000), usize::MAX, Box::new(move |items| log.lock().unwrap().push((Instant::now(), items))), false);
        b.push(item(1, 1, "a"));
        b.push(item(1, 2, "b"));
        b.push(item(2, 1, "c"));
        let got = sent.lock().unwrap();
        assert_eq!(got.len(), 3, "one event per chunk, sent before push returned");
        assert_eq!(b.pending(), 0);
        drop(got);
        assert_eq!(flat(&sent), vec![item(1, 1, "a"), item(1, 2, "b"), item(2, 1, "c")]);
    }
}
