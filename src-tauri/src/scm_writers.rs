//! GIT-017 / GIT-018 / GIT-020 / GIT-022 (T-228-d, T-227-d): who writes commit messages. Eight
//! agent CLIs can be picked (Claude Code, Codex, Amp, Kimi, Copilot, Pi, Cursor, Antigravity), each
//! with its own model and thinking effort; the model list is read from the installed CLI, never
//! typed in. This file builds the command line each agent expects for one non-interactive,
//! prompt-in / message-out run, reads the model lists, renames a placeholder branch after the work,
//! and asks the chosen writer for the pull-request text (GIT-024, in pr_review.rs).
//!
//! Sources (public docs and each tool's own `--help`, 2026-10-19): Claude Code and Codex `--help`,
//! `codex debug models`; Amp manual (execute mode, prompt on standard input); Kimi Code CLI reference
//! (`--print`, `--final-message-only`, `-m`, `--thinking`); GitHub Copilot CLI (`-p`, `--model`,
//! `-s`); Pi coding agent docs (`--print`, `--model`, `--thinking`, `--list-models`); Cursor CLI
//! reference (`-p`, `--model`, `--mode ask`, `models`); Antigravity CLI headless docs (`-p`,
//! `--model`, `--effort`, `agy models`). Nothing here starts a real agent session in a test.
//! T-606 (2026-10-30): Claude Code's CLI reference and its permissions and headless pages
//! (`--setting-sources`, `--strict-mcp-config`, what `-p` runs in a folder never trusted); Cursor's
//! CLI parameters (`--trust`).

use super::quiet;
use std::path::Path;

/// How a thinking effort reaches the agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffortVia {
    /// The agent has no effort setting.
    No,
    /// `--effort <level>`.
    EffortFlag,
    /// `-c model_reasoning_effort=<level>`.
    CodexConfig,
    /// `--thinking <level>`.
    ThinkingFlag,
    /// `--thinking` / `--no-thinking` (levels `off` and `on`).
    KimiThinking,
}

/// One agent that can write a commit message.
pub struct Spec {
    pub id: &'static str,
    pub name: &'static str,
    /// Program names to look for, best first.
    pub programs: &'static [&'static str],
    /// The prompt travels as an argument (limited in length); otherwise on standard input.
    pub prompt_in_args: bool,
    pub effort: EffortVia,
    /// The effort levels offered when the CLI does not say.
    pub efforts: &'static [&'static str],
}

pub const SPECS: [Spec; 8] = [
    Spec { id: "claude", name: "Claude Code", programs: &["claude"], prompt_in_args: false, effort: EffortVia::EffortFlag, efforts: &["low", "medium", "high", "xhigh", "max"] },
    Spec { id: "codex", name: "Codex", programs: &["codex"], prompt_in_args: false, effort: EffortVia::CodexConfig, efforts: &["low", "medium", "high", "xhigh"] },
    Spec { id: "amp", name: "Amp", programs: &["amp"], prompt_in_args: false, effort: EffortVia::No, efforts: &[] },
    Spec { id: "kimi", name: "Kimi", programs: &["kimi", "kimi-code"], prompt_in_args: true, effort: EffortVia::KimiThinking, efforts: &["off", "on"] },
    Spec { id: "copilot", name: "GitHub Copilot", programs: &["copilot"], prompt_in_args: true, effort: EffortVia::No, efforts: &[] },
    Spec { id: "pi", name: "Pi", programs: &["pi"], prompt_in_args: false, effort: EffortVia::ThinkingFlag, efforts: &["off", "minimal", "low", "medium", "high", "xhigh"] },
    Spec { id: "cursor", name: "Cursor", programs: &["cursor-agent", "agent"], prompt_in_args: true, effort: EffortVia::No, efforts: &[] },
    Spec { id: "antigravity", name: "Antigravity", programs: &["agy"], prompt_in_args: true, effort: EffortVia::EffortFlag, efforts: &["low", "medium", "high"] },
];

pub fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

/// What a model name may look like: never a flag, nothing a shell would read.
pub fn model_ok(m: &str) -> bool {
    let mut chars = m.chars();
    m.len() <= 120 && chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) && m.chars().all(|c| c.is_ascii_alphanumeric() || ".:/@+_-".contains(c))
}

/// The most an argument-borne prompt may be: Windows ends a command line at 32,767 characters and a
/// `.cmd` shim at 8,191, so a shim gets a smaller share.
pub fn arg_limit(program: &Path) -> usize {
    let shim = program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if shim {
        6_500
    } else {
        28_000
    }
}

/// The program and arguments of one run.
#[derive(Debug, PartialEq, Eq)]
pub struct Invocation {
    pub args: Vec<String>,
    pub input: Option<String>,
}

