//! CLI-042 / CLI-043 / SKILL-030: the commands that answer from the program itself, with the app
//! closed: `agent-context` describes every command, and `skills list` and `skills get` print the
//! guides bundled into this build, so they always match its version.

use super::{commands, Fail, Parsed, HELP};
use crate::hooks::agent_hooks::switch;
use serde_json::{json, Value};

/// The settings of the Kolux profile this command reaches; none read as empty.
fn profile_settings() -> Value {
    std::fs::read(super::data_dir().join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}))
}

/// CLI-001: every bundled guide and reference by name, so a test can check what they mention.
#[cfg(test)]
pub fn guides() -> Vec<(String, &'static str)> {
    SKILLS.iter().flat_map(|s| std::iter::once((s.name.to_string(), s.guide)).chain(s.refs.iter().map(move |(r, t)| (format!("{}/{r}", s.name), *t)))).collect()
}

pub const COMMANDS: &[super::Command] = &[
    ("agent-context", "agent-context", &[]),
    ("skills list", "skills.list", &[]),
    ("skills get", "skills.get", &["topic", "full", "references", "reference"]),
    ("skills show", "skills.get", &["topic", "full", "references", "reference"]),
    ("skills coverage", "skills.coverage", &[]),
    ("skills install", "skills.install", &["skill", "all", "agent", "local", "dry-run"]),
    ("skills update", "skills.update", &["skill", "all", "local", "dry-run"]),
    ("agent hooks status", "agent.hooks.status", &[]),
    ("agent hooks on", "agent.hooks.on", &[]),
    ("agent hooks off", "agent.hooks.off", &[]),
    ("agent hooks prepare-codex", "agent.hooks.prepare-codex", &[]),
    // APP-061: the release smoke test's old-profile check; answers only for a throwaway profile.
    ("profile migrate", "profile.migrate", &[]),
];

/// ORCH-043: the folders under home where each agent reads skills installed for the whole
/// computer (the community skills installer's global paths). `.agents/skills` is the shared
/// cross-agent folder. Agents not listed have no known folder and are never guessed at.
const SKILL_HOMES: &[(&str, &[&str])] = &[
    ("claude", &[".claude/skills"]),
    ("codex", &[".agents/skills", ".codex/skills"]),
    ("cline", &[".agents/skills"]),
    ("kimi", &[".agents/skills"]),
    ("pi", &[".agents/skills"]),
    ("amp", &[".config/agents/skills"]),
    ("antigravity", &[".gemini/antigravity/skills"]),
    ("autohand", &[".autohand/skills"]),
    ("aug", &[".augment/skills"]),
    ("openclaw", &[".openclaw/skills"]),
    ("command-code", &[".commandcode/skills"]),
    ("continue", &[".continue/skills"]),
    ("crush", &[".config/crush/skills"]),
    ("cursor", &[".cursor/skills"]),
    ("devin", &[".config/devin/skills"]),
    ("droid", &[".factory/skills"]),
    ("gemini", &[".gemini/skills"]),
    ("copilot", &[".copilot/skills"]),
    ("goose", &[".config/goose/skills"]),
    ("grok", &[".grok/skills"]),
    ("hermes", &[".hermes/skills"]),
    ("kilo", &[".kilo/skills"]),
    ("kiro", &[".kiro/skills"]),
    ("mistral-vibe", &[".vibe/skills"]),
    ("qwen-code", &[".qwen/skills"]),
    ("rovo", &[".rovodev/skills"]),
];

/// The folders `depth` levels below `dir` (a plugin cache is marketplace/plugin/version).
fn below(dir: &std::path::Path, depth: usize) -> Vec<std::path::PathBuf> {
    let mut level = vec![dir.to_path_buf()];
    for _ in 0..depth {
        level = level.iter().flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir())).collect();
    }
    level
}

