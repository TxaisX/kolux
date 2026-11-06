//! T-293 (APP-030): an update whose Windows signature does not match is stopped, with no bypass.
//!
//! The minisign check in `update.rs` proves a download came from Kolux's release job. This adds
//! the Windows publisher check on top: before a downloaded installer is kept as "ready", its
//! Authenticode signature is read with Windows' own `Get-AuthenticodeSignature` (Windows
//! PowerShell from the system folder, never one found on PATH) and compared with the running
//! program's own signature, or with the publisher pinned into the build (`KOLUX_RS_PUBLISHER` at
//! build time). The rules, in `decide`:
//!
//! - An installer whose contents do not match its signature (`HashMismatch`) is always refused.
//! - A signed copy (or a build with a pinned publisher) takes only an installer validly signed by
//!   that same publisher. An unsigned installer or another publisher is refused. Publishers are
//!   compared by certificate subject, so a renewed certificate of the same publisher still updates.
//! - An unsigned copy (today's releases and development copies) takes an unsigned installer or a
//!   validly signed one: the minisign key has already vouched for it.
//! - An unclear answer (the tool failed, timed out, or reported a status that is not a definite
//!   verdict) stops that one download and is not remembered, so the next check tries again (FIX-2).
//!   A copy built signed (`KOLUX_RS_SIGNED_BUILD=1`) that cannot read its own signature updates
//!   nothing; a copy not built signed treats an unreadable own signature as unsigned.
//!
//! There is no setting, variable or argument that skips this. A refused installer is written to the
//! store by its SHA-256 and update signature, never by version, and is not offered again
//! (`update_check` filters it by signature).

use std::path::Path;
use std::time::{Duration, Instant};

/// The store key holding refused installers (JSON, newest last). The earlier version-keyed
/// `update.refusedVersions` list is never read.
pub const KEY_REFUSED: &str = "update.refusedInstallers";
/// The refused list keeps this many installers.
const REFUSED_KEEP: usize = 20;
/// The release job builds this in as `1` when it signs the copy (FIX-2 FS1).
pub const SIGNED_BUILD: bool = match option_env!("KOLUX_RS_SIGNED_BUILD") {
    Some(v) => v.len() == 1 && v.as_bytes()[0] == b'1',
    None => false,
};
/// A signature read that has not answered by then is given up (FIX-2 AFTER 1).
pub const SIGNATURE_LIMIT: Duration = Duration::from_secs(20);
/// The publisher (certificate subject) pinned into a signed release build, if the release job set it.
/// Unset today. TODO(signing): the release job sets it from the signing certificate's subject once
/// Authenticode signing exists; until then a signed copy trusts its own signature's subject.
pub const PINNED_PUBLISHER: Option<&str> = non_blank(option_env!("KOLUX_RS_PUBLISHER"));
/// The marker the page reads to show the security stop card (no install button).
pub const REFUSED_MARK: &str = "update:refused|";

/// One file's Authenticode signature as Windows reports it.
#[derive(Debug, Clone, PartialEq)]
pub enum SignState {
    /// A valid signature that chains to a trusted root.
    Signed { subject: String, issuer: String, thumbprint: String },
    /// No signature at all.
    Unsigned,
    /// The installer's contents do not match its signature: a definite refusal.
    Broken(String),
    /// The signature could not be read (the system tool failed or was missing).
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Install,
    /// A definite refusal: the installer is remembered and not offered again.
    Stop(String),
    /// An unclear answer: this download is stopped, nothing is remembered, the next check tries again.
    Retry(String),
}

/// Reads `Get-AuthenticodeSignature`'s answer, printed as `{"status":..,"subject":..,"thumbprint":..}`.
pub fn parse_report(json: &str) -> SignState {
    #[derive(serde::Deserialize)]
    struct Report {
        status: Option<String>,
        subject: Option<String>,
        #[serde(default)]
        issuer: Option<String>,
        thumbprint: Option<String>,
    }
    let Ok(r) = serde_json::from_str::<Report>(json.trim()) else {
        return SignState::Unknown("the signature check gave no readable answer".into());
    };
    let status = r.status.unwrap_or_default();
    match status.as_str() {
        "Valid" => {
            let subject = r.subject.unwrap_or_default();
            if subject.trim().is_empty() {
                SignState::Broken("a valid signature without a publisher".into())
            } else {
                SignState::Signed { subject, issuer: r.issuer.unwrap_or_default(), thumbprint: r.thumbprint.unwrap_or_default() }
            }
        }
        "NotSigned" => SignState::Unsigned,
        "HashMismatch" => SignState::Broken("HashMismatch".into()),
        "" => SignState::Unknown("the signature check gave no status".into()),
        other => SignState::Unknown(format!("Windows could not confirm the signature: {other}")),
    }
}

