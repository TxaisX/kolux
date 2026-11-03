//! T-650 / DT-C88: the Settings > Claude tab's backend. A read-only summary of how Claude Code is
//! set up on this machine and for one workspace: model, merged settings, permissions, hooks, MCP
//! servers, skills, subagents, plugins and the CLAUDE.md files that apply.
//!
//! Safety by construction (DT-C88):
//! - Only the files listed in `summarize` are opened, all through `Reader`, which refuses a
//!   forbidden path (credentials, backups, transcripts, history, caches, `.env*`) before it touches
//!   the disk and keeps a log of every file it opened (the tests read that log).
//! - `~/.claude.json` is read through a typed struct that has room for nothing but the MCP fields,
//!   so the account, user id, tokens and every other key are dropped while parsing.
//! - MCP `env` / `headers` values, settings `env` values, secret-looking keys, URL queries and
//!   secret-looking arguments leave this module as `••••`.
//! - Files are size-capped. Inside the workspace a link or a path that resolves outside it is skipped.
//! - Nothing is ever run: hook, MCP and `apiKeyHelper` commands are shown as text only.
//! - A workspace comes from the frontend, so the command only accepts one the fence allows.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_FILE: u64 = 1 << 20; // 1 MB for every settings-like file
const MAX_GLOBAL: u64 = 8 << 20; // ~/.claude.json grows with use; still capped
const HEAD: u64 = 32 << 10; // a skill / agent file: only its front matter is wanted
const MAX_ROWS: usize = 300;
const SHOWN: usize = 240;
pub const MASK: &str = "••••";

/// Where Claude Code's files are for this run. Tests build one over a temp folder.
pub struct Paths {
    pub config_dir: PathBuf,
    pub global_json: PathBuf,
    pub managed_dir: PathBuf,
    pub workspace: Option<PathBuf>,
}

impl Paths {
    /// `CLAUDE_CONFIG_DIR` (or the home folder) through the helpers the hooks and trust code use.
    pub fn from_env(workspace: Option<PathBuf>) -> Self {
        let config_dir = crate::hooks::claude_settings_file().parent().map(Path::to_path_buf).unwrap_or_default();
        Self { config_dir, global_json: crate::trust::claude_config_file(), managed_dir: managed_dir(), workspace }
    }
}

/// The system folder organisation policy lives in (public docs: code.claude.com/docs/en/managed-settings).
fn managed_dir() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into())).join("ClaudeCode")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/ClaudeCode")
    } else {
        PathBuf::from("/etc/claude-code")
    }
}

// ---- output ----

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Src {
    pub scope: &'static str,
    pub label: String,
    pub path: String,
    /// found, missing, invalid or skipped
    pub state: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub scope: &'static str,
    pub label: String,
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SettingRow {
    pub key: String,
    pub value: String,
    pub scope: String,
    pub path: String,
    /// Lower-precedence scopes that also set the key (a scalar they lost to).
    pub also: Vec<&'static str>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub rule: String,
    pub scope: &'static str,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub allow: Vec<Rule>,
    pub ask: Vec<Rule>,
    pub deny: Vec<Rule>,
    pub directories: Vec<Rule>,
    pub default_mode: Option<SettingRow>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HookRow {
    pub event: String,
    pub matcher: Option<String>,
    pub kind: String,
    pub command: String,
    pub scope: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Masked {
    pub key: String,
    pub value: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpRow {
    pub name: String,
    pub kind: String,
    pub target: String,
    pub env: Vec<Masked>,
    pub headers: Vec<Masked>,
    pub scope: &'static str,
    pub from: String,
    pub off: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpFlag {
    pub list: String,
    pub name: String,
    pub scope: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub description: String,
    pub scope: &'static str,
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id: String,
    pub enabled: Option<bool>,
    pub version: Option<String>,
    pub scope: &'static str,
    pub from: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub path: String,
    pub kind: &'static str,
    pub scope: &'static str,
    pub bytes: u64,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Files {
    pub settings: Vec<FileRef>,
    pub mcp: Vec<FileRef>,
    pub plugins: Vec<FileRef>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetup {
    pub config_dir: String,
    pub managed_dir: String,
    pub workspace: Option<String>,
    pub sources: Vec<Src>,
    pub model: Option<SettingRow>,
    pub settings: Vec<SettingRow>,
    pub permissions: Permissions,
    pub hooks: Vec<HookRow>,
    pub mcp: Vec<McpRow>,
    pub mcp_flags: Vec<McpFlag>,
    pub skills: Vec<Entry>,
    pub agents: Vec<Entry>,
    pub plugins: Vec<PluginRow>,
    pub memory: Vec<MemoryFile>,
    pub files: Files,
    /// Every file and folder this run opened, for the "what was read" line.
    pub reads: Vec<String>,
    pub notes: Vec<String>,
}

// ---- guarded reading ----

/// The folders under the Claude config folder that are never read (transcripts, caches, copies).
const NEVER_DIRS: [&str; 9] = ["backups", "projects", "paste-cache", "file-history", "debug", "shell-snapshots", "session-env", "uploads", "sessions"];

/// True for a path this module must never open, wherever it is asked from.
pub fn forbidden(path: &Path, config_dir: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if name == ".credentials.json" || name == "history.jsonl" || name.ends_with(".jsonl") || name.starts_with(".env") || name.contains("credentials") {
        return true;
    }
    path.strip_prefix(config_dir).is_ok_and(|rel| rel.components().any(|c| NEVER_DIRS.contains(&c.as_os_str().to_string_lossy().to_ascii_lowercase().as_str())))
}

struct Reader<'a> {
    config_dir: &'a Path,
    log: RefCell<Vec<String>>,
    notes: RefCell<Vec<String>>,
}

fn shown(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

impl<'a> Reader<'a> {
    fn new(config_dir: &'a Path) -> Self {
        Self { config_dir, log: RefCell::new(vec![]), notes: RefCell::new(vec![]) }
    }
    fn note(&self, s: String) {
        let mut n = self.notes.borrow_mut();
        if n.len() < 40 {
            n.push(s);
        }
    }

    /// Whether `path` may be opened. `root` is the workspace for project files: there a link, or a
    /// path that resolves outside the workspace, is skipped. `Err` carries a note (never contents).
    fn allow(&self, path: &Path, root: Option<&Path>) -> Result<(), String> {
        if forbidden(path, self.config_dir) {
            return Err(format!("{} is never read", shown(path)));
        }
        if let Some(root) = root {
            let meta = fs::symlink_metadata(path).map_err(|_| String::new())?;
            if meta.file_type().is_symlink() {
                return Err(format!("{} is a link, so it was skipped", shown(path)));
            }
            match (fs::canonicalize(path), fs::canonicalize(root)) {
                (Ok(c), Ok(r)) if c.starts_with(&r) => {}
                _ => return Err(format!("{} resolves outside the workspace, so it was skipped", shown(path))),
            }
        }
        Ok(())
    }

    /// The file's text (BOM dropped). `whole`: a file bigger than `cap` is refused; otherwise only its first `cap` bytes are read.
    fn text(&self, path: &Path, cap: u64, root: Option<&Path>, whole: bool) -> Option<String> {
        if let Err(why) = self.allow(path, root) {
            if !why.is_empty() {
                self.note(why);
            }
            return None;
        }
        let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
        if whole && meta.len() > cap {
            self.note(format!("{} is bigger than {} KB, so it was not read", shown(path), cap / 1024));
            return None;
        }
        self.log.borrow_mut().push(shown(path));
        let mut buf = Vec::new();
        fs::File::open(path).ok()?.take(cap).read_to_end(&mut buf).ok()?;
        let s = String::from_utf8_lossy(&buf).into_owned();
        Some(s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s))
    }

    fn json(&self, path: &Path, root: Option<&Path>) -> Result<Option<Value>, ()> {
        match self.text(path, MAX_FILE, root, true) {
            None => Ok(None),
            Some(t) => match serde_json::from_str::<Value>(&t) {
                Ok(v) if v.is_object() => Ok(Some(v)),
                _ => {
                    self.note(format!("{} is not a JSON object, so it was ignored", shown(path)));
                    Err(())
                }
            },
        }
    }

    /// Entries of a folder, sorted, at most `MAX_ROWS + 1`. The listing is logged too.
    fn list(&self, dir: &Path, root: Option<&Path>) -> Vec<(String, PathBuf, fs::FileType)> {
        if self.allow(dir, root).is_err() {
            return vec![];
        }
        let Ok(rd) = fs::read_dir(dir) else { return vec![] };
        self.log.borrow_mut().push(format!("{}/", shown(dir)));
        let mut out: Vec<_> = rd.flatten().filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), e.path(), e.file_type().ok()?))).collect();
        out.sort_by_key(|a| a.0.to_lowercase());
        out.truncate(MAX_ROWS + 1);
        out
    }
}

// ---- masking and display ----

fn secretish(k: &str) -> bool {
    let k = k.to_ascii_lowercase();
    !k.ends_with("helper") && ["token", "secret", "password", "passwd", "credential", "apikey", "api_key", "api-key", "authorization", "bearer", "cookie", "uuid", "orgid", "accountid", "account_id"].iter().any(|w| k.contains(w))
}

/// `v` with secrets replaced: `env` / `headers` objects keep their key names, all values masked; any
/// value (object, array, number, string) under a secret-looking key is masked; other strings go through `mask_text`.
fn mask(key: &str, v: &Value) -> Value {
    match v {
        Value::Object(m) if matches!(key, "env" | "headers" | "extraHeaders") => Value::Object(m.keys().map(|k| (k.clone(), Value::String(MASK.into()))).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (mask_text(k), if secretish(k) && !x.is_null() { Value::String(MASK.into()) } else { mask(k, x) })).collect()),
        Value::Array(a) => Value::Array(a.iter().map(|x| mask(key, x)).collect()),
        Value::String(s) => Value::String(mask_text(s)),
        _ => v.clone(),
    }
}

fn clip(s: &str) -> String {
    if s.chars().count() <= SHOWN {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(SHOWN).collect::<String>())
    }
}

