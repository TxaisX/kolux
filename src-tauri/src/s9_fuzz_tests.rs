//! S9: fuzz-style property tests for the hook event parsers, the secret maskers and the terminal
//! escape-sequence parsers. Test-only; a seeded xorshift generator, 100k cases per property.
//! A failure prints `seed=... case=...`; the same seed and case rebuild the same input.
use crate::hooks::{self, Request};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;
use std::panic::{self, catch_unwind, AssertUnwindSafe};
use std::sync::Once;
use std::time::{Duration, Instant};

const CASES: u64 = 100_000;
const SLOW: Duration = Duration::from_millis(50);

/// One second per MiB (at least one second): the S6-style "no hang > 1 s" bar scaled to the input.
fn over_budget(bytes: usize, dt: Duration) -> bool {
    dt.as_secs_f64() > (bytes as f64 / (1u64 << 20) as f64).max(1.0)
}

// ---- harness ----

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next() % n as u64) as usize }
    }
    fn chance(&mut self, one_in: usize) -> bool {
        self.below(one_in) == 0
    }
    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + self.below(hi - lo + 1)
    }
    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.below(xs.len())]
    }
}

fn mix(z: u64) -> u64 {
    let z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

thread_local! {
    static QUIET: Cell<bool> = const { Cell::new(false) };
    static WHERE: RefCell<String> = const { RefCell::new(String::new()) };
}

fn install_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let prev = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if QUIET.with(Cell::get) {
                let text = info.to_string().replace('\n', " | ");
                WHERE.with(|w| *w.borrow_mut() = text);
            } else {
                prev(info);
            }
        }));
    });
}

struct Report {
    name: String,
    cases: u64,
    fails: u64,
    firsts: Vec<String>,
    sites: BTreeMap<String, (u64, u64, String)>,
    slow: u64,
    worst: Duration,
    worst_case: u64,
    seed: u64,
}

impl Report {
    fn line(&self) -> String {
        format!(
            "s9 RESULT {} cases={} fail={} slow_over_50ms={} worst_ms={:.2}@case{} seed={:#x} -> {}",
            self.name,
            self.cases,
            self.fails,
            self.slow,
            self.worst.as_secs_f64() * 1000.0,
            self.worst_case,
            self.seed,
            if self.fails == 0 { "PASS" } else { "FAIL" }
        )
    }
    fn print(&self) {
        println!("{}", self.line());
        for (site, (n, first, ex)) in &self.sites {
            println!("s9 SITE {} count={} first_case={} seed={:#x} {}
s9 EXAMPLE {} {}", self.name, n, first, self.seed, cut(site, 260), self.name, cut(ex, 900));
        }
        for f in &self.firsts {
            println!("s9 FAIL {} seed={:#x} {}", self.name, self.seed, cut(f, 700));
        }
    }
}

fn norm(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let d = if c.is_ascii_digit() { 'N' } else { c };
        if !(d == 'N' && out.ends_with('N')) {
            out.push(d);
        }
    }
    out
}

fn cut(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if s.chars().count() > n { format!("{t}...") } else { t }
}

fn campaign<I>(name: &str, seed: u64, cases: u64, gen: impl Fn(&mut Rng) -> I, check: impl Fn(&I) -> Result<(), String>, show: impl Fn(&I) -> String) -> Report {
    install_hook();
    let mut rep = Report { name: name.into(), cases: 0, fails: 0, firsts: vec![], sites: BTreeMap::new(), slow: 0, worst: Duration::ZERO, worst_case: 0, seed };
    for case in 0..cases {
        let mut rng = Rng::new(mix(seed ^ mix(case)));
        let input = gen(&mut rng);
        QUIET.with(|q| q.set(true));
        let t0 = Instant::now();
        let res = catch_unwind(AssertUnwindSafe(|| check(&input)));
        let dt = t0.elapsed();
        QUIET.with(|q| q.set(false));
        rep.cases += 1;
        if dt > rep.worst {
            rep.worst = dt;
            rep.worst_case = case;
        }
        if dt > SLOW {
            rep.slow += 1;
        }
        let problem = match res {
            Ok(Ok(())) => None,
            Ok(Err(e)) => Some((format!("PROPERTY {}", e.lines().next().unwrap_or("")), e)),
            Err(_) => {
                let w = WHERE.with(|w| w.borrow().clone());
                Some((format!("PANIC {w}"), w))
            }
        };
        if let Some((site, detail)) = problem {
            rep.fails += 1;
            let key = norm(&cut(&site, 200));
            let ex = format!("{detail} INPUT={}", cut(&show(&input), 500));
            let e = rep.sites.entry(key).or_insert((0, case, ex));
            e.0 += 1;
            if rep.firsts.len() < 4 {
                rep.firsts.push(format!("case={case} {detail} INPUT={}", cut(&show(&input), 400)));
            }
        }
    }
    rep.print();
    rep
}

fn finish(rep: &Report) {
    assert!(rep.fails == 0, "{}", rep.line());
}

// ---- generators ----

fn rand_char(r: &mut Rng) -> char {
    const SPECIAL: &[char] = &[
        '\0', '\x07', '\x1b', '\x7f', '\u{9b}', '\r', '\n', '\t', ' ', '"', '\'', '\\', '/', ':', '=', '@', '[', ']', '{', '}', '$', '`', '|', ';', '&', '<', '>', '%', '#', '*', 'é', 'ß', 'İ', 'ǅ', 'Ω', 'ж', '中', '日', '한',
        '\u{200d}', '\u{202e}', '\u{0301}', '\u{feff}', '\u{2028}', '😀', '👨', '🏴', '\u{10ffff}', '\u{fffd}', '\u{1f1e6}', '\u{e0001}', '\u{a0}', '\u{3000}',
    ];
    match r.below(10) {
        0..=3 => (b' ' + r.below(95) as u8) as char,
        4..=6 => *r.pick(SPECIAL),
        7 => loop {
            if let Some(c) = char::from_u32(r.below(0x11_0000) as u32) {
                break c;
            }
        },
        _ => (b'a' + r.below(26) as u8) as char,
    }
}

fn noise(r: &mut Rng, max: usize) -> String {
    let n = r.below(max + 1);
    (0..n).map(|_| rand_char(r)).collect()
}

fn alnum(r: &mut Rng, lo: usize, hi: usize) -> String {
    const A: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let n = r.range(lo, hi);
    (0..n).map(|_| A[r.below(A.len())] as char).collect()
}

