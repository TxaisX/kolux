//! The command table, the typo suggestions and the argument parser for `kolux` / `kolux-dev`.
//!
//! Split out of `cli.rs` with no behaviour change; see docs/research/rust-cli-split.md.

use super::*;

// ---------------------------------------------------------------- the command line

/// A parsed call: the command's wire name, its flags as JSON, and whether `--json` was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub command: String,
    pub args: Map<String, Value>,
}


pub(super) const SWITCHES: &[&str] = &["force", "activate", "run-hooks", "no-parent", "takeover-legacy", "unread", "peek", "all", "format", "wait", "full", "ready", "brief", "inject", "dry-run", "return-preamble", "preamble", "tasks", "messages", "reuse-session", "fresh-session", "enabled", "disabled", "references", "focus", "include-visual-layouts", "tab", "screen", "enter", "interrupt", "usage", "staged", "secure", "http-only", "local", "show-profile", "no-ua-spoof", "httpOnly", "mobile"];
/// switch; stop is the old word for close, kept out of the help.
pub(super) const TERMINAL: &[(&str, &str, &[&str])] = &[
    ("terminal list", "terminal.list", &["worktree", "limit", "include-visual-layouts"]),
    ("terminal show", "terminal.show", &["terminal"]),
    ("terminal create", "terminal.create", &["worktree", "command", "title", "focus"]),
    ("terminal split", "terminal.split", &["terminal", "direction", "command"]),
    ("terminal rename", "terminal.rename", &["terminal", "title"]),
    ("terminal switch", "terminal.switch", &["terminal"]),
    ("terminal focus", "terminal.switch", &["terminal"]),
    ("terminal close", "terminal.close", &["terminal", "tab", "worktree", "all"]),
    ("terminal stop", "terminal.close", &["terminal", "tab", "worktree", "all"]),
];
/// CLI-027: what the retired word says.
/// CLI-026 with T-550: what replaced terminal stop, under the name this build answers to.
pub(super) fn stop_gone() -> String {
    format!("terminal stop was replaced by terminal close: use {} terminal close --worktree <selector> --all, or --terminal <handle>", crate::orchestration::CLI)
}
/// ORCH-001..006, ORCH-010, ORCH-011, ORCH-013 / CLI-030..032, CLI-034: the mail and task commands
/// and their flags. `--dispatch-capability` is accepted and unused until the dispatch pass (ORCH-067, T-155).
pub(super) const MAIL: &[(&str, &str, &[&str])] = &[
    ("orchestration run-create", "orchestration.run-create", &["objective", "from", "retry-request"]),
    ("orchestration run-use", "orchestration.run-use", &["id", "from", "takeover-legacy", "retry-request"]),
    ("orchestration run-current", "orchestration.run-current", &["from"]),
    ("orchestration run-list", "orchestration.run-list", &["limit", "cursor"]),
    ("orchestration run-show", "orchestration.run-show", &["id"]),
    // ORCH-030: what became of a request sent with --retry-request.
    ("orchestration request-show", "orchestration.request-show", &["request", "from"]),
    ("orchestration send", SEND, &["to", "run", "from", "subject", "body", "type", "priority", "thread-id", "payload", "task-id", "dispatch-id", "dispatch-capability", "retry-request", "outcome", "files-modified", "report-path", "phase"]),
    ("orchestration check", CHECK, &["terminal", "run", "ack", "unread", "peek", "all", "types", "format", "wait", "timeout-ms", "retry-request"]),
    ("orchestration reply", "orchestration.reply", &["id", "body", "run", "from", "retry-request"]),
    ("orchestration inbox", "orchestration.inbox", &["limit", "terminal", "full"]),
    ("orchestration ask", ASK, &["question", "resume", "options", "timeout-ms", "to", "run", "from", "retry-request", "dispatch-capability"]),
    ("orchestration gate-create", "orchestration.gate-create", &["task", "question", "options", "run", "from", "retry-request"]),
    ("orchestration gate-resolve", "orchestration.gate-resolve", &["id", "resolution", "run", "from", "retry-request"]),
    ("orchestration gate-list", "orchestration.gate-list", &["task", "status", "run", "from"]),
    ("orchestration reset", RESET, &["all", "tasks", "messages"]),
    ("orchestration task-create", "orchestration.task-create", &["spec", "task-title", "display-name", "deps", "parent", "run", "from", "retry-request"]),
    ("orchestration task-list", "orchestration.task-list", &["status", "ready", "brief", "run", "from"]),
    ("orchestration task-update", UPDATE, &["id", "status", "result", "run", "from", "retry-request"]),
    ("orchestration task-reset", TASK_RESET, &["id", "run", "from", "retry-request"]),
    ("orchestration dispatch", "orchestration.dispatch", &["task", "to", "from", "run", "inject", "dry-run", "return-preamble", "max-depth", "retry-request"]),
    ("orchestration dispatch-show", "orchestration.dispatch-show", &["task", "preamble", "from"]),
    ("orchestration worker-abandon", ABANDON, &["dispatch", "run", "from", "retry-request"]),
    ("orchestration worker-stop", STOP, &["dispatch", "run", "from", "retry-request"]),
    ("orchestration worker-list", WORKER_LIST, &["run", "terminal-state", "cursor", "limit", "from"]),
    ("orchestration worker-retain", RETAIN, &["dispatch", "run", "from", "retry-request"]),
    ("orchestration worker-release", RELEASE, &["dispatch", "run", "from", "retry-request"]),
    ("orchestration worker-show", WORKER_SHOW, &["dispatch", "run", "from"]),
    ("orchestration worker-read", WORKER_READ, &["dispatch", "source", "cursor", "limit", "run", "from"]),
];
/// CLI-038: the orchestration changes. Each carries a request id that lasts, so a change whose
/// answer was lost can be sent again and still take effect no more than once.
/// Row 877: every orchestration command that saves (check too: it acks what it hands out); an unread mail refuses these before any change.
pub(super) const MAIL_WRITES: &[&str] = &["orchestration.run-create", "orchestration.run-use", SEND, "orchestration.reply", ASK, RESET, CHECK, "orchestration.task-create", "orchestration.dispatch", ABANDON, UPDATE, TASK_RESET, STOP, RETAIN, RELEASE, "orchestration.gate-create", "orchestration.gate-resolve"];
pub(super) const CHANGES: &[&str] = &["orchestration.run-create", "orchestration.run-use", SEND, "orchestration.reply", "orchestration.task-create", "orchestration.dispatch", WORKER_START];
pub(super) const VERSION: &str = env!("CARGO_PKG_VERSION");
/// CLI-024 / CLI-025: reading, typing into and waiting on a terminal by its handle.
pub(super) const TERM: &[(&str, &str, &[&str])] = &[
    ("terminal read", "terminal.read", &["terminal", "cursor", "limit", "screen"]),
    ("terminal send", "terminal.send", &["terminal", "text", "enter", "interrupt", "wait-submit", "retry-request"]),
    ("terminal wait", "terminal.wait", &["terminal", "for", "timeout-ms"]),
];
/// CLI-015..017: the repo, project and worktree lookups and their flags.
pub(super) const QUERY: &[(&str, &str, &[&str])] = &[
    ("repo list", "repo.list", &[]),
    ("repo add", "repo.add", &["path"]),
    ("repo show", "repo.show", &["repo"]),
    ("repo set-base-ref", "repo.set-base-ref", &["repo", "ref"]),
    ("repo search-refs", "repo.search-refs", &["repo", "query", "limit"]),
    ("project list", "project.list", &[]),
    ("worktree list", "worktree.list", &["repo", "limit"]),
    ("worktree ps", "worktree.ps", &["repo", "limit"]),
    ("worktree show", "worktree.show", &["worktree", "usage"]),
    ("worktree current", "worktree.current", &["usage"]),
    ("worktree changes", "worktree.changes", &["worktree"]),
    ("worktree overlap", "worktree.overlap", &["worktree"]),
];
pub(super) const SEND: &str = "orchestration.send";
pub(super) const ABANDON: &str = "orchestration.worker-abandon";
pub(super) const UPDATE: &str = "orchestration.task-update";
pub(super) const TASK_RESET: &str = "orchestration.task-reset";
pub(super) const STOP: &str = "orchestration.worker-stop";
pub(super) const WORKER_LIST: &str = "orchestration.worker-list";
pub(super) const RETAIN: &str = "orchestration.worker-retain";
pub(super) const RELEASE: &str = "orchestration.worker-release";
pub(super) const WORKER_SHOW: &str = "orchestration.worker-show";
pub(super) const WORKER_READ: &str = "orchestration.worker-read";
/// ORCH-033: the orchestration reads; another Run may be named to read it, never to change it.
pub(super) const READS: &[&str] = &["orchestration.task-list", "orchestration.dispatch-show", "orchestration.gate-list", WORKER_LIST, WORKER_SHOW, WORKER_READ];
pub(super) const CHECK: &str = "orchestration.check";
pub(super) const ASK: &str = "orchestration.ask";
pub(super) const RESET: &str = "orchestration.reset";
pub(super) const SCOPES: [&str; 3] = ["all", "tasks", "messages"];
/// How long `check --wait` waits when no timeout is given, and how often it says it is alive.
pub(super) const WAIT_DEFAULT_MS: u64 = 300_000;
pub(super) const KEEPALIVE_MS: u64 = 15_000;