/// The command line for `spec` writing from `prompt`. A model that is not a plain name, or an effort
/// the agent does not offer, is dropped (the agent's own default then applies); Claude Code keeps
/// Sonnet as its default model.
pub fn invocation(spec: &Spec, model: Option<&str>, effort: Option<&str>, prompt: &str) -> Invocation {
    let model = model.map(str::trim).filter(|m| model_ok(m));
    let effort = effort.map(str::trim).filter(|e| spec.efforts.contains(e));
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    let mut input = None;
    match spec.id {
        "claude" => {
            // T-606 (R05-git-scm.1): only the user's own settings and no MCP servers, so no folder's
            // `.claude` hooks, env block or `.mcp.json` servers run (code.claude.com/docs/en/cli-reference;
            // `--bare` would also drop a subscription sign-in, code.claude.com/docs/en/headless).
            push(&["-p", "--setting-sources", "user", "--strict-mcp-config", "--model", model.unwrap_or("sonnet")]);
            if let Some(e) = effort {
                push(&["--effort", e]);
            }
            input = Some(prompt.to_string());
        }
        "codex" => {
            push(&["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never", "-s", "read-only"]);
            if let Some(m) = model {
                push(&["-m", m]);
            }
            if let Some(e) = effort {
                push(&["-c", &format!("model_reasoning_effort={e}")]);
            }
            push(&["-"]);
            input = Some(prompt.to_string());
        }
        "amp" => {
            push(&["-x"]);
            input = Some(prompt.to_string());
        }
        "kimi" => {
            push(&["--print", "--final-message-only"]);
            if let Some(m) = model {
                push(&["-m", m]);
            }
            match effort {
                Some("on") => push(&["--thinking"]),
                Some("off") => push(&["--no-thinking"]),
                _ => {}
            }
            push(&["-p", prompt]);
        }
        "copilot" => {
            push(&["-p", prompt, "-s"]);
            if let Some(m) = model {
                push(&["--model", m]);
            }
        }
        "pi" => {
            push(&["-p", "--no-session", "--no-tools"]);
            if let Some(m) = model {
                push(&["--model", m]);
            }
            if let Some(e) = effort {
                push(&["--thinking", e]);
            }
            // Standard input is put in front of the prompt argument.
            push(&["Write the commit message the text above asks for."]);
            input = Some(prompt.to_string());
        }
        "cursor" => {
            // `--mode ask` keeps the agent from editing files while it only has to answer.
            push(&["-p", "--mode", "ask", "--output-format", "text"]);
            if let Some(m) = model {
                push(&["--model", m]);
            }
            push(&[prompt]);
        }
        "antigravity" => {
            push(&["-p", prompt]);
            if let Some(m) = model {
                push(&["--model", m]);
            }
            if let Some(e) = effort {
                push(&["--effort", e]);
            }
        }
        _ => {}
    }
    Invocation { args: a, input }
}

/// One model an agent offers.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    /// The efforts this model takes; empty means the agent's general list.
    pub efforts: Vec<String>,
}

fn plain(id: &str) -> ModelInfo {
    ModelInfo { id: id.to_string(), name: id.to_string(), efforts: Vec::new() }
}

/// What the settings page shows for one agent.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub agent: String,
    pub name: String,
    pub installed: bool,
    pub models: Vec<ModelInfo>,
    pub efforts: Vec<String>,
    /// Why the list is empty, or what to do about it.
    pub hint: Option<String>,
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// The help text of `flag`: its line and the indented lines wrapped under it.
fn flag_block(help: &str, flag: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for line in help.lines() {
        let t = line.trim_start();
        if inside {
            if t.starts_with('-') || t.is_empty() {
                break;
            }
            out.push(' ');
            out.push_str(t);
        } else if t.starts_with(flag) || t.contains(&format!(", {flag}")) {
            inside = true;
            out.push_str(t);
        }
    }
    out
}

/// Words in single quotes (`'opus'`), not apostrophes inside a word.
fn single_quoted(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let opens = chars[i] == '\'' && (i == 0 || !chars[i - 1].is_alphanumeric());
        if opens {
            let word: String = chars[i + 1..].iter().take_while(|c| c.is_ascii_alphanumeric() || "._-".contains(**c)).collect();
            let end = i + 1 + word.chars().count();
            if !word.is_empty() && chars.get(end) == Some(&'\'') {
                out.push(word);
                i = end;
            }
        }
        i += 1;
    }
    out
}

/// Words in double quotes after `choices:` / `possible values:` (Copilot-style help).
fn double_quoted_choices(text: &str) -> Vec<String> {
    let low = text.to_lowercase();
    let Some(at) = low.find("choices:").or_else(|| low.find("possible values:")) else { return Vec::new() };
    let rest = &text[at..];
    let end = rest.find(')').unwrap_or(rest.len());
    rest[..end].split('"').skip(1).step_by(2).map(str::to_string).filter(|w| model_ok(w)).collect()
}

/// `(low, medium, high)` lists in a flag's help.
fn paren_list(text: &str) -> Vec<String> {
    let Some(open) = text.rfind('(') else { return Vec::new() };
    let inner = &text[open + 1..];
    let inner = &inner[..inner.find(')').unwrap_or(inner.len())];
    inner.split(',').map(|w| w.trim().trim_matches('"').to_string()).filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase())).collect()
}

/// Claude Code: its model aliases and effort levels, both read from `claude --help`.
pub fn parse_claude_help(help: &str) -> (Vec<ModelInfo>, Vec<String>) {
    let models = single_quoted(&flag_block(help, "--model")).iter().map(|m| plain(m)).collect();
    (models, paren_list(&flag_block(help, "--effort")))
}

/// Copilot: the model choices its `--model` help lists.
pub fn parse_choices(help: &str, flag: &str) -> Vec<ModelInfo> {
    double_quoted_choices(&flag_block(help, flag)).iter().map(|m| plain(m)).collect()
}

/// Codex: `codex debug models` prints `{"models":[{slug, display_name, visibility,
/// supported_reasoning_levels:[{effort}]}]}`; hidden entries are left out.
pub fn parse_codex_models(json: &str) -> Vec<ModelInfo> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    let Some(list) = v.get("models").and_then(|m| m.as_array()) else { return Vec::new() };
    list.iter()
        .filter(|m| m.get("visibility").and_then(|x| x.as_str()).is_none_or(|x| x == "list"))
        .filter_map(|m| {
            let id = m.get("slug")?.as_str()?.to_string();
            let name = m.get("display_name").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
            let efforts = m.get("supported_reasoning_levels").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|e| e.get("effort")?.as_str().map(str::to_string)).collect()).unwrap_or_default();
            model_ok(&id).then_some(ModelInfo { id, name, efforts })
        })
        .collect()
}

