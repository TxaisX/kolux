//! What an older profile brings into this one.
//!
//! APP-004 (T-213): on the first launch, settings saved by the former product (Nightshift) carry
//! over, through an allow-list. The former profile folder is found beside this profile in the
//! system's application-data folder, in any letter case; finding it only points at it. Exactly one
//! file in it is read: its settings file (`settings.json`, or the same name under the former product's
//! name), never through a link and never past a size cap. Each saved setting takes the current name
//! through the renaming rule (`nightshiftX` becomes `koluxX`, the `nightshift.` interface prefix becomes
//! `kolux.`) and carries only when that name is on [`carried`], its value has the listed shape, and
//! neither its name nor its value looks like a secret. A value already saved here wins; nothing is
//! ever copied raw, no file of the former folder is copied, and every other item there (hook scripts,
//! key vault, cookies, transcripts, caches) is counted as skipped without being opened (COMPAT 5.2,
//! 5.3; OD-05). The summary carries counts only, never a skipped name or value.
//!
//! It runs once per profile, in the background after the window shows, under a lock file; the
//! settings write is the store's own (a temp file renamed into place, the last good copy kept).
//! Development, test and lane profiles never get it (`agent_hooks::fenced`). A settings file here
//! that cannot be read stops it without marking it done, so a later launch tries again.
//! Not carried yet: project, repo and worktree records, whose former shape no allowed source
//! describes (T-213-b).
//!
//! HID-036 (T-331): settings retired before this rebuild are dropped quietly from an older profile,
//! with no message and no failed load, and never come back: `without_retired` is the filter the
//! settings load and save apply (coordinator hunk in state.rs, T-331 commit body), and the
//! carry-over applies it to what it brings in. A retired setting is recognised by its exact old
//! spelling only, so a key a newer build writes is never dropped.

use crate::state::Store;
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// The former product name, as its profile folder and its settings carried it.
pub const FORMER_NAME: &str = "nightshift";
/// Set in the profile's store once the former-name carry-over has run (or found nothing to carry).
const KEY_CARRIED: &str = "former_name_carried";
/// The lock file in this profile while a carry-over runs; one older than [`STALE_LOCK`] is taken over.
const LOCK_FILE: &str = "former-import.lock";
const STALE_LOCK: Duration = Duration::from_secs(600);
/// The former settings file is not read past this size.
const MAX_SETTINGS_BYTES: u64 = 1 << 20;
/// Items of the former folder counted (never opened) before the count stops; and how deep it looks.
const MAX_COUNTED: usize = 50_000;
const MAX_DEPTH: usize = 12;
/// The longest text value that carries.
const MAX_TEXT: usize = 64;

/// The shape a carried setting's value must have.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    Bool,
    Number,
    /// A short word: at most [`MAX_TEXT`] characters of letters, digits, space and `. _ - : +`.
    Word,
    /// A list of short words.
    Words,
}

/// The settings registry: the one file (`src/carry/settingsRegistry.json`) naming what the importer
/// carries and what it knowingly leaves off. The front end's own test (`settingsRegistry.test.ts`)
/// keeps it in step with the settings fields in `src/**` (T-213, after-list row 651).
const REGISTRY: &str = include_str!("../../src/carry/settingsRegistry.json");

/// The registry, read once. A file that does not parse carries nothing (fail closed); a test pins that it parses.
pub struct Registry {
    pub carried: Vec<(String, Shape)>,
    /// Settings left off on purpose; read by the tests, which keep it in step with the front end.
    #[cfg_attr(not(test), allow(dead_code))]
    pub not_carried: Vec<String>,
}

fn parse_registry(text: &str) -> Option<Registry> {
    let v: Value = serde_json::from_str(text).ok()?;
    let carried = v.get("carried")?.as_array()?.iter().map(|e| {
        let shape = match e.get("shape")?.as_str()? {
            "bool" => Shape::Bool,
            "number" => Shape::Number,
            "word" => Shape::Word,
            "words" => Shape::Words,
            _ => return None,
        };
        Some((e.get("name")?.as_str()?.to_owned(), shape))
    });
    let not_carried = v.get("notCarried")?.as_array()?.iter().map(|e| e.as_str().map(str::to_owned));
    Some(Registry { carried: carried.collect::<Option<_>>()?, not_carried: not_carried.collect::<Option<_>>()? })
}

pub fn registry() -> &'static Registry {
    static CELL: std::sync::OnceLock<Registry> = std::sync::OnceLock::new();
    CELL.get_or_init(|| parse_registry(REGISTRY).unwrap_or(Registry { carried: Vec::new(), not_carried: Vec::new() }))
}

/// OD-19: the settings the importer carries, by their name in this rebuild (each checked against the
/// field the settings pages read), with the shape each value must have. A former setting carries only
/// when its name, after the renaming rule, is one of these, exactly. Everything else is dropped, not
/// guessed (COMPAT 5.2 row 1). Left off on purpose: anything that can hold a secret, a command, a
/// path or free text (proxy address, commit-writer command and instructions, kit inputs, review
/// notes, agent options and environment, custom sound file, shell path).
pub fn carried() -> &'static [(String, Shape)] {
    &registry().carried
}