/// A certificate subject in one comparable form: parts trimmed, case folded.
pub fn same_publisher(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.split(',').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect::<Vec<_>>();
    let (x, y) = (norm(a), norm(b));
    !x.is_empty() && x == y
}

/// The common name of a subject, for messages (`CN=Example Ltd, O=...` -> `Example Ltd`).
pub fn publisher_name(subject: &str) -> String {
    subject
        .split(',')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("CN=").or_else(|| p.strip_prefix("cn=")))
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_else(|| subject.trim().to_string())
}

fn stop(why: String) -> Verdict {
    Verdict::Stop(format!("Kolux refused this update: {why} It will not be offered again. Your current version keeps working."))
}

fn retry(why: String) -> Verdict {
    Verdict::Retry(format!("Kolux did not install this update: {why} It will try again next time. Your current version keeps working."))
}

/// The decision: may this installer replace the running copy? `signed_build` is `SIGNED_BUILD`.
pub fn decide(running: &SignState, installer: &SignState, pinned: Option<&str>, signed_build: bool) -> Verdict {
    if let SignState::Broken(s) = installer {
        return stop(format!("the installer's contents do not match its Windows signature ({s})."));
    }
    let pin = pinned.map(str::trim).filter(|p| !p.is_empty());
    let expected: Option<String> = match (pin, running) {
        (Some(p), _) => Some(p.to_string()),
        (None, SignState::Signed { subject, .. }) => Some(subject.clone()),
        (None, SignState::Unsigned) => None,
        (None, SignState::Broken(s)) => {
            return retry(format!("this copy's own Windows signature is damaged ({s}), so no publisher can be trusted. Reinstall Kolux from its releases page."));
        }
        (None, SignState::Unknown(why)) if signed_build => {
            return retry(format!("this copy's own Windows signature could not be checked ({why})."));
        }
        // A copy not built signed that cannot read its own signature counts as unsigned.
        (None, SignState::Unknown(_)) => None,
    };
    if let SignState::Unknown(why) = installer {
        return retry(format!("the installer's Windows signature could not be checked ({why})."));
    }
    match (expected, installer) {
        (Some(want), SignState::Signed { subject, .. }) if same_publisher(&want, subject) => Verdict::Install,
        (Some(want), SignState::Signed { subject, .. }) => stop(format!(
            "the installer is signed by {} but Kolux is published by {}.",
            publisher_name(subject),
            publisher_name(&want)
        )),
        (Some(want), SignState::Unsigned) => stop(format!("the installer is not signed, but Kolux is signed by {}.", publisher_name(&want))),
        (None, SignState::Signed { .. }) | (None, SignState::Unsigned) => Verdict::Install,
        (_, SignState::Broken(_) | SignState::Unknown(_)) => unreachable!("handled above"),
    }
}

/// The certificate authority pinned into a signed release build, if the release job set it
/// (`KOLUX_RS_PUBLISHER_ISSUER`, the issuer line of the signing certificate). Unset today: no
/// issuer is checked. TODO(signing): set it from the real certificate once Authenticode signing exists.
pub const PINNED_ISSUER: Option<&str> = non_blank(option_env!("KOLUX_RS_PUBLISHER_ISSUER"));

/// A build env var set to nothing (`KOLUX_RS_PUBLISHER=`) is "unset", not a pin: a blank or
/// whitespace-only value reads as `None`.
pub const fn non_blank(v: Option<&'static str>) -> Option<&'static str> {
    let Some(s) = v else { return None };
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_whitespace() {
            return v;
        }
        i += 1;
    }
    None
}

/// The publisher and certificate authority a build pins, each `None` when the build sets none.
#[derive(Clone, Copy, Default)]
pub struct Pins<'a> {
    pub subject: Option<&'a str>,
    pub issuer: Option<&'a str>,
}

/// `decide`, plus the issuer pin (FIX-2 AFTER 4): an installer that passed the subject check must
/// also come from the pinned certificate authority. A blank or missing pin changes nothing.
pub fn decide_pinned(running: &SignState, installer: &SignState, pinned: Option<&str>, pinned_issuer: Option<&str>, signed_build: bool) -> Verdict {
    let verdict = decide(running, installer, pinned, signed_build);
    let Some(want) = pinned_issuer.map(str::trim).filter(|p| !p.is_empty()) else { return verdict };
    if verdict != Verdict::Install {
        return verdict;
    }
    match installer {
        SignState::Signed { issuer, .. } if same_publisher(want, issuer) => Verdict::Install,
        SignState::Signed { issuer, .. } => {
            let got = if issuer.trim().is_empty() { "no named authority".to_string() } else { publisher_name(issuer) };
            stop(format!("the installer's certificate was issued by {got} but Kolux's is issued by {}.", publisher_name(want)))
        }
        _ => stop(format!("the installer is not signed, but Kolux's certificate is issued by {}.", publisher_name(want))),
    }
}

