//! T-156-b: the user's own protected rules (SAFE-016), per-project scopes (SAFE-017) and the
//! recent-attempts list (SAFE-018), every kept command masked through `protected::mask` first
//! (SAFE-019). The rules and scopes are read from the settings JSON on every hook event, so a
//! change applies to the next command; the attempts live in memory only and go with the app.
//! SAFE-020: the only answer this module ever produces is the PreToolUse "ask" block.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

/// Settings key: the global custom rules, a list of `Custom`.
pub const RULES_FIELD: &str = "protectedRules";
/// Settings key: per-project scopes, keyed by the project's root folder (see `Scope`).
pub const PROJECTS_FIELD: &str = "protectedProjects";
/// A regular expression has at most this many characters and sees at most `REGEX_SEES` of a command.
pub const MAX_REGEX: usize = 500;
pub const REGEX_SEES: usize = 4096;
/// The attempts list keeps this many, newest first, each command cut to `COMMAND_SHOWN` characters.
pub const ATTEMPTS: usize = 50;
pub const COMMAND_SHOWN: usize = 2000;
/// T-604 (R03-safety-accounts.2): how far past the shown part masking reads, so a secret that
/// begins in the shown part is judged with what follows it. Masking a whole long command made the
/// hook miss its 1.5 s, and the command then ran without the ask.
pub const MASK_MARGIN: usize = 2048;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    StartsWith,
    Contains,
    Regex,
}

/// One rule of the user's own: how the pattern is read is `kind`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Custom {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub kind: Kind,
    pub pattern: String,
}

impl Custom {
    /// The name Claude's prompt shows: a nameless rule shows its pattern.
    pub fn shown_name(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.pattern
        } else {
            &self.name
        }
    }

    pub fn hits(&self, command: &str) -> bool {
        self.hits_in(command, &std::cell::OnceCell::new())
    }

    /// `hits`, with the command's reading (`read`) shared with the built-in rules and every other
    /// rule asked about it (T-604: a long command is read once, in time for the hook).
    fn hits_in<'a>(&self, command: &'a str, read: &std::cell::OnceCell<crate::protected::Read<'a>>) -> bool {
        match self.kind {
            Kind::StartsWith => {
                let want: Vec<String> = self.pattern.split_whitespace().map(str::to_lowercase).collect();
                read.get_or_init(|| crate::protected::Read::new(command)).start_with(&want)
            }
            Kind::Contains => {
                let want = squeeze(&self.pattern);
                !want.is_empty() && squeeze(command).contains(&want)
            }
            Kind::Regex => compile(&self.pattern).is_ok_and(|re| re.is_match(head(command, REGEX_SEES))),
        }
    }
}

/// Lowercase with runs of whitespace squeezed to one space, for a contains rule.
fn squeeze(s: &str) -> String {
    s.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>().join(" ")
}

/// The first `n` characters of `s`.
fn head(s: &str, n: usize) -> &str {
    s.char_indices().nth(n).map_or(s, |(i, _)| &s[..i])
}

fn compile(pattern: &str) -> Result<regex::Regex, regex::Error> {
    regex::RegexBuilder::new(pattern).case_insensitive(true).size_limit(1 << 20).dfa_size_limit(1 << 20).build()
}

/// Whether a pattern can be saved as a rule of `kind`; `Err` is the sentence the page shows.
pub fn validate(kind: Kind, pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("The pattern is empty.".into());
    }
    if kind != Kind::Regex {
        return Ok(());
    }
    if pattern.chars().count() > MAX_REGEX {
        return Err(format!("A regular expression has at most {MAX_REGEX} characters."));
    }
    if risky(pattern) {
        return Err("This expression could take too long to check: a repeated group that repeats inside, or three overlapping repeats in a row.".into());
    }
    compile(pattern).map(|_| ()).map_err(|e| format!("Not a valid regular expression: {}", e.to_string().lines().last().unwrap_or("").trim()))
}

// SAFE-016's refusals, read off the pattern text: a repeated group with a repeat inside ((a+)+)
// and three unbounded repeats in a row whose atoms can match the same character (.*.*.*.*x,
// a*a*a*a*a*b, [a-z]+[a-m]+[a-c]+$), while x+y+z+ and kubectl.*(delete|drain) pass.
// ponytail: a reading of the text, not of the parsed syntax; an escape the reader does not know
// counts as that one character, and a group counts as overlapping anything.
#[derive(Clone, Debug)]
enum Atom {
    Any,
    Char(char),
    Class { body: String, negated: bool },
    Digit(bool),
    Word(bool),
    Space(bool),
    Group(Vec<Vec<(Atom, bool)>>),
}

impl Atom {
    fn member(&self, c: char) -> bool {
        match self {
            Atom::Any => true,
            Atom::Char(x) => x.eq_ignore_ascii_case(&c),
            Atom::Digit(neg) => c.is_ascii_digit() != *neg,
            Atom::Word(neg) => (c.is_ascii_alphanumeric() || c == '_') != *neg,
            Atom::Space(neg) => c.is_ascii_whitespace() != *neg,
            Atom::Group(_) => true,
            Atom::Class { body, negated } => {
                let chars: Vec<char> = body.chars().collect();
                let mut i = 0;
                let mut inside = false;
                while i < chars.len() {
                    let (atom, used) = match chars[i] {
                        '\\' if i + 1 < chars.len() => (escape(chars[i + 1]), 2),
                        x => (Atom::Char(x), 1),
                    };
                    i += used;
                    if let (Atom::Char(lo), Some('-'), Some(&hi)) = (&atom, chars.get(i), chars.get(i + 1)) {
                        i += 2;
                        let lo = *lo;
                        if (lo..=hi).contains(&c) || (lo.to_ascii_lowercase()..=hi.to_ascii_lowercase()).contains(&c.to_ascii_lowercase()) {
                            inside = true;
                        }
                    } else if atom.member(c) {
                        inside = true;
                    }
                }
                inside != *negated
            }
        }
    }

