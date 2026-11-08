//! Fix-term rows 786/787 (stress S2, output flood): the output path measured without the app.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

const LINE_LEN: usize = 100;

/// `lines` numbered 100-byte lines.
fn numbered(lines: usize) -> Vec<u8> {
    let mut text = Vec::with_capacity(lines * LINE_LEN);
    for i in 0..lines {
        text.extend_from_slice(format!("{i:08} {}\n", "x".repeat(LINE_LEN - 10)).as_bytes());
    }
    text
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-flood-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The handler as it was before the fix: two lock rounds, a 8 KB read per call, the line log with a
/// copy per line, the same base64 and address scan.
fn old_handler(inner: &Mutex<Inner>, prs: &mut crate::scm::PrScan, id: u32, chunk: &[u8]) {
    let data = base64::engine::general_purpose::STANDARD.encode(chunk);
    std::hint::black_box(&data);
    inner.lock().map(|mut i| i.snaps.entry(id).or_default().push(chunk)).unwrap();
    std::hint::black_box(prs.feed(chunk));
    let mut inner = inner.lock().unwrap();
    old_log_push(inner.logs.entry(id).or_default(), chunk);
    if let Some(h) = inner.hist.get_mut(&id) {
        h.append(chunk);
    }
    if chunk.contains(&0x1b) {
        let prev = inner.owned.get(&id).copied().unwrap_or(0);
        inner.owned.insert(id, screen_owner(prev, chunk));
    }
}

/// OutputLog::push before the fix (split_off per line).
fn old_log_push(log: &mut OutputLog, chunk: &[u8]) {
    log.written = Some(Instant::now());
    log.pending.extend_from_slice(chunk);
    while let Some(i) = log.pending.iter().position(|b| *b == b'\n') {
        let rest = log.pending.split_off(i + 1);
        let raw = String::from_utf8_lossy(&std::mem::replace(&mut log.pending, rest)).into_owned();
        let line = last_drawing(raw.trim_end_matches(['\n', '\r']));
        if log.lines.is_empty() && log.oldest == 0 {
            log.oldest = 1;
        }
        log.lines.push_back(strip_ansi(line));
        while log.lines.len() > LOG_LINES {
            log.lines.pop_front();
            log.oldest += 1;
            log.dropped = true;
        }
    }
}

fn new_handler(inner: &Mutex<Inner>, prs: &mut crate::scm::PrScan, id: u32, chunk: &[u8]) -> u64 {
    let data = base64::engine::general_purpose::STANDARD.encode(chunk);
    std::hint::black_box(&data);
    // T-792 review fix (finding 5): the mask runs before the lock, as the real handler does.
    let on_disk = crate::diag::scrub_bytes(chunk);
    let seq = inner.lock().map(|mut i| i.book_chunk(id, chunk, &on_disk, false)).unwrap();
    std::hint::black_box(prs.feed(chunk));
    seq
}

fn inner_with_history(dir: &std::path::Path, id: u32) -> Mutex<Inner> {
    let mut inner = Inner::default();
    inner.hist.insert(id, History::open(dir, id).unwrap());
    Mutex::new(inner)
}

fn mb_per_s(bytes: usize, took: Duration) -> f64 {
    bytes as f64 / (1 << 20) as f64 / took.as_secs_f64()
}

/// Row 787: the per-chunk bookkeeping (everything but the Tauri emit), old handler at the 8 KB reads
/// it used to get against the new handler at the 128 KB batches the pump hands it. Numbers print with
/// `--nocapture`; the assertion is only that the new path is not slower.
#[test]
fn after787_bookkeeping_per_chunk_old_8kb_against_new_batch_128kb() {
    let text = numbered(300_000); // ~30 MB
    let dir = scratch("book");
    // Load flake fix: the fastest of 3 rounds each, old and new alternating, so a load spike that
    // lands on one pass cannot decide the comparison (a real slowdown shows in every round).
    let (mut old_took, mut new_took) = (Duration::MAX, Duration::MAX);
    for round in 0..3u32 {
        let old = inner_with_history(&dir, 1 + 2 * round);
        let mut prs = crate::scm::PrScan::default();
        let t = Instant::now();
        for c in text.chunks(8192) {
            old_handler(&old, &mut prs, 1 + 2 * round, c);
        }
        old_took = old_took.min(t.elapsed());
        let new = inner_with_history(&dir, 2 + 2 * round);
        let mut prs = crate::scm::PrScan::default();
        let t = Instant::now();
        for c in text.chunks(128 * 1024) {
            new_handler(&new, &mut prs, 2 + 2 * round, c);
        }
        new_took = new_took.min(t.elapsed());
    }
    let (o, n) = (mb_per_s(text.len(), old_took), mb_per_s(text.len(), new_took));
    println!("FLOOD bookkeeping: old 8 KB chunks {o:.1} MB/s ({old_took:?}), new 128 KB batches {n:.1} MB/s ({new_took:?}), x{:.1}", n / o);
    assert!(n >= o * 0.9, "new {n:.1} MB/s, old {o:.1} MB/s");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Row 786: what a session keeps after far more than the caps went through it.
#[test]
fn after786_retained_bytes_stay_under_the_caps_and_the_stream_is_whole_and_in_order() {
    let lines = 600_000; // ~60 MB, far past every cap
    let text = numbered(lines);
    let dir = scratch("retain");
    let inner = inner_with_history(&dir, 1);
    let mut prs = crate::scm::PrScan::default();
    let mut seq = 0;
    for c in text.chunks(100_000) {
        seq = new_handler(&inner, &mut prs, 1, c);
    }
    let mut i = inner.lock().unwrap();
    assert_eq!(seq, text.len() as u64, "the running count covers every byte");
    let snap = i.snaps.get_mut(&1).unwrap();
    assert!(snap.tail.len() <= HISTORY_KEEP);
    let shot = snap.snapshot();
    assert_eq!(shot.seq, text.len() as u64);
    let bytes = base64::engine::general_purpose::STANDARD.decode(&shot.data).unwrap();
    let kept = String::from_utf8(bytes).unwrap();
    let nums: Vec<usize> = kept.lines().map(|l| l[..8].parse().unwrap()).collect();
    assert_eq!(*nums.last().unwrap(), lines - 1, "the newest line is the last one sent");
    assert!(nums.windows(2).all(|w| w[1] == w[0] + 1), "snapshot lines run in order, none missing");
    let log = i.logs.get(&1).unwrap();
    assert!(log.lines.len() <= LOG_LINES && log.pending.len() <= PENDING_CAP);
    assert_eq!(log.cursor(), lines as u64);
    let hist = i.hist.get(&1).unwrap();
    assert!(hist.size <= HISTORY_CAP, "{} saved bytes", hist.size);
    assert!(std::fs::metadata(history_file(&dir, 1)).unwrap().len() <= HISTORY_CAP);
    println!("FLOOD retained after {} KB: tail {} B, log {} lines, saved {} B", text.len() / 1024, snap_len(&i), log.lines.len(), hist.size);
    drop(i);
    let _ = std::fs::remove_dir_all(&dir);
}

fn snap_len(i: &Inner) -> usize {
    i.snaps.get(&1).map_or(0, |s| s.tail.len())
}

/// Row 786: output with no line break at all (binary, a progress bar) cannot grow the log.
#[test]
fn after786_a_line_that_never_ends_is_cut_at_the_cap() {
    let mut log = OutputLog::default();
    for _ in 0..1000 {
        log.push(&[b'a'; 10_000]);
    }
    assert!(log.pending.len() <= PENDING_CAP);
    assert!(log.lines.len() <= LOG_LINES);
    assert!(log.lines.iter().all(|l| l.len() <= PENDING_CAP));
    // a character split by the cut is kept whole in the next line
    let mut log = OutputLog::default();
    let mut text = vec![b'a'; PENDING_CAP - 1];
    text.extend_from_slice("é".as_bytes());
    text.extend_from_slice(b"tail\n");
    log.push(&text);
    let all: String = log.read(None, None).lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(all.chars().filter(|c| *c == 'é').count(), 1);
    assert!(!all.contains('\u{fffd}'));
}

/// The pane's side of the flow control: it acknowledges `32 KB` every `period`, a pane that is slow
/// but alive. Returns the largest gap between what was emitted and what the pane has taken in.
fn backlog_with(period: Duration, total: u64, wait: Duration, give_up_on_slowness: bool) -> (u64, u32) {
    let flow = Arc::new(Flow::default());
    let (sent, acked) = (Arc::new(AtomicU64::new(0)), Arc::new(AtomicU64::new(0)));
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let pane = {
        let (flow, sent, acked, done) = (flow.clone(), sent.clone(), acked.clone(), done.clone());
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let queued = sent.load(Ordering::Relaxed) - acked.load(Ordering::Relaxed);
                if queued == 0 {
                    std::thread::yield_now();
                    continue;
                }
                let t = Instant::now();
                while t.elapsed() < period {
                    std::hint::spin_loop();
                }
                let take = queued.min(32 * 1024);
                acked.fetch_add(take, Ordering::Relaxed);
                flow.ack(take);
            }
        })
    };
    let mut worst = 0;
    let mut out = 0;
    while out < total {
        out += 8192;
        sent.fetch_add(8192, Ordering::Relaxed);
        if give_up_on_slowness {
            old_sent_within(&flow, 8192, wait);
        } else {
            flow.sent_within(8192, wait);
        }
        worst = worst.max(sent.load(Ordering::Relaxed) - acked.load(Ordering::Relaxed));
    }
    done.store(true, Ordering::Relaxed);
    pane.join().unwrap();
    (worst, flow.pauses())
}