fn with_set(r: &mut Rng, set: &[u8], lo: usize, hi: usize) -> String {
    let n = r.range(lo, hi);
    (0..n).map(|_| set[r.below(set.len())] as char).collect()
}

fn random_bytes(r: &mut Rng, max: usize) -> Vec<u8> {
    let n = r.below(max + 1);
    (0..n).map(|_| r.next() as u8).collect()
}

fn bytes_show(b: &[u8]) -> String {
    format!("len={} {:?}", b.len(), String::from_utf8_lossy(&b[..b.len().min(300)]))
}

// ---- (a) hook event JSON ----

fn jstr(r: &mut Rng) -> Value {
    match r.below(10) {
        0 => Value::String(String::new()),
        1..=3 => Value::String(noise(r, 30)),
        4 => Value::String(noise(r, 400)),
        5 => Value::String(format!("{}\n{}\r\n  {}\t{}", noise(r, 20), noise(r, 20), noise(r, 20), noise(r, 20))),
        6 if r.chance(40) => Value::String("x".repeat(r.range(20_000, 200_000))),
        7 => Value::String("é".repeat(r.range(1, 300))),
        8 => Value::String(r.pick(&["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "AskUserQuestion", "ExitPlanMode", "Task", "Read", "mcp__x__y"]).to_string()),
        _ => Value::String(alnum(r, 0, 40)),
    }
}

fn jval(r: &mut Rng, depth: usize) -> Value {
    match r.below(if depth > 5 { 6 } else { 10 }) {
        0 => Value::Null,
        1 => Value::Bool(r.chance(2)),
        2 => json!(*r.pick(&[0u64, 1, 42, u32::MAX as u64, u32::MAX as u64 + 1, u64::MAX, 1 << 53])),
        3 => json!(*r.pick(&[0.0f64, -1.5, 1e308, -1e308, 1e-320, 0.5, 99.9, 100.0, f64::MAX])),
        4 | 5 => jstr(r),
        6 | 7 => Value::Array((0..r.below(4)).map(|_| jval(r, depth + 1)).collect()),
        _ => {
            let mut m = serde_json::Map::new();
            for _ in 0..r.below(4) {
                m.insert(noise(r, 8), jval(r, depth + 1));
            }
            Value::Object(m)
        }
    }
}

const EVENTS: &[&str] = &[
    "SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "PermissionRequest", "SubagentStart", "SubagentStop", "SessionEnd", "PreCompact", "PostCompact",
    "TurnStart", "agent-turn-complete", "task_started", "",
];

fn tool_input(r: &mut Rng) -> Value {
    let mut m = serde_json::Map::new();
    for k in ["command", "cmd", "file_path", "path", "pattern", "description", "prompt", "question", "plan", "questions", "edits", "content"] {
        if r.chance(3) {
            m.insert(k.into(), if r.chance(3) { jval(r, 3) } else { jstr(r) });
        }
    }
    Value::Object(m)
}

fn hook_event(r: &mut Rng) -> Value {
    let mut m = serde_json::Map::new();
    let name = if r.chance(8) { Value::String(noise(r, 12)) } else { Value::String(r.pick(EVENTS).to_string()) };
    if !r.chance(15) {
        m.insert("hook_event_name".into(), if r.chance(12) { jval(r, 2) } else { name });
    }
    for k in ["session_id", "source", "prompt", "user_prompt", "tool_name", "error", "error_details", "agent_id", "cwd", "message", "trigger", "notification_type", "turn_id", "type", "transcript_path", "model"] {
        if r.chance(2) {
            m.insert(k.into(), if r.chance(5) { jval(r, 2) } else if k == "source" && r.chance(2) { json!(*r.pick(&["startup", "resume", "clear", "compact"])) } else { jstr(r) });
        }
    }
    if r.chance(2) {
        m.insert("tool_input".into(), if r.chance(6) { jval(r, 2) } else { tool_input(r) });
    }
    for k in ["tool_response", "cost", "context_window", "rate_limits", "limits", "payload", "input"] {
        if r.chance(4) {
            m.insert(k.into(), jval(r, 1));
        }
    }
    Value::Object(m)
}

/// Raw bytes for the hook body: valid events, mutated events and junk.
fn hook_body(r: &mut Rng) -> Vec<u8> {
    match r.below(12) {
        0 => random_bytes(r, 300),
        1 => noise(r, 300).into_bytes(),
        2 => {
            let mut b = serde_json::to_vec(&hook_event(r)).unwrap();
            if !b.is_empty() {
                let cut = r.below(b.len());
                b.truncate(cut);
            }
            b
        }
        3 => {
            let mut b = serde_json::to_vec(&hook_event(r)).unwrap();
            for _ in 0..r.range(1, 4) {
                if !b.is_empty() {
                    let i = r.below(b.len());
                    b[i] = r.next() as u8;
                }
            }
            b
        }
        4 => {
            // duplicate keys, the later one wins
            let n = r.range(2, 40);
            let mut s = String::from("{");
            for _ in 0..n {
                s.push_str(&format!("\"hook_event_name\":{},\"prompt\":{},", jval(r, 4), jval(r, 4)));
            }
            s.push_str("\"hook_event_name\":\"Stop\"}");
            s.into_bytes()
        }
        5 => {
            // nesting just under and over serde_json's limit of 128
            let d = *r.pick(&[10usize, 100, 126, 127, 128, 129, 200, 10_000]);
            let o = if r.chance(2) { "[" } else { "{\"a\":" };
            let c = if o == "[" { "]" } else { "}" };
            format!("{{\"hook_event_name\":\"PreToolUse\",\"tool_input\":{}1{}}}", o.repeat(d), c.repeat(d)).into_bytes()
        }
        6 => {
            let n = if r.chance(150) { 1_000_000 } else { *r.pick(&[1_000usize, 1_000, 10_000, 100_000]) };
            let big = "A".repeat(n);
            let e = r.pick(&["UserPromptSubmit", "PreToolUse", "StopFailure", "Notification"]);
            format!("{{\"hook_event_name\":\"{e}\",\"prompt\":\"{big}\",\"user_prompt\":\"{big}\",\"tool_name\":\"{big}\",\"error\":\"{big}\",\"error_details\":\"{big}\",\"tool_input\":{{\"command\":\"{big}\"}}}}").into_bytes()
        }
        7 => format!("{{\"hook_event_name\":\"{}\",\"cost\":{{\"total_cost_usd\":{},\"total_duration_ms\":{}}},\"context_window\":{{\"context_window_size\":{},\"total_input_tokens\":{},\"used_percentage\":{},\"current_usage\":{{\"input_tokens\":{},\"cache_creation_input_tokens\":{},\"cache_read_input_tokens\":{}}}}},\"session_id\":\"s\"}}",
            r.pick(EVENTS), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r)).into_bytes(),
        _ => serde_json::to_vec(&hook_event(r)).unwrap(),
    }
}

fn numtxt(r: &mut Rng) -> String {
    r.pick(&["0", "1", "-1", "1.5", "1e999", "-1e999", "18446744073709551615", "18446744073709551616", "9223372036854775807", "4294967296", "null", "\"7\"", "[]", "NaN", "0.0000000001", "1e-400", "100", "1e308"]).to_string()
}

fn limits_value(r: &mut Rng) -> Value {
    let kinds = ["five_hour", "seven_day", "weekly", "x"];
    json!({"rate_limits": (0..r.below(4)).map(|_| json!({"kind": r.pick(&kinds), "percentUsed": jval(r, 4), "used_percentage": jval(r, 4), "resetsAt": jval(r, 3), "resets_at": jval(r, 3)})).collect::<Vec<_>>()})
}

fn pane_header(r: &mut Rng) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    match r.below(6) {
        0 => noise(r, 50),
        1 => b64.encode(random_bytes(r, 60)),
        2 => b64.encode(serde_json::to_vec(&jval(r, 3)).unwrap()),
        3 => b64.encode(json!({"paneKey": jval(r, 4), "terminal": jval(r, 4), "hookVersion": jval(r, 4)}).to_string()),
        _ => b64.encode(json!({"paneKey": r.below(1000), "terminal": r.below(1000)}).to_string()),
    }
}

fn request_with(path: &str, body: Vec<u8>, pane: String) -> Request {
    let mut headers = HashMap::new();
    headers.insert(hooks::TOKEN_HEADER.to_string(), "tok".to_string());
    headers.insert(hooks::IDENTITY_HEADER.to_string(), pane);
    Request { path: path.into(), headers, body }
}

fn check_change(c: &hooks::Change) -> Result<(), String> {
    let v = serde_json::to_value(c).map_err(|e| format!("Change not serialisable: {e}"))?;
    if c.state.is_empty() {
        return Err("empty state".into());
    }
    if let Some(o) = v.as_object() {
        for (k, f) in o {
            if let Some(s) = f.as_str() {
                if s.chars().count() > 16_001 {
                    return Err(format!("field {k} is {} chars (cap 16001)", s.chars().count()));
                }
            }
        }
    }
    Ok(())
}

#[test]
fn s9_hook_event_json_never_panics() {
    let rep = campaign(
        "hook_event_json",
        0x5EED_0001,
        CASES,
        hook_body,
        |body| {
            let Ok(v) = serde_json::from_slice::<Value>(body) else { return Ok(()) };
            let a = hooks::claude_change(&v);
            let b = hooks::codex_change(&v);
            for c in [&a, &b].into_iter().flatten() {
                check_change(c)?;
            }
            let (a2, b2) = (hooks::claude_change(&v), hooks::codex_change(&v));
            if a.as_ref().map(|c| serde_json::to_string(c).unwrap()) != a2.as_ref().map(|c| serde_json::to_string(c).unwrap()) {
                return Err("claude_change is not deterministic".into());
            }
            if b.as_ref().map(|c| serde_json::to_string(c).unwrap()) != b2.as_ref().map(|c| serde_json::to_string(c).unwrap()) {
                return Err("codex_change is not deterministic".into());
            }
            Ok(())
        },
        |b| bytes_show(b),
    );
    finish(&rep);
}

#[test]
fn s9_hook_status_line_usage_never_panics() {
    let rep = campaign(
        "hook_usage",
        0x5EED_0002,
        CASES,
        |r| {
            let mut body = hook_body(r);
            if r.chance(2) {
                let mut v = hook_event(r);
                if let (Some(o), Some(l)) = (v.as_object_mut(), limits_value(r).as_object()) {
                    for (k, x) in l {
                        o.insert(k.clone(), x.clone());
                    }
                }
                body = serde_json::to_vec(&v).unwrap();
            }
            (body, pane_header(r))
        },
        |(body, pane)| {
            let req = request_with("/usage", body.clone(), pane.clone());
            if let Ok(u) = hooks::usage(&req, "tok") {
                if let Some(c) = u.cost_usd {
                    if !c.is_finite() || c < 0.0 {
                        return Err(format!("cost_usd {c} is not a finite number >= 0"));
                    }
                }
            }
            Ok(())
        },
        |(b, p)| format!("pane={} body={}", cut(p, 60), bytes_show(b)),
    );
    finish(&rep);
}

/// A report with the figures the status line sends, each at an extreme.
#[test]
fn s9_hook_status_line_extreme_numbers() {
    let rep = campaign(
        "hook_usage_numbers",
        0x5EED_0003,
        CASES,
        |r| {
            let body = format!("{{\"session_id\":\"s\",\"cost\":{{\"total_cost_usd\":{},\"total_duration_ms\":{}}},\"context_window\":{{\"context_window_size\":{},\"total_input_tokens\":{},\"used_percentage\":{},\"current_usage\":{{\"input_tokens\":{},\"cache_creation_input_tokens\":{},\"cache_read_input_tokens\":{}}}}}}}",
                numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r), numtxt(r));
            body.into_bytes()
        },
        |body| {
            use base64::Engine;
            let pane = base64::engine::general_purpose::STANDARD.encode(json!({"paneKey": 1, "terminal": 2}).to_string());
            let req = request_with("/usage", body.clone(), pane);
            let _ = hooks::usage(&req, "tok");
            Ok(())
        },
        |b| bytes_show(b),
    );
    finish(&rep);
}