    fn overlaps(&self, other: &Atom) -> bool {
        (32u8..127).map(char::from).any(|c| self.member(c) && other.member(c))
    }
}

fn escape(c: char) -> Atom {
    match c {
        'd' => Atom::Digit(false),
        'D' => Atom::Digit(true),
        'w' => Atom::Word(false),
        'W' => Atom::Word(true),
        's' => Atom::Space(false),
        'S' => Atom::Space(true),
        x => Atom::Char(x),
    }
}

/// The pattern as alternatives of (atom, repeated without bound) items; `i` starts after a `(`.
fn parse(chars: &[char], i: &mut usize) -> Vec<Vec<(Atom, bool)>> {
    let mut alternatives = vec![Vec::new()];
    while *i < chars.len() {
        let c = chars[*i];
        *i += 1;
        let atom = match c {
            ')' => return alternatives,
            '|' => {
                alternatives.push(Vec::new());
                continue;
            }
            '^' | '$' => continue,
            '.' => Atom::Any,
            '\\' => {
                let e = chars.get(*i).copied().unwrap_or('\\');
                *i += 1;
                match e {
                    'b' | 'B' | 'A' | 'z' => continue,
                    x => escape(x),
                }
            }
            '[' => {
                let start = *i;
                if chars.get(*i) == Some(&'^') {
                    *i += 1;
                }
                let body_start = *i;
                if chars.get(*i) == Some(&']') {
                    *i += 1;
                }
                while *i < chars.len() && chars[*i] != ']' {
                    *i += if chars[*i] == '\\' { 2 } else { 1 };
                }
                let body: String = chars[body_start..(*i).min(chars.len())].iter().collect();
                *i += 1;
                Atom::Class { body, negated: chars.get(start) == Some(&'^') }
            }
            '(' => {
                if chars.get(*i) == Some(&'?') {
                    while *i < chars.len() && chars[*i] != ':' && chars[*i] != ')' {
                        *i += 1;
                    }
                    if chars.get(*i) == Some(&')') {
                        *i += 1;
                        continue;
                    }
                    *i += 1;
                }
                Atom::Group(parse(chars, i))
            }
            x => Atom::Char(x),
        };
        let repeated = match chars.get(*i) {
            Some('*' | '+') => {
                *i += 1;
                true
            }
            Some('?') => {
                *i += 1;
                false
            }
            Some('{') => {
                let close = chars[*i..].iter().position(|&x| x == '}').map(|p| *i + p);
                let body: String = close.map(|e| chars[*i + 1..e].iter().collect()).unwrap_or_default();
                *i = close.map_or(*i, |e| e + 1);
                body.ends_with(',')
            }
            _ => false,
        };
        if chars.get(*i) == Some(&'?') {
            *i += 1;
        }
        alternatives.last_mut().expect("one alternative").push((atom, repeated));
    }
    alternatives
}

fn risky_in(alternatives: &[Vec<(Atom, bool)>]) -> bool {
    alternatives.iter().any(|items| {
        items.iter().any(|(atom, repeated)| match atom {
            Atom::Group(inner) => (*repeated && inner.iter().flatten().any(|(_, r)| *r)) || risky_in(inner),
            _ => false,
        }) || items.windows(3).any(|w| w.iter().all(|(_, r)| *r) && w[0].0.overlaps(&w[1].0) && w[1].0.overlaps(&w[2].0) && w[0].0.overlaps(&w[2].0))
    })
}

pub fn risky(pattern: &str) -> bool {
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    risky_in(&parse(&chars, &mut i))
}

/// SAFE-017: one project's scope, keyed in `PROJECTS_FIELD` by the project's root folder. `dirs`
/// are more folders that count as the project (its workspaces folder when it lies elsewhere).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scope {
    pub off: Vec<String>,
    pub rules: Vec<Custom>,
    pub dirs: Vec<String>,
}

/// Folders compared as text: forward slashes, no trailing slash, lowercase (Windows folders are
/// case-insensitive; ponytail: so are the others here, a false match only widens a scope).
fn norm(path: &str) -> String {
    path.trim().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn under(cwd: &str, root: &str) -> bool {
    !root.is_empty() && (cwd == root || cwd.strip_prefix(root).is_some_and(|rest| rest.starts_with('/')))
}

/// The scope `cwd` falls in: the deepest project root or extra folder that contains it.
pub fn scope_of(settings: &Value, cwd: Option<&str>) -> Option<(String, Scope)> {
    let cwd = norm(cwd?);
    let projects = settings.get(PROJECTS_FIELD)?.as_object()?;
    let mut best: Option<(usize, String, Scope)> = None;
    for (root, v) in projects {
        let scope: Scope = serde_json::from_value(v.clone()).unwrap_or_default();
        let depth = std::iter::once(root.as_str()).chain(scope.dirs.iter().map(String::as_str)).map(norm).filter(|d| under(&cwd, d)).map(|d| d.len()).max();
        if let Some(d) = depth {
            if best.as_ref().is_none_or(|b| d > b.0) {
                best = Some((d, root.clone(), scope));
            }
        }
    }
    best.map(|(_, root, scope)| (root, scope))
}

/// The rules that apply in `cwd`: the built-in ids switched off (everywhere or for the project)
/// and the custom rules in force (the global ones not off for the project, then the project's own).
#[derive(Debug, Default, PartialEq)]
pub struct Working {
    pub off: Vec<String>,
    pub customs: Vec<Custom>,
}

fn customs_in(v: Option<&Value>) -> Vec<Custom> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|r| serde_json::from_value(r.clone()).ok()).collect()).unwrap_or_default()
}