/// What `update_mark("refusedInstallers", ..)` may store: the list can be emptied, never added to.
pub fn refused_reset_value(value: &str) -> Result<&'static str, String> {
    if value.trim().is_empty() { Ok("[]") } else { Err("the refused-installer list can only be cleared".into()) }
}

/// The installer copy being checked. Smallest fix for the check-then-use race: it is created fresh
/// (`create_new`, so nothing planted is reused), reopened read-only with sharing that denies other
/// writers, deleters and renamers, read back against the verified bytes, and kept open while the
/// signature tool reads it. Dropping it removes the file. It guards the copy being CHECKED only: the
/// installer that finally runs is a separate temp file the updater plugin writes and nothing here
/// holds. One open with write access would be tighter, but Windows' signature tool then cannot read it.
pub struct HeldCopy {
    path: std::path::PathBuf,
    file: Option<std::fs::File>,
}

impl HeldCopy {
    pub fn create_at(path: &Path, bytes: &[u8]) -> std::io::Result<HeldCopy> {
        Self::create_at_with_gap(path, bytes, || {})
    }

    /// `gap` runs between the write and the reopen; a swap there is caught by the read-back.
    fn create_at_with_gap(path: &Path, bytes: &[u8], gap: impl FnOnce()) -> std::io::Result<HeldCopy> {
        use std::io::{Read, Write};
        let mut w = std::fs::OpenOptions::new().write(true).create_new(true).open(path)?;
        if let Err(e) = w.write_all(bytes).and_then(|()| w.sync_all()) {
            drop(w);
            let _ = std::fs::remove_file(path);
            return Err(e);
        }
        drop(w);
        gap();
        let mut held = HeldCopy { path: path.to_path_buf(), file: None };
        let mut ro = std::fs::OpenOptions::new();
        ro.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            ro.share_mode(1); // FILE_SHARE_READ only
        }
        let mut f = ro.open(path)?;
        let mut back = Vec::with_capacity(bytes.len());
        f.read_to_end(&mut back)?;
        if back != bytes {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "the copy changed before it could be held"));
        }
        held.file = Some(f);
        Ok(held)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for HeldCopy {
    fn drop(&mut self) {
        self.file = None;
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Writes the downloaded installer to `dir`, checks it with `check` against the running copy's
/// signature, and removes the file again. The installer itself is never started here.
pub fn vet(bytes: &[u8], dir: &Path, version: &str, running: &SignState, pins: Pins, signed_build: bool, check: impl Fn(&Path) -> SignState) -> Verdict {
    let safe: String = version.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let file = dir.join(format!("kolux-rs-update-{safe}-{}-{nonce}.exe", std::process::id()));
    let installer = match std::fs::create_dir_all(dir).and_then(|()| HeldCopy::create_at(&file, bytes)) {
        Ok(held) => check(held.path()),
        Err(e) => SignState::Unknown(format!("the download could not be written for the check: {}", e.kind())),
    };
    decide_pinned(running, &installer, pins.subject, pins.issuer, signed_build)
}

/// One installer stopped for its publisher. It is known by its own bytes (SHA-256) and by the update
/// signature the feed gave with it, never by the version string, so a stale installer served under
/// a new version number cannot block the real release (FIX-2 FS2).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Refused {
    pub sha256: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub version: String,
}

fn refused_list(list: Option<&str>) -> Vec<Refused> {
    // A damaged list reads as empty.
    list.and_then(|l| serde_json::from_str::<Vec<Refused>>(l).ok()).unwrap_or_default()
}

/// The SHA-256 of an installer, as lower-case hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Adds a refused installer to the stored list (no repeats by SHA-256, newest kept).
pub fn refused_add(list: Option<&str>, entry: Refused) -> String {
    let mut v = refused_list(list);
    v.retain(|r| !r.sha256.eq_ignore_ascii_case(&entry.sha256));
    v.push(entry);
    let over = v.len().saturating_sub(REFUSED_KEEP);
    v.drain(..over);
    serde_json::to_string(&v).unwrap_or_else(|_| "[]".into())
}

/// Whether this installer (by its bytes, once downloaded) or this update signature (at check time,
/// before any download) was refused before.
pub fn refused_has(list: Option<&str>, sha256: Option<&str>, signature: &str) -> bool {
    let signature = signature.trim();
    refused_list(list).iter().any(|r| sha256.is_some_and(|h| h.eq_ignore_ascii_case(&r.sha256)) || (!signature.is_empty() && r.signature.trim() == signature))
}

/// Runs `cmd` and gives its standard output, or `None` when it fails to start, exits with an
/// error, or is still running after `limit` (it is then ended).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn bounded_output(mut cmd: std::process::Command, limit: Duration) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut child = cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    // The answer is one short line; reading it on its own thread keeps a full pipe from stalling the wait.
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let until = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let buf = reader.join().ok()?;
    status.success().then_some(buf)
}

