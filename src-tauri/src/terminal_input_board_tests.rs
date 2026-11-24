//! LAG-07 (board, locked): a terminal's input goes through its own queue and writer, so a pipe that
//! blocks (a program not reading its input) never holds the caller, an async runtime worker, or
//! another terminal's input. Every check is a count or an order: fake pipes record what they got,
//! and say whether they were let go by the test (right) or by the guard below (wrong: something waited).

use super::input::InputQueue;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Only a wrong build ever waits this long: a correct one lets every fake pipe go by a message first.
/// No assertion reads a clock; a pipe let go by this guard is counted in `timed_out` and fails the test.
const GUARD: Duration = Duration::from_secs(20);

type Pipe = Box<dyn FnMut(&[u8]) -> Result<(), String> + Send + 'static>;

/// What a test sees of its fake pipe.
struct Probe {
    /// Every chunk the pipe was handed, in order, one entry per write call.
    written: Arc<Mutex<Vec<Vec<u8>>>>,
    /// Gets one message when the pipe's first write starts (a blocking pipe is then blocked).
    entered: Receiver<()>,
    /// Lets a blocking pipe's first write finish.
    release: Sender<()>,
    /// How many writes were let go by `GUARD` instead of `release` (each one is a wait that should not be).
    timed_out: Arc<AtomicUsize>,
    /// Disconnects once the pipe (the writer's closure) is dropped: the writer has ended.
    alive: Receiver<()>,
}