pub fn working(settings: &Value, cwd: Option<&str>) -> Working {
    let mut off: Vec<String> = settings.get(crate::protected::OFF_FIELD).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    let mut customs = customs_in(settings.get(RULES_FIELD));
    if let Some((_, scope)) = scope_of(settings, cwd) {
        customs.retain(|c| !scope.off.contains(&c.id));
        customs.extend(scope.rules);
        off.extend(scope.off);
    }
    Working { off, customs }
}

/// The name of the first rule `command` trips in `cwd`, built-ins first, honouring the master switch.
pub fn check(command: &str, base: &crate::protected::Base, settings: &Value, cwd: Option<&str>) -> Option<String> {
    if settings.get(crate::protected::ASK_FIELD) == Some(&Value::Bool(false)) {
        return None;
    }
    let w = working(settings, cwd);
    let mut merged = settings.clone();
    merged[crate::protected::OFF_FIELD] = json!(w.off);
    let read = std::cell::OnceCell::new();
    if let Some(rule) = crate::protected::check_with(command, &read, base, &merged) {
        return Some(rule.name.to_string());
    }
    w.customs.iter().find(|c| c.hits_in(command, &read)).map(|c| c.shown_name().to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Waiting,
    Allowed,
    Denied,
}

/// SAFE-018: one paused command. `command` is already masked and cut; the session and tool call
/// ids only serve to settle the outcome and never leave the process.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub time: u64,
    pub worktree: String,
    pub command: String,
    pub rule: String,
    pub outcome: Outcome,
    #[serde(skip)]
    session: String,
    #[serde(skip)]
    call: String,
}

impl Attempt {
    /// A waiting attempt with every text field masked: the command's shown part and a margin after
    /// it (T-604), the folder and the rule (a nameless rule shows its own pattern, and the folder is
    /// free text too: neither may carry a secret into the list either).
    fn masked(session: &str, call: &str, worktree: &str, raw: &str, rule: &str, time: u64) -> Attempt {
        let masked = crate::protected::mask_head(raw, COMMAND_SHOWN + MASK_MARGIN);
        let command = head(&masked, COMMAND_SHOWN).to_string();
        let (worktree, rule) = (crate::protected::mask(worktree), crate::protected::mask(rule));
        Attempt { time, worktree, command, rule, outcome: Outcome::Waiting, session: session.into(), call: call.into() }
    }

    /// The same attempt masked once more on the way out (the mask is idempotent).
    fn shown(&self) -> Attempt {
        let m = crate::protected::mask;
        Attempt { command: m(&self.command), rule: m(&self.rule), worktree: m(&self.worktree), ..self.clone() }
    }
}

/// The list, newest first, at most `ATTEMPTS` long.
#[derive(Debug, Default)]
pub struct Attempts(VecDeque<Attempt>);

impl Attempts {
    /// A command was paused: the raw text is masked before anything keeps it, and an earlier
    /// attempt of the same session still waiting is taken as refused. Only the shown part and a
    /// margin after it are masked (T-604), so the time this takes does not grow with the command.
    #[cfg(test)]
    pub fn paused(&mut self, session: &str, call: &str, worktree: &str, raw: &str, rule: &str, time: u64) {
        self.keep(Attempt::masked(session, call, worktree, raw, rule, time));
    }

    /// Keeps an attempt already masked (`Attempt::masked`), so the app-wide lock is held only to
    /// add it, never while a long command is masked (T-604 review of PR #15).
    fn keep(&mut self, attempt: Attempt) {
        self.turn_ended(&attempt.session);
        self.0.push_front(attempt);
        self.0.truncate(ATTEMPTS);
    }

    /// The tool call ran (or failed while running): the attempt was allowed.
    pub fn ended(&mut self, session: &str, call: &str) {
        if let Some(a) = self.0.iter_mut().find(|a| a.outcome == Outcome::Waiting && a.session == session && a.call == call) {
            a.outcome = Outcome::Allowed;
        }
    }

    /// The turn ended, a new prompt came or the session ended: what still waited was refused.
    pub fn turn_ended(&mut self, session: &str) {
        for a in self.0.iter_mut().filter(|a| a.outcome == Outcome::Waiting && a.session == session) {
            a.outcome = Outcome::Denied;
        }
    }

    /// What the Safety page is shown: every text field masked once more on the way out (the mask
    /// is idempotent, so a kept attempt reads the same), so nothing raw reaches the page even if a
    /// later writer skips `paused`.
    #[cfg(test)]
    pub fn list(&self) -> Vec<Attempt> {
        self.0.iter().map(Attempt::shown).collect()
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }
}

static STORE: LazyLock<Mutex<Attempts>> = LazyLock::new(Mutex::default);

#[cfg(test)]
thread_local! {
    /// The longest this thread has held the attempts lock (tests only).
    static HELD: std::cell::Cell<std::time::Duration> = const { std::cell::Cell::new(std::time::Duration::ZERO) };
}

fn with_store<T>(f: impl FnOnce(&mut Attempts) -> T) -> T {
    let mut store = STORE.lock().unwrap_or_else(|e| e.into_inner());
    #[cfg(test)]
    let t0 = std::time::Instant::now();
    let out = f(&mut store);
    #[cfg(test)]
    HELD.with(|h| h.set(h.get().max(t0.elapsed())));
    out
}