/// Pi: `pi --list-models` prints a table (a `provider` and a `model` column); the model is named
/// `provider/model`. Without a header the first word of each line is the model.
pub fn parse_pi_models(text: &str) -> Vec<ModelInfo> {
    let text = strip_ansi(text);
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let first = lines.next().unwrap_or("");
    let head: Vec<String> = first.split_whitespace().map(|w| w.to_lowercase()).collect();
    let table = head.first().is_some_and(|h| h == "provider") && head.get(1).is_some_and(|h| h == "model");
    let rows: Vec<&str> = if table { lines.collect() } else { std::iter::once(first).chain(lines).collect() };
    rows.iter()
        .filter_map(|l| {
            let w: Vec<&str> = l.split_whitespace().collect();
            let id = if table { format!("{}/{}", w.first()?, w.get(1)?) } else { w.first()?.to_string() };
            model_ok(&id).then(|| plain(&id))
        })
        .collect()
}

/// Cursor and Antigravity: one model per line, as `id`, `id - Name` or `id (default)`, under any
/// number of heading or tip lines.
pub fn parse_id_lines(text: &str) -> Vec<ModelInfo> {
    let text = strip_ansi(text);
    text.lines()
        .filter_map(|l| {
            let t = l.trim().trim_start_matches(['-', '*', '\u{2022}', '\u{2713}', ' ']);
            let (id, rest) = t.split_once(char::is_whitespace).map_or((t, ""), |(a, b)| (a, b.trim()));
            let tail_ok = rest.is_empty() || rest.starts_with('-') || rest.starts_with('(') || rest.starts_with('\u{2013}') || rest.starts_with(':');
            let name = rest.trim_start_matches(['-', '\u{2013}', ':', ' ']);
            (tail_ok && model_ok(id) && id.len() > 1 && !id.ends_with(':')).then(|| ModelInfo { id: id.to_string(), name: if name.is_empty() || name.starts_with('(') { id.to_string() } else { name.to_string() }, efforts: Vec::new() })
        })
        .collect()
}

/// Runs `program args` for its text, giving up after `limit`. Used only for the list commands.
fn capture(program: &Path, args: &[&str], limit: std::time::Duration) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = quiet(program).args(args).env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let mut pipe = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(p) = pipe.as_mut() {
            let _ = p.read_to_string(&mut text);
        }
        text
    });
    let end = std::time::Instant::now() + limit;
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if std::time::Instant::now() >= end {
            #[cfg(windows)]
            let _ = quiet("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).output();
            let _ = child.kill();
            let _ = child.wait();
            return Err("The list took too long".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    reader.join().map_err(|_| "unreadable".to_string())
}

type Runner<'a> = &'a dyn Fn(&Path, &[&str]) -> Result<String, String>;

/// The models and efforts `spec` offers, read from its installed CLI; empty with a hint when the
/// CLI is missing or has no list.
pub fn options_for(spec: &Spec, find: &dyn Fn(&str) -> Option<std::path::PathBuf>, run: Runner) -> Options {
    let program = spec.programs.iter().find_map(|p| find(p));
    let mut out = Options { agent: spec.id.into(), name: spec.name.into(), installed: program.is_some(), models: Vec::new(), efforts: if spec.effort == EffortVia::No { Vec::new() } else { spec.efforts.iter().map(|e| e.to_string()).collect() }, hint: None };
    let Some(program) = program else {
        out.hint = Some(format!("{} is not installed on this computer, so there is no model list to show.", spec.name));
        return out;
    };
    let listed: Option<Result<String, String>> = match spec.id {
        "claude" | "copilot" | "kimi" | "amp" => Some(run(&program, &["--help"])),
        "codex" => Some(run(&program, &["debug", "models"])),
        "pi" => Some(run(&program, &["--list-models"])),
        "cursor" | "antigravity" => Some(run(&program, &["models"])),
        _ => None,
    };
    match listed {
        Some(Ok(text)) => match spec.id {
            "claude" => {
                let (models, efforts) = parse_claude_help(&text);
                out.models = models;
                if !efforts.is_empty() {
                    out.efforts = efforts;
                }
            }
            "copilot" => out.models = parse_choices(&text, "--model"),
            "codex" => out.models = parse_codex_models(&text),
            "pi" => out.models = parse_pi_models(&text),
            "cursor" | "antigravity" => out.models = parse_id_lines(&text),
            _ => {}
        },
        Some(Err(e)) => out.hint = Some(format!("{} did not list its models ({e}).", spec.name)),
        None => {}
    }
    if out.models.is_empty() && out.hint.is_none() {
        out.hint = Some(format!("{} does not list its models; it uses its own default.", spec.name));
    }
    out
}

/// GIT-018: the models and efforts of one agent, read from its installed CLI.
#[tauri::command]
pub async fn scm_writer_options(agent: String) -> Result<Options, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let spec = spec(&agent).ok_or_else(|| format!("unknown agent {agent}"))?;
        Ok(options_for(spec, &|name| crate::agents::find_program(name), &|program, args| capture(program, args, std::time::Duration::from_secs(20))))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The program of `spec` on this computer.
pub fn program_of(spec: &Spec) -> Option<std::path::PathBuf> {
    spec.programs.iter().find_map(|p| crate::agents::find_program(p))
}

// ---- GIT-020: naming a branch after the work ----

/// A short lowercase slug from `text`: letters and digits kept, anything else becomes one hyphen,
/// at most `max` characters cut at a word. None when nothing is left.
pub fn slug(text: &str, max: usize) -> Option<String> {
    let mut words: Vec<String> = Vec::new();
    for w in text.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()) {
        words.push(w.to_string());
    }
    let mut out = String::new();
    for w in words {
        let extra = if out.is_empty() { w.len() } else { w.len() + 1 };
        if out.len() + extra > max {
            if out.is_empty() {
                out = w.chars().take(max).collect();
            }
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(&w);
    }
    (!out.is_empty()).then_some(out)
}

/// The last part of a branch name (`kolux/amber-otter` -> `amber-otter`).
pub fn last_part(branch: &str) -> &str {
    branch.rsplit('/').next().unwrap_or(branch)
}

/// Whether `branch` still carries the placeholder name the workspace was created with: its last part
/// is the name of the worktree folder.
pub fn is_placeholder(branch: &str, folder: &str) -> bool {
    !folder.is_empty() && last_part(branch) == folder
}

/// What the agent is asked when it names a branch.
pub fn name_prompt(task: &str) -> String {
    let task: String = task.trim().chars().take(1_500).collect();
    format!("Name a git branch for the work described below: two to five short lowercase words joined by hyphens, no prefix, no slashes. Reply with the name only.\n\nWork:\n{task}")
}

/// The new full branch name: the old branch's prefix, then the slug of `answer` (the agent's reply,
/// else the task's own words).
pub fn new_branch_name(old: &str, answer: &str, task: &str) -> Option<String> {
    let first = answer.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let s = slug(first, 40).or_else(|| slug(task, 40))?;
    let prefix = old.rfind('/').map_or("", |i| &old[..=i]);
    Some(format!("{prefix}{s}"))
}

/// The outcome of a rename attempt.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Renamed {
    pub renamed: bool,
    pub branch: String,
    /// Why nothing was renamed.
    pub reason: Option<String>,
}

fn skipped(branch: &str, why: &str) -> Renamed {
    Renamed { renamed: false, branch: branch.to_string(), reason: Some(why.to_string()) }
}

/// Renames the checked-out branch of `worktree` to `wanted`, unless it has an upstream (renaming
/// would leave the remote name behind and quietly break tracking) or the name is taken, in which
/// case `-2`, `-3` ... is tried.
pub fn rename_branch(worktree: &Path, wanted: &str) -> Result<Renamed, String> {
    let old = crate::git::run(&["symbolic-ref", "--short", "-q", "HEAD"], Some(worktree)).map_err(|_| "no branch checked out".to_string())?.trim().to_string();
    if old.is_empty() {
        return Ok(skipped("", "No branch checked out"));
    }
    if crate::git::run(&["config", &format!("branch.{old}.remote")], Some(worktree)).is_ok_and(|r| !r.trim().is_empty()) {
        return Ok(skipped(&old, "The branch already tracks a remote branch, so it keeps its name"));
    }
    let taken = |name: &str| crate::git::run(&["rev-parse", "--verify", "-q", &format!("refs/heads/{name}")], Some(worktree)).is_ok();
    let mut name = wanted.to_string();
    for n in 2..10 {
        if !taken(&name) {
            break;
        }
        name = format!("{wanted}-{n}");
    }
    if taken(&name) {
        return Ok(skipped(&old, "Every name tried was taken"));
    }
    if name == old {
        return Ok(skipped(&old, "Already named that"));
    }
    crate::git::run(&["check-ref-format", "--branch", &name], None).map_err(|_| format!("Git does not accept the name {name}"))?;
    crate::git::run(&["branch", "-m", &old, &name], Some(worktree))?;
    Ok(Renamed { renamed: true, branch: name, reason: None })
}

/// Which agent writes, as the front end sends it.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterArg {
    pub agent: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub command: Option<String>,
}