fn display(key: &str, v: &Value) -> String {
    let v = if secretish(key) && !v.is_null() { Value::String(MASK.into()) } else { mask(key, v) };
    clip(&match &v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

/// True for strings shaped like a known credential: provider prefixes or a JWT.
fn is_token(s: &str) -> bool {
    let low = s.to_ascii_lowercase();
    let prefixed = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-", "xox", "xapp-", "sk-", "sk_", "rk_", "pk_live_", "hf_", "npm_", "ya29."].iter().any(|p| low.starts_with(p))
        || ["AKIA", "ASIA", "AIza"].iter().any(|p| s.starts_with(p));
    // a long run of letters and digits with no other shape is almost always a key
    let opaque = s.len() >= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && s.chars().any(|c| c.is_ascii_digit()) && s.chars().any(|c| c.is_ascii_alphabetic());
    prefixed || opaque || (s.starts_with("eyJ") && s.matches('.').count() == 2)
}

/// A URL with no user-info, query or fragment (where tokens go), and every path segment of 16+ characters
/// (or shaped like a credential) masked, because keys are sometimes embedded in paths.
fn mask_url(u: &str) -> String {
    let (scheme, rest) = u.split_once("://").map_or(("", u), |(s, r)| (s, r));
    // User-info may hold a stray ? / or # (a pasted password), so the last @ ends it unless a plain path comes
    // first (`h.example/@scope/pkg`): no / before it, or a "user:" before the first / (over-masking is fine here).
    let slash = rest.find('/').unwrap_or(rest.len());
    let user_info = |i: usize| !rest[..i].contains('/') || rest[..slash].contains(':');
    // an @ before the first / always ends the user-info, even when a later @ (path, query) is not one
    let (user, rest) = match rest.rfind('@').filter(|&i| user_info(i)).or_else(|| rest[..slash].rfind('@')) {
        Some(i) => (format!("{MASK}@"), &rest[i + 1..]),
        None => (String::new(), rest),
    };
    let cut = rest.find(['?', '#']).unwrap_or(rest.len());
    let (host, path) = rest[..cut].split_at(rest[..cut].find('/').unwrap_or(cut));
    let host = format!("{user}{host}");
    let path = path.split('/').map(|seg| if seg.chars().count() >= 16 || is_token(seg) { MASK } else { seg }).collect::<Vec<_>>().join("/");
    let tail = if cut < rest.len() { format!("?{MASK}") } else { String::new() };
    if scheme.is_empty() { format!("{host}{path}{tail}") } else { format!("{scheme}://{host}{path}{tail}") }
}

/// One whitespace-free word: URLs lose their secrets, credential-shaped words and secret `KEY=value` pairs are masked.
fn mask_word(w: &str) -> String {
    let t = w.trim_matches(|c| matches!(c, '"' | '\'' | '('| ')' | '<' | '>' | ',' | ';'));
    if t.is_empty() {
        return w.to_string();
    }
    // ponytail: a 4 KB+ single word is no readable command; hidden whole, which keeps the `=` walk below cheap
    if t.len() > 4096 {
        return MASK.to_string();
    }
    let at = w.find(t).unwrap_or(0);
    let url = |t: &str| t.split_once("://").is_some_and(|(s, _)| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)));
    // `a=b=KEY=v`: each `name=` in turn, a loop (not recursion) so a word of a million `=` cannot overflow the stack
    let mut inner = String::new();
    let mut rest = t;
    loop {
        if url(rest) {
            inner += &mask_url(rest);
        } else if is_token(rest) {
            inner += MASK;
        } else if let Some((k, v)) = rest.split_once('=') {
            inner += k;
            inner += "=";
            if secret_name(var_name(k)) {
                inner += MASK;
            } else {
                rest = v;
                continue;
            }
        } else {
            inner += rest;
        }
        break;
    }
    format!("{}{inner}{}", &w[..at], &w[at + t.len()..])
}

/// A name (of a flag, a header or a `KEY=value` pair) whose value is a credential: the secret words, plus
/// `key`/`auth`/`pat`/`pass`/`pwd`/`passphrase` alone or as the last part (`--api-key`, `DB_PASS`, `-Key`).
fn secret_name(n: &str) -> bool {
    let low = n.to_ascii_lowercase();
    secretish(n) || ["key", "auth", "pat", "pass", "pwd", "passphrase"].iter().any(|w| low == *w || low.ends_with(&format!("-{w}")) || low.ends_with(&format!("_{w}")))
}

/// A flag name (dashes trimmed) whose value is a credential. curl's `-u`/`-b`/`--user` only count after
/// `curl` (case kept), so `pip install -U x` and `git checkout -b x` stay readable.
fn secret_flag(f: &str, curl: bool) -> bool {
    secret_name(f) || curl && matches!(f, "u" | "b" | "user" | "U" | "proxy-user")
}

/// A shell variable's name without its `$` / `$env:` (any case): `$Env:MY_KEY` -> `MY_KEY`.
fn var_name(a: &str) -> &str {
    let a = a.trim_start_matches('$');
    match a.get(..4) {
        Some(p) if p.eq_ignore_ascii_case("env:") => &a[4..],
        _ => a,
    }
}

fn quote(c: char) -> bool {
    c == '"' || c == '\''
}

/// Whether word `a` ends a span closed by `c` (trailing `)`, `;`, `,` and, for a quote, `}` ignored). An escaped
/// quote (`\"` inside a double-quoted JSON body) does not close it.
fn closes(a: &str, c: char) -> bool {
    let end = |s: &str| s.ends_with(c) && !s[..s.len() - c.len_utf8()].ends_with('\\');
    let t = a.trim_end_matches([')', ';', ',']);
    end(t) || c != '}' && end(t.trim_end_matches('}'))
}

/// The closer of a span opened by word `a`, unless `a` already closes it.
fn opens(a: &str, plain: Option<char>) -> Option<char> {
    match a.chars().next().filter(|&c| quote(c)) {
        Some(q) => (a.len() < 2 || !closes(a, q)).then_some(q),
        None => plain.filter(|&c| !closes(a, c)),
    }
}

/// Where `mask_words` is in a command line.
#[derive(Default)]
struct Words {
    hide_next: bool,
    hide_rest: bool,
    curl: bool,
    named: bool,        // the last word was a secret name, so a lone `=` after it assigns a secret
    span: Option<char>, // hide words until one ends with this character
}

impl Words {
    fn step(&mut self, a: &str) -> String {
        if let Some(c) = self.span {
            if closes(a, c) {
                self.span = None;
            }
            return MASK.to_string();
        }
        // `$env:DB_PASSWORD = "v"`, `$token = 'v'`: the word after the `=` is the value
        if std::mem::replace(&mut self.named, secret_name(var_name(a))) && a == "=" {
            self.hide_next = true;
            return a.to_string();
        }
        let out = self.word(a);
        // a new command starts: curl's -u / -b are no longer curl's
        if matches!(a, "&&" | "||" | "|") || a.ends_with(';') {
            self.curl = false;
        }
        out
    }

