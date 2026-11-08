//! USAGE-012 / USAGE-013: token analytics read the logs Claude Code and Codex already keep on this
//! computer; nothing is sent anywhere. Tracking is opt-in per provider. A scan buckets every reply's
//! token counts by local day, session, model, working folder and prompt size; the last good scan is
//! saved and shown at once, a failed scan keeps it, and a second scan request joins the running one.
//! The log shapes were read from field names only (PROVENANCE.md section 5, 2026-10-12): unknown
//! fields are ignored, and a line or file that does not parse is skipped, never a crash.
use crate::state::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};

pub const PROVIDERS: [&str; 2] = ["claude", "codex"];
const KEY_TRACKING: &str = "token_tracking";
fn key_saved(provider: &str) -> String {
    format!("token_usage_{provider}")
}

/// One bucket: a local day, session, model, working folder and prompt-size band.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Row {
    pub day: String,
    pub session: String,
    pub model: String,
    pub cwd: String,
    /// Largest prompt in the bucket: 0 up to 100k tokens, 1 up to 200k, 2 above.
    pub band: u8,
    /// Fresh input: not read from or written to the cache.
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    /// All cache writes; `cache_write_1h` of them live an hour, the rest five minutes.
    pub cache_write: u64,
    pub cache_write_1h: u64,
    /// Thinking / reasoning tokens, already inside `output`.
    pub reasoning: u64,
    /// The latest reply's time, UTC milliseconds.
    pub last: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    /// USAGE-017: the format mark; results saved in any other format are thrown away and rebuilt.
    pub format: u32,
    pub scanned_at: u64,
    pub rows: Vec<Row>,
    /// Why the latest scan failed; the rows are then the last good ones.
    pub error: Option<String>,
}

/// One reply's counts before bucketing.
#[derive(Clone, Serialize, Deserialize)]
pub struct Turn {
    at: u64,
    session: String,
    model: String,
    cwd: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cache_write_1h: u64,
    reasoning: u64,
}

fn n(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}
fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|t| !t.is_empty())
}
fn stem(name: &str) -> String {
    Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}
fn records(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(Value::is_object)
}

/// Adds turns into buckets keyed by local day, session, model, folder and prompt-size band.
fn bucket(turns: impl IntoIterator<Item = Turn>, tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let mut rows: HashMap<(String, String, String, String, u8), Row> = HashMap::new();
    for t in turns {
        if t.input + t.output + t.cache_read + t.cache_write == 0 {
            continue;
        }
        let Some(day) = i64::try_from(t.at).ok().and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok()).map(|ts| ts.to_zoned(tz.clone()).date().to_string()) else { continue };
        let prompt = t.input + t.cache_read + t.cache_write;
        // Bands match the published price steps: 100k (Haiku 5.5), 200k, 272k (OpenAI long context).
        let band = if prompt > 272_000 { 3 } else if prompt > 200_000 { 2 } else if prompt > 100_000 { 1 } else { 0 };
        let r = rows.entry((day.clone(), t.session.clone(), t.model.clone(), t.cwd.clone(), band)).or_insert_with(|| Row { day, session: t.session, model: t.model, cwd: t.cwd, band, ..Row::default() });
        r.input += t.input;
        r.output += t.output;
        r.cache_read += t.cache_read;
        r.cache_write += t.cache_write;
        r.cache_write_1h += t.cache_write_1h;
        r.reasoning += t.reasoning;
        r.last = r.last.max(t.at);
    }
    let mut out: Vec<Row> = rows.into_values().collect();
    out.sort_by(|a, b| (&a.day, a.last).cmp(&(&b.day, b.last)));
    out
}

/// One Claude Code transcript's replies by message id, the last piece written winning, so the
/// streamed pieces of one reply are merged into one.
fn claude_file(name: &str, text: &str) -> Vec<(String, Turn)> {
    let mut turns: HashMap<String, Turn> = HashMap::new();
    for (i, v) in records(text).enumerate() {
        let Some(usage) = v.get("message").and_then(|m| m.get("usage")).filter(|u| u.is_object()) else { continue };
        let Some(at) = s(&v, "timestamp").and_then(crate::capture::parse_time) else { continue };
        let msg = &v["message"];
        let id = s(msg, "id").or_else(|| s(&v, "requestId")).or_else(|| s(&v, "uuid")).map(String::from).unwrap_or_else(|| format!("{name}:{i}"));
        let split = usage.get("cache_creation").filter(|c| c.is_object());
        let lifetimes = split.map(|c| n(c, "ephemeral_5m_input_tokens") + n(c, "ephemeral_1h_input_tokens")).unwrap_or(0);
        let cache_write = if usage.get("cache_creation_input_tokens").is_some_and(Value::is_u64) { n(usage, "cache_creation_input_tokens") } else { lifetimes };
        let output = n(usage, "output_tokens");
        let thinking = usage.get("output_tokens_details").map(|d| n(d, "thinking_tokens")).unwrap_or(0);
        turns.insert(
            id,
            Turn {
                at,
                session: s(&v, "sessionId").map(String::from).unwrap_or_else(|| stem(name)),
                model: s(msg, "model").unwrap_or("unknown").into(),
                cwd: s(&v, "cwd").unwrap_or_default().into(),
                input: n(usage, "input_tokens"),
                output,
                cache_read: n(usage, "cache_read_input_tokens"),
                cache_write,
                cache_write_1h: split.map(|c| n(c, "ephemeral_1h_input_tokens")).unwrap_or(0).min(cache_write),
                reasoning: thinking.min(output),
            },
        );
    }
    turns.into_iter().collect()
}

