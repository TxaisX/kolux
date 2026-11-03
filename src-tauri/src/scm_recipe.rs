//! GIT-019 (T-313-b): running a Source Control AI recipe. A recipe (kept in the `scmRecipes` setting,
//! rules in src/scm/recipes.ts) says how one action is run: an agent with extra command-line
//! arguments, or a command template. Variables are written `{name}`. This file expands them and
//! composes the command; it is a pure function of the recipe and the values, so the composed command
//! is unit-tested and nothing is launched in a test.
//!
//! - An unknown variable, a stray brace or a program written as a variable is refused (never passed on).
//! - A template is split into words FIRST and the values are put into the words afterwards, so a value
//!   (a diff, a branch name, a failing log) always stays inside one argument whatever it contains
//!   (spaces, quotes, `;`, `&`, `$()`, newlines). No shell is involved. The line shown to the person
//!   quotes each argument so that it reads back as the same words.
//! - A value is cut to a size a command line can carry; a substituted value is never expanded again.
//!
//! Sources: this tree's scm.rs (`split_command`, `write_message`, `message_diff`, `fit_prompt`),
//! scm_writers.rs (`invocation`, `program_of`) and src/scm/recipes.ts. The Windows quoting rule is
//! Microsoft's public "Parsing C command-line arguments" page. No other source.

use crate::scm::{self, writers};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// One action's recipe, as the settings page saves it: an agent (with extra arguments) or a template.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct Recipe {
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub template: String,
}

/// The variables an action offers (the same table as recipes.ts); `None` for an action with no recipes.
pub fn variables_of(action: &str) -> Option<&'static [&'static str]> {
    match action {
        "commit" | "pr" => Some(&["diff", "branch", "base", "files", "issue"]),
        "branch" => Some(&["diff", "branch", "base", "files"]),
        "fix" => Some(&["diff", "branch", "base", "files", "output"]),
        _ => None,
    }
}

/// The longest value put into a command line (characters); Windows carries about 32,000 in all.
pub const VALUE_MAX: usize = 12_000;

/// `text` with every `{name}` replaced by its value (blank when `vars` has none). A name outside
/// `allowed`, an unclosed `{` or a lone `}` is an error naming the problem. Values are copied in as they
/// are and never scanned again.
pub fn expand(text: &str, vars: &BTreeMap<String, String>, allowed: &[&str]) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find(['{', '}']) {
        out.push_str(&rest[..i]);
        if rest.as_bytes()[i] == b'}' {
            return Err("A closing brace has no opening brace.".to_string());
        }
        let after = &rest[i + 1..];
        let end = after.find(['{', '}']).filter(|&j| after.as_bytes()[j] == b'}').ok_or("A variable is missing its closing brace.")?;
        let name = &after[..end];
        if !allowed.contains(&name) {
            return Err(format!("{{{name}}} is not a variable of this recipe. Available: {}.", allowed.iter().map(|v| format!("{{{v}}}")).collect::<Vec<_>>().join(", ")));
        }
        if let Some(v) = vars.get(name) {
            out.push_str(&clip(v));
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// A value cut to `VALUE_MAX` characters (with a note), NUL characters dropped.
fn clip(v: &str) -> String {
    let v = v.replace('\0', "");
    match v.char_indices().nth(VALUE_MAX) {
        Some((i, _)) => format!("{}\n[cut: {} more characters]", &v[..i], v[i..].chars().count()),
        None => v,
    }
}

/// One argument as it reads on a command line: bare when plain, else in double quotes with embedded
/// quotes escaped (and the backslashes before them doubled), so splitting the line gives the argument back.
pub fn quote_arg(a: &str) -> String {
    let plain = !a.is_empty() && a.chars().all(|c| c.is_ascii_alphanumeric() || "_-.,:/\\=+@%".contains(c));
    if plain {
        return a.to_string();
    }
    let mut out = String::from("\"");
    let mut slashes = 0usize;
    for c in a.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(slashes));
                slashes = 0;
                out.push(c);
            }
        }
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

/// A composed command: the program (a name or path to resolve), its arguments, what goes on standard input
/// and the line to show.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Composed {
    pub program: String,
    /// Set when an agent recipe composed it: the agent's id.
    pub agent: Option<String>,
    pub args: Vec<String>,
    pub input: Option<String>,
    pub line: String,
}