/// Flow::sent_within as it was: one fixed deadline per pause, the count forgotten when it passes.
fn old_sent_within(flow: &Flow, bytes: u64, wait: Duration) {
    let Ok(mut n) = flow.unacked.lock() else { return };
    *n += bytes;
    if *n < FLOW_HIGH {
        return;
    }
    flow.pauses.fetch_add(1, Ordering::Relaxed);
    let deadline = Instant::now() + wait;
    while *n > FLOW_LOW {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            *n = 0;
            break;
        }
        n = flow.drawn.wait_timeout(n, left).unwrap().0;
    }
}

/// Row 786 (the web view's backlog): a pane that answers, only slowly, used to be given up on every
/// `FLOW_WAIT`, so the reader forgot what it still had queued and sent another window on top; the
/// gap between emitted and drawn grew for as long as the flood ran. Now the wait ends only when the
/// pane stops answering, and the gap stays within the window.
#[test]
fn after786_a_slow_pane_that_keeps_answering_never_has_more_than_one_window_queued() {
    // draining 384 KB (high to low mark) takes 12 acks x 3 ms = 36 ms, past the 25 ms wait
    let (period, total, wait) = (Duration::from_millis(3), 12 << 20, Duration::from_millis(25));
    let (old_worst, old_pauses) = backlog_with(period, total, wait, true);
    // a long wait here only so a loaded machine starving the pane thread cannot read as a silent pane
    // (Load flake fix: 20 s, not 1 s; a pane that answers is never waited out, so this costs nothing)
    let (new_worst, new_pauses) = backlog_with(period, total, Duration::from_secs(20), false);
    println!("FLOOD web view backlog (12 MB, pane at ~10 MB/s): old peak {} KB ({old_pauses} pauses), new peak {} KB ({new_pauses} pauses)", old_worst / 1024, new_worst / 1024);
    assert!(new_worst <= FLOW_HIGH + 64 * 1024, "{new_worst} B queued");
    assert!(old_worst > FLOW_HIGH + 256 * 1024, "the old rule should have let the gap grow, saw {old_worst} B");
}