/// `--retry-request` becomes `retryRequest`.
pub(super) fn camel(k: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in k.chars() {
        if c == '-' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}
/// CLI-019: what `worktree set` changes, and its flags.
pub(super) const SET: &str = "worktree.set";
pub(super) const SET_FIELDS: &[&str] = &["display-name", "issue", "comment", "workspace-status", "parent-worktree", "no-parent"];
pub(super) const SET_FLAGS: &[&str] = &["worktree", "display-name", "issue", "comment", "workspace-status", "parent-worktree", "no-parent"];
pub(super) const CREATE_FLAGS: &[&str] = &["name", "repo", "agent", "prompt", "setup", "base-branch", "issue", "comment", "parent-worktree", "no-parent", "run-hooks", "activate"];
pub(super) const RM_FLAGS: &[&str] = &["worktree", "force", "run-hooks"];
pub(super) const WORKER_START: &str = "orchestration.worker-start";
pub(super) const WORKER_FLAGS: &[&str] = &["task", "spec", "task-title", "deps", "parent", "worktree", "name", "repo", "base-branch", "display-name", "comment", "setup", "agent", "model", "effort", "terminal", "tier", "retry-of", "timeout-ms", "max-depth", "run", "from", "retry-request"];
pub(super) const TIERS: &[&str] = &["major", "deep", "build", "light"];
pub(super) const NEW_TOP: &str = "new-top-level";
pub(super) const NEW_CHILD: &str = "new-child";
pub(super) const OPEN_FLAGS: &[&str] = &[];
/// How long `open` waits for an app it started to answer.
pub(super) const OPEN_LIMIT: Duration = Duration::from_secs(60);

pub(super) type Command = (&'static str, &'static str, &'static [&'static str]);