/// One Codex session log's token events, keyed by their time and running total. An event counts by
/// its own last-turn figures, and only when the running total moved, so a repeated event adds
/// nothing and the first event of a resumed session is not taken as its whole history. Cached input
/// is part of Codex's input count.
fn codex_file(name: &str, text: &str) -> Vec<(String, Turn)> {
    let mut turns = Vec::new();
    let (mut session, mut model, mut cwd) = (None::<String>, "unknown".to_string(), String::new());
    let mut prev: Option<Value> = None;
    for (i, v) in records(text).enumerate() {
        let Some(p) = v.get("payload").filter(|p| p.is_object()) else { continue };
        if let Some(m) = s(p, "model") {
            model = m.into();
        }
        if let Some(c) = s(p, "cwd") {
            cwd = c.into();
        }
        if session.is_none() {
            session = s(p, "session_id").or_else(|| if i == 0 { s(p, "id") } else { None }).map(String::from);
        }
        let Some(info) = p.get("info").filter(|x| x.is_object()) else { continue };
        let Some(total) = info.get("total_token_usage").filter(|x| x.is_object()) else { continue };
        if prev.as_ref() == Some(total) {
            continue;
        }
        let last = match (info.get("last_token_usage").filter(|x| x.is_object()), &prev) {
            (Some(l), _) => l.clone(),
            // no last-turn figures: the step since the previous running total
            (None, Some(before)) => serde_json::json!({
                "input_tokens": n(total, "input_tokens").saturating_sub(n(before, "input_tokens")),
                "cached_input_tokens": n(total, "cached_input_tokens").saturating_sub(n(before, "cached_input_tokens")),
                "output_tokens": n(total, "output_tokens").saturating_sub(n(before, "output_tokens")),
                "reasoning_output_tokens": n(total, "reasoning_output_tokens").saturating_sub(n(before, "reasoning_output_tokens")),
            }),
            (None, None) => {
                prev = Some(total.clone());
                continue;
            }
        };
        prev = Some(total.clone());
        let Some(stamp) = s(&v, "timestamp") else { continue };
        let Some(at) = crate::capture::parse_time(stamp) else { continue };
        let (input, output) = (n(&last, "input_tokens"), n(&last, "output_tokens"));
        let cached = n(&last, "cached_input_tokens").min(input);
        let turn = Turn {
            at,
            session: session.clone().unwrap_or_else(|| stem(name)),
            model: model.clone(),
            cwd: cwd.clone(),
            input: input - cached,
            output,
            cache_read: cached,
            cache_write: 0,
            cache_write_1h: 0,
            reasoning: n(&last, "reasoning_output_tokens").min(output),
        };
        turns.push((format!("{stamp}|{total}"), turn));
    }
    turns
}

/// USAGE-016 / USAGE-017: files in credit order, oldest first. A reply or token event that several
/// files hold, as a fork, a copy or a resumed session carries the earlier ones, counts once, for the
/// first file that holds it; once that file is gone the next copy carries it.
fn merge<'a>(files: impl IntoIterator<Item = &'a [(String, Turn)]>) -> Vec<Turn> {
    let mut seen = HashSet::new();
    files.into_iter().flatten().filter(|(k, _)| seen.insert(k.clone())).map(|(_, t)| t.clone()).collect()
}

/// Claude Code transcripts, as (file name, text), in credit order.
#[cfg(test)]
pub fn claude_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let parsed: Vec<_> = files.iter().map(|(name, text)| claude_file(name, text)).collect();
    bucket(merge(parsed.iter().map(Vec::as_slice)), tz)
}

/// Codex session logs, as (file name, text), in credit order.
#[cfg(test)]
pub fn codex_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let parsed: Vec<_> = files.iter().map(|(name, text)| codex_file(name, text)).collect();
    bucket(merge(parsed.iter().map(Vec::as_slice)), tz)
}

/// USAGE-016: what each log file held at its last read (size and change time), so a file unchanged
/// since is not read again and the results of files that did not change are kept. It is kept in a
/// file in Kolux's data folder too, so the first scan after a restart reads only what changed.
#[derive(Default)]
pub struct Cache(HashMap<PathBuf, Seen>);
/// A file's size, change time and keyed turns at its last read.
type Seen = (u64, Option<std::time::SystemTime>, Vec<(String, Turn)>);

/// The scan memory as kept on disk, with the format mark so an older one is read afresh.
#[derive(Serialize, Deserialize)]
struct Kept {
    format: u32,
    files: Vec<(PathBuf, Seen)>,
}

