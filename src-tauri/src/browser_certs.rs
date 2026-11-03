//! T-158 (BROW-024): trusting a self-signed certificate on a local dev server. The rules, kept
//! apart from the engine: approval is offered only for this computer's own addresses, it covers
//! that host and port alone, it is offered only while a matching certificate challenge is pending
//! (an error restored after a restart cannot be approved), only the app sends it (an app command,
//! never the page), and an approved address that later shows a different bad certificate is
//! refused again until approved again. Approvals are revocable and last for the run.
//!
//! The engine side: WebView2's server-certificate-error event (browser_engine.rs) asks
//! [`on_engine`] about every bad certificate. Anything but an approved local site is cancelled,
//! never left to the engine's default error page (which has its own click-through), so a public
//! site has no bypass at all. The failure overlay asks [`Trust::state`] whether to show Trust, and
//! the page's right-click menu offers Stop Trusting for an approved site (`browser_cert`).
use super::popup::loopback;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Url;

/// One host and port, as approved.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Site {
    pub host: String,
    pub port: u16,
}

impl Site {
    /// The https site of an address on this computer; `None` for anything else.
    pub fn local(url: &Url) -> Option<Site> {
        if url.scheme() != "https" {
            return None;
        }
        let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
        if !loopback(&host) {
            return None;
        }
        Some(Site { host, port: url.port_or_known_default()? })
    }
}

/// The certificate rules for one run.
#[derive(Default)]
pub struct Trust {
    /// tab id -> the challenge the engine raised and has not had answered (site, fingerprint)
    pending: HashMap<u32, (Site, String)>,
    /// site -> the one certificate fingerprint the user approved for it
    approved: HashMap<Site, String>,
}

/// What the engine is told for a certificate error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    /// The user approved this exact certificate for this site: load it.
    Allow,
    /// Strict checks: the failure overlay shows; `offer` says whether it may show Approve.
    Refuse { offer: bool },
}

impl Trust {
    /// The engine reports a bad certificate for `url` in `tab`.
    pub fn challenge(&mut self, tab: u32, url: &Url, fingerprint: &str) -> Answer {
        let Some(site) = Site::local(url) else {
            self.pending.remove(&tab);
            return Answer::Refuse { offer: false };
        };
        if self.approved.get(&site).map(String::as_str) == Some(fingerprint) {
            self.pending.remove(&tab);
            return Answer::Allow;
        }
        // A different bad certificate on an approved site is refused until approved again.
        self.approved.remove(&site);
        self.pending.insert(tab, (site, fingerprint.to_string()));
        Answer::Refuse { offer: true }
    }

    /// The user pressed Approve on the overlay of `tab` for `url`. Only a pending challenge for that
    /// exact site can be approved.
    pub fn approve(&mut self, tab: u32, url: &Url) -> Result<(), String> {
        let site = Site::local(url).ok_or("only an https address on this computer can be trusted")?;
        match self.pending.get(&tab) {
            Some((s, fp)) if *s == site => {
                self.approved.insert(site, fp.clone());
                self.pending.remove(&tab);
                Ok(())
            }
            _ => Err("no certificate challenge is waiting for this address; retry the page first".into()),
        }
    }

    /// The user takes the trust back; the next visit shows the failure again.
    pub fn revoke(&mut self, url: &Url) -> bool {
        Site::local(url).is_some_and(|s| self.approved.remove(&s).is_some())
    }

    /// A tab closed or navigated away: its challenge can no longer be answered.
    pub fn forget(&mut self, tab: u32) {
        self.pending.remove(&tab);
    }

    #[cfg(test)]
    pub fn approved(&self) -> Vec<Site> {
        self.approved.keys().cloned().collect()
    }

    /// What the overlay and the menu show for `url` in `tab`.
    pub fn state(&self, tab: u32, url: &Url) -> CertState {
        let site = Site::local(url);
        let offer = site.as_ref().is_some_and(|s| self.pending.get(&tab).is_some_and(|(p, _)| p == s));
        let trusted = site.as_ref().is_some_and(|s| self.approved.contains_key(s));
        CertState { offer, trusted, site: site.map(|s| format!("{}:{}", s.host, s.port)) }
    }
}

/// The overlay's Trust button and the menu's Stop Trusting entry (`browser_cert`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CertState {
    /// A challenge for this local site is waiting in this tab: Trust may show.
    pub offer: bool,
    /// The site is approved for this run: Stop Trusting may show.
    pub trusted: bool,
    /// `host:port` when the address is a local https site.
    pub site: Option<String>,
}

