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
use std::sync::{Arc, Condvar, Mutex};

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

/// One reply's counts before bucketing. The text is shared, not copied: every session, model and
/// folder name is held once (see `interned`), so a long transcript costs its counts, not its names.
#[derive(Clone)]
pub struct Turn {
    at: u64,
    session: Arc<str>,
    model: Arc<str>,
    cwd: Arc<str>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cache_write_1h: u64,
    reasoning: u64,
}

/// What makes a reply or token event the same one in several files (a fork, a copy, a resumed
/// session): its key text as a 128-bit FNV-1a hash. It is kept on disk, so it is a fixed function,
/// never the standard library's hasher, which may change between Rust releases.
type Key = u128;
fn key(text: &str) -> Key {
    hash(text.as_bytes())
}
fn hash(bytes: &[u8]) -> Key {
    bytes.iter().fold(0x6c62_272e_07bb_0142_62b8_2175_6295_c58d_u128, |h, b| (h ^ u128::from(*b)).wrapping_mul(0x0000_0000_0100_0000_0000_0000_0000_013b))
}

/// The fields of a Codex running total, in the order Codex writes them (older logs lack the cache-write one).
const CODEX_TOTAL_FIELDS: [&str; 6] = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];

/// The key of a Codex token event: its time and running total. The total is written out here in a fixed
/// order (Codex's own, then any field this list does not know, by name), never by printing the parsed JSON,
/// whose field order depends on serde_json's `preserve_order` feature. For a log in Codex's order the text is
/// exactly what that feature printed before, so the keys already kept on disk stay equal.
fn codex_key(stamp: &str, total: &Value) -> Key {
    let mut text = format!("{stamp}|{{");
    let mut first = true;
    let mut put = |name: &str, value: &Value| {
        if !first {
            text.push(',');
        }
        first = false;
        text.push_str(&Value::String(name.to_string()).to_string());
        text.push(':');
        text.push_str(&value.to_string());
    };
    if let Some(fields) = total.as_object() {
        for name in CODEX_TOTAL_FIELDS {
            if let Some(v) = fields.get(name) {
                put(name, v);
            }
        }
        let mut extra: Vec<_> = fields.iter().filter(|(k, _)| !CODEX_TOTAL_FIELDS.contains(&k.as_str())).collect();
        extra.sort_by(|a, b| a.0.cmp(b.0));
        for (name, v) in extra {
            put(name, v);
        }
    }
    text.push('}');
    key(&text)
}

/// The one shared copy of a name. Names nothing holds any more are let go after each scan.
fn interned(text: &str) -> Arc<str> {
    let mut pool = names().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(a) = pool.get(text) {
        return a.clone();
    }
    let a: Arc<str> = Arc::from(text);
    pool.insert(a.clone());
    a
}
fn names() -> &'static Mutex<HashSet<Arc<str>>> {
    static NAMES: std::sync::OnceLock<Mutex<HashSet<Arc<str>>>> = std::sync::OnceLock::new();
    NAMES.get_or_init(Default::default)
}
fn let_go_of_unused_names() {
    names().lock().unwrap_or_else(|e| e.into_inner()).retain(|a| Arc::strong_count(a) > 1);
}
/// `interned`, skipping the shared pool while a file keeps naming the same thing.
fn shared(last: &mut Option<Arc<str>>, text: &str) -> Arc<str> {
    match last {
        Some(a) if &**a == text => a.clone(),
        _ => last.insert(interned(text)).clone(),
    }
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

/// The local day of a time. A log's replies come in time order, so the day just found usually
/// holds the next one too: its bounds are kept and a time inside them needs no time-zone lookup.
struct Days<'z> {
    tz: &'z jiff::tz::TimeZone,
    /// The last day found, as [start, end) in UTC milliseconds.
    last: Option<(i64, i64, jiff::civil::Date)>,
}

impl Days<'_> {
    fn of(&mut self, at: u64) -> Option<jiff::civil::Date> {
        let ms = i64::try_from(at).ok()?;
        if let Some((start, end, day)) = self.last {
            if start <= ms && ms < end {
                return Some(day);
            }
        }
        let zoned = jiff::Timestamp::from_millisecond(ms).ok()?.to_zoned(self.tz.clone());
        let day = zoned.date();
        let start = zoned.start_of_day().ok().map(|z| z.timestamp().as_millisecond());
        let end = day.tomorrow().ok().and_then(|d| d.to_zoned(self.tz.clone()).ok()).and_then(|z| z.start_of_day().ok()).map(|z| z.timestamp().as_millisecond());
        // a bound that cannot be worked out keeps nothing, so the next time is looked up afresh
        self.last = start.zip(end).filter(|(s, e)| *s <= ms && ms < *e).map(|(s, e)| (s, e, day));
        Some(day)
    }
}

/// Adds turns into buckets keyed by local day, session, model, folder and prompt-size band.
fn bucket<'a>(turns: impl IntoIterator<Item = &'a Turn>, tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let mut rows: HashMap<(jiff::civil::Date, &'a str, &'a str, &'a str, u8), Row> = HashMap::new();
    let mut days = Days { tz, last: None };
    for t in turns {
        if t.input + t.output + t.cache_read + t.cache_write == 0 {
            continue;
        }
        let Some(day) = days.of(t.at) else { continue };
        let prompt = t.input + t.cache_read + t.cache_write;
        // Bands match the published price steps: 100k (Haiku 5.5), 200k, 272k (OpenAI long context).
        let band = if prompt > 272_000 { 3 } else if prompt > 200_000 { 2 } else if prompt > 100_000 { 1 } else { 0 };
        let r = rows.entry((day, &*t.session, &*t.model, &*t.cwd, band)).or_insert_with(|| Row { band, ..Row::default() });
        r.input += t.input;
        r.output += t.output;
        r.cache_read += t.cache_read;
        r.cache_write += t.cache_write;
        r.cache_write_1h += t.cache_write_1h;
        r.reasoning += t.reasoning;
        r.last = r.last.max(t.at);
    }
    let mut out: Vec<Row> = rows
        .into_iter()
        .map(|((day, session, model, cwd, _), r)| Row { day: day.to_string(), session: session.into(), model: model.into(), cwd: cwd.into(), ..r })
        .collect();
    out.sort_by(|a, b| (&a.day, a.last).cmp(&(&b.day, b.last)));
    out
}