fn http_request(r: &mut Rng) -> Vec<u8> {
    let nl = *r.pick(&["\r\n", "\n", "\r\n", "\r\n"]);
    let mut s: Vec<u8> = Vec::new();
    let line = match r.below(8) {
        0 | 1 => "POST /claude HTTP/1.1".to_string(),
        2 => "POST /codex HTTP/1.1".to_string(),
        3 => format!("{} {} HTTP/1.1", noise(r, 5), noise(r, 40)),
        4 => String::new(),
        5 if r.chance(20) => format!("POST /{} HTTP/1.1", "a".repeat(r.range(50_000, 300_000))),
        _ => "POST /usage HTTP/1.1".to_string(),
    };
    s.extend(line.as_bytes());
    s.extend(nl.as_bytes());
    let body = if r.chance(3) { random_bytes(r, 200) } else { serde_json::to_vec(&hook_event(r)).unwrap() };
    let nh = r.below(12);
    for _ in 0..nh {
        let (k, v) = match r.below(9) {
            0 | 1 => ("content-length".to_string(), match r.below(10) {
                0 => "0".to_string(),
                1 => "4194304".to_string(),
                2 => "4194305".to_string(),
                3 => "18446744073709551615".to_string(),
                4 => "-1".to_string(),
                5 => "abc".to_string(),
                6 => "99999999999999999999999".to_string(),
                7 => format!("{}", body.len() + r.below(5)),
                _ => format!("{}", body.len()),
            }),
            2 => (hooks::TOKEN_HEADER.to_string(), alnum(r, 0, 20)),
            3 => (hooks::IDENTITY_HEADER.to_string(), pane_header(r)),
            4 => ("origin".to_string(), noise(r, 20)),
            5 => ("host".to_string(), r.pick(&["127.0.0.1:1", "localhost", "evil.com", "[::1]:80", ""]).to_string()),
            6 => (noise(r, 10), noise(r, 30)),
            7 if r.chance(50) => (alnum(r, 3, 8), "v".repeat(r.range(100_000, 400_000))),
            _ => ("Content-Length".to_string(), format!("{}", r.below(300))),
        };
        s.extend(format!("{k}: {v}{nl}").as_bytes());
    }
    if !r.chance(10) {
        s.extend(nl.as_bytes());
    }
    s.extend(&body);
    if r.chance(10) {
        s.truncate(r.below(s.len() + 1));
    }
    s
}