/// A pipe. `block_first`: its first write blocks until `release` (or `GUARD`). `fail`: every write fails.
/// `on_write`: sent one message after each write (lets one terminal's write free another's pipe).
fn pipe(block_first: bool, fail: bool, on_write: Option<Sender<()>>) -> (Pipe, Probe) {
    let written = Arc::new(Mutex::new(Vec::new()));
    let timed_out = Arc::new(AtomicUsize::new(0));
    let (entered_tx, entered) = mpsc::channel();
    let (release, release_rx) = mpsc::channel::<()>();
    let (alive_tx, alive) = mpsc::channel::<()>();
    let (w, t) = (Arc::clone(&written), Arc::clone(&timed_out));
    let mut calls = 0usize;
    let pipe: Pipe = Box::new(move |chunk: &[u8]| {
        let _keep_alive = &alive_tx;
        calls += 1;
        w.lock().unwrap().push(chunk.to_vec());
        if calls == 1 {
            let _ = entered_tx.send(());
            if block_first {
                match release_rx.recv_timeout(GUARD) {
                    Ok(()) => {}
                    Err(_) => {
                        t.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
        }
        if let Some(tx) = &on_write {
            let _ = tx.send(());
        }
        if fail {
            Err("the pipe is broken".to_string())
        } else {
            Ok(())
        }
    });
    (pipe, Probe { written, entered, release, timed_out, alive })
}

/// True once the writer has dropped its pipe (the writer ended); false if it is still alive after `GUARD`.
fn ended(p: &Probe) -> bool {
    matches!(p.alive.recv_timeout(GUARD), Err(RecvTimeoutError::Disconnected))
}

fn chunks(p: &Probe) -> Vec<Vec<u8>> {
    p.written.lock().unwrap().clone()
}

fn is_send_sync<T: Send + Sync>() {}

/// A1: with the pipe blocked on the first chunk, the next sends return at once; the pipe has seen only
/// the first chunk when they return; nothing waited (no write was let go by the guard).
#[test]
fn a_write_to_a_blocked_pipe_returns_at_once() {
    is_send_sync::<InputQueue>();
    let (p, probe) = pipe(true, false, None);
    let q = InputQueue::start(p);
    q.send(b"first").expect("the first chunk is taken");
    probe.entered.recv_timeout(GUARD).expect("the writer hands the first chunk to the pipe");
    q.send(b"second").expect("taken while the pipe is blocked");
    q.send(b"third").expect("taken while the pipe is blocked");
    let seen_while_blocked = chunks(&probe).len();
    let _ = probe.release.send(());
    drop(q);
    assert!(ended(&probe), "the writer ends once its queue is dropped and the pipe let go");
    assert_eq!(probe.timed_out.load(Ordering::SeqCst), 0, "a send waited for the blocked pipe");
    assert_eq!(seen_while_blocked, 1, "the later chunks reached the pipe only after it was let go");
    assert_eq!(chunks(&probe), vec![b"first".to_vec(), b"second".to_vec(), b"third".to_vec()]);
}

/// A2: 200 sends reach the pipe in order, one write per send with exactly the bytes sent (no merging,
/// no splitting: a terminal reply is converted per write), before the writer ends.
#[test]
fn bytes_reach_the_pipe_in_order_one_write_per_send() {
    let (p, probe) = pipe(false, false, None);
    let q = InputQueue::start(p);
    let sent: Vec<Vec<u8>> = (0..200).map(|i| format!("chunk {i};").into_bytes()).collect();
    for s in &sent {
        q.send(s).expect("taken");
    }
    drop(q);
    assert!(ended(&probe), "the writer ends once its queue is dropped");
    assert_eq!(chunks(&probe), sent, "every chunk, in order, one write each");
}

/// A3: terminal 1's pipe is blocked; terminal 2's write still reaches its pipe, and it is terminal 2's
/// write that lets terminal 1's pipe go. A shared writer for both would leave terminal 1 to the guard.
#[test]
fn a_blocked_terminal_does_not_hold_up_another() {
    let (p1, probe1) = pipe(true, false, None);
    let (p2, probe2) = pipe(false, false, Some(probe1.release.clone()));
    let q1 = InputQueue::start(p1);
    let q2 = InputQueue::start(p2);
    q1.send(b"stuck").expect("taken");
    probe1.entered.recv_timeout(GUARD).expect("terminal 1's pipe is blocked");
    q2.send(b"other").expect("terminal 2 takes input while terminal 1 is blocked");
    drop(q2);
    assert!(ended(&probe2), "terminal 2's writer ends");
    drop(q1);
    assert!(ended(&probe1), "terminal 1's writer ends");
    assert_eq!(probe1.timed_out.load(Ordering::SeqCst), 0, "terminal 2's write waited behind terminal 1's blocked pipe");
    assert_eq!(chunks(&probe1), vec![b"stuck".to_vec()]);
    assert_eq!(chunks(&probe2), vec![b"other".to_vec()]);
}

/// A4: dropping a queue ends its writer after the chunks already taken are written (the pipe is dropped,
/// so the terminal's input handle goes with it), and the drop itself never waits for a blocked pipe.
#[test]
fn dropping_the_queue_ends_its_writer() {
    let (p, probe) = pipe(false, false, None);
    let q = InputQueue::start(p);
    q.send(b"a").unwrap();
    q.send(b"b").unwrap();
    drop(q);
    assert!(ended(&probe), "the writer (and its pipe) is gone after the drop");
    assert_eq!(chunks(&probe), vec![b"a".to_vec(), b"b".to_vec()], "what was taken before the drop is written");

    // A drop while the pipe is blocked returns first; the writer ends once the pipe lets go.
    let (p, probe) = pipe(true, false, None);
    let q = InputQueue::start(p);
    q.send(b"x").unwrap();
    probe.entered.recv_timeout(GUARD).expect("the pipe is blocked");
    drop(q);
    let _ = probe.release.send(());
    assert!(ended(&probe), "the writer ends after the blocked write");
    assert_eq!(probe.timed_out.load(Ordering::SeqCst), 0, "the drop waited for the blocked pipe");
}

/// A5: after the pipe fails, the writer ends (its pipe is dropped) and later sends are refused with an
/// error; the refused chunk never reaches a pipe.
#[test]
fn after_the_pipe_fails_later_sends_are_refused() {
    let (p, probe) = pipe(false, true, None);
    let q = InputQueue::start(p);
    q.send(b"x").expect("taken before anything failed");
    assert!(ended(&probe), "a failed write ends the writer");
    assert!(q.send(b"y").is_err(), "input to an ended writer is refused");
    assert_eq!(chunks(&probe), vec![b"x".to_vec()]);
}