/// What reading a log so far has left behind: how far it was read, the replies found, and what a
/// later line needs from the earlier ones. A log only grows, so the next read starts where this one
/// stopped (USAGE-016); one that was written over is read again from the start (see `reads_on`).
struct FileScan {
    /// Size, change time and creation time when it was last read.
    len: u64,
    at: Option<std::time::SystemTime>,
    created: Option<std::time::SystemTime>,
    /// Bytes taken so far: the end of the last whole line.
    offset: u64,
    /// A hash of the last `TAIL` bytes before `offset` (fewer near the start): a log written over
    /// in place no longer has them there, so it is read again from the start.
    tail: u64,
    /// JSON records taken so far: a reply with no id of its own is keyed by its place.
    records: usize,
    /// Codex: the session, model and folder the latest lines named, and the latest running total.
    session: Option<Arc<str>>,
    model: Arc<str>,
    cwd: Arc<str>,
    prev: Option<Value>,
    turns: Vec<(Key, Turn)>,
}

impl FileScan {
    fn new() -> FileScan {
        FileScan { len: 0, at: None, created: None, offset: 0, tail: tail_hash(&[]), records: 0, session: None, model: interned("unknown"), cwd: interned(""), prev: None, turns: Vec::new() }
    }

    /// Takes whole lines from `bytes`, which start at `offset`. A last line with no line end is
    /// taken only when it already reads as a whole record (a writer mid-line leaves a piece that
    /// does not); the rest waits for the next read. False when the text is not UTF-8, as a whole
    /// read of the file would fail.
    fn take(&mut self, provider: &str, name: &str, bytes: &[u8]) -> bool {
        let cut = bytes.iter().rposition(|&c| c == b'\n').map_or(0, |i| i + 1);
        let rest = &bytes[cut..];
        let whole_rest = !rest.is_empty() && std::str::from_utf8(rest).ok().and_then(|t| serde_json::from_str::<Value>(t).ok()).is_some_and(|v| v.is_object());
        let end = if whole_rest { bytes.len() } else { cut };
        let Ok(text) = std::str::from_utf8(&bytes[..end]) else { return false };
        if provider == "claude" {
            self.claude_lines(name, text);
        } else {
            self.codex_lines(name, text);
        }
        self.offset += end as u64;
        true
    }

    /// The records in `text`, numbered on from the ones already taken.
    fn records(&mut self, text: &str) -> Vec<(usize, Value)> {
        let from = self.records;
        let out: Vec<(usize, Value)> = text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(Value::is_object).enumerate().map(|(i, v)| (from + i, v)).collect();
        self.records += out.len();
        out
    }

    /// Claude Code: replies by message id, the last piece written winning, so the streamed pieces
    /// of one reply are merged into one.
    fn claude_lines(&mut self, name: &str, text: &str) {
        let mut at: HashMap<Key, usize> = self.turns.iter().enumerate().map(|(i, (k, _))| (*k, i)).collect();
        let (mut session, mut model, mut cwd) = (None, None, None);
        let mut fallback = None::<String>;
        for (i, v) in self.records(text) {
            let Some(usage) = v.get("message").and_then(|m| m.get("usage")).filter(|u| u.is_object()) else { continue };
            let Some(when) = s(&v, "timestamp").and_then(crate::capture::parse_time) else { continue };
            let msg = &v["message"];
            let id = match s(msg, "id").or_else(|| s(&v, "requestId")).or_else(|| s(&v, "uuid")) {
                Some(id) => key(id),
                None => key(&format!("{name}:{i}")),
            };
            let split = usage.get("cache_creation").filter(|c| c.is_object());
            let lifetimes = split.map(|c| n(c, "ephemeral_5m_input_tokens") + n(c, "ephemeral_1h_input_tokens")).unwrap_or(0);
            let cache_write = if usage.get("cache_creation_input_tokens").is_some_and(Value::is_u64) { n(usage, "cache_creation_input_tokens") } else { lifetimes };
            let output = n(usage, "output_tokens");
            let thinking = usage.get("output_tokens_details").map(|d| n(d, "thinking_tokens")).unwrap_or(0);
            let turn = Turn {
                at: when,
                session: match s(&v, "sessionId") {
                    Some(id) => shared(&mut session, id),
                    None => shared(&mut session, fallback.get_or_insert_with(|| stem(name))),
                },
                model: shared(&mut model, s(msg, "model").unwrap_or("unknown")),
                cwd: shared(&mut cwd, s(&v, "cwd").unwrap_or_default()),
                input: n(usage, "input_tokens"),
                output,
                cache_read: n(usage, "cache_read_input_tokens"),
                cache_write,
                cache_write_1h: split.map(|c| n(c, "ephemeral_1h_input_tokens")).unwrap_or(0).min(cache_write),
                reasoning: thinking.min(output),
            };
            match at.get(&id) {
                Some(&i) => self.turns[i].1 = turn,
                None => {
                    at.insert(id, self.turns.len());
                    self.turns.push((id, turn));
                }
            }
        }
    }