/// What the hook prints back for a Claude event, or None for no opinion (`{}`): the PreToolUse
/// ask block when a Bash or PowerShell command trips a rule in force for its folder. Along the
/// way the attempts list is kept: paused on the ask, allowed when the same tool call ends, refused
/// when the turn, the prompt or the session moves on.
pub fn listen(path: &str, body: &[u8], settings: &Value) -> Option<String> {
    if path != "/claude" {
        return None;
    }
    let event: Value = serde_json::from_slice(body).ok()?;
    let field = |k: &str| event.get(k).and_then(Value::as_str);
    let session = field("session_id").unwrap_or("");
    match field("hook_event_name")? {
        "PreToolUse" => {
            if !matches!(field("tool_name")?, "Bash" | "PowerShell") {
                return None;
            }
            let command = event.get("tool_input")?.get("command")?.as_str()?;
            let cwd = field("cwd");
            let rule = check(command, &crate::protected::Base::from_env(cwd), settings, cwd)?;
            // Masked before the lock is taken: another pane's check never waits on this command.
            let attempt = Attempt::masked(session, field("tool_use_id").unwrap_or(""), cwd.unwrap_or(""), command, &rule, crate::automations::now_ms());
            with_store(|s| s.keep(attempt));
            Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": crate::protected::reason(&rule) } }).to_string())
        }
        "PostToolUse" | "PostToolUseFailure" => {
            if let Some(call) = field("tool_use_id") {
                with_store(|s| s.ended(session, call));
            }
            None
        }
        "Stop" | "UserPromptSubmit" | "SessionEnd" => {
            with_store(|s| s.turn_ended(session));
            None
        }
        _ => None,
    }
}

/// Whether the Safety page may save `pattern` as a rule of `kind`; `Err` is the sentence to show.
#[tauri::command]
pub fn protected_rule_check(kind: Kind, pattern: String) -> Result<(), String> {
    validate(kind, &pattern)
}

/// The recent attempts, newest first, every command masked.
#[tauri::command]
pub fn protected_attempts() -> Vec<Attempt> {
    // Copied under the lock, masked after it.
    with_store(|s| s.0.clone()).iter().map(Attempt::shown).collect()
}

