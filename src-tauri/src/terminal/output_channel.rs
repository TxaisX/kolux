//! Flood memory (DT-C244): terminal output reaches each web view through its own IPC channel instead of a
//! broadcast event. A Tauri event runs in the page as one script with the whole batch written into it as
//! text (up to a few hundred KB, a new script every 16 ms frame window), and under an 8-pane flood the web
//! view's JS heap kept those scripts' strings: about 12 MB more every second, to 1.4 GB and still 1.3 GB
//! ten seconds after the floods ended. A channel hands a batch over 8 KB to the page as a fetched response
//! it parses, so the script it runs stays a few hundred bytes. Readers are kept one per web view: a page
//! that reloads and subscribes again replaces its old channel, so the list never grows past the open web
//! views. With no channel subscribed (an older page, a test) the caller falls back to the event.

use std::sync::Mutex;

/// Something one batch can be handed to; false means the reader is gone and is dropped.
pub(crate) trait Reader<B>: Send {
    fn send(&self, batch: B) -> bool;
}

impl<B: tauri::ipc::IpcResponse + Clone + Send> Reader<B> for tauri::ipc::Channel<B> {
    fn send(&self, batch: B) -> bool {
        tauri::ipc::Channel::send(self, batch).is_ok()
    }
}

/// The subscribed web views, keyed by label.
pub(crate) struct Readers<R> {
    list: Mutex<Vec<(String, R)>>,
}

impl<R> Readers<R> {
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

    /// Hands `batch` to every reader and drops the ones whose send failed; false when nobody is
    /// subscribed, so the caller sends the batch the old way instead.
    pub(crate) fn send<B: Clone>(&self, batch: B) -> bool
    where
        R: Reader<B>,
    {
        let mut list = self.list.lock().unwrap_or_else(|e| e.into_inner());
        if list.is_empty() {
            return false;
        }
        list.retain(|(_, r)| r.send(batch.clone()));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Clone)]
    struct Probe {
        got: Arc<Mutex<Vec<u32>>>,
        alive: bool,
    }
    impl Reader<u32> for Probe {
        fn send(&self, batch: u32) -> bool {
            self.got.lock().unwrap().push(batch);
            self.alive
        }
    }
    fn probe(alive: bool) -> Probe {
        Probe { got: Arc::new(Mutex::new(Vec::new())), alive }
    }

    #[test]
    fn nobody_subscribed_means_the_caller_falls_back() {
        let r: Readers<Probe> = Readers::new();
        assert!(!r.send(1u32));
    }

    #[test]
    fn every_reader_gets_every_batch_in_order() {
        let r = Readers::new();
        let (a, b) = (probe(true), probe(true));
        r.set("main", a.clone());
        r.set("other", b.clone());
        for n in 1..=3u32 {
            assert!(r.send(n));
        }
        assert_eq!(*a.got.lock().unwrap(), vec![1, 2, 3]);
        assert_eq!(*b.got.lock().unwrap(), vec![1, 2, 3]);
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
        r.send(7u32);
        assert!(old.got.lock().unwrap().is_empty());
    }

    #[test]
    fn a_reader_whose_send_fails_is_dropped() {
        let r = Readers::new();
        let (dead, live) = (probe(false), probe(true));
        r.set("closed", dead.clone());
        r.set("main", live.clone());
        r.send(1u32);
        r.send(2u32);
        assert_eq!(r.len(), 1);
        assert_eq!(*dead.got.lock().unwrap(), vec![1]);
        assert_eq!(*live.got.lock().unwrap(), vec![1, 2]);
    }
}