    /// Codex: token events, keyed by their time and running total. An event counts by its own
    /// last-turn figures, and only when the running total moved, so a repeated event adds nothing
    /// and the first event of a resumed session is not taken as its whole history. Cached input is
    /// part of Codex's input count.
    fn codex_lines(&mut self, name: &str, text: &str) {
        let mut fallback = None::<Arc<str>>;
        for (i, v) in self.records(text) {
            let Some(p) = v.get("payload").filter(|p| p.is_object()) else { continue };
            if let Some(m) = s(p, "model") {
                if *self.model != *m {
                    self.model = interned(m);
                }
            }
            if let Some(c) = s(p, "cwd") {
                if *self.cwd != *c {
                    self.cwd = interned(c);
                }
            }
            if self.session.is_none() {
                self.session = s(p, "session_id").or_else(|| if i == 0 { s(p, "id") } else { None }).map(interned);
            }
            let Some(info) = p.get("info").filter(|x| x.is_object()) else { continue };
            let Some(total) = info.get("total_token_usage").filter(|x| x.is_object()) else { continue };
            if self.prev.as_ref() == Some(total) {
                continue;
            }
            let last = match (info.get("last_token_usage").filter(|x| x.is_object()), &self.prev) {
                (Some(l), _) => l.clone(),
                // no last-turn figures: the step since the previous running total
                (None, Some(before)) => serde_json::json!({
                    "input_tokens": n(total, "input_tokens").saturating_sub(n(before, "input_tokens")),
                    "cached_input_tokens": n(total, "cached_input_tokens").saturating_sub(n(before, "cached_input_tokens")),
                    "output_tokens": n(total, "output_tokens").saturating_sub(n(before, "output_tokens")),
                    "reasoning_output_tokens": n(total, "reasoning_output_tokens").saturating_sub(n(before, "reasoning_output_tokens")),
                }),
                (None, None) => {
                    self.prev = Some(total.clone());
                    continue;
                }
            };
            self.prev = Some(total.clone());
            let Some(stamp) = s(&v, "timestamp") else { continue };
            let Some(at) = crate::capture::parse_time(stamp) else { continue };
            let (input, output) = (n(&last, "input_tokens"), n(&last, "output_tokens"));
            let cached = n(&last, "cached_input_tokens").min(input);
            let session = match &self.session {
                Some(id) => id.clone(),
                None => fallback.get_or_insert_with(|| interned(&stem(name))).clone(),
            };
            let turn = Turn {
                at,
                session,
                model: self.model.clone(),
                cwd: self.cwd.clone(),
                input: input - cached,
                output,
                cache_read: cached,
                cache_write: 0,
                cache_write_1h: 0,
                reasoning: n(&last, "reasoning_output_tokens").min(output),
            };
            self.turns.push((codex_key(stamp, total), turn));
        }
    }
}

/// USAGE-016 / USAGE-017: files in credit order, oldest first. A reply or token event that several
/// files hold, as a fork, a copy or a resumed session carries the earlier ones, counts once, for the
/// first file that holds it; once that file is gone the next copy carries it. The turns are
/// bucketed where they lie, never copied.
fn merged<'a>(files: impl IntoIterator<Item = &'a [(Key, Turn)]>) -> impl Iterator<Item = &'a Turn> {
    let mut seen = HashSet::new();
    files.into_iter().flatten().filter(move |(k, _)| seen.insert(*k)).map(|(_, t)| t)
}

#[cfg(test)]
fn parsed(provider: &str, files: &[(String, String)]) -> Vec<FileScan> {
    files
        .iter()
        .map(|(name, text)| {
            let mut f = FileScan::new();
            assert!(f.take(provider, name, text.as_bytes()));
            f
        })
        .collect()
}

/// Claude Code transcripts, as (file name, text), in credit order.
#[cfg(test)]
pub fn claude_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let parsed = parsed("claude", files);
    bucket(merged(parsed.iter().map(|f| f.turns.as_slice())), tz)
}

/// Codex session logs, as (file name, text), in credit order.
#[cfg(test)]
pub fn codex_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let parsed = parsed("codex", files);
    bucket(merged(parsed.iter().map(|f| f.turns.as_slice())), tz)
}

/// USAGE-016: how far each log file was read and what it held, so a file unchanged since is not
/// read again and one that grew is read only from where the last read stopped. It is kept in a
/// file in Kolux's data folder too, so the first scan after a restart reads only what changed.
#[derive(Default)]
pub struct Cache {
    files: HashMap<PathBuf, FileScan>,
    /// Bytes the latest scan read (the tests check it).
    #[cfg_attr(not(test), allow(dead_code))]
    bytes_read: u64,
}

/// The format the scan memory is kept in on disk (3: logs read on from where they stopped, names
/// kept once per file; 4: each file's creation time and the hash of the bytes before where its
/// read stopped). A memory in any other format is thrown away and every log read afresh.
/// The kept Codex keys hash the event's time and `total_token_usage` written in a fixed field order
/// (`codex_key`), so they do not depend on serde_json's `preserve_order` feature; changing that text
/// would change every kept key and needs a new format number.
const KEPT_FORMAT: u32 = 4;

/// The scan memory as kept on disk. Each file lists the names its replies use once, and each
/// reply points at them: (key high half, key low half, time, session, model, folder, counts).
#[derive(Deserialize)]
struct Kept {
    format: u32,
    files: Vec<KeptFile>,
}
type KeptTurn = (u64, u64, u64, u32, u32, u32, [u64; 6]);
#[derive(Deserialize)]
struct KeptFile {
    path: PathBuf,
    len: u64,
    at: Option<std::time::SystemTime>,
    created: Option<std::time::SystemTime>,
    offset: u64,
    tail: u64,
    records: usize,
    names: Vec<String>,
    /// Codex: the session, model and folder (as places in `names`) and the latest running total.
    state: (Option<u32>, u32, u32, Option<Value>),
    turns: Vec<KeptTurn>,
}
#[derive(Serialize)]
struct KeptFileOut<'a> {
    path: &'a Path,
    len: u64,
    at: Option<std::time::SystemTime>,
    created: Option<std::time::SystemTime>,
    offset: u64,
    tail: u64,
    records: usize,
    names: Vec<&'a str>,
    state: (Option<u32>, u32, u32, &'a Option<Value>),
    turns: Vec<KeptTurn>,
}