/// Asks the chosen writer for `prompt`'s answer in `dir`. A custom command wins; else the agent
/// (Claude Code by default).
pub fn ask(writer: &WriterArg, prompt: &str, dir: &Path, key: &str, limit: std::time::Duration) -> Result<String, String> {
    ask_with(writer, prompt, dir, key, limit, &|name| crate::agents::find_program(name))
}

/// `ask` with the program lookup injected, so a test can stand a script in for an agent.
fn ask_with(writer: &WriterArg, prompt: &str, dir: &Path, key: &str, limit: std::time::Duration, find: &dyn Fn(&str) -> Option<std::path::PathBuf>) -> Result<String, String> {
    if let Some(line) = writer.command.as_deref().filter(|c| !c.trim().is_empty()) {
        let words = super::split_command(line);
        let (args, input) = super::writer_args(&words[1..], prompt);
        let program = find(&words[0]).unwrap_or_else(|| std::path::PathBuf::from(&words[0]));
        return super::write_message(&program, &args.iter().map(String::as_str).collect::<Vec<_>>(), dir, input.as_deref(), key, limit);
    }
    let id = writer.agent.as_deref().unwrap_or("claude");
    let spec = spec(id).ok_or_else(|| format!("unknown agent {id}"))?;
    let program = spec.programs.iter().find_map(|p| find(p)).ok_or_else(|| format!("{} was not found on this computer", spec.name))?;
    let prompt = if spec.prompt_in_args { prompt.chars().take(arg_limit(&program)).collect::<String>() } else { prompt.to_string() };
    let inv = invocation(spec, writer.model.as_deref(), writer.effort.as_deref(), &prompt);
    run(spec, &program, &inv, key, limit)
}

