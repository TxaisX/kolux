//! T-573: installing the agents (Txais, 2026-10-28: every agent installable from Kolux, and installed by
//! the Kolux installer). One row per catalogue agent: the OFFICIAL Windows route from the tool's own
//! documentation (npm package name, winget id or install script URL), with the page it came from and the
//! day it was checked. No official Windows route means no row route: the agent reads as not installable
//! and the reason is in the comment. Never a third-party mirror (the tests hold the host and package set).
//!
//! `agents_install(id)` is the window's command for one agent; `agents_install_many(ids)` for a pick of them (T-578);
//! `--install-agents [--interactive] [id,id,...]` is the command line's (`cli_main`). All three are one batch engine:
//! the runtimes first, then npm (one call), the vendors' scripts (4 at once), winget and uv at the same time.
//! A missing runtime (Node.js for npm, uv, Git) is installed first with the frozen winget line.
//! T-576: the audit list that holds each route to its official source is `agent_install_official.rs`
//! (test only); installs run one at a time across the app; the install-all pass has a 45-minute cap, a
//! runtime install its own 10-minute deadline, and a silent or update install never raises a Windows
//! admin prompt (Node.js is a machine-wide installer; uv and Git install for this user only, T-577).

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{find_in, search_dirs, AgentInfo, CATALOGUE};

// T-580: the user Path a fenced run puts back, and npm's engine refusal as a plain sentence.
#[path = "agent_install_fence.rs"]
mod fence;
use fence::StoredValue;

// T-576: the reviewed allow-list the tests hold the table to (test only; not part of the program).
#[cfg(test)]
#[path = "agent_install_official.rs"]
mod agent_install_official;

/// What an agent's route needs on the PC first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Runtime {
    Node,
    Uv,
    Git,
}

impl Runtime {
    /// (winget id, the program whose presence means it is installed, what the sentences call it)
    fn facts(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Runtime::Node => ("OpenJS.NodeJS.LTS", "npm", "Node.js"),
            Runtime::Uv => ("astral-sh.uv", "uv", "uv"),
            Runtime::Git => ("Git.Git", "git", "Git"),
        }
    }

    /// True when the installer is machine-wide and Windows asks for admin permission (T-576, checked with
    /// `winget show --scope user` on 2026-10-28: Node.js has no per-user installer; uv is a portable zip that
    /// takes `--scope user`; T-577: Git.Git lists an applicable per-user Inno installer under `--scope user`,
    /// so Git installs for this user too, with no admin prompt, and a silent install may start it like uv).
    fn machine_scope(self) -> bool {
        matches!(self, Runtime::Node)
    }
}