/// Why the recipe cannot run, or Ok: exactly one of an agent and a template.
fn check(r: &Recipe) -> Result<(), String> {
    let agent = r.agent.as_deref().map(str::trim).unwrap_or("");
    match (agent.is_empty(), r.template.trim().is_empty()) {
        (false, false) => Err("Choose an agent or a command template, not both.".to_string()),
        (true, true) => Err("This recipe has neither an agent nor a command template.".to_string()),
        _ => Ok(()),
    }
}

/// The recipe's extra arguments (agent recipes), each word expanded on its own.
pub fn agent_extra(action: &str, r: &Recipe, vars: &BTreeMap<String, String>) -> Result<Vec<String>, String> {
    let allowed = variables_of(action).ok_or_else(|| format!("{action} has no recipes"))?;
    scm::split_command(&r.args).iter().map(|w| expand(w, vars, allowed)).collect()
}

/// Where the extra arguments of an agent's own command go: before the prompt (and the flag that takes
/// it) when the command ends with it, before a trailing `-` (read standard input), else at the end.
fn insert_at(args: &[String], prompt: &str) -> usize {
    let n = args.len();
    match args.last().map(String::as_str) {
        Some("-") => n - 1,
        Some(last) if last == prompt && !prompt.is_empty() => {
            if n >= 2 && args[n - 2] == "-p" {
                n - 2
            } else {
                n - 1
            }
        }
        _ => n,
    }
}

/// The command for `action` run by `r` with `vars` and the task `prompt`. A template that uses `{diff}` or
/// `{output}` owns where the content goes; any other gets the prompt on standard input.
pub fn compose(action: &str, r: &Recipe, vars: &BTreeMap<String, String>, prompt: &str) -> Result<Composed, String> {
    check(r)?;
    let allowed = variables_of(action).ok_or_else(|| format!("{action} has no recipes"))?;
    if let Some(id) = r.agent.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        let spec = writers::spec(id).ok_or_else(|| format!("{id} cannot write text on its own; use a command template for it"))?;
        let extra = agent_extra(action, r, vars)?;
        let inv = writers::invocation(spec, None, None, prompt);
        let mut args = inv.args;
        let at = insert_at(&args, prompt);
        for (k, e) in extra.into_iter().enumerate() {
            args.insert(at + k, e);
        }
        let program = spec.programs[0].to_string();
        let line = line_of(&program, &args, prompt);
        return Ok(Composed { program, agent: Some(id.to_string()), args, input: inv.input, line });
    }
    let words = scm::split_command(&r.template);
    let program = words.first().cloned().ok_or("The command template is empty.")?;
    if program.contains('{') || program.contains('}') {
        return Err("The program of a command template cannot be a variable.".to_string());
    }
    let args = words[1..].iter().map(|w| expand(w, vars, allowed)).collect::<Result<Vec<_>, _>>()?;
    let owns_content = r.template.contains("{diff}") || r.template.contains("{output}");
    let line = line_of(&program, &args, prompt);
    Ok(Composed { program, agent: None, args, input: (!owns_content).then(|| prompt.to_string()), line })
}

/// The shown line; the prompt, when it is an argument, is written as `<prompt>` instead of in full.
fn line_of(program: &str, args: &[String], prompt: &str) -> String {
    let mut parts = vec![quote_arg(program)];
    parts.extend(args.iter().map(|a| if !prompt.is_empty() && a == prompt { "<prompt>".to_string() } else { quote_arg(a) }));
    parts.join(" ")
}

/// The program a composed command runs: an agent's installed program, else the template's, by full path (T-663).
pub fn resolve(c: &Composed) -> Result<PathBuf, String> {
    match &c.agent {
        Some(id) => {
            let spec = writers::spec(id).ok_or_else(|| format!("unknown agent {id}"))?;
            writers::program_of(spec).ok_or_else(|| format!("{} was not found on this computer", spec.name))
        }
        None => crate::pty::full_path_program(&c.program).ok_or_else(|| format!("{} was not found on this computer, so Kolux did not start it", c.program)),
    }
}