/// ORCH-043: for each agent, whether `skill` is installed for the whole computer and where.
/// Only home folders count, so an install inside a repo never covers anyone. Claude also counts
/// an enabled plugin's copy, and Codex its plugin cache; Hermes looks in the local app-data
/// folder before the hidden one in home.
pub fn coverage(home: &std::path::Path, local_app: Option<&std::path::Path>, agents: &[(String, String)], skill: &str) -> Vec<Value> {
    let has = |root: &std::path::Path| root.join(skill).join("SKILL.md").is_file();
    let plugins = |cache: std::path::PathBuf, enabled: &dyn Fn(&std::path::Path) -> bool| below(&cache, 3).into_iter().map(|v| v.join("skills")).find(|s| has(s) && enabled(s));
    agents
        .iter()
        .map(|(id, name)| {
            let homes = SKILL_HOMES.iter().find(|h| h.0 == id).map(|h| h.1);
            let mut roots: Vec<std::path::PathBuf> = Vec::new();
            if id == "hermes" {
                roots.extend(local_app.map(|l| l.join("hermes").join("skills")));
            }
            roots.extend(homes.unwrap_or_default().iter().map(|h| h.split('/').fold(home.to_path_buf(), |p, c| p.join(c))));
            let mut found = roots.into_iter().find(|r| has(r));
            if found.is_none() && id == "claude" {
                let settings: Value = std::fs::read_to_string(home.join(".claude").join("settings.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
                // cache/<marketplace>/<plugin>/<version>/skills, enabled as "plugin@marketplace".
                let on = |s: &std::path::Path| {
                    let up = |n: usize| s.ancestors().nth(n).and_then(|p| p.file_name()).map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                    settings["enabledPlugins"][format!("{}@{}", up(2), up(3))] == true
                };
                found = plugins(home.join(".claude").join("plugins").join("cache"), &on);
            }
            if found.is_none() && id == "codex" {
                found = plugins(home.join(".codex").join("plugins").join("cache"), &|_| true);
            }
            json!({ "id": id, "name": name, "known": homes.is_some(), "covered": found.is_some(), "foundIn": found.map(|f| f.join(skill).display().to_string()) })
        })
        .collect()
}

/// SKILL-031: install or update Kolux skills through the community skills installer. The rules live
/// in skills/cli_install.rs; this only hands over the arguments and the data folder.
fn skills_install(p: &Parsed) -> Result<Value, Fail> {
    use crate::skills::cli_install as ci;
    let fail = |f: ci::Failure| Fail { code: f.code, message: f.message, data: f.data };
    if let Some(f) = ci::json_refusal(&p.command, &p.args) {
        return Err(fail(f));
    }
    let dir = super::data_dir();
    ci::run(&ci::req_of(&p.command, &p.args), &ci::live_ctx(&dir), &crate::skills::installer::Real).map_err(fail)
}

fn skills_coverage() -> Value {
    let env = |v: &str| std::env::var_os(v).filter(|x| !x.is_empty()).map(std::path::PathBuf::from);
    let home = env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default();
    let local_app = if cfg!(windows) { env("LOCALAPPDATA") } else { None };
    let agents: Vec<(String, String)> = crate::agents::agent_list().into_iter().filter(|a| a.installed).map(|a| (a.id, a.name)).collect();
    json!({ "skill": "orchestration", "agents": coverage(&home, local_app.as_deref(), &agents, "orchestration") })
}

/// The document's shape; agents read its field names, so a change to them bumps this.
const SCHEMA: u32 = 1;

/// One line each, in the words a person would use; keyed by the command's own words.
const SUMMARIES: &[(&str, &str)] = &[
    // T-195 (BROW-046, BROW-047), T-241 (BROW-044, BROW-045, BROW-048): the browser commands, for the agent context.
    ("goto", "Send the worktree's browser tab to an address."),
    ("back", "Go back one page in the browser tab."),
    ("forward", "Go forward one page in the browser tab."),
    ("reload", "Reload the browser tab's page."),
    ("wait", "Wait for an element, text, address, load state or script in the page."),
    ("eval", "Run a JavaScript expression in the page and print its value."),
    ("scroll", "Scroll the page up, down, left or right."),
    ("snapshot", "List the page's elements with references the other commands take."),
    ("screenshot", "Save a picture of the visible page to a file."),
    ("full-screenshot", "Save a picture of the whole page to a file."),
    ("pdf", "Print the page to a PDF file."),
    ("click", "Click an element from the snapshot."),
    ("dblclick", "Double-click an element from the snapshot."),
    ("check", "Tick a checkbox or radio button."),
    ("uncheck", "Clear a checkbox."),
    ("focus", "Focus an element."),
    ("clear", "Clear a field's value."),
    ("select-all", "Select all text in a field."),
    ("hover", "Move the pointer over an element."),
    ("scrollintoview", "Scroll an element into view."),
    ("fill", "Set a field's value in one go."),
    ("type", "Type text into the focused element, key by key."),
    ("inserttext", "Insert text at the focused element's caret."),
    ("select", "Choose an option in a select element."),
    ("keypress", "Press a key in the page."),
    ("drag", "Drag one element onto another."),
    ("upload", "Put files into a file input."),
    ("download", "Click an element and save the file it downloads."),
    ("highlight", "Outline the elements a selector matches."),
    ("find", "Find an element by role, text, label, placeholder or selector and act on it."),
    ("get", "Read text, HTML, a value, the address, the title, a count or a box from the page."),
    ("is", "Tell whether an element is visible, enabled or checked."),
    ("mouse move", "Move the pointer to page coordinates."),
    ("mouse down", "Press a mouse button."),
    ("mouse up", "Release a mouse button."),
    ("mouse wheel", "Turn the mouse wheel."),
    ("exec", "Run one browser command written as a line."),
    ("tab list", "List the worktree's browser tabs (--worktree all: every worktree's)."),
    ("tab current", "Show the browser tab the commands go to."),
    ("tab show", "Show one browser tab by number."),
    ("tab switch", "Bring a browser tab on screen."),
    ("tab create", "Open a browser tab at an address or on an HTML file."),
    ("tab close", "Close a browser tab (destructive)."),
    ("tab lease", "Take a page placement; one holder at a time owns it."),
    ("tab release", "Give a page placement back and close the pages opened under it."),
    ("tab leases", "List the page placements held and their pages."),
    ("tab profile", "Show the profile the browser tab runs in."),
    ("tab profile set", "Move the browser tab to a profile (its page reopens in the new profile at once)."),
    ("tab profile use-default", "Move the browser tab back to the default profile."),
    ("tab profile clone", "Copy the browser tab's profile and move the tab to the copy."),
    ("profiles list", "List the browser profiles."),
    ("profiles create", "Create a browser profile with its own cookies, storage and logins."),
    ("profiles delete", "Delete a browser profile (destructive; not the default)."),
    ("cookie get", "Read the cookies the open page can see."),
    ("cookie set", "Set a cookie on the open page's site."),
    ("cookie delete", "Delete a cookie on the open page's site (destructive)."),
    ("storage get", "Read local or session storage of the open page."),
    ("storage set", "Write a key in local or session storage of the open page."),
    ("storage clear", "Clear local or session storage of the open page (destructive)."),
    ("storage local get", "Read local storage of the open page."),
    ("storage local set", "Write a key in local storage of the open page (the value may be empty)."),
    ("storage local clear", "Clear local storage of the open page (destructive)."),
    ("storage session get", "Read session storage of the open page."),
    ("storage session set", "Write a key in session storage of the open page (the value may be empty)."),
    ("storage session clear", "Clear session storage of the open page (destructive)."),
    ("intercept enable", "Hold the open page's requests that match the given patterns."),
    ("intercept disable", "Stop holding requests and release the held ones."),
    ("intercept list", "List the patterns the open page holds requests for."),
    ("capture start", "Start recording the page's console messages and network requests."),
    ("capture stop", "Stop recording the page's console messages and network requests."),
    ("console", "Read the console messages recorded for the open page."),
    ("network", "Read the network requests recorded for the open page."),
    ("viewport", "Emulate a screen size (and optionally a phone) for the open page."),
    ("geolocation", "Emulate a location for the open page."),
    ("set device", "Emulate a named device for the open page."),
    ("set offline", "Switch the open page's offline emulation on or off."),
    ("set headers", "Add extra headers to the open page's requests."),
    ("set credentials", "Answer the open page's sign-in prompts with a user and password."),
    ("set media", "Emulate media features (colour scheme, reduced motion) for the open page."),
    ("clipboard read", "Read the page's clipboard."),
    ("clipboard write", "Write text to the page's clipboard."),
    ("dialog accept", "Accept the dialog the open page shows (with text for a prompt)."),
    ("dialog dismiss", "Dismiss the dialog the open page shows."),
    ("worktree create", "Make a worktree in a repo, optionally starting an agent in it."),
    ("worktree rm", "Remove a worktree and its folder."),
    ("terminal read", "Read a terminal's output after a cursor, or its visible screen with --screen."),
    ("terminal send", "Type text, Enter or an interrupt into a terminal; a prompt to an agent gets a receipt."),
    ("terminal wait", "Wait until a terminal exits or its agent goes idle."),
    ("orchestration worker-start", "Start a worker agent on a task, in a new or chosen worktree."),
    ("account add", "Sign in to a Claude or Codex account with the agent's own login, and add it to Kolux."),
    ("account list", "List the Claude and Codex accounts Kolux holds."),
    ("open", "Start Kolux, or bring its window to the front, and wait until it answers."),
    ("status", "Say whether Kolux is running, not running, stale or still loading its workspaces."),
    ("diagnostics memory", "Show the Resource Manager's memory figures: resident and committed for Kolux, each terminal session and the total."),
    ("file open", "Open a file in the editor of a worktree."),
    ("file diff", "Open the diff of one file in a worktree, staged or not."),
    ("file open-changed", "Open every changed file of a worktree as a diff, in the editor, or both."),
    ("file list", "List a folder of a worktree (its top folder when no --path is given)."),
    ("file read", "Print a text file of a worktree."),
    ("file rename", "Rename or move a file inside its worktree; both paths must be inside it."),
    ("git branch", "Show a worktree's branch, upstream and how far ahead or behind it is."),
    ("git pr", "Show the pull request of a worktree's branch, read from that worktree's own remote."),
    ("sessions list", "List a worktree's past Claude sessions with their titles."),
    ("automations mine", "List the automations of one repo: the current one unless --repo names it."),
    ("repo list", "List the repos Kolux knows."),
    ("repo add", "Add a folder as a repo."),
    ("repo show", "Show one repo."),
    ("repo set-base-ref", "Set the branch new worktrees of a repo start from."),
    ("repo search-refs", "Search a repo's branches and tags."),
    ("project list", "List the projects."),
    ("worktree list", "List the worktrees of a repo or of every repo."),
    ("worktree ps", "List worktrees with what is running in them."),
    ("worktree show", "Show one worktree."),
    ("worktree current", "Show the worktree this terminal is in."),
    ("worktree set", "Change a worktree's display name, linked issue, comment or parent."),
    ("worktree changes", "List what a worktree changed against its base."),
    ("worktree overlap", "List other worktrees touching the same files, and whether a merge would conflict."),
    ("orchestration run-create", "Open a Run and attach this terminal to it as the coordinator."),
    ("orchestration run-use", "Attach this terminal to an existing Run."),
    ("orchestration run-current", "Show the Run this terminal is attached to."),
    ("orchestration run-list", "List the Runs."),
    ("orchestration run-show", "Show one Run."),
    ("orchestration request-show", "Say whether a change sent with a retry request id completed, is pending, or never arrived."),
    ("orchestration send", "Send a message to a terminal, a Run or a dispatch."),
    ("orchestration check", "Read new mail, or wait for it."),
    ("orchestration reply", "Answer a message in its thread."),
    ("orchestration inbox", "List the mail this terminal has received."),
    ("orchestration ask", "Ask the coordinator a question and wait for the answer."),
    ("orchestration gate-create", "Hold a task until the coordinator decides; needs an attached Run."),
    ("orchestration gate-resolve", "Settle a gate so its task can go on."),
    ("orchestration gate-list", "List the gates of this Run or of a named one."),
    ("orchestration reset", "Clear tasks, messages or both."),
    ("orchestration task-create", "Add a task to the Run."),
    ("orchestration task-list", "List the Run's tasks."),
    ("orchestration dispatch", "Give a task to a terminal that is already open."),
    ("orchestration dispatch-show", "Show how a task was dispatched."),
    ("terminal list", "List the open terminals: worktree, pane, tab, name and whether each is in view."),
    ("terminal show", "Show one open terminal."),
    ("terminal create", "Open a new terminal in a worktree, optionally running a command."),
    ("terminal split", "Split a terminal's pane and open a new terminal beside it."),
    ("terminal rename", "Rename a terminal, or give it back its default name."),
    ("terminal switch", "Bring a terminal into view and focus it."),
    ("terminal close", "Close a terminal, its tab, or every terminal in a worktree."),
    ("orchestration task-update", "Move a task to another state; its worker is settled with it."),
    ("orchestration task-reset", "Release a task Kolux held back after three failed hand-outs; it lists ready again."),
    ("orchestration worker-abandon", "Give up on a worker; its task goes back to ready."),
    ("orchestration worker-stop", "End a worker's agent terminal and keep its worktree."),
    ("orchestration worker-list", "List workers with what is left of their terminals and the next command to run."),
    ("orchestration worker-retain", "Keep a settled worker's terminal open on purpose, across restarts."),
    ("orchestration worker-release", "Save a settled worker's output, then close its terminal; the worktree stays."),
    ("orchestration worker-show", "Show one worker and whether it waits on a person (yes, no or unknown)."),
    ("orchestration worker-read", "Read what a worker wrote: its transcript, else its terminal output, else its release archive."),
    ("automations list", "List the automations."),
    ("automations show", "Show one automation."),
    ("automations runs", "List an automation's runs, newest first."),
    ("automations create", "Save an automation that starts an agent on a timetable."),
    ("automations edit", "Change an automation."),
    ("automations remove", "Delete an automation."),
    ("automations run", "Start an automation now."),
    ("agent-context", "Describe every command, its flags and its usage."),
    ("skills list", "List the skill guides bundled with this CLI."),
    ("skills get", "Print a bundled skill guide, in short, in full, or one reference."),
    ("skills coverage", "Show which installed agents have the orchestration skill installed for the whole computer."),
    ("skills install", "Install Kolux skills into the AI agents on this computer with the community skills installer."),
    ("skills update", "Update the installed Kolux skills the community skills installer recorded and nobody changed."),
    ("claude-teams", "Run Claude Code with Agent Teams in Kolux panes; arguments go to Claude untouched."),
    ("agent hooks status", "Show whether each agent's status hooks are installed, partly installed or missing."),
    ("agent hooks on", "Switch the agent status hooks on and put Kolux's entries back into every agent."),
    ("agent hooks off", "Switch the agent status hooks off and take Kolux's entries out of every agent."),
    ("agent hooks prepare-codex", "Install and trust Kolux's Codex hooks before Codex is first started."),
    ("profile migrate", "Carry a former-name profile's settings into a throwaway profile (the release smoke test; refuses the installed profile)."),
];

/// The bare word some commands take after their verb, and the flag it stands for.
pub fn bare(path: &[String]) -> Option<&'static str> {
    match (path.len(), path.first().map(String::as_str), path.get(1).map(String::as_str)) {
        (3, Some("automations"), _) => Some("id"),
        (3, Some("skills"), Some("get" | "show")) => Some("topic"),
        (3, Some("file"), Some("open" | "diff")) => Some("path"),
        _ => None,
    }
}

/// The help lines for these words: the one naming them and the indented ones under it.
fn usage(words: &str) -> String {
    let lines: Vec<&str> = HELP.lines().collect();
    let names = |l: &str| {
        l.trim_start().split(" | ").any(|part| {
            let part = part.strip_prefix("kolux-dev ").unwrap_or(part);
            part == words || part.starts_with(&format!("{words} "))
        })
    };
    let Some(at) = lines.iter().position(|l| l.starts_with("  kolux-dev ") && names(l)) else {
        return String::new();
    };
    let mut out = vec![lines[at].trim()];
    out.extend(lines[at + 1..].iter().take_while(|l| l.starts_with("      ")).map(|l| l.trim()));
    out.join(" ")
}

pub fn agent_context() -> Value {
    let all = commands();
    let mut entries = Vec::new();
    for (i, &(words, path, flags)) in all.iter().enumerate() {
        if all[..i].iter().any(|c| c.1 == path) {
            continue;
        }
        let aliases: Vec<&str> = all[i + 1..].iter().filter(|c| c.1 == path).map(|c| c.0).collect();
        let mut accepted: Vec<&str> = flags.to_vec();
        accepted.extend(["json", "help"]);
        let probe: Vec<String> = format!("{words} x").split(' ').map(String::from).collect();
        let bare: Vec<&str> = bare(&probe).into_iter().collect();
        entries.push(entry(words, path, &aliases, false, &accepted, &bare));
    }
    entries.push(entry("claude-teams", "claude-teams", &[], true, &[], &[]));
    json!({ "schemaVersion": SCHEMA, "commandCount": entries.len(), "commands": entries })
}

fn entry(words: &str, path: &str, aliases: &[&str], raw: bool, flags: &[&str], bare: &[&str]) -> Value {
    let summary = SUMMARIES.iter().find(|s| s.0 == words).map(|s| s.1).unwrap_or_default();
    json!({
        "words": words,
        "path": path.split('.').collect::<Vec<_>>(),
        "aliases": aliases,
        "arguments": if raw { "raw" } else { "parsed" },
        "summary": summary,
        "usage": usage(words),
        "flags": flags,
        "bareArguments": bare,
        "examples": [],
        "notes": if raw { vec!["every argument is handed to the program as typed; Kolux reads none of them"] } else { vec![] },
    })
}

struct Skill {
    name: &'static str,
    aliases: &'static [&'static str],
    guide: &'static str,
    refs: &'static [(&'static str, &'static str)],
}