fn kept_file(profile: &Path, provider: &str) -> PathBuf {
    profile.join(format!("token-scan-{provider}.json"))
}

impl Cache {
    /// What an earlier run kept; empty when it is missing, damaged or in another format.
    pub fn load(path: &Path) -> Cache {
        let kept = std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Kept>(&t).ok());
        Cache(kept.filter(|k| k.format == FORMAT).map(|k| k.files.into_iter().collect()).unwrap_or_default())
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let kept = Kept { format: FORMAT, files: self.0.iter().map(|(p, s)| (p.clone(), s.clone())).collect() };
        crate::trust::write_whole(path, &serde_json::to_string(&kept).map_err(|e| e.to_string())?)
    }
}

fn caches() -> &'static Mutex<HashMap<String, Cache>> {
    static CACHES: std::sync::OnceLock<Mutex<HashMap<String, Cache>>> = std::sync::OnceLock::new();
    CACHES.get_or_init(Default::default)
}

/// Scans in flight, by provider. A request for one already running waits for it and reads its result.
#[derive(Default)]
pub struct Flights {
    running: Mutex<HashSet<String>>,
    done: Condvar,
}

impl Flights {
    /// Runs `work` unless a run for `key` is in flight, in which case it waits for that one. True when it ran.
    pub fn run(&self, key: &str, work: impl FnOnce()) -> bool {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains(key) {
            while running.contains(key) {
                running = self.done.wait(running).unwrap_or_else(|e| e.into_inner());
            }
            return false;
        }
        running.insert(key.into());
        drop(running);
        struct Landed<'a>(&'a Flights, &'a str);
        impl Drop for Landed<'_> {
            fn drop(&mut self) {
                self.0.running.lock().unwrap_or_else(|e| e.into_inner()).remove(self.1);
                self.0.done.notify_all();
            }
        }
        let _landed = Landed(self, key);
        work();
        true
    }
}

/// The recorded choice, or, for an older profile that never recorded one, on when it has saved results.
pub fn tracking_of(choice: Option<bool>, has_saved: bool) -> bool {
    choice.unwrap_or(has_saved)
}

/// The format saved results are written in now (2: forks and copies counted once).
pub const FORMAT: u32 = 2;
fn parse_saved(text: &str) -> Option<Saved> {
    serde_json::from_str::<Saved>(text).ok().filter(|s| s.format == FORMAT)
}
fn saved(store: &Store, provider: &str) -> Option<Saved> {
    store.get(&key_saved(provider)).ok().flatten().and_then(|t| parse_saved(&t))
}
fn choices(store: &Store) -> serde_json::Map<String, Value> {
    crate::claude_accounts::load_kept(store, KEY_TRACKING)
}

/// Every .jsonl file under `root`, any depth.
fn jsonl_under(root: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            jsonl_under(&p, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

/// USAGE-017: the computer's own Codex sessions folder (a CODEX_HOME override in the surrounding
/// environment does not move it) and each managed account's, only while that home and its sessions
/// folder resolve inside Kolux's own account storage; folders that lead to the same place are read
/// once.
pub fn codex_roots(user_home: Option<&Path>, profile: Option<&Path>, homes: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = user_home.and_then(|h| h.join(".codex").join("sessions").canonicalize().ok()).into_iter().collect();
    if let Some(storage) = profile.and_then(|p| p.join(crate::codex_accounts::FOLDER).canonicalize().ok()) {
        out.extend(homes.iter().filter_map(|h| Path::new(h).join("sessions").canonicalize().ok()).filter(|d| d.starts_with(&storage)));
    }
    let mut seen = HashSet::new();
    out.retain(|d| seen.insert(d.clone()));
    out
}

/// The log folders a provider's scan reads; `profile` is Kolux's own data folder.
fn roots(store: &Store, provider: &str, profile: Option<&Path>) -> Vec<PathBuf> {
    if provider == "claude" {
        return crate::capture::claude_dir().map(|d| d.join("projects")).into_iter().collect();
    }
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let homes: Vec<String> = crate::codex_accounts::load(store).into_iter().map(|a| a.home).collect();
    codex_roots(user.as_deref(), profile, &homes)
}

/// Reads one provider's logs, any depth, oldest file first so an original keeps the credit for
/// what its forks copied. A file unchanged since the last scan is taken from `cache`. Gives the
/// rows and how many files were read. None of the folders being there is a failure, so saved
/// figures stay.
fn scan(roots: &[PathBuf], provider: &str, cache: &mut Cache) -> Result<(Vec<Row>, usize), String> {
    let present: Vec<&PathBuf> = roots.iter().filter(|r| r.is_dir()).collect();
    if present.is_empty() {
        return Err(if provider == "claude" { "its projects folder is not there" } else { "its sessions folder is not there" }.into());
    }
    let mut paths = Vec::new();
    for r in present {
        jsonl_under(r, &mut paths);
    }
    let mut files: Vec<(PathBuf, std::fs::Metadata)> = paths.into_iter().filter_map(|p| std::fs::metadata(&p).ok().map(|m| (p, m))).collect();
    files.sort_by_cached_key(|(p, m)| (m.created().or_else(|_| m.modified()).ok(), p.clone()));
    let (mut read, mut order, mut next) = (0, Vec::new(), HashMap::new());
    for (p, m) in files {
        let (len, at) = (m.len(), m.modified().ok());
        let turns = match cache.0.remove(&p) {
            Some((l, a, t)) if (l, a) == (len, at) => t,
            _ => {
                let Ok(text) = std::fs::read_to_string(&p) else { continue };
                read += 1;
                let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
                if provider == "claude" { claude_file(&name, &text) } else { codex_file(&name, &text) }
            }
        };
        order.push(p.clone());
        next.insert(p, (len, at, turns));
    }
    let turns = merge(order.iter().filter_map(|p| next.get(p)).map(|(_, _, t)| t.as_slice()));
    cache.0 = next;
    Ok((bucket(turns, &jiff::tz::TimeZone::system()), read))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub tracking: serde_json::Map<String, Value>,
    pub claude: Option<Saved>,
    pub codex: Option<Saved>,
}

/// What opening the page shows at once: the tracking choices and the saved results.
#[tauri::command]
pub fn token_usage(store: tauri::State<'_, Mutex<Store>>) -> Result<Usage, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    let (claude, codex) = (saved(&s, "claude"), saved(&s, "codex"));
    let picked = choices(&s);
    let tracking = PROVIDERS.iter().map(|p| (p.to_string(), Value::Bool(tracking_of(picked.get(*p).and_then(Value::as_bool), if *p == "claude" { claude.is_some() } else { codex.is_some() })))).collect();
    Ok(Usage { tracking, claude, codex })
}

#[tauri::command]
pub fn token_tracking_set(store: tauri::State<'_, Mutex<Store>>, provider: String, on: bool) -> Result<(), String> {
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("unknown provider {provider}"));
    }
    set_tracking(&*store.lock().map_err(|e| e.to_string())?, &provider, on)
}