fn git_lines(dir: &Path, args: &[&str]) -> String {
    crate::git::run(args, Some(dir)).map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

/// The values of a worktree: its branch, base and changed files; the caller adds the diff and the rest.
pub fn worktree_vars(dir: &Path, staged: bool) -> BTreeMap<String, String> {
    let mut v = BTreeMap::new();
    v.insert("branch".to_string(), git_lines(dir, &["symbolic-ref", "--short", "-q", "HEAD"]));
    v.insert("base".to_string(), scm::status(dir).ok().and_then(|s| s.base).unwrap_or_default());
    let files = if staged { git_lines(dir, &["diff", "--cached", "--name-only"]) } else { git_lines(dir, &["diff", "HEAD", "--name-only"]) };
    v.insert("files".to_string(), files);
    v
}

const LIMIT: std::time::Duration = std::time::Duration::from_secs(180);

/// GIT-019: a commit message written by the recipe for what is staged in `worktree`.
#[tauri::command]
pub async fn scm_recipe_commit(worktree: String, recipe: Recipe, instructions: Option<String>, issue: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        check(&recipe)?;
        let (note, diff) = scm::message_diff(dir)?;
        let instructions = instructions.unwrap_or_default();
        // An agent that takes the prompt as an argument gets a diff cut to fit the command line.
        let room = recipe.agent.as_deref().filter(|a| !a.is_empty()).and_then(writers::spec).filter(|s| s.prompt_in_args).and_then(|s| writers::program_of(s).map(|p| writers::arg_limit(&p)));
        let prompt = scm::fit_prompt(&note, &diff, &instructions, room);
        let mut vars = worktree_vars(dir, true);
        vars.insert("diff".to_string(), scm::trim_diff(&diff, scm::MESSAGE_BUDGET));
        vars.insert("issue".to_string(), issue.unwrap_or_default());
        let c = compose("commit", &recipe, &vars, &prompt)?;
        let program = resolve(&c)?;
        // T-606 (R05-git-scm.1): an agent recipe runs from an empty folder, never the workspace; a
        // template is the user's own command and still runs in the workspace.
        if let Some(spec) = c.agent.as_deref().and_then(writers::spec) {
            return writers::run(spec, &program, &writers::Invocation { args: c.args, input: c.input }, &worktree, LIMIT);
        }
        scm::write_message(&program, &c.args.iter().map(String::as_str).collect::<Vec<_>>(), dir, c.input.as_deref(), &worktree, LIMIT)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What Fix with AI does next: an agent recipe hands the front end an agent id, its extra arguments and
/// the prompt to start the agent with (the app's own launch path); a template runs and its answer is shown.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FixPlan {
    Agent { agent: String, extra: Vec<String>, prompt: String },
    Ran { text: String },
}

/// The plan for Fix with AI from `recipe` given `vars` (pure; the command runs a template).
pub fn fix_plan(recipe: &Recipe, vars: &BTreeMap<String, String>, prompt: &str) -> Result<Result<FixPlan, Composed>, String> {
    check(recipe)?;
    match recipe.agent.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(id) => Ok(Ok(FixPlan::Agent { agent: id.to_string(), extra: agent_extra("fix", recipe, vars)?, prompt: prompt.to_string() })),
        None => Ok(Err(compose("fix", recipe, vars, prompt)?)),
    }
}