impl<'a> KeptFileOut<'a> {
    fn of(path: &'a Path, f: &'a FileScan) -> KeptFileOut<'a> {
        let mut places: HashMap<&'a str, u32> = HashMap::new();
        let mut names: Vec<&'a str> = Vec::new();
        let mut place = |t: &'a str| *places.entry(t).or_insert_with(|| {
            names.push(t);
            names.len() as u32 - 1
        });
        let state = (f.session.as_deref().map(&mut place), place(&f.model), place(&f.cwd), &f.prev);
        let turns = f
            .turns
            .iter()
            .map(|(k, t)| ((k >> 64) as u64, *k as u64, t.at, place(&t.session), place(&t.model), place(&t.cwd), [t.input, t.output, t.cache_read, t.cache_write, t.cache_write_1h, t.reasoning]))
            .collect();
        KeptFileOut { path, len: f.len, at: f.at, created: f.created, offset: f.offset, tail: f.tail, records: f.records, names, state, turns }
    }
}

impl KeptFile {
    /// None when a place points outside the file's names (a damaged memory).
    fn into_scan(self) -> Option<(PathBuf, FileScan)> {
        let names: Vec<Arc<str>> = self.names.iter().map(|t| interned(t)).collect();
        let at = |i: u32| names.get(i as usize).cloned();
        let (session, model, cwd, prev) = self.state;
        let session = match session {
            Some(i) => Some(at(i)?),
            None => None,
        };
        let mut turns = Vec::with_capacity(self.turns.len());
        for (hi, lo, when, s, m, c, [input, output, cache_read, cache_write, cache_write_1h, reasoning]) in self.turns {
            let turn = Turn { at: when, session: at(s)?, model: at(m)?, cwd: at(c)?, input, output, cache_read, cache_write, cache_write_1h, reasoning };
            turns.push(((u128::from(hi) << 64) | u128::from(lo), turn));
        }
        Some((self.path, FileScan { len: self.len, at: self.at, created: self.created, offset: self.offset, tail: self.tail, records: self.records, session, model: at(model)?, cwd: at(cwd)?, prev, turns }))
    }
}

fn kept_file(profile: &Path, provider: &str) -> PathBuf {
    profile.join(format!("token-scan-{provider}.json"))
}

impl Cache {
    /// What an earlier run kept; empty when it is missing, damaged or in another format.
    pub fn load(path: &Path) -> Cache {
        let kept = std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<Kept>(&b).ok()).filter(|k| k.format == KEPT_FORMAT);
        let files = kept.and_then(|k| k.files.into_iter().map(KeptFile::into_scan).collect::<Option<HashMap<_, _>>>());
        Cache { files: files.unwrap_or_default(), bytes_read: 0 }
    }

    /// Kolux's own memory, not an agent's settings: written to a temporary file that then takes the
    /// old one's place, so a crash leaves the old memory or the new one, never half of either. It
    /// is only a speed-up, so it is not read back and keeps no backup.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        use serde::ser::{SerializeStruct, Serializer};
        struct Files<'a>(&'a HashMap<PathBuf, FileScan>);
        impl Serialize for Files<'_> {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.collect_seq(self.0.iter().map(|(p, f)| KeptFileOut::of(p, f)))
            }
        }
        let fail = |e: &dyn std::fmt::Display| format!("{}: {e}", path.display());
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| fail(&e))?;
        }
        let tmp = path.with_extension("json.tmp");
        let written = (|| -> Result<(), String> {
            let mut out = std::io::BufWriter::new(std::fs::File::create(&tmp).map_err(|e| fail(&e))?);
            let mut ser = serde_json::Serializer::new(&mut out);
            let mut kept = (&mut ser).serialize_struct("Kept", 2).map_err(|e| fail(&e))?;
            kept.serialize_field("format", &KEPT_FORMAT).map_err(|e| fail(&e))?;
            kept.serialize_field("files", &Files(&self.files)).map_err(|e| fail(&e))?;
            kept.end().map_err(|e| fail(&e))?;
            // on disk before it takes the old one's place, so a power cut cannot leave an empty memory
            out.into_inner().map_err(|e| fail(e.error()))?.sync_all().map_err(|e| fail(&e))
        })();
        if let Err(e) = written.and_then(|()| std::fs::rename(&tmp, path).map_err(|e| fail(&e))) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        Ok(())
    }
}

/// One provider's scan memory while Kolux runs, and when it was last written to disk.
struct Held {
    cache: Cache,
    file: PathBuf,
    /// Something was read or went since the copy on disk was written.
    dirty: bool,
    saved: Option<std::time::Instant>,
    /// An earlier version's backup beside the memory is gone (or was never there).
    backup_gone: bool,
}

/// The copy on disk is written at most this often, and once more as Kolux quits. It only saves
/// reading the logs again after a restart, so a crash costs at most this much re-reading.
const SAVE_EVERY: std::time::Duration = std::time::Duration::from_secs(5 * 60);

impl Held {
    /// Writes the memory when something changed and the last write is `SAVE_EVERY` old (or none was made yet).
    fn save_if_due(&mut self) {
        if self.dirty && self.saved.is_none_or(|t| t.elapsed() >= SAVE_EVERY) {
            self.save();
        }
    }