/// SKILL-029's kept skills, in name order. Built into the program, so they match its version.
const SKILLS: &[Skill] = &[
    Skill {
        name: "kolux-cli",
        aliases: &["cli", "kolux"],
        guide: include_str!("../skills/kolux-cli/SKILL.md"),
        refs: &[
            ("automations", include_str!("../skills/kolux-cli/references/automations.md")),
            ("json", include_str!("../skills/kolux-cli/references/json.md")),
            ("worktrees", include_str!("../skills/kolux-cli/references/worktrees.md")),
        ],
    },
    Skill { name: "koluxsecurity", aliases: &["security"], guide: include_str!("../skills/koluxsecurity/SKILL.md"), refs: &[("checklist", include_str!("../skills/koluxsecurity/references/checklist.md"))] },
    Skill { name: "koluxward", aliases: &["ward", "injection"], guide: include_str!("../skills/koluxward/SKILL.md"), refs: &[("signs", include_str!("../skills/koluxward/references/signs.md"))] },
    Skill {
        name: "orchestration",
        aliases: &["orch"],
        guide: include_str!("../skills/orchestration/SKILL.md"),
        refs: &[
            ("gates", include_str!("../skills/orchestration/references/gates.md")),
            ("mail", include_str!("../skills/orchestration/references/mail.md")),
            ("tasks", include_str!("../skills/orchestration/references/tasks.md")),
        ],
    },
    Skill {
        name: "video",
        aliases: &["hyperframes", "higgsfield", "film", "media"],
        guide: include_str!("../skills/video/SKILL.md"),
        refs: &[
            ("hyperframes", include_str!("../skills/video/references/hyperframes.md")),
            ("higgsfield", include_str!("../skills/video/references/higgsfield.md")),
        ],
    },
];