/// A pane that answers nothing is still given up on after the wait, so no program is stuck for good.
#[test]
fn after786_a_pane_that_answers_nothing_is_still_given_up_on() {
    let flow = Flow::default();
    let t = Instant::now();
    flow.sent_within(FLOW_HIGH, Duration::from_millis(60));
    // Load flake fix: 10 s, not 3 s, for a 60 ms wait that a starved thread may be late to leave.
    assert!(t.elapsed() >= Duration::from_millis(50) && t.elapsed() < Duration::from_secs(10));
    assert!(flow.ack(0), "it is told to resync");
}

/// Row 787: where the bookkeeping time goes, stage by stage over the same 20 MB at one chunk size.
#[test]
fn after787_stage_costs() {
    let text = numbered(200_000);
    let dir = scratch("stages");
    for chunk in [8192usize, 128 * 1024] {
        let mut t = [Duration::ZERO; 6];
        let (mut snap, mut log, mut prs) = (Snap::default(), OutputLog::default(), crate::scm::PrScan::default());
        let mut hist = History::open(&dir, chunk as u32).unwrap();
        for c in text.chunks(chunk) {
            let s = Instant::now();
            std::hint::black_box(base64::engine::general_purpose::STANDARD.encode(c));
            t[0] += s.elapsed();
            let s = Instant::now();
            snap.push(c);
            t[1] += s.elapsed();
            let s = Instant::now();
            std::hint::black_box(prs.feed(c));
            t[2] += s.elapsed();
            let s = Instant::now();
            log.push(c);
            t[3] += s.elapsed();
            let s = Instant::now();
            hist.append(c);
            t[4] += s.elapsed();
            let s = Instant::now();
            std::hint::black_box(screen_owner(0, c));
            t[5] += s.elapsed();
        }
        let ms = |d: Duration| d.as_millis();
        println!("FLOOD stages 20 MB at {} KB: base64 {} ms, snap {} ms, prscan {} ms, log {} ms, history {} ms, screen_owner {} ms", chunk / 1024, ms(t[0]), ms(t[1]), ms(t[2]), ms(t[3]), ms(t[4]), ms(t[5]));
    }
    let _ = std::fs::remove_dir_all(&dir);
}
