//! STAT-004 / STAT-005 (T-152): which agents get Kolux's status hooks, and how Kolux puts them in
//! and takes them out without touching anything of the user's. Hooks go only to agents found on
//! this computer (one search of the program folders, plus a program the user set on the Agents
//! page) and switched on; a switched-off agent has Kolux's entries taken out; an agent that is
//! simply not found is left as it is, since another Kolux profile may rely on its hooks. Every
//! install holds a lock shared by all Kolux processes, and Claude Code's settings are copied to
//! `settings.json.bak-kolux` before Kolux first writes to them.
//!
//! A child of `hooks` so it shares that module's script and settings helpers.

use super::{claude_settings_file, home_dir, CHANGED, install_claude_from, is_my_command, status_command, write_atomic, write_claude_script, write_codex_script, write_json, write_status_script, SCRIPT_DIR, STATUS_PREV};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The Settings key listing the agents switched off on the Agents page (SET-010).
pub const DISABLED_KEY: &str = "disabledAgents";
/// The copy of an agent's settings kept from before Kolux first wrote to them.
pub const BACKUP_SUFFIX: &str = ".bak-kolux";
const LOCK_FILE: &str = "install.lock";
/// A lock older than this was left by an install that crashed (the slowest step, Codex's
/// listing, gives up after 15 seconds).
const LOCK_STALE: Duration = Duration::from_secs(30);
const LOCK_WAIT: Duration = Duration::from_secs(35);

/// The agents whose hooks Kolux manages, by catalogue id.
pub const MANAGED: [&str; 14] = ["claude", "codex", "gemini", "antigravity", "amp", "cursor", "droid", "kimi", "copilot", "grok", "devin", "pi", "hermes", "command-code"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Install,
    Remove,
    /// Not found: its settings stay as they are; only Kolux's own scripts are refreshed.
    Leave,
}

/// What to do for each managed agent. `searched` is false when no program folder could be read,
/// and then nothing is installed.
pub fn plan(settings: &Value, installed: &[String], searched: bool) -> Vec<(&'static str, Plan)> {
    let off: Vec<&str> = settings.get(DISABLED_KEY).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    // STAT-002: with the status hooks switched off, every agent has Kolux's entries taken out.
    let all_off = !switch::on(settings);
    MANAGED
        .iter()
        .map(|&id| {
            let found = installed.iter().any(|i| i == id) || explicit(settings, id);
            (id, if all_off || off.contains(&id) { Plan::Remove } else if searched && found { Plan::Install } else { Plan::Leave })
        })
        .collect()
}

/// The program the user set for `id` on the Agents page exists and can run.
fn explicit(settings: &Value, id: &str) -> bool {
    settings
        .get(crate::agents::OPTIONS_FIELD)
        .and_then(|o| o.get(id))
        .and_then(|m| m.get("command"))
        .and_then(Value::as_str)
        .map(|c| c.trim().trim_matches('"'))
        .filter(|c| !c.is_empty())
        .is_some_and(|c| crate::agents::find_program(c).is_some())
}

/// One hook entry is Kolux's: its command, its argument list, or the command given as a list of
/// words runs a script from Kolux's folder (the older direct-command and argument-list forms).
pub fn names_mine(hook: &Value) -> bool {
    let any = |v: Option<&Value>| v.and_then(Value::as_array).is_some_and(|a| a.iter().filter_map(Value::as_str).any(is_my_command));
    hook.get("command").and_then(Value::as_str).is_some_and(is_my_command) || any(hook.get("command")) || any(hook.get("args"))
}

/// Takes Kolux's entries out of one event's groups: a user hook sharing a group with Kolux's
/// stays, and a group left empty by the removal goes. True when something was taken out.
pub fn strip(groups: &mut Vec<Value>) -> bool {
    let mut changed = false;
    groups.retain_mut(|g| {
        if names_mine(g) {
            changed = true;
            return false;
        }
        let Some(hooks) = g.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
        let n = hooks.len();
        hooks.retain(|h| !names_mine(h));
        if hooks.len() == n {
            return true;
        }
        changed = true;
        !hooks.is_empty()
    });
    changed
}

/// Clears Kolux's entries from every event not in `keep`; an event left empty by that goes.
pub fn clear_unused(hooks: &mut Map<String, Value>, keep: &[&str]) -> bool {
    let mut changed = false;
    hooks.retain(|event, groups| {
        if keep.contains(&event.as_str()) {
            return true;
        }
        let Some(list) = groups.as_array_mut() else { return true };
        if !strip(list) {
            return true;
        }
        changed = true;
        !list.is_empty()
    });
    changed
}

/// T-584 (R02-hooks-status.4): a `{"hooks": {...}}` file as the install and removal checks compare it. An event whose
/// list is empty holds no entries (other tools leave `"Stop": []` behind when they uninstall), so it reads as absent.
pub fn without_empty_lists(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(hooks) = v.get_mut("hooks").and_then(Value::as_object_mut) {
        hooks.retain(|_, groups| groups.as_array().is_none_or(|g| !g.is_empty()));
    }
    v
}