    fn save(&mut self) {
        if self.cache.save(&self.file).is_ok() {
            self.dirty = false;
            if !self.backup_gone {
                // Earlier versions kept a full backup beside the memory on every save; it is not needed.
                let mut backup = self.file.clone().into_os_string();
                backup.push(".bak-kolux");
                let _ = std::fs::remove_file(backup);
                self.backup_gone = true;
            }
        }
        self.saved = Some(std::time::Instant::now());
    }
}

fn caches() -> &'static Mutex<HashMap<String, Held>> {
    static CACHES: std::sync::OnceLock<Mutex<HashMap<String, Held>>> = std::sync::OnceLock::new();
    CACHES.get_or_init(Default::default)
}

/// As Kolux quits: the scan memory that changed since its last save is written. A scan still
/// running is waited for up to 2 s; past that the save is skipped, which costs only a re-read.
pub fn save_at_quit() {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(2);
    let mut all = loop {
        match caches().try_lock() {
            Ok(all) => break all,
            Err(std::sync::TryLockError::Poisoned(e)) => break e.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) if std::time::Instant::now() < until => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(std::sync::TryLockError::WouldBlock) => return,
        }
    };
    for held in all.values_mut().filter(|h| h.dirty) {
        held.save();
    }
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
/// what its forks copied. A file unchanged since the last scan is taken from `cache`, and one that
/// grew is read only from where the last read stopped. Gives the rows and how many files were
/// read. None of the folders being there is a failure, so saved figures stay.
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
    let (mut read, mut bytes_read, mut order, mut next) = (0, 0, Vec::new(), HashMap::new());
    for (p, m) in files {
        let (len, at, created) = (m.len(), m.modified().ok(), m.created().ok());
        let scanned = match cache.files.remove(&p) {
            Some(f) if (f.len, f.at, f.created) == (len, at, created) => f,
            before => {
                // Read on from where the last read stopped when the file only grew; else from the start.
                let mut read_on = before.filter(|f| f.created == created && len > f.len && at >= f.at).and_then(|f| {
                    let from = f.offset - f.offset.min(TAIL);
                    let bytes = read_from(&p, from, len)?;
                    reads_on(&f, &bytes, from).then_some((f, bytes, from))
                });
                if read_on.is_none() {
                    let Some(bytes) = read_from(&p, 0, len) else { continue };
                    read_on = Some((FileScan::new(), bytes, 0));
                }
                let Some((mut f, bytes, from)) = read_on else { continue };
                let new = &bytes[(f.offset - from) as usize..];
                let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
                if !f.take(provider, &name, new) {
                    continue;
                }
                read += 1;
                bytes_read += new.len() as u64;
                let end = (f.offset - from) as usize;
                f.tail = tail_hash(&bytes[end - end.min(TAIL as usize)..end]);
                (f.len, f.at, f.created) = (len, at, created);
                f
            }
        };
        order.push(p.clone());
        next.insert(p, scanned);
    }
    let rows = bucket(merged(order.iter().filter_map(|p| next.get(p)).map(|f| f.turns.as_slice())), &jiff::tz::TimeZone::system());
    *cache = Cache { files: next, bytes_read };
    Ok((rows, read))
}

/// How many bytes before where a read stopped are checked before reading on from there.
const TAIL: u64 = 64;

fn tail_hash(bytes: &[u8]) -> u64 {
    hash(bytes) as u64
}

/// True when `bytes`, read from `from` (`TAIL` bytes before `f.offset`, fewer near the start), still
/// begin with the bytes the last read ended on: the log grew and was not written over.
fn reads_on(f: &FileScan, bytes: &[u8], from: u64) -> bool {
    let k = (f.offset - from) as usize;
    bytes.len() >= k && tail_hash(&bytes[..k]) == f.tail
}

/// A file's bytes from `from` up to `to`.
fn read_from(path: &Path, from: u64, to: u64) -> Option<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.take(to.saturating_sub(from)).read_to_end(&mut buf).ok()?;
    Some(buf)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub tracking: serde_json::Map<String, Value>,
    pub claude: Option<Saved>,
    pub codex: Option<Saved>,
}