/// Windows' own System32 folder, asked of Windows rather than read from an environment variable
/// the caller could have changed (FIX-2 AFTER 2).
#[cfg(windows)]
pub fn system_dir() -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let mut buf = vec![0u16; 520];
    // SAFETY: the buffer is valid for `buf.len()` UTF-16 units and Windows writes at most that many.
    let n = unsafe { windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
    (n > 0 && n < buf.len()).then(|| std::ffi::OsString::from_wide(&buf[..n]).into())
}

/// Reads one file's signature with Windows' own tool. The path travels in an environment
/// variable, never inside the script text.
#[cfg(windows)]
pub fn check_file(path: &Path) -> SignState {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Some(sys) = system_dir() else { return SignState::Unknown("Windows' system folder could not be found".into()) };
    let ps = sys.join(r"WindowsPowerShell\v1.0\powershell.exe");
    let script = "$ErrorActionPreference='Stop'; $s = Get-AuthenticodeSignature -LiteralPath $env:KOLUX_RS_SIG_FILE; \
        $c = $s.SignerCertificate; \
        [pscustomobject]@{ status = [string]$s.Status; subject = $(if ($c) { $c.Subject } else { '' }); issuer = $(if ($c) { $c.Issuer } else { '' }); thumbprint = $(if ($c) { $c.Thumbprint } else { '' }) } | ConvertTo-Json -Compress";
    let mut cmd = std::process::Command::new(ps);
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).env("KOLUX_RS_SIG_FILE", path).creation_flags(CREATE_NO_WINDOW);
    match bounded_output(cmd, SIGNATURE_LIMIT) {
        Some(out) => parse_report(&String::from_utf8_lossy(&out)),
        None => SignState::Unknown("the Windows signature check failed or took too long".into()),
    }
}

/// Authenticode is a Windows matter; other systems have no publisher signature to compare.
#[cfg(not(windows))]
pub fn check_file(_path: &Path) -> SignState {
    SignState::Unsigned
}