/// Takes every Kolux entry out of a `{"hooks": {...}}` file. A `hooks` object left empty goes
/// too only when `drop_empty` (Kolux created it); T-152-b (4): one the user had, even `{}`, stays.
pub fn remove_groups(root: &mut Value, drop_empty: bool) -> bool {
    let Some(obj) = root.as_object_mut() else { return false };
    let Some(hooks) = obj.get_mut("hooks").and_then(Value::as_object_mut) else { return false };
    let changed = clear_unused(hooks, &[]);
    if changed && drop_empty && hooks.is_empty() {
        obj.remove("hooks");
    }
    changed
}

fn read_opt(file: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(file) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

/// Takes Kolux's hooks and status line out of Claude Code's settings. The status line the user
/// had before Kolux comes back exactly as it was (T-152 (4): the whole slot kept in
/// `prev`'s `.json` sibling, `null` for none; an older install kept only the command, in `prev`);
/// with neither, the slot goes. When the result parses equal to the `.bak-kolux` copy, that copy's
/// bytes are written, so the file is byte for byte the one from before the install (T-152 (6)).
/// True when written. T-152-c (3): like an install, a file saved between Kolux's read and its write
/// is read again once (`once_more`); a second change fails with nothing written.
pub fn remove_claude(file: &Path, prev: &Path) -> Result<bool, String> {
    once_more(|| remove_claude_once(file, prev))
}

/// T-152-b (5) / T-152-c (3): `step` again when the file changed between its read and its write
/// (`CHANGED`), so a save by the agent itself is merged instead of failing; a second change fails.
fn once_more<T>(step: impl Fn() -> Result<T, String>) -> Result<T, String> {
    match step() {
        Err(e) if e.ends_with(CHANGED) => {
            eprintln!("kolux-rs: agent hooks: {e}; reading it again");
            step()
        }
        done => done,
    }
}

/// One read, check and write of `remove_claude`.
fn remove_claude_once(file: &Path, prev: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut s: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    let copy = kept(file);
    let mut changed = remove_groups(&mut s, copy.as_ref().is_none_or(|(_, v)| v.get("hooks").is_none()));
    let slot = prev.with_extension("json");
    if s.get("statusLine").and_then(|l| l.get("command")).and_then(Value::as_str).is_some_and(is_my_command) {
        let exact = fs::read_to_string(&slot).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        match (exact, fs::read_to_string(prev).ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())) {
            (Some(Value::Null), _) | (None, None) => {
                s.as_object_mut().map(|o| o.remove("statusLine"));
            }
            (Some(had), _) => s["statusLine"] = had,
            (None, Some(had)) => s["statusLine"]["command"] = json!(had),
        }
        changed = true;
    }
    if changed {
        let record = prev.parent().map(|d| d.join(BACKUP_RECORD)).unwrap_or_default();
        match copy.filter(|(_, v)| without_empty_lists(v) == without_empty_lists(&s)) {
            Some((bytes, _)) => write_atomic(file, &bytes, Some(&text))?,
            None if drop_created(file, &record, &s, &text)? => {}
            None => write_json(file, &s, Some(&text))?,
        }
        let _ = fs::remove_file(prev);
        let _ = fs::remove_file(&slot);
    }
    Ok(changed)
}

/// Takes Kolux's hooks out of one Codex home's `hooks.json`. The trust entries in `config.toml`
/// stay: they name hooks that no longer exist and Codex ignores them.
pub fn remove_codex(home: &Path) -> Result<bool, String> {
    let file = home.join("hooks.json");
    let Some(text) = read_opt(&file)? else { return Ok(false) };
    let mut v: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    // With no copy (an install before T-152-b), the empty `{"hooks":{}}` shape Codex itself uses stays.
    // hooks FIX-3: unless Kolux created the file; then it goes, its record with it (`drop_created`).
    let copy = kept(&file);
    let record = codex_record(&file);
    let created = copy.is_none() && was_created(&record, &file);
    let changed = remove_groups(&mut v, created || copy.as_ref().is_some_and(|(_, c)| c.get("hooks").is_none()));
    if changed {
        match copy.filter(|(_, c)| without_empty_lists(c) == without_empty_lists(&v)) {
            Some((bytes, _)) => write_atomic(&file, &bytes, Some(&text))?,
            None if drop_created(&file, &record, &v, &text)? => {}
            None => write_json(&file, &v, Some(&text))?,
        }
    }
    Ok(changed)
}

/// The `.bak-kolux` copy of `file`, as bytes and parsed, when it is there and reads as JSON.
fn kept(file: &Path) -> Option<(Vec<u8>, Value)> {
    let bytes = fs::read(backup_of(file)).ok()?;
    let v = serde_json::from_slice(&bytes).ok()?;
    Some((bytes, v))
}

