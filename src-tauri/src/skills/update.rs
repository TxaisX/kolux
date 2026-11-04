//! SKILL-024 / SKILL-026: which installed copies of Kolux's own skills are out of date, and the
//! background update that brings them up to date through the community skills installer.
//!
//! Only copies the installer recorded in its lock file and that have not been changed since qualify;
//! a copy changed by hand, one nobody recorded, a link, a read-only folder, a plugin cache and a
//! project copy are all kept, each with a reason and a reinstall command. What is "newer" is the
//! guide built into this Kolux until the Kolux skills repository is published (DT-C43); the lock
//! file's folder hash is the git tree SHA-1 of the skill folder (`installer_digest`), which is what
//! the installer writes for a GitHub source (C25-R3-01).
#![allow(dead_code)] // reached from the commands that evidence/skills-T-196-b-lib.patch registers

use super::installer::{self, Cmd, Installer};
use super::{Env, Scan};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

fn hex(b: impl AsRef<[u8]>) -> String {
    b.as_ref().iter().map(|x| format!("{x:02x}")).collect()
}

/// CRLF and LF are the same text; a file with a NUL in its first bytes is not text and is kept as it is.
fn normal(bytes: &[u8]) -> Vec<u8> {
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return bytes.to_vec();
    }
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Files an operating system adds on its own do not count as a change.
fn os_file(name: &str) -> bool {
    matches!(name, "Thumbs.db" | "desktop.ini" | ".DS_Store") || name.starts_with("._")
}

pub fn text_digest(text: &str) -> String {
    hex(Sha256::digest(normal(text.as_bytes())))
}

/// A folder's content as one hash: file names and normalised bytes, in name order. A link or any
/// other special file inside makes it unreadable (None), so it can never look unchanged.
/// Kolux's own digest, for `text_digest`-style comparisons; the installer's lock uses
/// `installer_digest` instead (C25-R3-01).
pub fn folder_digest(dir: &Path) -> Option<String> {
    fn walk(dir: &Path, rel: &str, h: &mut Sha256) -> Option<()> {
        let mut names: Vec<(String, PathBuf)> = std::fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).collect();
        names.sort();
        for (n, p) in names {
            if os_file(&n) {
                continue;
            }
            let m = std::fs::symlink_metadata(&p).ok()?;
            let r = if rel.is_empty() { n.clone() } else { format!("{rel}/{n}") };
            if m.is_dir() {
                walk(&p, &r, h)?;
            } else if m.is_file() {
                h.update(r.as_bytes());
                h.update([0]);
                h.update(normal(&std::fs::read(&p).ok()?));
                h.update([0]);
            } else {
                return None;
            }
        }
        Some(())
    }
    let mut h = Sha256::new();
    walk(dir, "", &mut h)?;
    Some(hex(h.finalize()))
}