/// The running program's own signature.
pub fn running_state() -> SignState {
    match std::env::current_exe() {
        Ok(p) => check_file(&p),
        Err(e) => SignState::Unknown(format!("this copy's own program could not be found: {}", e.kind())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACME: &str = "CN=Acme Tools Ltd, O=Acme Tools Ltd, L=Leeds, C=GB";
    fn signed(subject: &str, thumb: &str) -> SignState {
        SignState::Signed { subject: subject.into(), issuer: String::new(), thumbprint: thumb.into() }
    }
    fn signed_by(subject: &str, issuer: &str) -> SignState {
        SignState::Signed { subject: subject.into(), issuer: issuer.into(), thumbprint: "T".into() }
    }
    fn stopped(v: Verdict) -> String {
        match v {
            Verdict::Stop(why) => why,
            other => panic!("expected a stop, got {other:?}"),
        }
    }
    fn retried(v: Verdict) -> String {
        match v {
            Verdict::Retry(why) => why,
            other => panic!("expected a one-time stop, got {other:?}"),
        }
    }
    fn unknown() -> SignState {
        SignState::Unknown("tool failed".into())
    }

    #[test]
    fn reports_from_the_windows_tool_are_read() {
        assert_eq!(parse_report(r#"{"status":"Valid","subject":"CN=Acme Tools Ltd","thumbprint":"AB12"}"#), signed("CN=Acme Tools Ltd", "AB12"));
        assert_eq!(parse_report(r#"{"status":"NotSigned","subject":"","thumbprint":""}"#), SignState::Unsigned);
        assert_eq!(parse_report(r#"{"status":"HashMismatch","subject":"CN=Acme Tools Ltd","thumbprint":"AB12"}"#), SignState::Broken("HashMismatch".into()));
        // FIX-2 FB1: anything that is not a definite verdict is unclear, not a refusal.
        for status in ["NotTrusted", "UnknownError", "Incompatible", "NotSupportedFileFormat"] {
            assert!(matches!(parse_report(&format!(r#"{{"status":"{status}","subject":"CN=Self","thumbprint":"CD"}}"#)), SignState::Unknown(_)), "{status}");
        }
        assert!(matches!(parse_report(r#"{"status":"Valid","subject":" ","thumbprint":"AB"}"#), SignState::Broken(_)));
        assert!(matches!(parse_report("garbage"), SignState::Unknown(_)));
        assert!(matches!(parse_report("{}"), SignState::Unknown(_)));
    }

    #[test]
    fn a_signed_copy_takes_only_its_own_publisher() {
        let running = signed(ACME, "OLD1");
        for build in [false, true] {
            // A renewed certificate (new thumbprint, same subject, other spacing and case) still updates.
            assert_eq!(decide(&running, &signed("cn=Acme Tools Ltd,O=Acme Tools Ltd, L=Leeds,  C=GB", "NEW2"), None, build), Verdict::Install);
            let why = stopped(decide(&running, &signed("CN=Mallory Software, O=Mallory", "EV1"), None, build));
            assert!(why.contains("Mallory Software") && why.contains("Acme Tools Ltd"), "{why}");
            assert!(why.contains("not be offered again"), "{why}");
            assert!(stopped(decide(&running, &SignState::Unsigned, None, build)).contains("not signed"));
            assert!(stopped(decide(&running, &SignState::Broken("HashMismatch".into()), None, build)).contains("HashMismatch"));
        }
    }

    // FIX-2 FB1: an unclear answer stops this one download and is not a refusal to remember.
    #[test]
    fn an_unclear_signature_answer_stops_one_download_only() {
        let running = signed(ACME, "OLD1");
        for build in [false, true] {
            let why = retried(decide(&running, &unknown(), None, build));
            assert!(why.contains("could not be checked") && why.contains("try again next time"), "{why}");
            assert!(!why.contains("not be offered again"), "{why}");
            retried(decide(&SignState::Unsigned, &unknown(), None, build));
            retried(decide(&SignState::Unsigned, &unknown(), Some(ACME), build));
        }
    }

    #[test]
    fn a_pinned_publisher_wins_over_the_running_signature() {
        // Pinned build: the installer must carry the pinned publisher, whatever the copy reports.
        assert_eq!(decide(&SignState::Unsigned, &signed(ACME, "X"), Some(ACME), false), Verdict::Install);
        assert!(matches!(decide(&SignState::Unsigned, &SignState::Unsigned, Some(ACME), false), Verdict::Stop(_)));
        assert!(matches!(decide(&signed("CN=Other", "Y"), &signed("CN=Other", "Y"), Some(ACME), false), Verdict::Stop(_)));
        assert_eq!(decide(&unknown(), &signed(ACME, "X"), Some(ACME), true), Verdict::Install);
        // An empty pin counts as no pin.
        assert_eq!(decide(&SignState::Unsigned, &SignState::Unsigned, Some("  "), false), Verdict::Install);
    }

    #[test]
    fn an_unsigned_copy_takes_clear_answers_and_stops_a_mismatch() {
        assert_eq!(decide(&SignState::Unsigned, &SignState::Unsigned, None, false), Verdict::Install);
        assert_eq!(decide(&SignState::Unsigned, &signed(ACME, "X"), None, false), Verdict::Install);
        assert!(matches!(decide(&SignState::Unsigned, &SignState::Broken("HashMismatch".into()), None, false), Verdict::Stop(_)));
    }

    // Follow-up guards (already correct on main): a "Valid" status with no publisher is a definite
    // refusal, not an unclear answer that retries, whatever the running copy is.
    #[test]
    fn a_valid_signature_with_an_empty_publisher_is_refused_for_good() {
        for json in [
            r#"{"status":"Valid","subject":"","thumbprint":"AB"}"#,
            r#"{"status":"Valid","subject":null,"thumbprint":"AB"}"#,
            r#"{"status":"Valid","thumbprint":"AB"}"#,
        ] {
            let parsed = parse_report(json);
            assert!(matches!(parsed, SignState::Broken(_)), "{json} -> {parsed:?}");
            for running in [SignState::Unsigned, signed(ACME, "X"), unknown()] {
                for build in [false, true] {
                    assert!(matches!(decide(&running, &parsed, None, build), Verdict::Stop(_)), "{json} against {running:?}, signed_build {build}");
                }
            }
            assert!(matches!(decide(&SignState::Unsigned, &parsed, Some(ACME), false), Verdict::Stop(_)), "{json} against a pinned publisher");
        }
    }

    // Follow-up guards (already correct on main): an unsigned running copy still refuses a HashMismatch
    // installer, with or without a pin, and whether or not it was built signed.
    #[test]
    fn an_unsigned_running_copy_still_refuses_a_hash_mismatch_installer() {
        let mismatch = parse_report(r#"{"status":"HashMismatch","subject":"CN=Acme Tools Ltd","thumbprint":"AB12"}"#);
        assert_eq!(mismatch, SignState::Broken("HashMismatch".into()));
        for build in [false, true] {
            for pin in [None, Some(ACME)] {
                assert!(stopped(decide(&SignState::Unsigned, &mismatch, pin, build)).contains("HashMismatch"), "pin {pin:?}, signed_build {build}");
            }
        }
        // A copy that cannot read its own signature counts as unsigned when not built signed: same refusal.
        assert!(matches!(decide(&unknown(), &mismatch, None, false), Verdict::Stop(_)));
    }

    // FIX-2 FS1: only a copy built signed is stopped by an unreadable own signature.
    #[test]
    fn a_copy_built_signed_never_updates_when_it_cannot_read_its_own_signature() {
        for installer in [signed(ACME, "X"), SignState::Unsigned] {
            retried(decide(&unknown(), &installer, None, true));
            // not built signed: the unreadable own signature counts as unsigned, the update key vouches
            assert_eq!(decide(&unknown(), &installer, None, false), Verdict::Install);
            // a damaged own signature is never trusted either way, and is not remembered against the installer
            assert!(retried(decide(&SignState::Broken("HashMismatch".into()), &installer, None, false)).contains("Reinstall"));
        }
    }

    #[test]
    fn vet_checks_a_temporary_copy_and_removes_it() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-{}-{}", std::process::id(), line!()));
        let seen = std::cell::RefCell::new(None);
        let v = vet(b"MZ fake installer", &dir, "1.2.3", &signed(ACME, "A"), Pins::default(), false, |p| {
            *seen.borrow_mut() = Some((p.to_path_buf(), std::fs::read(p).unwrap()));
            signed("CN=Mallory", "B")
        });
        assert!(matches!(v, Verdict::Stop(_)));
        let (path, bytes) = seen.into_inner().unwrap();
        assert_eq!(bytes, b"MZ fake installer");
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("kolux-rs-update-1.2.3-"));
        assert!(!path.exists(), "the checked copy is removed");
        // An odd version string never escapes the folder.
        let v = vet(b"x", &dir, "../../evil", &SignState::Unsigned, Pins::default(), false, |p| {
            assert_eq!(p.parent().unwrap(), dir.as_path());
            SignState::Unsigned
        });
        assert_eq!(v, Verdict::Install);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn entry(bytes: &[u8], signature: &str, version: &str) -> Refused {
        Refused { sha256: sha256_hex(bytes), signature: signature.into(), version: version.into() }
    }

    // FIX-2 FS2: a refused installer is known by its bytes and update signature, not its version.
    #[test]
    fn a_refused_installer_is_known_by_its_bytes_not_its_version() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let l = refused_add(None, entry(b"stale installer", "SIG-OLD", "1.1.0"));
        assert!(refused_has(Some(&l), Some(&sha256_hex(b"stale installer")), "other-sig"), "same bytes under another version are still refused");
        assert!(refused_has(Some(&l), None, " SIG-OLD "), "the feed's signature is known before any download");
        // the real release under the same version number is a different file and is offered
        assert!(!refused_has(Some(&l), Some(&sha256_hex(b"the real release")), "SIG-NEW"));
        assert!(!refused_has(Some(&l), None, "") && !refused_has(None, Some("x"), "x"));
        // the earlier version-keyed list, or a damaged one, forgets nothing and refuses nothing
        assert!(!refused_has(Some("1.0.0\n1.1.0"), None, "1.1.0") && !refused_has(Some("{"), None, "SIG-OLD"));
    }

    #[test]
    fn the_refused_list_keeps_each_installer_once_and_only_the_newest_twenty() {
        let l = refused_add(None, entry(b"a", "s1", "1.0.0"));
        let l = refused_add(Some(&l), entry(b"b", "s2", "1.1.0"));
        let l = refused_add(Some(&l), entry(b"a", "s1", "1.0.0"));
        assert_eq!(refused_list(Some(&l)).iter().map(|r| r.signature.as_str()).collect::<Vec<_>>(), ["s2", "s1"]);
        let mut l = String::new();
        for i in 0..30 {
            l = refused_add(Some(&l), entry(format!("file {i}").as_bytes(), &format!("sig{i}"), "0.0.1"));
        }
        assert_eq!(refused_list(Some(&l)).len(), REFUSED_KEEP);
        assert!(refused_has(Some(&l), None, "sig29") && !refused_has(Some(&l), None, "sig0"));
    }

    // FIX-2 AFTER 1: a read that never answers is ended and reported as unclear.
    #[test]
    fn a_signature_read_that_hangs_is_given_up() {
        #[cfg(windows)]
        let mk = |secs: u32| {
            let mut c = std::process::Command::new("ping");
            c.args(["-n", &secs.to_string(), "127.0.0.1"]);
            c
        };
        #[cfg(not(windows))]
        let mk = |secs: u32| {
            let mut c = std::process::Command::new("sleep");
            c.arg(secs.to_string());
            c
        };
        let started = Instant::now();
        assert_eq!(bounded_output(mk(30), Duration::from_millis(300)), None);
        assert!(started.elapsed() < Duration::from_secs(10), "{:?}", started.elapsed());
        assert!(bounded_output(mk(1), Duration::from_secs(20)).is_some(), "a quick answer is returned");
        assert_eq!(bounded_output(std::process::Command::new("kolux-rs-no-such-program-fix2"), Duration::from_secs(1)), None);
        assert_eq!(SIGNATURE_LIMIT, Duration::from_secs(20));
    }

    // FIX-2 AFTER 2: PowerShell comes from the folder Windows reports, not from an environment variable.
    #[cfg(windows)]
    #[test]
    fn powershell_comes_from_windows_own_folder() {
        let dir = system_dir().expect("Windows reports its system folder");
        assert!(dir.join("WindowsPowerShell").join("v1.0").join("powershell.exe").is_file(), "{dir:?}");
        assert!(dir.is_absolute());
    }

    #[test]
    fn publisher_names_read_well() {
        assert_eq!(publisher_name(ACME), "Acme Tools Ltd");
        assert_eq!(publisher_name("O=No Common Name"), "O=No Common Name");
        assert!(!same_publisher("", ""));
    }

    #[test]
    fn the_signed_build_flag_is_off_unless_the_release_job_sets_it() {
        assert!(!SIGNED_BUILD || option_env!("KOLUX_RS_SIGNED_BUILD") == Some("1"));
    }

    // The real Windows tool on a file that is certainly unsigned (a fresh text file). This reads a
    // local file only; nothing is downloaded or run.
    #[cfg(windows)]
    #[test]
    fn the_windows_tool_reports_an_unsigned_file() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("plain.txt");
        std::fs::write(&f, "not signed").unwrap();
        let s = check_file(&f);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!matches!(s, SignState::Signed { .. }), "{s:?}");
    }

    // AFTER 3: the copy being checked is held against writes, so it cannot be swapped under the check.
    #[cfg(windows)]
    #[test]
    fn the_checked_copy_cannot_be_swapped_while_it_is_checked() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-held-{}", std::process::id()));
        let swapped = std::cell::RefCell::new(Vec::new());
        let v = vet(b"MZ the real bytes", &dir, "9.9.9", &SignState::Unsigned, Pins::default(), false, |p| {
            let mut tries = swapped.borrow_mut();
            tries.push(("overwrite", std::fs::write(p, b"MZ swapped").is_ok()));
            tries.push(("open for write", std::fs::OpenOptions::new().write(true).open(p).is_ok()));
            tries.push(("delete", std::fs::remove_file(p).is_ok()));
            tries.push(("rename", std::fs::rename(p, p.with_extension("old")).is_ok()));
            assert_eq!(std::fs::read(p).unwrap(), b"MZ the real bytes", "the check reads the verified bytes");
            SignState::Unsigned
        });
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(v, Verdict::Install);
        assert_eq!(swapped.into_inner().into_iter().filter(|(_, ok)| *ok).collect::<Vec<_>>(), [], "writes that got through");
    }

    #[test]
    fn a_held_copy_never_takes_over_a_file_that_is_already_there() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-held-new-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("planted.exe");
        std::fs::write(&f, b"planted by someone else").unwrap();
        assert!(HeldCopy::create_at(&f, b"MZ verified").is_err());
        assert_eq!(std::fs::read(&f).unwrap(), b"planted by someone else");
        let g = dir.join("fresh.exe");
        {
            let held = HeldCopy::create_at(&g, b"MZ verified").unwrap();
            assert_eq!(std::fs::read(held.path()).unwrap(), b"MZ verified");
        }
        assert!(!g.exists(), "dropping the held copy removes it");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The write-then-reopen gap is safe only because of the read-back: a swap inside it is refused.
    #[test]
    fn a_copy_swapped_in_the_reopen_gap_is_refused_and_retried() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-m798-gap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("gap.exe");
        let swap = f.clone();
        let err = match HeldCopy::create_at_with_gap(&f, b"MZ verified", || std::fs::write(&swap, b"MZ evil").unwrap()) {
            Ok(_) => panic!("a swapped copy was held"),
            Err(e) => e,
        };
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert!(!f.exists(), "a refused copy is removed");
        let running = signed("CN=Acme Tools Ltd", "AB");
        retried(decide_pinned(&running, &SignState::Unknown(err.kind().to_string()), None, None, true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The real Windows tool must still be able to read a copy that is held open: a copy of this
    // (unsigned) test program reads NotSigned held and plain alike, not a sharing error.
    #[cfg(windows)]
    #[test]
    fn the_windows_tool_can_read_a_held_copy() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-held-ps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bytes = std::fs::read(std::env::current_exe().unwrap()).unwrap();
        let plain = dir.join("plain.exe");
        std::fs::write(&plain, &bytes).unwrap();
        let held = HeldCopy::create_at(&dir.join("held.exe"), &bytes).unwrap();
        // Load flake fix: on a loaded PC either read can run past the tool's 20 s limit, which says
        // nothing about sharing. A read that came back Unknown is asked again (up to 6 reads); a held
        // copy the tool cannot open stays Unknown on every read, so it still differs from plain.
        let settled = |p: &Path| {
            let mut s = check_file(p);
            for _ in 0..5 {
                if !matches!(s, SignState::Unknown(_)) {
                    break;
                }
                s = check_file(p);
            }
            s
        };
        let (a, b) = (settled(&plain), settled(held.path()));
        drop(held);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(b, a, "held {b:?} vs plain {a:?}");
        assert!(!matches!(b, SignState::Unknown(_)) || matches!(a, SignState::Unknown(_)), "{b:?}");
    }

    // AFTER 4: besides the subject, a build can pin the certificate authority that issued it.
    #[test]
    fn the_report_carries_the_issuer() {
        let r = parse_report(r#"{"status":"Valid","subject":"CN=Acme Tools Ltd","issuer":"CN=Acme Code CA","thumbprint":"AB"}"#);
        assert_eq!(r, SignState::Signed { subject: "CN=Acme Tools Ltd".into(), issuer: "CN=Acme Code CA".into(), thumbprint: "AB".into() });
        assert_eq!(parse_report(r#"{"status":"Valid","subject":"CN=Acme Tools Ltd","thumbprint":"AB"}"#), signed("CN=Acme Tools Ltd", "AB"));
    }

    #[test]
    fn a_pinned_issuer_must_match_and_no_pin_changes_nothing() {
        let running = signed_by(ACME, "CN=Acme Code CA");
        let good = signed_by(ACME, "cn=Acme Code CA");
        let other_ca = signed_by(ACME, "CN=Sketchy CA");
        assert_eq!(decide_pinned(&running, &good, None, Some("CN=Acme Code CA"), true), Verdict::Install);
        let why = stopped(decide_pinned(&running, &other_ca, None, Some("CN=Acme Code CA"), true));
        assert!(why.contains("Sketchy CA") && why.contains("Acme Code CA") && why.contains("not be offered again"), "{why}");
        assert!(matches!(decide_pinned(&running, &signed_by(ACME, ""), None, Some("CN=Acme Code CA"), true), Verdict::Stop(_)));
        // The subject is still checked as well.
        assert!(matches!(decide_pinned(&running, &signed_by("CN=Mallory", "CN=Acme Code CA"), None, Some("CN=Acme Code CA"), true), Verdict::Stop(_)));
        // An unsigned installer and a broken one are stopped by the usual rules; an unclear one still retries.
        assert!(matches!(decide_pinned(&running, &SignState::Unsigned, None, Some("CN=Acme Code CA"), true), Verdict::Stop(_)));
        retried(decide_pinned(&running, &unknown(), None, Some("CN=Acme Code CA"), true));
        // No pin (or a blank one): exactly `decide`, so an unsigned build behaves as before.
        for pin in [None, Some("  ")] {
            assert_eq!(decide_pinned(&running, &other_ca, None, pin, true), decide(&running, &other_ca, None, true));
            assert_eq!(decide_pinned(&SignState::Unsigned, &SignState::Unsigned, None, pin, false), Verdict::Install);
        }
    }

    #[test]
    fn a_blank_build_pin_counts_as_unset() {
        for blank in [Some(""), Some("   "), Some("	

"), None] {
            assert_eq!(non_blank(blank), None, "{blank:?}");
        }
        assert_eq!(non_blank(Some("CN=Acme Code CA")), Some("CN=Acme Code CA"));
        assert_eq!(non_blank(Some(" CN=Acme ")), Some(" CN=Acme "));
    }

    // AFTER (refused-list reset): update_mark can empty the list, and nothing else about it.
    #[test]
    fn the_refused_list_can_only_be_emptied() {
        assert_eq!(refused_reset_value(""), Ok("[]"));
        assert_eq!(refused_reset_value("  "), Ok("[]"));
        for add in ["x", r#"[{"sha256":"ab"}]"#, "1.2.3"] {
            assert!(refused_reset_value(add).is_err(), "{add}");
        }
        let after = refused_reset_value("").unwrap();
        assert!(!refused_has(Some(after), Some(&sha256_hex(b"stale installer")), "SIG-OLD"));
        let before = refused_add(None, entry(b"stale installer", "SIG-OLD", "1.1.0"));
        assert!(refused_has(Some(&before), None, "SIG-OLD"));
        assert_eq!(refused_add(Some(after), entry(b"a", "s", "1")), refused_add(None, entry(b"a", "s", "1")), "the emptied list takes new entries as a new one does");
    }
}