/// What the engine is told: allow (the engine then keeps that for this host and certificate for
/// the session) or cancel. Never the engine's default, whose error page has its own click-through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineAction {
    AlwaysAllow,
    Cancel,
}

pub fn engine_action(a: Answer) -> EngineAction {
    match a {
        Answer::Allow => EngineAction::AlwaysAllow,
        Answer::Refuse { .. } => EngineAction::Cancel,
    }
}

/// The run's certificate rules, shared by the engine event and the app command.
pub static TRUST: LazyLock<Mutex<Trust>> = LazyLock::new(Mutex::default);

/// The certificate's identity: SHA-256 of its PEM text without whitespace, as hex.
pub fn fingerprint(pem: &str) -> String {
    use sha2::{Digest, Sha256};
    let body: String = pem.chars().filter(|c| !c.is_whitespace()).collect();
    Sha256::digest(body.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// The engine reports a bad certificate for `uri` in `tab` (WebView2 ServerCertificateErrorDetected):
/// what to tell it. An address that does not parse, or a certificate the engine could not show
/// (no fingerprint to approve), is refused with no offer.
pub fn on_engine(trust: &mut Trust, tab: u32, uri: &str, fingerprint: &str) -> EngineAction {
    let answer = match Url::parse(uri) {
        Ok(url) if !fingerprint.is_empty() => trust.challenge(tab, &url, fingerprint),
        _ => {
            trust.forget(tab);
            Answer::Refuse { offer: false }
        }
    };
    engine_action(answer)
}

/// `browser_cert` actions: `state`, `trust` (approve the waiting challenge) or `revoke`.
pub fn act(trust: &mut Trust, tab: u32, url: &str, action: &str) -> Result<CertState, String> {
    let url = Url::parse(url).map_err(|_| format!("{url} is not an address"))?;
    match action {
        "state" => {}
        "trust" => trust.approve(tab, &url)?,
        "revoke" => {
            trust.revoke(&url);
        }
        other => return Err(format!("unknown certificate action {other}")),
    }
    Ok(trust.state(tab, &url))
}

/// The app's command (never the page's): the overlay's Trust, the menu's Stop Trusting, and the
/// state both read. A revoke that dropped a trust also clears the engine's remembered allowances, so
/// the next visit is asked again (other approved sites are then simply allowed again by these rules);
/// one that dropped nothing leaves them alone (T-661).
#[tauri::command]
pub async fn browser_cert(app: tauri::AppHandle, id: u32, url: String, action: String) -> Result<CertState, String> {
    let (state, dropped) = {
        let mut t = TRUST.lock().map_err(|_| "the certificate rules are not available".to_string())?;
        let before = t.approved.len();
        let state = act(&mut t, id, &url, &action)?;
        (state, t.approved.len() < before)
    };
    if dropped {
        super::engine::clear_certificate_allowances(&app);
    }
    Ok(state)
}

/// A tab closed: its waiting challenge can no longer be answered.
pub fn closed(tab: u32) {
    if let Ok(mut t) = TRUST.lock() {
        t.forget(tab);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn brow024_approval_covers_one_local_host_and_port_and_no_other_tab_or_port() {
        let mut t = Trust::default();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true });
        t.approve(1, &u("https://localhost:8443/app")).unwrap();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/other"), "AA"), Answer::Allow);
        // another tab on the same site with the same certificate: the approval is the site's
        assert_eq!(t.challenge(2, &u("https://localhost:8443/"), "AA"), Answer::Allow);
        // another port stays strict
        assert_eq!(t.challenge(1, &u("https://localhost:9443/"), "AA"), Answer::Refuse { offer: true });
        assert_eq!(t.approved(), vec![Site { host: "localhost".into(), port: 8443 }]);
    }

    #[test]
    fn brow024_public_hosts_and_lookalikes_are_never_offered() {
        let mut t = Trust::default();
        for a in ["https://example.com/", "https://localhost.example.com/", "https://10.0.0.2/", "http://localhost:8080/"] {
            assert_eq!(t.challenge(1, &u(a), "AA"), Answer::Refuse { offer: false }, "{a}");
            assert!(t.approve(1, &u(a)).is_err(), "{a}");
        }
        assert_eq!(t.challenge(1, &u("https://127.0.0.1:8443/"), "AA"), Answer::Refuse { offer: true });
        assert_eq!(t.challenge(1, &u("https://[::1]:8443/"), "AA"), Answer::Refuse { offer: true });
    }

    #[test]
    fn brow024_no_approval_without_a_pending_challenge_for_that_site() {
        let mut t = Trust::default();
        // an overlay restored after a restart: nothing pending
        assert!(t.approve(1, &u("https://localhost:8443/")).is_err());
        t.challenge(1, &u("https://localhost:8443/"), "AA");
        // a different site than the one challenged
        assert!(t.approve(1, &u("https://localhost:9443/")).is_err());
        // the tab navigated away or closed
        t.forget(1);
        assert!(t.approve(1, &u("https://localhost:8443/")).is_err());
    }

    #[test]
    fn brow024_a_different_bad_certificate_is_refused_again_and_trust_can_be_revoked() {
        let mut t = Trust::default();
        t.challenge(1, &u("https://localhost:8443/"), "AA");
        t.approve(1, &u("https://localhost:8443/")).unwrap();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "BB"), Answer::Refuse { offer: true });
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true }, "the old approval is gone");
        t.approve(1, &u("https://localhost:8443/")).unwrap();
        assert!(t.revoke(&u("https://localhost:8443/x")));
        assert!(!t.revoke(&u("https://localhost:8443/x")));
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true });
    }

    #[test]
    fn brow024_the_engine_is_told_allow_only_for_an_approved_local_certificate_and_cancel_otherwise() {
        let mut t = Trust::default();
        // a public site: cancelled, never the engine's default page with its own click-through
        assert_eq!(on_engine(&mut t, 1, "https://expired.example.com/", "AA"), EngineAction::Cancel);
        assert!(!t.state(1, &u("https://expired.example.com/")).offer);
        assert_eq!(on_engine(&mut t, 1, "not an address", "AA"), EngineAction::Cancel);
        assert_eq!(on_engine(&mut t, 1, "https://localhost:5173/", ""), EngineAction::Cancel);
        assert!(!t.state(1, &u("https://localhost:5173/")).offer, "an unreadable certificate is never offered");
        // a local dev server: cancelled until the user approves, then allowed
        assert_eq!(on_engine(&mut t, 1, "https://localhost:5173/", "AA"), EngineAction::Cancel);
        assert_eq!(t.state(1, &u("https://localhost:5173/x")), CertState { offer: true, trusted: false, site: Some("localhost:5173".into()) });
        act(&mut t, 1, "https://localhost:5173/", "trust").unwrap();
        assert_eq!(on_engine(&mut t, 1, "https://localhost:5173/", "AA"), EngineAction::AlwaysAllow);
        assert_eq!(engine_action(Answer::Refuse { offer: true }), EngineAction::Cancel);
    }

    #[test]
    fn brow024_the_app_command_trusts_only_a_waiting_challenge_and_revokes_per_origin() {
        let mut t = Trust::default();
        assert!(act(&mut t, 1, "https://localhost:8443/", "trust").is_err(), "nothing waiting");
        assert!(act(&mut t, 1, "https://example.com/", "trust").is_err(), "public: never");
        on_engine(&mut t, 1, "https://localhost:8443/", "AA");
        on_engine(&mut t, 2, "https://127.0.0.1:3000/", "BB");
        assert!(act(&mut t, 1, "https://localhost:8443/", "trust").unwrap().trusted);
        assert!(act(&mut t, 2, "https://127.0.0.1:3000/", "trust").unwrap().trusted);
        let after = act(&mut t, 1, "https://localhost:8443/", "revoke").unwrap();
        assert_eq!((after.offer, after.trusted), (false, false));
        assert!(act(&mut t, 2, "https://127.0.0.1:3000/", "state").unwrap().trusted, "another origin keeps its trust");
        assert!(act(&mut t, 1, "https://localhost:8443/", "drop").is_err());
        assert!(act(&mut t, 1, "nope", "state").is_err());
    }

    #[test]
    fn brow024_fingerprint_ignores_line_breaks_and_tells_certificates_apart() {
        let a = "-----BEGIN CERTIFICATE-----\r\nMIIB\r\nAAAA\r\n-----END CERTIFICATE-----\r\n";
        let b = "-----BEGIN CERTIFICATE-----\nMIIBAAAA\n-----END CERTIFICATE-----";
        assert_eq!(fingerprint(a), fingerprint(b));
        assert_eq!(fingerprint(a).len(), 64);
        assert_ne!(fingerprint(a), fingerprint("-----BEGIN CERTIFICATE-----\nMIIBAAAB\n-----END CERTIFICATE-----"));
    }
}