/// Who is waiting for the install (T-576).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The person is at the screen (the window's Install button, or an interactive installer): a runtime
    /// install may raise Windows' admin prompt.
    Interactive,
    /// A silent or update install: never start a machine-wide runtime install.
    Silent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// `npm install -g <args>`
    Npm(&'static [&'static str]),
    /// `winget install --exact --id <id> ...`
    Winget(&'static str),
    /// `uv tool install <package>`
    Uv(&'static str),
    /// The vendor's PowerShell line, copied from its documentation, run by `powershell -Command`.
    Script(&'static str),
}

pub struct Row {
    pub id: &'static str,
    pub route: Option<Route>,
    pub needs: Option<Runtime>,
    /// The route ends in an interactive step (T-576: Devin's script finishes with `devin setup`, which waits for a
    /// login). The run is ended as soon as the agent is found on the PC, instead of waiting for that step.
    pub ends_when_found: bool,
}

const fn row(id: &'static str, route: Route, needs: Option<Runtime>) -> Row {
    Row { id, route: Some(route), needs, ends_when_found: false }
}
const fn row_ends_when_found(id: &'static str, route: Route, needs: Option<Runtime>) -> Row {
    Row { id, route: Some(route), needs, ends_when_found: true }
}
const fn none(id: &'static str) -> Row {
    Row { id, route: None, needs: None, ends_when_found: false }
}

const NODE: Option<Runtime> = Some(Runtime::Node);

/// One row per `CATALOGUE` id, in its order. Every doc page below was read on 2026-10-28.
pub const TABLE: [Row; 35] = [
    // https://code.claude.com/docs/en/setup (Windows PowerShell)
    row("claude", Route::Script("irm https://claude.ai/install.ps1 | iex"), None),
    // https://github.com/Twigpine/openclaude (README: npm install -g @twigpine/openclaude)
    row("openclaude", Route::Npm(&["@twigpine/openclaude@latest"]), NODE),
    // https://github.com/openai/codex (README: Windows PowerShell line; there is no winget package)
    row("codex", Route::Script("irm https://chatgpt.com/codex/install.ps1 | iex"), None),
    // https://docs.autohand.ai/guides/cli-quick-start
    row("autohand", Route::Npm(&["autohand-cli"]), NODE),
    // Ante: https://docs.antigma.ai says "Currently only macOS and Linux are supported". Not installable.
    none("ante"),
    // Trae: no official Trae CLI install page for Windows (only third-party write-ups). Not installable.
    none("trae"),
    // https://mimo.xiaomi.com/mimocode/install (installs mimo.exe into %USERPROFILE%\.mimocode\bin)
    row("mimo-code", Route::Script("irm https://mimo.xiaomi.com/install.ps1 | iex"), None),
    // https://github.com/earendil-works/pi (README npm route; its pi.dev PowerShell script asks questions)
    row("pi", Route::Npm(&["--ignore-scripts", "@earendil-works/pi-coding-agent"]), NODE),
    // https://github.com/can1357/oh-my-pi (README: PowerShell line)
    row("omp", Route::Script("irm https://omp.sh/install.ps1 | iex"), None),
    // https://github.com/PrimeIntellect-ai/prime-agent (README: PowerShell line)
    row("prime-agent", Route::Script("irm https://app.primeintellect.ai/prime-agent/install.ps1 | iex"), None),
    // https://geminicli.com/docs/ (npm install -g @google/gemini-cli)
    row("gemini", Route::Npm(&["@google/gemini-cli"]), NODE),
    // https://antigravity.google/docs/getting-started?tab=cli (Windows PowerShell)
    row("antigravity", Route::Script("irm https://antigravity.google/cli/install.ps1 | iex"), None),
    // https://aider.chat/docs/install.html (Windows PowerShell line; it brings its own uv)
    row("aider", Route::Script("irm https://aider.chat/install.ps1 | iex"), None),
    // https://goose-docs.ai/docs/getting-started/installation (Windows: download_cli.ps1 from the goose repo,
    // CONFIGURE=false so it does not ask questions; run as a script block so no file is written)
    row(
        "goose",
        Route::Script("$env:CONFIGURE='false'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1)))"),
        None,
    ),
    // winget show Sourcegraph.Amp (checked 2026-10-28): publisher Sourcegraph, Inc., homepage https://ampcode.com/
    row("amp", Route::Winget("Sourcegraph.Amp"), None),
    // https://kilo.ai/docs/code-with-ai/platforms/cli
    row("kilo", Route::Npm(&["@kilocode/cli"]), NODE),
    // https://kiro.dev/docs/cli/installation/ (Windows 11, PowerShell)
    row("kiro", Route::Script("irm 'https://cli.kiro.dev/install.ps1' | iex"), None),
    // https://github.com/charmbracelet/crush (README: winget install charmbracelet.crush)
    row("crush", Route::Winget("charmbracelet.crush"), None),
    // https://docs.augmentcode.com/cli/overview (npm install -g @augmentcode/auggie; Node 20+)
    row("aug", Route::Npm(&["@augmentcode/auggie"]), NODE),
    // https://docs.cline.bot/usage/cli-overview
    row("cline", Route::Npm(&["cline"]), NODE),
    // https://www.codebuff.com/docs/help/quick-start
    row("codebuff", Route::Npm(&["codebuff"]), NODE),
    // https://commandcode.ai/docs
    row("command-code", Route::Npm(&["command-code"]), NODE),
    // https://github.com/continuedev/continue (npm i -g @continuedev/cli; docs.continue.dev's CLI page was an empty redirect).
    // Its repo is read-only and unmaintained (checked 2026-10-28). Kept as a coordinator default; Txais may overrule.
    row("continue", Route::Npm(&["@continuedev/cli"]), NODE),
    // https://cursor.com/docs/cli/overview (Windows PowerShell; installs cursor-agent)
    row("cursor", Route::Script("irm 'https://cursor.com/install?win32=true' | iex"), None),
    // https://docs.factory.com/cli/getting-started/quickstart (Windows PowerShell)
    row("droid", Route::Script("irm https://app.factory.ai/cli/windows | iex"), None),
    // https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started (Windows PowerShell; needs Git for Windows)
    row("kimi", Route::Script("irm https://code.kimi.com/kimi-code/install.ps1 | iex"), Some(Runtime::Git)),
    // https://github.com/mistralai/mistral-vibe (README: uv tool install mistral-vibe)
    row("mistral-vibe", Route::Uv("mistral-vibe"), Some(Runtime::Uv)),
    // https://github.com/QwenLM/qwen-code (README: npm install -g @qwen-code/qwen-code@latest; Node 22+)
    row("qwen-code", Route::Npm(&["@qwen-code/qwen-code@latest"]), NODE),
    // Rovo Dev: runs inside Atlassian's ACLI (`acli rovodev run`); ACLI is a manual download with no winget id
    // and there is no standalone `rovo` program. Not installable.
    none("rovo"),
    // https://github.com/NousResearch/hermes-agent (README: native Windows PowerShell line; it installs its own Git and uv)
    row("hermes", Route::Script("& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive"), None),
    // https://docs.openclaw.ai/install (PowerShell; -NoOnboard skips the questions)
    row("openclaw", Route::Script("& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard"), None),
    // https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli (WinGet)
    row("copilot", Route::Winget("GitHub.Copilot"), None),
    // Grok CLI: https://x.ai/cli/install.ps1, served by xAI from its own host. The file starts
    // "# Grok CLI installer for PowerShell - https://x.ai/cli/install.ps1 ... Usage: irm https://x.ai/cli/install.ps1 | iex"
    // (checked 2026-10-28). xAI's docs pages show only the macOS/Linux script; the coordinator ruled the vendor's own
    // host an official source (T-577), so grok is installable again.
    row("grok", Route::Script("irm https://x.ai/cli/install.ps1 | iex"), None),
    // https://docs.devin.ai/cli (Windows PowerShell). The script ends in `devin setup`, a full-screen menu
    // ("select / confirm / esc") that waits for a person; a live run on 2026-10-28 sat there until the 10-minute
    // deadline and opened no browser. So the run is ended as soon as devin.exe is found (the script has put it
    // in %LOCALAPPDATA%\devin\cli\bin and on the user PATH by then; T-576).
    row_ends_when_found("devin", Route::Script("irm https://static.devin.ai/cli/setup.ps1 | iex"), None),
    // https://opencode.ai/docs/ (npm i -g opencode-ai)
    row("opencode", Route::Npm(&["opencode-ai"]), NODE),
];

fn row_of(id: &str) -> Option<&'static Row> {
    TABLE.iter().find(|r| r.id == id)
}

/// The command the tooltip shows (the human-readable form of the route); `None` when not installable.
pub fn install_text(id: &str) -> Option<String> {
    Some(match row_of(id)?.route? {
        Route::Npm(args) => format!("npm install -g {}", args.join(" ")),
        Route::Winget(w) => format!("winget install --exact --id {w}"),
        Route::Uv(p) => format!("uv tool install {p}"),
        Route::Script(s) => format!("powershell -Command \"{s}\""),
    })
}

/// The frozen winget line (arguments after `winget`).
fn winget_args(id: &str) -> Vec<String> {
    ["install", "--exact", "--id", id, "--silent", "--accept-package-agreements", "--accept-source-agreements"].iter().map(|s| s.to_string()).collect()
}

/// The frozen line for a runtime: uv (a portable zip) and Git (a per-user Inno installer) are installed for this
/// user only (no admin prompt); Node.js keeps the machine-wide line.
fn runtime_winget_args(runtime: Runtime) -> Vec<String> {
    let mut args = winget_args(runtime.facts().0);
    if !runtime.machine_scope() {
        args.extend(["--scope".to_string(), "user".to_string()]);
    }
    args
}

/// One agent's time limit.
const LIMIT: Duration = Duration::from_secs(10 * 60);
/// A runtime install (Node.js, uv, Git) has its own deadline, apart from the agent that needed it.
const RUNTIME_LIMIT: Duration = Duration::from_secs(10 * 60);
/// The whole batch.
pub const TOTAL_LIMIT: Duration = Duration::from_secs(45 * 60);
/// T-578: the one npm call that installs several packages gets this much more time for each package after the first.
const NPM_EXTRA_PER_PACKAGE: Duration = Duration::from_secs(60);
/// T-578: how many of the vendors' own install scripts run at the same moment.
const SCRIPTS_AT_ONCE: usize = 4;

/// One batch at a time across the app (T-576, T-578): a window click and an install-all run never install
/// together. A caller that finds it held waits. It is held for the whole batch.
static INSTALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A child's search path: the registry's machine and user Path first (so a program a winget install just
/// added is seen without a restart), then this process's PATH and the usual install folders.
fn child_path() -> OsString {
    std::env::join_paths(search_dirs()).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// How often `run` asks whether it can stop early.
const EARLY_CHECK: Duration = Duration::from_secs(2);

/// Runs one program to its end: no window, no input, output to a temp file, `limit` as the deadline.
/// Ok(exit code) or Err(one sentence). The last `TAIL_LINES` lines of the output go to `tail` (T-580: npm's
/// engine refusal sits a few lines above the last one).
/// `done_early`, when given, is asked every couple of seconds; once it says yes the whole process tree is
/// ended and the result is Ok(None) (no exit code).
fn run(program: &Path, args: &[String], deadline: Instant, tail: &mut String, done_early: Option<&dyn Fn() -> bool>) -> Result<Option<i32>, String> {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let out = std::env::temp_dir().join(format!("kolux-agent-install-{}-{}.log", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let file = std::fs::File::create(&out).map_err(|e| format!("Kolux could not make a temporary file ({e})."))?;
    let file2 = file.try_clone().map_err(|e| format!("Kolux could not make a temporary file ({e})."))?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).env("PATH", child_path()).stdin(Stdio::null()).stdout(file).stderr(file2);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Kolux could not start {} ({e}).", program.display()))?;
    let mut next_check = Instant::now() + EARLY_CHECK;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) if asks_to_stop(done_early, &mut next_check) => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break Ok(None);
            }
            Ok(None) if Instant::now() >= deadline => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break Err("The install took longer than its time limit, so Kolux stopped it.".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => break Err(format!("Kolux lost track of the installer ({e}).")),
        }
    };
    if let Ok(bytes) = std::fs::read(&out) {
        *tail = last_lines(&String::from_utf8_lossy(&bytes));
    }
    let _ = std::fs::remove_file(&out);
    result
}

/// How many of the output's last lines `run` keeps.
const TAIL_LINES: usize = 40;

/// The last `TAIL_LINES` non-empty lines of `text`, trimmed, each at most 200 characters, oldest first.
fn last_lines(text: &str) -> String {
    let mut lines: Vec<String> = text.lines().rev().map(str::trim).filter(|l| !l.is_empty()).take(TAIL_LINES).map(|l| l.chars().take(200).collect()).collect();
    lines.reverse();
    lines.join("\n")
}

/// True when `done_early` exists, it is time to ask, and it says yes.
fn asks_to_stop(done_early: Option<&dyn Fn() -> bool>, next_check: &mut Instant) -> bool {
    match done_early {
        Some(f) if Instant::now() >= *next_check => {
            *next_check = Instant::now() + EARLY_CHECK;
            f()
        }
        _ => false,
    }
}

fn kill_tree(pid: u32) {
    // One cross-platform tree kill: taskkill on Windows, the process-group signal elsewhere.
    crate::procs::kill_tree(pid);
}

/// What a batch carries from step to step. Copy: every group's thread gets its own.
#[derive(Clone, Copy)]
struct Ctx {
    mode: Mode,
    /// One agent's time limit.
    limit: Duration,
    /// When the whole batch must be over (`None` for a single window click).
    total_end: Option<Instant>,
}

impl Ctx {
    fn new(mode: Mode, limit: Duration, total_end: Option<Instant>) -> Self {
        Ctx { mode, limit, total_end }
    }
    /// A deadline never later than the whole batch's.
    fn clamp(&self, deadline: Instant) -> Instant {
        match self.total_end {
            Some(end) if end < deadline => end,
            _ => deadline,
        }
    }
    fn out_of_time(&self) -> bool {
        self.total_end.is_some_and(|end| Instant::now() >= end)
    }
}

/// The sentence for a runtime that a silent or update install must not start (it would raise an admin prompt).
fn silent_refusal(runtime: Runtime, mode: Mode) -> Option<String> {
    (mode == Mode::Silent && runtime.machine_scope()).then(|| format!("needs {} (install it, then use Install in Kolux)", runtime.facts().2))
}

/// T-578: where an agent is in a batch (the `agent-install-progress` event).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Queued,
    Installing,
    Ok,
    Failed,
}