    fn word(&mut self, a: &str) -> String {
        let bare = a.trim_matches(quote);
        let base = bare.rsplit(['/', '\\', '(']).next().unwrap_or("").to_ascii_lowercase();
        self.curl |= base == "curl" || base == "curl.exe";
        if self.hide_rest {
            return MASK.to_string();
        }
        if std::mem::take(&mut self.hide_next) {
            // `Bearer x`: the scheme and the token after it both go
            self.hide_next = matches!(bare.to_ascii_lowercase().as_str(), "bearer" | "basic" | "token" | "digest");
            // a quoted value (`--password "a b"`) is hidden up to its closing quote
            self.span = opens(a, None);
            return MASK.to_string();
        }
        let low = a.to_ascii_lowercase();
        if low.contains("bearer ") {
            return MASK.to_string();
        }
        // a JSON body ('{"password": "v"}', however split) or a PowerShell table (@{ Authorization = "v" }): hidden whole
        let open = bare.trim_start_matches('(');
        if open.starts_with('{') || open.starts_with("@{") {
            self.span = opens(a, Some('}'));
            return MASK.to_string();
        }
        if low.contains("authorization:") {
            // the scheme, the token and anything after them are hidden, however the header was split
            self.hide_rest = true;
            let i = low.find("authorization:").unwrap() + "authorization:".len();
            return if a[i..].trim().is_empty() { a.to_string() } else { format!("{} {MASK}", &a[..i]) };
        }
        // a header word such as "X-Api-Key:", "Cookie: a=1; sid=v" or "Token:abc": the value is hidden
        if let Some((name, value)) = a.split_once(':') {
            let n = name.trim_matches(|c| quote(c) || c == '\\').to_ascii_lowercase();
            let header = !name.contains(['/', '{', '=']) && (secret_name(&n) || n == "cookie");
            // a permission rule's wildcard ("token:*)") is not a value
            let wildcard = !value.is_empty() && value.chars().all(|c| matches!(c, '*' | ')'));
            if header && !wildcard {
                self.span = opens(a, None);
                let v = value.trim_matches(quote);
                if self.span.is_none() && (v.is_empty() || matches!(v.to_ascii_lowercase().as_str(), "bearer" | "basic" | "token")) {
                    self.hide_next = true;
                }
                return if value.is_empty() { a.to_string() } else { format!("{name}:{MASK}") };
            }
        }
        if matches!(bare.to_ascii_lowercase().as_str(), "bearer" | "basic") {
            self.hide_next = true;
            return a.to_string();
        }
        if let Some(f) = a.strip_prefix('-') {
            let f = f.trim_start_matches('-');
            let dashes = &a[..a.len() - f.len()];
            // curl's joined `-ubob:v` / `-bsid=v` (before the `=` split, which would read `sid` as the flag)
            if self.curl && !a.starts_with("--") && a.len() > 2 && matches!(a.get(..2), Some("-u" | "-b" | "-U")) {
                return format!("{}{MASK}", &a[..2]);
            }
            if let Some((name, value)) = f.split_once('=') {
                // `--key=v`, `--user=bob:v`
                if secret_flag(name, self.curl) {
                    return format!("{dashes}{name}={MASK}");
                }
                // `--header="X-Api-Key: v"`, `--data='{"pin":"v"}'`: the value is read like a word of its own.
                // Not when it is itself a flag, so `-=-=-=…` cannot recurse once per pair.
                if !value.is_empty() && !value.starts_with('-') {
                    return format!("{dashes}{name}={}", self.word(value));
                }
            }
        }
        // `TOKEN="a b"`, `$Env:MY_KEY='v w'`: a quoted secret value is hidden up to its closing quote
        if let Some((k, v)) = a.split_once('=') {
            if secret_name(var_name(k)) {
                self.span = opens(v, None);
                return format!("{k}={MASK}");
            }
        }
        let out = mask_word(a);
        if out == a && a.starts_with('-') && !a.contains('=') && secret_flag(a.trim_start_matches('-'), self.curl) {
            self.hide_next = true;
        }
        out
    }
}

/// Command-line words with the values of secret-looking flags, `Authorization`/`Bearer` values, header values,
/// JSON bodies, URL user-info, credential-shaped words and `KEY=value` pairs masked. A quoted header value or
/// JSON body is hidden up to its closing quote, however many words it spans.
fn mask_words<'a>(words: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut st = Words::default();
    words.map(|a| st.step(a)).collect()
}

/// An MCP server's command and args as one line: an arg may itself hold a whole command line (`-c "npx s --token v"`),
/// and curl's state carries from the command into its args. An arg is one value however many words it holds
/// (`"correct horse v"`, `"Cookie: a=1; sid=v"`), so once a word in it is hidden, the rest of that arg goes too.
fn mask_command(cmd: &str, args: &[Value]) -> String {
    let mut st = Words::default();
    let mut out = Vec::new();
    for arg in std::iter::once(cmd).chain(args.iter().filter_map(Value::as_str)) {
        let mut hidden = false;
        for w in arg.split_whitespace() {
            let m = if hidden { MASK.to_string() } else { st.step(w) };
            hidden |= m != w || st.hide_next || st.hide_rest || st.span.is_some();
            out.push(m);
        }
    }
    out.join(" ")
}

/// Free text (a hook command, a status line, a permission rule): masked word by word.
fn mask_text(s: &str) -> String {
    mask_words(s.split_whitespace()).join(" ")
}

// ---- settings layers ----

struct Layer {
    scope: &'static str,
    label: String,
    path: PathBuf,
    value: Value,
}

fn load_layers(p: &Paths, r: &Reader, sources: &mut Vec<Src>, files: &mut Files) -> Vec<Layer> {
    let mut out: Vec<Layer> = vec![];
    let add = |scope: &'static str, label: String, path: PathBuf, root: Option<&Path>, out: &mut Vec<Layer>, sources: &mut Vec<Src>, files: &mut Files| {
        let (state, value) = match r.json(&path, root) {
            Ok(Some(v)) => ("found", Some(v)),
            Ok(None) => (if fs::symlink_metadata(&path).is_ok() && root.is_some() && r.allow(&path, root).is_err() { "skipped" } else { "missing" }, None),
            Err(()) => ("invalid", None),
        };
        sources.push(Src { scope, label: label.clone(), path: shown(&path), state });
        if state != "missing" && path.is_file() {
            files.settings.push(FileRef { scope, label: label.clone(), path: shown(&path) });
        }
        if let Some(value) = value {
            out.push(Layer { scope, label, path, value });
        }
    };
    // Highest precedence first. Managed drop-ins override the base file, the last one winning.
    let mut dropins: Vec<PathBuf> = r.list(&p.managed_dir.join("managed-settings.d"), None).into_iter().filter(|(n, _, t)| t.is_file() && n.to_lowercase().ends_with(".json")).map(|(_, f, _)| f).collect();
    dropins.reverse();
    for f in dropins {
        let label = format!("managed-settings.d/{}", f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        add("managed", label, f, None, &mut out, sources, files);
    }
    add("managed", "managed-settings.json".into(), p.managed_dir.join("managed-settings.json"), None, &mut out, sources, files);
    if let Some(ws) = &p.workspace {
        add("local", ".claude/settings.local.json".into(), ws.join(".claude").join("settings.local.json"), Some(ws), &mut out, sources, files);
        add("project", ".claude/settings.json".into(), ws.join(".claude").join("settings.json"), Some(ws), &mut out, sources, files);
    }
    add("user", "settings.json".into(), p.config_dir.join("settings.json"), None, &mut out, sources, files);
    out
}

/// Keys that have a section of their own.
const OWN_SECTION: [&str; 5] = ["permissions", "hooks", "enabledPlugins", "mcpServers", "model"];

fn rows_for(layers: &[Layer]) -> Vec<SettingRow> {
    let mut keys: Vec<&String> = vec![];
    for l in layers {
        for k in l.value.as_object().into_iter().flat_map(Map::keys) {
            if !OWN_SECTION.contains(&k.as_str()) && !keys.contains(&k) {
                keys.push(k);
            }
        }
    }
    keys.sort_by_key(|k| k.to_lowercase());
    keys.into_iter().take(MAX_ROWS).map(|k| merged_row(layers, k)).collect()
}