/// SKILL-017: the built-in guides, by name, for the Skills page.
pub fn bundled() -> Vec<(&'static str, &'static str)> {
    SKILLS.iter().map(|s| (s.name, s.guide)).collect()
}

/// The text after the `---` header block, and the header's description line.
fn split(md: &str) -> (&str, &str) {
    let md = md.trim_start_matches('\u{feff}');
    let Some(rest) = md.strip_prefix("---") else { return ("", md) };
    let Some((head, body)) = rest.split_once("\n---") else { return ("", md) };
    let desc = head.lines().find_map(|l| l.strip_prefix("description:")).unwrap_or_default().trim();
    (desc, body.trim_start_matches(['\r', '\n']))
}

fn topics() -> String {
    SKILLS.iter().map(|s| s.name).collect::<Vec<_>>().join(", ")
}

fn skill(topic: &str) -> Result<&'static Skill, Fail> {
    let t = topic.trim().to_lowercase();
    SKILLS.iter().find(|s| s.name == t || s.aliases.contains(&t.as_str())).ok_or_else(|| Fail {
        code: "not_found",
        message: format!("there is no skill called {topic}; the topics are {}", topics()),
        data: json!({ "topics": SKILLS.iter().map(|s| s.name).collect::<Vec<_>>(), "hint": format!("{} skills list shows them with what each is for", crate::orchestration::CLI) }),
    })
}