#[test]
fn s9_hook_http_request_never_panics() {
    let rep = campaign(
        "hook_http_request",
        0x5EED_0004,
        CASES,
        |r| if r.chance(6) { random_bytes(r, 400) } else { http_request(r) },
        |bytes| {
            let mut cur = Cursor::new(bytes.as_slice());
            if let Some(req) = hooks::parse_request(&mut cur) {
                if req.body.len() > 4 << 20 {
                    return Err(format!("body {} bytes over the 4 MiB cap", req.body.len()));
                }
                let _ = hooks::gate(&req, "tok");
                let _ = hooks::usage(&req, "tok");
            }
            Ok(())
        },
        |b| bytes_show(b),
    );
    finish(&rep);
}

#[test]
fn s9_hook_identity_header_never_panics_and_never_aliases() {
    use base64::Engine;
    let rep = campaign(
        "hook_identity",
        0x5EED_0005,
        CASES,
        |r| {
            if r.chance(3) {
                let pane = match r.below(4) {
                    0 => r.next(),
                    1 => (1u64 << 32) + r.below(10) as u64,
                    2 => u64::MAX - r.below(3) as u64,
                    _ => r.below(100_000) as u64,
                };
                (base64::engine::general_purpose::STANDARD.encode(json!({"paneKey": pane, "terminal": r.next()}).to_string()), Some(pane))
            } else {
                (pane_header(r), None)
            }
        },
        |(h, pane)| {
            let got = hooks::identity(h);
            let _ = hooks::identity_version(h);
            if let (Some(p), Some((g, _))) = (pane, got) {
                if g as u64 != *p {
                    return Err(format!("paneKey {p} is read as pane {g}"));
                }
            }
            Ok(())
        },
        |(h, p)| format!("header={} pane={p:?}", cut(h, 120)),
    );
    finish(&rep);
}

// ---- (c) OSC and escape sequences ----

fn osc_payload(r: &mut Rng) -> Vec<u8> {
    let state = *r.pick(&["working", "done", "permission", "waiting", "idle", "blocked", "WORKING", "", "x\0y"]);
    let body = match r.below(8) {
        0 => json!({"state": state}).to_string(),
        1 => json!({"status": state}).to_string(),
        2 => json!({"state": jval(r, 3), "status": state}).to_string(),
        3 => json!({"state": state, "pad": "p".repeat(r.range(0, 5000))}).to_string(),
        4 => format!("{{\"state\":\"{state}\",\"state\":\"idle\"}}"),
        5 => jval(r, 2).to_string(),
        6 => noise(r, 60),
        _ => json!({"state": state, "n": {"a": [1, 2, {"b": null}]}}).to_string(),
    };
    let mut out = Vec::new();
    match r.below(6) {
        0 => out.extend(b"\x1b]9999;"),
        1 => out.extend(b"9999;"),
        2 => {}
        3 => out.extend(b"\x1b]9999;\x1b]9999;"),
        4 => out.extend(format!("\x1b]{};", r.pick(&["0", "7", "133", "99999999999999999999", "9999999999"])).as_bytes()),
        _ => out.extend(b"\x1b]9999;"),
    }
    out.extend(body.as_bytes());
    match r.below(5) {
        0 => out.push(0x07),
        1 => out.extend(b"\x1b\\"),
        2 => out.extend(b"\x1b"),
        3 => out.extend(b"\x07\x07"),
        _ => {}
    }
    if r.chance(4) {
        let n = r.below(out.len() + 1);
        out.truncate(n);
    }
    if r.chance(10) {
        out = random_bytes(r, 100);
    }
    out
}

#[test]
fn s9_osc_inband_status_never_panics() {
    let ok = ["working", "done", "permission", "waiting", "idle"];
    let rep = campaign(
        "osc_inband",
        0x5EED_0006,
        CASES,
        osc_payload,
        |b| {
            if let Some(s) = crate::status::parse_inband(b) {
                if !ok.contains(&s) {
                    return Err(format!("unknown state {s:?}"));
                }
            }
            Ok(())
        },
        |b| bytes_show(b),
    );
    finish(&rep);
}

/// Well-formed frames must parse (BEL and ST terminators, bare payload); a cut inside the JSON must not.
#[test]
fn s9_osc_inband_wellformed_and_truncated() {
    let states = ["working", "done", "permission", "waiting", "idle"];
    let rep = campaign(
        "osc_inband_control",
        0x5EED_0007,
        CASES,
        |r| {
            let st = r.below(5);
            let json = if r.chance(2) { json!({"state": states[st]}).to_string() } else { json!({"status": states[st], "extra": noise(r, 40)}).to_string() };
            (st, json, r.below(4), r.below(json_len(states[st])))
        },
        |(st, json, frame, cutat)| {
            let (head, tail): (&[u8], &[u8]) = match frame {
                0 => (b"\x1b]9999;", b"\x07"),
                1 => (b"\x1b]9999;", b"\x1b\\"),
                2 => (b"9999;", b""),
                _ => (b"", b""),
            };
            let mut full = head.to_vec();
            full.extend(json.as_bytes());
            full.extend(tail);
            match crate::status::parse_inband(&full) {
                Some(s) if s == states[*st] => {}
                other => return Err(format!("well-formed frame gave {other:?}, wanted {}", states[*st])),
            }
            let mut cutb = head.to_vec();
            cutb.extend(&json.as_bytes()[..(*cutat).min(json.len() - 1)]);
            if let Some(s) = crate::status::parse_inband(&cutb) {
                return Err(format!("a frame cut inside its JSON gave {s}"));
            }
            Ok(())
        },
        |(st, j, f, c)| format!("state={st} frame={f} cut={c} json={}", cut(j, 120)),
    );
    finish(&rep);
}