/// Parts of a setting name that mark a secret or something never carried (hook configs, prompts,
/// transcripts), matched in any letter case anywhere in the name. Checked before the allow-list, so
/// even a listed name is refused if one of these is in it.
const SECRET_WORDS: &[&str] = &[
    "token", "secret", "password", "passwd", "cookie", "credential", "oauth", "auth", "apikey", "api_key", "privatekey", "bearer",
    "vault", "hook", "prompt", "transcript", "proxy", "session_url", "sessionurl",
];
/// How secret values often start; a value that does is refused whatever its name.
const SECRET_STARTS: &[&str] = &["sk-", "ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "xox", "akia", "eyj", "bearer "];

/// Why a former item did not carry. Counts only: never a name or a value.
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
pub struct Skipped {
    /// Settings whose (renamed) name is not on [`carried`], retired ones included.
    pub not_listed: usize,
    /// Settings whose name or value looks like a secret, a hook, a prompt or a transcript.
    pub secret_like: usize,
    /// Listed settings whose value does not have the listed shape.
    pub wrong_shape: usize,
    /// Items in the former folder other than its settings file, counted without being opened.
    pub items: usize,
    /// Links and junctions in the former folder, never followed.
    pub links: usize,
    /// The settings file was too big, could not be read (held by another program, say) or was not a settings object.
    pub unreadable: usize,
}

impl Skipped {
    pub fn total(&self) -> usize {
        self.not_listed + self.secret_like + self.wrong_shape + self.items + self.links + self.unreadable
    }
}

/// What a carry-over would do (the preview) or did (the summary).
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
pub struct Preview {
    /// Settings that would be added, by their current name, with the value they carry.
    pub add: Vec<(String, Value)>,
    /// Listed settings left alone because this profile already has a value for them.
    pub kept: usize,
    /// How many of `add` came under a former name.
    pub renamed: usize,
    pub skipped: Skipped,
}

impl Preview {
    /// The one-line record of a carry-over: counts only.
    pub fn summary(&self) -> String {
        let s = &self.skipped;
        format!(
            "{} added ({} renamed), {} kept, {} skipped: {} not on the list, {} secret-like, {} wrong shape, {} other items, {} links, {} unreadable",
            self.add.len(),
            self.renamed,
            self.kept,
            s.total(),
            s.not_listed,
            s.secret_like,
            s.wrong_shape,
            s.items,
            s.links,
            s.unreadable
        )
    }
}

/// The former product's profile folder in `app_data` (the folder that holds this profile), matched
/// in any letter case; never a file and never a link. Only the folder's name is looked at.
pub fn former_profile(app_data: &Path) -> Option<PathBuf> {
    fs::read_dir(app_data).ok()?.flatten().find_map(|e| {
        let named = e.file_name().to_str().is_some_and(|n| n.eq_ignore_ascii_case(FORMER_NAME));
        (named && e.file_type().is_ok_and(|t| t.is_dir())).then(|| e.path())
    })
}

/// `key` with each former product name in it replaced by the current one in the same letter case
/// style (nightshift, Nightshift, NIGHTSHIFT); `None` when it holds no former name.
pub fn current_name(key: &str) -> Option<String> {
    let lower = key.to_ascii_lowercase();
    if !lower.contains(FORMER_NAME) {
        return None;
    }
    let (mut out, mut at) = (String::with_capacity(key.len()), 0);
    while let Some(i) = lower[at..].find(FORMER_NAME).map(|i| i + at) {
        out.push_str(&key[at..i]);
        let found = &key[i..i + FORMER_NAME.len()];
        out.push_str(if found.bytes().all(|b| b.is_ascii_uppercase()) {
            "KOLUX"
        } else if found.starts_with(|c: char| c.is_ascii_uppercase()) {
            "Kolux"
        } else {
            "kolux"
        });
        at = i + FORMER_NAME.len();
    }
    out.push_str(&key[at..]);
    Some(out)
}

/// The current name a former setting carries under: the renaming rule, then a `kolux` camelCase
/// prefix (`koluxLanguage`, the former `nightshiftLanguage`) read as the bare name (`language`) when
/// that bare name is listed.
fn carried_name(key: &str) -> (String, bool) {
    let renamed = current_name(key);
    let name = renamed.clone().unwrap_or_else(|| key.to_owned());
    if listed(&name).is_none() {
        if let Some(rest) = name.strip_prefix("kolux") {
            let mut c = rest.chars();
            if let Some(first) = c.next().filter(|c| c.is_ascii_uppercase()) {
                let bare = format!("{}{}", first.to_ascii_lowercase(), c.as_str());
                if listed(&bare).is_some() {
                    return (bare, renamed.is_some());
                }
            }
        }
    }
    (name, renamed.is_some())
}

fn listed(name: &str) -> Option<Shape> {
    carried().iter().find(|(n, _)| n == name).map(|(_, s)| *s)
}

/// Whether a setting name marks a secret or something never carried.
pub fn secret_name(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    SECRET_WORDS.iter().any(|w| k.contains(w)) || k.ends_with("key") || k.ends_with("keys")
}

fn secret_text(t: &str) -> bool {
    let l = t.trim_start().to_ascii_lowercase();
    SECRET_STARTS.iter().any(|p| l.starts_with(p))
}

/// Whether a value looks like a secret: a text (or a text inside a list) that starts the way keys and tokens do.
fn secret_value(v: &Value) -> bool {
    match v {
        Value::String(t) => secret_text(t),
        Value::Array(a) => a.iter().any(secret_value),
        Value::Object(o) => o.values().any(secret_value),
        _ => false,
    }
}

fn word(v: &Value) -> bool {
    v.as_str().is_some_and(|t| {
        !t.is_empty() && t.chars().count() <= MAX_TEXT && t.chars().all(|c| c.is_ascii_alphanumeric() || " ._-:+".contains(c))
    })
}

fn fits(shape: Shape, v: &Value) -> bool {
    match shape {
        Shape::Bool => v.is_boolean(),
        Shape::Number => v.as_f64().is_some_and(f64::is_finite),
        Shape::Word => word(v),
        Shape::Words => v.as_array().is_some_and(|a| a.len() <= MAX_TEXT && a.iter().all(word)),
    }
}

/// The preview: what carrying `former` (the former settings object) into `current` (this profile's
/// settings) would change. Settings already under a current name are taken before former-name ones,
/// so `language` wins over `nightshiftLanguage` in the same file.
pub fn plan(former: &Map<String, Value>, current: &Map<String, Value>) -> Preview {
    let mut out = Preview::default();
    let mut keys: Vec<(&String, &Value)> = former.iter().collect();
    keys.sort_by_key(|(k, _)| current_name(k).is_some());
    for (key, value) in keys {
        let (name, renamed) = carried_name(key);
        if secret_name(key) || secret_name(&name) || secret_value(value) {
            out.skipped.secret_like += 1;
            continue;
        }
        let Some(shape) = listed(&name).filter(|_| !is_retired(key) && !is_retired(&name)) else {
            out.skipped.not_listed += 1;
            continue;
        };
        if !fits(shape, value) {
            out.skipped.wrong_shape += 1;
        } else if current.contains_key(&name) || out.add.iter().any(|(n, _)| *n == name) {
            out.kept += 1;
        } else {
            out.renamed += usize::from(renamed);
            out.add.push((name, value.clone()));
        }
    }
    out
}

/// The former folder's settings file: `settings.json`, or that name under the former product's name,
/// in any letter case, a plain file (never a link) no bigger than the cap. Every other item in the
/// folder is counted into `skipped` without being opened; links are counted and never followed.
pub fn read_former(from: &Path, skipped: &mut Skipped) -> Option<Map<String, Value>> {
    let mut settings = None;
    if let Ok(entries) = fs::read_dir(from) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let renamed = current_name(&name).unwrap_or_else(|| name.clone());
            let is_settings = ["settings.json", "kolux-settings.json"].iter().any(|n| renamed.eq_ignore_ascii_case(n));
            match e.file_type() {
                Ok(t) if t.is_symlink() => skipped.links += 1,
                Ok(t) if t.is_file() && is_settings && settings.is_none() => settings = Some(e.path()),
                Ok(t) if t.is_dir() => {
                    skipped.items += 1;
                    count_items(&e.path(), 1, skipped);
                }
                _ => skipped.items += 1,
            }
        }
    } else {
        skipped.unreadable += 1;
        return None;
    }
    let path = settings?;
    let parsed = read_capped(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    match parsed {
        Some(Value::Object(m)) => Some(m),
        _ => {
            skipped.unreadable += 1;
            None
        }
    }
}

