//! Hermes and OpenClaw automations in the Automations list (T-193-b, AUTO-016's second half).
//! Both tools keep their own scheduled jobs; Kolux lists them beside its own, marks them `source`
//! "hermes" or "openclaw" and `local` (they run on this computer, not through Kolux's clock), and
//! forwards Run, Pause, Resume and Delete (and for Hermes, Create and Edit) to the tool's own
//! command line. Nothing here starts an agent or touches Kolux's own automations.
//!
//! Everything that reaches the tools goes through the [`Probe`] trait: the real one
//! ([`CliProbe`]) finds the program on the PATH, runs it under a time limit and at most two at a
//! time, and a tool that is missing, slow or failing becomes a `warning` row, never an error that
//! stops the Kolux list. The results are cached and read again only when the window asks
//! ([`refresh`]), and not at all while one of Kolux's own runs is starting.
//!
//! Formats (PROVENANCE §5): Hermes keeps its jobs in `<hermes home>/cron/jobs.json` and each run's
//! output in `<hermes home>/cron/output/<job id>/<time>.md`; OpenClaw answers
//! `openclaw cron list --json --all` through its Gateway. Both are parsed defensively: unknown
//! fields are ignored, a record that is not a job is skipped, and a file that is not readable is
//! an empty list with a warning.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Hermes,
    OpenClaw,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Run,
    Pause,
    Resume,
    Remove,
    Create,
    Edit,
}

/// Why a tool could not answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fail {
    /// The program is not on the PATH.
    Missing,
    /// It did not finish in time and was stopped.
    TimedOut,
    /// It ran and failed, or could not be started; the text says how.
    Failed(String),
}

/// What Kolux asks of the two tools. Tests stand in for it; the real one is [`CliProbe`].
pub trait Probe: Send + Sync {
    /// The tool's job list as text, for [`hermes_jobs`] or [`openclaw_jobs`].
    fn list(&self, tool: Tool) -> Result<String, Fail>;
    /// Run, Pause, Resume, Remove, Create or Edit one job (`id` is empty for Create); the tool's
    /// own words come back.
    fn act(&self, tool: Tool, action: Action, id: &str, input: &Value) -> Result<String, Fail>;
}

impl Tool {
    pub fn name(self) -> &'static str {
        match self {
            Tool::Hermes => "hermes",
            Tool::OpenClaw => "openclaw",
        }
    }
    fn shown(self) -> &'static str {
        match self {
            Tool::Hermes => "Hermes",
            Tool::OpenClaw => "OpenClaw",
        }
    }
    pub fn parse(s: &str) -> Option<Tool> {
        match s {
            "hermes" => Some(Tool::Hermes),
            "openclaw" => Some(Tool::OpenClaw),
            _ => None,
        }
    }
}

impl Action {
    pub fn parse(s: &str) -> Option<Action> {
        match s {
            "run" => Some(Action::Run),
            "pause" => Some(Action::Pause),
            "resume" => Some(Action::Resume),
            "delete" => Some(Action::Remove),
            "create" => Some(Action::Create),
            "edit" => Some(Action::Edit),
            _ => None,
        }
    }
    fn word(self) -> &'static str {
        match self {
            Action::Run => "run",
            Action::Pause => "pause",
            Action::Resume => "resume",
            Action::Remove => "delete",
            Action::Create => "create",
            Action::Edit => "edit",
        }
    }
}

/// What a row of this tool offers (the page hides the rest): Hermes can do all of it, OpenClaw
/// has no Edit and no Create here (AUTO-025).
pub fn actions_for(tool: Tool) -> Vec<&'static str> {
    match tool {
        Tool::Hermes => vec!["run", "edit", "delete", "create", "pause", "resume"],
        Tool::OpenClaw => vec!["run", "delete", "pause", "resume"],
    }
}

/// The result of reading a tool's list: the rows, a warning when the list could not be read, and
/// how many records were skipped as not being jobs.
#[derive(Debug, Default)]
pub struct Parsed {
    pub rows: Vec<Value>,
    pub warning: Option<String>,
    pub skipped: usize,
}

// ---------------------------------------------------------------- reading the lists

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

/// A time as milliseconds since 1970: an ISO-8601 string (a missing offset reads as UTC) or a
/// number of seconds or milliseconds.
fn when_ms(v: &Value) -> Option<i64> {
    match v {
        Value::String(s) => {
            let s = s.trim();
            s.parse::<jiff::Timestamp>()
                .map(|t| t.as_millisecond())
                .ok()
                .or_else(|| s.parse::<jiff::civil::DateTime>().ok().and_then(|d| d.to_zoned(jiff::tz::TimeZone::UTC).ok()).map(|z| z.timestamp().as_millisecond()))
        }
        Value::Number(n) => n.as_f64().map(|x| if x < 1e11 { (x * 1000.0) as i64 } else { x as i64 }),
        _ => None,
    }
}

/// A cron line in words, or None when the line is not one Kolux can read.
fn cron_words(line: &str, tz: &str) -> Option<String> {
    let said = crate::schedule::describe(line, tz);
    (said != "Timetable not readable").then_some(said)
}

struct Row<'a> {
    tool: Tool,
    job: &'a str,
    name: String,
    prompt: String,
    enabled: bool,
    cron: String,
    tz: String,
    timetable: String,
    next: Option<i64>,
    last_at: Option<i64>,
    last_status: Option<String>,
}

fn row(r: Row) -> Value {
    let tool = r.tool.name();
    // What the Edit dialog's timetable fields open with; a timetable Kolux cannot read as cron has none.
    let form = (!r.cron.is_empty()).then(|| {
        let (preset, time, day) = crate::schedule::classify(&r.cron).unwrap_or(("custom", String::new(), None));
        json!({ "preset": preset, "time": time, "day": day, "custom": if preset == "custom" { r.cron.clone() } else { String::new() } })
    });
    let mut v = json!({
        "id": format!("{tool}:{}", r.job),
        "jobId": r.job,
        "source": tool,
        "local": true,
        "name": r.name,
        "prompt": r.prompt,
        "provider": tool,
        "projectId": "",
        "enabled": r.enabled,
        "trigger": { "kind": "schedule", "cron": r.cron, "timezone": r.tz },
        "timetable": r.timetable,
        "nextRunAt": r.next,
        "lastRunAt": r.last_at,
        "lastStatus": r.last_status,
        "problem": Value::Null,
        "actions": actions_for(r.tool),
    });
    if let Some(form) = form {
        v["form"] = form;
    }
    v
}

fn named(name: Option<&str>, prompt: &str, id: &str) -> String {
    match name {
        Some(n) => n.to_string(),
        None if !prompt.is_empty() => prompt.lines().next().unwrap_or_default().chars().take(60).collect(),
        None => id.to_string(),
    }
}

fn job_id(rec: &Value, key: Option<&str>) -> Option<String> {
    let id = match rec.get("id") {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => key.unwrap_or_default().to_string(),
    };
    valid_id(&id).then_some(id)
}