/// What opening the page shows at once: the tracking choices and the saved results.
// Async: off the window's thread. The store is held only to copy the saved text out; the rows are
// parsed after it is let go, so a large history never holds up other store users.
#[tauri::command(async)]
pub fn token_usage(store: tauri::State<'_, Mutex<Store>>) -> Result<Usage, String> {
    let (claude, codex, picked) = {
        let s = store.lock().map_err(|e| e.to_string())?;
        let raw = |p: &str| s.get(&key_saved(p)).ok().flatten();
        (raw("claude"), raw("codex"), choices(&s))
    };
    let (claude, codex) = (claude.and_then(|t| parse_saved(&t)), codex.and_then(|t| parse_saved(&t)));
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
    let mut all: serde_json::Map<String, Value> = crate::state::kept::load(store, KEY_TRACKING)?;
    all.insert(provider.to_string(), Value::Bool(on));
    store.set(KEY_TRACKING, &Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// Rescans one provider and saves the result; a failed scan keeps the last good rows and says why.
/// The scan memory starts from the copy kept on disk; that copy is written again when a file was
/// read or went, at most every `SAVE_EVERY`, and as Kolux quits.
pub fn rescan(store: &Mutex<Store>, provider: &str) {
    let (dirs, profile) = match store.lock() {
        Ok(s) => (roots(&s, provider, Some(&s.dir())), s.dir()),
        Err(_) => return,
    };
    let result = {
        let mut all = caches().lock().unwrap_or_else(|e| e.into_inner());
        let held = all.entry(provider.to_string()).or_insert_with(|| {
            let file = kept_file(&profile, provider);
            Held { cache: Cache::load(&file), file, dirty: false, saved: None, backup_gone: false }
        });
        let had = held.cache.files.len();
        let result = scan(&dirs, provider, &mut held.cache);
        if result.as_ref().is_ok_and(|(_, read)| *read > 0) || held.cache.files.len() != had {
            held.dirty = true;
        }
        held.save_if_due();
        let_go_of_unused_names();
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
    fn days_found_from_kept_bounds_match_a_lookup_for_every_time_across_clock_changes() {
        let mut zones = 0;
        for name in ["America/New_York", "Australia/Lord_Howe", "Asia/Kolkata", "UTC"] {
            let Ok(tz) = TimeZone::get(name) else { continue };
            zones += 1;
            let mut days = Days { tz: &tz, last: None };
            // every 17 minutes through a spring and an autumn clock change, forwards then back
            let from = jiff::Timestamp::from_second(1_772_000_000).unwrap().as_millisecond();
            let times: Vec<u64> = (0..25_000).map(|i| (from + i * 17 * 60_000) as u64).collect();
            for &at in times.iter().chain(times.iter().rev()) {
                let direct = jiff::Timestamp::from_millisecond(at as i64).unwrap().to_zoned(tz.clone()).date();
                assert_eq!(days.of(at), Some(direct), "{name} at {at}");
            }
        }
        assert!(zones >= 3, "the time-zone database is there");
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
    fn codex_keys_are_fixed_by_the_numbers_not_by_the_printed_field_order() {
        let stamp = "2026-03-01T09:01:00Z";
        let text = r#"{"input_tokens":1200,"cached_input_tokens":200,"cache_write_input_tokens":0,"output_tokens":300,"reasoning_output_tokens":30,"total_tokens":1500}"#;
        let ordered: Value = serde_json::from_str(text).unwrap();
        // What the kept memory holds for a log in Codex's own order: the hash of that printed text (this is the
        // text serde_json printed with `preserve_order`, before the key was written out by hand).
        let kept = key(&format!("{stamp}|{text}"));
        assert_eq!(codex_key(stamp, &ordered), kept);
        assert_eq!(kept, 0xd3a4_7e60_4991_94cd_989b_ed51_70e3_8911_u128, "the key a kept memory holds for this event");
        // The same numbers written in another field order are the same event.
        let shuffled: Value = serde_json::from_str(r#"{"total_tokens":1500,"reasoning_output_tokens":30,"output_tokens":300,"cache_write_input_tokens":0,"cached_input_tokens":200,"input_tokens":1200}"#).unwrap();
        assert_eq!(codex_key(stamp, &shuffled), kept);
        // Older logs have no cache-write field; the key reads the fields that are there, in Codex's order.
        let old_text = r#"{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":300,"reasoning_output_tokens":30,"total_tokens":1500}"#;
        let old_log: Value = serde_json::from_str(old_text).unwrap();
        assert_eq!(codex_key(stamp, &old_log), key(&format!("{stamp}|{old_text}")));
        assert_ne!(codex_key(stamp, &old_log), kept);
        // A field this build does not know is part of the key, after the known ones, by name.
        let extra_a: Value = serde_json::from_str(r#"{"zeta":1,"input_tokens":5,"alpha":2}"#).unwrap();
        let extra_b: Value = serde_json::from_str(r#"{"alpha":2,"input_tokens":5,"zeta":1}"#).unwrap();
        assert_eq!(codex_key(stamp, &extra_a), codex_key(stamp, &extra_b));
        assert_eq!(codex_key(stamp, &extra_a), key(&format!(r#"{stamp}|{{"input_tokens":5,"alpha":2,"zeta":1}}"#)));
        // A different time or different numbers are a different event.
        assert_ne!(codex_key("2026-03-01T09:01:01Z", &ordered), kept);
        assert_ne!(codex_key(stamp, &counts(1200, 200, 300, 31)), kept);
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
        assert!(Cache::load(&kept).files.is_empty());
        assert!(Cache::load(&t.0.join("missing.json")).files.is_empty());
        // a memory in the format before logs were read on from where they stopped is rebuilt, not misread
        std::fs::write(&kept, r#"{"format":2,"files":[["x.jsonl",[1,null,[]]]]}"#).unwrap();
        assert!(Cache::load(&kept).files.is_empty());
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
        crate::state::kept::refuse_copies(&t.0);
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
        let side = crate::state::kept::Unreadable::new(&t.0);
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

    fn sorted(mut rows: Vec<Row>) -> Vec<Row> {
        rows.sort_by(|a, b| (&a.day, &a.session, &a.model, &a.cwd, a.band).cmp(&(&b.day, &b.session, &b.model, &b.cwd, b.band)));
        rows
    }
    fn lines(lines: &[Value]) -> String {
        lines.iter().map(|l| l.to_string() + "\n").collect()
    }
    fn append(path: &Path, text: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new().append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }
    /// The same folder read with no memory at all.
    fn full(root: &Path, provider: &str) -> Vec<Row> {
        sorted(scan(&[root.to_path_buf()], provider, &mut Cache::default()).unwrap().0)
    }

    #[test]
    fn usage_016_a_grown_log_is_read_only_from_where_the_last_read_stopped() {
        let t = temp("grown");
        let root = t.0.join("projects");
        let one = root.join("p").join("one.jsonl");
        let u = |i: u64| json!({ "input_tokens": i, "output_tokens": 1, "cache_creation_input_tokens": 2 });
        std::fs::create_dir_all(one.parent().unwrap()).unwrap();
        std::fs::write(&one, lines(&[reply("m1", "2026-03-01T09:00:00Z", u(10)), reply("m2", "2026-03-01T09:01:00Z", u(20))])).unwrap();
        write(&root.join("p").join("two.jsonl"), &[reply("m3", "2026-03-01T09:00:00Z", u(5))]);
        let mut cache = Cache::default();
        assert_eq!(scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap().1, 2);
        // a new reply, a later streamed piece of m2 that must replace the first, and a reply with no id
        let more = lines(&[reply("m4", "2026-03-02T09:00:00Z", u(40)), reply("m2", "2026-03-01T09:01:05Z", u(25)), json!({ "timestamp": "2026-03-02T10:00:00Z", "message": { "usage": u(7) } })]);
        append(&one, &more);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, more.len() as u64), "only the appended bytes are read");
        assert_eq!(sorted(rows), full(&root, "claude"), "the same figures as a whole read");
        // half a line waits for the rest; the figures do not move until it is whole
        let next = reply("m5", "2026-03-02T11:00:00Z", u(80)).to_string() + "\n";
        let (head, tail) = next.split_at(next.len() / 2);
        append(&one, head);
        let (rows, _) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!(total(&rows), 11 + 26 + 6 + 41 + 8);
        append(&one, tail);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, next.len() as u64), "the piece left over is read once more with its end");
        assert_eq!(total(&rows), 11 + 26 + 6 + 41 + 8 + 81);
        assert_eq!(sorted(rows), full(&root, "claude"));
        // a log written over with less is read again from the start
        std::fs::write(&one, lines(&[reply("m1", "2026-03-01T09:00:00Z", u(10))])).unwrap();
        let (rows, _) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!(total(&rows), 11 + 6);
        assert_eq!(sorted(rows), full(&root, "claude"));
    }

    #[test]
    fn usage_017_a_grown_codex_log_keeps_its_session_model_and_running_total() {
        let t = temp("grown-codex");
        let root = t.0.join("sessions");
        let log = root.join("2026").join("rollout-a.jsonl");
        std::fs::create_dir_all(log.parent().unwrap()).unwrap();
        let meta = json!({ "timestamp": "2026-03-01T09:00:00Z", "type": "meta", "payload": { "session_id": "cx-1", "cwd": "C:/work/app", "model": "codex-model-y" } });
        std::fs::write(&log, lines(&[meta, event("2026-03-01T09:01:00Z", counts(100, 40, 10, 1), counts(100, 40, 10, 1))])).unwrap();
        let mut cache = Cache::default();
        scan(std::slice::from_ref(&root), "codex", &mut cache).unwrap();
        // a repeated running total adds nothing; a new one without last-turn figures counts its step
        let no_last = json!({ "timestamp": "2026-03-01T09:03:00Z", "type": "event", "payload": { "info": { "total_token_usage": counts(400, 100, 40, 4) } } });
        let more = lines(&[event("2026-03-01T09:02:00Z", counts(100, 40, 10, 1), counts(100, 40, 10, 1)), json!({ "timestamp": "2026-03-01T09:02:30Z", "payload": { "model": "codex-model-z" } }), no_last]);
        append(&log, &more);
        let (rows, read) = scan(std::slice::from_ref(&root), "codex", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, more.len() as u64));
        assert_eq!(sorted(rows.clone()), full(&root, "codex"));
        assert_eq!(total(&rows), 70 + 270);
        assert!(rows.iter().all(|r| r.session == "cx-1" && r.cwd == "C:/work/app"));
        assert_eq!(rows.iter().filter(|r| r.model == "codex-model-z").map(|r| r.input + r.cache_read).sum::<u64>(), 300);
    }

    #[test]
    fn usage_016_a_restart_reads_on_from_the_kept_place_and_the_memory_is_written_whole() {
        let t = temp("kept-place");
        let root = t.0.join("projects");
        let one = root.join("p").join("one.jsonl");
        std::fs::create_dir_all(one.parent().unwrap()).unwrap();
        std::fs::write(&one, lines(&[reply("m1", "2026-03-01T09:00:00Z", json!({ "input_tokens": 10, "output_tokens": 1 }))])).unwrap();
        let profile = t.0.join("profile");
        let kept = profile.join("token-scan-claude.json");
        // an older version's full backup beside the memory goes with the first save
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::write(profile.join("token-scan-claude.json.bak-kolux"), "old").unwrap();
        let mut held = Held { cache: Cache::default(), file: kept.clone(), dirty: false, saved: None, backup_gone: false };
        scan(std::slice::from_ref(&root), "claude", &mut held.cache).unwrap();
        held.dirty = true;
        held.save_if_due();
        assert!(!held.dirty && kept.is_file());
        assert!(!profile.join("token-scan-claude.json.bak-kolux").exists());
        assert!(!profile.join("token-scan-claude.json.tmp").exists(), "no temporary file is left");
        let offset = std::fs::metadata(&one).unwrap().len();
        // within SAVE_EVERY a change waits for the next due save (or the quit)
        let written = std::fs::read(&kept).unwrap();
        append(&one, &lines(&[reply("m2", "2026-03-01T09:05:00Z", json!({ "input_tokens": 100, "output_tokens": 0 }))]));
        scan(std::slice::from_ref(&root), "claude", &mut held.cache).unwrap();
        held.dirty = true;
        held.save_if_due();
        assert!(held.dirty && std::fs::read(&kept).unwrap() == written, "not written again before SAVE_EVERY");
        // a new run starts from the kept place: only the reply added since is read
        let mut after = Cache::load(&kept);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut after).unwrap();
        assert_eq!((read, after.bytes_read), (1, std::fs::metadata(&one).unwrap().len() - offset));
        assert_eq!(total(&rows), 111);
        assert_eq!(sorted(rows), full(&root, "claude"));
    }

    #[test]
    fn usage_016_a_log_written_over_in_place_is_read_again_from_its_start() {
        let t = temp("written-over");
        let root = t.0.join("projects");
        let one = root.join("p").join("one.jsonl");
        std::fs::create_dir_all(one.parent().unwrap()).unwrap();
        let u = |i: u64| json!({ "input_tokens": i, "output_tokens": 1 });
        let later = |s: u64| std::fs::File::options().write(true).open(&one).unwrap().set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(s)).unwrap();
        let first = lines(&[reply("m1", "2026-03-01T09:00:00Z", u(10)), reply("m2", "2026-03-01T09:01:00Z", u(20))]);
        std::fs::write(&one, &first).unwrap();
        let mut cache = Cache::default();
        scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        // the same size and a newer change time: other figures in as many bytes
        let same = lines(&[reply("m1", "2026-03-01T09:00:00Z", u(30)), reply("m2", "2026-03-01T09:01:00Z", u(40))]);
        assert_eq!(same.len(), first.len());
        std::fs::write(&one, &same).unwrap();
        later(10);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, same.len() as u64), "read again whole");
        assert_eq!(total(&rows), 31 + 41);
        assert_eq!(sorted(rows), full(&root, "claude"));
        // cut to nothing, then written past its old size: same file, so the same creation time
        let regrown = lines(&[reply("m7", "2026-03-02T09:00:00Z", u(70)), reply("m8", "2026-03-02T09:01:00Z", u(80)), reply("m9", "2026-03-02T09:02:00Z", u(90))]);
        assert!(regrown.len() > same.len());
        std::fs::write(&one, "").unwrap();
        std::fs::write(&one, &regrown).unwrap();
        later(20);
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, regrown.len() as u64), "the bytes before the old end changed: read again whole");
        assert_eq!(total(&rows), 71 + 81 + 91);
        assert_eq!(sorted(rows), full(&root, "claude"));
        // a file made anew under the same name (another creation time) is read from the start too
        cache.files.get_mut(&one).unwrap().created = Some(std::time::UNIX_EPOCH);
        append(&one, &lines(&[reply("m10", "2026-03-02T10:00:00Z", u(5))]));
        let (rows, read) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!((read, cache.bytes_read), (1, std::fs::metadata(&one).unwrap().len()));
        assert_eq!(total(&rows), 71 + 81 + 91 + 6);
        assert_eq!(sorted(rows), full(&root, "claude"));
        // and a plain append after all that is read on from where the read stopped
        let more = lines(&[reply("m11", "2026-03-02T11:00:00Z", u(8))]);
        append(&one, &more);
        let (rows, _) = scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        assert_eq!(cache.bytes_read, more.len() as u64);
        assert_eq!(sorted(rows), full(&root, "claude"));
    }

    #[test]
    fn usage_016_an_old_backup_goes_on_the_first_save_that_lands() {
        let t = temp("backup-later");
        let profile = t.0.join("profile");
        std::fs::create_dir_all(&profile).unwrap();
        let backup = profile.join("token-scan-claude.json.bak-kolux");
        std::fs::write(&backup, "old").unwrap();
        // the memory's place is taken by a folder, so the first save fails and the backup stays
        let kept = profile.join("token-scan-claude.json");
        std::fs::create_dir_all(kept.join("in-the-way")).unwrap();
        let mut held = Held { cache: Cache::default(), file: kept.clone(), dirty: true, saved: None, backup_gone: false };
        held.save();
        assert!(held.dirty && backup.exists());
        std::fs::remove_dir_all(&kept).unwrap();
        held.save();
        assert!(!held.dirty && kept.is_file() && !backup.exists());
    }

    /// Before/after timing, run by hand: `cargo test --lib token_usage::tests::bench -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench_rescan_of_200_logs_with_one_grown() {
        let t = temp("bench");
        let root = t.0.join("projects");
        let line = |f: usize, i: usize| reply(&format!("m{f}-{i}"), "2026-03-01T09:00:00Z", json!({ "input_tokens": i, "output_tokens": 1, "cache_read_input_tokens": 1000 })).to_string() + "\n";
        for f in 0..200 {
            let dir = root.join(format!("p{}", f % 10));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("s{f}.jsonl")), (0..500).map(|i| line(f, i)).collect::<String>()).unwrap();
        }
        let grown = root.join("p0").join("s0.jsonl");
        let kept = t.0.join("profile").join("token-scan-claude.json");
        let mut cache = Cache::default();
        let start = std::time::Instant::now();
        scan(std::slice::from_ref(&root), "claude", &mut cache).unwrap();
        let first = start.elapsed();
        cache.save(&kept).unwrap();
        let text = std::fs::read_to_string(&kept).unwrap();
        append(&grown, &line(0, 9999));
        // before: the grown file read whole, and the memory saved through the agent-config writer
        let mut whole = Cache { files: cache.files.drain().filter(|(p, _)| *p != grown).collect(), bytes_read: 0 };
        let start = std::time::Instant::now();
        scan(std::slice::from_ref(&root), "claude", &mut whole).unwrap();
        crate::trust::write_whole(&kept, &text).unwrap();
        let before = start.elapsed();
        append(&grown, &line(0, 10_000));
        // after: only the appended line is read, and no save (it waits for SAVE_EVERY or the quit)
        let start = std::time::Instant::now();
        scan(std::slice::from_ref(&root), "claude", &mut whole).unwrap();
        let after = start.elapsed();
        let start = std::time::Instant::now();
        whole.save(&kept).unwrap();
        let save = start.elapsed();
        let start = std::time::Instant::now();
        let rows = bucket(merged(whole.files.values().map(|f| f.turns.as_slice())), &jiff::tz::TimeZone::system());
        let bucketing = start.elapsed();
        println!(
            "BENCH 200 logs x 500 replies: first scan {first:?}; rescan with one grown: before (whole file re-read + safe writer) {before:?}, after (appended bytes only, no save) {after:?}, of which bucketing {bucketing:?} ({} rows); one plain save {save:?}; memory {} bytes",
            rows.len(),
            std::fs::metadata(&kept).unwrap().len()
        );
    }
}
