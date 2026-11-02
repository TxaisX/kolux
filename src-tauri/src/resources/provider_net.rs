//! T-547 (DT-C32): the one network client for the provider usage checks. A check runs only when
//! the user presses Check now, and asks only an address on one of `provider_usage::HOSTS`.
//! Guards kept here, each tested below:
//! - the address is checked again right before sending (https, default port, no user info, host on
//!   the list), so a caller that skipped the check still cannot send the key elsewhere;
//! - no redirect is followed: a reply that points elsewhere ends the call, so the key goes nowhere else;
//! - the whole call, body included, gets 10 seconds;
//! - the body is read in pieces and cut at 64 KB;
//! - the key travels only in the `Authorization` header, marked sensitive; no message built here
//!   carries the key, the address or any text the provider sent.
//!
//! The saved network proxy applies as it does for every client the app builds (app_http.rs).

use super::app_http::Plan;
use super::app_proxy::Route;
use super::provider_usage::{allowed, Answer, Fetch, NetFail, Secret};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use std::time::Duration;

/// The longest the whole call may take, connect through the last byte of the body.
const TIMEOUT: Duration = Duration::from_secs(10);
/// The most body bytes read; a usage reply is a few hundred bytes.
const BODY_CAP: usize = 64 * 1024;

/// The usage checks' transport. It holds only how to reach the network (the saved proxy plan).
pub struct Net {
    plan: Plan,
    /// Set only by the test constructor: skips the https / host check so a loopback listener can answer.
    #[cfg(test)]
    open: bool,
}

impl Net {
    pub fn new(plan: Plan) -> Net {
        Net {
            plan,
            #[cfg(test)]
            open: false,
        }
    }

    /// Tests only: the address check is skipped (nothing else is), and no proxy is used.
    #[cfg(test)]
    fn loopback() -> Net {
        Net { plan: Plan { route: Route::Direct, http1: false }, open: true }
    }

    fn address_ok(&self, url: &str) -> bool {
        #[cfg(test)]
        if self.open {
            return true;
        }
        allowed(url)
    }

    /// The one client: the saved proxy plan, no redirects, a 10 second limit.
    fn client(&self) -> Result<reqwest::Client, NetFail> {
        let b = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(TIMEOUT);
        let b = match &self.plan.route {
            Route::Default => b,
            Route::Direct => b.no_proxy(),
            Route::Via(p) => b.proxy(reqwest::Proxy::all(p.as_str()).map_err(|_| NetFail::NotMade("the network proxy setting cannot be used by this build".into()))?),
        };
        let b = if self.plan.http1 { b.http1_only() } else { b };
        b.build().map_err(|_| NetFail::NotMade("the connection could not be set up".into()))
    }
}

/// `Bearer <key>` as a header value marked sensitive, so no debug print of the request shows it.
/// The scratch copy of the key is overwritten before it is dropped.
fn bearer(key: &Secret) -> Result<HeaderValue, NetFail> {
    let mut raw = Vec::with_capacity(7 + key.expose().len());
    raw.extend_from_slice(b"Bearer ");
    raw.extend_from_slice(key.expose().as_bytes());
    let made = HeaderValue::from_bytes(&raw);
    raw.fill(0);
    std::hint::black_box(&raw);
    let mut v = made.map_err(|_| NetFail::NotMade("the key has a character that cannot be sent".into()))?;
    v.set_sensitive(true);
    Ok(v)
}

/// A failure of the call itself, told without the address or any text from the provider.
fn failed(e: &reqwest::Error) -> NetFail {
    if e.is_connect() || e.is_timeout() {
        NetFail::Offline
    } else {
        NetFail::NotMade("the provider's answer could not be read".into())
    }
}