fn skills_get(a: &serde_json::Map<String, Value>) -> Result<Value, Fail> {
    let topic = a.get("topic").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).ok_or_else(|| Fail::args(format!("name a topic: {}", topics())))?;
    let s = skill(topic)?;
    let full = a.get("full") == Some(&json!(true));
    let list = a.get("references") == Some(&json!(true));
    let one = a.get("reference").map(|r| r.as_str().unwrap_or_default().trim().to_string());
    if [full, list, one.is_some()].iter().filter(|b| **b).count() > 1 {
        return Err(Fail::args("--full, --references and --reference cannot be combined: pick one"));
    }
    let names: Vec<&str> = s.refs.iter().map(|r| r.0).collect();
    let (_, guide) = split(s.guide);
    let (selected, reference, markdown) = if let Some(r) = one {
        if names.is_empty() {
            return Err(Fail::args(format!("{} has no references", s.name)));
        }
        // A reference can be named as its path inside the guide's references folder too.
        let key = r.replace('\\', "/");
        let key = key.trim_start_matches("references/").trim_end_matches(".md");
        let Some(&(name, md)) = s.refs.iter().find(|x| x.0 == key) else {
            return Err(Fail::args(format!("{} has no reference called {r}; its references are {}", s.name, names.join(", "))));
        };
        ("reference", Some(name), md.to_string())
    } else if list {
        ("references", None, names.iter().map(|n| format!("- {n}")).collect::<Vec<_>>().join("\n"))
    } else if full {
        let mut out = vec![guide.trim_end().to_string()];
        out.extend(s.refs.iter().map(|r| r.1.trim_end().to_string()));
        ("full", None, out.join("\n\n"))
    } else {
        ("guide", None, guide.to_string())
    };
    Ok(json!({ "name": s.name, "selected": selected, "reference": reference, "references": names, "markdown": markdown.trim_end() }))
}