/// Every command path with its wire name and flags, aliases included (CLI-003 suggests from it).
pub(super) fn commands() -> Vec<Command> {
    let mut all: Vec<Command> = vec![
        ("worktree create", "worktree.create", CREATE_FLAGS),
        ("worktree set", SET, SET_FLAGS),
        ("worktree rm", "worktree.rm", RM_FLAGS),
        ("worktree remove", "worktree.rm", RM_FLAGS),
        ("worktree delete", "worktree.rm", RM_FLAGS),
        ("orchestration worker-start", WORKER_START, WORKER_FLAGS),
        ("account add", cli_accounts::ADD, &["agent"] as &[&str]),
        ("account list", cli_accounts::LIST, &[] as &[&str]),
        ("open", "app.open", OPEN_FLAGS),
        ("status", STATUS, OPEN_FLAGS),
        ("diagnostics memory", MEMORY, OPEN_FLAGS),
    ];
    all.extend(QUERY.iter().copied());
    all.extend(TERM.iter().copied());
    all.extend(MAIL.iter().copied());
    all.extend(TERMINAL.iter().copied());
    all.extend(automations_cli::COMMANDS.iter().copied());
    all.extend(local_cli::COMMANDS.iter().copied());
    all.extend(file_cli::COMMANDS.iter().copied());
    // T-312 (ORCH-062..064): the runtime commands for files, git, past sessions and automations.
    all.extend(crate::orchestration::runtime::COMMANDS.iter().copied());
    // T-195 (BROW-042, BROW-046, BROW-047), T-241 (BROW-044, BROW-045, BROW-048): the browser commands live in browser.rs's own cli module.
    all.extend(crate::browser::cli::COMMANDS.iter().copied());
    all
}

/// Flags that collect every value given instead of keeping one.
pub(super) const REPEATABLE: &[&str] = &["skill"];
/// CLI-020: the verbs a typo is never pointed at from more than one edit away.
pub(super) const DESTRUCTIVE: &[&str] = &["rm", "remove", "delete"];

/// Does some command take `--name`? (The retired `--parent-workspace` still takes its value.)
pub(super) fn known_flag(name: &str) -> bool {
    name == "parent-workspace" || commands().iter().any(|c| c.2.contains(&name))
}

/// Edits between two words, when three or fewer; words over 32 characters are not measured.
pub(super) fn near(a: &str, b: &str) -> Option<usize> {
    if a.chars().count() > 32 {
        return None;
    }
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diag = row[0];
        row[0] = i + 1;
        for j in 0..b.len() {
            let up = row[j + 1];
            row[j + 1] = (diag + usize::from(ca != b[j])).min(row[j] + 1).min(up + 1);
            diag = up;
        }
    }
    Some(row[b.len()]).filter(|d| *d <= 3)
}

/// The nearest word to `typed`, the first on a tie; destructive words only from one edit away.
pub(super) fn nearest<'a>(typed: &str, from: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    from.into_iter().filter_map(|c| near(typed, c).filter(|d| *d == 1 || (*d > 1 && !DESTRUCTIVE.contains(&c))).map(|d| (d, c))).min_by_key(|(d, _)| *d).map(|(_, c)| c)
}

/// The words as one line to run again, quoting any word with a space in it.
pub(super) fn line(words: &[String]) -> String {
    let quoted: Vec<String> = words.iter().map(|w| if w.contains(char::is_whitespace) { format!("\"{w}\"") } else { w.clone() }).collect();
    format!("{} {}", crate::orchestration::CLI, quoted.join(" "))
}