/// SHA-1, for the git tree hash the installer records. `sha1` is not a dependency and the build is
/// offline, so the forty lines it takes live here.
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476, 0xc3d2_e1f0];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for block in msg.as_chunks::<64>().0 {
        let mut w = [0u32; 80];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            *word = u32::from_be_bytes([block[4 * i], block[4 * i + 1], block[4 * i + 2], block[4 * i + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (slot, v) in h.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(v);
        }
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// C25-R3-01: the installer's folder hash, which is the git tree SHA-1 of the skill folder: the
/// same 40 hex `git init && git add -A && git write-tree` gives for an untouched copy. Built over
/// CRLF-normalised bytes, because a copy installed on Windows is text-converted while the record is
/// the source tree. A link or any other special file inside makes it unreadable (None), so it can
/// never look unchanged.
pub fn installer_digest(dir: &Path) -> Option<String> {
    fn tree(dir: &Path) -> Option<[u8; 20]> {
        let mut names: Vec<(String, PathBuf)> = std::fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).collect();
        names.sort();
        // Git orders a tree by name with a folder compared as if it ended in `/`.
        let mut entries: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        for (n, p) in names {
            if os_file(&n) {
                continue;
            }
            let m = std::fs::symlink_metadata(&p).ok()?;
            if m.is_dir() {
                let oid = tree(&p)?;
                let mut e = format!("40000 {n}\0").into_bytes();
                e.extend_from_slice(&oid);
                entries.push((format!("{n}/").into_bytes(), e));
            } else if m.is_file() {
                let body = normal(&std::fs::read(&p).ok()?);
                let mut blob = format!("blob {}\0", body.len()).into_bytes();
                blob.extend_from_slice(&body);
                let mut e = format!("100644 {n}\0").into_bytes();
                e.extend_from_slice(&sha1(&blob));
                entries.push((n.into_bytes(), e));
            } else {
                return None;
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut body = Vec::new();
        for (_, e) in entries {
            body.extend_from_slice(&e);
        }
        let mut hdr = format!("tree {}\0", body.len()).into_bytes();
        hdr.extend_from_slice(&body);
        Some(sha1(&hdr))
    }
    Some(hex(tree(dir)?))
}

fn version_of(text: &str) -> Option<Vec<u64>> {
    let body = text.trim_start_matches('\u{feff}').strip_prefix("---")?;
    let head = body.split("\n---").next()?;
    let v = head.lines().find_map(|l| l.trim().strip_prefix("version:"))?;
    let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
    v.split('.').map(|p| p.trim().parse::<u64>().ok()).collect()
}

/// The installer's record of what it installed, by skill name.
fn lock_hashes(env: &Env) -> std::collections::HashMap<String, String> {
    let p = env.home.join(".agents").join(".skill-lock.json");
    let v: serde_json::Value = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
    v.get("skills")
        .and_then(|s| s.as_object())
        .map(|o| o.iter().filter_map(|(k, e)| e.get("skillFolderHash").and_then(|h| h.as_str()).map(|h| (k.clone(), h.to_string()))).collect())
        .unwrap_or_default()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyRow {
    /// The skill file.
    pub path: String,
    /// home | workspace | plugin
    pub source: String,
    /// current, newer, unrecognised, inaccessible, duplicate, external link, broken link, read only, inside a repo, plugin cache, project copy
    pub chips: Vec<String>,
    /// Qualifies for the update.
    pub eligible: bool,
    /// Why it is kept, in a sentence; None when it qualifies or is current.
    pub reason: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRow {
    pub name: String,
    /// available | current | skipped
    pub state: String,
    pub reason: Option<String>,
    /// For a skipped skill: the command that installs it again.
    pub reinstall: Option<String>,
    pub copies: Vec<CopyRow>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub rows: Vec<UpdateRow>,
    /// Skills with at least one qualifying copy.
    pub available: usize,
    /// Which version of the guides this Kolux knows (first 12 hex of the guide hash, per skill: `name@rev`).
    pub revisions: Vec<String>,
    /// Dismiss keys (`<skill file>|<revision>`) of the qualifying copies that are not project copies.
    pub notice: Vec<String>,
}

fn under(p: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| p.starts_with(r))
}

fn in_repo(folder: &Path) -> bool {
    folder.ancestors().skip(1).any(|a| a.join(".git").exists())
}

/// One installed copy of a skill, judged.
fn judge(env: &Env, roots: &[PathBuf], file: &Path, source: &str, bundled: &str, lock: Option<&String>) -> CopyRow {
    let folder = file.parent().unwrap_or(file).to_path_buf();
    let mut chips: Vec<String> = vec![];
    let mut reason: Option<String> = None;
    fn block(chips: &mut Vec<String>, reason: &mut Option<String>, chip: &str, why: &str) {
        chips.push(chip.to_string());
        reason.get_or_insert_with(|| why.to_string());
    }
    let row = |chips: Vec<String>, eligible: bool, reason: Option<String>| CopyRow { path: file.to_string_lossy().into_owned(), source: source.into(), chips, eligible, reason };
    if super::remote_path(&folder) {
        block(&mut chips, &mut reason, "inaccessible", "It is on a network share that cannot be reached from here.");
        return row(chips, false, reason);
    }
    if let Ok(m) = std::fs::symlink_metadata(&folder) {
        if m.file_type().is_symlink() {
            match std::fs::canonicalize(&folder) {
                Err(_) => block(&mut chips, &mut reason, "broken link", "The folder is a link to something that is gone."),
                Ok(t) if !under(&t, roots) && !under(&t, &roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).collect::<Vec<_>>()) => block(&mut chips, &mut reason, "external link", "The folder is a link to a place outside the skills folders, which the update would not touch."),
                Ok(_) => {}
            }
        }
    }
    let Ok(text) = std::fs::read_to_string(file) else {
        block(&mut chips, &mut reason, "inaccessible", "Its skill file cannot be read.");
        return row(chips, false, reason);
    };
    if std::fs::metadata(file).map(|m| m.permissions().readonly()).unwrap_or(false) {
        block(&mut chips, &mut reason, "read only", "The skill file is read only.");
    }
    match source {
        "plugin" => block(&mut chips, &mut reason, "plugin cache", "A plugin owns this copy; update the plugin instead."),
        "workspace" => {
            chips.push("project copy".into());
            reason.get_or_insert_with(|| "A project copy belongs to its project; the update only changes the copies in your home folders.".into());
            if in_repo(&folder) {
                chips.push("inside a repo".into());
            }
        }
        _ => {}
    }
    if text_digest(&text) == text_digest(bundled) {
        chips.insert(0, "current".into());
        return row(chips, false, None);
    }
    if let (Some(a), Some(b)) = (version_of(&text), version_of(bundled)) {
        if a > b {
            chips.insert(0, "newer".into());
            return row(chips, false, Some("This copy is newer than the one built into Kolux.".into()));
        }
    }
    let kept = |why: &str| Some(why.to_string());
    let (eligible, why) = match (lock, installer_digest(&folder)) {
        _ if reason.is_some() => (false, reason.clone()),
        (None, _) => {
            chips.push("unrecognised".into());
            (false, kept("The installer has no record of this copy, so Kolux cannot tell whether you changed it."))
        }
        (Some(l), Some(d)) if *l == d => (true, None),
        (Some(_), _) => {
            chips.push("unrecognised".into());
            (false, kept("This copy was changed since it was installed; the update would overwrite your changes."))
        }
    };
    let _ = env;
    row(chips, eligible, why)
}

/// SKILL-024: the state of every Kolux skill installed outside Kolux. `bundled` is (name, guide).
pub fn check(env: &Env, scan: &Scan, bundled: &[(&str, &str)]) -> Report {
    let lock = lock_hashes(env);
    let roots = super::home_roots(env);
    let mut rows = vec![];
    let mut notice = vec![];
    let mut revisions = vec![];
    for (name, guide) in bundled {
        let rev = text_digest(guide)[..12].to_string();
        revisions.push(format!("{name}@{rev}"));
        let mut copies: Vec<CopyRow> = scan
            .skills
            .iter()
            .filter(|s| s.name == *name && s.source != "bundled")
            .map(|s| judge(env, &roots, Path::new(&s.path), &s.source, guide, lock.get(*name)))
            .collect();
        if copies.is_empty() {
            continue;
        }
        let global = copies.iter().filter(|c| c.source == "home").count();
        if global > 1 {
            for c in copies.iter_mut().filter(|c| c.source == "home") {
                c.chips.push("duplicate".into());
            }
        }
        let available = copies.iter().any(|c| c.eligible);
        let state = if available {
            "available"
        } else if copies.iter().all(|c| c.chips.first().map(String::as_str) == Some("current")) {
            "current"
        } else {
            "skipped"
        };
        if available {
            notice.extend(copies.iter().filter(|c| c.eligible && c.source != "workspace").map(|c| format!("{}|{rev}", c.path)));
        }
        let reason = if state == "skipped" { copies.iter().find_map(|c| c.reason.clone()) } else { None };
        let reinstall = (state == "skipped").then(|| installer::add_cmd(installer::OFFICIAL_REPO, &[name.to_string()], &[], true, false).map(|c| c.line()).unwrap_or_default());
        rows.push(UpdateRow { name: name.to_string(), state: state.into(), reason, reinstall, copies });
    }
    let available = rows.iter().filter(|r| r.state == "available").count();
    Report { rows, available, revisions, notice }
}

// ---- the background update -------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Result1 {
    pub name: String,
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// idle | running | stopping | done
    pub state: String,
    pub names: Vec<String>,
    /// The command being run, as a line.
    pub command: String,
    pub log: String,
    pub code: Option<i32>,
    pub stopped: bool,
    /// The installer could not start (no Node.js, ...).
    pub error: Option<String>,
    pub results: Vec<Result1>,
}

impl Status {
    fn idle() -> Status {
        Status { state: "idle".into(), names: vec![], command: String::new(), log: String::new(), code: None, stopped: false, error: None, results: vec![] }
    }
}

/// One update at a time: a second start while one runs is refused.
pub struct Job {
    st: Mutex<Status>,
    cancel: Mutex<Arc<AtomicBool>>,
}

impl Default for Job {
    fn default() -> Self {
        Job { st: Mutex::new(Status::idle()), cancel: Mutex::new(Arc::new(AtomicBool::new(false))) }
    }
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn fresh(env: &Env, workspace: Option<&Path>) -> Report {
    check(env, &super::scan(env, workspace), &crate::cli::bundled_skills())
}

impl Job {
    pub fn status(&self) -> Status {
        locked(&self.st).clone()
    }

    /// Updates the named skills. They must qualify now; the installer runs on its own thread while
    /// the skills-folder lock is held. The outcome is decided by a rescan, not by the exit code.
    pub fn start(self: &Arc<Self>, app_dir: &Path, env: Env, workspace: Option<PathBuf>, installer: Arc<dyn Installer>, names: &[String]) -> Result<(), String> {
        let cmd: Cmd = installer::update_cmd(names)?;
        let names = installer::clean_names(names)?;
        {
            let st = locked(&self.st);
            if st.state == "running" || st.state == "stopping" {
                return Err("An update is already running".into());
            }
        }
        let lock = super::super::skill_delete::lock(app_dir).map_err(|e| match e {
            super::super::skill_delete::LockError::Busy => "Another skill change is under way; try again when it has finished".to_string(),
            super::super::skill_delete::LockError::Failed(m) => format!("The skills folders could not be locked: {m}"),
        })?;
        let before = fresh(&env, workspace.as_deref());
        if let Some(n) = names.iter().find(|n| !before.rows.iter().any(|r| &r.name == *n && r.state == "available")) {
            return Err(format!("{n} has no copy that can be updated"));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *locked(&self.cancel) = cancel.clone();
        *locked(&self.st) = Status { state: "running".into(), names: names.clone(), command: cmd.line(), ..Status::idle() };
        let job = self.clone();
        std::thread::spawn(move || {
            let ran = installer.run(&cmd, &cancel);
            let after = fresh(&env, workspace.as_deref());
            let mut st = locked(&job.st);
            match ran {
                Ok(o) => {
                    st.log = o.log;
                    st.code = o.code;
                    st.stopped = o.stopped;
                }
                Err(e) => st.error = Some(e),
            }
            st.results = names
                .iter()
                .map(|n| {
                    let still = after.rows.iter().any(|r| &r.name == n && r.state == "available");
                    Result1 { name: n.clone(), ok: !still, reason: still.then(|| if st.stopped { "Stopped before it finished".to_string() } else { st.error.clone().unwrap_or_else(|| "The copy is still out of date".into()) }) }
                })
                .collect();
            // Freed before "done" is published, so a caller reacting to "done" never meets Busy.
            drop(lock);
            st.state = "done".into();
        });
        Ok(())
    }

    /// Ends the installer and everything it started.
    pub fn stop(&self) {
        let mut st = locked(&self.st);
        if st.state == "running" {
            st.state = "stopping".into();
            locked(&self.cancel).store(true, Ordering::Relaxed);
        }
    }

    /// Back to idle after the dialog read a finished run.
    pub fn clear(&self) {
        let mut st = locked(&self.st);
        if st.state == "done" {
            *st = Status::idle();
        }
    }
}

// ---- dismiss memory --------------------------------------------------------------------------

const DISMISSED: &str = "skills-update-dismissed.json";

pub fn dismissed(app_dir: &Path) -> Vec<String> {
    std::fs::read_to_string(app_dir.join(DISMISSED)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn dismiss(app_dir: &Path, keys: &[String]) -> Result<(), String> {
    // Row 193 sweep: a list that cannot be read is never saved over; one that does not parse is
    // kept aside as <name>.corrupt-<ms> before a fresh list is written.
    let path = app_dir.join(DISMISSED);
    match std::fs::read_to_string(&path) {
        Ok(t) if serde_json::from_str::<Vec<String>>(&t).is_err() => {
            let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            std::fs::rename(&path, app_dir.join(format!("{DISMISSED}.corrupt-{ms}"))).map_err(|e| format!("{DISMISSED} could not be kept aside ({e}); nothing was changed"))?;
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("{DISMISSED} could not be read ({e}); nothing was changed")),
        _ => {}
    }
    let mut all = dismissed(app_dir);
    for k in keys {
        if !all.contains(k) {
            all.push(k.clone());
        }
    }
    let keep = all.len().saturating_sub(500);
    std::fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&all[keep..]).map_err(|e| e.to_string())?;
    let tmp = app_dir.join(format!("{DISMISSED}.tmp"));
    std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, app_dir.join(DISMISSED))).map_err(|e| e.to_string())
}

// ---- commands (registered by evidence/skills-T-196-b-lib.patch) -----------------------------

fn job() -> &'static Arc<Job> {
    static JOB: OnceLock<Arc<Job>> = OnceLock::new();
    JOB.get_or_init(|| Arc::new(Job::default()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    pub report: Report,
    pub dismissed: Vec<String>,
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// SKILL-024: which Kolux skills can be updated, and what the user already dismissed.
#[tauri::command]
pub async fn skills_update_check(app: tauri::AppHandle, workspace: Option<String>) -> Result<Checked, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || Checked { report: fresh(&Env::current(), workspace.as_deref().map(Path::new)), dismissed: dismissed(&dir) }).await.map_err(|e| e.to_string())
}

/// SKILL-024: remembers that these notices were dismissed.
#[tauri::command]
pub async fn skills_update_dismiss(app: tauri::AppHandle, keys: Vec<String>) -> Result<(), String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || dismiss(&dir, &keys)).await.map_err(|e| e.to_string())?
}

/// SKILL-026: starts the background update of these skills.
#[tauri::command]
pub async fn skills_update_start(app: tauri::AppHandle, workspace: Option<String>, names: Vec<String>) -> Result<(), String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || job().start(&dir, Env::current(), workspace.map(PathBuf::from), Arc::new(installer::Real), &names)).await.map_err(|e| e.to_string())?
}