/// hooks FIX-3: one Codex home's copy record, `<home>/hooks.json.bak-kolux.sha256`, beside the copy.
pub fn codex_record(file: &Path) -> PathBuf {
    let mut record = backup_of(file).into_os_string();
    record.push(".sha256");
    PathBuf::from(record)
}

/// `<file>.bak-kolux`.
pub fn backup_of(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(BACKUP_SUFFIX);
    PathBuf::from(name)
}

/// Keeps a copy of `file` from before Kolux's first install; a copy already there is never
/// replaced, and a missing file has nothing to keep (FIX-2: its record says it was missing). A copy that cannot be made, or that does not
/// hash the same as the file, stops the install. T-152 (2): a new copy returns the sha256 of the
/// file and of the copy, written to `record` before the copy takes its name (a rebuilt record
/// returns `None`; it is logged here).
///
/// T-152-b (3): on EVERY install the copy already there is checked against `record`: a record
/// with no line for this copy is rebuilt from the copy and the file as they are (only when the
/// copy still reads as JSON), and a copy whose hash differs from its record stops the install.
/// The new copy is written to a temp name and synced to disk, the record is written (and synced),
/// and only then is the copy renamed into place, so a failed record write never leaves a copy
/// that the next install would trust.
pub fn back_up(file: &Path, record: &Path) -> Result<Option<(String, String)>, String> {
    let copy = backup_of(file);
    let refuse = |e: String| format!("could not keep a copy of {} ({e}); hooks not installed", file.display());
    if copy.exists() {
        let have = sha256(&copy).map_err(refuse)?;
        return match recorded(record, &copy) {
            Some(want) if want == have => Ok(None),
            Some(want) => Err(format!(
                "the kept copy {} hashes {have} but its record {} says {want}; the copy is damaged, so hooks are not installed",
                copy.display(),
                record.display()
            )),
            None => {
                let parses = fs::read(&copy).ok().is_some_and(|b| serde_json::from_slice::<Value>(&b).is_ok());
                if !parses {
                    return Err(format!("the kept copy {} (sha256 {have}) has no record in {} and is not JSON; hooks not installed", copy.display(), record.display()));
                }
                let now = if file.exists() { sha256(file).map_err(refuse)? } else { "missing".into() };
                write_record(record, file, &now, &copy, &have).map_err(refuse)?;
                eprintln!("kolux-rs: claude hooks: rebuilt the copy's record: sha256 file now {now}, kept copy {have}");
                Ok(None)
            }
        };
    }
    if !file.exists() {
        // FIX-2 (S8): Kolux is about to create the file, so the record says so (its own `created`
        // token, never the `missing` a rebuilt record writes for an absent file); the
        // next start then knows Kolux's entries in it need no copy, and off deletes it.
        write_lines(record, &format!("{CREATED}  {}\n", file.display())).map_err(refuse)?;
        return Ok(None);
    }
    let bytes = fs::read(file).map_err(|e| refuse(e.to_string()))?;
    // T-152-c (4): a file that already holds Kolux's entries is not the user's own file; a copy of
    // it would put those entries back on every later off, so none is made and the install stops.
    // FIX-2 (S8): unless Kolux created it, which the record says; then there is nothing to keep.
    if holds_mine(&bytes) {
        if was_created(record, file) {
            return Ok(None);
        }
        return Err(format!(
            "{} already holds Kolux's hook entries but has no {BACKUP_SUFFIX} copy, so no copy is made and hooks are not installed; switch the hooks off first to take Kolux's entries out",
            file.display()
        ));
    }
    let tmp = copy.with_extension("bak-kolux.kolux-rs-tmp");
    let made = fs::File::create(&tmp).and_then(|mut f| f.write_all(&bytes).and_then(|_| f.sync_all())).map_err(|e| e.to_string()).and_then(|_| {
        let (a, b) = (sha256(file)?, sha256(&tmp)?);
        if a != b {
            return Err(format!("the copy hashes {b}, the file {a}"));
        }
        write_record(record, file, &a, &copy, &b)?;
        fs::rename(&tmp, &copy).map_err(|e| e.to_string())?;
        Ok((a, b))
    });
    if made.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    made.map(Some).map_err(refuse)
}

/// T-152-c (4): Kolux's hooks (`names_mine`) or status line are in this settings text.
fn holds_mine(bytes: &[u8]) -> bool {
    let Ok(mut v) = serde_json::from_slice::<Value>(bytes) else { return false };
    v.get("statusLine").and_then(|l| l.get("command")).and_then(Value::as_str).is_some_and(is_my_command) || remove_groups(&mut v, false)
}