/// Hermes' `jobs.json`: `{ "jobs": [...] }`, a bare list, or `{ "jobs": { id: job } }`.
pub fn hermes_jobs(text_in: &str) -> Parsed {
    let mut out = Parsed::default();
    if text_in.trim().is_empty() {
        return out;
    }
    let v: Value = match serde_json::from_str(text_in) {
        Ok(v) => v,
        Err(e) => {
            out.warning = Some(format!("Hermes' jobs file could not be read: {e}"));
            return out;
        }
    };
    let records: Vec<(Option<String>, Value)> = match &v {
        Value::Array(a) => a.iter().map(|x| (None, x.clone())).collect(),
        Value::Object(o) => match o.get("jobs") {
            Some(Value::Array(a)) => a.iter().map(|x| (None, x.clone())).collect(),
            Some(Value::Object(m)) => m.iter().map(|(k, x)| (Some(k.clone()), x.clone())).collect(),
            _ => Vec::new(),
        },
        _ => {
            out.warning = Some("Hermes' jobs file could not be read: it is not a list of jobs".into());
            return out;
        }
    };
    for (key, rec) in records {
        match hermes_row(key.as_deref(), &rec) {
            Some(r) => out.rows.push(r),
            None => out.skipped += 1,
        }
    }
    out
}

fn hermes_row(key: Option<&str>, rec: &Value) -> Option<Value> {
    if !rec.is_object() {
        return None;
    }
    let id = job_id(rec, key)?;
    let prompt = text(rec, "prompt").unwrap_or_default().to_string();
    let sched = rec.get("schedule").cloned().unwrap_or(Value::Null);
    let tz = text(rec, "timezone").or_else(|| text(&sched, "timezone")).or_else(|| text(&sched, "tz")).unwrap_or_default().to_string();
    // A schedule is a text ("0 9 * * *", "every 2h") or { kind, expr, display, ... }.
    let (cron, shown) = match &sched {
        Value::String(s) => (cron_words(s, &tz).map(|_| s.trim().to_string()).unwrap_or_default(), s.trim().to_string()),
        Value::Object(_) => {
            let expr = text(&sched, "expr").or_else(|| text(&sched, "cron")).unwrap_or_default();
            let display = text(&sched, "display").or_else(|| text(rec, "schedule_display")).unwrap_or(expr);
            if sched["kind"] == "cron" || (sched.get("kind").is_none() && cron_words(expr, &tz).is_some()) {
                (expr.to_string(), display.to_string())
            } else {
                (String::new(), display.to_string())
            }
        }
        _ => (String::new(), text(rec, "schedule_display").unwrap_or_default().to_string()),
    };
    let timetable = if cron.is_empty() { shown } else { cron_words(&cron, &tz).unwrap_or(shown) };
    let paused = rec["enabled"] == false || rec["state"] == "paused";
    let mut v = row(Row {
        tool: Tool::Hermes,
        job: &id,
        name: named(text(rec, "name"), &prompt, &id),
        prompt,
        enabled: !paused,
        cron,
        tz,
        timetable,
        next: rec.get("next_run_at").and_then(when_ms),
        last_at: rec.get("last_run_at").and_then(when_ms),
        last_status: text(rec, "last_status").map(str::to_string),
    });
    v["workspace"] = text(rec, "workdir").map_or(Value::Null, |w| json!(w));
    v["workspaceMode"] = json!("existing");
    if let Some(why) = text(rec, "paused_reason") {
        v["pausedReason"] = json!(why);
    }
    Some(v)
}

/// `openclaw cron list --json --all`: `{ ok, jobs: [...] }` or a bare list, or `{ ok: false, error }`.
pub fn openclaw_jobs(text_in: &str) -> Parsed {
    let mut out = Parsed::default();
    if text_in.trim().is_empty() {
        return out;
    }
    let v: Value = match serde_json::from_str(text_in.trim()) {
        Ok(v) => v,
        Err(e) => {
            out.warning = Some(format!("OpenClaw's list could not be read: {e}"));
            return out;
        }
    };
    if v["ok"] == false {
        let why = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).unwrap_or("it gave no reason");
        out.warning = Some(format!("OpenClaw could not list its automations: {}", why.lines().next().unwrap_or(why).trim()));
        return out;
    }
    let jobs = match &v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("jobs").or_else(|| o.get("automations")) {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        },
        _ => {
            out.warning = Some("OpenClaw's list could not be read: it is not a list of automations".into());
            return out;
        }
    };
    for rec in jobs {
        match openclaw_row(&rec) {
            Some(r) => out.rows.push(r),
            None => out.skipped += 1,
        }
    }
    out
}

fn every_words(ms: u64) -> String {
    let min = ms / 60_000;
    match min {
        0 => "Every minute".into(),
        1 => "Every minute".into(),
        60 => "Every hour".into(),
        m if m < 60 => format!("Every {m} minutes"),
        m if m % 1440 == 0 => format!("Every {} days", m / 1440),
        m if m % 60 == 0 => format!("Every {} hours", m / 60),
        m => format!("Every {m} minutes"),
    }
}

fn openclaw_row(rec: &Value) -> Option<Value> {
    if !rec.is_object() {
        return None;
    }
    let id = job_id(rec, None)?;
    let prompt = text(&rec["payload"], "message").or_else(|| text(&rec["payload"], "text")).or_else(|| text(rec, "description")).unwrap_or_default().to_string();
    let sched = &rec["schedule"];
    let tz = text(sched, "tz").unwrap_or_default().to_string();
    let (cron, timetable) = match text(sched, "kind") {
        Some("cron") => {
            let expr = text(sched, "expr").unwrap_or_default();
            (expr.to_string(), cron_words(expr, &tz).unwrap_or_else(|| format!("Custom: {expr}")))
        }
        Some("every") => (String::new(), sched["everyMs"].as_u64().map(every_words).unwrap_or_else(|| "Repeats".into())),
        Some("at") => (String::new(), format!("Once on {}", text(sched, "at").unwrap_or("a set time"))),
        _ => (String::new(), String::new()),
    };
    let state = &rec["state"];
    let disabled = rec["enabled"] == false || rec["status"] == "disabled";
    let mut v = row(Row {
        tool: Tool::OpenClaw,
        job: &id,
        name: named(text(rec, "name"), &prompt, &id),
        prompt,
        enabled: !disabled,
        cron,
        tz,
        timetable,
        next: state["nextRunAtMs"].as_i64(),
        last_at: state["lastRunAtMs"].as_i64(),
        last_status: text(state, "lastRunStatus").map(str::to_string),
    });
    v["running"] = json!(state.get("runningAtMs").is_some_and(|x| !x.is_null()) || rec["status"] == "running");
    if let Some(a) = text(rec, "effectiveAgentId").or_else(|| text(rec, "agentId")) {
        v["agent"] = json!(a);
    }
    Some(v)
}

fn warning_row(tool: Tool, why: &str) -> Value {
    json!({
        "id": format!("{}:warning", tool.name()),
        "kind": "warning",
        "source": tool.name(),
        "local": true,
        "name": tool.shown(),
        "prompt": "",
        "provider": tool.name(),
        "projectId": "",
        "enabled": false,
        "warning": why,
        "actions": [],
    })
}

// ---------------------------------------------------------------- Hermes' run output

/// One run document split on its `## ` headings: `(title, body)`. Text before the first heading
/// is a section with an empty title; a heading inside a code fence is not one.
pub fn split_sections(doc: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut title = String::new();
    let mut body: Vec<&str> = Vec::new();
    let mut fence = false;
    let mut started = false;
    fn flush(title: &mut String, body: &mut Vec<&str>, started: bool, out: &mut Vec<(String, String)>) {
        let text = body.join("\n").trim().to_string();
        if started || !text.is_empty() {
            out.push((std::mem::take(title), text));
        }
        body.clear();
    }
    for line in doc.lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        }
        if !fence && line.starts_with("## ") {
            flush(&mut title, &mut body, started, &mut out);
            title = line[3..].trim().to_string();
            started = true;
        } else {
            body.push(line);
        }
    }
    flush(&mut title, &mut body, started, &mut out);
    out
}