/// T-578: the `agent-install-progress` event's payload.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub state: State,
    pub error: Option<String>,
}

/// T-578: one agent's end of a batch (`agents_install_many`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub id: String,
    pub ok: bool,
    pub error: Option<String>,
    pub agent: Option<AgentInfo>,
}

/// What a batch needs from the PC. The real one runs programs, detects agents and sends the event; the
/// tests use a fake, so the batch's order and counts are proven without installing anything.
trait Host: Sync {
    fn info(&self, id: &str) -> Option<AgentInfo>;
    /// Where a program is on this PC, when it is.
    fn program(&self, name: &str) -> Option<PathBuf>;
    fn run(&self, program: &Path, args: &[String], deadline: Instant, tail: &mut String, done_early: Option<&dyn Fn() -> bool>) -> Result<Option<i32>, String>;
    fn progress(&self, p: Progress);
    /// The log line(s) for one agent's end.
    fn report(&self, id: &str, result: &Result<(), String>, tail: &str);
    /// T-580: whether this run must leave the user's own Path as it found it (`agents::run_fenced`).
    fn fenced(&self) -> bool;
    /// T-580: `HKCU\Environment` "Path" as stored; `Ok(None)` when there is none.
    fn user_path(&self) -> Result<Option<StoredValue>, String>;
    /// T-580: writes the user Path back (`None` removes it).
    fn put_user_path(&self, value: Option<&StoredValue>) -> Result<(), String>;
    /// One line for kolux.log.
    fn note(&self, line: &str);
}

/// The event's name.
pub const PROGRESS_EVENT: &str = "agent-install-progress";

struct RealHost {
    /// `None` for the installer's run and the single-agent command: no window listens.
    app: Option<tauri::AppHandle>,
}

impl Host for RealHost {
    fn info(&self, id: &str) -> Option<AgentInfo> {
        info_of(id)
    }
    fn program(&self, name: &str) -> Option<PathBuf> {
        find_in(&search_dirs(), name)
    }
    fn run(&self, program: &Path, args: &[String], deadline: Instant, tail: &mut String, done_early: Option<&dyn Fn() -> bool>) -> Result<Option<i32>, String> {
        run(program, args, deadline, tail, done_early)
    }
    fn progress(&self, p: Progress) {
        if let Some(app) = &self.app {
            let _ = tauri::Emitter::emit(app, PROGRESS_EVENT, p);
        }
    }
    fn report(&self, id: &str, result: &Result<(), String>, tail: &str) {
        log_result(id, result, tail);
    }
    fn fenced(&self) -> bool {
        super::run_fenced()
    }
    fn user_path(&self) -> Result<Option<StoredValue>, String> {
        fence::read_user_path()
    }
    fn put_user_path(&self, value: Option<&StoredValue>) -> Result<(), String> {
        fence::write_user_path(value)
    }
    fn note(&self, line: &str) {
        log(line);
    }
}

/// T-580: in a fenced run, the user Path as it was before the batch, put back when the batch ends (also when a
/// group's thread panics) if it changed. Outside a fenced run it holds nothing and does nothing.
struct PathFence<'a> {
    host: &'a dyn Host,
    before: Option<Option<StoredValue>>,
}

impl<'a> PathFence<'a> {
    fn start(host: &'a dyn Host) -> Self {
        let before = if host.fenced() {
            match host.user_path() {
                Ok(v) => Some(v),
                Err(why) => {
                    host.note(&format!("agent install: {why} A script in this fenced run may change it."));
                    None
                }
            }
        } else {
            None
        };
        PathFence { host, before }
    }
}

impl Drop for PathFence<'_> {
    fn drop(&mut self) {
        let Some(before) = self.before.take() else { return };
        if self.host.user_path().as_ref() == Ok(&before) {
            return;
        }
        match self.host.put_user_path(before.as_ref()) {
            Ok(()) => self.host.note("agent install: an installer changed the user Path in a fenced run; Kolux put it back."),
            Err(why) => self.host.note(&format!("agent install: {why}")),
        }
    }
}

/// Installs `runtime` with winget unless it is there. It has its own deadline (`RUNTIME_LIMIT`), apart from
/// the agents that need it. A silent install never starts a machine-wide one.
fn ensure_runtime(host: &dyn Host, runtime: Runtime, ctx: &Ctx, tail: &mut String) -> Result<(), String> {
    let (_, program, name) = runtime.facts();
    if host.program(program).is_some() {
        return Ok(());
    }
    if let Some(text) = silent_refusal(runtime, ctx.mode) {
        return Err(text);
    }
    let deadline = ctx.clamp(Instant::now() + RUNTIME_LIMIT);
    let outcome = match host.program("winget") {
        None => Err("winget is not available on this PC.".to_string()),
        Some(w) => host.run(&w, &runtime_winget_args(runtime), deadline, tail, None).and_then(|code| {
            // winget may exit nonzero for "already installed, nothing to do"; the program being there is the test.
            if host.program(program).is_some() {
                Ok(())
            } else {
                Err(format!("winget ended with code {}.", code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())))
            }
        }),
    };
    outcome.map_err(|why| format!("{name} is needed first and could not be installed: {why}"))
}

/// One agent's detected state: `catalogue()`'s entry for it, without scanning the PC for the other 34.
fn info_of(id: &str) -> Option<AgentInfo> {
    let (id, name, programs, args) = CATALOGUE.iter().find(|e| e.0 == id)?;
    let found = programs.iter().find_map(|p| find_in(&search_dirs(), p).map(|f| (*p, f)));
    Some(AgentInfo {
        id: id.to_string(),
        name: name.to_string(),
        program: found.as_ref().map(|(p, _)| *p).unwrap_or(programs[0]).to_string(),
        args: args.iter().map(|a| a.to_string()).collect(),
        installed: found.is_some(),
        path: found.map(|(_, f)| f.display().to_string()),
        docs: super::install_page(id).is_some(),
        installable: install_text(id).is_some(),
        install: install_text(id),
    })
}

/// An agent that has a route and still has to be installed.
struct Item {
    id: String,
    name: String,
    route: Route,
    needs: Option<Runtime>,
}

fn program_for(host: &dyn Host, name: &str) -> PathBuf {
    host.program(name).unwrap_or_else(|| PathBuf::from(name))
}

fn npm_call(host: &dyn Host, packages: &[String]) -> (PathBuf, Vec<String>) {
    (program_for(host, "npm"), ["install", "-g"].iter().map(|s| s.to_string()).chain(packages.iter().cloned()).collect())
}

/// The program and arguments that install one agent alone.
fn call_for(host: &dyn Host, route: Route) -> Result<(PathBuf, Vec<String>), String> {
    Ok(match route {
        Route::Npm(a) => npm_call(host, &a.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
        Route::Winget(w) => (host.program("winget").ok_or("winget is not available on this PC.")?, winget_args(w)),
        Route::Uv(p) => (program_for(host, "uv"), ["tool", "install", p].iter().map(|s| s.to_string()).collect()),
        Route::Script(s) => (
            program_for(host, "powershell"),
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
                .iter()
                .map(|a| a.to_string())
                .chain(std::iter::once(format!("$ProgressPreference='SilentlyContinue'; {s}")))
                .collect(),
        ),
    })
}

fn not_finished(name: &str, code: Option<i32>) -> String {
    format!("{name} did not finish installing (the installer ended with code {}).", code.map(|c| c.to_string()).unwrap_or_else(|| "none".into()))
}

/// The sentence for an install that ended without the agent: npm's engine refusal in `tail` reads as "needs a
/// newer Node.js" (T-580), anything else as `not_finished`.
fn failure(name: &str, code: Option<i32>, tail: &str) -> String {
    fence::needs_newer_node(name, tail).unwrap_or_else(|| not_finished(name, code))
}

/// Installs one agent alone with its own call. Ok when it is found afterwards.
fn install_single(host: &dyn Host, item: &Item, ctx: &Ctx, tail: &mut String) -> Result<(), String> {
    let (program, args) = call_for(host, item.route)?;
    let deadline = ctx.clamp(Instant::now() + ctx.limit);
    let id = item.id.as_str();
    let found = || host.info(id).is_some_and(|a| a.installed);
    let ends_early = row_of(id).is_some_and(|r| r.ends_when_found);
    let code = host.run(&program, &args, deadline, tail, if ends_early { Some(&found) } else { None })?;
    if found() {
        Ok(())
    } else {
        Err(failure(&item.name, code, tail))
    }
}

/// The line for an agent the batch did not reach before the total time ran out.
const OUT_OF_TIME: &str = "skipped, the 45-minute install time ran out";

/// One batch in progress: the host, the limits and every agent's end so far.
struct Batch<'a> {
    host: &'a dyn Host,
    ctx: Ctx,
    results: Mutex<HashMap<String, Result<(), String>>>,
}