/// The copy's hash as `record` holds it (`<sha256>  <path>` lines), `None` when it has no line for
/// `copy`. T-152-c (1): paths are compared resolved, so another spelling of the same copy matches.
fn recorded(record: &Path, copy: &Path) -> Option<String> {
    let text = fs::read_to_string(record).ok()?;
    let want = resolved(copy);
    text.lines().find_map(|l| l.split_once("  ").filter(|(h, p)| h.len() == 64 && resolved(Path::new(p)) == want).map(|(h, _)| h.to_string()))
}

/// T-152-c (1): the folder holding one Claude settings file's status line slot (`STATUS_PREV` and
/// its `.json`) and its copy's record (`BACKUP_RECORD`): `<home>\.kolux-rs\agent-hooks\targets\<the
/// first 16 hex of the sha256 of the file's resolved path>`. Two config folders in one home never
/// share a slot or a record, and two spellings of one folder share one.
pub fn target_dir(home: &Path, file: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let key = resolved(file).to_string_lossy().into_owned();
    let hex: String = Sha256::digest(key.as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect();
    home.join(SCRIPT_DIR).join(TARGETS).join(hex)
}

/// `path` with `..`, links, letter case and slashes resolved; a file that does not exist yet has its
/// folder resolved, and a folder that cannot be resolved is taken as given (made absolute).
fn resolved(path: &Path) -> PathBuf {
    if let Ok(p) = fs::canonicalize(path) {
        return p;
    }
    match (path.parent().map(fs::canonicalize), path.file_name()) {
        (Some(Ok(dir)), Some(name)) => dir.join(name),
        _ => std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf()),
    }
}

/// FIX-2 (S8), hooks FIX-3: the record line, in place of a hash, for a file that did not exist
/// before Kolux's first install: `created  <file>`. Its own token: a record rebuilt for a kept copy
/// while the file is absent writes `missing` there, and that never means Kolux created the file.
const CREATED: &str = "created";

/// FIX-2 (S8): `record` says Kolux created `file` (it did not exist before Kolux first wrote it).
pub fn was_created(record: &Path, file: &Path) -> bool {
    let Ok(text) = fs::read_to_string(record) else { return false };
    let want = resolved(file);
    text.lines().any(|l| l.split_once("  ").is_some_and(|(h, p)| h == CREATED && resolved(Path::new(p)) == want))
}

/// FIX-2 (S5, S8): `v`, what is left of `file` once Kolux's entries are out, is `{}`, the file has
/// no kept copy and its record says Kolux created it: the file is deleted (only while it still
/// holds `text`, else `CHANGED`), the record with it. True when deleted.
pub fn drop_created(file: &Path, record: &Path, v: &Value, text: &str) -> Result<bool, String> {
    if v.as_object().is_none_or(|o| !o.is_empty()) || backup_of(file).exists() || !was_created(record, file) {
        return Ok(false);
    }
    // The same one-syscall window as `write_atomic`'s re-read and rename.
    if fs::read(file).map_err(|e| format!("{}: {e}", file.display()))? != text.as_bytes() {
        return Err(format!("{} {CHANGED}", file.display()));
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
    let _ = fs::remove_file(record);
    Ok(true)
}

/// Both hashes, written through a synced temp file and renamed over the record.
fn write_record(record: &Path, file: &Path, original: &str, copy: &Path, kept: &str) -> Result<(), String> {
    write_lines(record, &format!("{original}  {}\n{kept}  {}\n", file.display(), copy.display()))
}

/// `text` written through a synced temp file and renamed over the record.
fn write_lines(record: &Path, text: &str) -> Result<(), String> {
    let tmp = record.with_extension("sha256.kolux-rs-tmp");
    let fail = |e: std::io::Error| format!("the copy's record {}: {e}", record.display());
    if let Some(dir) = record.parent() {
        fs::create_dir_all(dir).map_err(fail)?;
    }
    fs::File::create(&tmp).and_then(|mut f| f.write_all(text.as_bytes()).and_then(|_| f.sync_all())).and_then(|_| fs::rename(&tmp, record)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        fail(e)
    })
}