/// CLI-003: a command path nothing answers to. A wrong group is matched against group names, a
/// wrong verb against that group's verbs.
pub(super) fn command_typo(words: &[String], path: &[String], at: &[usize], all: &[Command]) -> Fail {
    let joined = path.join(" ");
    let mut groups: Vec<&str> = Vec::new();
    for c in all {
        let g = c.0.split(' ').next().unwrap_or_default();
        if !groups.contains(&g) {
            groups.push(g);
        }
    }
    let verbs = |g: &str| all.iter().filter_map(|c| c.0.strip_prefix(g).and_then(|r| r.strip_prefix(' '))).collect::<Vec<_>>();
    let (unknown, fix): (&str, Option<Vec<String>>) = if !groups.contains(&path[0].as_str()) {
        let fix = nearest(&path[0], groups.iter().copied()).map(|g| {
            let fits = path.get(1).is_some_and(|v| verbs(g).contains(&v.as_str()));
            let mut p = vec![g.to_string()];
            if fits {
                p.push(path[1].clone());
            }
            p
        });
        (&path[0], fix)
    } else if path.len() == 1 {
        let mut f = Fail::args(format!("`{joined}` needs a command after it: {}", verbs(&path[0]).join(", ")));
        f.data = json!({ "unknown": joined, "command": joined, "suggestions": [], "nextSteps": [format!("{} --help", crate::orchestration::CLI)] });
        return f;
    } else if verbs(&path[0]).contains(&path[1].as_str()) {
        let mut f = Fail::args(format!("unknown command `{joined}`: `{}` is not part of {} {}", path[2], path[0], path[1]));
        f.data = json!({ "unknown": path[2], "command": joined, "suggestions": [], "nextSteps": [format!("{} --help", crate::orchestration::CLI)] });
        return f;
    } else {
        (&path[1], nearest(&path[1], verbs(&path[0])).map(|v| vec![path[0].clone(), v.to_string()]))
    };
    let said = fix.as_ref().map(|p| p.join(" "));
    let next: Vec<String> = match &fix {
        Some(p) if p.len() == 2 => {
            let mut w = words.to_vec();
            w[at[0]] = p[0].clone();
            w[at[1]] = p[1].clone();
            for &k in at.iter().skip(2).rev() {
                w.remove(k);
            }
            vec![line(&w)]
        }
        _ => vec![format!("{} --help", crate::orchestration::CLI)],
    };
    let tail = said.as_ref().map(|p| format!("; did you mean {p}?")).unwrap_or_else(|| format!("; run {} --help", crate::orchestration::CLI));
    let mut f = Fail::args(format!("unknown command `{joined}`: `{unknown}` is not a command word here{tail}"));
    f.data = json!({ "unknown": unknown, "command": joined, "suggestions": said.into_iter().collect::<Vec<_>>(), "nextSteps": next });
    f
}

/// CLI-003: a flag this command does not take: the nearest one it does, and the whole list.
pub(super) fn flag_typo(words: &[String], spots: &[(String, usize)], command: &str, allowed: &[&str], k: &str) -> Fail {
    let mut takes: Vec<&str> = allowed.to_vec();
    takes.push("json");
    let listed: Vec<String> = takes.iter().map(|f| format!("--{f}")).collect();
    // The caller flag of check was renamed; only there is --from pointed at --terminal.
    let renamed = command == "orchestration check" && k == "from";
    let fix = if renamed { Some("terminal") } else { nearest(k, takes.iter().copied()) };
    let message = match fix {
        _ if renamed => format!("--from was renamed on {command}: name the terminal with --terminal <handle>"),
        Some(f) => format!("unknown flag --{k} for {command}; did you mean --{f}?"),
        None => format!("unknown flag --{k} for {command}"),
    };
    let next: Vec<String> = fix.and_then(|f| spots.iter().find(|(n, _)| n == k).map(|&(_, i)| (f, i))).map(|(f, i)| {
        let mut w = words.to_vec();
        w[i] = match w[i].split_once('=') {
            Some((_, v)) => format!("--{f}={v}"),
            None => format!("--{f}"),
        };
        line(&w)
    }).into_iter().collect();
    let mut f = Fail::args(message);
    f.data = json!({ "unknown": format!("--{k}"), "command": command, "suggestions": fix.map(|f| format!("--{f}")).into_iter().collect::<Vec<_>>(), "nextSteps": next, "flags": listed, "hint": format!("{command} takes: {}", listed.join(", ")) });
    f
}

/// C26-R4-01: a switch's value. Bare is on; `=true|1|yes|on` is on and `=false|0|no|off` is off, so
/// `--force=false` can never force and `--all=false` can never close everything. Any other word is
/// refused rather than guessed, so a value never silently inverts what was written.
fn switch_value(name: &str, inline: Option<&str>) -> Result<bool, Fail> {
    match inline.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None => Ok(true),
        Some("true" | "1" | "yes" | "on") => Ok(true),
        Some("false" | "0" | "no" | "off") => Ok(false),
        Some(v) => Err(Fail::args(format!("--{name} takes true or false, not {v}"))),
    }
}

/// C26-R4-01: a switch counts as given only when it is on, so `--all=false` is not `--all` at the
/// guards that ask whether a switch is present. Value flags are untouched.
fn switched_on(flags: &Map<String, Value>, k: &str) -> bool {
    flags.get(k).is_some_and(|v| v != &Value::Bool(false))
}