/// One key across the layers: lists join, objects merge key by key (higher wins), anything else the highest layer's.
fn merged_row(layers: &[Layer], key: &str) -> SettingRow {
    let defs: Vec<(&Layer, &Value)> = layers.iter().filter_map(|l| l.value.get(key).map(|v| (l, v))).collect();
    let (win, top) = defs[0];
    let all_arrays = defs.iter().all(|(_, v)| v.is_array());
    let all_objects = defs.iter().all(|(_, v)| v.is_object());
    let value = if all_arrays {
        let mut out: Vec<Value> = vec![];
        for (_, v) in &defs {
            for x in v.as_array().into_iter().flatten() {
                if !out.contains(x) {
                    out.push(x.clone());
                }
            }
        }
        Value::Array(out)
    } else if all_objects {
        let mut m = Map::new();
        for (_, v) in defs.iter().rev() {
            for (k, x) in v.as_object().into_iter().flatten() {
                m.insert(k.clone(), x.clone());
            }
        }
        Value::Object(m)
    } else {
        top.clone()
    };
    let merged = all_arrays || all_objects;
    let mut scopes: Vec<&'static str> = vec![];
    for (l, _) in &defs {
        if !scopes.contains(&l.scope) {
            scopes.push(l.scope);
        }
    }
    SettingRow {
        key: key.to_string(),
        value: display(key, &value),
        scope: if merged { scopes.join(" + ") } else { win.scope.to_string() },
        path: shown(&win.path),
        also: if merged { vec![] } else { scopes.into_iter().skip(1).collect() },
    }
}

fn permissions(layers: &[Layer]) -> Permissions {
    let mut out = Permissions::default();
    for (list, field) in [(&mut out.allow, "allow"), (&mut out.ask, "ask"), (&mut out.deny, "deny"), (&mut out.directories, "additionalDirectories")] {
        for l in layers {
            for rule in l.value.pointer(&format!("/permissions/{field}")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                let masked = clip(&mask_text(rule));
                if list.len() < MAX_ROWS && !list.iter().any(|r| r.rule == masked) {
                    list.push(Rule { rule: masked, scope: l.scope });
                }
            }
        }
    }
    out.default_mode = layers.iter().find_map(|l| l.value.pointer("/permissions/defaultMode").map(|v| SettingRow { key: "defaultMode".into(), value: display("defaultMode", v), scope: l.scope.into(), path: shown(&l.path), also: vec![] }));
    out
}

fn hooks(layers: &[Layer]) -> Vec<HookRow> {
    let mut out = vec![];
    for l in layers {
        for (event, groups) in l.value.get("hooks").and_then(Value::as_object).into_iter().flatten() {
            for g in groups.as_array().into_iter().flatten() {
                let matcher = g.get("matcher").and_then(Value::as_str).map(clip);
                for h in g.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                    let kind = h.get("type").and_then(Value::as_str).unwrap_or("command");
                    let what = ["command", "url", "prompt"].iter().find_map(|k| h.get(*k).and_then(Value::as_str)).unwrap_or("");
                    if out.len() < MAX_ROWS {
                        out.push(HookRow { event: clip(event), matcher: matcher.clone(), kind: clip(kind), command: clip(&mask_text(what)), scope: l.scope });
                    }
                }
            }
        }
    }
    out
}

// ---- MCP ----

/// The only fields read from `~/.claude.json`. Serde skips every other key while parsing, so the
/// account, user id, tokens and the rest are never held, let alone returned. Both fields stay raw
/// values so one malformed entry (a null, a wrong type) costs only itself, never the whole file.
#[derive(Deserialize, Default)]
struct Global {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: Value,
    #[serde(default)]
    projects: Value,
}

/// A project entry's four on/off lists plus its own servers, each read leniently.
struct LocalProject {
    mcp_servers: Map<String, Value>,
    enabled: Vec<String>,
    disabled: Vec<String>,
    enabled_json: Vec<String>,
    disabled_json: Vec<String>,
}

impl LocalProject {
    fn from(v: &Value) -> Self {
        let list = |k: &str| -> Vec<String> { v.get(k).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect() };
        LocalProject {
            mcp_servers: v.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default(),
            enabled: list("enabledMcpServers"),
            disabled: list("disabledMcpServers"),
            enabled_json: list("enabledMcpjsonServers"),
            disabled_json: list("disabledMcpjsonServers"),
        }
    }
}

fn same_folder(a: &str, b: &str) -> bool {
    let n = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    if cfg!(windows) { n(a).eq_ignore_ascii_case(&n(b)) } else { n(a) == n(b) }
}

fn mcp_rows(servers: &Map<String, Value>, scope: &'static str, from: &str, out: &mut Vec<McpRow>) {
    for (name, s) in servers {
        if out.len() >= MAX_ROWS {
            return;
        }
        let pairs = |k: &str| s.get(k).and_then(Value::as_object).map(|m| m.keys().map(|k| Masked { key: clip(k), value: MASK }).collect()).unwrap_or_default();
        let url = s.get("url").and_then(Value::as_str);
        let kind = s.get("type").and_then(Value::as_str).unwrap_or(if url.is_some() { "http" } else { "stdio" });
        let target = match url {
            Some(u) => mask_url(u),
            None => {
                let cmd = s.get("command").and_then(Value::as_str).unwrap_or("");
                mask_command(cmd, s.get("args").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))
            }
        };
        out.push(McpRow { name: clip(name), kind: clip(kind), target: clip(&target), env: pairs("env"), headers: pairs("headers"), scope, from: from.to_string(), off: false });
    }
}

fn mcp(p: &Paths, r: &Reader, layers: &[Layer], files: &mut Files) -> (Vec<McpRow>, Vec<McpFlag>) {
    let mut rows = vec![];
    let mut flags = vec![];
    let file = |scope: &'static str, label: &str, path: &Path, files: &mut Files| {
        if path.is_file() {
            files.mcp.push(FileRef { scope, label: label.into(), path: shown(path) });
        }
    };
    // managed-mcp.json beside the managed settings
    let mm = p.managed_dir.join("managed-mcp.json");
    if let Ok(Some(v)) = r.json(&mm, None) {
        file("managed", "managed-mcp.json", &mm, files);
        mcp_rows(v.get("mcpServers").and_then(Value::as_object).unwrap_or(&Map::new()), "managed", "managed-mcp.json", &mut rows);
    }
    // settings files, highest first
    for l in layers {
        if let Some(m) = l.value.get("mcpServers").and_then(Value::as_object) {
            mcp_rows(m, l.scope, &l.label, &mut rows);
        }
    }
    // the project's .mcp.json
    if let Some(ws) = &p.workspace {
        let f = ws.join(".mcp.json");
        if let Ok(Some(v)) = r.json(&f, Some(ws)) {
            file("project", ".mcp.json", &f, files);
            mcp_rows(v.get("mcpServers").and_then(Value::as_object).unwrap_or(&Map::new()), "project", ".mcp.json", &mut rows);
        }
    }
    // ~/.claude.json: mcpServers, plus this workspace's mcpServers and its on/off lists. Nothing else survives parsing.
    let mut disabled: Vec<String> = vec![];
    if let Some(t) = r.text(&p.global_json, MAX_GLOBAL, None, true) {
        match serde_json::from_str::<Global>(&t) {
            Ok(g) => {
                file("user", ".claude.json", &p.global_json, files);
                mcp_rows(g.mcp_servers.as_object().unwrap_or(&Map::new()), "user", ".claude.json", &mut rows);
                let here = p.workspace.as_ref().map(|w| shown(w));
                if let Some(lp) = g.projects.as_object().and_then(|m| m.iter().find(|(k, _)| here.as_deref().is_some_and(|h| same_folder(k, h)))).map(|(_, v)| LocalProject::from(v)) {
                    mcp_rows(&lp.mcp_servers, "local", ".claude.json (this workspace)", &mut rows);
                    for (list, names) in [("enabledMcpServers", &lp.enabled), ("disabledMcpServers", &lp.disabled), ("enabledMcpjsonServers", &lp.enabled_json), ("disabledMcpjsonServers", &lp.disabled_json)] {
                        for n in names.iter().take(MAX_ROWS) {
                            flags.push(McpFlag { list: list.into(), name: clip(n), scope: "local" });
                        }
                    }
                    disabled = lp.disabled.iter().chain(lp.disabled_json.iter()).map(|s| clip(s)).collect();
                }
            }
            Err(_) => r.note(format!("{} could not be read as JSON, so its MCP servers are missing", shown(&p.global_json))),
        }
    }
    for row in &mut rows {
        row.off = disabled.contains(&row.name);
    }
    (rows, flags)
}