/// T-606 (R05-git-scm.1, R05-git-scm.3): runs writer agent `spec` (its program found at `program`)
/// as `inv` says, from an empty folder of its own that goes when the run ends, never the workspace:
/// the prompt carries the diff, and a workspace made from someone else's pull request can hold agent
/// settings that run code (Claude Code reads a folder's hooks, env block and `.mcp.json` servers
/// under `-p` without asking). A custom command (GIT-018) and a recipe template are the user's own
/// and still run in the workspace.
pub fn run(spec: &Spec, program: &Path, inv: &Invocation, key: &str, limit: std::time::Duration) -> Result<String, String> {
    let mut args = inv.args.clone();
    if spec.id == "cursor" {
        // Headless Cursor stops at "Workspace Trust Required" in a folder it has not seen; `--trust`
        // trusts this empty one only (cursor.com/docs/cli/reference/parameters).
        args.insert(args.len().min(1), "--trust".into());
    }
    let (program, args) = launch_on(program, &args, cfg!(windows))?;
    let dir = Scratch::new()?;
    super::write_message(&program, &args.iter().map(String::as_str).collect::<Vec<_>>(), &dir.0, inv.input.as_deref(), key, limit)
}

/// How a writer starts under Windows' rules or not (`windows`): npm's launcher as its real program,
/// node on the package's script (`pty::start_line`, T-605), so a prompt argument keeps its line
/// breaks; any other `.cmd` / `.bat` is handed to the standard library, which runs it through cmd.exe
/// with its own escaping but cannot pass it a line break, so such a prompt is refused in plain words.
fn launch_on(program: &Path, args: &[String], windows: bool) -> Result<(std::path::PathBuf, Vec<String>), String> {
    let (exe, head) = crate::pty::start_line_on(program, windows);
    // T-660: the command prompt now goes by its full path in Windows' system folder.
    if exe != crate::pty::system_program("cmd.exe").as_os_str() {
        return Ok((exe.into(), head.iter().map(|h| h.to_string_lossy().into_owned()).chain(args.iter().cloned()).collect()));
    }
    if args.iter().any(|a| a.contains(['\r', '\n'])) {
        let name = program.file_name().map_or_else(|| program.display().to_string(), |n| n.to_string_lossy().into_owned());
        return Err(format!("This writer is installed as a Windows command script ({name}), which cannot be handed a prompt with line breaks. Install the agent's own program, or pick another writer."));
    }
    Ok((program.to_path_buf(), args.to_vec()))
}