/// The newest `limit` runs of one Hermes job, read only from `<home>/cron/output/<job id>/`
/// (the path is checked to stay inside that folder, links included), each split into sections.
pub fn hermes_history(home: &Path, job_id: &str, limit: usize) -> Result<Value, String> {
    if !valid_id(job_id) {
        return Err("that is not a Hermes job id".into());
    }
    let none = || Ok(json!({ "runs": [] }));
    let root = match home.join("cron").join("output").canonicalize() {
        Ok(p) => p,
        Err(_) => return none(),
    };
    let dir = match root.join(job_id).canonicalize() {
        Ok(p) => p,
        Err(_) => return none(),
    };
    if dir == root || !dir.starts_with(&root) {
        return Err("that run folder is outside Hermes' output folder".into());
    }
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("the run folder could not be read: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("md")))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort_by(|a, b| b.cmp(a));
    let mut runs = Vec::new();
    for name in names.into_iter().take(limit) {
        let Ok(path) = dir.join(&name).canonicalize() else { continue };
        if path.parent() != Some(dir.as_path()) || !path.is_file() {
            continue;
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        if std::fs::File::open(&path).and_then(|f| f.take(MAX_RUN_FILE).read_to_end(&mut bytes)).is_err() {
            continue;
        }
        let sections: Vec<Value> = split_sections(&String::from_utf8_lossy(&bytes)).into_iter().map(|(t, b)| json!({ "title": t, "body": b })).collect();
        runs.push(json!({ "file": name, "sections": sections }));
    }
    Ok(json!({ "runs": runs }))
}

/// A run document is read up to this many bytes.
const MAX_RUN_FILE: u64 = 256 * 1024;
/// A jobs file bigger than this is not read.
const MAX_JOBS_FILE: u64 = 8 * 1024 * 1024;

// ---------------------------------------------------------------- the commands

/// A job id is plain: letters, digits, dot, dash, underscore; it cannot start with a dash (an
/// option) or be a dot-only name (a folder step).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && !id.starts_with('-') && id != "." && id != ".." && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// The arguments for one action, after the program name. Refuses what the tool's rows do not
/// offer, a job id that is not plain, and a create or edit with nothing to say.
pub fn command(tool: Tool, action: Action, id: &str, input: &Value) -> Result<Vec<String>, String> {
    if !actions_for(tool).contains(&action.word()) {
        return Err(format!("{} does not offer {} here", tool.shown(), action.word()));
    }
    if action == Action::Create {
        if !id.is_empty() {
            return Err("a new job has no id yet".into());
        }
    } else if !valid_id(id) {
        return Err("that is not a job id".into());
    }
    let word = |k: &str| text(input, k).map(str::to_string);
    let mut args: Vec<String> = vec!["cron".into()];
    match (tool, action) {
        (Tool::Hermes, Action::Pause) => args.extend(["pause".into(), id.into()]),
        (Tool::Hermes, Action::Resume) => args.extend(["resume".into(), id.into()]),
        (Tool::Hermes, Action::Run) => args.extend(["run".into(), id.into()]),
        (Tool::Hermes, Action::Remove) => args.extend(["remove".into(), id.into()]),
        (Tool::OpenClaw, Action::Pause) => args.extend(["disable".into(), id.into()]),
        (Tool::OpenClaw, Action::Resume) => args.extend(["enable".into(), id.into()]),
        (Tool::OpenClaw, Action::Run) => args.extend(["run".into(), id.into()]),
        (Tool::OpenClaw, Action::Remove) => args.extend(["rm".into(), id.into()]),
        (Tool::Hermes, Action::Create) => {
            let schedule = word("schedule").ok_or("a Hermes job needs a cron timetable")?;
            let prompt = word("prompt").ok_or("a Hermes job needs a prompt")?;
            args.push("create".into());
            if let Some(n) = word("name") {
                args.push(format!("--name={n}"));
            }
            if let Some(w) = word("workspace") {
                args.push(format!("--workdir={w}"));
            }
            // `--` so a prompt that starts with a dash is still the prompt.
            args.extend(["--".into(), schedule, prompt]);
        }
        (Tool::Hermes, Action::Edit) => {
            // Only what the caller names is changed: a field that is not in `input` gets no flag, so
            // an edit of the name alone can never touch the schedule (a schedule Kolux cannot show,
            // like "every 120m", is never sent back).
            args.push("edit".into());
            let before = args.len();
            if let Some(s) = word("schedule") {
                if s.split_whitespace().count() != 5 || cron_words(&s, "UTC").is_none() {
                    return Err("a Hermes timetable is a five-field cron line".into());
                }
                args.push(format!("--schedule={s}"));
            }
            for (flag, key) in [("--prompt=", "prompt"), ("--name=", "name")] {
                if let Some(v) = word(key) {
                    args.push(format!("{flag}{v}"));
                }
            }
            if args.len() == before {
                return Err("there is nothing to change".into());
            }
            args.push(id.into());
        }
        _ => return Err(format!("{} does not offer {} here", tool.shown(), action.word())),
    }
    Ok(args)
}

// ---------------------------------------------------------------- the real probe

/// The program on a PATH string. On Windows each PATHEXT suffix is tried in order (so npm's
/// extensionless shell shim is never taken over its `.cmd`); elsewhere the file must be executable.
/// Entries that are empty or not absolute are skipped.
pub fn find_on_path(program: &str, path: &std::ffi::OsStr, pathext: Option<&str>) -> Option<PathBuf> {
    for dir in std::env::split_paths(path) {
        // An empty or relative entry means the current folder, where anything could be planted.
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            continue;
        }
        if cfg!(windows) {
            for ext in pathext.unwrap_or(".COM;.EXE;.BAT;.CMD").split(';').filter(|e| !e.is_empty()) {
                let p = dir.join(format!("{program}{ext}"));
                if p.is_file() {
                    return Some(p);
                }
            }
        } else {
            let p = dir.join(program);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0) {
                    return Some(p);
                }
            }
            #[cfg(not(unix))]
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// At most N holders at a time.
pub struct Gate {
    free: Mutex<usize>,
    freed: std::sync::Condvar,
}

impl Gate {
    pub fn new(n: usize) -> Gate {
        Gate { free: Mutex::new(n.max(1)), freed: std::sync::Condvar::new() }
    }
    pub fn enter(&self) -> GateGuard<'_> {
        let mut free = self.free.lock().unwrap_or_else(|e| e.into_inner());
        while *free == 0 {
            free = self.freed.wait(free).unwrap_or_else(|e| e.into_inner());
        }
        *free -= 1;
        GateGuard(self)
    }
}

pub struct GateGuard<'a>(&'a Gate);

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        *self.0.free.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        self.0.freed.notify_one();
    }
}

/// What a finished program said.
struct Said {
    code: i32,
    out: String,
    err: String,
}