// ---- skills, agents, plugins, memory ----

/// `name` and `description` from a Markdown file's front matter (plain, quoted, or a `>` / `|` block).
pub fn front_matter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let body: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let field = |key: &str| -> Option<String> {
        let at = body.iter().position(|l| l.strip_prefix(key).is_some_and(|r| r.starts_with(':')))?;
        let first = body[at][key.len() + 1..].trim();
        let value = if matches!(first, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            body[at + 1..].iter().take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.trim().is_empty()).map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
        } else {
            first.trim_matches(|c| c == '"' || c == '\'').to_string()
        };
        Some(value).filter(|v| !v.is_empty())
    };
    (field("name"), field("description"))
}

fn entries(r: &Reader, dir: &Path, scope: &'static str, root: Option<&Path>, skills: bool, out: &mut Vec<Entry>) {
    for (name, path, ty) in r.list(dir, root) {
        if out.len() >= MAX_ROWS {
            r.note(format!("{} holds more than {MAX_ROWS} entries; the rest are not listed", shown(dir)));
            return;
        }
        let (file, fallback) = if skills {
            if !(ty.is_dir() || (ty.is_symlink() && root.is_none())) {
                continue;
            }
            (path.join("SKILL.md"), name.clone())
        } else {
            if !(ty.is_file() || (ty.is_symlink() && root.is_none())) || !name.to_lowercase().ends_with(".md") {
                continue;
            }
            let stem = name.rsplit_once('.').map_or(name.clone(), |(s, _)| s.to_string());
            (path.clone(), stem)
        };
        if let Some(t) = r.text(&file, HEAD, root, false) {
            let (n, d) = front_matter(&t);
            out.push(Entry { name: clip(&n.unwrap_or(fallback)), description: clip(&d.unwrap_or_default()), scope, path: shown(&file) });
        }
    }
}

/// `~/.claude/plugins/installed_plugins.json`: `{ "plugins": { "<name>@<market>": [ { scope, version, .. } ] } }`.
fn plugins(p: &Paths, r: &Reader, layers: &[Layer], files: &mut Files) -> Vec<PluginRow> {
    let mut out: Vec<PluginRow> = vec![];
    for l in layers {
        for (id, v) in l.value.get("enabledPlugins").and_then(Value::as_object).into_iter().flatten() {
            if out.len() < MAX_ROWS && !out.iter().any(|x| x.from == "settings" && x.id == *id) {
                out.push(PluginRow { id: clip(id), enabled: v.as_bool(), version: None, scope: l.scope, from: "settings" });
            }
        }
    }
    let f = p.config_dir.join("plugins").join("installed_plugins.json");
    if let Ok(Some(v)) = r.json(&f, None) {
        files.plugins.push(FileRef { scope: "user", label: "installed_plugins.json".into(), path: shown(&f) });
        for (id, installs) in v.get("plugins").and_then(Value::as_object).into_iter().flatten() {
            for i in installs.as_array().into_iter().flatten().take(8) {
                let scope = match i.get("scope").and_then(Value::as_str) {
                    Some("project") => "project",
                    Some("local") => "local",
                    Some("managed") => "managed",
                    _ => "user",
                };
                if out.len() < MAX_ROWS {
                    out.push(PluginRow { id: clip(id), enabled: None, version: i.get("version").and_then(Value::as_str).map(clip), scope, from: "installed" });
                }
            }
        }
    }
    files.plugins.extend(files.settings.iter().map(|f| FileRef { scope: f.scope, label: f.label.clone(), path: f.path.clone() }));
    out
}

/// The CLAUDE.md files that apply, sizes only: nothing in them is read. Folders above the workspace
/// count, as Claude Code walks up; `rules/*.md` of the workspace and the config folder too.
fn memory(p: &Paths, r: &Reader) -> Vec<MemoryFile> {
    let mut out = vec![];
    let stat = |path: PathBuf, kind: &'static str, scope: &'static str, out: &mut Vec<MemoryFile>| {
        if forbidden(&path, r.config_dir) {
            return;
        }
        if let Ok(m) = fs::symlink_metadata(&path) {
            if m.is_file() {
                out.push(MemoryFile { path: shown(&path), kind, scope, bytes: m.len() });
            }
        }
    };
    stat(p.managed_dir.join("CLAUDE.md"), "CLAUDE.md", "managed", &mut out);
    stat(p.config_dir.join("CLAUDE.md"), "CLAUDE.md", "user", &mut out);
    let rules = |dir: PathBuf, scope: &'static str, root: Option<&Path>, out: &mut Vec<MemoryFile>| {
        for (n, f, t) in r.list(&dir, root) {
            if t.is_file() && n.to_lowercase().ends_with(".md") && out.len() < MAX_ROWS {
                stat(f, "rules", scope, out);
            }
        }
    };
    rules(p.config_dir.join("rules"), "user", None, &mut out);
    if let Some(ws) = &p.workspace {
        let mut chain: Vec<&Path> = ws.ancestors().take(12).collect();
        chain.reverse();
        for dir in chain {
            for (file, kind) in [("CLAUDE.md", "CLAUDE.md"), ("CLAUDE.local.md", "CLAUDE.local.md")] {
                stat(dir.join(file), kind, "project", &mut out);
            }
            if dir == ws.as_path() {
                stat(dir.join(".claude").join("CLAUDE.md"), "CLAUDE.md", "project", &mut out);
            }
        }
        rules(ws.join(".claude").join("rules"), "project", Some(ws), &mut out);
    }
    out
}

// ---- the summary ----

pub fn summarize(p: &Paths) -> ClaudeSetup {
    let r = Reader::new(&p.config_dir);
    let mut sources = vec![];
    let mut files = Files::default();
    let layers = load_layers(p, &r, &mut sources, &mut files);
    let model = layers.iter().find_map(|l| l.value.get("model").map(|v| SettingRow { key: "model".into(), value: display("model", v), scope: l.scope.into(), path: shown(&l.path), also: vec![] }));
    let (mcp_rows, mcp_flags) = mcp(p, &r, &layers, &mut files);
    let mut skills = vec![];
    let mut agents = vec![];
    if let Some(ws) = &p.workspace {
        entries(&r, &ws.join(".claude").join("skills"), "project", Some(ws), true, &mut skills);
        entries(&r, &ws.join(".claude").join("agents"), "project", Some(ws), false, &mut agents);
    }
    entries(&r, &p.config_dir.join("skills"), "user", None, true, &mut skills);
    entries(&r, &p.config_dir.join("agents"), "user", None, false, &mut agents);
    let plugin_rows = plugins(p, &r, &layers, &mut files);
    let memory = memory(p, &r);
    let setup = ClaudeSetup {
        config_dir: shown(&p.config_dir),
        managed_dir: shown(&p.managed_dir),
        workspace: p.workspace.as_ref().map(|w| shown(w)),
        sources,
        model,
        settings: rows_for(&layers),
        permissions: permissions(&layers),
        hooks: hooks(&layers),
        mcp: mcp_rows,
        mcp_flags,
        skills,
        agents,
        plugins: plugin_rows,
        memory,
        files,
        reads: r.log.borrow().clone(),
        notes: r.notes.borrow().clone(),
    };
    setup
}