fn read_capped(path: &Path) -> io::Result<Vec<u8>> {
    let f = fs::File::open(path)?;
    if f.metadata()?.len() > MAX_SETTINGS_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "too big"));
    }
    let mut bytes = Vec::new();
    f.take(MAX_SETTINGS_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "too big"));
    }
    Ok(bytes)
}

/// Counts what is under `dir` (names only, never contents), links never followed, with a depth and a count cap.
fn count_items(dir: &Path, depth: usize, skipped: &mut Skipped) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if skipped.items + skipped.links >= MAX_COUNTED {
            return;
        }
        match e.file_type() {
            Ok(t) if t.is_symlink() => skipped.links += 1,
            Ok(t) if t.is_dir() => {
                skipped.items += 1;
                count_items(&e.path(), depth + 1, skipped);
            }
            _ => skipped.items += 1,
        }
    }
}

/// Writes the previewed settings into `store`, over what is on disk now, a value already there
/// winning; returns what was really added.
pub fn apply(store: &Store, mut preview: Preview) -> io::Result<Preview> {
    let now = store.try_settings()?;
    let has = |n: &str| now.as_object().is_some_and(|o| o.contains_key(n));
    let before = preview.add.len();
    preview.add.retain(|(n, _)| !has(n));
    preview.kept += before - preview.add.len();
    if !preview.add.is_empty() {
        let set: Map<String, Value> = preview.add.iter().cloned().collect();
        store.patch_settings(&set, &[])?;
    }
    Ok(preview)
}

/// The lock that keeps two carry-overs from running at once; removed on drop.
struct Lock(PathBuf);

impl Lock {
    fn take(profile: &Path) -> Option<Lock> {
        let path = profile.join(LOCK_FILE);
        let open = || fs::OpenOptions::new().write(true).create_new(true).open(&path);
        if open().is_err() {
            let stale = path
                .symlink_metadata()
                .ok()
                .filter(|m| m.is_file())
                .and_then(|m| m.modified().ok())
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age > STALE_LOCK);
            if !stale || fs::remove_file(&path).is_err() || open().is_err() {
                return None;
            }
        }
        Some(Lock(path))
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// APP-004 at start, for the installed app's own profile only (`profile` is its folder, `store` its
/// store). Run off the window's thread: the store is held only to check, to apply and to record.
pub fn first_launch(profile: &Path, store: &Mutex<Store>) -> Option<Preview> {
    if crate::hooks::agent_hooks::fenced(profile) {
        return None;
    }
    let out = carry_over(profile, store);
    if let Some(p) = &out {
        crate::diag::write(profile, &format!("settings from the former name carried over: {} (APP-004)", p.summary()));
    }
    out
}

/// The carry-over into `profile` from the former-name folder beside it, once per profile. `None`
/// when it ran before, when another run holds the lock, when this profile's settings cannot be read
/// (not marked done, so a later launch tries again), or when there is no former folder (marked done).
pub fn carry_over(profile: &Path, store: &Mutex<Store>) -> Option<Preview> {
    if store.lock().ok()?.get(KEY_CARRIED).ok()?.is_some() {
        return None;
    }
    let _lock = Lock::take(profile)?;
    let from = profile.parent().and_then(former_profile).filter(|f| !same_folder(f, profile));
    let mut found = Preview::default();
    let former = from.as_deref().and_then(|f| read_former(f, &mut found.skipped));
    let store = store.lock().ok()?;
    if store.get(KEY_CARRIED).ok()?.is_some() {
        return None;
    }
    let done = match &former {
        Some(former) => {
            let current = store.try_settings().ok()?;
            let mut p = plan(former, current.as_object().unwrap_or(&Map::new()));
            p.skipped = Skipped { items: found.skipped.items, links: found.skipped.links, unreadable: found.skipped.unreadable, ..p.skipped };
            apply(&store, p).ok()?
        }
        None => found,
    };
    store.set(KEY_CARRIED, &done.summary()).ok()?;
    from.map(|_| done)
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
    }
}