/// Runs the program with no window and no input, and stops it (and what it started) when it has
/// not finished by `limit`. A program that exits but leaves a helper holding its output open is
/// still answered, with what was read in time.
fn capture(program: &Path, args: &[String], limit: Duration) -> Result<Said, Fail> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut c = Command::new(program);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = c.spawn().map_err(|e| Fail::Failed(format!("could not start {}: {e}", program.display())))?;
    let (tx, rx) = std::sync::mpsc::channel::<(bool, Vec<u8>)>();
    if let Some(o) = child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = o.take(OUTPUT_CAP).read_to_end(&mut b);
            let _ = tx.send((true, b));
        });
    }
    if let Some(e) = child.stderr.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = e.take(OUTPUT_CAP).read_to_end(&mut b);
            let _ = tx.send((false, b));
        });
    }
    drop(tx);
    let began = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {}
            Err(e) => return Err(Fail::Failed(e.to_string())),
        }
        if began.elapsed() >= limit {
            stop(&mut child);
            return Err(Fail::TimedOut);
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let (mut out, mut err) = (String::new(), String::new());
    for _ in 0..2 {
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok((true, b)) => out = String::from_utf8_lossy(&b).into_owned(),
            Ok((false, b)) => err = String::from_utf8_lossy(&b).into_owned(),
            Err(_) => break,
        }
    }
    Ok(Said { code: status.code().unwrap_or(-1), out, err })
}

/// Each side of a program's output is read up to this many bytes.
const OUTPUT_CAP: u64 = 4 * 1024 * 1024;

fn stop(child: &mut std::process::Child) {
    #[cfg(windows)]
    crate::procs::kill_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

/// Where Hermes keeps its files: `HERMES_HOME`, else the first of `%LOCALAPPDATA%\hermes` (where
/// it installs on Windows) and `~/.hermes` that exists, else the first of those.
pub fn default_home() -> PathBuf {
    if let Some(h) = std::env::var_os("HERMES_HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(h);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(l).join("hermes"));
        }
    }
    if let Some(h) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        candidates.push(PathBuf::from(h).join(".hermes"));
    }
    candidates.iter().find(|p| p.is_dir()).or(candidates.first()).cloned().unwrap_or_else(|| PathBuf::from(".hermes"))
}

/// Reads the two tools for real.
pub struct CliProbe {
    pub gate: Gate,
    pub list_limit: Duration,
    pub act_limit: Duration,
    /// The search path; `None` is the process's own PATH.
    pub path: Option<std::ffi::OsString>,
    /// Hermes' home folder; `None` works it out from the environment.
    pub hermes_home: Option<PathBuf>,
}

impl Default for CliProbe {
    fn default() -> Self {
        CliProbe::new()
    }
}

impl CliProbe {
    /// Two programs at a time, 15 seconds to list and 30 to act.
    pub fn new() -> CliProbe {
        CliProbe { gate: Gate::new(2), list_limit: Duration::from_secs(15), act_limit: Duration::from_secs(30), path: None, hermes_home: None }
    }

    fn program(&self, tool: Tool) -> Result<PathBuf, Fail> {
        let path = self.path.clone().or_else(|| std::env::var_os("PATH")).unwrap_or_default();
        find_on_path(tool.name(), &path, std::env::var("PATHEXT").ok().as_deref()).ok_or(Fail::Missing)
    }
}

fn brief(s: &str) -> String {
    let line = s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("it gave no reason");
    line.chars().take(300).collect()
}