/// The Claude tab: nothing is written and nothing is run. `workspace` must be inside the fence (a project or one of its worktrees).
#[tauri::command(async)]
pub fn claude_setup(workspace: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<ClaudeSetup, String> {
    let ws = match workspace.map(|w| w.trim().to_string()).filter(|w| !w.is_empty()) {
        Some(w) => Some(fence.allow(&w, &store, &git, false)?),
        None => None,
    };
    Ok(summarize(&Paths::from_env(ws)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-live-CANARY-9f3a";

    fn write(p: &Path, text: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    /// A temp tree: <t>/cfg (config dir), <t>/ws (workspace), <t>/managed. Never the real ~/.claude.
    fn tree(tag: &str) -> (PathBuf, Paths) {
        let t = std::env::temp_dir().join(format!("kolux-claude-setup-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        for d in ["cfg", "ws", "managed"] {
            fs::create_dir_all(t.join(d)).unwrap();
        }
        let p = Paths { config_dir: t.join("cfg"), global_json: t.join("cfg").join(".claude.json"), managed_dir: t.join("managed"), workspace: Some(t.join("ws")) };
        (t, p)
    }

    #[test]
    fn claude_json_keeps_only_mcp_and_env_values_never_leave() {
        let (t, p) = tree("global");
        write(
            &p.global_json,
            &format!(
                r#"{{"oauthAccount":{{"emailAddress":"owner-canary@example.com","organizationUuid":"org-canary"}},"userID":"user-canary-id","primaryApiKey":"{SECRET}","githubRepoPaths":{{"x":["/canary/path"]}},
                "mcpServers":{{"files":{{"command":"npx","args":["srv","--api-key","{SECRET}","TOKEN={SECRET}"],"env":{{"API_KEY":"{SECRET}"}}}},
                  "web":{{"type":"http","url":"https://h.example/mcp?key={SECRET}","headers":{{"Authorization":"Bearer {SECRET}"}}}}}},
                "projects":{{"{ws}":{{"mcpServers":{{"mine":{{"command":"node","env":{{"T":"{SECRET}"}}}}}},"disabledMcpServers":["web"],"history":[{{"display":"history-canary"}}],"lastCost":1}},
                  "{other}":{{"mcpServers":{{"theirs":{{"command":"other-canary"}}}}}}}}}}"#,
                ws = shown(p.workspace.as_ref().unwrap()),
                other = "C:/not/this/one"
            ),
        );
        let s = summarize(&p);
        let json = serde_json::to_string(&s).unwrap();
        for leak in ["owner-canary", "org-canary", "user-canary-id", SECRET, "/canary/path", "history-canary", "other-canary", "oauthAccount", "primaryApiKey"] {
            assert!(!json.contains(leak), "{leak} leaked: {json}");
        }
        let names: Vec<&str> = s.mcp.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["files", "web", "mine"]);
        let files = &s.mcp[0];
        assert_eq!(files.env[0].key, "API_KEY");
        assert_eq!(files.env[0].value, MASK);
        assert!(files.target.contains("--api-key") && files.target.contains(&format!("TOKEN={MASK}")));
        assert_eq!(s.mcp[1].headers[0].key, "Authorization");
        assert_eq!(s.mcp[1].target, format!("https://h.example/mcp?{MASK}"));
        assert!(s.mcp[1].off, "disabledMcpServers marks the server off");
        assert_eq!(s.mcp[2].scope, "local");
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn credentials_and_the_never_read_list_are_not_opened() {
        let (t, p) = tree("never");
        write(&p.config_dir.join(".credentials.json"), &format!(r#"{{"claudeAiOauth":{{"accessToken":"{SECRET}"}}}}"#));
        write(&p.config_dir.join("backups").join(".claude.json.backup.1"), &format!(r#"{{"mcpServers":{{"old":{{"command":"{SECRET}"}}}}}}"#));
        for f in ["history.jsonl", "projects/x/s.jsonl", "paste-cache/a.json", "file-history/a.json", "debug/a.json", "shell-snapshots/a.json", "session-env/a.json", "uploads/a.json"] {
            write(&p.config_dir.join(f), SECRET);
        }
        write(&p.workspace.as_ref().unwrap().join(".env"), SECRET);
        write(&p.workspace.as_ref().unwrap().join(".env.local"), SECRET);
        write(&p.config_dir.join("settings.json"), r#"{"model":"opus","apiKeyHelper":"C:/secret/helper.cmd"}"#);
        let s = summarize(&p);
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains(SECRET));
        for line in &s.reads {
            let l = line.to_lowercase();
            for bad in [".credentials", "/backups/", "history.jsonl", ".jsonl", "paste-cache", "file-history", "/debug/", "shell-snapshots", "session-env", "/uploads/", "/.env"] {
                assert!(!l.contains(bad), "opened {line}");
            }
        }
        assert!(s.reads.iter().any(|r| r.ends_with("/cfg/settings.json")), "{:?}", s.reads);
        // The guard itself refuses each, wherever it is asked from.
        let r = Reader::new(&p.config_dir);
        assert!(r.text(&p.config_dir.join(".credentials.json"), MAX_FILE, None, true).is_none());
        assert!(r.text(&p.config_dir.join("backups").join(".claude.json.backup.1"), MAX_FILE, None, true).is_none());
        assert!(r.text(&p.workspace.as_ref().unwrap().join(".env"), MAX_FILE, None, true).is_none());
        assert!(r.log.borrow().is_empty(), "the guard refused before opening: {:?}", r.log.borrow());
        // apiKeyHelper is shown as text and never run.
        assert_eq!(s.settings.iter().find(|x| x.key == "apiKeyHelper").unwrap().value, "C:/secret/helper.cmd");
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn a_backups_copy_of_claude_json_is_not_read() {
        let (t, p) = tree("backups");
        write(&p.global_json, r#"{"mcpServers":{"live":{"command":"a"}}}"#);
        write(&p.config_dir.join("backups").join(".claude.json.backup.1700000000"), r#"{"mcpServers":{"stale-canary":{"command":"b"}}}"#);
        let s = summarize(&p);
        assert_eq!(s.mcp.len(), 1);
        assert!(!serde_json::to_string(&s).unwrap().contains("stale-canary"));
        assert!(s.reads.iter().all(|r| !r.contains("/backups/") && !r.contains(".backup.")), "{:?}", s.reads);
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn settings_merge_by_precedence_and_show_their_scope() {
        let (t, p) = tree("merge");
        let ws = p.workspace.clone().unwrap();
        write(&p.config_dir.join("settings.json"), r#"{"model":"sonnet","theme":"dark","permissions":{"allow":["Bash(ls)"],"deny":["Read(./.env)"],"defaultMode":"default"},"enabledPlugins":{"a@m":true},"env":{"ANTHROPIC_API_KEY":"x-canary-env"},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo done"}]}]}}"#);
        write(&ws.join(".claude/settings.json"), r#"{"model":"opus","theme":"light","permissions":{"allow":["Bash(npm test)","Bash(ls)"]},"includeCoAuthoredBy":false}"#);
        write(&ws.join(".claude/settings.local.json"), r#"{"permissions":{"ask":["Bash(git push *)"],"defaultMode":"plan"},"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"check.sh"}]}]}}"#);
        write(&p.managed_dir.join("managed-settings.json"), r#"{"permissions":{"deny":["WebFetch"]}}"#);
        write(&p.managed_dir.join("managed-settings.d/10-extra.json"), r#"{"cleanupPeriodDays":7}"#);
        write(&p.managed_dir.join("managed-mcp.json"), r#"{"mcpServers":{"corp":{"type":"sse","url":"https://corp.example/sse?t=abc"}}}"#);
        let s = summarize(&p);
        let m = s.model.as_ref().unwrap();
        assert_eq!((m.value.as_str(), m.scope.as_str()), ("opus", "project"));
        let theme = s.settings.iter().find(|x| x.key == "theme").unwrap();
        assert_eq!((theme.value.as_str(), theme.scope.as_str(), theme.also.clone()), ("light", "project", vec!["user"]));
        assert!(theme.path.ends_with("ws/.claude/settings.json"));
        assert_eq!(s.settings.iter().find(|x| x.key == "cleanupPeriodDays").unwrap().scope, "managed");
        let env = s.settings.iter().find(|x| x.key == "env").unwrap();
        assert!(env.value.contains("ANTHROPIC_API_KEY") && !env.value.contains("x-canary-env"), "{}", env.value);
        let allow: Vec<_> = s.permissions.allow.iter().map(|r| (r.rule.as_str(), r.scope)).collect();
        assert_eq!(allow, [("Bash(npm test)", "project"), ("Bash(ls)", "project")]);
        assert_eq!(s.permissions.deny.iter().map(|r| r.scope).collect::<Vec<_>>(), ["managed", "user"]);
        assert_eq!(s.permissions.ask[0].scope, "local");
        assert_eq!(s.permissions.default_mode.as_ref().unwrap().value, "plan");
        let hooks: Vec<_> = s.hooks.iter().map(|h| (h.event.as_str(), h.command.as_str(), h.scope)).collect();
        assert_eq!(hooks, [("PreToolUse", "check.sh", "local"), ("Stop", "echo done", "user")]);
        assert_eq!(s.plugins[0].id, "a@m");
        assert_eq!(s.mcp[0].scope, "managed");
        assert_eq!(s.mcp[0].target, format!("https://corp.example/sse?{MASK}"));
        assert!(s.sources.iter().any(|x| x.scope == "managed" && x.state == "found" && x.label.starts_with("managed-settings.d/")));
        assert!(s.sources.iter().any(|x| x.label == "settings.json" && x.state == "found"));
        assert!(s.files.settings.len() >= 5);
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn the_config_folder_override_decides_where_user_files_are() {
        let (t, mut p) = tree("override");
        let other = t.join("account-b");
        write(&other.join("settings.json"), r#"{"model":"haiku"}"#);
        write(&p.config_dir.join("settings.json"), r#"{"model":"opus"}"#);
        p.config_dir = other.clone();
        p.global_json = other.join(".claude.json");
        let s = summarize(&p);
        assert_eq!(s.model.unwrap().value, "haiku");
        assert!(s.reads.iter().all(|r| !r.contains("/cfg/")), "{:?}", s.reads);
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn skills_agents_plugins_and_memory_are_listed() {
        let (t, p) = tree("lists");
        let ws = p.workspace.clone().unwrap();
        write(&p.config_dir.join("skills/alpha/SKILL.md"), "---\nname: alpha-skill\ndescription: >\n  Does the alpha thing\n  across two lines\n---\nbody");
        write(&ws.join(".claude/skills/beta/SKILL.md"), "---\ndescription: \"Beta one\"\n---\n");
        write(&p.config_dir.join("agents/rev.md"), "---\nname: reviewer\ndescription: Reviews code\n---\n");
        write(&ws.join(".claude/agents/b.md"), "no front matter");
        write(&p.config_dir.join("plugins/installed_plugins.json"), r#"{"version":2,"plugins":{"p@mk":[{"scope":"user","version":"1.2.3","installPath":"/x"}]}}"#);
        write(&p.config_dir.join("CLAUDE.md"), "user memory");
        write(&p.config_dir.join("rules/r.md"), "rule");
        write(&ws.join("CLAUDE.md"), "project memory");
        write(&ws.join("CLAUDE.local.md"), "private");
        write(&ws.join(".claude/rules/style.md"), "style");
        let s = summarize(&p);
        let sk: Vec<_> = s.skills.iter().map(|e| (e.name.as_str(), e.description.as_str(), e.scope)).collect();
        assert_eq!(sk, [("beta", "Beta one", "project"), ("alpha-skill", "Does the alpha thing across two lines", "user")]);
        let ag: Vec<_> = s.agents.iter().map(|e| (e.name.as_str(), e.scope)).collect();
        assert_eq!(ag, [("b", "project"), ("reviewer", "user")]);
        assert_eq!(s.plugins[0].version.as_deref(), Some("1.2.3"));
        assert!(!serde_json::to_string(&s).unwrap().contains("installPath"));
        let kinds: Vec<_> = s.memory.iter().map(|m| (m.kind, m.scope)).collect();
        assert!(kinds.contains(&("CLAUDE.md", "user")) && kinds.contains(&("CLAUDE.local.md", "project")) && kinds.contains(&("rules", "project")) && kinds.contains(&("rules", "user")), "{kinds:?}");
        // CLAUDE.md contents are never read, only sized.
        assert!(s.reads.iter().all(|r| !r.ends_with("CLAUDE.md") && !r.ends_with("style.md")), "{:?}", s.reads);
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn caps_and_bad_files_do_not_break_the_summary() {
        let (t, p) = tree("caps");
        write(&p.config_dir.join("settings.json"), &format!("{{\"model\":\"opus\",\"pad\":\"{}\"}}", "x".repeat(MAX_FILE as usize)));
        write(&p.workspace.clone().unwrap().join(".claude/settings.json"), "{ not json");
        let s = summarize(&p);
        assert!(s.model.is_none());
        assert!(s.notes.iter().any(|n| n.contains("bigger than")) && s.notes.iter().any(|n| n.contains("not a JSON object")), "{:?}", s.notes);
        assert!(s.sources.iter().any(|x| x.state == "invalid"));
        let _ = fs::remove_dir_all(t);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_the_workspace_is_skipped() {
        let (t, p) = tree("link");
        let ws = p.workspace.clone().unwrap();
        write(&t.join("outside.json"), r#"{"model":"leak-canary"}"#);
        fs::create_dir_all(ws.join(".claude")).unwrap();
        std::os::unix::fs::symlink(t.join("outside.json"), ws.join(".claude/settings.json")).unwrap();
        let s = summarize(&p);
        assert!(s.model.is_none());
        assert!(!serde_json::to_string(&s).unwrap().contains("leak-canary"));
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn masking_covers_urls_args_and_secret_keys() {
        assert_eq!(mask_url("https://u:pw@h.example/p?x=1#f"), format!("https://{MASK}@h.example/p?{MASK}"));
        assert_eq!(mask_url("https://h.example/p"), "https://h.example/p");
        let args: Vec<Value> = ["--token", "abc", "--name", "n", "Authorization: Bearer zzz"].iter().map(|s| Value::String(s.to_string())).collect();
        assert_eq!(mask_command("srv", &args), format!("srv --token {MASK} --name n Authorization: {MASK} {MASK}"));
        assert_eq!(display("apiToken", &Value::String("abc".into())), MASK);
        assert_eq!(display("apiKeyHelper", &Value::String("cmd".into())), "cmd");
        assert_eq!(front_matter("---\nname: 'x'\n---\n").0.as_deref(), Some("x"));
    }

    #[test]
    fn hooks_status_line_and_helper_are_masked_in_the_summary() {
        let (t, p) = tree("masked");
        let canaries = ["CANARY-ghp-1", "CANARY-url-key-0123456789", "CANARY-flag-2", "CANARY-obj-3", "CANARY-num-4", "CANARY-rule-5", "CANARY-aws-6", "CANARY-jwt-7", "CANARY-pw-8", "CANARY-bearer-9"];
        let c = |i: usize| canaries[i];
        write(
            &p.config_dir.join("settings.json"),
            &format!(
                r#"{{"hooks":{{"PreToolUse":[{{"matcher":"Bash","hooks":[
                    {{"type":"command","command":"curl -H 'Authorization: Bearer {b}' ghp_{g} --token {f}"}},
                    {{"type":"http","url":"https://hooks.example/{u}/fire?k=1"}},
                    {{"type":"prompt","prompt":"call https://user:{pw}@h.example/x with AKIA{aws}"}}]}}]}},
                  "statusLine":{{"type":"command","command":"node status.js --api-key {f} eyJhbGciOi.{j}.sig"}},
                  "apiKeyHelper":"get-key --password={pw}",
                  "myTokenConfig":{{"inner":"{o}"}},
                  "otherSecret":[1,"{o}"],
                  "tokenLimit":{n},
                  "permissions":{{"allow":["Bash(curl https://api.example/{u}/v1 -u admin:x)","Bash(echo ghp_{r})"]}}}}"#,
                b = c(9),
                g = c(0),
                u = c(1),
                f = c(2),
                o = c(3),
                n = 4444,
                r = c(5),
                aws = c(6),
                j = c(7),
                pw = c(8)
            ),
        );
        let s = summarize(&p);
        let json = serde_json::to_string(&s).unwrap();
        for leak in canaries {
            assert!(!json.contains(leak), "{leak} leaked: {json}");
        }
        assert!(!json.contains("4444"), "a number under a secret-looking key leaked: {json}");
        assert!(s.hooks.iter().any(|h| h.command.contains("hooks.example") && h.command.contains(MASK)), "{:?}", s.hooks.iter().map(|h| &h.command).collect::<Vec<_>>());
        let by = |k: &str| s.settings.iter().find(|r| r.key == k).unwrap_or_else(|| panic!("{k} missing")).value.clone();
        assert!(by("statusLine").contains("node status.js"), "benign words stay readable");
        assert_eq!(by("apiKeyHelper"), format!("get-key --password={MASK}"));
        assert_eq!(by("myTokenConfig"), MASK);
        assert_eq!(by("otherSecret"), MASK);
        assert_eq!(by("tokenLimit"), MASK);
        let _ = fs::remove_dir_all(t);
    }

    #[test]
    fn urls_hide_user_info_query_and_long_or_token_shaped_path_segments() {
        assert_eq!(mask_url("https://h.example/mcp/v1"), "https://h.example/mcp/v1");
        assert_eq!(mask_url("https://h.example/mcp/0123456789abcdef0123/x"), format!("https://h.example/mcp/{MASK}/x"));
        assert_eq!(mask_url("https://h.example/hooks/ghp_short"), format!("https://h.example/hooks/{MASK}"));
        assert_eq!(mask_url("https://u:p@h.example:8443/a"), format!("https://{MASK}@h.example:8443/a"));
        assert_eq!(mask_url("https://h.example/@scope/pkg"), "https://h.example/@scope/pkg");
    }

    #[test]
    fn words_with_known_token_prefixes_and_header_values_are_masked() {
        for t in ["ghp_abc", "gho_abc", "github_pat_abc", "xoxb-1-2", "AKIAIOSFODNN7EXAMPLE", "sk-ant-abc", "eyJhbGciOi.payload.sig"] {
            assert_eq!(mask_text(&format!("run {t} now")), format!("run {MASK} now"), "{t}");
            assert_eq!(mask_text(&format!("FOO={t}")), format!("FOO={}", MASK), "{t}");
        }
        assert_eq!(mask_text("curl -H Authorization: Bearer abc123 https://h.example"), format!("curl -H Authorization: {MASK} {MASK} {MASK}"));
        assert_eq!(mask_text("x Bearer abc y"), format!("x Bearer {MASK} y"));
        assert_eq!(mask_text("--url=https://u:p@h.example/a"), format!("--url=https://{MASK}@h.example/a"));
        assert_eq!(mask_text("ls -la /tmp"), "ls -la /tmp");
    }

    #[test]
    fn header_words_secret_flags_and_json_bodies_are_masked() {
        // each case: the secret that must not show. The canary is a neutral word, so nothing is caught by its name.
        const S: &str = "Hunter2xq";
        for line in [
            r#"curl -H "Authorization:Bearer Hunter2xq" https://h.example"#,
            r#"curl -H "X-Api-Key: Hunter2xq" h"#,
            r#"curl -H "X-Api-Key: Bearer Hunter2xq" h"#,
            "curl -H X-Api-Key: Bearer Hunter2xq h",
            r#"curl -H "Ocp-Apim-Subscription-Key: Hunter2xq" h"#,
            r#"curl -H "Cookie: sid=Hunter2xq" h"#,
            r#"curl -H "Cookie: a=1; sid=Hunter2xq" h"#,
            "curl -u bob:Hunter2xq h",
            "curl -ubob:Hunter2xq h",
            "curl --user=bob:Hunter2xq h",
            "Bash(curl https://h.example -u admin:Hunter2xq)",
            "tool --key Hunter2xq",
            "tool --key=Hunter2xq",
            "tool --auth=Hunter2xq",
            "tool --private-key Hunter2xq",
            "deploy --password=Hunter2xq:x",
            "API_TOKEN=Hunter2xq:abc",
            r#"curl -d '{"token":"Hunter2xq"}' h"#,
            r#"curl -d '{"key":"Hunter2xq"}' h"#,
            r#"curl -d '{"password": "Hunter2xq"}' h"#,
            r#"curl -d '{"Authorization":"Bearer Hunter2xq"}' h"#,
            "run hf_Hunter2xq",
            "run AIzaHunter2xq",
            "run ya29.Hunter2xq",
            "run sk_live_Hunter2xq",
            "pip install git+https://Hunter2xq@github.com/org/repo.git@main",
            "npm i https://Hunter2xq@registry.npmjs.org/@scope/pkg",
            "curl https://Hunter2xq@h.example/a?mail=x@y.com",
            "curl https://Hunter2xq@h.example/a#x@y",
            // the fourth review: `--flag=` forms, PowerShell tables, env names, quoted values, capitalised flags
            r#"wget --header="X-Api-Key: Hunter2xq" https://h.example"#,
            "wget --header=X-Api-Key:Hunter2xq https://h.example",
            r#"curl --data='{"pin":"Hunter2xq"}' https://h.example"#,
            r#"curl --data='{"pin": "x", "pw": "Hunter2xq"}' https://h.example"#,
            r#"Invoke-RestMethod -Headers @{Authorization="Bearer Hunter2xq"} -Uri https://h.example"#,
            "Invoke-RestMethod -Headers @{ 'X-Api-Key' = 'Hunter2xq' } -Uri https://h.example",
            "DB_PASS=Hunter2xq node s.js",
            "SIGNING_KEY=Hunter2xq node s.js",
            r#"$env:MY_KEY="Hunter2xq"; node s.js"#,
            r#"API_TOKEN="x Hunter2xq" node s.js"#,
            "Connect-Thing -Key Hunter2xq",
            "gpg --passphrase Hunter2xq -d f",
            "curl -bsid=Hunter2xq h",
            "curl -ubob:pa=Hunter2xq h",
            "curl --proxy-user bob:Hunter2xq h",
            r#"tool --password "a Hunter2xq""#,
            r#"$env:DB_PASSWORD = "Hunter2xq""#,
            "$token = 'Hunter2xq'",
            "(@{ key = 'Hunter2xq' } | ConvertTo-Json)",
            "$Env:MY_KEY=Hunter2xq node s.js",
            r#"curl -d "{\"user\": \"bob\", \"key\": \"Hunter2xq\"}" h"#,
        ] {
            let out = mask_text(line);
            assert!(!out.contains(S), "{line} -> {out}");
        }
        // an MCP arg that is itself a command line, and curl's -u carried from the command into the args
        for (cmd, args) in [("sh", vec!["-c", "npx srv --token Hunter2xq"]), ("sh", vec!["-c", "npx srv https://u:Hunter2xq@h.example"]), ("curl", vec!["-u", "bob:Hunter2xq", "https://h.example"]), ("srv", vec!["--password", "correct horse Hunter2xq"]), ("curl", vec!["-H", "Cookie: a=1; sid=Hunter2xq", "h"])] {
            let args: Vec<Value> = args.into_iter().map(Value::from).collect();
            let out = mask_command(cmd, &args);
            assert!(!out.contains(S), "{cmd} {args:?} -> {out}");
        }
        // a hook word built to recurse deep (`-=-=-=…`, up to the 1 MB file cap) cannot overflow the stack
        let deep = "-=".repeat(500_000);
        assert!(!mask_text(&deep).is_empty());
        // a new command after curl gets its own -u / -b back, and a table ends with its brace
        assert_eq!(mask_text("curl https://h.example && git checkout -b feature"), "curl https://h.example && git checkout -b feature");
        assert!(mask_text("pwsh -c @{ a = 1 } ; echo done").ends_with("; echo done"));
        assert!(!mask_text("run a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8").contains("a1b2c3d4e5f6"));
        // the password part of user-info holding a stray ? or / is gone too
        for line in ["open https://user:Hunter2xq?more@h.example/x", "open https://user:Hunter2xq/more@h.example/x"] {
            let out = mask_text(line);
            assert!(!out.contains(S) && !out.contains("more"), "{line} -> {out}");
        }
        // a JSON body or quoted header ends where its quote closes; later words stay readable
        assert!(mask_text(r#"curl -H "Cookie: a=1; sid=v" https://h.example/x"#).ends_with(" https://h.example/x"));
        // readable things stay readable
        assert_eq!(mask_text("Bash(npm token:*)"), "Bash(npm token:*)");
        assert_eq!(mask_text("node status.js --verbose"), "node status.js --verbose");
        for plain in ["pip install -U requests", "git push -u origin main", "python -u hook.py", "git checkout -b feature"] {
            assert_eq!(mask_text(plain), plain);
        }
        assert!(mask_text("open https://user:pw@h.example/x").ends_with("@h.example/x"));
        // an account id under its own key is masked
        assert_eq!(display("forceLoginOrgUUID", &Value::String("1234-abcd".into())), MASK);
    }

    #[test]
    fn a_malformed_project_entry_does_not_hide_the_good_ones() {
        let (t, p) = tree("lenient");
        let ws = shown(p.workspace.as_ref().unwrap());
        write(
            &p.global_json,
            &format!(
                r#"{{"mcpServers":{{"u":{{"command":"x"}}}},"projects":{{"C:/bad/null":{{"disabledMcpServers":null}},"C:/bad/type":{{"mcpServers":5,"enabledMcpServers":"nope","disabledMcpjsonServers":[1,"ok"]}},"C:/bad/entry":7,
                  "{ws}":{{"mcpServers":{{"mine":{{"command":"node"}}}},"disabledMcpServers":null,"enabledMcpServers":["a",3],"disabledMcpjsonServers":"nope","enabledMcpjsonServers":["b"]}}}}}}"#
            ),
        );
        let s = summarize(&p);
        let names: Vec<&str> = s.mcp.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["u", "mine"], "{:?}", s.notes);
        let flags: Vec<String> = s.mcp_flags.iter().map(|f| format!("{}:{}", f.list, f.name)).collect();
        assert_eq!(flags, ["enabledMcpServers:a", "enabledMcpjsonServers:b"]);
        let _ = fs::remove_dir_all(t);
    }
}