/// HID-036 (T-331): settings retired before this rebuild, each by the exact camelCase names an older
/// profile may have saved it under (letter case and separators matter, so a newer key that only
/// looks like one is kept). They are dropped quietly whenever settings are read or saved, so they
/// never fail a load and never come back with a later change.
pub const RETIRED: &[(&str, &[&str])] = &[
    ("scrollback size in bytes", &["scrollbackBytes", "terminalScrollbackBytes", "scrollbackSizeBytes", "scrollbackBufferSize"]),
    ("GitHub attribution", &["githubAttribution", "gitAttribution", "commitAttribution", "addGithubAttribution"]),
    ("agents sidebar", &["agentsSidebar", "agentSidebar", "showAgentsSidebar", "agentsSidebarOpen"]),
    ("OpenCode sign-in cookie", &["opencodeCookie", "opencodeSigninCookie", "opencodeSessionCookie", "opencodeAuthCookie"]),
    ("OpenCode workspace id", &["opencodeWorkspaceId", "opencodeWorkspace"]),
    ("dashboard open mode", &["dashboardOpenMode", "dashboardMode", "dashboardWindowMode"]),
    ("artifact sharing", &["artifactSharing", "artifactsSharing", "shareArtifacts"]),
    ("artifacts on or off", &["artifactsEnabled", "enableArtifacts", "artifactsOn"]),
    ("artifacts button", &["artifactsButton", "artifactButton", "showArtifactsButton"]),
    ("skip the artifact delete confirmation", &["skipArtifactDeleteConfirm", "skipArtifactDeleteConfirmation", "artifactDeleteConfirmSkip", "confirmArtifactDelete"]),
    ("skill sharing", &["skillSharing", "skillsSharing", "shareSkills"]),
    ("phone-pairing connection mode", &["pairingConnectionMode", "phonePairingMode", "mobilePairingMode"]),
];

/// A saved setting's name as the retired list spells it: a name a profile saved under the old
/// product's or the current product's camelCase prefix (`nightshiftSkillSharing`, `koluxSkillSharing`)
/// reads as the bare name (`skillSharing`). Nothing else is normalised: not letter case, not dots,
/// dashes or underscores.
fn bare(key: &str) -> String {
    for p in ["kolux", FORMER_NAME] {
        if let Some(rest) = key.strip_prefix(p) {
            let mut c = rest.chars();
            if let Some(first) = c.next().filter(|c| c.is_ascii_uppercase()) {
                return format!("{}{}", first.to_ascii_lowercase(), c.as_str());
            }
        }
    }
    key.to_owned()
}

/// Whether `key` names a retired setting.
pub fn is_retired(key: &str) -> bool {
    let b = bare(key);
    RETIRED.iter().any(|(_, names)| names.contains(&b.as_str()))
}

/// `settings` with every retired setting dropped (a value that is not an object is left alone).
pub fn without_retired(mut settings: Value) -> Value {
    drop_retired(&mut settings);
    settings
}

/// Drops the retired settings in place; returns how many went.
pub fn drop_retired(settings: &mut Value) -> usize {
    let Some(map) = settings.as_object_mut() else { return 0 };
    let before = map.len();
    map.retain(|k, _| !is_retired(k));
    before - map.len()
}

/// `path` with `.` dropped and `..` taken out lexically (a `..` never climbs past the root).
fn without_dots(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir if out.file_name().is_some() => {
                out.pop();
            }
            Component::ParentDir if out.has_root() => {}
            c => out.push(c),
        }
    }
    out
}

/// The real place `path` names: canonical when it exists, else its nearest existing ancestor made
/// canonical with the rest re-joined (dotted out first, so a `..` cannot hide the folder).
fn resolved_path(path: &Path) -> PathBuf {
    if let Ok(real) = fs::canonicalize(path) {
        return real;
    }
    let plain = without_dots(path);
    let mut rest = Vec::new();
    let mut at = plain.as_path();
    loop {
        if let Ok(mut real) = fs::canonicalize(at) {
            real.extend(rest.iter().rev());
            return real;
        }
        match (at.file_name(), at.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name.to_owned());
                at = parent;
            }
            _ => return plain,
        }
    }
}