impl Batch<'_> {
    fn start(&self, id: &str) {
        self.host.progress(Progress { id: id.to_string(), state: State::Installing, error: None });
    }
    fn finish(&self, id: &str, result: Result<(), String>, tail: &str) {
        self.host.report(id, &result, tail);
        let (state, error) = match &result {
            Ok(()) => (State::Ok, None),
            Err(why) => (State::Failed, Some(why.clone())),
        };
        self.host.progress(Progress { id: id.to_string(), state, error });
        self.results.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), result);
    }
    /// Installs one agent alone, unless the total time is already over.
    fn one(&self, item: &Item) {
        if self.ctx.out_of_time() {
            self.finish(&item.id, Err(OUT_OF_TIME.to_string()), "");
            return;
        }
        self.start(&item.id);
        let mut tail = String::new();
        let result = install_single(self.host, item, &self.ctx, &mut tail);
        self.finish(&item.id, result, &tail);
    }
    /// Agents one after another (winget allows one MSI at a time; uv tools share one folder).
    fn in_turn(&self, items: &[&Item]) {
        for item in items {
            self.one(item);
        }
    }
    /// At most `SCRIPTS_AT_ONCE` of the vendors' own scripts at the same moment.
    fn scripts(&self, items: &[&Item]) {
        let queue = Mutex::new(items.iter().copied().collect::<VecDeque<&Item>>());
        std::thread::scope(|s| {
            for _ in 0..SCRIPTS_AT_ONCE.min(items.len()) {
                s.spawn(|| loop {
                    let next = queue.lock().unwrap_or_else(|e| e.into_inner()).pop_front();
                    match next {
                        Some(item) => self.one(item),
                        None => break,
                    }
                });
            }
        });
    }
    /// ONE `npm install -g` for every plain package; a package with extra arguments (pi: `--ignore-scripts`)
    /// gets its own call after it. A failed batch call is retried package by package, so every agent has its
    /// own ok or failed.
    fn npm(&self, items: &[&Item]) {
        let plain = |i: &&Item| matches!(i.route, Route::Npm(a) if !a.iter().any(|x| x.starts_with('-')));
        let (batch, own): (Vec<&Item>, Vec<&Item>) = items.iter().copied().partition(plain);
        if !batch.is_empty() {
            self.npm_batch(&batch);
        }
        self.in_turn(&own);
    }
    fn npm_batch(&self, items: &[&Item]) {
        if self.ctx.out_of_time() {
            for item in items {
                self.finish(&item.id, Err(OUT_OF_TIME.to_string()), "");
            }
            return;
        }
        for item in items {
            self.start(&item.id);
        }
        let packages: Vec<String> = items.iter().flat_map(|i| if let Route::Npm(a) = i.route { a.iter().map(|s| s.to_string()).collect() } else { Vec::new() }).collect();
        let (program, args) = npm_call(self.host, &packages);
        // The agent's 10 minutes, plus a minute for each package after the first.
        let deadline = self.ctx.clamp(Instant::now() + self.ctx.limit + NPM_EXTRA_PER_PACKAGE * (items.len() as u32 - 1));
        let mut tail = String::new();
        let code = self.host.run(&program, &args, deadline, &mut tail, None);
        let mut left: Vec<&Item> = Vec::new();
        for item in items {
            if self.host.info(&item.id).is_some_and(|a| a.installed) {
                self.finish(&item.id, Ok(()), "");
            } else {
                left.push(item);
            }
        }
        if let [only] = left[..] {
            // One package: its own call would be the same call again.
            let why = match code {
                Err(why) => why,
                Ok(code) => failure(&only.name, code, &tail),
            };
            self.finish(&only.id, Err(why), &tail);
        } else {
            for item in left {
                if self.ctx.out_of_time() {
                    self.finish(&item.id, Err(OUT_OF_TIME.to_string()), "");
                    continue;
                }
                let mut tail = String::new();
                let result = install_single(self.host, item, &self.ctx, &mut tail);
                self.finish(&item.id, result, &tail);
            }
        }
    }
}

/// `ids` once each, in the order given.
fn unique(ids: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for id in ids {
        if !seen.contains(id) {
            seen.push(id.clone());
        }
    }
    seen
}

/// The engine (T-578): runs the whole batch and returns one result per id, in the order given. The caller holds
/// `INSTALL_LOCK`.
///  1. every id is queued; an unknown, installed or not installable one ends at once;
///  2. the runtimes the rest needs (Node, uv, Git) are installed one after another;
///  3. four groups run at the same time: npm (one batch call), the vendors' scripts (4 at once), winget (one at
///     a time) and uv (one at a time);
///  4. every agent is detected again.
fn run_batch(host: &dyn Host, ids: &[String], ctx: Ctx) -> Vec<InstallResult> {
    let ids = unique(ids);
    // T-580: before any install (the vendors' scripts above all), so a fenced run ends with the user Path it began with.
    let _path_fence = PathFence::start(host);
    let batch = Batch { host, ctx, results: Mutex::new(HashMap::new()) };
    for id in &ids {
        host.progress(Progress { id: id.clone(), state: State::Queued, error: None });
    }
    let mut todo: Vec<Item> = Vec::new();
    for id in &ids {
        let Some(info) = host.info(id) else {
            batch.finish(id, Err(format!("Kolux does not know an agent called {id}.")), "");
            continue;
        };
        if info.installed {
            batch.finish(id, Ok(()), "");
            continue;
        }
        match row_of(id).and_then(|r| r.route.map(|route| (route, r.needs))) {
            None => batch.finish(id, Err(format!("Kolux has no official Windows install for {}; its own page tells how.", info.name)), ""),
            Some((route, needs)) => todo.push(Item { id: id.clone(), name: info.name, route, needs }),
        }
    }
    // The runtimes first, one after another; an agent whose runtime could not be installed ends here.
    let mut blocked: HashMap<Runtime, (String, String)> = HashMap::new();
    for runtime in [Runtime::Node, Runtime::Uv, Runtime::Git] {
        if !todo.iter().any(|i| i.needs == Some(runtime)) {
            continue;
        }
        let mut tail = String::new();
        let result = if ctx.out_of_time() { Err(OUT_OF_TIME.to_string()) } else { ensure_runtime(host, runtime, &ctx, &mut tail) };
        if let Err(why) = result {
            blocked.insert(runtime, (why, tail));
        }
    }
    let (ready, stuck): (Vec<&Item>, Vec<&Item>) = todo.iter().partition(|i| !i.needs.is_some_and(|r| blocked.contains_key(&r)));
    for item in stuck {
        if let Some((why, tail)) = item.needs.and_then(|r| blocked.get(&r)) {
            batch.finish(&item.id, Err(why.clone()), tail);
        }
    }
    let group = |f: fn(&Route) -> bool| ready.iter().copied().filter(|i| f(&i.route)).collect::<Vec<&Item>>();
    let npm = group(|r| matches!(r, Route::Npm(_)));
    let scripts = group(|r| matches!(r, Route::Script(_)));
    let winget = group(|r| matches!(r, Route::Winget(_)));
    let uv = group(|r| matches!(r, Route::Uv(_)));
    std::thread::scope(|s| {
        if !npm.is_empty() {
            s.spawn(|| batch.npm(&npm));
        }
        if !scripts.is_empty() {
            s.spawn(|| batch.scripts(&scripts));
        }
        if !winget.is_empty() {
            s.spawn(|| batch.in_turn(&winget));
        }
        if !uv.is_empty() {
            s.spawn(|| batch.in_turn(&uv));
        }
    });
    let results = batch.results.into_inner().unwrap_or_else(|e| e.into_inner());
    ids.iter()
        .map(|id| {
            let agent = host.info(id);
            match results.get(id) {
                Some(Ok(())) => InstallResult { id: id.clone(), ok: true, error: None, agent },
                Some(Err(why)) => InstallResult { id: id.clone(), ok: false, error: Some(why.clone()), agent },
                None => InstallResult { id: id.clone(), ok: false, error: Some("The install did not run.".to_string()), agent },
            }
        })
        .collect()
}

/// The batch under the process-wide lock: a window click and an install-all run never install together. A
/// caller that finds it held waits. `total` is counted from when the batch starts.
fn locked_batch(host: &dyn Host, ids: &[String], mode: Mode, limit: Duration, total: Option<Duration>) -> Vec<InstallResult> {
    let _one_batch_at_a_time = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    run_batch(host, ids, Ctx::new(mode, limit, total.map(|t| Instant::now() + t)))
}