fn json_len(s: &str) -> usize {
    s.len() + 12
}

fn escape_chunk(r: &mut Rng) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    for _ in 0..r.range(1, 8) {
        match r.below(9) {
            0 => out.extend(random_bytes(r, 30)),
            1 | 2 => {
                out.extend(b"\x1b[?");
                let n = match r.below(6) {
                    0 => r.pick(&["47", "1047", "1049", "1000", "1001", "1002", "1003", "25", "2004", "9001"]).to_string(),
                    1 => "9".repeat(r.range(8, 40)),
                    2 => "4294967296".to_string(),
                    3 => "429496729".to_string() + &r.below(10).to_string() + "0",
                    4 => "0".repeat(r.range(1, 50)) + "1049",
                    _ => r.below(5000).to_string(),
                };
                out.extend(n.as_bytes());
                out.push(match r.below(5) {
                    0 | 1 => b'h',
                    2 | 3 => b'l',
                    _ => r.next() as u8,
                });
            }
            3 => out.extend(b"\x1b]"),
            4 => out.extend(format!("\x1b]{};{}{}", r.below(1000), noise(r, 30), r.pick(&["\x07", "\x1b\\", ""])).as_bytes()),
            5 => out.extend(b"\x1b[?"),
            6 => out.extend(b"\x1b[?1049;1000h"),
            7 => out.extend(noise(r, 20).as_bytes()),
            _ => out.extend(b"\x1b"),
        }
    }
    if r.chance(40) {
        out.extend(vec![b'\x1b'; r.range(1000, 100_000)]);
    }
    out
}

#[test]
fn s9_osc_screen_owner_never_panics() {
    let rep = campaign(
        "osc_screen_owner",
        0x5EED_0008,
        CASES,
        |r| (r.below(4) as u8, escape_chunk(r)),
        |(prev, chunk)| {
            let out = crate::terminal::screen_owner(*prev, chunk);
            if out & !(crate::terminal::ALT | crate::terminal::MOUSE) != 0 {
                return Err(format!("owner bits {out:#b} outside ALT|MOUSE"));
            }
            if !chunk.windows(3).any(|w| w == b"\x1b[?") && out != *prev {
                return Err("changed with no DEC private mode in the chunk".into());
            }
            Ok(())
        },
        |(p, b)| format!("prev={p} {}", bytes_show(b)),
    );
    finish(&rep);
}

#[test]
fn s9_osc_reply_and_key_events_never_panic() {
    let rep = campaign(
        "osc_reply_keyevents",
        0x5EED_0009,
        CASES,
        |r| if r.chance(2) { escape_chunk(r) } else { random_bytes(r, 200) },
        |b| {
            let _ = crate::pty::is_reply(b);
            let k = crate::pty::as_key_events(b);
            if k.len() < b.len().min(1) {
                return Err("key events shorter than input".into());
            }
            Ok(())
        },
        |b| bytes_show(b),
    );
    finish(&rep);
}

// ---- (b) masking ----

type Masker = fn(&str) -> String;

struct MaskIn {
    text: String,
    cores: Vec<(u8, String)>,
}