/// Parses the words after the program name. The `--json` flag is reported even when the rest is
/// refused, so the refusal can be printed in the asked-for shape. `Ok(None)` means help was
/// printed to stdout.
pub fn parse(words: &[String]) -> (bool, Result<Option<Parsed>, Fail>) {
    let mut json = false;
    let mut help = false;
    let mut path: Vec<String> = Vec::new();
    let mut flags: Map<String, Value> = Map::new();
    let mut spots: Vec<(String, usize)> = Vec::new();
    let mut at: Vec<usize> = Vec::new();
    let mut i = 0;
    let inner = (|| {
        while i < words.len() {
            let w = &words[i];
            i += 1;
            if w == "--" && path.is_empty() {
                continue;
            }
            if let Some(flag) = w.strip_prefix("--") {
                let (name, inline) = match flag.split_once('=') {
                    Some((n, v)) => (n.to_string(), Some(v.to_string())),
                    None => (flag.to_string(), None),
                };
                match name.as_str() {
                    "json" => json = switch_value(&name, inline.as_deref())?,
                    "help" => help = switch_value(&name, inline.as_deref())?,
                    _ => {
                        spots.push((name.clone(), i - 1));
                        // CLI-003: a flag no command takes has no value to take, so a typo ahead
                        // of the command words never swallows one of them.
                        let value = if SWITCHES.contains(&name.as_str()) {
                            // C26-R4-01: the equals form carries an on/off word for a switch too.
                            Value::Bool(switch_value(&name, inline.as_deref())?)
                        } else if inline.is_none() && !known_flag(&name) {
                            Value::Bool(true)
                        } else if let Some(v) = inline {
                            Value::String(v)
                        } else if i < words.len() && !words[i].starts_with("--") {
                            i += 1;
                            Value::String(words[i - 1].clone())
                        } else {
                            return Err(Fail::args(format!("--{name} needs a value")));
                        };
                        // CLI-002: a repeatable flag (--skill) collects every value given.
                        if REPEATABLE.contains(&name.as_str()) {
                            let list = flags.entry(name).or_insert_with(|| json!([]));
                            if let (Some(list), Some(v)) = (list.as_array_mut(), value.as_str()) {
                                list.push(json!(v));
                            }
                            continue;
                        }
                        if let Some(old) = flags.get(&name) {
                            if *old != value {
                                return Err(Fail::args(format!("--{name} was given twice with different values")));
                            }
                        }
                        flags.insert(name, value);
                    }
                }
            } else if w == "-h" || (w == "help" && path.is_empty()) {
                help = true;
            } else {
                path.push(w.clone());
                at.push(i - 1);
            }
        }
        if help || path.is_empty() {
            return Ok(None);
        }
        // CLI-028 / CLI-043: an automation id, or a skill topic, may be given bare after the verb.
        if let Some(flag) = local_cli::bare(&path) {
            let v = Value::String(path.pop().unwrap_or_default());
            at.pop();
            if flags.get(flag).is_some_and(|old| *old != v) {
                return Err(Fail::args(format!("the {flag} was given twice with different values")));
            }
            flags.insert(flag.into(), v);
        }
        let joined = path.join(" ");
        let all = commands();
        // A flag no command takes left its would-be value among the words; the first two still
        // name the command it was typed against.
        let lead = path.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
        let stray = flags.keys().any(|k| !known_flag(k));
        let Some(&(joined, command, allowed)) = all.iter().find(|c| c.0 == joined).or_else(|| all.iter().find(|c| stray && c.0 == lead)) else {
            return Err(command_typo(words, &path, &at, &all));
        };
        if command == "worktree.create" && flags.contains_key("parent-workspace") {
            return Err(Fail::args("--parent-workspace was retired; use --parent-worktree <selector>"));
        }
        if let Some(k) = flags.keys().find(|k| !allowed.contains(&k.as_str())) {
            if command.starts_with("account.") && k != "agent" {
                // ACCT-031 / CLI-014: environments, pairing codes and remote targets are refused.
                return Err(Fail::args(format!("account commands always run on this machine; --{k} is not taken")));
            }
            return Err(flag_typo(words, &spots, joined, allowed, k));
        }
        let text = |k: &str| flags.get(k).and_then(Value::as_str);
        let empty = |k: &str| text(k).is_some_and(|v| v.trim().is_empty());
        let mut args = Map::new();
        if command == "worktree.create" {
            if text("name").map(str::trim).unwrap_or_default().is_empty() && text("issue").map(str::trim).unwrap_or_default().is_empty() {
                return Err(Fail::args("--name is required (or --issue, to name it after the issue)"));
            }
            for k in ["agent", "prompt", "setup", "parent-worktree"] {
                if empty(k) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
            }
            if text("issue").is_some_and(|v| v.trim().parse::<u64>().map_or(true, |n| n == 0)) {
                return Err(Fail::args("--issue takes a GitHub issue number"));
            }
            let setup = text("setup").unwrap_or("inherit");
            if !["run", "skip", "inherit"].contains(&setup) {
                return Err(Fail::args("--setup takes run, skip or inherit"));
            }
            if switched_on(&flags, "run-hooks") && setup == "skip" {
                return Err(Fail::args("--run-hooks runs the setup scripts; it cannot go with --setup skip"));
            }
            if switched_on(&flags, "no-parent") && flags.contains_key("parent-worktree") {
                return Err(Fail::args("--no-parent and --parent-worktree disagree; pass one of them"));
            }
            for (k, v) in &flags {
                let key = match k.as_str() {
                    "base-branch" => "baseBranch",
                    "parent-worktree" => "parentWorktree",
                    "no-parent" => "noParent",
                    "run-hooks" => "runHooks",
                    other => other,
                };
                args.insert(key.to_string(), v.clone());
            }
            args.insert("setup".into(), Value::String(setup.into()));
            if switched_on(&flags, "run-hooks") {
                args.insert("activate".into(), Value::Bool(true));
            }
        } else if command == SET {
            // CLI-019: refused before any lookup.
            if switched_on(&flags, "no-parent") && flags.contains_key("parent-worktree") {
                return Err(Fail::args("--no-parent and --parent-worktree disagree; pass one of them"));
            }
            for k in ["worktree", "display-name", "parent-worktree", "workspace-status"] {
                if empty(k) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
            }
            if text("issue").map(str::trim).is_some_and(|v| v != "null" && v.parse::<u64>().map_or(true, |n| n == 0)) {
                return Err(Fail::args("--issue takes a GitHub issue number, or null to remove the link"));
            }
            if !SET_FIELDS.iter().any(|k| switched_on(&flags, *k)) {
                return Err(Fail::args("nothing to set; pass --display-name, --issue, --comment, --workspace-status, --parent-worktree or --no-parent"));
            }
            for (k, v) in &flags {
                args.insert(camel(k), v.clone());
            }
        } else if command == WORKER_START {
            check_worker_start(&flags)?;
            for (k, v) in &flags {
                let key = match k.as_str() {
                    "task-title" => "taskTitle",
                    "base-branch" => "baseBranch",
                    "display-name" => "displayName",
                    "retry-of" => "retryOf",
                    "timeout-ms" => "timeoutMs",
                    "max-depth" => "maxDepth",
                    "retry-request" => "retryRequest",
                    other => other,
                };
                args.insert(key.to_string(), v.clone());
            }
            args.entry("setup").or_insert_with(|| Value::String("inherit".into()));
            args.entry("worktree").or_insert_with(|| Value::String(NEW_TOP.into()));
        } else if command == cli_accounts::ADD {
            let agent = text("agent").unwrap_or("claude").trim().to_lowercase();
            if agent.is_empty() {
                return Err(Fail::args("--agent cannot be empty; name claude or codex, or leave it out for Claude"));
            }
            if !cli_accounts::AGENTS.contains(&agent.as_str()) {
                return Err(Fail::args(format!("account add signs in claude or codex, not {agent}")));
            }
            args.insert("agent".into(), Value::String(agent));
        } else if command == cli_accounts::LIST {
        } else if command.starts_with("orchestration.") {
            for (k, v) in &flags {
                if v.as_str().is_some_and(|s| s.trim().is_empty()) && !["body", "from"].contains(&k.as_str()) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
                args.insert(camel(k), v.clone());
            }
            let need = |k: &str, what: &str| if text(k).is_none() { Err(Fail::args(format!("--{k} is required{what}"))) } else { Ok(()) };
            match command {
                "orchestration.run-create" => need("objective", ": say what the Run is for")?,
                "orchestration.run-use" | "orchestration.run-show" => need("id", "")?,
                SEND => {
                    need("subject", "")?;
                    // CLI-031: refused here, before the sender is worked out.
                    let kind = text("type").map(str::trim).unwrap_or("status");
                    if ["worker_done", "heartbeat"].contains(&kind) && text("to").is_some_and(|t| t.trim().starts_with('@')) {
                        return Err(Fail::args("done reports and heartbeats go to exactly one dispatch, never to a group; send them to run:<id> or dispatch:<id>"));
                    }
                    // CLI-006: Windows PowerShell 5.1 drops the double quotes inside JSON it hands to a
                    // program; say so rather than send something else.
                    if let Some(p) = text("payload").filter(|p| serde_json::from_str::<Value>(p).is_err()) {
                        return Err(Fail::args(if quotes_lost(p) {
                            "--payload lost its double quotes on the way in, which Windows PowerShell 5.1 does to JSON passed to a program; escape each inner quote as \\\" or run the command from PowerShell 7 (pwsh)"
                        } else {
                            "--payload takes JSON"
                        }));
                    }
                    if text("payload").is_some() {
                        if let Some(k) = ["task-id", "dispatch-id", "files-modified", "report-path", "phase"].into_iter().find(|k| flags.contains_key(*k)) {
                            return Err(Fail::args(format!("give the payload as flags (--{k}) or as --payload JSON, not both")));
                        }
                    }
                }
                "orchestration.reply" => {
                    need("id", "")?;
                    need("body", "")?
                }
                RESET if SCOPES.iter().filter(|k| switched_on(&flags, **k)).count() != 1 => return Err(Fail::args("reset needs exactly one scope: --all, --tasks or --messages")),
                ASK => match (text("question").is_some(), text("resume").is_some()) {
                    (true, true) => return Err(Fail::args("give --question or --resume, not both")),
                    (false, false) => return Err(Fail::args("--question is required (or --resume <message> to wait on one already asked)")),
                    _ => {}
                },
                "orchestration.gate-create" => {
                    need("task", "")?;
                    need("question", ": say what needs deciding")?
                }
                "orchestration.gate-resolve" => {
                    need("id", "")?;
                    need("resolution", ": say what was decided")?
                }
                "orchestration.task-create" => need("spec", ": say what the task is")?,
                "orchestration.dispatch" => {
                    need("task", "")?;
                    if !switched_on(&flags, "dry-run") {
                        need("to", ": name the agent terminal, like term-3")?
                    }
                }
                "orchestration.dispatch-show" => need("task", "")?,
                ABANDON | STOP | RETAIN | RELEASE | WORKER_SHOW | WORKER_READ => need("dispatch", ": name the dispatch, like dispatch-2")?,
                WORKER_LIST => {
                    // ORCH-026: a page holds 1 to 100 workers; the terminal states are a closed set.
                    if text("limit").and_then(|v| v.parse::<u64>().ok()).is_some_and(|n| n > 100) {
                        return Err(Fail::args("--limit takes 1 to 100"));
                    }
                    if let Some(st) = text("terminal-state").filter(|v| !crate::orchestration::TERMINAL_STATES.contains(&v.trim())) {
                        return Err(Fail::args(format!("--terminal-state is one of {}, not {st}", crate::orchestration::TERMINAL_STATES.join(", "))));
                    }
                }
                "orchestration.request-show" => need("request", ": the --retry-request id of the change")?,
                TASK_RESET => need("id", ": name the held task, like task-2")?,
                UPDATE => {
                    need("id", ": name the task, like task-2")?;
                    need("status", ": one of pending, ready, dispatched, completed, failed, blocked")?
                }
                _ => {}
            }
            for k in ["retry-request", "request"] {
                if text(k).is_some_and(|v| !is_uuid(v.trim())) {
                    return Err(Fail::args(format!("--{k} takes the UUID a lost change printed, like 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a; it is only for exact recovery")));
                }
            }
            if command != RESET && ["unread", "peek", "all"].iter().filter(|k| switched_on(&flags, **k)).count() > 1 {
                return Err(Fail::args("give one of --unread, --peek or --all"));
            }
            for k in ["limit", "timeout-ms"] {
                if text(k).is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
                    return Err(Fail::args(format!("--{k} takes a number above zero")));
                }
            }
            max_depth(text("max-depth"))?;
        } else if command.starts_with("automations.") {
            args = automations_cli::check(command, &flags)?;
        } else if crate::orchestration::runtime::is_runtime(command) {
            // T-312: blank values, a path for read and rename and a target for rename, before any lookup.
            args = crate::orchestration::runtime::check(command, &flags)?;
        } else if command.starts_with("file.") {
            // CLI-022: the path (bare or --path) and --mode are checked before any lookup.
            args = file_cli::check(command, &flags)?;
        } else if crate::browser::cli::is_browser(command) {
            args = crate::browser::cli::check(command, &flags)?;
        } else if local_cli::COMMANDS.iter().any(|c| c.1 == command) {
            args = flags.clone();
        } else if TERM.iter().any(|(_, c, _)| *c == command) {
            // MERGE 49: a zero wait is refused before anything is sent; T-596: so is one over the cap.
            if command == "terminal.send" && flags.get("wait-submit").and_then(Value::as_str).and_then(|s| s.trim().parse::<u64>().ok()).is_some_and(|n| n == 0 || n > WAIT_SUBMIT_MAX) {
                return Err(Fail::args(WAIT_SUBMIT_RANGE));
            }
            // CLI-024 / CLI-025: --text may be anything, even blank; the rest are keys and numbers.
            for (k, v) in &flags {
                if k != "text" && v.as_str().is_some_and(|s| s.trim().is_empty()) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
                args.insert(camel(k), v.clone());
            }
        } else if QUERY.iter().any(|(_, c, _)| *c == command) {
            for (k, v) in &flags {
                if v.as_str().is_some_and(|s| s.trim().is_empty()) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
                args.insert(camel(k), v.clone());
            }
            match command {
                "repo.add" if text("path").is_none() => return Err(Fail::args("--path is required: the folder of a Git repository")),
                "repo.set-base-ref" if text("ref").is_none() => return Err(Fail::args("--ref is required: the branch, tag or commit new worktrees start from")),
                _ => {}
            }
            if text("limit").is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
                return Err(Fail::args("--limit takes a number above zero"));
            }
        } else if command.starts_with("terminal.") {
            check_terminal(joined, command, &flags)?;
            for (k, v) in &flags {
                args.insert(camel(k), v.clone());
            }
            if joined == "terminal stop" {
                args.insert("note".into(), json!(stop_gone()));
            }
        } else if command == "worktree.rm" {
            if text("worktree").map(str::trim).unwrap_or_default().is_empty() {
                return Err(Fail::args("--worktree is required"));
            }
            for (k, v) in &flags {
                args.insert(if k == "run-hooks" { "runHooks".to_string() } else { k.clone() }, v.clone());
            }
        }
        Ok(Some(Parsed { command: command.to_string(), args }))
    })();
    (json, inner)
}