/// The answer to a local command, or `None` when the command needs the app.
pub fn run(p: &Parsed) -> Option<Result<Value, Fail>> {
    Some(match p.command.as_str() {
        "agent-context" => Ok(agent_context()),
        "skills.list" => Ok(json!({ "skills": SKILLS.iter().map(|s| json!({ "name": s.name, "description": split(s.guide).0, "aliases": s.aliases, "references": s.refs.iter().map(|r| r.0).collect::<Vec<_>>() })).collect::<Vec<_>>() })),
        "skills.get" => skills_get(&p.args),
        "skills.coverage" => Ok(skills_coverage()),
        "skills.install" | "skills.update" => skills_install(p),
        // STAT-003: read from the files themselves, so Kolux may be closed.
        "agent.hooks.status" => Ok(switch::report(&profile_settings())),
        "agent.hooks.on" => switch::set(&super::data_dir(), true).map_err(Fail::from),
        "agent.hooks.off" => switch::set(&super::data_dir(), false).map_err(Fail::from),
        "agent.hooks.prepare-codex" => switch::prepare_codex(&profile_settings()).map_err(Fail::from),
        "profile.migrate" => crate::import::migrate_check(&super::data_dir()).map_err(Fail::from),
        _ => return None,
    })
}

pub fn text(command: &str, r: &Value) -> Option<String> {
    Some(match command {
        "agent-context" => format!("{} commands; {} agent-context --json prints the whole document", r["commandCount"], crate::orchestration::CLI),
        "skills.list" => r["skills"].as_array().into_iter().flatten().map(|s| format!("{:<15}{}", s["name"].as_str().unwrap_or_default(), s["description"].as_str().unwrap_or_default())).collect::<Vec<_>>().join("\n"),
        "skills.get" => r["markdown"].as_str().unwrap_or_default().to_string(),
        "skills.install" | "skills.update" => crate::skills::cli_install::text(r),
        "skills.coverage" => {
            let rows = r["agents"].as_array().into_iter().flatten().map(|a| {
                let state = if a["covered"] == true { format!("covered      {}", a["foundIn"].as_str().unwrap_or_default()) } else if a["known"] == true { "not covered".into() } else { "not covered  (no known skills folder for it)".into() };
                format!("{:<16}{state}", a["name"].as_str().unwrap_or_default())
            });
            let rows: Vec<String> = rows.collect();
            let head = format!("The {} skill, installed for the whole computer (an install inside a repo does not count):", r["skill"].as_str().unwrap_or_default());
            if rows.is_empty() { format!("{head}\nNo agents were found on this computer.") } else { format!("{head}\n{}", rows.join("\n")) }
        }
        "agent.hooks.status" | "agent.hooks.on" | "agent.hooks.off" => {
            let mut out = vec![format!("Agent status hooks: {}", if r["on"] == true { "on" } else { "off" })];
            for a in r["agents"].as_array().into_iter().flatten() {
                let why = a["reason"].as_str().map(|w| format!("  ({w})")).unwrap_or_default();
                out.push(format!("{:<14}{}{why}", a["name"].as_str().unwrap_or_default(), a["state"].as_str().unwrap_or_default()));
            }
            out.join("\n")
        }
        "agent.hooks.prepare-codex" => format!("Kolux's Codex hooks are installed and trusted in {}", r["home"].as_str().unwrap_or_default()),
        "profile.migrate" => format!("migrated into {}: {}", r["profile"].as_str().unwrap_or_default(), r["summary"].as_str().unwrap_or_default()),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::parse;
    use super::*;

    fn local(line: &str) -> Result<Value, Fail> {
        let words: Vec<String> = line.split(' ').map(str::to_string).collect();
        let p = parse(&words).1?.expect("a command");
        run(&p).expect("answered without the app")
    }

    #[test]
    fn agent_context_describes_every_command_from_the_program_itself() {
        let doc = local("agent-context").unwrap();
        assert_eq!(doc["schemaVersion"], 1);
        let list = doc["commands"].as_array().unwrap();
        assert_eq!(doc["commandCount"], list.len());
        let find = |w: &str| list.iter().find(|c| c["words"] == w).unwrap_or_else(|| panic!("{w} is missing"));
        let rm = find("worktree rm");
        assert_eq!(rm["aliases"], json!(["worktree remove", "worktree delete"]));
        assert!(list.iter().all(|c| c["words"] != "worktree remove"), "an alias is not its own entry");
        assert_eq!(rm["path"], json!(["worktree", "rm"]));
        assert!(rm["flags"].as_array().unwrap().contains(&json!("json")), "global flags are listed");
        let teams = find("claude-teams");
        assert_eq!((teams["arguments"].as_str(), teams["flags"].as_array().unwrap().len()), (Some("raw"), 0));
        assert_eq!(find("automations show")["bareArguments"], json!(["id"]));
        assert_eq!(find("skills get")["aliases"], json!(["skills show"]));
        for c in list {
            assert!(!c["summary"].as_str().unwrap().is_empty(), "{} has no summary", c["words"]);
            assert!(c["usage"].as_str().unwrap().contains(c["words"].as_str().unwrap()), "{} has no usage", c["words"]);
            for k in ["aliases", "flags", "bareArguments", "examples", "notes"] {
                assert!(c[k].is_array(), "{k} of {} is a list even when empty", c["words"]);
            }
        }
        assert_eq!(doc, local("agent-context").unwrap(), "the order is stable");
        assert!(text("agent-context", &doc).unwrap().starts_with(&format!("{} commands", list.len())));
    }

    #[test]
    fn an_agent_is_covered_only_by_an_install_for_the_whole_computer() {
        let home = std::env::temp_dir().join(format!("kolux-coverage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let put = |rel: &str| {
            let d = home.join(rel).join("orchestration");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("SKILL.md"), "---\nname: orchestration\n---\n").unwrap();
        };
        let agents: Vec<(String, String)> = [("claude", "Claude Code"), ("codex", "Codex"), ("cline", "Cline"), ("gemini", "Gemini CLI"), ("hermes", "Hermes"), ("aider", "Aider")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        let covered = |local_app: Option<&std::path::Path>| -> Vec<(String, bool)> { coverage(&home, local_app, &agents, "orchestration").iter().map(|r| (r["id"].as_str().unwrap().to_string(), r["covered"] == true)).collect() };
        let is = |rows: &[(String, bool)], id: &str| rows.iter().find(|r| r.0 == id).unwrap().1;

        // An install inside a repo covers nobody.
        put("work/app/.claude/skills");
        put("work/app/.agents/skills");
        assert!(covered(None).iter().all(|r| !r.1), "repo installs do not count");
        // Claude's own home skills folder covers Claude alone.
        put(".claude/skills");
        let rows = covered(None);
        assert!(is(&rows, "claude") && !is(&rows, "codex") && !is(&rows, "gemini"));
        // The shared folder covers the agents that read it, not the others.
        put(".agents/skills");
        let rows = covered(None);
        assert!(is(&rows, "codex") && is(&rows, "cline") && !is(&rows, "gemini"));
        // An agent with no known skills folder says so instead of guessing.
        let all = coverage(&home, None, &agents, "orchestration");
        let aider = all.iter().find(|r| r["id"] == "aider").unwrap();
        assert_eq!((aider["covered"].as_bool(), aider["known"].as_bool()), (Some(false), Some(false)));
        let found = all.iter().find(|r| r["id"] == "claude").unwrap()["foundIn"].as_str().unwrap().to_string();
        assert!(found.contains(".claude") && (!cfg!(windows) || !found.contains('/')), "one kind of separator: {found}");
        std::fs::remove_dir_all(home.join(".claude/skills")).unwrap();
        std::fs::remove_dir_all(home.join(".agents/skills")).unwrap();

        // A Claude plugin counts only while it is enabled.
        put(".claude/plugins/cache/mkt/kolux/1.0.0/skills");
        std::fs::write(home.join(".claude/settings.json"), r#"{"enabledPlugins":{"kolux@mkt":false}}"#).unwrap();
        assert!(!is(&covered(None), "claude"), "a disabled plugin");
        std::fs::write(home.join(".claude/settings.json"), r#"{"enabledPlugins":{"kolux@mkt":true}}"#).unwrap();
        assert!(is(&covered(None), "claude"), "an enabled plugin");
        // Codex counts from its own home folder and its plugin cache.
        put(".codex/plugins/cache/mkt/kolux/2.0.0/skills");
        assert!(is(&covered(None), "codex"));
        std::fs::remove_dir_all(home.join(".codex")).unwrap();
        put(".codex/skills");
        assert!(is(&covered(None), "codex"));
        // Hermes reads the local app-data folder on Windows, then the hidden folder in home.
        assert!(!is(&covered(None), "hermes"));
        put("AppData/Local/hermes/skills");
        assert!(is(&covered(Some(&home.join("AppData").join("Local"))), "hermes"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn bundled_skill_guides_are_listed_and_printed_offline() {
        let l = local("skills list").unwrap();
        let names: Vec<&str> = l["skills"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["kolux-cli", "koluxsecurity", "koluxward", "orchestration", "video"]);
        assert!(l["skills"].as_array().unwrap().iter().all(|s| !s["description"].as_str().unwrap().is_empty()));
        let short = local("skills get orchestration").unwrap();
        let full = local("skills get orchestration --full").unwrap();
        assert_eq!((short["name"].as_str(), short["selected"].as_str()), (Some("orchestration"), Some("guide")));
        assert!(!short["markdown"].as_str().unwrap().starts_with("---"), "the header block is not printed");
        assert!(full["markdown"].as_str().unwrap().len() > short["markdown"].as_str().unwrap().len());
        assert!(full["markdown"].as_str().unwrap().contains("# Decision gates"));
        assert_eq!(local("skills show --topic orch").unwrap(), short, "show, --topic and an alias reach the same guide");
        let gates = local("skills get orchestration --reference gates").unwrap();
        assert_eq!(local("skills get orchestration --reference references/gates.md").unwrap(), gates);
        assert!(gates["markdown"].as_str().unwrap().starts_with("# Decision gates"));
        assert_eq!(local("skills get kolux-cli --references").unwrap()["markdown"], "- automations\n- json\n- worktrees");
        let video = local("skills get video").unwrap();
        assert_eq!(video["name"].as_str(), Some("video"));
        assert!(video["markdown"].as_str().unwrap().contains("HyperFrames"));
        assert!(local("skills get hyperframes").unwrap()["name"].as_str() == Some("video"), "an alias reaches the guide");
        assert_eq!(local("skills get video --references").unwrap()["markdown"], "- hyperframes\n- higgsfield");
        assert!(local("skills get video --reference higgsfield").unwrap()["markdown"].as_str().unwrap().contains("mcp.higgsfield.ai/mcp"));
        // SKILL-031: a dry run prints the command and starts nothing; JSON is refused on a real run.
        let dry = local("skills install --skill orchestration --agent universal --dry-run").unwrap();
        assert_eq!(dry["command"], "npx --yes skills add kolux/skills --skill orchestration --agent universal -y -g");
        assert_eq!(dry["ran"], false);
        assert!(local("skills install --all --skill orchestration --dry-run").unwrap_err().message.contains("cannot be combined"));
        assert!(local("skills install --local --all --agent universal --dry-run").unwrap()["command"].as_str().unwrap().ends_with("universal -y"));
        let nope = local("skills get nope").unwrap_err();
        assert_eq!(nope.code, "not_found");
        assert!(nope.message.contains("kolux-cli, koluxsecurity, koluxward, orchestration, video"), "{}", nope.message);
        assert!(local("skills get orchestration --full --references").unwrap_err().message.contains("cannot be combined"));
        assert!(local("skills get orchestration --reference nope").unwrap_err().message.contains("gates, mail, tasks"));
        assert!(local("skills get").unwrap_err().message.contains("name a topic"));
    }
}