fn secret_form(r: &mut Rng, kind: u8) -> (String, String) {
    match kind {
        0 => {
            let t = alnum(r, 24, 60);
            (format!("sk-{t}"), t)
        }
        1 => {
            let t = with_set(r, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-", 40, 90);
            (format!("sk-ant-api03-{t}"), t)
        }
        2 => {
            let t = alnum(r, 36, 40);
            (format!("{}{t}", r.pick(&["ghp_", "gho_", "ghs_", "ghu_"])), t)
        }
        3 => {
            let t = with_set(r, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-", 20, 60) + &alnum(r, 2, 2) + "9";
            (format!("{} {}Bearer {t}", r.pick(&["Authorization:", "-H \"Authorization:", "authorization:", "Proxy-Authorization:"]), ""), t)
        }
        4 => {
            let v = alnum(r, 1, 1) + &with_set(r, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%^*-_+.", 9, 23);
            (format!("{}{}{v}", r.pick(&["password=", "PASSWORD=", "passwd=", "api_key=", "token=", "secret=", "client_secret="]), ""), v)
        }
        5 => {
            let pw = alnum(r, 10, 20);
            (format!("https://user{}:{pw}@example.com/repo.git", r.below(100)), pw)
        }
        6 => {
            let t = with_set(r, b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16, 16);
            (format!("{}{t}", r.pick(&["AKIA", "ASIA"])), t)
        }
        7 => {
            let t = format!("{}-{}", with_set(r, b"0123456789", 10, 14), alnum(r, 12, 30));
            (format!("xoxb-{t}"), t)
        }
        8 => {
            let t = alnum(r, 24, 40);
            let tail = t.clone();
            (format!("{}{t}", r.pick(&["sk_live_", "sk_test_", "rk_live_"])), tail[..tail.len() - 4].to_string())
        }
        9 => {
            let t = with_set(r, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_", 30, 80);
            (format!("github_pat_{t}"), t)
        }
        10 => {
            let t = with_set(r, b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-", 35, 35);
            (format!("AIza{t}"), t)
        }
        11 => {
            let v = alnum(r, 12, 30);
            (format!("{}{v}", r.pick(&["export API_KEY=", "OPENAI_API_KEY=", "MY_SECRET_TOKEN=", "DB_PASSWORD="])), v)
        }
        12 => {
            let v = alnum(r, 12, 30);
            (format!("{{\"{}\": \"{v}\"}}", r.pick(&["password", "api_key", "token", "client_secret", "apiKey"])), v)
        }
        13 => {
            let line = with_set(r, b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", 40, 64);
            (format!("-----BEGIN PRIVATE KEY-----\n{line}\n{}\n-----END PRIVATE KEY-----", alnum(r, 20, 30)), line)
        }
        15 => {
            let t = with_set(r, b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16, 16);
            (format!("AKIA{t}"), t)
        }
        _ => {
            let v = alnum(r, 12, 30);
            (format!("{}{v}", r.pick(&["--token ", "--password ", "--api-key ", "--secret "])), v)
        }
    }
}

const ALL_KINDS: &[u8] = &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const DIAG_KINDS: &[u8] = &[0, 1, 2, 3, 4, 5, 15, 7, 9, 10, 11, 12, 14];

fn gen_masked(r: &mut Rng, kinds: &[u8], punct: bool) -> MaskIn {
    let mut text = String::new();
    let mut cores = vec![];
    for _ in 0..r.range(1, 3) {
        text.push_str(&noise(r, 40));
        let k = *r.pick(kinds);
        // A flag starts a word, so it never sits glued behind | ; && , = : > / (not a command shape).
        let seps: &[&str] = if k == 14 { &[" ", "\n", "\t", "\"", "'", "("] } else { &[" ", "\n", "\t", "\"", "'", "(", ",", "[", ">", ":", "="] };
        text.push_str(if punct { r.pick(seps) } else { r.pick(&[" ", "\n", "\t", "  "]) });
        let (form, core) = secret_form(r, k);
        text.push_str(&form);
        cores.push((k, core));
        text.push_str(r.pick(&[" ", "
", "\" ", "' ", ") ", ", ", "; "]));
        text.push_str(&noise(r, 40));
    }
    MaskIn { text, cores }
}

const KIND_NAMES: [&str; 16] = ["sk-", "sk-ant-", "ghp_", "Bearer", "label=value", "url-credentials", "AKIA", "xoxb-", "stripe", "github_pat_", "AIza", "env-line", "json-value", "pem", "flag-value", "AKIA-only"];

fn kind_name(k: u8) -> &'static str {
    KIND_NAMES.get(k as usize).copied().unwrap_or("path")
}

fn leaked(out: &str, core: &str) -> bool {
    let cs: Vec<char> = core.chars().collect();
    if cs.len() <= 8 {
        return out.contains(core);
    }
    cs.windows(8).any(|w| out.contains(&w.iter().collect::<String>()))
}

fn mask_show(m: &MaskIn) -> String {
    format!("cores={:?} text={:?}", m.cores, cut(&m.text, 300))
}

fn secrets_campaign(name: &str, seed: u64, f: Masker, kinds: &'static [u8], punct: bool) -> Report {
    campaign(
        name,
        seed,
        CASES,
        move |r| gen_masked(r, kinds, punct),
        move |m| {
            let once = f(&m.text);
            for (k, c) in &m.cores {
                if leaked(&once, c) {
                    return Err(format!("secret survives, kind {}
core={c:?}", kind_name(*k)));
                }
            }
            let twice = f(&once);
            if twice != once {
                return Err("not idempotent".into());
            }
            Ok(())
        },
        mask_show,
    )
}

fn plain_campaign(name: &str, seed: u64, f: Masker) -> Report {
    campaign(
        name,
        seed,
        CASES,
        |r| match r.below(4) {
            0 => String::from_utf8_lossy(&random_bytes(r, 400)).into_owned(),
            1 => noise(r, 800),
            2 => {
                let words = ["sk-", "Bearer ", "password=", "token:", "[hidden]", "ghp_", "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----", "https://u:p@h", "AKIA", "--token ", "API_KEY=", "\"password\":", "xoxb-", "sk-ant-", "npm_", "hf_", "authorization: basic ", "\u{1b}[0m"];
                (0..r.range(1, 40)).map(|_| format!("{}{}", r.pick(&words), alnum(r, 0, 45))).collect::<Vec<_>>().join(*r.pick(&[" ", "", "\n", "=", "-"]))
            }
            _ => {
                // secret glued behind a hidden mark and behind itself
                let ka = *r.pick(ALL_KINDS);
                let (a, _) = secret_form(r, ka);
                let kb = *r.pick(ALL_KINDS);
                let (b, _) = secret_form(r, kb);
                format!("{a}{b}{}{a}", noise(r, 5))
            }
        },
        move |t| {
            let once = f(t);
            let twice = f(&once);
            if twice != once {
                return Err("not idempotent".into());
            }
            Ok(())
        },
        |t| format!("{:?}", cut(t, 300)),
    )
}

#[test]
fn s9_mask_protected_secret_after_each_separator() {
    let seps = [" ", "
", "	", "\"", "'", "(", "`", "|", "&&", ";", "$(", "[", "{", ",", "=", ":", ">", "/"];
    let mut bad: Vec<String> = vec![];
    for kind in 0..15u8 {
        let mut r = Rng::new(0xC0FFEE + kind as u64);
        let mut lost = vec![];
        for sep in seps {
            let (form, core) = secret_form(&mut r, kind);
            if kind == 14 && !(sep.trim().is_empty() || matches!(sep, "\"" | "'" | "(" | "`" | "$(")) {
                continue;
            }
            let text = format!("run{sep}{form} tail");
            let out = crate::mask::mask(&text);
            if leaked(&out, &core) {
                lost.push(format!("{sep:?}"));
            }
        }
        if !lost.is_empty() {
            let line = format!("kind {} survives after {}", kind_name(kind), lost.join(" "));
            println!("s9 MATRIX mask::mask {line}");
            bad.push(line);
        }
    }
    println!("s9 RESULT mask_protected_separator_matrix kinds=15 separators={} -> {}", seps.len(), if bad.is_empty() { "PASS" } else { "FAIL" });
    assert!(bad.is_empty(), "{bad:#?}");
}

#[test]
fn s9_mask_protected_secrets_hidden_and_idempotent() {
    finish(&secrets_campaign("mask_protected_secrets", 0x5EED_0010, crate::mask::mask, ALL_KINDS, false));
}

#[test]
fn s9_mask_protected_secrets_after_punctuation() {
    finish(&secrets_campaign("mask_protected_punct", 0x5EED_0011, crate::mask::mask, ALL_KINDS, true));
}

#[test]
fn s9_mask_protected_random_text_idempotent() {
    finish(&plain_campaign("mask_protected_plain", 0x5EED_0012, crate::mask::mask));
}

#[test]
fn s9_mask_diag_secrets_hidden_and_idempotent() {
    finish(&secrets_campaign("mask_diag_secrets", 0x5EED_0013, crate::diag::scrub, DIAG_KINDS, false));
}

#[test]
fn s9_mask_diag_random_text_idempotent() {
    finish(&plain_campaign("mask_diag_plain", 0x5EED_0014, crate::diag::scrub));
}

#[test]
fn s9_mask_diag_asia_session_key_hidden() {
    let mut r = Rng::new(0xA51A);
    let mut bad = vec![];
    for _ in 0..200 {
        let t = with_set(&mut r, b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16, 16);
        let out = crate::diag::scrub(&format!("aws sts key ASIA{t} end"));
        if out.contains(&t) {
            bad.push(format!("ASIA{t}"));
        }
    }
    println!("s9 RESULT diag_asia_key survivors={} of 200 -> {}", bad.len(), if bad.is_empty() { "PASS" } else { "FAIL" });
    assert!(bad.is_empty(), "{:?}", &bad[..bad.len().min(3)]);
}

#[test]
fn s9_mask_claude_key_hidden_and_idempotent() {
    finish(&secrets_campaign("mask_claude_key", 0x5EED_0015, crate::secrets::mask, &[1], true));
}

#[test]
fn s9_mask_claude_key_random_text_idempotent() {
    finish(&plain_campaign("mask_claude_key_plain", 0x5EED_0016, crate::secrets::mask));
}

#[test]
fn s9_mask_paths_hidden_and_idempotent() {
    let rep = campaign(
        "mask_paths",
        0x5EED_0017,
        CASES,
        |r| {
            let name = alnum(r, 8, 14);
            let drive = (b'A' + r.below(26) as u8) as char;
            let form = match r.below(4) {
                0 => format!("{drive}:\\Users\\{name}\\AppData\\Local\\kolux"),
                1 => format!("{drive}:/Users/{name}/proj/file.txt"),
                2 => format!("/home/{name}/proj/file.txt"),
                _ => format!("\\\\server\\share\\{name}\\x"),
            };
            MaskIn { text: format!("{} {form} {}", noise(r, 40), noise(r, 40)).replace(['\n', '\t'], " "), cores: vec![(99, name)] }
        },
        |m| {
            let once = crate::resources::update_care::scrub_paths(&m.text);
            for (_, c) in &m.cores {
                if once.contains(c.as_str()) {
                    return Err(format!("path part survives: {c:?}"));
                }
            }
            if crate::resources::update_care::scrub_paths(&once) != once {
                return Err("not idempotent".into());
            }
            Ok(())
        },
        mask_show,
    );
    finish(&rep);
}

// ---- time: one huge or hostile input per case ----

fn timed(name: &str, f: impl Fn(&str) -> String, pieces: &[(&str, String)], out: &mut Vec<String>) -> u32 {
    let mut slow = 0;
    for (label, text) in pieces {
        for scale in [1usize, 16] {
            let t = text.repeat(scale);
            let t0 = Instant::now();
            QUIET.with(|q| q.set(true));
            let res = catch_unwind(AssertUnwindSafe(|| f(&t)));
            QUIET.with(|q| q.set(false));
            let dt = t0.elapsed();
            let flag = if res.is_err() { "PANIC" } else if over_budget(t.len(), dt) { slow += 1; "SLOW" } else { "ok" };
            out.push(format!("s9 TIME {name} {label} x{scale} bytes={} ms={:.1} {flag}", t.len(), dt.as_secs_f64() * 1000.0));
            if dt > Duration::from_secs(20) {
                break;
            }
        }
    }
    slow
}

fn hostile_pieces() -> Vec<(&'static str, String)> {
    let mb = 1 << 20;
    vec![
        ("plain_1mb", "lorem ipsum dolor sit amet ".repeat(mb / 27)),
        ("bearer_run", "Bearer ".repeat(mb / 16 / 7) + &"A1".repeat(10)),
        ("sk_run", "sk-".repeat(mb / 16 / 3)),
        ("sk_one_long_token", format!("sk-{}", "a".repeat(mb / 16))),
        ("password_eq", "password=".repeat(mb / 16 / 9)),
        ("pem_open_no_end", format!("-----BEGIN PRIVATE KEY-----\n{}", "QUJD".repeat(mb / 16 / 4))),
        ("pem_many_begin", "-----BEGIN PRIVATE KEY-----\n".repeat(mb / 16 / 28)),
        ("url_scheme_run", "http://a:b@".repeat(mb / 16 / 11)),
        ("at_signs", "://".to_string() + &"@".repeat(mb / 16)),
        ("hidden_glue", "[hidden]sk-aaaaaaaaaaaaaaaaaaaaaa".repeat(mb / 16 / 32)),
        ("env_lines", "API_KEY=abcdef0123456789\n".repeat(mb / 16 / 25)),
        ("json_keys", "\"password\":\"x\",".repeat(mb / 16 / 15)),
        ("one_line_no_space", "x".repeat(mb / 16)),
        ("quotes", "\"'".repeat(mb / 16 / 2)),
        ("unicode", "😀é中\u{202e}\u{0301}".repeat(mb / 16 / 14)),
        ("newlines", "\n".repeat(mb / 16)),
        ("flags", "--token ".repeat(mb / 16 / 8)),
        ("labels", "token: ".repeat(mb / 16 / 7)),
    ]
}

fn time_test(name: &str, f: impl Fn(&str) -> String) -> Vec<String> {
    install_hook();
    let mut out = vec![];
    let slow = timed(name, f, &hostile_pieces(), &mut out);
    for l in &out {
        println!("{l}");
    }
    println!("s9 RESULT {name} hostile_inputs={} over_budget={slow} -> {}", out.len(), if slow == 0 && !out.iter().any(|l| l.ends_with("PANIC")) { "PASS" } else { "FAIL" });
    out
}

fn assert_time(out: &[String]) {
    let bad: Vec<_> = out.iter().filter(|l| !l.ends_with(" ok")).take(6).cloned().collect();
    assert!(bad.is_empty(), "{bad:#?}");
}

// Load flake fix: the 1 s/MiB bar is the optimized build's promise (debug runs 2-4x over it, more under
// load), so a debug run still fails on a panic but counts a SLOW line only in the opt-level 3 run.
fn assert_panic_free_and_timely_when_optimized(out: &[String]) {
    let timed = !cfg!(debug_assertions);
    let bad: Vec<_> = out.iter().filter(|l| !l.ends_with(" ok") && (timed || !l.ends_with(" SLOW"))).take(6).cloned().collect();
    assert!(bad.is_empty(), "{bad:#?}");
}

#[test]
fn s9_mask_protected_label_run_scaling() {
    install_hook();
    let mut worst = 0.0f64;
    for kb in [1usize, 2, 4, 8, 16, 32] {
        let text = "token: ".repeat(kb * 1024 / 7);
        let t0 = Instant::now();
        let _ = crate::mask::mask(&text);
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        worst = worst.max(ms);
        println!("s9 TIME mask_label_scaling bytes={} ms={ms:.1}", text.len());
        if ms > 5000.0 {
            break;
        }
    }
    println!("s9 RESULT time_protected_label_scaling worst_ms={worst:.1} -> {}", if worst <= 1000.0 { "PASS" } else { "FAIL" });
    // Load flake fix: the bound is the optimized build's promise; a debug run (2-4x slower, more under load) only has to finish.
    assert!(cfg!(debug_assertions) || worst <= 1000.0, "mask of a 32 KB run of \"token: \" took {worst:.0} ms");
}

#[test]
#[cfg_attr(debug_assertions, ignore = "S9 timing: judged by the opt-level 3 run; unoptimised mask is 2-4x over 1 s/MiB")]
fn s9_mask_protected_hostile_size_time() {
    assert_time(&time_test("time_protected_mask", crate::mask::mask));
}

#[test]
fn s9_mask_diag_hostile_size_time() {
    assert_panic_free_and_timely_when_optimized(&time_test("time_diag_scrub", crate::diag::scrub));
}

#[test]
fn s9_hook_hostile_size_time() {
    install_hook();
    let mut lines = vec![];
    let big = |n: usize| "A".repeat(n);
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("prompt_1mb", format!("{{\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"{}\"}}", big(1 << 20)).into_bytes()),
        ("prompt_whitespace_1mb", format!("{{\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"{}\"}}", "a ".repeat(1 << 19)).into_bytes()),
        ("tool_1mb", format!("{{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"{}\",\"tool_input\":{{\"command\":\"{}\"}}}}", big(1 << 20), big(1 << 20)).into_bytes()),
        ("nest_127", format!("{{\"hook_event_name\":\"PreToolUse\",\"tool_input\":{}1{}}}", "[".repeat(125), "]".repeat(125)).into_bytes()),
        ("nest_10k", format!("{{\"hook_event_name\":\"PreToolUse\",\"tool_input\":{}1{}}}", "[".repeat(10_000), "]".repeat(10_000)).into_bytes()),
        ("keys_100k", { let mut s = String::from("{\"hook_event_name\":\"Stop\""); for i in 0..100_000 { s.push_str(&format!(",\"k{i}\":{i}")); } s.push('}'); s.into_bytes() }),
        ("dup_keys_100k", { let mut s = String::from("{"); for _ in 0..100_000 { s.push_str("\"hook_event_name\":\"Stop\","); } s.push_str("\"a\":1}"); s.into_bytes() }),
        ("array_1m", format!("{{\"hook_event_name\":\"Stop\",\"x\":[{}0]}}", "0,".repeat(1 << 20)).into_bytes()),
    ];
    let mut slow = 0;
    for (label, body) in &cases {
        let t0 = Instant::now();
        QUIET.with(|q| q.set(true));
        let res = catch_unwind(AssertUnwindSafe(|| {
            if let Ok(v) = serde_json::from_slice::<Value>(body) {
                let _ = hooks::claude_change(&v);
                let _ = hooks::codex_change(&v);
            }
            let req = request_with("/claude", body.clone(), "e30=".into());
            let _ = hooks::usage(&req, "tok");
        }));
        QUIET.with(|q| q.set(false));
        let dt = t0.elapsed();
        let flag = if res.is_err() { "PANIC" } else if over_budget(body.len(), dt) { slow += 1; "SLOW" } else { "ok" };
        lines.push(format!("s9 TIME hook {label} bytes={} ms={:.1} {flag}", body.len(), dt.as_secs_f64() * 1000.0));
    }
    for l in &lines {
        println!("{l}");
    }
    println!("s9 RESULT time_hook_parsers hostile_inputs={} over_budget={slow} -> {}", lines.len(), if lines.iter().all(|l| l.ends_with(" ok")) { "PASS" } else { "FAIL" });
    assert_panic_free_and_timely_when_optimized(&lines);
}

#[test]
fn s9_osc_hostile_size_time() {
    install_hook();
    let mut lines = vec![];
    let mb = 1usize << 20;
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("inband_pad_1mb", format!("\x1b]9999;{{\"state\":\"idle\",\"pad\":\"{}\"}}\x07", "p".repeat(mb)).into_bytes()),
        ("inband_deep_10k", format!("\x1b]9999;{}{}\x07", "[".repeat(10_000), "]".repeat(10_000)).into_bytes()),
        ("inband_esc_run", vec![0x1b; mb]),
        ("inband_digits_1mb", format!("\x1b]{};x\x07", "9".repeat(mb)).into_bytes()),
        ("screen_owner_esc_run", [b"\x1b[?".repeat(mb / 3)].concat()),
        ("screen_owner_digits_1mb", [b"\x1b[?".to_vec(), vec![b'1'; mb], b"h".to_vec()].concat()),
        ("screen_owner_digits_short", b"\x1b[?99999999999h".to_vec()),
        ("screen_owner_no_final", [b"\x1b[?1049".to_vec(), vec![b'0'; mb]].concat()),
    ];
    let mut slow = 0;
    for (label, body) in &cases {
        let t0 = Instant::now();
        QUIET.with(|q| q.set(true));
        let res = catch_unwind(AssertUnwindSafe(|| {
            let _ = crate::status::parse_inband(body);
            let _ = crate::terminal::screen_owner(0, body);
            let _ = crate::pty::is_reply(body);
        }));
        QUIET.with(|q| q.set(false));
        let dt = t0.elapsed();
        let flag = if res.is_err() { "PANIC" } else if over_budget(body.len(), dt) { slow += 1; "SLOW" } else { "ok" };
        let site = if res.is_err() { WHERE.with(|w| w.borrow().clone()) } else { String::new() };
        lines.push(format!("s9 TIME osc {label} bytes={} ms={:.1} {flag} {}", body.len(), dt.as_secs_f64() * 1000.0, cut(&site, 200)));
    }
    for l in &lines {
        println!("{l}");
    }
    println!("s9 RESULT time_osc_parsers hostile_inputs={} over_budget={slow} -> {}", lines.len(), if lines.iter().all(|l| l.contains(" ok")) { "PASS" } else { "FAIL" });
    // Load flake fix: a SLOW line counts only in the opt-level 3 run; a panic fails in every build.
    let timed = !cfg!(debug_assertions);
    let bad: Vec<_> = lines.iter().filter(|l| !l.contains(" ok") && (timed || !l.contains(" SLOW"))).cloned().collect();
    assert!(bad.is_empty(), "{bad:#?}");
}
