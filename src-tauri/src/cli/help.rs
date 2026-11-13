//! The usage text and the help printer for `kolux` / `kolux-dev`.
//!
//! Split out of `cli.rs` with no behaviour change; see docs/research/rust-cli-split.md.

use super::*;

pub(super) const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev --version\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>, the name defaulting to its title] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n  kolux-dev open [--json]\n      start Kolux, or bring its window to the front, and wait until it answers\n  kolux-dev status [--json]\n      running, not-running, stale (its startup file is left but nothing answers) or graph-not-ready (still loading its workspaces); exit 0 only when running\n  kolux-dev diagnostics memory [--json]\n      the Resource Manager's memory figures: resident and committed for Kolux, each terminal session and the total\n  kolux-dev repo list | repo add --path <folder> | repo show [--repo <selector>] [--json]\n  kolux-dev repo set-base-ref --ref <ref> [--repo <selector>] [--json]\n  kolux-dev repo search-refs [--repo <selector>] [--query <text>] [--limit <n>] [--json]\n  kolux-dev project list [--json]\n  kolux-dev worktree list | worktree ps [--repo <selector>] [--limit <n>] [--json]\n  kolux-dev worktree show [--worktree <selector>] | worktree current [--usage] [--json]\n      --usage adds the tokens the worktree's sessions used (tracked providers only)\n  kolux-dev worktree set [--worktree <selector>] [--display-name <d>] [--issue <number>|null] [--comment <text>] [--workspace-status <id|label>]\n      [--parent-worktree <selector>|current] [--no-parent] [--json]\n  kolux-dev worktree changes | worktree overlap [--worktree <selector>] [--json]\n  kolux-dev orchestration worker-start (--task <id> | --spec <text>) (--agent <id> | --model <m> | --tier major|deep|build|light | --terminal <handle>)\n      [--worktree current|<selector>|new-child|new-top-level] [--model <m>] [--effort <e>] [--name <n>]\n      [--repo <selector>] [--base-branch <ref>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit]\n      [--task-title <t>] [--deps <json list>] [--parent <task>] [--retry-of <dispatch>] [--timeout-ms <ms>] [--max-depth <n>] [--json]\n  kolux-dev orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-use --id <run> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-current [--from <handle>] [--json]\n  kolux-dev orchestration run-list [--limit <n>] [--cursor <c>] [--json]\n  kolux-dev orchestration run-show --id <run> [--json]\n  kolux-dev orchestration send --subject <s> [--to run:<id>|dispatch:<id>|<handle>] [--body <text>] [--type <kind>]\n      [--priority normal|high|urgent] [--thread-id <t>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>]\n      [--outcome succeeded|failed] [--files-modified <a,b>] [--report-path <p>] [--phase <p>] [--run <run>] [--from <handle>]\n      [--retry-request <id>] [--json]\n  kolux-dev orchestration check [--terminal <handle>] [--run <run>] [--ack <delivery>] [--unread|--peek|--all]\n      [--types <kind,...>] [--format] [--wait] [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration reply --id <message> --body <text> [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]\n  kolux-dev orchestration ask (--question <text> [--options <a,b>] [--to <who>] | --resume <message>) [--timeout-ms <ms>] [--json]\n      (the packaged Windows build hands a new question back with exit status 75 and the resume command; a resumed wait never hands back)\n  kolux-dev orchestration gate-create --task <id> --question <text> [--options <json list>] [--json]\n  kolux-dev orchestration gate-resolve --id <gate> --resolution <text> [--json]\n  kolux-dev orchestration gate-list [--task <id>] [--status pending|resolved|timeout] [--run <run>] [--json]\n  kolux-dev orchestration task-create --spec <text> [--task-title <t>] [--display-name <n>] [--deps <json list>]\n      [--parent <task>] [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration task-list [--status <state>] [--ready] [--brief] [--run <run>] [--json]\n  kolux-dev orchestration task-update --id <task> --status pending|ready|dispatched|completed|failed|blocked\n      [--result <text>] [--run <run>] [--retry-request <id>] [--json]\n  kolux-dev orchestration task-reset --id <task> [--run <run>] [--retry-request <id>] [--json]\n      (a task held back after 3 failed hand-outs: closes the breaker so it lists ready again; the failed records stay)\n  kolux-dev orchestration dispatch --task <id> (--to <handle> [--inject] | --dry-run) [--return-preamble] [--run <run>]\n      [--max-depth <n>] [--json]\n  kolux-dev orchestration dispatch-show --task <id> [--preamble] [--json]\n  kolux-dev orchestration request-show --request <uuid> [--json]\n      what became of a change whose answer was lost (its --retry-request id)\n  kolux-dev account add [--agent claude|codex] [--json]\n      (runs the agent's own login in this terminal; Codex uses a device code)\n  kolux-dev account list [--json]\n  kolux-dev file open <path> [--path <path>] [--worktree <selector>] [--json]\n      (a relative path is read from the current folder inside the worktree; an absolute path must lie inside it)\n  kolux-dev file diff <path> [--path <path>] [--staged] [--worktree <selector>] [--json]\n  kolux-dev file open-changed [--mode diff|edit|both] [--worktree <selector>] [--json]\n      (diffs by default; deleted files are skipped for editing and unresolved conflicts for diffs)\n  kolux-dev file list [--path <folder>] | file read --path <file> | file rename --path <file> --to <new path> [--worktree <selector>] [--json]\n      (every path, old and new, must lie inside the worktree, also through links; a new letter case of the same name is allowed)\n  kolux-dev git branch | git pr [--worktree <selector>] [--json]\n      (read in the worktree's own folder, so its own remote and host answer; nothing is pushed)\n  kolux-dev sessions list [--worktree <selector>] [--json]\n      (the worktree's past Claude sessions with titles, cached for 30 seconds and shared between callers)\n  kolux-dev orchestration worker-abandon --dispatch <id> [--json]\n  kolux-dev orchestration worker-stop --dispatch <id> [--json]\n      (ends the worker's agent terminal; its worktree and other terminals stay)\n  kolux-dev orchestration worker-list [--run <run>] [--terminal-state active|reclaimable|retained|release_pending|release_unknown|released]\n      [--cursor <c>] [--limit 1-100] [--json]\n      (this terminal's Run unless --run names another; every Run when none is tied)\n  kolux-dev orchestration worker-retain --dispatch <id> [--json]\n      (keeps a settled worker's terminal open; the mark lasts across restarts)\n  kolux-dev orchestration worker-release --dispatch <id> [--retry-request <id>] [--json]\n      (saves a settled worker's output under the data folder, then closes its terminal; the worktree stays)\n  kolux-dev orchestration worker-show --dispatch <id> [--json]\n      (one worker's row, and whether it waits on a person: yes, no, or unknown when Kolux cannot tell, with where it saw that)\n  kolux-dev orchestration worker-read --dispatch <id> [--source auto|transcript|terminal] [--cursor <c>] [--limit 1-100] [--json]\n      (the worker's transcript turns, else its terminal output labelled as a fallback, else the archive saved at its release;\n      a worker may have no terminal: then --source terminal is refused, while auto and transcript always answer)\n  kolux-dev orchestration reset (--all | --tasks | --messages) [--json]\n  kolux-dev terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]\n  kolux-dev terminal show --terminal <handle> [--json]\n  kolux-dev terminal create [--worktree active|<selector>] [--command <text>] [--title <t>] [--focus] [--json]\n  kolux-dev terminal split --terminal <handle> [--direction vertical|horizontal] [--command <text>] [--json]\n  kolux-dev terminal rename --terminal <handle> [--title <t>] [--json]\n      without --title the default name comes back\n  kolux-dev terminal switch --terminal <handle> [--json]   (also: focus)\n  kolux-dev terminal close (--terminal <handle> [--tab] | --worktree <selector> --all) [--json] (it replaces stop)\n      (every terminal command also takes a worker's dispatch id as --terminal)\n  kolux-dev terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--json]\n      (the output after a cursor, or with --screen the frame visible now; inside a Kolux terminal --terminal defaults to it)\n  kolux-dev terminal send [--terminal <handle>] [--text <text>] [--enter] [--interrupt] [--wait-submit <seconds>] [--retry-request <id>] [--json]\n  kolux-dev terminal wait [--terminal <handle>] --for exit|tui-idle [--timeout-ms <ms>] [--json]\n  kolux-dev automations list [--json]\n  kolux-dev automations mine [--repo <selector>] [--json]\n      (only that repo's automations: the repo the call is made in unless --repo names one)\n  kolux-dev automations show <id> [--json]\n  kolux-dev automations runs <id> [--limit <n>] [--json]\n  kolux-dev automations create --name <n> --trigger hourly|daily|weekdays|weekly|<cron line or RRULE> --prompt <text>\n      [--provider claude|codex|gemini] [--time HH:MM] [--day 0-6, Sunday 0] [--timezone <IANA zone>]\n      [--repo <selector> | --workspace <selector>] [--workspace-mode existing|new-per-run]
      [--missed-run-grace-minutes 0|30|60|180|720|1440|2880]\n      [--precheck <command>] [--precheck-timeout 60|120|300|600] [--reuse-session | --fresh-session] [--enabled | --disabled] [--json]\n      (--schedule is another name for --trigger; --reuse-session keeps one agent session across runs and needs an existing worktree, --fresh-session does the reverse)\n  kolux-dev automations edit <id> [the create flags; --time, --day and --timezone go with --trigger] [--json]\n  kolux-dev automations remove <id> [--json]\n  kolux-dev automations run <id> [--json]\n  kolux-dev agent-context [--json]   (every command, its flags and its usage; works with the app closed)\n  kolux-dev skills list [--json]\n  kolux-dev skills get <topic> [--full | --references | --reference <name>] [--topic <topic>] [--json]\n      (also: show; skills commands work with the app closed)\n  kolux-dev skills coverage [--json]\n      (which installed agents have the orchestration skill for the whole computer)\n  kolux-dev skills install [--skill <a,b> | --all] [--agent <a,b>|universal] [--local] [--dry-run] [--json]\n  kolux-dev skills update [--skill <a,b> | --all] [--local] [--dry-run] [--json]\n      (through the community skills installer; neither --skill nor --all lists what is on offer; --json only with --dry-run;\n      --local means this project, not the whole computer; skills update touches only copies the installer recorded)\n  kolux-dev agent hooks status | agent hooks on | agent hooks off [--json]\n      (each agent's status hooks: installed, partial, not installed or error; on and off switch them\n      and bring every agent in line; these work with the app closed)\n  kolux-dev agent hooks prepare-codex\n      (install and trust Kolux's Codex hooks before Codex is first started)\n  kolux-dev profile migrate\n      (release smoke test: carry a former-name profile into a throwaway profile; refuses the installed one)\n  kolux-dev claude-teams [claude arguments]   (Claude Code with Agent Teams, in a Kolux terminal; not on Windows)\n\nSelectors: --repo id:|name:|path:   --worktree active|current|id:<repo-id>::<path>|identity:|name:|branch:|issue:|path:\n--json prints one envelope on stdout; without it, errors go to stderr; warnings about flags nothing
acts on yet go to stderr and into the result's `warnings` list. Exit 0 worked, 1 any error.\n";

/// CLI-001: `--version` or `-v` asks for the version only when nothing else is typed.
pub(super) fn version_only(words: &[String]) -> bool {
    matches!(words, [w] if w == "--version" || w == "-v")
}

/// CLI-001: the command words of a help request, the way `parse` reads them: flags and their
/// values, `help` and `-h` are left out.
pub(super) fn help_path(words: &[String]) -> Vec<String> {
    let mut path = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let w = &words[i];
        i += 1;
        if let Some(flag) = w.strip_prefix("--") {
            let takes = !flag.contains('=') && !SWITCHES.contains(&flag) && known_flag(flag);
            if takes && i < words.len() && !words[i].starts_with("--") {
                i += 1;
            }
        } else if !w.is_empty() && w != "-h" && !(w == "help" && path.is_empty()) {
            path.push(w.clone());
        }
    }
    path
}

/// The global options, listed under every help.
pub(super) const GLOBAL: &str = "Global options (every command): --help or -h prints help for the words before it; --json prints one envelope on stdout.\n";

/// CLI-001: help for a group or a command, cut from the usage list (an entry is a usage line and
/// the indented lines under it). An alias shows the command it stands for. A path nothing answers
/// to gets the closest help there is, a suggestion and exit status 1.
pub(super) fn help_raw(path: &[String]) -> (String, i32) {
    let (title, rest) = HELP.split_once("\n\n").unwrap_or((HELP, ""));
    let (body, footer) = rest.rsplit_once("\n\n").unwrap_or((rest, ""));
    let mut entries: Vec<String> = Vec::new();
    for l in body.lines() {
        match entries.last_mut() {
            Some(e) if !l.starts_with("  kolux-dev ") => {
                e.push('\n');
                e.push_str(l);
            }
            _ => entries.push(l.to_string()),
        }
    }
    // The command paths an entry's first line names, e.g. "repo list | repo add --path <folder>".
    let names = |e: &str| -> Vec<String> {
        let first = e.lines().next().unwrap_or("").trim_start().trim_start_matches("kolux-dev ");
        first.split(" | ").map(|seg| seg.split(' ').take_while(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '-') && !w.starts_with('-')).collect::<Vec<_>>().join(" ")).filter(|n| !n.is_empty()).collect()
    };
    let all = commands();
    let typed = path.join(" ");
    // An alias answers with the command it stands for: the first path with the same wire name.
    let want = all.iter().find(|c| c.0 == typed).and_then(|c| all.iter().find(|d| d.1 == c.1)).map_or(typed.clone(), |c| c.0.to_string());
    let page = |want: &str| -> Option<String> {
        let hits: Vec<&String> = entries.iter().filter(|e| names(e).iter().any(|n| n == want || n.starts_with(&format!("{want} ")))).collect();
        (!hits.is_empty()).then(|| format!("kolux-dev {want}\n\n{}\n\n{footer}\n{GLOBAL}", hits.iter().map(|e| e.as_str()).collect::<Vec<_>>().join("\n")))
    };
    if path.is_empty() {
        return (format!("{title}\n\n{body}\n\n{footer}\n{GLOBAL}"), 0);
    }
    if let Some(text) = page(&want) {
        return (text, 0);
    }
    // The nearest command in the group typed, else the nearest group or one-word command.
    let group = &path[0];
    let in_group: Vec<&str> = all.iter().filter_map(|c| c.0.strip_prefix(&format!("{group} "))).collect();
    let tops: Vec<&str> = all.iter().map(|c| c.0.split(' ').next().unwrap_or("")).collect();
    let guess = match (in_group.is_empty(), path.get(1)) {
        (false, Some(verb)) => nearest(verb, in_group.iter().copied()).map(|v| format!("{group} {v}")),
        _ => nearest(group, tops.iter().copied()).map(String::from),
    };
    let base = guess.as_deref().and_then(|g| page(g.split(' ').next().unwrap_or(g))).or_else(|| page(group)).unwrap_or_else(|| help_raw(&[]).0);
    let tip = guess.map_or(String::new(), |g| format!("; did you mean kolux-dev {g}?"));
    (format!("no command or group is called kolux-dev {typed}{tip}\n\n{base}"), 1)
}

/// CLI-001 help under the name this build answers to: `kolux` in a release build, `kolux-dev`
/// in a development one (`orchestration::CLI`). The usage list is written once, as `kolux-dev`.
pub(super) fn help(path: &[String]) -> (String, i32) {
    let (text, code) = help_raw(path);
    (named(&text, crate::orchestration::CLI), code)
}

pub(super) fn named(text: &str, cli: &str) -> String {
    text.replace("kolux-dev", cli)
}