fn sha256(file: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

/// The install lock, shared by every Kolux process through a file in Kolux's hook folder. A lock
/// left by a crashed install is cleared once stale; letting go removes the file only while it is
/// still this holder's, so a late release never frees a lock another process now holds.
pub struct Lock {
    file: PathBuf,
    token: String,
}

impl Lock {
    pub fn take(dir: &Path) -> Result<Lock, String> {
        Self::take_within(dir, LOCK_STALE, LOCK_WAIT)
    }

    pub fn take_within(dir: &Path, stale: Duration, wait: Duration) -> Result<Lock, String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let file = dir.join(LOCK_FILE);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
        let token = format!("{} {nanos}", std::process::id());
        let until = Instant::now() + wait;
        loop {
            match fs::OpenOptions::new().write(true).create_new(true).open(&file) {
                Ok(mut f) => {
                    f.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
                    return Ok(Lock { file, token });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let age = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
                    if age.is_some_and(|a| a >= stale) {
                        // ponytail: two waiters may both clear the same stale file; create_new still lets only one in.
                        let _ = fs::remove_file(&file);
                        continue;
                    }
                    if Instant::now() >= until {
                        return Err(format!("another Kolux is installing hooks ({} is held)", file.display()));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("{}: {e}", file.display())),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        if fs::read_to_string(&self.file).ok().as_deref() == Some(self.token.as_str()) {
            let _ = fs::remove_file(&self.file);
        }
    }
}

/// The record of the copy kept before the first install: the sha256 of the file and of the copy.
pub const BACKUP_RECORD: &str = "claude-settings.sha256";
/// The per-settings-file folders under Kolux's hook folder (`target_dir`).
pub const TARGETS: &str = "targets";

/// The production app's identifier (`tauri.conf.json`), which is also the name of its profile
/// folder. A profile folder with any other name belongs to a lane, smoke or test run.
pub const PRODUCTION_ID: &str = "com.txaisxiong.kolux-rs";

/// A fenced run writes a Claude settings file only when this file sits in its folder or in a
/// folder above it, inside the temp folder (T-152-b (2)).
pub const SCRATCH_MARKER: &str = ".kolux-rs-scratch";

/// T-152-b (2): the run is fenced when it is a test or debug build (`cargo test`, `tauri dev`,
/// `cargo test --release`), or when the profile folder (`%APPDATA%\<identifier>`, or the
/// `KOLUX_APP_DIR` a lane, smoke or evidence run sets) is not the production one. A production
/// release build with the production identifier is NOT fenced: it is the product that writes the
/// user's own file after his yes, and the status hooks switch, off by default, is the gate there.
/// T-152-c (5): also fenced when `KOLUX_APP_DIR` or `KOLUX_USER_DATA_PATH` names any folder but
/// the production profile (a release build started by a lane or evidence run that points those
/// at scratch). The installed app sets them only in the panes it opens, and always to its own
/// production profile, so a `kolux` command typed in one of its panes is not fenced.
pub fn fenced(profile: &Path) -> bool {
    fenced_by(profile, cfg!(any(test, debug_assertions)), |n| std::env::var_os(n))
}

/// `fenced` with the build kind and the environment given.
fn fenced_by(profile: &Path, test_or_debug: bool, var: impl Fn(&str) -> Option<std::ffi::OsString>) -> bool {
    let production = |p: &Path| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case(PRODUCTION_ID));
    let lane = [crate::cli::APP_DIR_ENV, "KOLUX_USER_DATA_PATH"].into_iter().filter_map(var).filter(|v| !v.is_empty()).any(|v| !production(Path::new(&v)));
    test_or_debug || !production(profile) || lane
}

/// T-152 (1): the only Claude settings file Kolux writes is the one `CLAUDE_CONFIG_DIR` (or the
/// home folder) resolves to. A fenced run (see `fenced`) writes it only inside the temp folder
/// and below a scratch marker, so a run that inherited the user's own variables (or a TEMP set to
/// a drive root) can never reach his file.
pub fn claude_target(profile: &Path) -> Result<PathBuf, String> {
    fenced_file(profile, claude_settings_file())
}

/// `file` itself, or the refusal a fenced run gets for it.
fn fenced_file(profile: &Path, file: PathBuf) -> Result<PathBuf, String> {
    if fenced(profile) {
        scratch_only(&file, &std::env::temp_dir(), &home_dir())?;
    }
    Ok(file)
}

/// Row 989: the folders of the Claude accounts Kolux manages. A pane on one runs with
/// `CLAUDE_CONFIG_DIR` there, so Claude Code reads that folder's `settings.json`, not the default.
fn managed_claude_accounts(profile: &Path) -> Vec<PathBuf> {
    // `file_type` does not follow links, so a symlink or junction under the folder is not an account.
    fs::read_dir(profile.join(crate::claude_accounts::FOLDER)).map(|d| d.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect()).unwrap_or_default()
}

/// `file` as a comparison key: its folder resolved, so the same file spelled two ways matches.
fn path_key(file: &Path) -> String {
    let resolved = file.parent().and_then(|d| fs::canonicalize(d).ok()).zip(file.file_name()).map(|(d, n)| d.join(n)).unwrap_or_else(|| file.to_path_buf());
    let key = resolved.to_string_lossy().into_owned();
    if cfg!(windows) { key.to_lowercase() } else { key }
}

/// Every Claude settings file Kolux keeps hooks in: the default one, the one a `CLAUDE_CONFIG_DIR`
/// the user set for Claude's panes names (row 989 ruling, the folder trust uses), then each managed
/// account's (under the same fence). Each is its own result, so one refused file never hides the
/// others; a file reached twice is listed once.
fn claude_targets(settings: &Value, profile: &Path) -> Vec<Result<PathBuf, String>> {
    let own = crate::claude_accounts::user_config_dir(settings).map(|d| fenced_file(profile, d.join("settings.json")));
    let accounts = managed_claude_accounts(profile).into_iter().map(|d| fenced_file(profile, d.join("settings.json")));
    let mut seen = Vec::new();
    std::iter::once(claude_target(profile))
        .chain(own)
        .chain(accounts)
        .filter(|t| t.as_ref().map_or(true, |f| {
            let key = path_key(f);
            !seen.contains(&key) && {
                seen.push(key);
                true
            }
        }))
        .collect()
}

/// `step` on every Claude settings file; all are tried, and the failures come back together.
fn each_claude_target(settings: &Value, profile: &Path, step: impl Fn(&Path) -> Result<(), String>) -> Result<(), String> {
    each_listed_target(claude_targets(settings, profile), profile, step)
}

/// `each_claude_target` over a list already made. Row 989: a managed account's folder that has gone
/// since the list was made (the account was removed meanwhile) is left as it was, not created again;
/// the default file and the user's own folder may legitimately not exist yet.
fn each_listed_target(targets: Vec<Result<PathBuf, String>>, profile: &Path, step: impl Fn(&Path) -> Result<(), String>) -> Result<(), String> {
    let accounts = profile.join(crate::claude_accounts::FOLDER);
    let gone = |f: &Path| f.parent().is_some_and(|d| d.parent() == Some(accounts.as_path()) && !d.is_dir());
    let failed: Vec<String> = targets.into_iter().filter_map(|t| t.and_then(|f| if gone(&f) { Ok(()) } else { step(&f) }).err()).collect();
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed.join("; "))
    }
}