/// CLI-023, CLI-026, CLI-027: what a terminal command needs, checked before the app is asked.
pub(super) fn check_terminal(joined: &str, command: &str, flags: &Map<String, Value>) -> Result<(), Fail> {
    // C26-R4-01: --all=false and --tab=false are off, so they do not satisfy a selector or a pair.
    let has = |k: &str| switched_on(flags, k);
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| k.as_str() != "title" && text(k).is_some_and(str::is_empty)) {
        return Err(Fail::args(format!("--{k} cannot be empty")));
    }
    if joined == "terminal stop" && !has("terminal") && !has("all") {
        return Err(Fail::args(stop_gone()));
    }
    match command {
        "terminal.show" | "terminal.split" | "terminal.rename" | "terminal.switch" if !has("terminal") => {
            return Err(Fail::args("--terminal is required: the handle terminal list prints, like term-3"));
        }
        "terminal.close" => {
            if has("tab") && !has("terminal") {
                return Err(Fail::args("--tab closes the whole tab of --terminal <handle>; name the terminal"));
            }
            if has("all") != has("worktree") {
                return Err(Fail::args("--worktree and --all go together: --worktree <selector> --all closes every terminal in that worktree"));
            }
            match (has("terminal"), has("all")) {
                (true, true) => return Err(Fail::args("give --terminal <handle> or --worktree <selector> --all, not both")),
                (false, false) => return Err(Fail::args("say what to close: --terminal <handle> (add --tab for its whole tab) or --worktree <selector> --all")),
                _ => {}
            }
        }
        _ => {}
    }
    if text("direction").is_some_and(|d| !["horizontal", "vertical"].contains(&d)) {
        return Err(Fail::args("--direction takes horizontal or vertical"));
    }
    if text("limit").is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
        return Err(Fail::args("--limit takes a number above zero"));
    }
    Ok(())
}