/// APP-061 (T-199): the old-profile check of the packaged-build smoke test. Runs the carry-over into
/// a throwaway `profile` (its former-name folder beside it) and says what was added. Refuses the
/// installed app's own profile folder, so the check can never touch real data.
pub fn migrate_check(profile: &Path) -> Result<Value, String> {
    // The real path (verbatim prefix and all) decides the refusal only; the rest uses the plain dotted-out path.
    let real = resolved_path(profile);
    let production = real.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case(crate::hooks::agent_hooks::PRODUCTION_ID));
    let profile = &without_dots(profile);
    if production {
        return Err("refused: this is the installed app's own profile; point KOLUX_USER_DATA_PATH at a throwaway folder".into());
    }
    profile.parent().and_then(former_profile).filter(|f| !same_folder(f, profile)).ok_or("no former-name folder beside the profile")?;
    fs::create_dir_all(profile).map_err(|e| e.to_string())?;
    let store = Mutex::new(Store::open(profile).map_err(|e| e.to_string())?);
    let p = carry_over(profile, &store).ok_or("the carry-over did not run (done before, locked, or its settings could not be read)")?;
    let added: Vec<&String> = p.add.iter().map(|(n, _)| n).collect();
    Ok(serde_json::json!({ "profile": profile, "added": added, "renamed": p.renamed, "kept": p.kept, "skipped": p.skipped.total(), "summary": p.summary() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// An application-data folder holding an empty profile.
    fn profile(tag: &str) -> (crate::test_dir::TempDir, PathBuf) {
        let root = crate::test_dir::temp(tag);
        let profile = root.join("com.txaisxiong.kolux");
        fs::create_dir_all(&profile).unwrap();
        (root, profile)
    }

    /// A former-name folder in `root` whose settings file holds `settings`.
    fn seed_former(root: &Path, name: &str, settings: Value) -> PathBuf {
        let old = root.join(name);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), serde_json::to_vec(&settings).unwrap()).unwrap();
        old
    }

    fn open(profile: &Path) -> Mutex<Store> {
        Mutex::new(Store::open(profile).unwrap())
    }

    fn settings(store: &Mutex<Store>) -> Value {
        store.lock().unwrap().settings()
    }

    /// Every file under `dir`, read as bytes (links not followed).
    fn every_byte_under(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        for e in fs::read_dir(dir).unwrap().flatten() {
            let t = e.file_type().unwrap();
            if t.is_dir() {
                out.extend(every_byte_under(&e.path()));
            } else if t.is_file() {
                out.push((e.path(), fs::read(e.path()).unwrap_or_default()));
            }
        }
        out
    }

    const PLANTED: &str = "PLANTED-SECRET";

    /// Secret-like fields of every kind the importer must refuse, each with a value carrying [`PLANTED`].
    fn planted() -> Map<String, Value> {
        json!({
            "nightshiftGithubToken": "ghp_PLANTED-SECRET-01",
            "claudeOauthToken": "PLANTED-SECRET-02",
            "minimaxCookie": "PLANTED-SECRET-03",
            "xaiApiKey": "PLANTED-SECRET-04",
            "hooks": {"Stop": [{"command": "PLANTED-SECRET-05"}]},
            "nightshiftAgentHooks": ["PLANTED-SECRET-06"],
            "lastPrompt": "PLANTED-SECRET-07",
            "transcriptPath": "PLANTED-SECRET-08",
            "httpProxy": "http://me:PLANTED-SECRET-09@proxy",
            "sessionSecret": "PLANTED-SECRET-10",
            "grokKey": "PLANTED-SECRET-11",
            "accountPassword": "PLANTED-SECRET-12",
            "browserSearchSessionUrl": "PLANTED-SECRET-13",
            "defaultAgent": "sk-ant-PLANTED-SECRET-14",
            "disabledAgents": ["codex", "ghp_PLANTED-SECRET-15"],
            "vaultSealed": "PLANTED-SECRET-16",
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn t213_app004_the_former_folder_is_found_in_any_letter_case_and_only_as_a_folder() {
        let (root, _) = profile("imp-case");
        assert_eq!(former_profile(&root), None);
        fs::write(root.join("nightshift"), b"a file, not a profile").unwrap();
        assert_eq!(former_profile(&root), None);
        fs::remove_file(root.join("nightshift")).unwrap();
        let old = seed_former(&root, "NightShift", json!({}));
        assert_eq!(former_profile(&root).map(|p| p.file_name().unwrap().to_owned()), old.file_name().map(|n| n.to_owned()));
    }

    #[test]
    fn t213_app004_a_seeded_setting_carries_under_its_current_name_and_a_second_launch_changes_nothing() {
        let (root, profile) = profile("imp-seed");
        seed_former(&root, "NIGHTSHIFT", json!({"nightshiftLanguage": "fr", "uiLook": "new", "quietMinutes": 15, "nightshift.sidebarWidth": 240, "someUnknownThing": 1}));
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("carried");
        assert_eq!(p.add, vec![("uiLook".into(), json!("new")), ("quietMinutes".into(), json!(15)), ("language".into(), json!("fr"))]);
        assert_eq!((p.renamed, p.kept, p.skipped.not_listed, p.skipped.total()), (1, 0, 2, 2));
        assert_eq!(settings(&store), json!({"uiLook": "new", "quietMinutes": 15, "language": "fr"}));
        assert_eq!(
            store.lock().unwrap().get(KEY_CARRIED).unwrap().as_deref(),
            Some("3 added (1 renamed), 0 kept, 2 skipped: 2 not on the list, 0 secret-like, 0 wrong shape, 0 other items, 0 links, 0 unreadable")
        );
        // Second launch: it ran already, so nothing is read or written again.
        let before = fs::read(profile.join("settings.json")).unwrap();
        assert_eq!(carry_over(&profile, &store), None);
        assert_eq!(fs::read(profile.join("settings.json")).unwrap(), before);
        // And the same carry repeated adds nothing: every listed setting is already here.
        let again = plan(&read_former(&root.join("NIGHTSHIFT"), &mut Skipped::default()).unwrap(), settings(&store).as_object().unwrap());
        assert_eq!((again.add.len(), again.kept), (0, 3));
    }

    #[test]
    fn t213_app004_a_value_already_saved_here_wins_and_no_file_in_the_profile_changes() {
        let (root, profile) = profile("imp-keep");
        seed_former(&root, "nightshift", json!({"language": "fr", "keepAwake": true}));
        fs::write(profile.join("projects.json"), b"mine").unwrap();
        fs::write(profile.join("settings.json"), br#"{"language":"ja","theme":"mine"}"#).unwrap();
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("carried");
        assert_eq!((p.add.len(), p.kept), (1, 1));
        assert_eq!(settings(&store), json!({"language": "ja", "theme": "mine", "keepAwake": true}));
        assert_eq!(fs::read(profile.join("projects.json")).unwrap(), b"mine");
    }

    #[test]
    fn t213_planted_secrets_hooks_prompts_and_transcripts_never_carry_and_never_show_in_the_preview_or_summary() {
        let (root, profile) = profile("imp-secrets");
        let mut former = planted();
        former.insert("language".into(), json!("es"));
        let old = seed_former(&root, "nightshift", Value::Object(former.clone()));
        // Items beside the settings file: hook scripts, a key vault, cookies, transcripts, keybindings.
        for (rel, body) in [("agent-hooks/stop.ps1", "PLANTED-SECRET-20"), ("vault/claude.sealed", "PLANTED-SECRET-21"), ("Network/Cookies", "PLANTED-SECRET-22"), ("transcripts/a.jsonl", "PLANTED-SECRET-23"), ("keybindings.json", "[]")] {
            let f = old.join(rel);
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(f, body).unwrap();
        }
        let store = open(&profile);
        let preview = plan(&former, &Map::new());
        let p = carry_over(&profile, &store).expect("carried");
        assert_eq!(p.add, vec![("language".into(), json!("es"))], "only the listed, harmless setting carries");
        assert_eq!(p.skipped.secret_like, planted().len(), "every planted field is skipped as secret-like");
        assert_eq!(p.skipped.items, 9, "4 folders + 5 files beside the settings file, counted and never opened");
        assert_eq!(settings(&store), json!({"language": "es"}));
        let summary = p.summary();
        let shown = [summary.clone(), format!("{preview:?}"), serde_json::to_string(&preview).unwrap(), format!("{p:?}"), serde_json::to_string(&p).unwrap()];
        for text in &shown {
            assert!(!text.contains(PLANTED), "a planted value leaked: {text}");
            for name in planted().keys() {
                assert!(!text.contains(name.as_str()), "a skipped name leaked ({name}): {text}");
            }
        }
        assert_eq!(store.lock().unwrap().get(KEY_CARRIED).unwrap().as_deref(), Some(summary.as_str()));
        drop(store);
        for (path, bytes) in every_byte_under(&profile) {
            assert!(!String::from_utf8_lossy(&bytes).contains(PLANTED), "{} holds a planted value", path.display());
        }
        for name in ["agent-hooks", "vault", "Network", "transcripts", "keybindings.json"] {
            assert!(!profile.join(name).exists(), "{name} was copied");
        }
    }

    #[test]
    fn t213_the_allow_list_holds_no_secret_retired_or_secret_store_name() {
        for (name, _) in carried() {
            assert!(!secret_name(name), "{name} looks secret");
            assert!(!is_retired(name), "{name} is retired");
            assert!(!crate::secrets::SECRET_SETTINGS.contains(&name.as_str()), "{name} is a secret setting");
            assert!(name.chars().all(|c| c.is_ascii_alphanumeric()) && name.starts_with(|c: char| c.is_ascii_lowercase()), "{name}");
        }
        for name in crate::secrets::SECRET_SETTINGS {
            assert!(secret_name(name), "{name} must read as secret");
        }
        assert_eq!(carried().iter().map(|(n, _)| n).collect::<std::collections::HashSet<_>>().len(), carried().len(), "no name twice");
    }

    #[test]
    fn t213_the_registry_parses_and_a_name_is_carried_or_left_off_never_both() {
        let r = parse_registry(REGISTRY).expect("settingsRegistry.json parses");
        assert!(!r.carried.is_empty() && !r.not_carried.is_empty());
        assert_eq!(registry().carried, r.carried, "the shipped registry is the one parsed");
        for name in &r.not_carried {
            assert!(!r.carried.iter().any(|(n, _)| n == name), "{name} is both carried and left off");
        }
        assert_eq!(r.not_carried.iter().collect::<std::collections::HashSet<_>>().len(), r.not_carried.len(), "no left-off name twice");
        for name in crate::secrets::SECRET_SETTINGS {
            assert!(!r.carried.iter().any(|(n, _)| n == name), "{name} is a secret setting and must not be carried");
        }
    }

    #[test]
    fn t213_a_registry_with_an_unknown_shape_or_a_missing_list_carries_nothing() {
        assert!(parse_registry(r#"{"carried":[{"name":"language","shape":"blob"}],"notCarried":[]}"#).is_none());
        assert!(parse_registry(r#"{"carried":[{"name":"language","shape":"word"}]}"#).is_none());
        assert!(parse_registry("not json").is_none());
        let ok = parse_registry(r#"{"carried":[{"name":"language","shape":"word"},{"name":"keepAwake","shape":"bool"}],"notCarried":["xaiApiKey"]}"#).unwrap();
        assert_eq!(ok.carried, vec![("language".to_string(), Shape::Word), ("keepAwake".to_string(), Shape::Bool)]);
    }

    #[test]
    fn t213_a_current_name_beats_its_former_spelling_and_wrong_shapes_are_skipped() {
        let former = json!({"nightshiftLanguage": "fr", "language": "de", "quietMinutes": "ten", "uiLook": "../../x", "disabledAgents": ["codex", 3], "keepAwake": "yes", "defaultPaneCount": 4})
            .as_object()
            .unwrap()
            .clone();
        let p = plan(&former, &Map::new());
        assert_eq!(p.add, vec![("language".into(), json!("de")), ("defaultPaneCount".into(), json!(4))]);
        assert_eq!((p.kept, p.renamed, p.skipped.wrong_shape), (1, 0, 4));
    }

    #[cfg(windows)]
    #[test]
    fn t213_app004_a_settings_file_held_by_another_program_is_skipped_and_nothing_stops() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, profile) = profile("imp-lock");
        let old = seed_former(&root, "nightshift", json!({"language": "fr"}));
        let held = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(old.join("settings.json")).unwrap();
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("ran");
        assert_eq!((p.add.len(), p.skipped.unreadable), (0, 1));
        assert_eq!(settings(&store), json!({}));
        assert!(store.lock().unwrap().get(KEY_CARRIED).unwrap().is_some());
        drop(held);
    }

    #[test]
    fn t213_a_settings_file_past_the_size_cap_is_not_read() {
        let (root, profile) = profile("imp-big");
        let old = root.join("nightshift");
        fs::create_dir_all(&old).unwrap();
        let big = format!("{{\"language\":\"fr\",\"pad\":\"{}\"}}", "x".repeat(MAX_SETTINGS_BYTES as usize));
        fs::write(old.join("settings.json"), big).unwrap();
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("ran");
        assert_eq!((p.add.len(), p.skipped.unreadable), (0, 1));
        assert_eq!(settings(&store), json!({}));
    }

    #[cfg(windows)]
    #[test]
    fn t213_links_in_the_former_folder_are_counted_and_never_followed() {
        let (root, profile) = profile("imp-link");
        let old = root.join("nightshift");
        fs::create_dir_all(&old).unwrap();
        let outside = root.join("outside");
        seed_former(&root, "outside", json!({"language": "fr"}));
        let made = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(old.join("linked")).arg(&outside).output();
        if !made.as_ref().is_ok_and(|o| o.status.success()) {
            eprintln!("NOTE t213 links: the junction could not be made here ({made:?}); the link check did NOT run");
            return;
        }
        assert!(old.join("linked").symlink_metadata().unwrap().file_type().is_symlink());
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("ran");
        assert_eq!((p.add.len(), p.skipped.links, p.skipped.items), (0, 1, 0));
        assert_eq!(settings(&store), json!({}));
        fs::remove_dir(old.join("linked")).unwrap(); // the junction itself, never its target
        assert!(outside.join("settings.json").is_file());
    }

    #[test]
    fn t213_app004_development_and_test_profiles_never_get_it() {
        let (root, profile) = profile("imp-fence");
        seed_former(&root, "nightshift", json!({"language": "fr"}));
        let store = open(&profile);
        assert_eq!(first_launch(&profile, &store), None);
        assert_eq!(settings(&store), json!({}));
        assert_eq!(store.lock().unwrap().get(KEY_CARRIED).unwrap(), None, "a later real launch is not marked done");
    }

    #[test]
    fn t213_app004_no_former_folder_marks_it_done_and_changes_nothing() {
        let (_root, profile) = profile("imp-none");
        let store = open(&profile);
        assert_eq!(carry_over(&profile, &store), None);
        assert!(store.lock().unwrap().get(KEY_CARRIED).unwrap().is_some());
        assert_eq!(settings(&store), json!({}));
    }

    #[test]
    fn t213_a_held_lock_stops_a_second_run_and_a_stale_one_is_taken_over() {
        let (root, profile) = profile("imp-lockfile");
        seed_former(&root, "nightshift", json!({"language": "fr"}));
        let store = open(&profile);
        let held = Lock::take(&profile).expect("first lock");
        assert_eq!(carry_over(&profile, &store), None);
        assert!(store.lock().unwrap().get(KEY_CARRIED).unwrap().is_none(), "not marked done while another run holds it");
        drop(held);
        assert!(!profile.join(LOCK_FILE).exists(), "the lock goes with its holder");
        let f = fs::File::create(profile.join(LOCK_FILE)).unwrap();
        f.set_modified(SystemTime::now() - STALE_LOCK - Duration::from_secs(60)).unwrap();
        drop(f);
        assert_eq!(carry_over(&profile, &store).expect("stale lock taken over").add.len(), 1);
        assert!(!profile.join(LOCK_FILE).exists());
    }

    #[test]
    fn t213_app004_former_names_take_the_current_name_in_the_same_letter_case() {
        assert_eq!(current_name("nightshiftTheme").as_deref(), Some("koluxTheme"));
        assert_eq!(current_name("NightshiftAccent").as_deref(), Some("KoluxAccent"));
        assert_eq!(current_name("NIGHTSHIFT_NAME").as_deref(), Some("KOLUX_NAME"));
        assert_eq!(current_name("nightshift:nightShift.x").as_deref(), Some("kolux:kolux.x"));
        assert_eq!(current_name("theme"), None);
        assert_eq!(carried_name("nightshiftKeepAwake"), ("keepAwake".into(), true));
        assert_eq!(carried_name("nightshift.language"), ("kolux.language".into(), true));
        assert_eq!(carried_name("koluxLanguage"), ("language".into(), false));
    }

    #[test]
    fn t331_hid036_the_former_name_carry_over_drops_them_too() {
        let (root, profile) = profile("imp-retired-carry");
        seed_former(&root, "nightshift", json!({"nightshiftLanguage": "fr", "agentsSidebar": true, "nightshiftSkillSharing": true, "opencodeCookie": "x"}));
        let store = open(&profile);
        let p = carry_over(&profile, &store).expect("carried");
        assert_eq!((p.skipped.not_listed, p.skipped.secret_like), (2, 1));
        assert_eq!(settings(&store), json!({"language": "fr"}));
    }

    /// A profile's settings carrying every retired setting, in the spellings an older profile may use.
    fn every_retired() -> Value {
        let mut m = Map::new();
        for (i, (_, names)) in RETIRED.iter().enumerate() {
            m.insert(names[0].to_owned(), json!(i));
        }
        m.insert("terminalScrollbackBytes".into(), json!(1_000_000));
        m.insert("koluxAgentsSidebar".into(), json!(true));
        m.insert("nightshiftGithubAttribution".into(), json!(false));
        m.insert("theme".into(), json!("dark"));
        m.insert("language".into(), json!("ja"));
        m.insert("artifacts".into(), json!({"kept": "the library is a live feature"}));
        m.insert("rightSidebarOpen".into(), json!(true));
        Value::Object(m)
    }

    #[test]
    fn t331_hid036_every_retired_setting_is_named_and_none_collides_with_a_live_one() {
        assert_eq!(RETIRED.len(), 12, "the full list in the card's Compat line");
        for live in ["theme", "language", "artifacts", "skills", "rightSidebarOpen", "leftSidebarWidth", "sidebar", "scrollback", "agentStatusHooks", "confirmWorkspaceDelete"] {
            assert!(!is_retired(live), "{live} is a live setting");
        }
        assert!(is_retired("scrollbackBytes") && is_retired("terminalScrollbackBytes"));
        assert!(is_retired("koluxOpencodeWorkspaceId") && is_retired("nightshiftSkillSharing"));
    }

    #[test]
    fn fix1_after1_only_the_exact_old_spellings_are_dropped_and_a_newer_key_is_kept() {
        // Newer keys that merely look like a retired one (other letter case, other separators, a
        // shorter name) belong to a newer build and must survive a load and a save.
        for newer in ["pairingmode", "pairingMode", "pairing-mode", "pairing.mode", "scrollbackbytes", "scrollback_bytes", "SCROLLBACK_BYTES", "terminal.scrollback-bytes", "agents-sidebar", "Agents_Sidebar", "artifactsEnabledV2", "skillSharingMode"] {
            assert!(!is_retired(newer), "{newer} is not an old spelling");
        }
        let mut s = json!({"pairingmode": "relay", "scrollbackbytes": 5, "phonePairingMode": "old", "scrollbackBytes": 1, "theme": "dark"});
        assert_eq!(drop_retired(&mut s), 2);
        assert_eq!(s, json!({"pairingmode": "relay", "scrollbackbytes": 5, "theme": "dark"}));
        // every listed name is written in the camelCase an older profile used, so each matches itself exactly
        for (_, names) in RETIRED {
            for n in *names {
                assert!(is_retired(n), "{n}");
                assert!(n.chars().all(|c| c.is_ascii_alphanumeric()) && n.starts_with(|c: char| c.is_ascii_lowercase()), "{n} must be a camelCase key");
            }
        }
    }

    #[test]
    fn t331_hid036_a_profile_with_every_retired_setting_loads_without_them_and_they_never_come_back() {
        let (_root, profile) = profile("imp-retired");
        fs::write(profile.join("settings.json"), serde_json::to_vec(&every_retired()).unwrap()).unwrap();
        let store = Store::open(&profile).unwrap();
        // Load: the read succeeds (no message, no refusal) and the retired ones are gone.
        let loaded = without_retired(store.try_settings().expect("loads"));
        assert_eq!(loaded, json!({"theme": "dark", "language": "ja", "artifacts": {"kept": "the library is a live feature"}, "rightSidebarOpen": true}));
        // The next save writes them out of the file.
        store.save_settings(&loaded).unwrap();
        let on_disk: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(on_disk, loaded);
        // A later change made from an old copy that still had them does not bring them back.
        let mut stale = every_retired();
        stale["theme"] = json!("light");
        store.save_settings(&without_retired(stale)).unwrap();
        let after: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(after["theme"], json!("light"));
        assert!(after.as_object().unwrap().keys().all(|k| !is_retired(k)), "{after}");
        drop(store);
    }

    #[test]
    fn t199_app061_migrate_check_carries_into_a_throwaway_profile_and_only_once() {
        let root = crate::test_dir::temp("imp-t199");
        let profile = root.join("kolux.smoke");
        seed_former(&root, "Nightshift", json!({"uiLook": "new", "nightshiftLanguage": "fr", "someUnknownThing": 1}));
        let out = migrate_check(&profile).expect("carried");
        assert_eq!(out["added"], json!(["uiLook", "language"]));
        assert_eq!((out["renamed"].clone(), out["skipped"].clone()), (json!(1), json!(1)));
        assert_eq!(settings(&open(&profile)), json!({"uiLook": "new", "language": "fr"}));
        assert!(migrate_check(&profile).unwrap_err().contains("did not run"));
    }

    #[test]
    fn t199_app061_migrate_check_refuses_the_installed_profile_and_a_missing_former_folder() {
        let (root, installed) = profile("imp-t199-refuse");
        seed_former(&root, "Nightshift", json!({"uiLook": "new"}));
        assert!(migrate_check(&installed).unwrap_err().starts_with("refused"));
        assert!(!installed.join("state.db").exists());
        let bare = crate::test_dir::temp("imp-t199-bare");
        assert!(migrate_check(&bare.join("kolux.smoke")).unwrap_err().contains("no former-name folder"));
    }

    #[test]
    fn t199_app061_migrate_check_refuses_the_installed_profile_reached_through_dot_dot() {
        let (root, installed) = profile("imp-t199-dotdot");
        let sub = installed.join("sub");
        seed_former(&sub, "Nightshift", json!({"uiLook": "new"}));
        let existing = sub.join("..");
        assert!(migrate_check(&existing).unwrap_err().starts_with("refused"));
        let missing = installed.join("new").join("..");
        assert!(migrate_check(&missing).unwrap_err().starts_with("refused"));
        let dotted = installed.join(".");
        assert!(migrate_check(&dotted).unwrap_err().starts_with("refused"));
        assert!(!installed.join("state.db").exists());
        drop(root);
    }
}