/// `file`'s folder lies inside `scratch` and it, or a folder above it that is still strictly below
/// `scratch`, holds the scratch marker (a marker in `scratch` itself does not count). Both sides
/// are resolved, so `..`, links and letter case cannot slip past; anything that cannot be resolved
/// is refused. T-152-c (5): a `scratch` that is a drive root, or that is or holds `home` (the
/// user's home folder), is too wide to be scratch and refuses everything.
pub fn scratch_only(file: &Path, scratch: &Path, home: &Path) -> Result<(), String> {
    let refuse = |why: &str| Err(format!("a test, dev or lane run writes agent settings only under {} below a {SCRATCH_MARKER} marker{why}; {} left alone", scratch.display(), file.display()));
    let Ok(root) = fs::canonicalize(scratch) else { return refuse(" (the temp folder cannot be resolved)") };
    if root.parent().is_none() {
        return refuse(" (the temp folder is a drive root)");
    }
    match fs::canonicalize(home) {
        Ok(h) if h.starts_with(&root) => return refuse(&format!(" (the temp folder holds the home folder {})", home.display())),
        Ok(_) => {}
        Err(_) => return refuse(&format!(" (the home folder {} cannot be resolved)", home.display())),
    }
    let inside = file.parent().map(fs::canonicalize).and_then(Result::ok).is_some_and(|dir| {
        dir.starts_with(&root) && dir.ancestors().take_while(|a| a.starts_with(&root) && *a != root).any(|a| a.join(SCRATCH_MARKER).is_file())
    });
    if inside {
        Ok(())
    } else {
        refuse("")
    }
}

/// Claude Code's scripts, hooks and status line, after its settings were copied once.
fn install_claude_all(home: &Path, settings: &Value, profile: &Path) -> Result<(), String> {
    each_claude_target(settings, profile, |file| install_claude_at(home, file))
}

/// The home folder Kolux's hook scripts and install lock live under.
pub fn user_home() -> PathBuf {
    home_dir()
}

/// Row 989: `f` while holding the install lock `sync` takes under `home`, so an account folder is not
/// deleted while hooks are being written into it. A lock that cannot be had in a few seconds is
/// logged and `f` runs anyway: removing an account must never fail on it.
pub fn with_install_lock<T>(home: &Path, f: impl FnOnce() -> T) -> T {
    let lock = Lock::take_within(&home.join(SCRIPT_DIR), LOCK_STALE, Duration::from_secs(5));
    if let Err(e) = &lock {
        eprintln!("kolux-rs: agent hooks: {e}");
    }
    let out = f();
    drop(lock);
    out
}

/// Row 989: a Claude account was just added, so its `settings.json` gets Kolux's hooks now rather
/// than at the next start. Only when the status hooks are on and a sync would install Claude's;
/// takes the lock `sync` takes. Slow only for the program search, so call it off the UI thread.
pub fn install_claude_account(settings: &Value, profile: &Path, dir: &Path) -> Result<&'static str, String> {
    let (installed, searched) = detect_installed();
    install_claude_account_with(&home_dir(), settings, profile, dir, &installed, searched)
}

