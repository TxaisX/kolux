//! LAG-07: one input queue and one writer thread per terminal.
//!
//! Typing and pasting used to be written to the terminal's pipe on the caller's thread (an async
//! runtime worker). A program that stops reading its input (busy, hung, or swallowing a big paste
//! at about 12 KB/s) then held that worker, and a few stuck terminals could hold every worker.
//!
//! Now a send only copies its bytes onto this terminal's queue and returns at once. The terminal's
//! own writer thread takes the chunks off the queue in the order they were sent and writes each one
//! to the pipe, so a stuck pipe only ever holds that terminal's own writer.

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

/// One terminal's input queue: the sending end of a channel drained by its own writer thread.
pub(crate) struct InputQueue {
    /// `None` only while the queue is being dropped; otherwise the channel's sending end.
    tx: Mutex<Option<Sender<Vec<u8>>>>,
}

impl InputQueue {
    /// Starts this queue's writer thread and returns at once. The thread takes chunks off the queue
    /// one by one, in the order they were sent, and calls `write` once per chunk with exactly that
    /// chunk's bytes. It ends when the queue is dropped and every chunk sent before the drop has
    /// been written, or as soon as a `write` call returns `Err` (the chunks still queued are
    /// discarded). On the way out it drops the receiving end first and then `write`, so once
    /// `write` is gone every later `send` is refused.
    pub(crate) fn start(write: impl FnMut(&[u8]) -> Result<(), String> + Send + 'static) -> InputQueue {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        // A plain thread, not a runtime task: the pipe write may block for as long as the program
        // takes to read, and that wait must never sit on an async runtime worker.
        let _ = std::thread::Builder::new().name("kolux-terminal-input".to_string()).spawn(move || {
            let mut write = write;
            // One write per send, with exactly that send's bytes: `write_shared` decides per
            // call whether the bytes are a terminal reply to convert, so chunks never merge. The
            // loop also ends when the queue was dropped and every chunk it held has been written.
            while let Ok(chunk) = rx.recv() {
                if write(&chunk).is_err() {
                    break;
                }
            }
            drop(rx);
            drop(write);
        });
        InputQueue { tx: Mutex::new(Some(tx)) }
    }

    /// Copies `data` onto the queue and returns at once. Never writes the pipe itself and never
    /// waits for the pipe or for an earlier chunk. `Err` only once the writer has ended.
    pub(crate) fn send(&self, data: &[u8]) -> Result<(), String> {
        let tx = self.tx.lock().unwrap_or_else(|p| p.into_inner());
        match tx.as_ref() {
            Some(tx) => tx.send(data.to_vec()).map_err(|_| "the terminal's input writer has ended".to_string()),
            None => Err("the terminal's input writer has ended".to_string()),
        }
    }
}

impl Drop for InputQueue {
    /// Lets the writer finish the chunks already sent and then end. Returns at once and never joins
    /// the thread: the queue is dropped while the registry lock is held, so waiting for a stuck
    /// pipe here would freeze the whole registry, which is the lag this removes.
    fn drop(&mut self) {
        let tx = self.tx.get_mut().unwrap_or_else(|p| p.into_inner()).take();
        drop(tx);
    }
}