/// The window's command, many agents: install them as one batch and return each one's end.
/// Progress goes out as the `agent-install-progress` event.
#[tauri::command]
pub async fn agents_install_many(app: tauri::AppHandle, ids: Vec<String>) -> Result<Vec<InstallResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // A click: the person is at the screen, so a runtime install may raise Windows' admin prompt.
        locked_batch(&RealHost { app: Some(app) }, &ids, Mode::Interactive, LIMIT, Some(TOTAL_LIMIT))
    })
    .await
    .map_err(|e| format!("The install stopped unexpectedly ({e})."))
}

/// The window's command, one agent (a batch of one): install it and return its refreshed state.
#[tauri::command]
pub async fn agents_install(id: String) -> Result<AgentInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let end = locked_batch(&RealHost { app: None }, std::slice::from_ref(&id), Mode::Interactive, LIMIT, None).pop();
        match end {
            Some(InstallResult { ok: true, agent: Some(agent), .. }) => Ok(agent),
            Some(InstallResult { error: Some(why), .. }) => Err(why),
            _ => Err("The install did not run.".to_string()),
        }
    })
    .await
    .map_err(|e| format!("The install stopped unexpectedly ({e})."))?
}

/// The profile folder kolux.log lives in (`KOLUX_APP_DIR` when a scratch run sets it).
fn log_dir() -> Option<PathBuf> {
    std::env::var_os("KOLUX_APP_DIR").filter(|v| !v.is_empty()).map(PathBuf::from).or_else(|| crate::resources::recovery::profile_dir("com.txaisxiong.kolux-rs"))
}

fn log(line: &str) {
    match log_dir() {
        Some(dir) => crate::diag::write(&dir, line),
        None => eprintln!("{line}"),
    }
}

fn log_result(id: &str, result: &Result<(), String>, tail: &str) {
    match result {
        Ok(()) => log(&format!("agent install {id}: ok")),
        Err(why) => {
            log(&format!("agent install {id}: failed: {why}"));
            if let Some(last) = tail.lines().last().filter(|l| !l.is_empty()) {
                log(&format!("agent install {id}: last output: {last}"));
            }
        }
    }
}

/// `--install-agents`: `ids` (or, with none, every installable agent not yet installed) as one batch, within
/// `total`. `KOLUX_INSTALL_AGENTS_ONLY=<id>` (test only) narrows a run with no ids to one agent.
pub fn install_all(ids: &[String], only: Option<&str>, mode: Mode, limit: Duration, total: Duration) {
    let ids: Vec<String> = if !ids.is_empty() {
        ids.to_vec()
    } else {
        CATALOGUE
            .iter()
            .map(|e| e.0)
            .filter(|id| only.is_none_or(|o| o == *id))
            .filter(|id| info_of(id).is_some_and(|a| !a.installed && a.installable))
            .map(String::from)
            .collect()
    };
    locked_batch(&RealHost { app: None }, &ids, mode, limit, Some(total));
}

/// True when the command line asks for the installer's run.
pub fn wants_install(args: &[String]) -> bool {
    args.iter().any(|a| a == "--install-agents")
}

/// `--interactive` (a person at the screen): a runtime install may raise Windows' admin prompt. Without it
/// the run is silent.
pub fn mode_of(args: &[String]) -> Mode {
    if args.iter().any(|a| a == "--interactive") {
        Mode::Interactive
    } else {
        Mode::Silent
    }
}