fn install_claude_account_with(home: &Path, settings: &Value, profile: &Path, dir: &Path, installed: &[String], searched: bool) -> Result<&'static str, String> {
    if !plan(settings, installed, searched).contains(&("claude", Plan::Install)) {
        return Ok("left as it was");
    }
    let named = dir.components().next_back().is_some_and(|c| matches!(c, std::path::Component::Normal(_)));
    if !named || dir.parent() != Some(profile.join(crate::claude_accounts::FOLDER).as_path()) {
        return Err(format!("{} is not one of Kolux's Claude account folders; hooks not installed", dir.display()));
    }
    let _lock = Lock::take(&home.join(SCRIPT_DIR))?;
    // Checked under the lock `claude_accounts::discard` also takes, so a folder removed meanwhile does not come back.
    if !dir.is_dir() {
        return Ok("left as it was");
    }
    install_claude_at(home, &fenced_file(profile, dir.join("settings.json"))?).map(|_| "installed")
}

pub fn install_claude_at(home: &Path, file: &Path) -> Result<(), String> {
    let path = write_claude_script(home)?;
    let status = write_status_script(home)?;
    // T-152-c (1): the status line slot and the copy's record belong to this settings file.
    let dir = target_dir(home, file);
    let prev = dir.join(STATUS_PREV);
    let status = status_command(&status, &prev.to_string_lossy().replace('\\', "/"));
    let command = format!("\"{path}\" || exit 0");
    // T-152-b (5): a file Claude Code saved between Kolux's read and its write is read again and
    // merged once more (the copy check and the status line save included); a second change fails.
    once_more(|| install_claude_once(file, &dir, &prev, &command, &status))
}

/// One read, check and write of `install_claude_at`.
fn install_claude_once(file: &Path, dir: &Path, prev: &Path, hook: &str, status: &str) -> Result<(), String> {
    // T-152 (3): a file that is not JSON is refused before anything is written, the copy included.
    let text = read_opt(file)?;
    let had: Option<Value> = text.as_deref().map(serde_json::from_str).transpose().map_err(|e| format!("{} is not JSON ({e}); hooks not installed", file.display()))?;
    // T-152-b (3): the copy is verified against its record on every install, not only the first.
    if let Some((original, copy)) = back_up(file, &dir.join(BACKUP_RECORD))? {
        eprintln!("kolux-rs: claude hooks: kept a copy before the first write: sha256 original {original}, backup {copy}");
    }
    // T-152 (4): the status line slot as the user had it (`null`: none), put back whole on removal,
    // and its command, which keeps running from `prev` (STAT-040). Both are saved BEFORE the
    // settings file is touched, so a failed save never leaves his line replaced.
    if let Some(s) = &had {
        fs::create_dir_all(dir).map_err(|e| format!("claude status line: {}: {e}", dir.display()))?;
        let slot = s.get("statusLine").cloned().unwrap_or(Value::Null);
        let command = slot.get("command").and_then(Value::as_str);
        if !command.is_some_and(is_my_command) {
            fs::write(prev.with_extension("json"), slot.to_string()).map_err(|e| format!("claude status line: {e}"))?;
            if let Some(c) = command.filter(|c| !c.trim().is_empty()) {
                fs::write(prev, format!("{c}\n")).map_err(|e| format!("claude status line: {e}"))?;
            }
        }
    }
    // T-152 (5): against the bytes read above, so a file changed since then is never overwritten.
    install_claude_from(file, text, hook, status)?;
    Ok(())
}

fn codex_home() -> Option<PathBuf> {
    crate::trust::codex_config_file().parent().map(Path::to_path_buf)
}

/// The private Codex homes of the accounts Kolux manages (ACCT-007), which get Kolux's hooks as a
/// pane starts in them.
fn managed_codex_homes(profile: &Path) -> Vec<PathBuf> {
    fs::read_dir(profile.join(crate::codex_accounts::FOLDER)).map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

fn apply(home: &Path, profile: &Path, settings: &Value, id: &str, plan: Plan) -> Result<&'static str, String> {
    match (id, plan) {
        ("claude", Plan::Install) => install_claude_all(home, settings, profile).map(|_| "installed"),
        ("claude", Plan::Remove) => each_claude_target(settings, profile, |file| remove_claude(file, &target_dir(home, file).join(STATUS_PREV)).map(|_| ())).map(|_| "removed"),
        // T-152 (6): the user's own Codex home is neither written nor cleared while T-025-e is off
        // the cutline, so on and off leave its bytes exactly as they were; only the managed homes a
        // pane starts in (Kolux's own folders) are cleared.
        ("codex", Plan::Install) => Ok("not written (Codex hooks wait for T-025-e)"),
        ("codex", Plan::Remove) => {
            for h in managed_codex_homes(profile) {
                remove_codex(&h)?;
            }
            Ok("removed")
        }
        // T-120-b: Gemini CLI, Antigravity and Amp.
        (id @ ("gemini" | "antigravity" | "amp"), Plan::Install | Plan::Remove) => vendors::apply(home, profile, id, plan),
        // T-121: Cursor Agent, Droid, Kimi Code and Hermes; T-122: Copilot CLI, Grok, Devin and Pi.
        (id @ ("cursor" | "droid" | "command-code" | "kimi" | "copilot" | "grok" | "devin" | "pi" | "hermes"), Plan::Install | Plan::Remove) => more::apply(home, profile, id, plan),
        _ => Ok("left as it was"),
    }
}