impl Probe for CliProbe {
    fn list(&self, tool: Tool) -> Result<String, Fail> {
        let program = self.program(tool)?;
        let _turn = self.gate.enter();
        match tool {
            Tool::Hermes => {
                let file = self.hermes_home.clone().unwrap_or_else(default_home).join("cron").join("jobs.json");
                use std::io::Read;
                let sad = |e: std::io::Error| Fail::Failed(format!("{} could not be read: {e}", file.display()));
                let f = match std::fs::File::open(&file) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
                    other => other.map_err(sad)?,
                };
                // One more byte than the cap tells "exactly the cap" from "over it" without a second look at the file.
                let mut bytes = Vec::new();
                f.take(MAX_JOBS_FILE + 1).read_to_end(&mut bytes).map_err(sad)?;
                if bytes.len() as u64 > MAX_JOBS_FILE {
                    return Err(Fail::Failed("its jobs file is too big to read".into()));
                }
                String::from_utf8(bytes).map_err(|e| sad(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
            }
            Tool::OpenClaw => {
                let said = capture(&program, &["cron".into(), "list".into(), "--all".into(), "--json".into()], self.list_limit)?;
                // A refusal (no Gateway sign-in, say) comes as JSON on the output with a non-zero exit.
                if !said.out.trim().is_empty() || said.code == 0 {
                    Ok(said.out)
                } else {
                    Err(Fail::Failed(brief(&said.err)))
                }
            }
        }
    }

    fn act(&self, tool: Tool, action: Action, id: &str, input: &Value) -> Result<String, Fail> {
        let program = self.program(tool)?;
        let args = command(tool, action, id, input).map_err(Fail::Failed)?;
        let _turn = self.gate.enter();
        let said = capture(&program, &args, self.act_limit)?;
        if said.code == 0 {
            Ok(said.out.trim().to_string())
        } else {
            Err(Fail::Failed(brief(if said.err.trim().is_empty() { &said.out } else { &said.err })))
        }
    }
}

// ---------------------------------------------------------------- the list

/// The last list read, kept until the window asks again.
pub struct Cache(Mutex<Vec<Value>>);

impl Cache {
    pub const fn new() -> Cache {
        Cache(Mutex::new(Vec::new()))
    }
    pub fn rows(&self) -> Vec<Value> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn put(&self, rows: Vec<Value>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = rows;
    }
}

impl Default for Cache {
    fn default() -> Self {
        Cache::new()
    }
}

/// The cache the Automations page reads.
pub static CACHE: Cache = Cache::new();

fn read_tool(probe: &dyn Probe, tool: Tool) -> Vec<Value> {
    let name = tool.name();
    match probe.list(tool) {
        Ok(text) => {
            let parsed = match tool {
                Tool::Hermes => hermes_jobs(&text),
                Tool::OpenClaw => openclaw_jobs(&text),
            };
            let mut rows = parsed.rows;
            if let Some(w) = parsed.warning {
                rows.insert(0, warning_row(tool, &w));
            }
            rows
        }
        Err(Fail::Missing) => vec![warning_row(tool, &format!("{name} was not found on the PATH"))],
        Err(Fail::TimedOut) => vec![warning_row(tool, &format!("{name} did not answer in time"))],
        Err(Fail::Failed(e)) => vec![warning_row(tool, &format!("{name} failed: {e}"))],
    }
}

/// Reads both tools (at the same time, each under its limit) into `cache`, unless `busy`: then the
/// cached rows come back untouched with `held` true. Returns `{ rows, held }`.
pub fn refresh(probe: &dyn Probe, cache: &Cache, busy: bool) -> Value {
    if busy {
        return json!({ "rows": cache.rows(), "held": true });
    }
    let rows: Vec<Value> = std::thread::scope(|s| {
        let both = [Tool::Hermes, Tool::OpenClaw].map(|t| s.spawn(move || read_tool(probe, t)));
        both.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    cache.put(rows.clone());
    json!({ "rows": rows, "held": false })
}

/// Whether one of Kolux's own runs is starting; the probes wait for it to settle.
pub fn kolux_busy(runs: &[Value]) -> bool {
    runs.iter().any(|r| ["pending", "dispatching"].contains(&r["status"].as_str().unwrap_or_default()))
}

fn fail_words(tool: Tool, f: Fail) -> String {
    match f {
        Fail::Missing => format!("{} was not found on the PATH", tool.name()),
        Fail::TimedOut => format!("{} did not finish in time", tool.name()),
        Fail::Failed(e) => e,
    }
}

/// Forwards one action to the tool and says what it said.
pub fn act(probe: &dyn Probe, tool: &str, action: &str, id: &str, input: &Value) -> Result<String, String> {
    let t = Tool::parse(tool).ok_or_else(|| format!("{tool} is not a tool Kolux lists"))?;
    let a = Action::parse(action).ok_or_else(|| format!("{action} is not an action"))?;
    command(t, a, id, input)?;
    probe.act(t, a, id, input).map_err(|f| fail_words(t, f))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real output captured on this PC (evidence/T-193-b): neither tool had a job, and OpenClaw's
    // Gateway wanted credentials.
    const HERMES_EMPTY: &str = include_str!("../../../evidence/T-193-b/hermes-cron-list-empty.txt");
    const OPENCLAW_NO_GATEWAY: &str = include_str!("../../../evidence/T-193-b/openclaw-cron-list-no-gateway.json");

    // Shapes written from the tools' public documentation (no job existed to capture).
    const HERMES_JOBS: &str = r#"{
      "jobs": [
        { "id": "a1b2c3d4e5f6", "name": "Morning digest", "prompt": "Summarise my inbox", "enabled": true, "state": "scheduled",
          "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "display": "0 9 * * 1-5" },
          "timezone": "UTC", "workdir": "C:\\work\\notes", "next_run_at": "2026-11-02T09:00:00+00:00",
          "last_run_at": "2026-10-30T09:00:03+00:00", "last_status": "ok", "deliver": "local", "future_field": 1 },
        { "id": "f00dfeed0001", "prompt": "Check disk space every two hours please, and tell me", "enabled": false, "state": "paused",
          "paused_reason": "I was away", "schedule": { "kind": "interval", "minutes": 120, "display": "every 120m" } },
        "not a job",
        { "name": "no id here" }
      ]
    }"#;
    const OPENCLAW_JOBS: &str = r#"{
      "ok": true,
      "jobs": [
        { "id": "job-1", "name": "Nightly triage", "enabled": true, "status": "idle", "agentId": "main", "effectiveAgentId": "main",
          "schedule": { "kind": "cron", "expr": "30 2 * * *", "tz": "America/Los_Angeles" },
          "payload": { "kind": "agentTurn", "message": "Triage the new issues" },
          "state": { "nextRunAtMs": 1793586600000, "lastRunAtMs": 1793500200000, "lastRunStatus": "ok" } },
        { "id": "job-2", "name": "Paused one", "enabled": false, "status": "disabled", "schedule": { "kind": "every", "everyMs": 3600000 },
          "payload": { "kind": "systemEvent", "text": "tick" }, "state": {} },
        { "id": "job-3", "name": "Busy one", "enabled": true, "status": "running", "schedule": { "kind": "at", "at": "2026-11-05T10:00:00Z" },
          "state": { "runningAtMs": 1793500300000 } },
        42
      ]
    }"#;

    #[test]
    fn a_hermes_row_carries_the_form_its_edit_dialog_opens_on() {
        let one = |sched: Value| hermes_jobs(&json!({ "jobs": [{ "id": "j1", "name": "N", "prompt": "p", "schedule": sched }] }).to_string()).rows.remove(0);
        let every30 = one(json!({ "kind": "cron", "expr": "*/30 * * * *", "display": "*/30 * * * *" }));
        assert_eq!(every30["form"], json!({ "preset": "custom", "time": "", "day": null, "custom": "*/30 * * * *" }), "a cron line the presets cannot say opens in Custom");
        assert_eq!(one(json!("0 8 * * 1"))["form"], json!({ "preset": "weekly", "time": "08:00", "day": 1, "custom": "" }));
        let interval = one(json!({ "kind": "interval", "minutes": 120, "display": "every 120m" }));
        assert!(interval.get("form").is_none(), "a timetable that is not cron has no form to open on");
        assert_eq!(interval["trigger"]["cron"], "");
        assert_eq!(interval["timetable"], "every 120m", "it is shown as text instead");
    }

    #[test]
    fn hermes_rows_carry_source_local_and_the_hermes_action_set() {
        let p = hermes_jobs(HERMES_JOBS);
        assert_eq!(p.warning, None);
        assert_eq!(p.skipped, 2, "a string and a record without an id are skipped");
        assert_eq!(p.rows.len(), 2);
        let a = &p.rows[0];
        assert_eq!(a["id"], "hermes:a1b2c3d4e5f6");
        assert_eq!(a["jobId"], "a1b2c3d4e5f6");
        assert_eq!(a["source"], "hermes");
        assert_eq!(a["local"], true);
        assert_eq!(a["name"], "Morning digest");
        assert_eq!(a["prompt"], "Summarise my inbox");
        assert_eq!(a["enabled"], true);
        assert_eq!(a["trigger"]["kind"], "schedule");
        assert_eq!(a["trigger"]["cron"], "0 9 * * 1-5");
        assert_eq!(a["timetable"], "Monday to Friday at 09:00 (UTC)");
        assert_eq!(a["nextRunAt"], 1793610000000i64);
        assert_eq!(a["lastStatus"], "ok");
        assert_eq!(a["workspace"], "C:\\work\\notes");
        assert_eq!(a["actions"], json!(["run", "edit", "delete", "create", "pause", "resume"]));
        assert_eq!(a["form"], json!({ "preset": "weekdays", "time": "09:00", "day": null, "custom": "" }), "the Edit dialog opens on the job's real timetable");
    }

    #[test]
    fn a_paused_hermes_job_reads_as_paused_with_its_reason_and_an_interval_in_words() {
        let b = &hermes_jobs(HERMES_JOBS).rows[1];
        assert_eq!(b["enabled"], false);
        assert_eq!(b["pausedReason"], "I was away");
        assert_eq!(b["timetable"], "every 120m");
        assert_eq!(b["name"], "Check disk space every two hours please, and tell me", "no name: the prompt names it");
        assert_eq!(b["nextRunAt"], Value::Null);
    }

    #[test]
    fn hermes_accepts_a_bare_list_and_an_id_keyed_map() {
        assert_eq!(hermes_jobs(r#"[{"id":"x1","prompt":"p"}]"#).rows.len(), 1);
        let m = hermes_jobs(r#"{"jobs":{"k1":{"prompt":"p"},"k2":{"id":"own","prompt":"q"}}}"#);
        let ids: Vec<&str> = m.rows.iter().map(|r| r["jobId"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["k1", "own"]);
    }

    #[test]
    fn a_bad_hermes_file_is_an_empty_list_with_a_warning() {
        let p = hermes_jobs("{ not json");
        assert!(p.rows.is_empty());
        assert!(p.warning.unwrap().starts_with("Hermes' jobs file could not be read"));
        let q = hermes_jobs("42");
        assert!(q.rows.is_empty() && q.warning.is_some());
        let e = hermes_jobs("");
        assert!(e.rows.is_empty() && e.warning.is_none(), "an empty file is no jobs");
    }

    #[test]
    fn hermes_cli_text_for_no_jobs_is_a_warning_not_a_job() {
        // The real `hermes cron list` prints prose; that is not jobs.json, and says nothing is wrong.
        assert!(HERMES_EMPTY.contains("No scheduled jobs"));
        assert!(hermes_jobs(HERMES_EMPTY).rows.is_empty());
    }

    #[test]
    fn openclaw_rows_carry_source_local_and_no_edit() {
        let p = openclaw_jobs(OPENCLAW_JOBS);
        assert_eq!(p.warning, None);
        assert_eq!(p.skipped, 1);
        assert_eq!(p.rows.len(), 3);
        let a = &p.rows[0];
        assert_eq!(a["id"], "openclaw:job-1");
        assert_eq!(a["source"], "openclaw");
        assert_eq!(a["local"], true);
        assert_eq!(a["prompt"], "Triage the new issues");
        assert_eq!(a["trigger"]["cron"], "30 2 * * *");
        assert_eq!(a["trigger"]["timezone"], "America/Los_Angeles");
        assert_eq!(a["timetable"], "Every day at 02:30 (America/Los_Angeles)");
        assert_eq!(a["nextRunAt"], 1793586600000i64);
        assert_eq!(a["lastStatus"], "ok");
        assert_eq!(a["agent"], "main");
        assert_eq!(a["actions"], json!(["run", "delete", "pause", "resume"]));
        assert!(!a["actions"].as_array().unwrap().iter().any(|x| x == "edit"));
    }

    #[test]
    fn openclaw_paused_and_running_jobs_are_told_apart() {
        let p = openclaw_jobs(OPENCLAW_JOBS);
        assert_eq!(p.rows[1]["enabled"], false);
        assert_eq!(p.rows[1]["timetable"], "Every hour");
        assert_eq!(p.rows[1]["prompt"], "tick");
        assert_eq!(p.rows[2]["enabled"], true);
        assert_eq!(p.rows[2]["running"], true);
        assert_eq!(p.rows[2]["timetable"], "Once on 2026-11-05T10:00:00Z");
        assert_eq!(p.rows[0]["running"], false);
    }

    #[test]
    fn the_real_openclaw_answer_without_gateway_credentials_is_a_warning() {
        let p = openclaw_jobs(OPENCLAW_NO_GATEWAY);
        assert!(p.rows.is_empty());
        let w = p.warning.unwrap();
        assert!(w.starts_with("OpenClaw could not list its automations: gateway cron.list requires credentials"), "{w}");
        assert!(!w.contains('\n'), "one line");
    }

    #[test]
    fn openclaw_accepts_a_bare_list_and_survives_garbage() {
        assert_eq!(openclaw_jobs(r#"[{"id":"j","name":"n"}]"#).rows.len(), 1);
        let p = openclaw_jobs("<html>");
        assert!(p.rows.is_empty() && p.warning.unwrap().starts_with("OpenClaw's list could not be read"));
        assert!(openclaw_jobs(r#"{"ok":true,"jobs":[]}"#).warning.is_none());
    }

    #[test]
    fn a_run_document_splits_on_its_headings_but_not_inside_a_code_fence() {
        let doc = "# Cron Job: Morning digest\n\n**Job ID:** a1\n\n## Prompt\n\nSummarise\n\n## Response\n\nDone.\n```\n## not a heading\n```\nEnd\n";
        let s = split_sections(doc);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].0, "");
        assert!(s[0].1.contains("Job ID"));
        assert_eq!(s[1], ("Prompt".to_string(), "Summarise".to_string()));
        assert_eq!(s[2].0, "Response");
        assert!(s[2].1.contains("## not a heading") && s[2].1.ends_with("End"));
        assert!(split_sections("").is_empty());
        assert_eq!(split_sections("## Only\n").len(), 1);
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-ext-{tag}-{}-{}", std::process::id(), crate::automations::now_ms()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn history_reads_only_inside_the_jobs_output_folder() {
        let home = scratch("hist");
        let dir = home.join("cron").join("output").join("job1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("2026-10-30_09-00-00.md"), "## Prompt\n\nold\n").unwrap();
        std::fs::write(dir.join("2026-10-31_09-00-00.md"), "## Prompt\n\nnew\n\n## Response\n\nok\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a run").unwrap();
        std::fs::write(home.join("cron").join("jobs.json"), "SECRET").unwrap();
        let h = hermes_history(&home, "job1", 10).unwrap();
        let runs = h["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 2, "only .md files");
        assert_eq!(runs[0]["file"], "2026-10-31_09-00-00.md", "newest first");
        assert_eq!(runs[0]["sections"][1]["title"], "Response");
        assert_eq!(hermes_history(&home, "job1", 1).unwrap()["runs"].as_array().unwrap().len(), 1);
        // A job id that tries to leave the folder is refused, and a job with no folder has no runs.
        for bad in ["..", "../job1", "job1/..", "a\\b", "", ".", "x y"] {
            assert!(hermes_history(&home, bad, 10).is_err(), "{bad}");
        }
        assert_eq!(hermes_history(&home, "nojob", 10).unwrap()["runs"].as_array().unwrap().len(), 0);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn job_ids_are_plain_words() {
        for ok in ["a1b2c3", "job-1", "job_1", "J.2"] {
            assert!(valid_id(ok), "{ok}");
        }
        for bad in ["", ".", "..", "-rf", "a b", "a/b", "a\\b", "a&b", "a\"b", "a;b"] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(!valid_id(&"a".repeat(129)));
    }

    #[test]
    fn each_action_becomes_the_tools_own_command() {
        let none = json!({});
        let c = |t, a, id: &str, i: &Value| command(t, a, id, i).unwrap();
        assert_eq!(c(Tool::Hermes, Action::Pause, "j1", &none), vec!["cron", "pause", "j1"]);
        assert_eq!(c(Tool::Hermes, Action::Resume, "j1", &none), vec!["cron", "resume", "j1"]);
        assert_eq!(c(Tool::Hermes, Action::Run, "j1", &none), vec!["cron", "run", "j1"]);
        assert_eq!(c(Tool::Hermes, Action::Remove, "j1", &none), vec!["cron", "remove", "j1"]);
        assert_eq!(c(Tool::OpenClaw, Action::Pause, "j1", &none), vec!["cron", "disable", "j1"]);
        assert_eq!(c(Tool::OpenClaw, Action::Resume, "j1", &none), vec!["cron", "enable", "j1"]);
        assert_eq!(c(Tool::OpenClaw, Action::Run, "j1", &none), vec!["cron", "run", "j1"]);
        assert_eq!(c(Tool::OpenClaw, Action::Remove, "j1", &none), vec!["cron", "rm", "j1"]);
        let make = json!({ "name": "-Digest", "schedule": "0 9 * * *", "prompt": "-hello\nworld", "workspace": "C:\\w" });
        assert_eq!(c(Tool::Hermes, Action::Create, "", &make), vec!["cron", "create", "--name=-Digest", "--workdir=C:\\w", "--", "0 9 * * *", "-hello\nworld"]);
        let edit = json!({ "schedule": "*/30 * * * *", "prompt": "new" });
        assert_eq!(c(Tool::Hermes, Action::Edit, "j1", &edit), vec!["cron", "edit", "--schedule=*/30 * * * *", "--prompt=new", "j1"]);
        // Only what is named gets a flag: a rename alone carries no --schedule and no --prompt.
        assert_eq!(c(Tool::Hermes, Action::Edit, "j1", &json!({ "name": "Renamed" })), vec!["cron", "edit", "--name=Renamed", "j1"]);
        // A timetable that is not a five-field cron line (an interval, an RRULE) is never sent.
        for bad in ["every 120m", "FREQ=DAILY", "0 9 * *", "61 * * * *"] {
            assert!(command(Tool::Hermes, Action::Edit, "j1", &json!({ "schedule": bad, "name": "n" })).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_command_that_is_not_allowed_is_refused_before_anything_runs() {
        let none = json!({});
        assert!(command(Tool::OpenClaw, Action::Edit, "j1", &none).is_err());
        assert!(command(Tool::OpenClaw, Action::Create, "", &json!({ "schedule": "x", "prompt": "y" })).is_err());
        assert!(command(Tool::Hermes, Action::Pause, "--help", &none).is_err());
        assert!(command(Tool::Hermes, Action::Pause, "", &none).is_err());
        assert!(command(Tool::Hermes, Action::Create, "", &json!({ "schedule": "", "prompt": "y" })).is_err());
        assert!(command(Tool::Hermes, Action::Create, "", &json!({ "schedule": "0 9 * * *", "prompt": "  " })).is_err());
        assert!(command(Tool::Hermes, Action::Edit, "j1", &none).is_err(), "an edit that changes nothing");
    }

    #[test]
    fn the_gate_lets_in_at_most_n_at_a_time() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let gate = Gate::new(2);
        let (now, high) = (AtomicUsize::new(0), AtomicUsize::new(0));
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    let _g = gate.enter();
                    let n = now.fetch_add(1, Ordering::SeqCst) + 1;
                    high.fetch_max(n, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    now.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        assert_eq!(high.load(Ordering::SeqCst), 2);
    }

    // ---- the Probe seam: a stand-in answers, nothing is spawned

    struct Fake {
        hermes: Result<String, Fail>,
        openclaw: Result<String, Fail>,
        said: Mutex<Vec<String>>,
    }
    impl Probe for Fake {
        fn list(&self, tool: Tool) -> Result<String, Fail> {
            match tool {
                Tool::Hermes => self.hermes.clone(),
                Tool::OpenClaw => self.openclaw.clone(),
            }
        }
        fn act(&self, tool: Tool, action: Action, id: &str, _input: &Value) -> Result<String, Fail> {
            self.said.lock().unwrap().push(format!("{} {} {id}", tool.name(), action.word()));
            Ok("done".into())
        }
    }
    fn fake(h: Result<String, Fail>, o: Result<String, Fail>) -> Fake {
        Fake { hermes: h, openclaw: o, said: Mutex::new(Vec::new()) }
    }

    #[test]
    fn refresh_lists_both_tools_and_caches_the_rows() {
        let cache = Cache::new();
        let out = refresh(&fake(Ok(HERMES_JOBS.into()), Ok(OPENCLAW_JOBS.into())), &cache, false);
        assert_eq!(out["held"], false);
        assert_eq!(out["rows"].as_array().unwrap().len(), 5);
        assert_eq!(cache.rows().len(), 5);
    }

    #[test]
    fn a_missing_program_is_a_warning_row_and_the_other_tool_still_lists() {
        let cache = Cache::new();
        let out = refresh(&fake(Err(Fail::Missing), Ok(OPENCLAW_JOBS.into())), &cache, false);
        let rows = out["rows"].as_array().unwrap();
        let w: Vec<&Value> = rows.iter().filter(|r| r["kind"] == "warning").collect();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0]["warning"], "hermes was not found on the PATH");
        assert_eq!(w[0]["source"], "hermes");
        assert_eq!(rows.len(), 4, "the warning and OpenClaw's three jobs");
        let both = refresh(&fake(Err(Fail::Missing), Err(Fail::Missing)), &cache, false);
        let notes: Vec<&str> = both["rows"].as_array().unwrap().iter().map(|r| r["warning"].as_str().unwrap()).collect();
        assert_eq!(notes, ["hermes was not found on the PATH", "openclaw was not found on the PATH"], "each missing tool says so (AUTO-025)");
    }

    #[test]
    fn a_slow_or_failing_tool_is_a_warning_too() {
        let cache = Cache::new();
        let out = refresh(&fake(Err(Fail::TimedOut), Err(Fail::Failed("boom".into()))), &cache, false);
        let words: Vec<&str> = out["rows"].as_array().unwrap().iter().map(|r| r["warning"].as_str().unwrap()).collect();
        assert_eq!(words, vec!["hermes did not answer in time", "openclaw failed: boom"]);
    }

    #[test]
    fn a_busy_kolux_holds_the_probes_back_and_keeps_the_cache() {
        let cache = Cache::new();
        refresh(&fake(Ok(HERMES_JOBS.into()), Err(Fail::Missing)), &cache, false);
        let before = cache.rows().len();
        let held = fake(Err(Fail::Failed("must not be asked".into())), Err(Fail::Failed("must not be asked".into())));
        let out = refresh(&held, &cache, true);
        assert_eq!(out["held"], true);
        assert_eq!(out["rows"].as_array().unwrap().len(), before);
        assert_eq!(cache.rows().len(), before);
    }

    #[test]
    fn act_checks_the_row_may_do_that_then_forwards() {
        let f = fake(Ok(String::new()), Ok(String::new()));
        assert_eq!(act(&f, "openclaw", "pause", "job-1", &json!({})).unwrap(), "done");
        assert_eq!(act(&f, "hermes", "edit", "j1", &json!({ "prompt": "p" })).unwrap(), "done");
        assert!(act(&f, "openclaw", "edit", "job-1", &json!({ "prompt": "p" })).unwrap_err().contains("does not offer edit"));
        assert!(act(&f, "openclaw", "create", "", &json!({ "schedule": "x", "prompt": "p" })).unwrap_err().contains("does not offer create"));
        assert!(act(&f, "nope", "run", "j", &json!({})).is_err());
        assert!(act(&f, "hermes", "explode", "j", &json!({})).is_err());
        assert!(act(&f, "hermes", "run", "--help", &json!({})).is_err());
        assert_eq!(*f.said.lock().unwrap(), vec!["openclaw pause job-1", "hermes edit j1"]);
    }

    // ---- the real probe, against stand-in programs on a temp PATH

    #[test]
    fn the_program_is_found_by_pathext_order_and_an_extensionless_shim_is_skipped() {
        let d = scratch("path");
        std::fs::write(d.join("tool"), "shim").unwrap();
        std::fs::write(d.join("tool.cmd"), "x").unwrap();
        std::fs::write(d.join("other.exe"), "x").unwrap();
        let path = std::env::join_paths([&d]).unwrap();
        if cfg!(windows) {
            assert_eq!(find_on_path("tool", &path, Some(".COM;.EXE;.BAT;.CMD")).unwrap().file_name().unwrap().to_string_lossy().to_lowercase(), "tool.cmd");
            assert!(find_on_path("other", &path, Some(".COM;.EXE;.BAT;.CMD")).is_some());
        }
        assert!(find_on_path("absent", &path, Some(".EXE;.CMD")).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// `to` as a path relative to the current folder (both are on the same drive here: the temp
    /// folder), or None when no relative path exists.
    fn relative_to_cwd(to: &Path) -> Option<PathBuf> {
        use std::path::Component;
        let from = std::env::current_dir().ok()?;
        let (a, b): (Vec<Component>, Vec<Component>) = (from.components().collect(), to.components().collect());
        let same = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
        if same == 0 {
            return None;
        }
        let mut out = PathBuf::new();
        a[same..].iter().for_each(|_| out.push(".."));
        b[same..].iter().for_each(|c| out.push(c.as_os_str()));
        Some(out)
    }

    #[test]
    fn empty_and_relative_path_entries_are_skipped() {
        // The shim sits in a scratch folder, never in the folder the tests run from.
        let d = scratch("rel");
        stand_in(&d, "kolux-t193b-shim", "exit 0");
        let ext = if cfg!(windows) { Some(".CMD") } else { None };
        let rel = relative_to_cwd(&d).expect("the scratch folder and the current folder share a drive");
        assert!(rel.is_relative());
        let bad = std::env::join_paths([PathBuf::from(""), rel]).unwrap();
        assert!(find_on_path("kolux-t193b-shim", &bad, ext).is_none(), "an empty or relative entry is not searched");
        let good = std::env::join_paths([PathBuf::from(""), d.clone()]).unwrap();
        assert!(find_on_path("kolux-t193b-shim", &good, ext).is_some_and(|p| p.is_absolute()), "the absolute entry still finds it");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Writes a stand-in `name` into `dir` that runs `body` (a cmd script on Windows, sh elsewhere).
    fn stand_in(dir: &Path, name: &str, body: &str) {
        #[cfg(windows)]
        std::fs::write(dir.join(format!("{name}.cmd")), format!("@echo off\r\n{body}\r\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let p = dir.join(name);
            std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    fn probe_on(dir: &Path, limit_ms: u64) -> CliProbe {
        let mut p = CliProbe::new();
        p.path = Some(std::env::join_paths([dir]).unwrap());
        p.list_limit = Duration::from_millis(limit_ms);
        p.act_limit = Duration::from_millis(limit_ms);
        p.hermes_home = Some(dir.join("home"));
        p
    }
    const HANG: &str = if cfg!(windows) { "ping -n 30 127.0.0.1 >nul" } else { "sleep 30" };

    #[test]
    fn the_real_probe_spawns_the_program_and_reads_its_answer() {
        let d = scratch("spawn");
        let say = if cfg!(windows) { "echo {\"jobs\":[{\"id\":\"j1\",\"name\":\"n\"}]}" } else { "echo '{\"jobs\":[{\"id\":\"j1\",\"name\":\"n\"}]}'" };
        stand_in(&d, "openclaw", say);
        let p = probe_on(&d, 10_000);
        let text = p.list(Tool::OpenClaw).unwrap();
        assert_eq!(openclaw_jobs(&text).rows.len(), 1);
        // a non-zero exit with a JSON body still hands the body over (OpenClaw explains itself there)
        let fail = if cfg!(windows) { "echo {\"ok\":false}\r\nexit /b 1" } else { "echo '{\"ok\":false}'; exit 1" };
        stand_in(&d, "openclaw", fail);
        assert!(p.list(Tool::OpenClaw).unwrap().contains("\"ok\":false"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_hermes_jobs_file_over_the_cap_is_too_big_and_one_at_the_cap_is_read() {
        let d = scratch("big");
        stand_in(&d, "hermes", "exit 0");
        let p = probe_on(&d, 10_000);
        let cron = d.join("home").join("cron");
        std::fs::create_dir_all(&cron).unwrap();
        let file = cron.join("jobs.json");
        let mut body = vec![b' '; MAX_JOBS_FILE as usize];
        std::fs::write(&file, &body).unwrap();
        assert_eq!(p.list(Tool::Hermes).unwrap().len() as u64, MAX_JOBS_FILE);
        body.push(b' ');
        std::fs::write(&file, &body).unwrap();
        assert_eq!(p.list(Tool::Hermes), Err(Fail::Failed("its jobs file is too big to read".into())));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_program_that_is_not_installed_is_missing_not_an_error() {
        let d = scratch("missing");
        let p = probe_on(&d, 2_000);
        assert_eq!(p.list(Tool::OpenClaw), Err(Fail::Missing));
        assert_eq!(p.list(Tool::Hermes), Err(Fail::Missing));
        assert_eq!(p.act(Tool::OpenClaw, Action::Run, "j1", &json!({})), Err(Fail::Missing));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_program_that_hangs_is_stopped_and_the_kolux_list_still_returns() {
        let d = scratch("hang");
        stand_in(&d, "openclaw", HANG);
        let p = probe_on(&d, 400);
        let began = std::time::Instant::now();
        assert_eq!(p.list(Tool::OpenClaw), Err(Fail::TimedOut));
        assert!(began.elapsed() < Duration::from_secs(8), "stopped at its limit, not at the script's end");
        // the whole refresh returns with a warning row for the tool that hung
        let cache = Cache::new();
        let began = std::time::Instant::now();
        let out = refresh(&p, &cache, false);
        assert!(began.elapsed() < Duration::from_secs(10));
        let rows = out["rows"].as_array().unwrap();
        assert!(rows.iter().any(|r| r["source"] == "openclaw" && r["warning"] == "openclaw did not answer in time"), "{rows:?}");
        assert!(rows.iter().any(|r| r["source"] == "hermes" && r["warning"] == "hermes was not found on the PATH"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hermes_lists_from_its_jobs_file_once_the_program_is_there() {
        let d = scratch("hjobs");
        stand_in(&d, "hermes", "exit 0");
        let home = d.join("home");
        let p = probe_on(&d, 5_000);
        // no cron folder yet: no jobs, no error
        assert_eq!(hermes_jobs(&p.list(Tool::Hermes).unwrap()).rows.len(), 0);
        std::fs::create_dir_all(home.join("cron")).unwrap();
        std::fs::write(home.join("cron").join("jobs.json"), HERMES_JOBS).unwrap();
        assert_eq!(hermes_jobs(&p.list(Tool::Hermes).unwrap()).rows.len(), 2);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_probe_runs_at_most_its_gate_at_a_time() {
        let d = scratch("gate");
        // each call takes about half a second; with a gate of 1, three calls take over a second
        let nap = if cfg!(windows) { "ping -n 2 127.0.0.1 >nul\r\necho {}" } else { "sleep 0.5; echo '{}'" };
        stand_in(&d, "openclaw", nap);
        let mut p = probe_on(&d, 15_000);
        p.gate = Gate::new(1);
        let began = std::time::Instant::now();
        std::thread::scope(|s| {
            for _ in 0..3 {
                s.spawn(|| assert!(p.list(Tool::OpenClaw).is_ok()));
            }
        });
        assert!(began.elapsed() >= Duration::from_millis(2_000) || !cfg!(windows), "three calls ran one after another: {:?}", began.elapsed());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    #[ignore = "live: needs hermes and openclaw installed; only reads (--version, cron list)"]
    fn live_the_installed_tools_answer_a_read_only_list() {
        let p = CliProbe::new();
        let out = refresh(&p, &Cache::new(), false);
        let rows = out["rows"].as_array().unwrap();
        eprintln!("{}", serde_json::to_string_pretty(rows).unwrap());
        assert!(rows.iter().all(|r| r["source"].is_string()));
    }
}