/// The agent ids on the command line: every word that is not a flag, split at commas (`gemini,cline`).
pub fn ids_of(args: &[String]) -> Vec<String> {
    args.iter().filter(|a| !a.starts_with("--")).flat_map(|a| a.split(',')).map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// The binary's hook: `Some(exit code)` when the flag is there (never opens the window, always 0).
pub fn cli_main(args: &[String]) -> Option<i32> {
    if !wants_install(args) {
        return None;
    }
    let only = std::env::var("KOLUX_INSTALL_AGENTS_ONLY").ok().filter(|v| !v.is_empty());
    install_all(&ids_of(args), only.as_deref(), mode_of(args), LIMIT, TOTAL_LIMIT);
    Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::catalogue;
    use std::collections::HashSet;

    #[test]
    fn every_catalogue_agent_has_a_row_in_catalogue_order() {
        assert_eq!(TABLE.len(), CATALOGUE.len());
        for (row, entry) in TABLE.iter().zip(CATALOGUE.iter()) {
            assert_eq!(row.id, entry.0);
        }
        let none: Vec<&str> = TABLE.iter().filter(|r| r.route.is_none()).map(|r| r.id).collect();
        assert_eq!(none, ["ante", "trae", "rovo"], "the agents with no official Windows route");
    }

    #[test]
    fn npm_rows_need_node_and_uv_rows_need_uv() {
        for r in &TABLE {
            match r.route {
                Some(Route::Npm(_)) => assert_eq!(r.needs, NODE, "{}: npm needs Node", r.id),
                Some(Route::Uv(_)) => assert_eq!(r.needs, Some(Runtime::Uv), "{}", r.id),
                _ => {}
            }
        }
    }

    #[test]
    fn the_winget_line_is_the_frozen_one() {
        assert_eq!(winget_args("Git.Git").join(" "), "install --exact --id Git.Git --silent --accept-package-agreements --accept-source-agreements");
    }

    #[test]
    fn the_tooltip_text_names_the_route() {
        assert_eq!(install_text("cline").as_deref(), Some("npm install -g cline"));
        assert_eq!(install_text("pi").as_deref(), Some("npm install -g --ignore-scripts @earendil-works/pi-coding-agent"));
        assert_eq!(install_text("crush").as_deref(), Some("winget install --exact --id charmbracelet.crush"));
        assert_eq!(install_text("mistral-vibe").as_deref(), Some("uv tool install mistral-vibe"));
        assert!(install_text("claude").unwrap().contains("https://claude.ai/install.ps1"));
        assert_eq!(install_text("ante"), None);
        assert_eq!(install_text("nope"), None);
    }

    #[test]
    fn one_agents_detection_is_the_catalogues_entry_for_it() {
        let all = catalogue();
        for a in &all {
            assert_eq!(info_of(&a.id).as_ref(), Some(a), "{}", a.id);
        }
        assert_eq!(info_of("nope"), None);
    }

    #[test]
    fn the_catalogue_reports_installable_and_the_command() {
        let all = catalogue();
        assert_eq!(all.len(), 35);
        for a in &all {
            assert_eq!(a.installable, a.install.is_some(), "{}", a.id);
        }
        assert_eq!(all.iter().filter(|a| !a.installable).map(|a| a.id.as_str()).collect::<Vec<_>>(), ["ante", "trae", "rovo"]);
    }

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_flag_is_found_anywhere_and_nothing_else_matches() {
        let a = strings;
        assert!(wants_install(&a(&["--install-agents"])));
        assert!(wants_install(&a(&["--x", "--install-agents"])));
        assert!(!wants_install(&a(&[])));
        assert!(!wants_install(&a(&["--install-agent", "--terminal-service"])));
        assert_eq!(cli_main(&a(&["--terminal-service"])), None);
    }

    #[test]
    fn the_installer_flag_picks_the_mode() {
        assert_eq!(mode_of(&strings(&["--install-agents"])), Mode::Silent);
        assert_eq!(mode_of(&strings(&["--install-agents", "--interactive"])), Mode::Interactive);
    }

    #[test]
    fn the_command_line_ids_are_the_words_that_are_not_flags() {
        assert_eq!(ids_of(&strings(&["--install-agents"])), Vec::<String>::new());
        assert_eq!(ids_of(&strings(&["--install-agents", "--interactive", "gemini,cline, codebuff"])), ["gemini", "cline", "codebuff"]);
        assert_eq!(ids_of(&strings(&["gemini", "--install-agents", "aug,,qwen-code"])), ["gemini", "aug", "qwen-code"]);
    }

    #[test]
    fn a_silent_install_never_starts_a_machine_wide_runtime() {
        assert_eq!(silent_refusal(Runtime::Node, Mode::Silent).as_deref(), Some("needs Node.js (install it, then use Install in Kolux)"));
        // uv and Git (T-577) are per-user, so a silent install may install them; an interactive one may install any
        assert_eq!(silent_refusal(Runtime::Uv, Mode::Silent), None);
        assert_eq!(silent_refusal(Runtime::Git, Mode::Silent), None);
        for rt in [Runtime::Node, Runtime::Uv, Runtime::Git] {
            assert_eq!(silent_refusal(rt, Mode::Interactive), None);
        }
    }

    #[test]
    fn uv_is_installed_for_this_user_and_the_others_on_the_frozen_line() {
        assert_eq!(runtime_winget_args(Runtime::Uv).join(" "), "install --exact --id astral-sh.uv --silent --accept-package-agreements --accept-source-agreements --scope user");
        assert_eq!(runtime_winget_args(Runtime::Node), winget_args("OpenJS.NodeJS.LTS"));
        assert_eq!(runtime_winget_args(Runtime::Git).join(" "), "install --exact --id Git.Git --silent --accept-package-agreements --accept-source-agreements --scope user");
    }

    #[test]
    fn the_total_time_also_cuts_one_agents_deadline() {
        let end = Instant::now() + Duration::from_secs(5);
        let c = Ctx::new(Mode::Silent, LIMIT, Some(end));
        assert_eq!(c.clamp(Instant::now() + Duration::from_secs(600)), end);
        let far = Instant::now() + Duration::from_secs(1);
        assert_eq!(Ctx::new(Mode::Silent, LIMIT, None).clamp(far), far);
        assert_eq!(TOTAL_LIMIT, Duration::from_secs(45 * 60));
        assert_eq!(RUNTIME_LIMIT, Duration::from_secs(10 * 60));
        assert_eq!(LIMIT, Duration::from_secs(10 * 60));
    }

    #[test]
    fn installs_run_one_at_a_time() {
        let held = INSTALL_LOCK.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let _g = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "a second install waits while one runs");
        drop(held);
        assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok());
        t.join().unwrap();
    }

    fn powershell() -> PathBuf {
        find_in(&search_dirs(), "powershell").unwrap_or_else(|| PathBuf::from("powershell"))
    }

    #[test]
    fn a_program_that_waits_for_a_person_is_ended_once_the_agent_is_found() {
        let mut tail = String::new();
        let started = Instant::now();
        let asked = std::cell::Cell::new(0);
        let found = || {
            asked.set(asked.get() + 1);
            asked.get() >= 2
        };
        let r = run(&powershell(), &["-NoProfile".into(), "-Command".into(), "Start-Sleep 60".into()], Instant::now() + Duration::from_secs(50), &mut tail, Some(&found));
        assert_eq!(r, Ok(None));
        assert_eq!(asked.get(), 2);
        assert!(started.elapsed() < Duration::from_secs(20), "{:?}", started.elapsed());
        assert!(row_of("devin").unwrap().ends_when_found);
        assert_eq!(TABLE.iter().filter(|r| r.ends_when_found).count(), 1, "only devin ends early");
    }

    #[test]
    fn a_runaway_program_is_stopped_at_the_deadline() {
        let mut tail = String::new();
        let started = Instant::now();
        let r = run(&powershell(), &["-NoProfile".into(), "-Command".into(), "Start-Sleep 30".into()], Instant::now() + Duration::from_millis(500), &mut tail, None);
        assert_eq!(r, Err("The install took longer than its time limit, so Kolux stopped it.".to_string()));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    // ---- T-578: the batch engine, proven on a fake PC (no program is started) ----

    /// A PC that records every program the engine would run and installs what that program names.
    struct Fake {
        installed: Mutex<HashSet<String>>,
        /// Programs present on the PC (the runtimes, winget, powershell).
        have: Mutex<HashSet<String>>,
        /// (kind, arguments) of every run, in start order.
        calls: Mutex<Vec<(String, Vec<String>)>>,
        events: Mutex<Vec<Progress>>,
        reports: Mutex<Vec<(String, bool)>>,
        /// kind -> (running now, most running at once)
        busy: Mutex<HashMap<String, (usize, usize)>>,
        delay: Duration,
        /// An npm call with more than one package ends without installing anything.
        fail_batch: bool,
        /// This agent id never installs.
        never: Option<String>,
        /// T-580: the run is fenced.
        fenced: bool,
        /// T-580: the fake `HKCU\Environment` "Path" (never the real one).
        user_path: Mutex<Option<StoredValue>>,
        /// T-580: every write of the user Path.
        puts: Mutex<Vec<Option<StoredValue>>>,
        /// T-580: a script that runs adds this folder to the user Path, the way OpenClaw's did.
        script_adds: Option<String>,
        /// T-580: what a script's output ends with.
        script_tail: String,
    }

    impl Fake {
        fn new() -> Self {
            Fake {
                installed: Mutex::new(HashSet::new()),
                have: Mutex::new(["npm", "uv", "git", "winget", "powershell"].iter().map(|s| s.to_string()).collect()),
                calls: Mutex::new(Vec::new()),
                events: Mutex::new(Vec::new()),
                reports: Mutex::new(Vec::new()),
                busy: Mutex::new(HashMap::new()),
                delay: Duration::from_millis(0),
                fail_batch: false,
                never: None,
                fenced: false,
                user_path: Mutex::new(None),
                puts: Mutex::new(Vec::new()),
                script_adds: None,
                script_tail: String::new(),
            }
        }
        fn kind_calls(&self, kind: &str) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().iter().filter(|c| c.0 == kind).map(|c| c.1.clone()).collect()
        }
        fn most_at_once(&self, kind: &str) -> usize {
            self.busy.lock().unwrap().get(kind).map(|b| b.1).unwrap_or(0)
        }
        fn states_of(&self, id: &str) -> Vec<State> {
            self.events.lock().unwrap().iter().filter(|p| p.id == id).map(|p| p.state).collect()
        }
        fn install(&self, id: &str) {
            if self.never.as_deref() != Some(id) {
                self.installed.lock().unwrap().insert(id.to_string());
            }
        }
    }

    impl Host for Fake {
        fn info(&self, id: &str) -> Option<AgentInfo> {
            // no disk scan: the fake PC has only what its sets say
            let (id, name, programs, args) = CATALOGUE.iter().find(|e| e.0 == id)?;
            Some(AgentInfo {
                id: id.to_string(),
                name: name.to_string(),
                program: programs[0].to_string(),
                args: args.iter().map(|a| a.to_string()).collect(),
                installed: self.installed.lock().unwrap().contains(*id),
                path: None,
                docs: false,
                installable: install_text(id).is_some(),
                install: install_text(id),
            })
        }
        fn program(&self, name: &str) -> Option<PathBuf> {
            self.have.lock().unwrap().contains(name).then(|| PathBuf::from(name))
        }
        fn run(&self, program: &Path, args: &[String], _deadline: Instant, tail: &mut String, _early: Option<&dyn Fn() -> bool>) -> Result<Option<i32>, String> {
            let kind = program.file_name().unwrap().to_string_lossy().to_string();
            self.calls.lock().unwrap().push((kind.clone(), args.to_vec()));
            {
                let mut busy = self.busy.lock().unwrap();
                let b = busy.entry(kind.clone()).or_insert((0, 0));
                b.0 += 1;
                b.1 = b.1.max(b.0);
            }
            std::thread::sleep(self.delay);
            match kind.as_str() {
                "npm" => {
                    let packages = &args[2..];
                    if !(self.fail_batch && packages.len() > 1) {
                        for p in packages {
                            for r in &TABLE {
                                if matches!(r.route, Some(Route::Npm(a)) if a.contains(&p.as_str())) {
                                    self.install(r.id);
                                }
                            }
                        }
                    }
                }
                "winget" => {
                    let id = &args[args.iter().position(|a| a == "--id").unwrap() + 1];
                    match [Runtime::Node, Runtime::Uv, Runtime::Git].iter().find(|r| r.facts().0 == id) {
                        Some(rt) => {
                            self.have.lock().unwrap().insert(rt.facts().1.to_string());
                        }
                        None => TABLE.iter().filter(|r| matches!(r.route, Some(Route::Winget(w)) if w == id.as_str())).for_each(|r| self.install(r.id)),
                    }
                }
                "uv" => TABLE.iter().filter(|r| matches!(r.route, Some(Route::Uv(p)) if args.contains(&p.to_string()))).for_each(|r| self.install(r.id)),
                _ => {
                    if let Some(dir) = &self.script_adds {
                        let mut path = self.user_path.lock().unwrap();
                        let mut text = path.as_ref().map(|v| String::from_utf8_lossy(&v.data).to_string()).unwrap_or_default();
                        text.push(';');
                        text.push_str(dir);
                        *path = Some(StoredValue { kind: 2, data: text.into_bytes() });
                    }
                    tail.clone_from(&self.script_tail);
                    TABLE.iter().filter(|r| matches!(r.route, Some(Route::Script(s)) if args.last().is_some_and(|l| l.ends_with(s)))).for_each(|r| self.install(r.id))
                }
            }
            self.busy.lock().unwrap().get_mut(&kind).unwrap().0 -= 1;
            Ok(Some(0))
        }
        fn progress(&self, p: Progress) {
            self.events.lock().unwrap().push(p);
        }
        fn report(&self, id: &str, result: &Result<(), String>, _tail: &str) {
            self.reports.lock().unwrap().push((id.to_string(), result.is_ok()));
        }
        fn fenced(&self) -> bool {
            self.fenced
        }
        fn user_path(&self) -> Result<Option<StoredValue>, String> {
            Ok(self.user_path.lock().unwrap().clone())
        }
        fn put_user_path(&self, value: Option<&StoredValue>) -> Result<(), String> {
            self.puts.lock().unwrap().push(value.cloned());
            *self.user_path.lock().unwrap() = value.cloned();
            Ok(())
        }
        fn note(&self, _line: &str) {}
    }

    // ---- T-580: a fenced run puts the user Path back; npm's engine refusal reads plainly ----

    const LEAK: &str = r"G:\Temp\kolux-rs-live\home\AppData\Roaming\npm";

    fn real_path() -> StoredValue {
        StoredValue { kind: 2, data: br"%USERPROFILE%\AppData\Local\Microsoft\WindowsApps;C:\Tools".to_vec() }
    }

    #[test]
    fn a_fenced_batch_puts_back_the_user_path_a_script_changed() {
        let mut f = Fake::new();
        f.fenced = true;
        f.script_adds = Some(LEAK.to_string());
        *f.user_path.lock().unwrap() = Some(real_path());
        let out = run_batch(&f, &owned(&["openclaw"]), ctx());
        assert!(out[0].ok, "{out:?}");
        assert_eq!(f.kind_calls("powershell").len(), 1, "the script ran");
        assert_eq!(*f.user_path.lock().unwrap(), Some(real_path()), "the value exactly as it was");
        assert_eq!(*f.puts.lock().unwrap(), vec![Some(real_path())], "written back once");
    }

    #[test]
    fn a_fenced_batch_with_no_user_path_before_removes_the_one_a_script_made() {
        let mut f = Fake::new();
        f.fenced = true;
        f.script_adds = Some(LEAK.to_string());
        run_batch(&f, &owned(&["openclaw"]), ctx());
        assert_eq!(*f.user_path.lock().unwrap(), None);
        assert_eq!(*f.puts.lock().unwrap(), vec![None]);
    }

    #[test]
    fn a_fenced_batch_that_left_the_user_path_alone_writes_nothing() {
        let mut f = Fake::new();
        f.fenced = true;
        *f.user_path.lock().unwrap() = Some(real_path());
        run_batch(&f, &owned(&["openclaw"]), ctx());
        assert!(f.puts.lock().unwrap().is_empty());
    }

    #[test]
    fn a_release_batch_keeps_what_an_installer_added_to_the_user_path() {
        let mut f = Fake::new();
        f.script_adds = Some(LEAK.to_string());
        *f.user_path.lock().unwrap() = Some(real_path());
        run_batch(&f, &owned(&["openclaw"]), ctx());
        assert!(f.puts.lock().unwrap().is_empty(), "nothing is written in a release run");
        let now = String::from_utf8(f.user_path.lock().unwrap().clone().unwrap().data).unwrap();
        assert!(now.ends_with(LEAK), "{now}");
    }

    #[test]
    fn this_test_run_is_fenced_so_the_real_host_would_put_the_path_back() {
        // `cargo test` is a test build: the real host's answer, without touching the registry.
        assert!(RealHost { app: None }.fenced());
    }

    #[test]
    fn an_npm_engine_refusal_reads_as_needs_a_newer_node() {
        let mut f = Fake::new();
        f.never = Some("openclaw".to_string());
        f.script_tail = "npm error code EBADENGINE\nnpm error engine Unsupported engine\nnpm error notsup Required: {\"node\":\">=24.22.1 <25 || >=26.12.1\"}\nnpm error notsup Actual:   {\"npm\":\"11.6.2\",\"node\":\"v24.19.0\"}\nnpm error A complete log of this run can be found in: C:\\npm.log".to_string();
        let out = run_batch(&f, &owned(&["openclaw"]), ctx());
        assert_eq!(
            out[0].error.as_deref(),
            Some("OpenClaw needs a newer Node.js (>=24.22.1 <25 || >=26.12.1). Update Node.js (winget upgrade OpenJS.NodeJS.LTS), then install again.")
        );
    }

    #[test]
    fn any_other_failure_keeps_the_installer_code_sentence() {
        let mut f = Fake::new();
        f.never = Some("openclaw".to_string());
        f.script_tail = "something else went wrong".to_string();
        let out = run_batch(&f, &owned(&["openclaw"]), ctx());
        assert_eq!(out[0].error.as_deref(), Some("OpenClaw did not finish installing (the installer ended with code 0)."));
    }

    #[test]
    fn the_tail_keeps_the_last_lines_so_an_engine_line_above_the_last_is_seen() {
        let text = (1..=50).map(|n| format!("  line {n}  ")).chain(["".to_string(), "npm error code EBADENGINE".into(), "last".into(), "   ".into()]).collect::<Vec<_>>().join("\r\n");
        let tail = last_lines(&text);
        let lines: Vec<&str> = tail.lines().collect();
        assert_eq!(lines.len(), TAIL_LINES);
        assert_eq!(lines[TAIL_LINES - 2..], ["npm error code EBADENGINE", "last"]);
        assert_eq!(lines[0], "line 13");
    }

    #[test]
    fn a_real_run_hands_back_several_output_lines() {
        let mut tail = String::new();
        let r = run(&powershell(), &["-NoProfile".into(), "-Command".into(), "'npm error code EBADENGINE'; 'npm error A complete log'".into()], Instant::now() + Duration::from_secs(60), &mut tail, None);
        assert_eq!(r, Ok(Some(0)));
        assert_eq!(tail, "npm error code EBADENGINE\nnpm error A complete log");
    }

    fn ctx() -> Ctx {
        Ctx::new(Mode::Interactive, LIMIT, None)
    }

    /// Ids whose route is plain npm (no extra arguments), in catalogue order.
    fn plain_npm() -> Vec<&'static str> {
        TABLE.iter().filter(|r| matches!(r.route, Some(Route::Npm(a)) if !a.iter().any(|x| x.starts_with('-')))).map(|r| r.id).collect()
    }
    fn ids_with(f: fn(&Route) -> bool) -> Vec<&'static str> {
        TABLE.iter().filter(|r| r.route.is_some_and(|route| f(&route))).map(|r| r.id).collect()
    }
    fn owned(v: &[&str]) -> Vec<String> {
        strings(v)
    }

    #[test]
    fn plain_npm_packages_go_in_one_call_and_a_package_with_extra_arguments_gets_its_own() {
        let f = Fake::new();
        let plain = plain_npm();
        assert!(plain.len() >= 3);
        let mut ids: Vec<&str> = plain[..3].to_vec();
        ids.push("pi");
        let out = run_batch(&f, &owned(&ids), ctx());
        let npm = f.kind_calls("npm");
        assert_eq!(npm.len(), 2, "{npm:?}");
        assert_eq!(&npm[0][..2], ["install", "-g"]);
        assert_eq!(npm[0].len(), 2 + 3, "one call with the three plain packages: {:?}", npm[0]);
        assert_eq!(npm[1], ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"], "pi after the batch, alone");
        assert!(out.iter().all(|r| r.ok && r.agent.as_ref().is_some_and(|a| a.installed)), "{out:?}");
        assert_eq!(out.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ids, "results come back in the order asked");
    }

    #[test]
    fn a_failed_npm_batch_is_retried_package_by_package_and_each_agent_has_its_own_end() {
        let mut f = Fake::new();
        f.fail_batch = true;
        let plain = plain_npm();
        f.never = Some(plain[1].to_string());
        let ids: Vec<&str> = plain[..3].to_vec();
        let out = run_batch(&f, &owned(&ids), ctx());
        let npm = f.kind_calls("npm");
        assert_eq!(npm.len(), 1 + 3, "the batch, then one call each: {npm:?}");
        assert_eq!(npm[0].len(), 2 + 3);
        assert!(npm[1..].iter().all(|c| c.len() == 3), "{npm:?}");
        assert_eq!(out.iter().map(|r| r.ok).collect::<Vec<_>>(), [true, false, true]);
        assert!(out[1].error.as_deref().unwrap().contains("did not finish installing"), "{:?}", out[1].error);
        assert_eq!(f.states_of(plain[1]), [State::Queued, State::Installing, State::Failed]);
    }

    #[test]
    fn a_batch_that_installed_everything_is_not_retried() {
        let f = Fake::new();
        let plain = plain_npm();
        run_batch(&f, &owned(&plain[..2]), ctx());
        assert_eq!(f.kind_calls("npm").len(), 1);
    }

    #[test]
    fn at_most_four_scripts_run_at_once() {
        let mut f = Fake::new();
        f.delay = Duration::from_millis(80);
        let scripts = ids_with(|r| matches!(r, Route::Script(_)));
        assert!(scripts.len() >= 9, "{scripts:?}");
        let out = run_batch(&f, &owned(&scripts), ctx());
        assert_eq!(f.kind_calls("powershell").len(), scripts.len());
        assert_eq!(f.most_at_once("powershell"), 4);
        assert!(out.iter().all(|r| r.ok), "{out:?}");
    }

    #[test]
    fn winget_installs_run_one_at_a_time_and_uv_too() {
        let mut f = Fake::new();
        f.delay = Duration::from_millis(60);
        let winget = ids_with(|r| matches!(r, Route::Winget(_)));
        let uv = ids_with(|r| matches!(r, Route::Uv(_)));
        assert!(winget.len() >= 2 && !uv.is_empty(), "{winget:?} {uv:?}");
        let all: Vec<&str> = winget.iter().chain(uv.iter()).copied().collect();
        let out = run_batch(&f, &owned(&all), ctx());
        assert_eq!(f.kind_calls("winget").len(), winget.len());
        assert_eq!(f.kind_calls("uv").len(), uv.len());
        assert_eq!(f.most_at_once("winget"), 1);
        assert_eq!(f.most_at_once("uv"), 1);
        assert!(out.iter().all(|r| r.ok), "{out:?}");
    }

    #[test]
    fn the_four_groups_run_at_the_same_time() {
        let mut f = Fake::new();
        f.delay = Duration::from_millis(300);
        let plain = plain_npm();
        let one = |kind: fn(&Route) -> bool| ids_with(kind)[0];
        let ids = [plain[0], one(|r| matches!(r, Route::Script(_))), one(|r| matches!(r, Route::Winget(_))), one(|r| matches!(r, Route::Uv(_)))];
        let started = Instant::now();
        let out = run_batch(&f, &owned(&ids), ctx());
        assert!(out.iter().all(|r| r.ok), "{out:?}");
        assert!(started.elapsed() < Duration::from_millis(900), "four 300 ms installs overlapped: {:?}", started.elapsed());
    }

    #[test]
    fn progress_goes_queued_then_installing_then_ok_or_failed_for_every_id() {
        let mut f = Fake::new();
        f.never = Some("pi".to_string());
        let plain = plain_npm();
        let script = ids_with(|r| matches!(r, Route::Script(_)))[0];
        let winget = ids_with(|r| matches!(r, Route::Winget(_)))[0];
        let uv = ids_with(|r| matches!(r, Route::Uv(_)))[0];
        let ids = [plain[0], plain[1], "pi", script, winget, uv];
        run_batch(&f, &owned(&ids), ctx());
        for id in ids {
            let want = if id == "pi" { State::Failed } else { State::Ok };
            assert_eq!(f.states_of(id), [State::Queued, State::Installing, want], "{id}");
        }
        let events = f.events.lock().unwrap();
        assert!(events.iter().filter(|p| p.state == State::Failed).all(|p| p.error.is_some()));
        assert!(events.iter().filter(|p| p.state != State::Failed).all(|p| p.error.is_none()));
        // every id also gets its log line
        assert_eq!(f.reports.lock().unwrap().len(), ids.len());
    }

    #[test]
    fn installed_unknown_and_not_installable_ids_come_back_at_once() {
        let f = Fake::new();
        f.install("gemini");
        let out = run_batch(&f, &owned(&["gemini", "ante", "nope"]), ctx());
        assert!(f.calls.lock().unwrap().is_empty(), "nothing was run");
        assert!(out[0].ok && out[0].error.is_none() && out[0].agent.as_ref().is_some_and(|a| a.installed));
        assert!(!out[1].ok && out[1].error.as_deref().unwrap().starts_with("Kolux has no official Windows install for Ante"), "{:?}", out[1]);
        assert!(!out[2].ok && out[2].error.as_deref() == Some("Kolux does not know an agent called nope.") && out[2].agent.is_none());
        assert_eq!(f.states_of("gemini"), [State::Queued, State::Ok]);
        assert_eq!(f.states_of("ante"), [State::Queued, State::Failed]);
        assert_eq!(f.states_of("nope"), [State::Queued, State::Failed]);
    }

    #[test]
    fn a_repeated_id_is_installed_once() {
        let f = Fake::new();
        let out = run_batch(&f, &owned(&["cline", "cline"]), ctx());
        assert_eq!(out.len(), 1);
        assert_eq!(f.kind_calls("npm").len(), 1);
    }

    #[test]
    fn a_missing_runtime_is_installed_first_then_the_groups_run() {
        let f = Fake::new();
        f.have.lock().unwrap().remove("npm");
        f.have.lock().unwrap().remove("uv");
        let uv = ids_with(|r| matches!(r, Route::Uv(_)))[0];
        let out = run_batch(&f, &owned(&["cline", uv]), ctx());
        assert!(out.iter().all(|r| r.ok), "{out:?}");
        let calls = f.calls.lock().unwrap();
        let kinds: Vec<(&str, &str)> = calls.iter().map(|c| (c.0.as_str(), c.1.iter().find(|a| a.contains('.') || a.as_str() == "-g").map(String::as_str).unwrap_or(""))).collect();
        assert_eq!(kinds[0], ("winget", "OpenJS.NodeJS.LTS"), "Node first: {kinds:?}");
        assert_eq!(kinds[1], ("winget", "astral-sh.uv"), "then uv, one after another: {kinds:?}");
        assert!(kinds[2..].iter().all(|k| k.0 != "winget"), "{kinds:?}");
    }

    #[test]
    fn a_silent_batch_ends_the_npm_agents_when_node_is_missing_and_runs_nothing() {
        let f = Fake::new();
        f.have.lock().unwrap().remove("npm");
        let out = run_batch(&f, &owned(&["cline", "gemini"]), Ctx::new(Mode::Silent, LIMIT, None));
        assert!(f.calls.lock().unwrap().is_empty());
        assert!(out.iter().all(|r| !r.ok && r.error.as_deref() == Some("needs Node.js (install it, then use Install in Kolux)")), "{out:?}");
    }

    #[test]
    fn once_the_total_time_ran_out_nothing_more_is_tried() {
        let f = Fake::new();
        let plain = plain_npm();
        let script = ids_with(|r| matches!(r, Route::Script(_)))[0];
        let winget = ids_with(|r| matches!(r, Route::Winget(_)))[0];
        let out = run_batch(&f, &owned(&[plain[0], plain[1], script, winget]), Ctx::new(Mode::Interactive, LIMIT, Some(Instant::now() - Duration::from_secs(1))));
        assert!(f.calls.lock().unwrap().is_empty());
        assert!(out.iter().all(|r| !r.ok && r.error.as_deref() == Some(OUT_OF_TIME)), "{out:?}");
        assert_eq!(f.states_of(plain[0]), [State::Queued, State::Failed]);
    }

    #[test]
    fn the_npm_batch_gets_a_minute_per_extra_package_and_never_more_than_the_total() {
        let c = Ctx::new(Mode::Interactive, LIMIT, Some(Instant::now() + Duration::from_secs(5)));
        let wanted = Instant::now() + c.limit + NPM_EXTRA_PER_PACKAGE * 3;
        assert!(wanted > Instant::now() + Duration::from_secs(12 * 60), "10 minutes + 3 extra minutes");
        assert_eq!(NPM_EXTRA_PER_PACKAGE, Duration::from_secs(60));
        assert!(c.clamp(wanted) <= Instant::now() + Duration::from_secs(5));
    }

    #[test]
    fn a_batch_holds_the_install_lock_for_its_whole_run() {
        let held = INSTALL_LOCK.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let f = Fake::new();
            let out = locked_batch(&f, &owned(&["nope"]), Mode::Interactive, LIMIT, None);
            tx.send(out.len()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "a batch waits while another install runs");
        drop(held);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Ok(1));
        t.join().unwrap();
    }

    #[test]
    fn the_event_and_result_are_camel_case_json() {
        let p = Progress { id: "gemini".into(), state: State::Installing, error: None };
        assert_eq!(serde_json::to_string(&p).unwrap(), r#"{"id":"gemini","state":"installing","error":null}"#);
        let p = Progress { id: "x".into(), state: State::Failed, error: Some("no".into()) };
        assert_eq!(serde_json::to_string(&p).unwrap(), r#"{"id":"x","state":"failed","error":"no"}"#);
        let r = InstallResult { id: "x".into(), ok: false, error: Some("no".into()), agent: None };
        assert_eq!(serde_json::to_string(&r).unwrap(), r#"{"id":"x","ok":false,"error":"no","agent":null}"#);
        assert_eq!(serde_json::to_string(&State::Queued).unwrap(), "\"queued\"");
        assert_eq!(serde_json::to_string(&State::Ok).unwrap(), "\"ok\"");
    }
}