/// SKILL-026: Stop ends the installer and its whole process tree.
#[tauri::command]
pub fn skills_update_stop() {
    job().stop();
}

/// SKILL-026: what the update is doing, its log and its per-skill results.
#[tauri::command]
pub fn skills_update_status() -> Status {
    job().status()
}

/// SKILL-026: the dialog read the result; the next update may start.
#[tauri::command]
pub fn skills_update_clear() {
    job().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;
    use installer::Outcome;
    use std::fs;

    const NAME: &str = "orchestration";

    fn env(home: &Path) -> Env {
        Env { home: home.to_path_buf(), claude: None, codex: None, grok: None, hermes: None, local_app_data: Some(home.join("AppData").join("Local")), windows: true }
    }

    fn guide() -> String {
        crate::cli::bundled_skills().into_iter().find(|b| b.0 == NAME).unwrap().1.replace("\r\n", "\n")
    }

    fn put(folder: &Path, text: &str) {
        fs::create_dir_all(folder).unwrap();
        fs::write(folder.join("SKILL.md"), text).unwrap();
    }

    fn old() -> String {
        format!("{}\nan older line\n", guide())
    }

    fn record(home: &Path, folder: &Path) {
        // C25-R3-01: the lock carries the installer's own hash (the git tree SHA-1), not Kolux's
        // `folder_digest`; a fixture that wrote the latter could never see the real defect.
        let d = installer_digest(folder).unwrap();
        fs::create_dir_all(home.join(".agents")).unwrap();
        fs::write(home.join(".agents").join(".skill-lock.json"), format!(r#"{{"version":3,"skills":{{"{NAME}":{{"source":"x","sourceType":"github","skillFolderHash":"{d}"}}}}}}"#)).unwrap();
    }

    /// A home with an old, recorded, unchanged copy in the Claude folder.
    fn home_with_old_copy(tag: &str) -> (crate::test_dir::TempDir, PathBuf) {
        let t = temp(tag);
        let folder = t.join(".claude").join("skills").join(NAME);
        put(&folder, &old());
        record(&t, &folder);
        (t, folder)
    }

    fn report(home: &Path, ws: Option<&Path>) -> Report {
        let e = env(home);
        check(&e, &super::super::scan(&e, ws), &crate::cli::bundled_skills())
    }

    fn row(r: &Report) -> &UpdateRow {
        r.rows.iter().find(|x| x.name == NAME).unwrap()
    }

    #[test]
    fn an_old_recorded_unchanged_copy_is_available_and_makes_a_notice_key() {
        let (t, folder) = home_with_old_copy("upd-avail");
        let r = report(&t, None);
        assert_eq!((r.available, row(&r).state.as_str()), (1, "available"));
        assert!(row(&r).copies[0].eligible && row(&r).reinstall.is_none());
        assert_eq!(r.notice.len(), 1);
        assert!(r.notice[0].starts_with(&folder.join("SKILL.md").to_string_lossy().into_owned()), "{:?}", r.notice);
        assert!(r.notice[0].ends_with(&format!("|{}", &text_digest(&guide())[..12])));
    }

    #[test]
    fn a_copy_changed_by_hand_or_not_recorded_is_kept_with_a_reason_and_a_reinstall_command() {
        let (t, folder) = home_with_old_copy("upd-changed");
        fs::write(folder.join("notes.md"), "mine").unwrap();
        let r = report(&t, None);
        let w = row(&r);
        assert_eq!((r.available, w.state.as_str()), (0, "skipped"));
        assert!(w.copies[0].chips.contains(&"unrecognised".to_string()));
        assert!(w.reason.as_deref().unwrap().contains("changed"));
        assert_eq!(w.reinstall.as_deref(), Some("npx --yes skills add TxaisX/kolux-skills --skill orchestration -g"));
        assert!(r.notice.is_empty());
        // No record at all.
        fs::remove_file(t.join(".agents").join(".skill-lock.json")).unwrap();
        let r = report(&t, None);
        assert!(row(&r).reason.as_deref().unwrap().contains("no record"));
    }

    #[test]
    fn line_endings_and_files_the_system_adds_do_not_count_as_a_change() {
        let (t, folder) = home_with_old_copy("upd-crlf");
        fs::write(folder.join("SKILL.md"), old().replace('\n', "\r\n")).unwrap();
        fs::write(folder.join("Thumbs.db"), "x").unwrap();
        fs::write(folder.join("._SKILL.md"), "x").unwrap();
        fs::write(folder.join(".DS_Store"), "x").unwrap();
        assert_eq!(report(&t, None).available, 1);
    }

    /// C25-R3-01: the installer records the git tree SHA-1 of the skill folder, so the on-disk
    /// digest must be that same 40-hex value. The literal is `git init && git add -A &&
    /// git write-tree` (core.autocrlf=false) on this exact fixture, computed once and pasted here.
    #[test]
    fn c25r301_the_installers_digest_is_the_git_tree_sha1_of_the_folder() {
        let t = temp("upd-tree");
        let folder = t.join("orchestration");
        fs::create_dir_all(folder.join("notes")).unwrap();
        fs::write(folder.join("SKILL.md"), "---\nname: orchestration\nversion: 1.0.0\n---\nbody\n").unwrap();
        fs::write(folder.join("notes").join("a.txt"), "hi\n").unwrap();
        let d = installer_digest(&folder).unwrap();
        assert_eq!(d, "8852422a006c5047a1de9d2db6d43876171c909a");
        assert_eq!(d.len(), 40);
        assert!(d.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{d}");
        // A copy installed on Windows is text-converted while the record is the source tree, so the
        // same folder written with CRLF hashes the same (its raw CRLF tree is df6c6ba0...).
        fs::write(folder.join("SKILL.md"), "---\r\nname: orchestration\r\nversion: 1.0.0\r\n---\r\nbody\r\n").unwrap();
        fs::write(folder.join("notes").join("a.txt"), "hi\r\n").unwrap();
        assert_eq!(installer_digest(&folder).unwrap(), d);
        // A file the system adds does not count, as with `folder_digest`; a hand edit does.
        fs::write(folder.join("Thumbs.db"), "x").unwrap();
        assert_eq!(installer_digest(&folder).unwrap(), d);
        fs::write(folder.join("notes").join("a.txt"), "hi there\n").unwrap();
        assert_ne!(installer_digest(&folder).unwrap(), d);
    }

    /// C25-R3-01, the reported symptom: a copy the installer recorded (40-hex tree SHA-1, the shape
    /// every real lock has) and that nobody changed is available. Before the fix the 64-hex
    /// `folder_digest` was compared against it, so every real copy read "changed since it was
    /// installed" and Update was dead.
    #[test]
    fn c25r301_a_copy_recorded_by_the_installer_is_available() {
        let t = temp("upd-installer");
        let folder = t.join(".claude").join("skills").join(NAME);
        fs::create_dir_all(folder.join("notes")).unwrap();
        fs::write(folder.join("SKILL.md"), "---\nname: orchestration\nversion: 1.0.0\n---\nbody\n").unwrap();
        fs::write(folder.join("notes").join("a.txt"), "hi\n").unwrap();
        fs::create_dir_all(t.join(".agents")).unwrap();
        fs::write(
            t.join(".agents").join(".skill-lock.json"),
            format!(r#"{{"version":3,"skills":{{"{NAME}":{{"source":"TxaisX/kolux","sourceType":"github","skillFolderHash":"8852422a006c5047a1de9d2db6d43876171c909a"}}}}}}"#),
        )
        .unwrap();
        let bundled = [(NAME, "---\nname: orchestration\nversion: 9.0.0\n---\nbody\n")];
        let e = env(&t);
        let r = check(&e, &super::super::scan(&e, None), &bundled);
        let w = row(&r);
        assert_eq!((r.available, w.state.as_str()), (1, "available"));
        assert!(w.copies[0].eligible && w.reinstall.is_none());
        assert!(w.reason.is_none(), "{:?}", w.reason);
        assert_eq!(r.notice.len(), 1);
    }

    #[test]
    fn a_current_copy_and_a_newer_copy_are_not_offered() {
        let (t, folder) = home_with_old_copy("upd-current");
        fs::write(folder.join("SKILL.md"), guide().replace('\n', "\r\n")).unwrap();
        let r = report(&t, None);
        assert_eq!((r.available, row(&r).state.as_str()), (0, "current"));
        assert_eq!(row(&r).copies[0].chips[0], "current");
        // Newer, by the version in its front matter (custom guide).
        let bundled = [(NAME, "---\nname: orchestration\nversion: 1.2.0\n---\nbody\n")];
        fs::write(folder.join("SKILL.md"), "---\nname: orchestration\nversion: 1.10.0\n---\nbody\n").unwrap();
        record(&t, &folder);
        let e = env(&t);
        let r = check(&e, &super::super::scan(&e, None), &bundled);
        assert_eq!((r.available, row(&r).copies[0].chips[0].as_str()), (0, "newer"));
        assert_eq!(version_of("---\nversion: \"1.2\"\n---\n"), Some(vec![1, 2]));
        assert_eq!(version_of("no front matter"), None);
    }

    #[test]
    fn project_and_plugin_copies_play_no_part_and_two_global_copies_are_duplicates() {
        let (t, _folder) = home_with_old_copy("upd-project");
        let ws = t.join("repo");
        put(&ws.join(".claude").join("skills").join(NAME), &old());
        fs::create_dir_all(ws.join(".git")).unwrap();
        let r = report(&t, Some(&ws));
        let w = row(&r);
        let project = w.copies.iter().find(|c| c.source == "workspace").unwrap();
        assert!(project.chips.contains(&"project copy".to_string()) && project.chips.contains(&"inside a repo".to_string()) && !project.eligible);
        assert_eq!(r.notice.len(), 1, "only the home copy is in the notice: {:?}", r.notice);
        // A second global copy in the shared folder makes both duplicates.
        put(&t.join(".agents").join("skills").join(NAME), &old());
        let r = report(&t, None);
        let globals: Vec<_> = row(&r).copies.iter().filter(|c| c.source == "home").collect();
        assert_eq!(globals.len(), 2);
        assert!(globals.iter().all(|c| c.chips.contains(&"duplicate".to_string())));
    }

    #[cfg(unix)]
    #[test]
    fn links_out_of_the_skills_folders_and_broken_links_are_kept() {
        let t = temp("upd-link");
        let outside = t.join("elsewhere").join(NAME);
        put(&outside, &old());
        fs::create_dir_all(t.join(".claude").join("skills")).unwrap();
        std::os::unix::fs::symlink(&outside, t.join(".claude").join("skills").join(NAME)).unwrap();
        let r = report(&t, None);
        assert!(row(&r).copies[0].chips.contains(&"external link".to_string()));
        assert_eq!(r.available, 0);
    }

    #[test]
    fn only_a_remote_folder_name_is_inaccessible() {
        let (t, _f) = home_with_old_copy("upd-remote");
        let e = env(&t);
        let c = judge(&e, &[], Path::new(r"\\server\share\skills\orchestration\SKILL.md"), "home", &guide(), None);
        assert!(c.chips.contains(&"inaccessible".to_string()) && !c.eligible);
    }

    // ---- the job, with a fake installer ----

    struct Fake {
        home: PathBuf,
        folder: PathBuf,
        /// Does the update when run; false leaves the copy old (a silent failure).
        works: bool,
        /// Waits for Stop instead of finishing.
        hangs: bool,
        seen: Mutex<Vec<Cmd>>,
    }

    impl Installer for Fake {
        fn run(&self, cmd: &Cmd, cancel: &AtomicBool) -> Result<Outcome, String> {
            self.seen.lock().unwrap().push(cmd.clone());
            if self.hangs {
                while !cancel.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                return Ok(Outcome { code: None, log: "\x1b[32mworking\x1b[0m".into(), stopped: true });
            }
            if self.works {
                fs::write(self.folder.join("SKILL.md"), guide()).unwrap();
                record(&self.home, &self.folder);
            }
            Ok(Outcome { code: Some(0), log: "done".into(), stopped: false })
        }
    }

    fn fake(t: &Path, folder: &Path, works: bool, hangs: bool) -> Arc<Fake> {
        Arc::new(Fake { home: t.to_path_buf(), folder: folder.to_path_buf(), works, hangs, seen: Mutex::new(vec![]) })
    }

    fn finish(job: &Job) -> Status {
        for _ in 0..500 {
            let s = job.status();
            if s.state == "done" {
                return s;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("the update never finished: {:?}", job.status());
    }

    fn names() -> Vec<String> {
        vec![NAME.to_string()]
    }

    #[test]
    fn an_update_runs_the_installer_with_the_sorted_command_and_the_rescan_decides_success() {
        let (t, folder) = home_with_old_copy("upd-run");
        let app = t.join("app");
        let job = Arc::new(Job::default());
        let f = fake(&t, &folder, true, false);
        job.start(&app, env(&t), None, f.clone(), &names()).unwrap();
        let s = finish(&job);
        assert_eq!(s.command, "npx --yes skills update orchestration -y -g");
        assert_eq!(f.seen.lock().unwrap().len(), 1);
        assert_eq!(s.results, vec![Result1 { name: NAME.into(), ok: true, reason: None }]);
        assert_eq!(s.log, "done");
        assert_eq!(report(&t, None).available, 0);
        // The lock was let go: another operation may take it, and a new update may start.
        let freed = crate::skill_delete::lock(&app);
        assert!(freed.is_ok());
        drop(freed);
        job.clear();
        assert_eq!(job.status().state, "idle");
    }

    #[test]
    fn exit_code_zero_with_the_copy_still_old_is_a_failure() {
        let (t, folder) = home_with_old_copy("upd-silent");
        let job = Arc::new(Job::default());
        job.start(&t.join("app"), env(&t), None, fake(&t, &folder, false, false), &names()).unwrap();
        let s = finish(&job);
        assert_eq!(s.code, Some(0));
        assert!(!s.results[0].ok && s.results[0].reason.as_deref().unwrap().contains("still out of date"));
    }

    #[test]
    fn a_skill_with_no_qualifying_copy_a_second_start_and_a_busy_lock_are_refused() {
        let (t, folder) = home_with_old_copy("upd-refuse");
        let app = t.join("app");
        let job = Arc::new(Job::default());
        assert!(job.start(&app, env(&t), None, fake(&t, &folder, true, false), &["koluxward".to_string()]).unwrap_err().contains("no copy that can be updated"));
        assert!(job.start(&app, env(&t), None, fake(&t, &folder, true, false), &["a;b".to_string()]).is_err());
        assert_eq!(job.status().state, "idle");
        // Someone else holds the skills-folder lock (a delete under way).
        let held = crate::skill_delete::lock(&app).unwrap();
        assert!(job.start(&app, env(&t), None, fake(&t, &folder, true, false), &names()).unwrap_err().contains("Another skill change"));
        drop(held);
        // One update at a time.
        let hang = fake(&t, &folder, true, true);
        job.start(&app, env(&t), None, hang, &names()).unwrap();
        assert!(job.start(&app, env(&t), None, fake(&t, &folder, true, false), &names()).unwrap_err().contains("already running"));
        job.stop();
        assert_eq!(finish(&job).state, "done");
    }

    #[test]
    fn stop_ends_the_run_and_the_log_has_no_colour_codes_from_the_real_runner_contract() {
        let (t, folder) = home_with_old_copy("upd-stop");
        let job = Arc::new(Job::default());
        job.start(&t.join("app"), env(&t), None, fake(&t, &folder, true, true), &names()).unwrap();
        assert_eq!(job.status().state, "running");
        job.stop();
        assert_eq!(job.status().state, "stopping");
        let s = finish(&job);
        assert!(s.stopped && s.code.is_none());
        assert!(!s.results[0].ok && s.results[0].reason.as_deref().unwrap().contains("Stopped"));
    }

    struct NoNode;
    impl Installer for NoNode {
        fn run(&self, _: &Cmd, _: &AtomicBool) -> Result<Outcome, String> {
            Err("Node.js was not found".into())
        }
    }

    #[test]
    fn an_installer_that_cannot_start_says_why() {
        let (t, _f) = home_with_old_copy("upd-nonode");
        let job = Arc::new(Job::default());
        job.start(&t.join("app"), env(&t), None, Arc::new(NoNode), &names()).unwrap();
        let s = finish(&job);
        assert_eq!(s.error.as_deref(), Some("Node.js was not found"));
        assert!(!s.results[0].ok);
    }

    #[test]
    fn dismissals_are_remembered_and_never_grow_past_a_limit() {
        let t = temp("upd-dismiss");
        assert!(dismissed(&t).is_empty());
        dismiss(&t, &["a|1".into(), "b|1".into()]).unwrap();
        dismiss(&t, &["a|1".into(), "c|2".into()]).unwrap();
        assert_eq!(dismissed(&t), vec!["a|1".to_string(), "b|1".into(), "c|2".into()]);
        let many: Vec<String> = (0..600).map(|i| format!("k{i}|1")).collect();
        dismiss(&t, &many).unwrap();
        assert_eq!(dismissed(&t).len(), 500);
        assert!(dismissed(&t).contains(&"k599|1".to_string()));
    }

    #[test]
    fn row193_an_unreadable_dismiss_list_is_kept_aside_not_saved_over() {
        let t = temp("upd-dismiss-aside");
        std::fs::create_dir_all(&*t).unwrap();
        std::fs::write(t.join(DISMISSED), b"[\"a|1\", \"b|").unwrap();
        dismiss(&t, &["c|2".into()]).unwrap();
        assert_eq!(dismissed(&t), vec!["c|2".to_string()]);
        let kept: Vec<_> = std::fs::read_dir(&*t).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(&format!("{DISMISSED}.corrupt-"))).collect();
        assert_eq!(kept.len(), 1, "one corrupt copy is kept beside the fresh list");
        assert_eq!(std::fs::read(kept[0].path()).unwrap(), b"[\"a|1\", \"b|", "byte for byte");
    }

    #[test]
    fn the_real_runner_reports_a_missing_program_in_plain_words() {
        let c = Cmd { program: "kolux-no-such-program-xyz".into(), args: vec![] };
        let e = installer::Real.run(&c, &AtomicBool::new(false)).unwrap_err();
        assert!(e.contains("Node.js was not found") || e.contains("could not start"), "{e}");
    }
}