/// The agents found on this computer (one search of the program folders), and whether the search ran.
fn detect_installed() -> (Vec<String>, bool) {
    let searched = !crate::agents::search_dirs().is_empty();
    if !searched {
        eprintln!("kolux-rs: agent hooks: no program folder could be searched, so no hooks were installed");
    }
    (if searched { crate::agents::catalogue().into_iter().filter(|a| a.installed).map(|a| a.id).collect() } else { Vec::new() }, searched)
}

/// At start, and whenever an agent is switched on or off: Kolux's scripts are refreshed, then
/// each managed agent is installed, cleared or left by `plan`. Never stops the launch; each
/// agent's outcome is returned and problems also go to stderr. `profile` is Kolux's data folder.
/// T-152-gate (STAT-002): while the status hooks switch is off it does nothing and writes nothing.
pub fn sync(settings: &Value, profile: &Path) -> Vec<(&'static str, Result<&'static str, String>)> {
    if !switch::on(settings) {
        eprintln!("kolux-rs: agent hooks: switched off, nothing installed or changed");
        return Vec::new();
    }
    let home = home_dir();
    let _lock = match Lock::take(&home.join(SCRIPT_DIR)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("kolux-rs: agent hooks: {e}");
            return Vec::new();
        }
    };
    for refresh in [write_claude_script, write_status_script, write_codex_script, vendors::write_gemini_script, vendors::write_antigravity_script, more::write_scripts] {
        if let Err(e) = refresh(&home) {
            eprintln!("kolux-rs: agent hook script: {e}");
        }
    }
    let (installed, searched) = detect_installed();
    plan(settings, &installed, searched)
        .into_iter()
        .map(|(id, p)| {
            let out = apply(&home, profile, settings, id, p);
            match &out {
                Ok(what) => eprintln!("kolux-rs: {id} hooks: {what}"),
                Err(e) => eprintln!("kolux-rs: {id} hooks: {e}"),
            }
            (id, out)
        })
        .collect()
}

/// STAT-002: the user switched the status hooks off: Kolux's own entries come out of every agent
/// (the user's own hooks stay), and nothing else is written, not even Kolux's scripts.
pub fn clear(settings: &Value, profile: &Path) -> Vec<(&'static str, Result<&'static str, String>)> {
    clear_in(&home_dir(), settings, profile)
}

/// `clear` with the home folder (scripts, install lock, vendor files) named, so a test stays in a scratch one.
fn clear_in(home: &Path, settings: &Value, profile: &Path) -> Vec<(&'static str, Result<&'static str, String>)> {
    let _lock = match Lock::take(&home.join(SCRIPT_DIR)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("kolux-rs: agent hooks: {e}");
            return Vec::new();
        }
    };
    MANAGED.iter().map(|&id| (id, apply(home, profile, settings, id, Plan::Remove))).collect()
}

/// Each agent's outcome as `kolux agent hooks on|off` and the Agents page show it: `agent`, `done`
/// (what was done) and `error` (why it failed), one of the two null.
pub fn outcomes(all: Vec<(&'static str, Result<&'static str, String>)>) -> Vec<Value> {
    all.into_iter().map(|(id, r)| json!({ "agent": id, "done": r.as_ref().ok(), "error": r.err() })).collect()
}

/// STAT-004: the Agents page switched an agent on or off; the hooks follow off the main thread.
/// `clear` is the status hooks switch just turned off (STAT-002), which takes Kolux's entries out.
/// T-152-c (3): the reply is each agent's outcome (`outcomes`), so a failed install or removal
/// reaches the page instead of only stderr; an empty list means nothing ran (switch off, or the
/// install lock could not be had, which stderr names).
#[tauri::command]
pub async fn agent_hooks_sync(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, clear: Option<bool>) -> Result<Vec<Value>, String> {
    let (settings, profile) = store.lock().map(|s| (s.settings(), s.dir())).map_err(|e| e.to_string())?;
    let off = clear == Some(true) && !switch::on(&settings);
    let all = tauri::async_runtime::spawn_blocking(move || if off { self::clear(&settings, &profile) } else { sync(&settings, &profile) }).await.map_err(|e| e.to_string())?;
    Ok(outcomes(all))
}

/// T-152-gate: the Claude Code settings file the hooks go into, shown beside the switch.
#[tauri::command]
pub fn agent_hooks_file() -> String {
    crate::hooks::claude_settings_file().display().to_string()
}

pub mod codex_mirror;
pub mod more;
pub mod saved;
pub mod switch;
pub mod vendors;

#[cfg(test)]
mod tests;