#[tauri::command]
pub fn protected_attempts_clear() {
    with_store(Attempts::clear)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(kind: Kind, pattern: &str) -> Custom {
        Custom { id: pattern.into(), name: String::new(), kind, pattern: pattern.into() }
    }

    #[test]
    fn t156b_a_starts_with_rule_reads_the_program_and_first_words_of_each_segment() {
        let r = rule(Kind::StartsWith, "Kubectl delete");
        assert!(r.hits("kubectl delete pod x"));
        assert!(r.hits("KUBECTL   DELETE ns"));
        assert!(r.hits("echo hi && kubectl delete pod"));
        assert!(!r.hits("echo kubectl delete"));
        assert!(!r.hits("kubectl get pods"));
        assert!(!rule(Kind::StartsWith, "   ").hits("anything"));
    }

    /// T-604 (R03-safety-accounts.3): a starts-with rule reads commands the way the built-in rules
    /// do (SAFE-014): leading `NAME=value`, wrappers, package runners, folders, `.exe` and `.cmd`,
    /// PowerShell's call operator, a lone `&`, inner shells and grouping are seen through.
    #[test]
    fn t604_a_starts_with_rule_sees_through_wrappers_runners_paths_and_inner_shells() {
        let prisma = rule(Kind::StartsWith, "prisma migrate reset");
        for c in ["npx prisma migrate reset --force", "pnpm exec prisma migrate reset", "pnpm dlx prisma migrate reset", "bunx prisma migrate reset", "npm exec prisma migrate reset", "yarn dlx prisma migrate reset"] {
            assert!(prisma.hits(c), "{c}");
        }
        let kubectl = rule(Kind::StartsWith, "kubectl delete");
        for c in [
            "sudo kubectl delete ns prod",
            "KUBECONFIG=prod.yaml kubectl delete ns prod",
            "kubectl.exe delete pod x",
            "C:\\tools\\kubectl.exe delete pod x",
            "/usr/local/bin/kubectl delete pod x",
            "& kubectl delete pod x",
            "& \"C:\\Program Files\\k8s\\kubectl.exe\" delete pod x",
            "bash -c \"kubectl delete pod x\"",
            "(cd infra && kubectl delete pod x)",
            "sleep 1 & kubectl delete pod x",
        ] {
            assert!(kubectl.hits(c), "{c}");
        }
        let terraform = rule(Kind::StartsWith, "terraform destroy");
        for c in ["FOO=1 terraform destroy", "sudo terraform destroy", "(cd infra && terraform destroy)", "bash -c \"terraform destroy\"", "sleep 1 & terraform destroy", "npx terraform destroy", "& terraform destroy", "terraform.exe destroy"] {
            assert!(terraform.hits(c), "{c}");
        }
        // A package manager named in the rule is still the program: `npm publish` as written, or as a shim.
        let publish = rule(Kind::StartsWith, "npm publish");
        for c in ["npm publish", "npm.cmd publish", "sudo npm publish", "C:\\nodejs\\npm.cmd publish --tag next"] {
            assert!(publish.hits(c), "{c}");
        }
        // Still the program and its first words: a mention, another subcommand or a comment runs.
        for c in ["echo kubectl delete pod", "kubectl get pods", "git commit -m 'kubectl delete'", "# kubectl delete pod"] {
            assert!(!kubectl.hits(c), "{c}");
        }
    }

    /// T-604 (R03-safety-accounts.2): a 1 MB command is asked about at once, unread (anything over
    /// 256 KB is), and its attempt is kept, masked and cut, well inside the hook's 1.5 s. A command
    /// just under the cap is read in full: 250 KB of backslash tricks, line joins, ANSI-C quotes and
    /// fillers that once made reading quadratic, the protected action last, tripping the last of
    /// ten starts-with rules of the user's own, so every reading and every rule reads all of it.
    /// The bar for the full read is the optimized build's promise; a debug build only has to finish.
    #[test]
    fn t604_a_1_mb_command_is_answered_and_its_attempt_kept_within_the_hooks_time() {
        let mut rules: Vec<Value> = ["terraform destroy", "helm uninstall", "aws s3 rm", "gcloud projects delete", "az group delete", "docker system prune", "npm unpublish", "flyctl apps destroy", "heroku apps:destroy"]
            .iter()
            .map(|p| json!({ "id": p, "kind": "starts-with", "pattern": p }))
            .collect();
        rules.push(json!({ "id": "pods", "name": "Pod deletes", "kind": "starts-with", "pattern": "kubectl delete" }));
        let settings = json!({ RULES_FIELD: rules });
        let ask = |label: &str, command: String| {
            let ev = json!({ "hook_event_name": "PreToolUse", "session_id": "t604-time", "tool_use_id": label, "cwd": "/home/me/t604", "tool_name": "Bash",
                "tool_input": { "command": command } }).to_string();
            let t0 = std::time::Instant::now();
            let answer = listen("/claude", ev.as_bytes(), &settings);
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            println!("TIME hook {label} bytes={} ms={ms:.0}", ev.len());
            (answer.unwrap_or_default(), ms)
        };
        let n = 1 << 20;
        let (answer, ms) = ask("one_mb", format!("{}\nkubectl delete pod web-1", "-p ".repeat(n / 3)));
        assert!(answer.contains("Commands over 256 KB, too long to read in time"), "{answer}");
        assert!(ms < 750.0, "a 1 MB command was asked about in {ms:.0} ms");
        let m = 250 * 1024;
        let fill = |unit: &str| unit.repeat(m / unit.len());
        let fillers = [
            ("escaped_words", fill("g\\it \\-\\-forc\\e ")),
            ("escaped_paths", fill("rm -rf /tmp/a:/\\.\\./\\.\\. ; ")),
            ("line_joins", fill("git reset --ha\\\nrd ; ")),
            ("ansi_c", fill("echo $'\\'' ; ")),
            ("ifs", fill("git${IFS}status ; ")),
            ("mixed_quotes", fill("\"'\\'\\\"")),
            ("heredoc_table", format!("cat > docs/TABLE.md <<'EOF'\n{}EOF", fill("| a \\| b | c |\n"))),
            ("substitutions", fill("echo $(g\\it status) ")),
        ];
        let bar_ms = 750.0;
        let mut slow = Vec::new();
        for (label, filler) in fillers {
            let command = format!("{filler}\nkubectl delete pod web-1");
            assert!(command.len() <= 256 * 1024, "{label} is {} bytes", command.len());
            let (answer, ms) = ask(label, command);
            assert!(answer.contains("protected action"), "{label} must ask: {answer}");
            if ms > bar_ms {
                slow.push(format!("{label}: {ms:.0} ms"));
            }
        }
        let kept: Vec<Attempt> = protected_attempts().into_iter().filter(|a| a.worktree == "/home/me/t604").collect();
        assert_eq!(kept.len(), 9);
        assert!(kept.iter().all(|a| a.command.chars().count() <= COMMAND_SHOWN));
        assert!(cfg!(debug_assertions) || slow.is_empty(), "over {bar_ms} ms: {slow:#?}");
    }

    /// T-604 review of PR #15 (status-hooks follow-up 4): a 1 MB protected command is masked
    /// outside the app-wide attempts lock, so while it is being read and masked another pane's
    /// protected command is answered at once, and the lock is only held to add the attempt.
    #[test]
    fn t604r5_a_second_panes_check_is_answered_while_a_1_mb_command_is_masked() {
        let rules = json!({ RULES_FIELD: [{ "id": "pods", "name": "Pod deletes", "kind": "starts-with", "pattern": "kubectl delete" }] });
        let event = |session: &str, command: String| {
            json!({ "hook_event_name": "PreToolUse", "session_id": session, "tool_use_id": "t604r5", "cwd": "/home/me/t604r5", "tool_name": "Bash", "tool_input": { "command": command } }).to_string()
        };
        let big = event("t604r5-big", format!("{}\nkubectl delete pod web-1", "export API_TOKEN=abc123 PASSWORD=hunter2 ".repeat((1 << 20) / 42)));
        let small = "kubectl delete pod web-2".to_string();
        let r = rules.clone();
        let pane = std::thread::spawn(move || (listen("/claude", big.as_bytes(), &r).is_some(), HELD.with(|h| h.get())));
        // The second pane runs listen's own two steps, the rule answer and the attempts lock, without
        // keeping an attempt each time round: the list is shared and holds only ATTEMPTS.
        let cwd = Some("/home/me/t604r5");
        let mut slowest = std::time::Duration::ZERO;
        let mut checks = 0;
        while !pane.is_finished() || checks == 0 {
            let t0 = std::time::Instant::now();
            assert!(check(&small, &crate::protected::Base::from_env(cwd), &rules, cwd).is_some(), "the second pane must ask");
            with_store(|s| s.0.len());
            slowest = slowest.max(t0.elapsed());
            checks += 1;
        }
        let (asked, held) = pane.join().unwrap();
        println!("TIME second pane: {checks} checks, slowest {slowest:?}; the 1 MB pane held the lock {held:?}");
        assert!(asked, "the 1 MB command must ask");
        assert!(held < std::time::Duration::from_millis(5), "the 1 MB pane held the attempts lock {held:?}");
        assert!(slowest < std::time::Duration::from_millis(250), "a second pane waited {slowest:?}");
    }

    /// T-604: masking reads only the shown part of a command and a margin after it, and a secret
    /// cut off by that margin stays hidden: a JSON value whose closing quote lies past the margin is
    /// hidden to the end of what was read, as a private key cut short is.
    #[test]
    fn t604_a_secret_cut_off_where_masking_stops_reading_stays_hidden() {
        let mut a = Attempts::default();
        let blob = "QUJD".repeat(1500);
        let raw = format!("{}curl -d '{{\"credentials\":\"{blob}\"}}' https://x\ngit push --force origin main", "x".repeat(1900));
        a.paused("w", "c", "", &raw, "Force-push to main", 1);
        let kept = &a.list()[0].command;
        assert!(!kept.contains("QUJDQUJD") && kept.contains(crate::protected::HIDDEN), "{kept}");
        assert!(kept.chars().count() <= COMMAND_SHOWN);
    }

    #[test]
    fn t156b_a_contains_rule_ignores_case_and_squeezes_whitespace() {
        let r = rule(Kind::Contains, "DROP   table");
        assert!(r.hits("psql -c \"drop\ttable users\""));
        assert!(!r.hits("psql -c \"drop column\""));
    }

    #[test]
    fn t156b_a_regex_rule_is_case_insensitive_and_sees_the_first_4096_characters() {
        let r = rule(Kind::Regex, "git push.*--force");
        assert!(r.hits("GIT PUSH origin main --force"));
        assert!(!r.hits("git push origin main"));
        let r = rule(Kind::Regex, "danger");
        assert!(r.hits(&format!("danger{}", "x".repeat(5000))));
        assert!(!r.hits(&format!("{}danger", "x".repeat(5000))));
        assert!(!rule(Kind::Regex, "(").hits("("), "an expression that does not compile never asks");
    }

    #[test]
    fn t156b_validate_refuses_what_safe_016_names_and_allows_the_rest() {
        for bad in ["", "  ", "(", "(a+)+", ".*.*.*.*x", "a*a*a*a*a*b", "[a-z]+[a-m]+[a-c]+$", "(?:\\d+)*", &"a".repeat(501)] {
            assert!(validate(Kind::Regex, bad).is_err(), "{bad:?} must be refused");
        }
        for good in ["x+y+z+", "kubectl.*(delete|drain)", "git push.*--force", "a{1,3}b{2}c", "(ab)+", "\\d+\\s+\\w+", "[0-9]+[a-f]+[g-z]+"] {
            assert_eq!(validate(Kind::Regex, good), Ok(()), "{good:?} must pass");
        }
        assert!(validate(Kind::StartsWith, "").is_err());
        assert_eq!(validate(Kind::Contains, "(a+)+"), Ok(()), "only expressions are checked for repeats");
        assert!(validate(Kind::Regex, "(").unwrap_err().starts_with("Not a valid regular expression"));
    }

    fn settings() -> Value {
        json!({
            "protectedOff": ["stripe"],
            "protectedRules": [
                { "id": "g1", "name": "Pod deletes", "kind": "starts-with", "pattern": "kubectl delete" },
                { "id": "g2", "kind": "contains", "pattern": "flush all" }
            ],
            "protectedProjects": {
                "G:\\Dev\\shop": { "off": ["g1", "force-push"], "rules": [{ "id": "p1", "name": "Migrations", "kind": "regex", "pattern": "^prisma migrate" }], "dirs": ["G:/Dev/shop-lanes"] },
                "G:/Dev/shop/vendor": { "off": [], "rules": [] }
            }
        })
    }

    #[test]
    fn t156b_scopes_join_the_built_in_off_lists_and_the_custom_rules_per_folder() {
        let s = settings();
        let w = working(&s, Some("G:\\Dev\\other"));
        assert_eq!(w.off, vec!["stripe"]);
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g1", "g2"]);
        let w = working(&s, Some("G:/Dev/shop/src"));
        assert_eq!(w.off, vec!["stripe", "g1", "force-push"]);
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g2", "p1"], "the global rule off here is gone, the project's own is in");
        let w = working(&s, Some("g:/dev/shop-lanes/hooks"));
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g2", "p1"], "an extra folder counts as the project");
        assert_eq!(scope_of(&s, Some("G:/Dev/shop/vendor/x")).map(|(r, _)| r).as_deref(), Some("G:/Dev/shop/vendor"), "the deepest root wins");
        assert_eq!(scope_of(&s, Some("G:/Dev/shopping")), None, "a folder that only shares a prefix is outside");
        assert_eq!(working(&s, None).customs.len(), 2);
    }

    #[test]
    fn t156b_check_runs_built_ins_first_then_the_customs_in_force_and_a_nameless_rule_shows_its_pattern() {
        let s = settings();
        let base = crate::protected::Base::default();
        assert_eq!(check("git push --force origin main", &base, &s, Some("G:/Dev/other")).as_deref(), Some("Force-push to main"));
        assert_eq!(check("git push --force origin main", &base, &s, Some("G:/Dev/shop")), None, "off for this project");
        assert_eq!(check("stripe customers delete cus_1", &base, &s, Some("G:/Dev/other")), None, "off everywhere");
        assert_eq!(check("kubectl delete pod", &base, &s, Some("G:/Dev/other")).as_deref(), Some("Pod deletes"));
        assert_eq!(check("kubectl delete pod", &base, &s, Some("G:/Dev/shop")), None);
        assert_eq!(check("redis-cli FLUSH  ALL", &base, &s, Some("G:/Dev/shop")).as_deref(), Some("flush all"));
        assert_eq!(check("prisma migrate reset", &base, &s, Some("G:/Dev/shop")).as_deref(), Some("Migrations"));
        assert_eq!(check("prisma migrate reset", &base, &s, Some("G:/Dev/other")), None);
        let mut off = s.clone();
        off["protectedAsk"] = json!(false);
        assert_eq!(check("kubectl delete pod", &base, &off, Some("G:/Dev/other")), None, "the master switch covers custom rules too");
    }

    /// C19-R1-01: a project's panes run in `<workspaces root>/<project>`, not under the repo root,
    /// so the scope must name that folder too. The page writes it (`paneFolders` in
    /// SafetyRules.tsx); this pins that the read side then applies the project's off list and its
    /// own rules, and that a sibling folder is not the project.
    #[test]
    fn c19r101_a_pane_in_its_projects_workspace_folder_gets_that_projects_scope() {
        let s = json!({
            "protectedProjects": {
                "G:/Dev/shop": {
                    "off": ["force-push"],
                    "dirs": ["C:/Users/x/kolux-rs/workspaces/shop"],
                    "rules": [{ "id": "p1", "name": "Migrations", "kind": "regex", "pattern": "^prisma migrate" }]
                }
            }
        });
        let base = crate::protected::Base::default();
        let pane = "C:/Users/x/kolux-rs/workspaces/shop/fix-login/src";
        assert_eq!(scope_of(&s, Some(pane)).map(|(r, _)| r).as_deref(), Some("G:/Dev/shop"));
        assert!(working(&s, Some(pane)).off.contains(&"force-push".to_string()));
        assert_eq!(check("git push --force origin main", &base, &s, Some(pane)), None, "the switch the user turned off here holds");
        assert_eq!(check("prisma migrate reset", &base, &s, Some(pane)).as_deref(), Some("Migrations"), "the project's own rule asks");
        assert_eq!(check("prisma migrate reset", &base, &s, Some("C:/Users/x/kolux-rs/workspaces/shop2/x")), None, "a sibling folder is not shop");
        assert_eq!(check("prisma migrate reset", &base, &s, Some("C:/Users/x/kolux-rs/workspaces/shop")).as_deref(), Some("Migrations"), "the folder itself counts");
    }

    /// C19-R1-01, the gap the fix does not close: with the flat layout a pane's folder is
    /// `<root>/<branch>` and carries no project at all, so no scope can be named for it. Stated as a
    /// test so the gap is a fact, not a claim: the project's own rule does not ask and its off list
    /// does not hold there.
    #[test]
    fn c19r101_a_flat_layout_pane_has_no_project_in_its_folder_so_no_scope_applies() {
        let s = json!({
            "protectedProjects": {
                "G:/Dev/shop": {
                    "off": ["force-push"],
                    "dirs": [],
                    "rules": [{ "id": "p1", "name": "Migrations", "kind": "regex", "pattern": "^prisma migrate" }]
                }
            }
        });
        let base = crate::protected::Base::default();
        let pane = "C:/Users/x/kolux-rs/workspaces/fix-login";
        assert_eq!(scope_of(&s, Some(pane)), None);
        assert_eq!(check("prisma migrate reset", &base, &s, Some(pane)), None, "the flat layout's gap: the project's rule cannot be found");
        assert_eq!(check("git push --force origin main", &base, &s, Some(pane)).as_deref(), Some("Force-push to main"), "and its off list cannot be found either");
    }

    #[test]
    fn t156b_attempts_are_masked_newest_first_capped_and_settled_by_what_follows() {
        let mut a = Attempts::default();
        a.paused("s1", "c1", "G:/w", "stripe refunds create --api-key sk_live_abc123def456xyz9 --password hunter2", "Stripe changes", 1);
        let kept = &a.list()[0].command;
        assert!(kept.starts_with("stripe refunds create --api-key sk_live_"), "{kept}");
        assert!(!kept.contains("abc123def456") && !kept.contains("hunter2"), "{kept}");
        assert!(kept.contains(crate::protected::HIDDEN), "{kept}");
        a.paused("s1", "c2", "G:/w", "git push --force", "Force-push to main", 2);
        let l = a.list();
        assert_eq!((l[0].time, l[0].outcome, l[1].outcome), (2, Outcome::Waiting, Outcome::Denied), "a newer attempt from the same session refuses the older one");
        a.paused("s2", "c9", "G:/v", "rm -rf ~", "Deleting", 3);
        a.ended("s1", "c2");
        a.ended("s2", "nope");
        let l = a.list();
        assert_eq!((l[1].outcome, l[0].outcome), (Outcome::Allowed, Outcome::Waiting));
        a.turn_ended("s2");
        assert_eq!(a.list()[0].outcome, Outcome::Denied);
        for i in 0..60 {
            a.paused("s3", &i.to_string(), "", &"x".repeat(3000), "r", 10 + i);
        }
        let l = a.list();
        assert_eq!(l.len(), ATTEMPTS);
        assert_eq!((l[0].time, l[0].command.len()), (69, COMMAND_SHOWN));
        a.clear();
        assert!(a.list().is_empty());
    }

    #[test]
    fn t156b_listen_asks_once_for_a_custom_rule_and_keeps_the_attempt() {
        let s = settings();
        let pre = |tool: &str, cmd: &str| json!({ "hook_event_name": "PreToolUse", "session_id": "t156b-listen", "tool_use_id": "tu1", "cwd": "G:/Dev/t156b", "tool_name": tool, "tool_input": { "command": cmd } }).to_string();
        assert_eq!(listen("/codex", pre("Bash", "kubectl delete pod").as_bytes(), &s), None);
        assert_eq!(listen("/claude", pre("Write", "kubectl delete pod").as_bytes(), &s), None);
        assert_eq!(listen("/claude", pre("Bash", "kubectl get pods").as_bytes(), &s), None);
        let ask = listen("/claude", pre("Bash", "kubectl delete pod --token sk_live_1234567890abcd").as_bytes(), &s).expect("asks");
        assert!(ask.contains("\"permissionDecision\":\"ask\"") && ask.contains("Pod deletes"), "{ask}");
        let mine = |l: Vec<Attempt>| l.into_iter().filter(|a| a.worktree == "G:/Dev/t156b").collect::<Vec<_>>();
        let l = mine(protected_attempts());
        assert_eq!((l.len(), l[0].outcome, l[0].rule.as_str()), (1, Outcome::Waiting, "Pod deletes"));
        assert!(!l[0].command.contains("1234567890abcd"), "{}", l[0].command);
        let post = json!({ "hook_event_name": "PostToolUse", "session_id": "t156b-listen", "tool_use_id": "tu1" }).to_string();
        assert_eq!(listen("/claude", post.as_bytes(), &s), None, "never more than the ask");
        assert_eq!(mine(protected_attempts())[0].outcome, Outcome::Allowed);
    }

    /// SAFE-019 acceptance on the list itself (Txais 2026-10-20: the own rules switch on once the
    /// attempts log masks secrets): tokens, env-file lines, private key blocks, credentials in an
    /// address and Authorization headers never reach a kept attempt, its JSON for the page, its
    /// rule text or its folder; a Stripe key shows only its prefix and last four. Fixture strings
    /// are the mask's own test inputs, never real keys.
    #[test]
    fn t156b_the_attempts_list_masks_tokens_env_lines_pem_blocks_url_credentials_and_auth_headers() {
        let tail = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
        let cases: Vec<(String, Vec<&str>)> = vec![
            (format!("gh auth login --token ghp_{tail}abcd"), vec![tail]),
            (format!("export ANTHROPIC_API_KEY=sk-ant-api03-{tail} && claude"), vec![tail]),
            ("aws s3 rm s3://b --recursive AKIAIOSFODNN7EXAMPLE".into(), vec!["IOSFODNN7EXAMPLE"]),
            ("curl -d t=xoxb-1234567890-abcdefghij https://slack.com/api/x".into(), vec!["1234567890-abcdefghij"]),
            ("cat > .env <<EOF\nDATABASE_HOST=db.internal\r\nexport SESSION_SALT=\"s a l t\"\nEOF".into(), vec!["db.internal", "s a l t"]),
            ("echo '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----' > id".into(), vec!["MIIBOgIBAAJBAKj34Gkx"]),
            ("psql postgres://admin:hunter2@db.example.com:5432/app -c 'drop table t'".into(), vec!["admin", "hunter2"]),
            ("git push --force https://user:glpat-abcdef@gitlab.com/o/r.git main".into(), vec!["glpat-abcdef", "user:"]),
            ("curl -X DELETE -H 'Authorization: Bearer abcDEF123.456_xyz' https://x".into(), vec!["abcDEF123.456_xyz"]),
            ("curl -X DELETE -H \"Authorization: Basic dXNlcjpwYXNz\" https://x".into(), vec!["dXNlcjpwYXNz"]),
            ("stripe refunds create --api-key sk_live_51HabcdEFGH1234567890WXYZ".into(), vec!["51HabcdEFGH1234567890"]),
        ];
        let mut a = Attempts::default();
        for (i, (raw, secrets)) in cases.iter().enumerate() {
            a.paused("m", &i.to_string(), "G:/w", raw, "r", i as u64);
            let kept = &a.list()[0];
            let page = serde_json::to_string(kept).unwrap();
            for s in secrets {
                assert!(!kept.command.contains(s) && !page.contains(s), "{s:?} leaked from {raw:?}: {}", kept.command);
            }
            assert!(kept.command.contains(crate::protected::HIDDEN) || kept.command.contains("...."), "{}", kept.command);
            assert_eq!(a.list()[0], *kept, "showing twice reads the same");
        }
        assert!(a.list()[0].command.contains("sk_live_....WXYZ"), "Stripe keeps prefix and last four: {}", a.list()[0].command);
        // The rule text (a nameless rule shows its pattern) and the folder go through the mask too.
        a.paused("m", "x", "postgres://admin:hunter2@db/app", "kubectl delete pod", &format!("ghp_{tail}abcd"), 99);
        let page = serde_json::to_string(&a.list()).unwrap();
        assert!(!page.contains(tail) && !page.contains("hunter2"), "{page}");
        // Through the hook path: a nameless custom rule whose pattern is a token, tripped by a
        // command carrying an Authorization header and an env line.
        let s = json!({ "protectedRules": [{ "id": "n1", "kind": "contains", "pattern": format!("ghp_{tail}abcd") }] });
        let ev = json!({ "hook_event_name": "PreToolUse", "session_id": "t156b-mask", "tool_use_id": "tm1", "cwd": "G:/Dev/t156b-mask", "tool_name": "Bash",
            "tool_input": { "command": format!("TOKEN=ghp_{tail}abcd curl -H 'Authorization: Bearer abcDEF123.456_xyz' https://x") } }).to_string();
        assert!(listen("/claude", ev.as_bytes(), &s).is_some_and(|r| r.contains("\"ask\"")));
        let mine: Vec<Attempt> = protected_attempts().into_iter().filter(|a| a.worktree == "G:/Dev/t156b-mask").collect();
        let page = serde_json::to_string(&mine).unwrap();
        assert_eq!(mine.len(), 1);
        assert!(!page.contains(tail) && !page.contains("abcDEF123.456_xyz"), "{page}");
    }
}