/// Rows 193, 916: a blob that no longer reads is kept aside before this save; one that cannot be read
/// or kept answers an Err and nothing is poisoned, so a retry after a transient failure works.
fn set_tracking(store: &Store, provider: &str, on: bool) -> Result<(), String> {
    let mut all: serde_json::Map<String, Value> = crate::orchestration::kept::load(store, KEY_TRACKING)?;
    all.insert(provider.to_string(), Value::Bool(on));
    store.set(KEY_TRACKING, &Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// Rescans one provider and saves the result; a failed scan keeps the last good rows and says why.
/// The scan memory starts from the copy kept on disk and is kept again when a file was read or went.
pub fn rescan(store: &Mutex<Store>, provider: &str) {
    let (dirs, profile) = match store.lock() {
        Ok(s) => (roots(&s, provider, Some(&s.dir())), s.dir()),
        Err(_) => return,
    };
    let result = {
        let mut all = caches().lock().unwrap_or_else(|e| e.into_inner());
        let cache = all.entry(provider.to_string()).or_insert_with(|| Cache::load(&kept_file(&profile, provider)));
        let had = cache.0.len();
        let result = scan(&dirs, provider, cache);
        if result.as_ref().is_ok_and(|(_, read)| *read > 0) || cache.0.len() != had {
            let _ = cache.save(&kept_file(&profile, provider));
        }
        result.map(|(rows, _)| rows)
    };
    let Ok(s) = store.lock() else { return };
    let before = saved(&s, provider);
    let next = match result {
        Ok(rows) => Saved { format: FORMAT, scanned_at: crate::artifacts::now_ms(), rows, error: None },
        Err(e) => Saved { format: FORMAT, error: Some(e), ..before.unwrap_or_default() },
    };
    let _ = s.set(&key_saved(provider), &serde_json::to_string(&next).unwrap_or_default());
}

/// Whether a provider's usage is tracked (USAGE-012's opt-in).
fn tracked(store: &Store, provider: &str) -> bool {
    tracking_of(choices(store).get(provider).and_then(Value::as_bool), saved(store, provider).is_some())
}

/// USAGE-016: rescans every tracked provider, so a lookup sees the latest turns.
pub fn rescan_tracked(store: &Mutex<Store>) {
    for p in PROVIDERS {
        if store.lock().is_ok_and(|s| tracked(&s, p)) {
            rescan(store, p);
        }
    }
}

/// USAGE-016: what the sessions that worked in a folder used, per tracked provider, from the saved
/// results; `mine` says which working folders count. A provider not tracked shows only that.
pub fn usage_in(store: &Mutex<Store>, mine: impl Fn(&str) -> bool) -> Value {
    let Ok(s) = store.lock() else { return Value::Null };
    let mut out = serde_json::Map::new();
    for p in PROVIDERS {
        if !tracked(&s, p) {
            out.insert(p.into(), serde_json::json!({ "tracked": false }));
            continue;
        }
        let got = saved(&s, p).unwrap_or_default();
        let rows: Vec<&Row> = got.rows.iter().filter(|r| mine(&r.cwd)).collect();
        let sum = |f: fn(&Row) -> u64| rows.iter().map(|r| f(r)).sum::<u64>();
        let sessions: std::collections::BTreeSet<&str> = rows.iter().map(|r| r.session.as_str()).collect();
        out.insert(p.into(), serde_json::json!({ "tracked": true, "sessions": sessions, "input": sum(|r| r.input), "output": sum(|r| r.output), "cacheRead": sum(|r| r.cache_read), "cacheWrite": sum(|r| r.cache_write), "reasoning": sum(|r| r.reasoning), "scannedAt": got.scanned_at, "error": got.error }));
    }
    Value::Object(out)
}

/// Owner change 2026-11-07: every folder that belongs to the workspace at `path`: its own and each
/// git worktree of the same repo, so the spend ribbon counts the sessions that ran in a child
/// worktree too. A folder that is not a repo (or git failing) answers just the folder.
#[tauri::command]
pub async fn workspace_worktrees(path: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = vec![path.clone()];
        if let Ok(text) = crate::git::run(&["worktree", "list", "--porcelain"], Some(Path::new(&path))) {
            out.extend(crate::git::parse_worktrees(&text).into_iter().map(|w| w.path));
        }
        out
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn token_usage_scan(app: tauri::AppHandle, provider: String) -> Result<Saved, String> {
    use tauri::Manager;
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("unknown provider {provider}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Mutex<Store>>();
        app.state::<Flights>().run(&provider, || rescan(&store, &provider));
        let s = store.lock().map_err(|e| e.to_string())?;
        Ok(saved(&s, &provider).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::tz::TimeZone;
    use serde_json::json;

    fn file(name: &str, lines: &[Value]) -> (String, String) {
        (name.into(), lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n"))
    }
    // Invented records with the observed field names; no value comes from a real log.
    fn reply(id: &str, at: &str, usage: Value) -> Value {
        json!({ "type": "assistant", "timestamp": at, "sessionId": "s-1", "cwd": "C:/work/app", "uuid": format!("u-{id}"),
                "message": { "id": id, "model": "claude-model-x", "role": "assistant", "usage": usage } })
    }

    #[test]
    fn claude_replies_count_once_per_message_and_split_cache_writes() {
        let u1 = json!({ "input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40,
                         "cache_creation": { "ephemeral_5m_input_tokens": 10, "ephemeral_1h_input_tokens": 30 }, "output_tokens_details": { "thinking_tokens": 2 } });
        let u1_more = json!({ "input_tokens": 10, "output_tokens": 7, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40,
                              "cache_creation": { "ephemeral_5m_input_tokens": 10, "ephemeral_1h_input_tokens": 30 } });
        let u2 = json!({ "input_tokens": 1, "output_tokens": 1, "cache_creation_input_tokens": 5, "cache_creation": { "ephemeral_1h_input_tokens": 9 } });
        let lines = [
            reply("m1", "2026-03-01T10:00:00Z", u1),
            json!({ "type": "user", "timestamp": "2026-03-01T10:00:01Z", "message": { "role": "user" } }),
            reply("m1", "2026-03-01T10:00:02Z", u1_more), // a later streamed piece of the same reply
            reply("m2", "2026-03-01T11:00:00Z", u2),
            json!("not an object"),
        ];
        let mut text = file("s-1.jsonl", &lines);
        text.1.push_str("\n{broken json\n");
        // A forked copy repeats m1 in another file: still counted once.
        let fork = file("s-2.jsonl", &[reply("m1", "2026-03-01T10:00:02Z", json!({ "input_tokens": 10, "output_tokens": 7, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40 }))]);
        let rows = claude_rows(&[text, fork], &TimeZone::UTC);
        let sum = |f: fn(&Row) -> u64| rows.iter().map(f).sum::<u64>();
        assert_eq!(sum(|r| r.input), 11);
        assert_eq!(sum(|r| r.output), 8);
        assert_eq!(sum(|r| r.cache_read), 100);
        assert_eq!(sum(|r| r.cache_write), 45);
        // the original keeps m1 (30 of an hour); m2's 1-hour count above its total is cut back to the total.
        assert_eq!(sum(|r| r.cache_write_1h), 35);
        assert!(rows.iter().all(|r| r.day == "2026-03-01" && r.model == "claude-model-x"));
    }

    #[test]
    fn days_follow_the_local_calendar() {
        let u = json!({ "input_tokens": 1, "output_tokens": 1 });
        let lines = [reply("a", "2026-03-01T23:30:00Z", u.clone()), reply("b", "2026-03-02T00:30:00Z", u)];
        let utc = claude_rows(&[file("s.jsonl", &lines)], &TimeZone::UTC);
        let mut days: Vec<_> = utc.iter().map(|r| r.day.clone()).collect();
        days.sort();
        assert_eq!(days, ["2026-03-01", "2026-03-02"]);
        let east = TimeZone::fixed(jiff::tz::offset(2));
        let local = claude_rows(&[file("s.jsonl", &lines)], &east);
        assert_eq!(local.len(), 1);
        assert_eq!(local[0].day, "2026-03-02");
    }

    #[test]
    fn prompt_size_bands_feed_long_context_prices() {
        let big = json!({ "input_tokens": 50_000, "output_tokens": 1, "cache_read_input_tokens": 160_000 });
        let mid = json!({ "input_tokens": 150_000, "output_tokens": 1 });
        let huge = json!({ "input_tokens": 2_000, "output_tokens": 1, "cache_read_input_tokens": 280_000 });
        let rows = claude_rows(&[file("s.jsonl", &[reply("a", "2026-03-01T01:00:00Z", big), reply("b", "2026-03-01T02:00:00Z", mid), reply("c", "2026-03-01T03:00:00Z", huge)])], &TimeZone::UTC);
        let mut bands: Vec<_> = rows.iter().map(|r| r.band).collect();
        bands.sort();
        assert_eq!(bands, [1, 2, 3]);
    }

    fn event(at: &str, total: Value, last: Value) -> Value {
        json!({ "timestamp": at, "type": "event", "payload": { "info": { "total_token_usage": total, "last_token_usage": last } } })
    }
    fn counts(input: u64, cached: u64, output: u64, reasoning: u64) -> Value {
        json!({ "input_tokens": input, "cached_input_tokens": cached, "output_tokens": output, "reasoning_output_tokens": reasoning, "total_tokens": input + output })
    }

    #[test]
    fn codex_counts_each_token_event_once_and_never_takes_a_running_total_as_history() {
        let lines = [
            json!({ "timestamp": "2026-03-01T09:00:00Z", "type": "meta", "payload": { "session_id": "cx-1", "cwd": "C:/work/app", "model": "codex-model-y" } }),
            // a resumed session: the first running total holds earlier history, only its last turn counts
            event("2026-03-01T09:01:00Z", counts(1000, 800, 100, 10), counts(30, 20, 5, 1)),
            event("2026-03-01T09:01:01Z", counts(1000, 800, 100, 10), counts(30, 20, 5, 1)), // repeated event
            event("2026-03-01T09:02:00Z", counts(1100, 850, 120, 12), counts(100, 50, 20, 2)),
            json!({ "timestamp": "2026-03-01T09:03:00Z", "type": "event", "payload": { "info": null } }),
        ];
        let rows = codex_rows(&[file("rollout.jsonl", &lines)], &TimeZone::UTC);
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!((r.session.as_str(), r.model.as_str(), r.cwd.as_str()), ("cx-1", "codex-model-y", "C:/work/app"));
        // cached input is part of input: fresh 10 + 50, cache 20 + 50
        assert_eq!((r.input, r.cache_read, r.output, r.reasoning), (60, 70, 25, 3));
    }

    #[test]
    fn a_second_scan_request_joins_the_running_one() {
        use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
        let flights = Flights::default();
        let calls = std::sync::atomic::AtomicU32::new(0);
        // Load flake fix: no 50 ms / 300 ms race. The first scan runs until the second request is
        // made (plus 2 s to take its place in line; 60 s ceiling), and the second must come back
        // only after the first scan has ended.
        let (started, running) = std::sync::mpsc::channel();
        let (asked, a_ended) = (AtomicBool::new(false), AtomicBool::new(false));
        std::thread::scope(|s| {
            let a = s.spawn(|| {
                flights.run("claude", || {
                    calls.fetch_add(1, SeqCst);
                    started.send(()).unwrap();
                    let end = std::time::Instant::now() + std::time::Duration::from_secs(60);
                    while !asked.load(SeqCst) && std::time::Instant::now() < end {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    a_ended.store(true, SeqCst);
                })
            });
            running.recv_timeout(std::time::Duration::from_secs(60)).expect("the first scan started");
            asked.store(true, SeqCst);
            let b = flights.run("claude", || {
                calls.fetch_add(1, SeqCst);
            });
            assert!(a_ended.load(SeqCst), "the second request came back before the running scan ended");
            assert!(a.join().unwrap());
            assert!(!b);
        });
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(flights.run("claude", || {}), "a later request starts a new scan");
    }

    #[test]
    fn an_older_profile_with_saved_results_keeps_tracking() {
        assert!(!tracking_of(None, false));
        assert!(tracking_of(None, true));
        assert!(!tracking_of(Some(false), true));
        assert!(tracking_of(Some(true), false));
    }

    fn temp(tag: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(&format!("usage-{tag}"))
    }
    fn write(path: &Path, lines: &[Value]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    }
    fn in_session(mut v: Value, session: &str) -> Value {
        v["sessionId"] = json!(session);
        v
    }
    fn total(rows: &[Row]) -> u64 {
        rows.iter().map(|r| r.input + r.output).sum()
    }

    #[test]
    fn usage_016_forked_turns_count_once_and_stay_counted_when_the_original_goes() {
        let t = temp("fork");
        let projects = t.0.join("projects");
        let a = reply("m1", "2026-03-01T09:00:00Z", json!({ "input_tokens": 10, "output_tokens": 1 }));
        let b = reply("m2", "2026-03-01T09:01:00Z", json!({ "input_tokens": 20, "output_tokens": 2 }));
        let c = reply("m3", "2026-03-01T09:02:00Z", json!({ "input_tokens": 40, "output_tokens": 4 }));
        let original = projects.join("C--work-app").join("s-1.jsonl");
        write(&original, &[a.clone(), b.clone()]);
        std::thread::sleep(std::time::Duration::from_millis(30));
        // the fork copies the first two turns, then goes on with its own
        write(&projects.join("C--work-app").join("deep").join("s-2.jsonl"), &[in_session(a, "s-2"), in_session(b, "s-2"), in_session(c, "s-2")]);
        let mut cache = Cache::default();
        let (rows, read) = scan(std::slice::from_ref(&projects), "claude", &mut cache).unwrap();
        assert_eq!((total(&rows), read), (77, 2), "copied turns once, nested folders read");
        let by = |rows: &[Row], s: &str| rows.iter().filter(|r| r.session == s).map(|r| r.input + r.output).sum::<u64>();
        assert_eq!((by(&rows, "s-1"), by(&rows, "s-2")), (33, 44), "the copies stay with the original");
        std::fs::remove_file(&original).unwrap();
        let (rows, read) = scan(std::slice::from_ref(&projects), "claude", &mut cache).unwrap();
        assert_eq!((total(&rows), by(&rows, "s-2"), read), (77, 77, 0), "the remaining copy now carries them, nothing re-read");
    }

    #[test]
    fn usage_016_the_scan_memory_is_kept_across_a_restart() {
        let t = temp("restart");
        let root = t.0.join("projects");
        write(&root.join("p").join("one.jsonl"), &[reply("m1", "2026-03-01T09:00:00Z", json!({ "input_tokens": 10, "output_tokens": 1 }))]);
        write(&root.join("p").join("two.jsonl"), &[reply("m2", "2026-03-01T09:00:00Z", json!({ "input_tokens": 5, "output_tokens": 0 }))]);
        let kept = t.0.join("profile").join("token-scan-claude.json");
        let mut cache = Cache::default();
        assert_eq!(scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap().1, 2);
        cache.save(&kept).unwrap();
        // a new run starts from what the last one kept: nothing is read again, the figures are the same
        let mut after = Cache::load(&kept);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut after).unwrap();
        assert_eq!((read, total(&rows)), (0, 16));
        // a damaged or older memory is ignored and every file is read once more
        std::fs::write(&kept, "{ not json").unwrap();
        assert_eq!(scan(std::slice::from_ref(&root), "claude", &mut Cache::load(&kept)).unwrap().1, 2);
        std::fs::write(&kept, r#"{"format":1,"files":[]}"#).unwrap();
        assert!(Cache::load(&kept).0.is_empty());
        assert!(Cache::load(&t.0.join("missing.json")).0.is_empty());
    }

    // Row 193 (audit-a193-2): the tracking choices blob that no longer reads is kept aside, so the
    // next switch cannot save over it.
    #[test]
    fn row193_unreadable_tracking_choices_are_kept_aside_and_a_switch_cannot_wipe_them() {
        let t = temp("row193");
        let store = Store::open(&t.0).unwrap();
        let broken = "{\"claude\":tr\u{0}\u{fffd} half written";
        store.set(KEY_TRACKING, broken).unwrap();
        assert!(choices(&store).is_empty());
        assert_eq!(crate::claude_accounts::test_asides(&store, KEY_TRACKING), vec![broken.to_string()]);
        assert!(choices(&store).is_empty());
        assert_eq!(crate::claude_accounts::test_asides(&store, KEY_TRACKING).len(), 1, "not set aside twice");
        set_tracking(&store, "claude", true).unwrap();
        assert_eq!(crate::claude_accounts::test_asides(&store, KEY_TRACKING), vec![broken.to_string()]);
        assert_eq!(choices(&store).get("claude").and_then(Value::as_bool), Some(true));
    }

    // Row 912: a choices blob that could not be read or kept aside is never saved over by a switch.
    #[test]
    fn row912_a_switch_cannot_save_over_choices_that_could_not_be_kept_aside() {
        let t = temp("row912");
        let store = Store::open(&t.0).unwrap();
        let broken = "{\"claude\":tr\u{0}\u{fffd} half written";
        store.set(KEY_TRACKING, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&t.0);
        assert!(set_tracking(&store, "claude", true).is_err(), "the save is refused");
        assert_eq!(store.get(KEY_TRACKING).unwrap().as_deref(), Some(broken), "the stored choices are byte-identical");
        assert!(choices(&store).is_empty(), "a read-only caller still gets the default");
    }

    // Row 916: a read that failed for a moment poisons nothing; the same switch works once the store reads again.
    #[test]
    fn row916_a_switch_works_again_once_the_store_can_be_read() {
        let t = temp("row916");
        let store = Store::open(&t.0).unwrap();
        store.set(KEY_TRACKING, r#"{"codex":true}"#).unwrap();
        let side = crate::orchestration::kept::Unreadable::new(&t.0);
        assert!(set_tracking(&store, "claude", true).is_err());
        side.restore();
        set_tracking(&store, "claude", true).unwrap();
        assert_eq!(choices(&store).get("claude").and_then(Value::as_bool), Some(true));
        assert_eq!(choices(&store).get("codex").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn usage_016_a_worktree_looks_up_what_its_sessions_used() {
        let t = temp("lookup");
        let store = Mutex::new(Store::open(&t.0).unwrap());
        let row = |session: &str, cwd: &str, input: u64| Row { session: session.into(), cwd: cwd.into(), input, output: 1, cache_read: 2, cache_write: 3, ..Default::default() };
        let rows = vec![row("s-1", "C:/w/app", 10), row("s-2", "C:/w/app/sub", 20), row("s-1", "C:/w/app/sub", 40), row("s-3", "C:/w/other", 80)];
        {
            let s = store.lock().unwrap();
            s.set(&key_saved("claude"), &serde_json::to_string(&Saved { format: FORMAT, scanned_at: 5, rows, error: None }).unwrap()).unwrap();
            s.set(KEY_TRACKING, r#"{"claude":true,"codex":false}"#).unwrap();
        }
        let got = usage_in(&store, |cwd| cwd.starts_with("C:/w/app"));
        assert_eq!(got["claude"], json!({ "tracked": true, "sessions": ["s-1", "s-2"], "input": 70, "output": 3, "cacheRead": 6, "cacheWrite": 9, "reasoning": 0, "scannedAt": 5, "error": null }));
        assert_eq!(got["codex"], json!({ "tracked": false }), "a provider not tracked is never read");
    }

    #[test]
    fn usage_016_unchanged_files_are_not_read_again() {
        let t = temp("unchanged");
        let root = t.0.join("projects");
        let one = root.join("p").join("one.jsonl");
        write(&one, &[reply("m1", "2026-03-01T09:00:00Z", json!({ "input_tokens": 10, "output_tokens": 1 }))]);
        write(&root.join("p").join("two.jsonl"), &[reply("m2", "2026-03-01T09:00:00Z", json!({ "input_tokens": 5, "output_tokens": 0 }))]);
        let mut cache = Cache::default();
        assert_eq!(scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap().1, 2);
        assert_eq!(scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap().1, 0);
        write(&one, &[reply("m1", "2026-03-01T09:00:00Z", json!({ "input_tokens": 10, "output_tokens": 1 })), reply("m9", "2026-03-01T09:05:00Z", json!({ "input_tokens": 100, "output_tokens": 0 }))]);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, total(&rows)), (1, 116), "only the changed file is read; the other file's results are kept");
    }

    #[test]
    fn usage_017_a_forked_codex_session_counts_its_copied_events_once() {
        let meta = |id: &str| json!({ "timestamp": "2026-03-01T09:00:00Z", "type": "meta", "payload": { "session_id": id, "cwd": "C:/work/app", "model": "codex-model-y" } });
        let e1 = event("2026-03-01T09:01:00Z", counts(100, 0, 10, 0), counts(100, 0, 10, 0));
        let e2 = event("2026-03-01T09:02:00Z", counts(300, 0, 30, 0), counts(200, 0, 20, 0));
        let e3 = event("2026-03-01T09:03:00Z", counts(700, 0, 70, 0), counts(400, 0, 40, 0));
        let rows = codex_rows(&[file("a.jsonl", &[meta("cx-1"), e1.clone(), e2.clone()]), file("b.jsonl", &[meta("cx-2"), e1, e2, e3])], &TimeZone::UTC);
        assert_eq!(total(&rows), 770, "the fork adds only its own event");
        assert_eq!(rows.iter().filter(|r| r.session == "cx-2").map(|r| r.input + r.output).sum::<u64>(), 440);
    }

    #[test]
    fn usage_017_codex_scan_follows_only_homes_inside_kolux_storage_and_reads_aliases_once() {
        let t = temp("roots");
        let profile = t.0.join("profile");
        let own = t.0.join("user").join(".codex");
        let inside = profile.join(crate::codex_accounts::FOLDER).join("x1");
        let outside = t.0.join("elsewhere").join("x2");
        for d in [own.join("sessions"), inside.join("sessions"), outside.join("sessions")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let alias = profile.join(crate::codex_accounts::FOLDER).join(".").join("x1");
        let homes = vec![inside.to_string_lossy().into_owned(), alias.to_string_lossy().into_owned(), outside.to_string_lossy().into_owned()];
        let roots = codex_roots(Some(&t.0.join("user")), Some(&profile), &homes);
        let canon = |p: &Path| p.canonicalize().unwrap();
        assert_eq!(roots, vec![canon(&own.join("sessions")), canon(&inside.join("sessions"))]);
    }

    #[test]
    fn usage_017_saved_results_in_an_older_format_are_rebuilt() {
        assert!(parse_saved(r#"{"scannedAt":1,"rows":[],"error":null}"#).is_none(), "no format mark: thrown away");
        let now = serde_json::to_string(&Saved { format: FORMAT, scanned_at: 2, ..Saved::default() }).unwrap();
        assert_eq!(parse_saved(&now).map(|s| s.scanned_at), Some(2));
    }
}