/// ORCH-016 / ORCH-018 / ORCH-019 / CLI-035: what a worker start must and must not combine,
/// checked before the app is asked so nothing is half made.
/// ORCH-032: `--max-depth` takes whole numbers of 1 or more.
pub(super) fn max_depth(v: Option<&str>) -> Result<(), Fail> {
    if v.is_some_and(|v| v.trim().parse::<u32>().map_or(true, |n| n == 0)) {
        return Err(Fail::args("--max-depth takes a whole number of 1 or more"));
    }
    Ok(())
}

pub(super) fn check_worker_start(flags: &Map<String, Value>) -> Result<(), Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    for k in ["task", "spec", "agent", "model", "effort", "terminal", "tier", "name", "worktree", "setup", "timeout-ms"] {
        if flags.contains_key(k) && text(k).is_none() {
            return Err(Fail::args(format!("--{k} cannot be empty")));
        }
    }
    max_depth(flags.get("max-depth").map(|v| v.as_str().unwrap_or_default()))?;
    match (text("task"), text("spec")) {
        (None, None) => return Err(Fail::args("give --task <id> for an existing task or --spec <text> for a new one")),
        (Some(_), Some(_)) => return Err(Fail::args("give one of --task or --spec, not both")),
        _ => {}
    }
    let (agent, terminal, tier) = (text("agent"), text("terminal"), text("tier"));
    if text("effort").is_some() && text("model").is_none() {
        return Err(Fail::args("--effort needs --model"));
    }
    if agent.is_none() && terminal.is_none() && tier.is_none() && text("model").is_none() {
        return Err(Fail::args("say who runs it: --agent <id>, --model <name>, --tier major|deep|build|light, or --terminal <handle>"));
    }
    if let Some(t) = tier {
        if !TIERS.contains(&t) {
            return Err(Fail::args("--tier takes major, deep, build or light"));
        }
        if text("model").is_some() || text("effort").is_some() {
            return Err(Fail::args("a tier picks the model and effort; drop --model and --effort, or drop the tier"));
        }
    }
    if terminal.is_some() && (text("model").is_some() || text("effort").is_some() || tier.is_some()) {
        return Err(Fail::args("a reused terminal keeps its own model: --terminal cannot go with --model, --effort or --tier"));
    }
    let placement = text("worktree").unwrap_or(NEW_TOP);
    if terminal.is_some() && (placement == NEW_TOP || placement == NEW_CHILD) {
        return Err(Fail::args("a reused terminal stays in its worktree: name it with --worktree current or a selector"));
    }
    if placement != NEW_TOP && placement != NEW_CHILD {
        for k in ["name", "repo", "base-branch", "display-name", "comment"] {
            if flags.contains_key(k) {
                return Err(Fail::args(format!("--{k} shapes a new worktree; it cannot go with --worktree {placement}")));
            }
        }
    }
    if !["run", "skip", "inherit"].contains(&text("setup").unwrap_or("inherit")) {
        return Err(Fail::args("--setup takes run, skip or inherit"));
    }
    if let Some(ms) = text("timeout-ms") {
        if ms.parse::<u64>().map(|n| n == 0).unwrap_or(true) {
            return Err(Fail::args("--timeout-ms takes a number of milliseconds above zero"));
        }
    }
    if text("retry-of").is_some() && text("task").is_none() {
        return Err(Fail::args("--retry-of needs --task"));
    }
    if let Some(d) = text("deps") {
        if crate::orchestration::parse_deps(d).is_none() {
            return Err(Fail::args("--deps takes a JSON list of task ids, like [\"task-1\"]"));
        }
    }
    Ok(())
}