/// GIT-019: Fix with AI through the recipe. `output` is what failed; `prompt` is the usual fix request.
#[tauri::command]
pub async fn scm_recipe_fix(worktree: String, recipe: Recipe, output: String, prompt: String) -> Result<FixPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let mut vars = worktree_vars(dir, false);
        vars.insert("diff".to_string(), scm::trim_diff(&crate::git::run(&["diff", "HEAD", "--no-color", "--no-ext-diff"], Some(dir)).unwrap_or_default(), scm::MESSAGE_BUDGET));
        vars.insert("output".to_string(), output);
        match fix_plan(&recipe, &vars, &prompt)? {
            Ok(plan) => Ok(plan),
            Err(c) => {
                let program = resolve(&c)?;
                let text = scm::write_message(&program, &c.args.iter().map(String::as_str).collect::<Vec<_>>(), dir, c.input.as_deref(), &worktree, LIMIT)?;
                Ok(FixPlan::Ran { text })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    fn template(t: &str) -> Recipe {
        Recipe { agent: None, args: String::new(), template: t.to_string() }
    }
    fn agent(id: &str, args: &str) -> Recipe {
        Recipe { agent: Some(id.to_string()), args: args.to_string(), template: String::new() }
    }

    /// T-663: a template program that is not found by full path is refused, never run by its bare name.
    #[test]
    fn t663_an_unknown_template_program_is_refused() {
        let c = Composed { program: "kolux-rs-t663-no-such-writer".into(), agent: None, args: vec![], input: None, line: String::new() };
        let err = resolve(&c).unwrap_err();
        assert!(err.contains("kolux-rs-t663-no-such-writer") && err.contains("did not start it"), "{err}");
    }

    #[test]
    fn git019_expand_fills_known_variables_and_refuses_unknown_ones() {
        let v = vars(&[("branch", "feat/x"), ("base", "main")]);
        let allowed = variables_of("commit").unwrap();
        assert_eq!(expand("on {branch} from {base}{issue}", &v, allowed).unwrap(), "on feat/x from main");
        let e = expand("{output}", &v, allowed).unwrap_err();
        assert!(e.contains("{output} is not a variable") && e.contains("{diff}"), "{e}");
        assert!(expand("{issue}", &v, variables_of("branch").unwrap()).is_err(), "issue is not offered to the branch action");
        assert!(expand("{output}", &v, variables_of("fix").unwrap()).is_ok());
        assert!(expand("{}", &v, allowed).is_err() && expand("{branch", &v, allowed).is_err() && expand("branch}", &v, allowed).is_err());
        assert!(variables_of("nothing").is_none());
    }

    #[test]
    fn git019_a_value_is_never_expanded_again_and_is_cut_to_size() {
        let v = vars(&[("branch", "{base}{nope}"), ("base", "main")]);
        assert_eq!(expand("{branch}", &v, variables_of("commit").unwrap()).unwrap(), "{base}{nope}");
        let big = "x".repeat(VALUE_MAX + 50);
        let out = expand("{diff}", &vars(&[("diff", &big)]), variables_of("commit").unwrap()).unwrap();
        assert!(out.starts_with(&"x".repeat(VALUE_MAX)) && out.contains("[cut: 50 more characters]"));
        assert_eq!(expand("{diff}", &vars(&[("diff", "a\0b")]), variables_of("commit").unwrap()).unwrap(), "ab");
    }

    #[test]
    fn git019_a_hostile_value_stays_in_one_argument_of_the_template() {
        let evil = "a b\"; rm -rf / & echo $(x) `y` \\\\\"\nline two";
        let v = vars(&[("branch", evil), ("diff", "d")]);
        let c = compose("commit", &template("tool --branch={branch} -m {branch} {diff}"), &v, "P").unwrap();
        assert_eq!(c.program, "tool");
        assert_eq!(c.args, [format!("--branch={evil}"), "-m".to_string(), evil.to_string(), "d".to_string()]);
        assert_eq!(c.input, None, "{{diff}} in the template means it places the content itself");
        // The shown line quotes each argument whole, with the embedded quote escaped.
        assert!(c.line.starts_with("tool \"--branch=a b\\\"; rm -rf / & echo $(x) `y` "), "{}", c.line);
        assert!(c.line.ends_with(" d"), "{}", c.line);
    }

    #[test]
    fn git019_quote_arg_leaves_plain_words_and_escapes_quotes_and_trailing_backslashes() {
        assert_eq!(quote_arg("main"), "main");
        assert_eq!(quote_arg("feat/x-1.2"), "feat/x-1.2");
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(quote_arg("C:\\my dir\\"), "\"C:\\my dir\\\\\"");
        assert_eq!(quote_arg("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(quote_arg("x;y"), "\"x;y\"");
    }

    #[test]
    fn git019_a_template_without_content_variables_gets_the_prompt_on_standard_input() {
        let c = compose("commit", &template("my-writer --on {branch}"), &vars(&[("branch", "b")]), "THE PROMPT").unwrap();
        assert_eq!((c.program.as_str(), c.args.clone(), c.input.as_deref()), ("my-writer", vec!["--on".to_string(), "b".to_string()], Some("THE PROMPT")));
        assert_eq!(c.line, "my-writer --on b");
        let fix = compose("fix", &template("fixer {output}"), &vars(&[("output", "boom")]), "P").unwrap();
        assert_eq!(fix.input, None);
    }

    #[test]
    fn git019_the_program_may_not_be_a_variable_and_a_recipe_needs_exactly_one_of_agent_or_template() {
        assert!(compose("commit", &template("{branch} x"), &vars(&[]), "P").unwrap_err().contains("cannot be a variable"));
        assert!(compose("commit", &template("tool {nope}"), &vars(&[]), "P").is_err());
        assert!(compose("commit", &Recipe::default(), &vars(&[]), "P").unwrap_err().contains("neither"));
        let both = Recipe { agent: Some("claude".into()), args: String::new(), template: "x".into() };
        assert!(compose("commit", &both, &vars(&[]), "P").unwrap_err().contains("not both"));
        assert!(compose("sing", &template("x"), &vars(&[]), "P").unwrap_err().contains("no recipes"));
        assert!(compose("commit", &agent("not-an-agent", ""), &vars(&[]), "P").is_err());
    }

    #[test]
    fn git019_an_agent_recipe_puts_its_extra_arguments_where_each_agent_takes_flags() {
        let v = vars(&[("branch", "my branch")]);
        let claude = compose("commit", &agent("claude", "--add-dir {branch} --max-turns 2"), &v, "P").unwrap();
        assert_eq!(claude.program, "claude");
        assert_eq!(claude.args, ["-p", "--setting-sources", "user", "--strict-mcp-config", "--model", "sonnet", "--add-dir", "my branch", "--max-turns", "2"]);
        assert_eq!(claude.input.as_deref(), Some("P"));
        assert_eq!(claude.line, "claude -p --setting-sources user --strict-mcp-config --model sonnet --add-dir \"my branch\" --max-turns 2");
        // Codex reads standard input through a trailing "-": extra arguments go in front of it.
        let codex = compose("pr", &agent("codex", "--profile fast"), &v, "P").unwrap();
        assert_eq!(codex.args.last().unwrap(), "-");
        assert_eq!(codex.args[codex.args.len() - 3..], ["--profile", "fast", "-"]);
        // Kimi ends with `-p <prompt>`: the extras go before the flag that takes it.
        let kimi = compose("commit", &agent("kimi", "--yolo"), &v, "THE PROMPT").unwrap();
        assert_eq!(kimi.args, ["--print", "--final-message-only", "--yolo", "-p", "THE PROMPT"]);
        assert_eq!(kimi.line, "kimi --print --final-message-only --yolo -p <prompt>");
        assert_eq!(kimi.input, None);
        // Cursor ends with the bare prompt; Copilot has flags after it.
        assert_eq!(compose("commit", &agent("cursor", "--force"), &v, "PP").unwrap().args.iter().rev().take(2).cloned().collect::<Vec<_>>(), ["PP", "--force"]);
        assert_eq!(compose("commit", &agent("copilot", "--x"), &v, "PP").unwrap().args, ["-p", "PP", "-s", "--x"]);
        // No extra arguments: the agent's own command, unchanged.
        assert_eq!(compose("commit", &agent("amp", ""), &v, "P").unwrap().args, ["-x"]);
        // An extra argument can use only the variables of the action.
        assert!(compose("commit", &agent("claude", "--note {output}"), &v, "P").is_err());
    }

    #[test]
    fn git019_fix_with_an_agent_recipe_returns_the_agent_extras_and_prompt_for_the_apps_own_launch() {
        let v = vars(&[("output", "error: boom"), ("branch", "feat")]);
        let plan = fix_plan(&agent("claude", "--note {output}"), &v, "FIX IT").unwrap().unwrap();
        assert_eq!(plan, FixPlan::Agent { agent: "claude".into(), extra: vec!["--note".into(), "error: boom".into()], prompt: "FIX IT".into() });
        // An agent the writer list does not know can still be launched interactively.
        assert!(matches!(fix_plan(&agent("gemini", ""), &v, "P").unwrap(), Ok(FixPlan::Agent { .. })));
        // A template is composed for a headless run.
        let c = fix_plan(&template("fixer --log {output}"), &v, "P").unwrap().unwrap_err();
        assert_eq!((c.program.as_str(), c.args.clone()), ("fixer", vec!["--log".to_string(), "error: boom".to_string()]));
        assert!(fix_plan(&Recipe::default(), &v, "P").is_err());
    }

    #[test]
    fn git019_worktree_values_come_from_the_repository() {
        let tmp = std::env::temp_dir().join(format!("kolux-rs-recipe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let g = |a: &[&str]| crate::git::run(a, Some(&tmp)).unwrap();
        g(&["init", "-q", "-b", "feat/recipes"]);
        std::fs::write(tmp.join("a.txt"), "one\n").unwrap();
        std::fs::write(tmp.join("b b.txt"), "two\n").unwrap();
        g(&["add", "a.txt"]);
        let staged = worktree_vars(&tmp, true);
        assert_eq!(staged["branch"], "feat/recipes");
        assert_eq!(staged["files"], "a.txt");
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one"]);
        std::fs::write(tmp.join("a.txt"), "changed\n").unwrap();
        assert_eq!(worktree_vars(&tmp, false)["files"], "a.txt");
        assert_eq!(worktree_vars(&tmp, true)["files"], "");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