impl Fetch for Net {
    fn get(&self, url: &str, key: &Secret) -> Result<Answer, NetFail> {
        if !self.address_ok(url) {
            return Err(NetFail::NotMade("that address is not on the allowed list".into()));
        }
        let auth = bearer(key)?;
        let client = self.client()?;
        tauri::async_runtime::block_on(async {
            let mut reply = client.get(url).header(AUTHORIZATION, auth).send().await.map_err(|e| failed(&e))?;
            let status = reply.status().as_u16();
            // Only a success carries a body worth reading; an error body is the provider's text and is dropped.
            if !(200..300).contains(&status) {
                return Ok(Answer { status, body: String::new() });
            }
            let mut body: Vec<u8> = Vec::new();
            while let Some(chunk) = reply.chunk().await.map_err(|e| failed(&e))? {
                let room = BODY_CAP - body.len();
                body.extend_from_slice(&chunk[..chunk.len().min(room)]);
                if body.len() >= BODY_CAP {
                    break;
                }
            }
            Ok(Answer { status, body: String::from_utf8_lossy(&body).into_owned() })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Instant;

    const KEY: &str = "sk-test-SECRETKEY-0123456789";

    fn key() -> Secret {
        Secret::new(KEY.to_string())
    }

    fn listener() -> (TcpListener, String) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}/v1/balance", l.local_addr().unwrap());
        (l, addr)
    }

    /// Reads one request's head from `s` and returns it.
    fn head(s: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut one = [0u8; 1];
        while !buf.ends_with(b"\r\n\r\n") {
            if s.read(&mut one).unwrap_or(0) == 0 {
                break;
            }
            buf.push(one[0]);
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    /// True when nothing is waiting to connect to `l`.
    fn untouched(l: &TcpListener) -> bool {
        l.set_nonblocking(true).unwrap();
        matches!(l.accept(), Err(e) if e.kind() == std::io::ErrorKind::WouldBlock)
    }

    #[test]
    fn t547_net_a_302_is_not_followed_and_the_key_goes_nowhere_else() {
        let (target, target_url) = listener();
        let (first, first_url) = listener();
        let server = std::thread::spawn(move || {
            let (mut s, _) = first.accept().unwrap();
            let seen = head(&mut s);
            let reply = format!("HTTP/1.1 302 Found\r\nLocation: {target_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            s.write_all(reply.as_bytes()).unwrap();
            seen
        });
        let got = Net::loopback().get(&first_url, &key());
        let seen = server.join().unwrap();
        assert!(seen.to_lowercase().contains("authorization: bearer "), "the key is sent in the header");
        assert_eq!(got, Ok(Answer { status: 302, body: String::new() }));
        assert!(untouched(&target), "the redirect target was never contacted");
    }

    #[test]
    fn t547_net_a_stalled_reply_reads_as_offline_within_about_ten_seconds() {
        let (l, url) = listener();
        let (done, wait) = mpsc::channel::<()>();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = head(&mut s);
            // hold the connection open and say nothing for up to 15 seconds
            let _ = wait.recv_timeout(Duration::from_secs(15));
        });
        let start = Instant::now();
        let got = Net::loopback().get(&url, &key());
        let took = start.elapsed();
        drop(done);
        server.join().unwrap();
        assert_eq!(got, Err(NetFail::Offline));
        assert!(took >= Duration::from_secs(9) && took <= Duration::from_secs(11), "took {took:?}");
    }

    #[test]
    fn t547_net_a_one_megabyte_body_is_cut_at_the_cap() {
        let (l, url) = listener();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = head(&mut s);
            let big = vec![b'a'; 1024 * 1024];
            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", big.len()).as_bytes());
            let _ = s.write_all(&big);
        });
        let got = Net::loopback().get(&url, &key()).unwrap();
        server.join().unwrap();
        assert_eq!(got.status, 200);
        assert_eq!(got.body.len(), BODY_CAP);
    }

    #[test]
    fn t547_net_an_error_status_carries_no_provider_text() {
        let (l, url) = listener();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = head(&mut s);
            let body = format!("bad key {KEY} for you");
            let _ = s.write_all(format!("HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
        });
        let got = Net::loopback().get(&url, &key());
        server.join().unwrap();
        assert_eq!(got, Ok(Answer { status: 401, body: String::new() }));
    }

    #[test]
    fn t547_net_error_texts_never_hold_the_key_or_the_address() {
        // no listener at the address: a refused connection
        let closed = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}/v1/balance", l.local_addr().unwrap())
        };
        let refused = Net::loopback().get(&closed, &key());
        assert_eq!(refused, Err(NetFail::Offline));
        // a key a header cannot carry
        let odd = Net::loopback().get(&closed, &Secret::new(format!("{KEY}\nX-Evil: 1")));
        // a reply that is not http at all
        let (l, url) = listener();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = head(&mut s);
            let _ = s.write_all(b"not http at all\r\n\r\n");
        });
        let garbage = Net::loopback().get(&url, &key());
        server.join().unwrap();
        // an address the real check refuses
        let refused_address = Net::new(Plan { route: Route::Direct, http1: false }).get(&format!("{closed}?k={KEY}"), &key());
        for r in [refused, odd, garbage, refused_address] {
            let text = format!("{r:?}");
            assert!(!text.contains(KEY) && !text.contains("SECRETKEY"), "{text}");
            assert!(!text.contains("127.0.0.1"), "{text}");
        }
        assert_eq!(format!("{:?}", key()), "Secret(****)");
    }

    #[test]
    fn t547_net_the_real_get_refuses_an_address_off_the_rules_without_connecting() {
        let (l, here) = listener();
        let port = l.local_addr().unwrap().port();
        let net = Net::new(Plan { route: Route::Direct, http1: false });
        let refused = [
            here.clone(),                                                 // http, loopback, odd port, not on the list
            "http://api.moonshot.ai/v1/users/me/balance".to_string(),     // not https
            "https://api.moonshot.ai:8443/v1/users/me/balance".to_string(), // not the default port
            "https://me:pw@api.moonshot.ai/v1/users/me/balance".to_string(), // user info
            "https://me@api.moonshot.ai/v1/users/me/balance".to_string(),  // user name only
            "https://evil.example/v1/users/me/balance".to_string(),       // host not on the list
            "https://api.moonshot.ai.evil.example/v1".to_string(),        // look-alike host
            format!("https://127.0.0.1:{port}/v1"),                       // loopback is not on the list
            "not an address".to_string(),
        ];
        for url in refused {
            assert!(matches!(net.get(&url, &key()), Err(NetFail::NotMade(_))), "{url}");
        }
        assert!(untouched(&l), "no connection was opened");
    }
}
