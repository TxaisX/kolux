//! Flood memory (DT-C244): terminal output, and each terminal's end note after its last output, reach
//! each web view through its own IPC channel instead of a broadcast event. A Tauri event runs in the page
//! as one script with the whole batch written into it as text (up to a few hundred KB, a new script every
//! 16 ms frame window), and under an 8-pane flood the web view's JS heap kept those scripts' strings: about
//! 12 MB more every second, to 1.4 GB and still 1.3 GB ten seconds after the floods ended. A channel hands
//! a message over 8 KB to the page as a fetched response it parses, so the script it runs stays a few
//! hundred bytes. One channel is kept per web view: a page that reloads and subscribes again replaces its
//! old one, a web view that is gone is dropped before each send, and so is a channel whose send fails.
//! When no live channel takes a message the caller sends it as the event instead.

use std::sync::Mutex;

/// Something one message (already JSON) can be handed to; false means the reader is gone.
pub(crate) trait Reader: Clone + Send {
    fn send(&self, json: String) -> bool;
    /// Tells two subscriptions of one web view apart.
    fn key(&self) -> u32;
}

impl Reader for tauri::ipc::Channel {
    fn send(&self, json: String) -> bool {
        tauri::ipc::Channel::send(self, tauri::ipc::InvokeResponseBody::Json(json)).is_ok()
    }
    fn key(&self) -> u32 {
        self.id()
    }
}

/// The subscribed web views, keyed by label.
pub(crate) struct Readers<R> {
    list: Mutex<Vec<(String, R)>>,
}

impl<R: Reader> Readers<R> {
    pub(crate) const fn new() -> Self {
        Self { list: Mutex::new(Vec::new()) }
    }

    /// Subscribes `label`, replacing any channel that web view had before.
    pub(crate) fn set(&self, label: &str, reader: R) {
        let mut list = self.list.lock().unwrap_or_else(|e| e.into_inner());
        list.retain(|(l, _)| l != label);
        list.push((label.to_string(), reader));
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.list.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Hands `message` to every reader whose web view `alive` still finds, serialized once. Readers whose
    /// web view is gone or whose send fails are dropped. Gives `message` back when no reader took it, so
    /// the caller sends it the old way instead. The list lock is not held while sending.
    pub(crate) fn send<B: serde::Serialize>(&self, message: B, alive: impl Fn(&str) -> bool) -> Result<(), B> {
        let readers: Vec<R> = {
            let mut list = self.list.lock().unwrap_or_else(|e| e.into_inner());
            list.retain(|(label, _)| alive(label));
            list.iter().map(|(_, r)| r.clone()).collect()
        };
        if readers.is_empty() {
            return Err(message);
        }
        let Ok(mut json) = serde_json::to_string(&message) else {
            return Err(message);
        };
        let (mut took, mut failed) = (false, Vec::new());
        let last = readers.len() - 1;
        for (i, r) in readers.iter().enumerate() {
            let body = if i == last { std::mem::take(&mut json) } else { json.clone() };
            if r.send(body) {
                took = true;
            } else {
                failed.push(r.key());
            }
        }
        if !failed.is_empty() {
            self.list.lock().unwrap_or_else(|e| e.into_inner()).retain(|(_, r)| !failed.contains(&r.key()));
        }
        if took {
            Ok(())
        } else {
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    static NEXT: AtomicU32 = AtomicU32::new(1);

    #[derive(Clone)]
    struct Probe {
        got: Arc<Mutex<Vec<String>>>,
        alive: bool,
        key: u32,
    }
    impl Reader for Probe {
        fn send(&self, json: String) -> bool {
            self.got.lock().unwrap().push(json);
            self.alive
        }
        fn key(&self) -> u32 {
            self.key
        }
    }
    fn probe(alive: bool) -> Probe {
        Probe { got: Arc::new(Mutex::new(Vec::new())), alive, key: NEXT.fetch_add(1, Ordering::SeqCst) }
    }
    fn all(_: &str) -> bool {
        true
    }

    #[test]
    fn nobody_subscribed_gives_the_message_back() {
        let r: Readers<Probe> = Readers::new();
        assert_eq!(r.send(1u32, all), Err(1));
    }

    #[test]
    fn every_reader_gets_every_message_in_order_serialized_once() {
        let r = Readers::new();
        let (a, b) = (probe(true), probe(true));
        r.set("main", a.clone());
        r.set("other", b.clone());
        for n in 1..=3u32 {
            assert_eq!(r.send(n, all), Ok(()));
        }
        assert_eq!(*a.got.lock().unwrap(), vec!["1", "2", "3"]);
        assert_eq!(*b.got.lock().unwrap(), vec!["1", "2", "3"]);
    }

    #[test]
    fn a_large_last_batch_then_the_exit_keep_their_order_on_one_channel() {
        let r = Readers::new();
        let a = probe(true);
        r.set("main", a.clone());
        let big = "x".repeat(64 * 1024);
        assert!(r.send(serde_json::json!({ "items": [{ "data": big }] }), all).is_ok());
        assert!(r.send(serde_json::json!({ "items": [], "exit": { "id": 1 } }), all).is_ok());
        let got = a.got.lock().unwrap();
        assert_eq!(got.len(), 2);
        assert!(got[0].contains(&big));
        assert!(got[1].contains("\"exit\""));
    }

    #[test]
    fn a_reloaded_page_replaces_its_channel_so_the_list_stays_bounded() {
        let r = Readers::new();
        let old = probe(true);
        r.set("main", old.clone());
        for _ in 0..100 {
            r.set("main", probe(true));
        }
        assert_eq!(r.len(), 1);
        assert!(r.send(7u32, all).is_ok());
        assert!(old.got.lock().unwrap().is_empty());
    }

    #[test]
    fn a_closed_web_view_is_dropped_and_the_message_comes_back() {
        let r = Readers::new();
        let closed = probe(true);
        r.set("closed", closed.clone());
        assert_eq!(r.send(5u32, |label: &str| label != "closed"), Err(5));
        assert_eq!(r.len(), 0);
        assert!(closed.got.lock().unwrap().is_empty());
    }

    #[test]
    fn a_reader_whose_send_fails_is_dropped_and_all_failing_gives_the_message_back() {
        let r = Readers::new();
        let (dead, live) = (probe(false), probe(true));
        r.set("broken", dead.clone());
        r.set("main", live.clone());
        assert!(r.send(1u32, all).is_ok());
        assert!(r.send(2u32, all).is_ok());
        assert_eq!(r.len(), 1);
        assert_eq!(*dead.got.lock().unwrap(), vec!["1"]);
        assert_eq!(*live.got.lock().unwrap(), vec!["1", "2"]);
        let only_dead = Readers::new();
        only_dead.set("broken", probe(false));
        assert_eq!(only_dead.send(3u32, all), Err(3));
        assert_eq!(only_dead.len(), 0);
    }
}