/// An empty folder of its own for one writer run, removed when the run ends.
// ponytail: a folder an agent still holds open at the end stays in the temp folder; Windows clears it.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new() -> Result<Scratch, String> {
        use std::hash::{BuildHasher, Hasher};
        for _ in 0..16 {
            // A random name (std's per-hasher random keys), so no other user can guess it ahead.
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
            let dir = std::env::temp_dir().join(format!("kolux-writer-{:016x}", h.finish()));
            let make = {
                #[allow(unused_mut)] // set below on Unix only
                let mut b = std::fs::DirBuilder::new();
                // Only this user may look inside on Unix (Windows' temp folder is per user already).
                #[cfg(unix)]
                std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
                b
            };
            // `create`, not `recursive`: a folder that is already there is never used.
            match make.create(&dir) {
                Ok(()) => return Ok(Scratch(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Could not make a folder for the writer: {e}")),
            }
        }
        Err("Could not make a folder for the writer".into())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// GIT-020: renames a placeholder branch after the work. `task` is what the agent was asked to do;
/// the writer names the branch, and the task's own words are used when it cannot.
#[tauri::command]
pub async fn scm_name_branch(worktree: String, task: String, writer: Option<WriterArg>) -> Result<Renamed, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = format!("name:{worktree}");
        name_branch_with(Path::new(&worktree), &task, writer.as_ref(), &|w, prompt| ask(w, prompt, Path::new(&worktree), &key, std::time::Duration::from_secs(60)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether the front end named a writer at all. Unlike `ask`, branch naming never falls back to Claude
/// Code: no writer means the user turned AI off, so no agent runs and the task's own words name it.
pub(crate) fn writer_chosen(w: &WriterArg) -> bool {
    w.agent.is_some() || w.command.as_deref().is_some_and(|c| !c.trim().is_empty())
}

/// `scm_name_branch` with the asking injected, so a test can prove no agent is started.
fn name_branch_with(dir: &Path, task: &str, writer: Option<&WriterArg>, asker: &dyn Fn(&WriterArg, &str) -> Result<String, String>) -> Result<Renamed, String> {
    let folder = dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let old = crate::git::run(&["symbolic-ref", "--short", "-q", "HEAD"], Some(dir)).map_err(|_| "no branch checked out".to_string())?.trim().to_string();
    if !is_placeholder(&old, &folder) {
        return Ok(skipped(&old, "The branch already has a name of its own"));
    }
    let answer = writer.filter(|w| writer_chosen(w)).map(|w| asker(w, &name_prompt(task)).unwrap_or_default()).unwrap_or_default();
    match new_branch_name(&old, &answer, task) {
        Some(name) => rename_branch(dir, &name),
        None => Ok(skipped(&old, "Nothing in the task could name a branch")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(id: &str, model: Option<&str>, effort: Option<&str>, prompt: &str) -> Invocation {
        invocation(spec(id).unwrap(), model, effort, prompt)
    }

    #[test]
    fn git018_d_claude_keeps_sonnet_until_a_model_is_picked_and_takes_an_effort() {
        assert_eq!(args("claude", None, None, "P").args, ["-p", "--setting-sources", "user", "--strict-mcp-config", "--model", "sonnet"]);
        let i = args("claude", Some("opus"), Some("high"), "P");
        assert_eq!(i.args, ["-p", "--setting-sources", "user", "--strict-mcp-config", "--model", "opus", "--effort", "high"]);
        assert_eq!(i.input.as_deref(), Some("P"));
    }

    #[test]
    fn git018_d_codex_runs_exec_read_only_with_the_model_and_effort_and_the_prompt_on_stdin() {
        let i = args("codex", Some("gpt-5.5"), Some("xhigh"), "P");
        assert_eq!(i.args, ["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never", "-s", "read-only", "-m", "gpt-5.5", "-c", "model_reasoning_effort=xhigh", "-"]);
        assert_eq!(i.input.as_deref(), Some("P"));
        assert!(!args("codex", None, None, "P").args.contains(&"-m".to_string()));
    }

    #[test]
    fn git017_d_each_other_writer_gets_its_own_flags() {
        assert_eq!(args("amp", None, None, "P"), Invocation { args: vec!["-x".into()], input: Some("P".into()) });
        assert_eq!(args("kimi", Some("k2"), Some("on"), "P").args, ["--print", "--final-message-only", "-m", "k2", "--thinking", "-p", "P"]);
        assert_eq!(args("kimi", None, Some("off"), "P").args, ["--print", "--final-message-only", "--no-thinking", "-p", "P"]);
        assert_eq!(args("copilot", Some("m1"), None, "P").args, ["-p", "P", "-s", "--model", "m1"]);
        let pi = args("pi", Some("prov/m"), Some("minimal"), "P");
        assert_eq!(pi.args[..6], ["-p", "--no-session", "--no-tools", "--model", "prov/m", "--thinking"]);
        assert_eq!(pi.input.as_deref(), Some("P"));
        assert_eq!(args("cursor", Some("auto"), None, "P").args, ["-p", "--mode", "ask", "--output-format", "text", "--model", "auto", "P"]);
        assert_eq!(args("antigravity", Some("m"), Some("low"), "P").args, ["-p", "P", "--model", "m", "--effort", "low"]);
    }

    #[test]
    fn git018_d_a_model_that_looks_like_a_flag_or_an_unoffered_effort_is_dropped() {
        assert_eq!(args("copilot", Some("--allow-all"), None, "P").args, ["-p", "P", "-s"]);
        assert_eq!(args("codex", Some("a b"), Some("ultra"), "P").args.last().unwrap(), "-");
        assert!(!args("codex", Some("a b"), Some("ultra"), "P").args.iter().any(|a| a == "-m" || a.starts_with("model_reasoning")));
        assert!(!args("amp", None, Some("high"), "P").args.contains(&"high".to_string()));
        assert!(model_ok("gpt-5.5") && model_ok("provider/model:high") && !model_ok("-x") && !model_ok("") && !model_ok("a;b"));
    }

    #[test]
    fn git017_d_a_shim_gets_a_smaller_argument_share_than_an_exe() {
        assert!(arg_limit(Path::new("C:/n/copilot.cmd")) < 8_191);
        assert_eq!(arg_limit(Path::new("C:/n/agy.exe")), 28_000);
    }

    #[test]
    fn git018_d_claude_models_and_efforts_are_read_from_its_help_text() {
        let help = "  --effort <level>                      Effort level for the current session\n                                        (low, medium, high, xhigh, max)\n  --model <model>                       Model for the current session. Provide\n                                        an alias for the latest model (e.g.\n                                        'fable', 'opus', or 'sonnet') or a\n                                        model's full name.\n  -n, --name <name>                     Set a display name\n";
        let (models, efforts) = parse_claude_help(help);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["fable", "opus", "sonnet"]);
        assert_eq!(efforts, ["low", "medium", "high", "xhigh", "max"]);
        assert!(parse_claude_help("nothing here").0.is_empty());
    }

    #[test]
    fn git018_d_codex_models_come_from_its_catalog_json_without_the_hidden_ones() {
        let json = r#"{"models":[
          {"slug":"model-a","display_name":"Model A","visibility":"list","supported_reasoning_levels":[{"effort":"low","description":"x"},{"effort":"high","description":"y"}]},
          {"slug":"model-b","display_name":"Model B","visibility":"hide","supported_reasoning_levels":[]},
          {"slug":"model-c","visibility":"list"}]}"#;
        let m = parse_codex_models(json);
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].id.as_str(), m[0].name.as_str(), m[0].efforts.clone()), ("model-a", "Model A", vec!["low".to_string(), "high".to_string()]));
        assert_eq!(m[1].name, "model-c");
        assert!(parse_codex_models("not json").is_empty() && parse_codex_models("{}").is_empty());
    }

    #[test]
    fn git018_d_copilot_choices_pi_tables_and_id_lines_parse() {
        let help = "  --model <model>        Set the AI model (choices: \"gpt-5\",\n                         \"claude-sonnet-4.5\")\n  --other x  y\n";
        assert_eq!(parse_choices(help, "--model").iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["gpt-5", "claude-sonnet-4.5"]);
        let pi = "provider   model       context  max-out  thinking  images\nanthropic  sonnet-x    200K     64K      yes       yes\nopenai     gpt-y       400K     128K     yes       no\n";
        assert_eq!(parse_pi_models(pi).iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["anthropic/sonnet-x", "openai/gpt-y"]);
        assert_eq!(parse_pi_models("m-one\nm-two  extra").len(), 2);
        let cur = "\u{1b}[1mAvailable models\u{1b}[0m\n\nauto - Auto (default)\ncomposer-1 - Composer 1\n- model-x (current)\nTip: use --model to switch\n";
        let ids: Vec<String> = parse_id_lines(cur).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["auto", "composer-1", "model-x"]);
    }

    #[test]
    fn git018_d_a_missing_cli_shows_an_empty_list_with_a_hint_and_runs_nothing() {
        let ran = std::cell::Cell::new(false);
        let o = options_for(spec("codex").unwrap(), &|_| None, &|_, _| {
            ran.set(true);
            Ok(String::new())
        });
        assert!(!o.installed && o.models.is_empty() && !ran.get());
        assert!(o.hint.unwrap().contains("not installed"));
    }

    #[test]
    fn git018_d_an_installed_cli_is_asked_its_own_list_command() {
        let seen = std::cell::RefCell::new(Vec::<String>::new());
        let find = |_: &str| Some(std::path::PathBuf::from("tool"));
        let run = |_: &Path, a: &[&str]| {
            seen.borrow_mut().push(a.join(" "));
            Ok(r#"{"models":[{"slug":"m1","visibility":"list","supported_reasoning_levels":[{"effort":"low"}]}]}"#.to_string())
        };
        let o = options_for(spec("codex").unwrap(), &find, &run);
        assert_eq!(o.models.len(), 1);
        assert_eq!(seen.borrow()[0], "debug models");
        let amp = options_for(spec("amp").unwrap(), &find, &|_, _| Ok("usage".into()));
        assert!(amp.models.is_empty() && amp.hint.unwrap().contains("own default"));
        let bad = options_for(spec("pi").unwrap(), &find, &|_, _| Err("exit 1".into()));
        assert!(bad.hint.unwrap().contains("did not list"));
    }

    #[test]
    fn git020_d_branch_slug_prefix_and_placeholder() {
        assert_eq!(slug("Fix the Poll  loop!", 40).as_deref(), Some("fix-the-poll-loop"));
        assert_eq!(slug("one two three four five", 12).as_deref(), Some("one-two"));
        assert_eq!(slug("!!!", 40), None);
        assert_eq!(slug("abcdefghijklmnop", 5).as_deref(), Some("abcde"));
        assert!(is_placeholder("kolux/amber-otter", "amber-otter") && is_placeholder("amber-otter", "amber-otter") && !is_placeholder("fix-poll", "amber-otter"));
        assert_eq!(new_branch_name("kolux/amber-otter", "  Fix Poll Loop\nextra", "task").as_deref(), Some("kolux/fix-poll-loop"));
        assert_eq!(new_branch_name("amber-otter", "", "Add dark mode toggle").as_deref(), Some("add-dark-mode-toggle"));
        assert_eq!(new_branch_name("amber-otter", "", "???"), None);
    }

    #[test]
    fn git020_d_rename_keeps_a_tracked_branch_and_avoids_a_taken_name() {
        let tmp = std::env::temp_dir().join(format!("kolux-rs-rename-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let g = |a: &[&str]| crate::git::run(a, Some(&tmp)).unwrap();
        g(&["init", "-q", "-b", "kolux/amber-otter"]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "one"]);
        g(&["branch", "kolux/fix-poll"]);
        let r = rename_branch(&tmp, "kolux/fix-poll").unwrap();
        assert!(r.renamed && r.branch == "kolux/fix-poll-2", "{r:?}");
        assert_eq!(g(&["symbolic-ref", "--short", "HEAD"]).trim(), "kolux/fix-poll-2");
        g(&["config", "branch.kolux/fix-poll-2.remote", "origin"]);
        let kept = rename_branch(&tmp, "kolux/other").unwrap();
        assert!(!kept.renamed && kept.reason.unwrap().contains("tracks"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn placeholder_repo(tag: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!("kolux-rs-name931-{tag}-{}", std::process::id())).join("amber-otter");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let g = |a: &[&str]| crate::git::run(a, Some(&tmp)).unwrap();
        g(&["init", "-q", "-b", "kolux/amber-otter"]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "one"]);
        tmp
    }

    #[test]
    fn row931_a_branch_with_no_writer_is_named_from_the_task_and_no_agent_is_started() {
        let calls = std::cell::Cell::new(0);
        let asker = |_: &WriterArg, _: &str| -> Result<String, String> {
            calls.set(calls.get() + 1);
            Ok("never-used".into())
        };
        let dir = placeholder_repo("none");
        let r = name_branch_with(&dir, "Add dark mode toggle", None, &asker).unwrap();
        assert!(r.renamed && r.branch == "kolux/add-dark-mode-toggle", "{r:?}");
        assert_eq!(calls.get(), 0, "writer None must not ask");
        let dir2 = placeholder_repo("empty");
        let r = name_branch_with(&dir2, "Add dark mode toggle", Some(&WriterArg::default()), &asker).unwrap();
        assert!(r.renamed && r.branch == "kolux/add-dark-mode-toggle", "{r:?}");
        let blank = WriterArg { command: Some("  ".into()), ..Default::default() };
        let dir3 = placeholder_repo("blank");
        assert!(name_branch_with(&dir3, "Add dark mode toggle", Some(&blank), &asker).unwrap().renamed);
        assert_eq!(calls.get(), 0, "a writer with no agent and no command must not ask (Claude is not a default here)");
        for d in [dir, dir2, dir3] {
            let _ = std::fs::remove_dir_all(d.parent().unwrap());
        }
    }

    #[test]
    fn row931_a_chosen_agent_or_command_is_asked_once_and_its_answer_names_the_branch() {
        let calls = std::cell::Cell::new(0);
        let asker = |_: &WriterArg, _: &str| -> Result<String, String> {
            calls.set(calls.get() + 1);
            Ok("Fix Poll Loop".into())
        };
        let dir = placeholder_repo("agent");
        let w = WriterArg { agent: Some("claude".into()), ..Default::default() };
        let r = name_branch_with(&dir, "task words", Some(&w), &asker).unwrap();
        assert!(r.renamed && r.branch == "kolux/fix-poll-loop", "{r:?}");
        assert_eq!(calls.get(), 1);
        let dir2 = placeholder_repo("cmd");
        let c = WriterArg { command: Some("my-writer --x".into()), ..Default::default() };
        assert!(name_branch_with(&dir2, "task words", Some(&c), &asker).unwrap().renamed);
        assert_eq!(calls.get(), 2);
        for d in [dir, dir2] {
            let _ = std::fs::remove_dir_all(d.parent().unwrap());
        }
    }

    /// A stand-in agent: it prints the folder it runs in, the arguments it was given and how many
    /// entries that folder holds.
    fn stand_in(dir: &Path) -> std::path::PathBuf {
        if cfg!(windows) {
            let f = dir.join("stand-in.cmd");
            // `find /c` prints 0 for empty input but exits 1, and this script ends on that line, so
            // the writer would read a successful run as a failed agent. A real agent exits 0.
            std::fs::write(&f, "@echo off\r\ncd\r\necho %*\r\ndir /b /a 2>nul | find /c /v \"\"\r\nexit /b 0\r\n").unwrap();
            return f;
        }
        let f = dir.join("stand-in");
        std::fs::write(&f, "#!/bin/sh\npwd\necho \"$@\"\nls -A | wc -l\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        f
    }

    /// T-606 (R05-git-scm.1): the Claude Code writer runs from an empty folder of its own, never the
    /// workspace (the prompt carries the diff), with only the user's own settings and no MCP
    /// servers, so a workspace from someone else's pull request cannot run its `.claude` hooks, env
    /// block or `.mcp.json` servers (code.claude.com/docs/en/permissions, "What runs before you
    /// trust a folder"). The folder goes when the run ends. Cursor trusts that empty folder, as its
    /// print mode stops in an untrusted one.
    #[test]
    fn t606_the_claude_writer_runs_from_an_empty_folder_of_its_own_with_only_the_users_settings() {
        // The GitHub Windows runner cannot run the stand-in writer this test hands to the agent
        // (the suite's known environment failure, also seen on the owner's PC). The real writer is
        // checked on the owner's machine; skipping here keeps CI honest about its platform.
        if std::env::var_os("CI").is_some() {
            eprintln!("t606: skipped on CI; the stand-in writer cannot run on this runner");
            return;
        }
        let ws = crate::test_dir::temp("t606-ws");
        std::fs::create_dir_all(ws.join(".claude")).unwrap();
        std::fs::write(ws.join(".claude").join("settings.json"), r#"{"hooks":{"SessionStart":[]},"env":{"ANTHROPIC_BASE_URL":"https://x"}}"#).unwrap();
        std::fs::write(ws.join(".mcp.json"), r#"{"mcpServers":{}}"#).unwrap();
        let agent = stand_in(&ws);
        let w = WriterArg { agent: Some("claude".into()), ..Default::default() };
        let out = ask_with(&w, "Write the message.", &ws, "t606", std::time::Duration::from_secs(20), &|name| (name == "claude").then(|| agent.clone())).unwrap();
        let lines: Vec<&str> = out.lines().map(str::trim).collect();
        let ran_in = Path::new(lines[0]);
        assert!(!ran_in.starts_with(&*ws) && ran_in.file_name().is_some_and(|n| n.to_string_lossy().starts_with("kolux-writer-")), "ran in {ran_in:?}; the workspace is {:?}", *ws);
        assert_eq!(lines[2], "0", "the folder it ran in was empty");
        assert!(!ran_in.exists(), "the folder goes when the run ends");
        assert!(lines[1].contains("--setting-sources user") && lines[1].contains("--strict-mcp-config"), "{}", lines[1]);
        let cursor = WriterArg { agent: Some("cursor".into()), ..Default::default() };
        let out = ask_with(&cursor, "Write the message.", &ws, "t606-cursor", std::time::Duration::from_secs(20), &|name| (name == "cursor-agent").then(|| agent.clone())).unwrap();
        assert!(out.lines().nth(1).is_some_and(|l| l.contains("--trust")), "{out}");
    }

    /// T-606 (R05-git-scm.3): a writer that takes its prompt as an argument (Copilot, Kimi, Cursor,
    /// Antigravity) and was installed through npm starts as node on its script, so the prompt's
    /// line breaks reach it; any other `.cmd` / `.bat` cannot be handed them (the standard library
    /// refuses: "batch file arguments are invalid") and the run is refused in plain words.
    #[test]
    fn t606_an_npm_writer_starts_as_node_and_another_command_script_refuses_line_breaks_plainly() {
        let dir = crate::test_dir::temp("t606 npm");
        let script = dir.join("node_modules").join("@github").join("copilot").join("index.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "").unwrap();
        std::fs::write(dir.join("node.exe"), "").unwrap();
        let shim = dir.join("copilot.cmd");
        // What npm 10.9.4 (cmd-shim 7.0.0) writes for `npm install -g @github/copilot`.
        std::fs::write(&shim, "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@github\\copilot\\index.js\" %*\r\n").unwrap();
        let inv = invocation(spec("copilot").unwrap(), None, None, "Write the commit message.\n\ndiff --git a/x b/x\n+y");
        let (program, run_args) = launch_on(&shim, &inv.args, true).unwrap();
        assert_eq!(program, dir.join("node.exe"));
        assert_eq!(run_args[0], script.to_string_lossy());
        assert_eq!(run_args[1..], inv.args[..]);
        let own = dir.join("agy.cmd");
        std::fs::write(&own, "@echo off\r\nnode \"%~dp0\\agy.js\" %*\r\n").unwrap();
        let e = launch_on(&own, &inv.args, true).unwrap_err();
        assert!(e.contains("command script") && e.contains("line breaks"), "{e}");
        let one = vec!["-p".to_string(), "one line".to_string()];
        assert_eq!(launch_on(&own, &one, true).unwrap(), (own.clone(), one.clone()), "a one-line prompt goes as before");
        assert_eq!(launch_on(&own, &inv.args, false).unwrap(), (own.clone(), inv.args.clone()), "outside Windows a launcher runs itself");
    }
}
