//! SKILL-017 / SKILL-021: every skill the AIs on this computer can see, for the Skills page.
//!
//! A skill is a folder holding `SKILL.md`, the standard skill file agent CLIs read. Kolux looks in
//! each AI's own skills folder in the home folder (Claude Code, Codex, Grok, Hermes), the shared
//! cross-agent folder (`~/.agents/skills`), the same folders inside the current workspace, the
//! skills of Claude plugins enabled for the project, Codex's plugin cache, and its own built-in
//! guides. Each folder is scanned on a thread of its own with a time limit, so one that hangs
//! becomes an error the user can retry, never a shorter list. When the open project lives in a WSL
//! distribution, that distribution's skill folders are read too, through `wsl::Runner` (T-243-b).

pub mod cli_install;
pub mod installer;
pub mod update;
pub(crate) mod wsl;

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

pub const SKILL_FILE: &str = "SKILL.md";
/// How many folders deep a skills folder is followed (links included) looking for skill folders.
const DEPTH: usize = 4;
/// A folder that has not answered in this long is reported as an error.
const ROOT_LIMIT: Duration = Duration::from_secs(8);
/// Repeated scans within this long share one result (Refresh ignores it).
const CACHE_FOR: Duration = Duration::from_secs(30);
/// Codex's plugin cache is read up to this many skills; past it the root says partial.
const CACHE_LIMIT: usize = 500;
/// Skill files larger than this are not read for a name (the folder name stands in).
const FILE_LIMIT: u64 = 512 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: Option<String>,
    /// Last change of the skill file, in milliseconds since 1970.
    pub updated: Option<u64>,
    /// The skill file; `kolux:<name>` for a guide built into Kolux.
    pub path: String,
    /// home | workspace | bundled | plugin
    pub source: String,
    /// claude | codex | grok | hermes | shared: who reads the folders it was found in.
    pub agents: Vec<String>,
    pub plugin: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub path: String,
    pub label: String,
    pub source: String,
    pub agents: Vec<String>,
    /// scanned | partial | not-found | not-scanned | error
    pub state: String,
    pub count: usize,
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Scan {
    pub skills: Vec<Skill>,
    pub roots: Vec<Root>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Skills,
    CodexCache,
    /// A folder inside a WSL distribution, read by asking the distribution (`Spot::wsl`).
    Wsl,
    /// Tests only: a folder that never answers in time.
    #[cfg(test)]
    Hang,
}

/// One place to look.
#[derive(Clone, Debug)]
struct Spot {
    path: PathBuf,
    label: String,
    source: &'static str,
    agents: Vec<&'static str>,
    plugin: Option<String>,
    kind: Kind,
    skip: Option<String>,
    /// (distribution, folder in it) for `Kind::Wsl`.
    wsl: Option<(String, String)>,
}

impl Spot {
    fn new(path: PathBuf, label: &str, source: &'static str, agents: &[&'static str]) -> Spot {
        Spot { path, label: label.into(), source, agents: agents.to_vec(), plugin: None, kind: Kind::Skills, skip: None, wsl: None }
    }
}

/// What the scan needs from the environment, so tests can point it anywhere.
#[derive(Clone, Debug)]
pub struct Env {
    pub home: PathBuf,
    pub claude: Option<String>,
    pub codex: Option<String>,
    pub grok: Option<String>,
    pub hermes: Option<String>,
    pub local_app_data: Option<PathBuf>,
    pub windows: bool,
}

impl Env {
    pub fn current() -> Env {
        let var = |k: &str| std::env::var(k).ok();
        Env {
            home: var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(std::env::temp_dir),
            claude: var("CLAUDE_CONFIG_DIR"),
            codex: var("CODEX_HOME"),
            grok: var(crate::grok::HOME_ENV),
            hermes: var("HERMES_HOME"),
            local_app_data: var("LOCALAPPDATA").map(PathBuf::from),
            windows: cfg!(windows),
        }
    }
}

/// An AI home-folder override is used only when it is an existing, absolute folder that is not a
/// drive root and has no `..` in it; anything else is ignored (SKILL-021).
fn usable(over: &Option<String>) -> Option<PathBuf> {
    let o = over.as_deref().map(str::trim).filter(|o| !o.is_empty())?;
    let p = PathBuf::from(o);
    let unsafe_path = !p.is_absolute() || p.parent().is_none() || p.components().any(|c| matches!(c, std::path::Component::ParentDir));
    (!unsafe_path && local_dir(&p)).then_some(p)
}

fn claude_home(env: &Env) -> PathBuf {
    usable(&env.claude).unwrap_or_else(|| env.home.join(".claude"))
}

fn codex_home(env: &Env) -> PathBuf {
    usable(&env.codex).unwrap_or_else(|| env.home.join(".codex"))
}

/// Hermes: `HERMES_HOME`; on Windows the local app-data folder, or for older installs the hidden
/// folder in home; when both exist the app-data folder wins.
fn hermes_home(env: &Env) -> PathBuf {
    if let Some(h) = usable(&env.hermes) {
        return h;
    }
    let legacy = env.home.join(".hermes");
    match (&env.local_app_data, env.windows) {
        (Some(local), true) => {
            let app = local.join("hermes");
            if local_dir(&app) || !local_dir(&legacy) {
                app
            } else {
                legacy
            }
        }
        _ => legacy,
    }
}

fn is_wsl(p: &Path) -> bool {
    let s = p.to_string_lossy().to_lowercase().replace('/', "\\");
    s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") || s.starts_with("\\\\?\\unc\\wsl")
}

/// The skill folders of one WSL distribution: its home and the project folder inside it.
fn wsl_spots(distro: &str, project: &str) -> Vec<Spot> {
    let mut out = vec![];
    let mut add = |dir: String, label: String, source: &'static str, agents: &[&'static str]| {
        let mut s = Spot::new(PathBuf::from(format!("{distro}:{dir}")), &label, source, agents);
        s.kind = Kind::Wsl;
        s.wsl = Some((distro.to_string(), dir));
        out.push(s);
    };
    for (rel, name, agents) in [(".claude", "Claude Code", &["claude"][..]), (".codex", "Codex", &["codex"]), (".agents", "Shared skills folder", &["shared", "codex"]), (".grok", "Grok", &["grok"]), (".hermes", "Hermes", &["hermes"])] {
        add(format!("~/{rel}/skills"), format!("WSL {distro}: {name}"), "home", agents);
    }
    let base = project.trim_end_matches('/');
    for (rel, name, agents) in [(".claude", "Claude Code", &["claude"][..]), (".agents", "shared skills folder", &["shared", "codex"]), (".grok", "Grok", &["grok"])] {
        add(format!("{base}/{rel}/skills"), format!("WSL {distro} workspace: {name}"), "workspace", agents);
    }
    out
}

/// The skill folders in the user's home, without the plugin folders: nothing here reads a file.
fn home_spots(env: &Env) -> Vec<Spot> {
    let claude = claude_home(env);
    let codex = codex_home(env);
    let grok = crate::grok::home(usable(&env.grok).as_deref().and_then(Path::to_str), Some(&env.home)).unwrap_or_else(|| env.home.join(".grok"));
    vec![
        Spot::new(claude.join("skills"), "Claude Code", "home", &["claude"]),
        Spot::new(codex.join("skills"), "Codex", "home", &["codex"]),
        Spot::new(env.home.join(".agents").join("skills"), "Shared skills folder", "home", &["shared", "codex"]),
        Spot::new(grok.join("skills"), "Grok", "home", &["grok"]),
        Spot::new(hermes_home(env).join("skills"), "Hermes", "home", &["hermes"]),
    ]
}

/// FIX-6 (4): the home skill folders a start-up delete recovery may act on, one per real folder,
/// found without reading any file (the plugin list is not needed and would read settings files).
pub fn home_roots(env: &Env) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    home_spots(env).into_iter().map(|s| s.path).filter(|p| seen.insert(key(p))).collect()
}

/// The folders inside a workspace that hold skills: `<workspace>/<one of these>/skills`.
const WORKSPACE_SKILL_DIRS: [&str; 3] = [".claude", ".agents", ".grok"];

/// FIX-6 (4): `p` has the shape of a workspace skills folder (`.../.claude/skills`, `.../.agents/skills`
/// or `.../.grok/skills`), as a delete record may name one from a workspace that is not open now.
pub fn workspace_skills_shape(p: &Path) -> bool {
    let name = |q: &Path| q.file_name().and_then(|n| n.to_str()).map(str::to_lowercase);
    name(p).as_deref() == Some("skills") && p.parent().and_then(name).is_some_and(|up| WORKSPACE_SKILL_DIRS.contains(&up.as_str()))
}

/// Every place to look, in the order the folders popover lists them.
fn spots(env: &Env, workspace: Option<&Path>) -> Vec<Spot> {
    let claude = claude_home(env);
    let codex = codex_home(env);
    let mut out = home_spots(env);
    match workspace {
        Some(ws) => {
            if let Some((distro, linux)) = wsl::split(ws) {
                // The project lives in a distribution: that distribution's own home and project
                // folders are asked of it (T-243-b); the Windows-side share path is never walked.
                out.extend(wsl_spots(&distro, &linux));
            } else {
                // When the workspace is the home folder it is scanned as a repo too.
                let [c, a, g] = WORKSPACE_SKILL_DIRS;
                let mut repo = vec![
                    Spot::new(ws.join(c).join("skills"), "Workspace: Claude Code", "workspace", &["claude"]),
                    Spot::new(ws.join(a).join("skills"), "Workspace: shared skills folder", "workspace", &["shared", "codex"]),
                    Spot::new(ws.join(g).join("skills"), "Workspace: Grok", "workspace", &["grok"]),
                ];
                if is_wsl(ws) {
                    for s in &mut repo {
                        s.skip = Some("The WSL distribution name could not be read".into());
                    }
                }
                out.extend(repo);
            }
        }
        None => {
            let mut s = Spot::new(PathBuf::new(), "Current workspace", "workspace", &[]);
            s.skip = Some("No workspace is open".into());
            out.push(s);
        }
    }
    out.extend(claude_plugins(&claude, workspace));
    let mut cache = Spot::new(codex.join("plugins").join("cache"), "Codex plugins", "plugin", &["codex"]);
    cache.kind = Kind::CodexCache;
    out.push(cache);
    out
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    if remote_path(p) {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn same_dir(a: &str, b: &Path) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(&b.to_string_lossy())
}

/// SKILL-021: only plugins enabled for the project add skills, from the plugin version in effect
/// (an install for this project wins over the one for the user).
fn claude_plugins(claude: &Path, workspace: Option<&Path>) -> Vec<Spot> {
    let mut enabled: HashMap<String, bool> = HashMap::new();
    let mut files = vec![claude.join("settings.json")];
    if let Some(ws) = workspace {
        files.push(ws.join(".claude").join("settings.json"));
        files.push(ws.join(".claude").join("settings.local.json"));
    }
    for f in files {
        if let Some(map) = read_json(&f).and_then(|v| v.get("enabledPlugins").and_then(|m| m.as_object().cloned())) {
            for (id, on) in map {
                enabled.insert(id, on.as_bool().unwrap_or(false));
            }
        }
    }
    let Some(installed) = read_json(&claude.join("plugins").join("installed_plugins.json")) else { return vec![] };
    let Some(plugins) = installed.get("plugins").and_then(|p| p.as_object()) else { return vec![] };
    let mut ids: Vec<&String> = enabled.iter().filter(|(_, on)| **on).map(|(id, _)| id).collect();
    ids.sort();
    let mut out = vec![];
    for id in ids {
        let Some(entries) = plugins.get(id).and_then(|e| e.as_array()) else { continue };
        let for_project = entries.iter().find(|e| {
            e.get("scope").and_then(|s| s.as_str()).is_some_and(|s| s == "project" || s == "local")
                && workspace.is_some_and(|ws| e.get("projectPath").and_then(|p| p.as_str()).is_some_and(|p| same_dir(p, ws)))
        });
        let for_user = entries.iter().find(|e| e.get("scope").and_then(|s| s.as_str()).is_none_or(|s| s == "user"));
        let Some(path) = for_project.or(for_user).and_then(|e| e.get("installPath")).and_then(|p| p.as_str()) else { continue };
        let name = id.split('@').next().unwrap_or(id);
        let mut s = Spot::new(PathBuf::from(path).join("skills"), &format!("Claude plugin: {name}"), "plugin", &["claude"]);
        s.plugin = Some(name.to_string());
        out.push(s);
    }
    out
}

/// What a walk found: skill folders, and whether something went wrong partway.
#[derive(Default)]
struct Walk {
    found: Vec<PathBuf>,
    errors: Vec<String>,
    stopped: bool,
    /// Set once the scan stopped waiting for this folder, so a walk past the time limit ends.
    cancel: Arc<AtomicBool>,
}

/// Links followed at most while judging one path; past that the path counts as remote (a loop).
const HOPS: u32 = 16;

/// A link or junction whose target, at any hop, is on another computer. Reading through it makes
/// Windows sign in to that machine with the user's credentials (NTLM), so it is never followed.
/// Each hop target is judged whole: its text first, then every folder above it from the top down.
/// ponytail: a link swapped for another between this check and the read that follows it is not
/// caught (TOCTOU); opening with FILE_FLAG_OPEN_REPARSE_POINT would close that if it matters.
fn remote_link(p: &Path) -> bool {
    let mut hops = HOPS;
    remote_hop(p, &mut hops)
}

/// A path on another computer: its text names a share, or one of its folders (or itself) is a
/// link whose target is. The text is judged before any disk call, so a share is never touched.
fn remote_path(p: &Path) -> bool {
    let mut hops = HOPS;
    remote_path_in(p, &mut hops)
}

fn remote_hop(p: &Path, hops: &mut u32) -> bool {
    let Ok(m) = std::fs::symlink_metadata(p) else { return false };
    if !m.file_type().is_symlink() {
        return false;
    }
    if *hops == 0 {
        return true;
    }
    *hops -= 1;
    let Ok(t) = std::fs::read_link(p) else { return true };
    let next = if t.is_absolute() { t } else { p.parent().map(|d| d.join(&t)).unwrap_or(t) };
    remote_path_in(&next, hops)
}

fn remote_path_in(p: &Path, hops: &mut u32) -> bool {
    if crate::links::host_path(&p.to_string_lossy(), &[]) {
        return true;
    }
    let mut cur = PathBuf::new();
    for c in p.components() {
        cur.push(c);
        if matches!(c, std::path::Component::Normal(_)) && remote_hop(&cur, hops) {
            return true;
        }
    }
    false
}

/// A folder that is on this computer and exists; a share is refused by its text, never probed.
fn local_dir(p: &Path) -> bool {
    !remote_path(p) && p.is_dir()
}

fn canon(p: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(p).ok()
}

/// Skill folders under `dir`, following links without looping and only `depth` folders down.
fn walk(dir: &Path, depth: usize, seen: &mut HashSet<PathBuf>, limit: usize, w: &mut Walk) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            w.errors.push(format!("{}: {e}", dir.display()));
            return;
        }
    };
    let mut kids: Vec<PathBuf> = vec![];
    for entry in entries {
        match entry {
            Ok(e) => kids.push(e.path()),
            Err(e) => w.errors.push(format!("{}: {e}", dir.display())),
        }
    }
    kids.sort();
    for p in kids {
        if w.cancel.load(Ordering::Relaxed) {
            w.stopped = true;
            return;
        }
        if remote_link(&p) {
            continue;
        }
        if w.found.len() >= limit {
            w.stopped = true;
            return;
        }
        // SKILL-023: a folder or link set aside by an unfinished delete is not a skill.
        if p.file_name().and_then(|n| n.to_str()).is_some_and(crate::skill_delete::is_set_aside) {
            continue;
        }
        // A broken link is not a skill and not a failure.
        let Ok(meta) = std::fs::metadata(&p) else { continue };
        if !meta.is_dir() {
            continue;
        }
        let Some(c) = canon(&p) else { continue };
        if !seen.insert(c) {
            continue;
        }
        // SKILL.md itself may be a link to a share (a cloned repo can commit one): judged first.
        let file = p.join(SKILL_FILE);
        if remote_link(&file) {
            continue;
        }
        if file.is_file() {
            w.found.push(p);
        } else if depth > 0 {
            walk(&p, depth - 1, seen, limit, w);
        }
    }
}

fn newest_child(dir: &Path) -> Option<PathBuf> {
    let mut kids: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| !remote_link(&e.path()) && e.path().is_dir())
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), e.path()))
        .collect();
    kids.sort();
    kids.pop().map(|(_, p)| p)
}

/// One spot's answer: the skill folders, its state and a note.
fn scan_spot(spot: &Spot, cancel: &Arc<AtomicBool>) -> (Vec<PathBuf>, &'static str, Option<String>) {
    if let Some(why) = &spot.skip {
        return (vec![], "not-scanned", Some(why.clone()));
    }
    if remote_path(&spot.path) {
        return (vec![], "not-scanned", Some("This folder links to another computer, which Kolux never opens".into()));
    }
    if !spot.path.is_dir() {
        return (vec![], "not-found", None);
    }
    let mut seen = HashSet::new();
    if let Some(c) = canon(&spot.path) {
        seen.insert(c);
    }
    let mut w = Walk { cancel: cancel.clone(), ..Walk::default() };
    match spot.kind {
        Kind::Skills => walk(&spot.path, DEPTH, &mut seen, usize::MAX, &mut w),
        // <cache>/<marketplace>/<plugin>/<version>/[skills/]<skill>: the newest version of each plugin.
        Kind::CodexCache => {
            let markets: Vec<PathBuf> = std::fs::read_dir(&spot.path).map(|r| r.flatten().map(|e| e.path()).filter(|p| !remote_link(p) && p.is_dir()).collect()).unwrap_or_default();
            'all: for m in markets {
                let plugins: Vec<PathBuf> = std::fs::read_dir(&m).map(|r| r.flatten().map(|e| e.path()).filter(|p| !remote_link(p) && p.is_dir()).collect()).unwrap_or_default();
                for p in plugins {
                    let Some(v) = newest_child(&p) else { continue };
                    let skills = v.join("skills");
                    if remote_link(&skills) {
                        continue;
                    }
                    let base = if skills.is_dir() { skills } else { v };
                    walk(&base, 1, &mut seen, CACHE_LIMIT, &mut w);
                    if w.stopped {
                        break 'all;
                    }
                }
            }
        }
        // Asked of the distribution by `scan_wsl`, never walked on this disk.
        Kind::Wsl => {}
        #[cfg(test)]
        Kind::Hang => {
            let end = Instant::now() + Duration::from_secs(3);
            while Instant::now() < end && !cancel.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(10));
            }
            if cancel.load(Ordering::Relaxed) {
                tests::HANG_STOPPED.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
    if !w.errors.is_empty() {
        let n = w.errors.len();
        return (w.found, "error", Some(if n == 1 { w.errors.remove(0) } else { format!("{} and {} more", w.errors[0], n - 1) }));
    }
    if w.stopped {
        return (w.found, "partial", Some(format!("Stopped after {CACHE_LIMIT} skills; the rest of the cache was not read")));
    }
    (w.found, "scanned", None)
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    let q = v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')));
    if q {
        v[1..v.len() - 1].replace("\\\"", "\"").replace("''", "'")
    } else {
        v.to_string()
    }
}

/// A skill's name and description: the front matter's `name` and `description`, or failing that
/// the first heading and the first paragraph; the folder name when there is neither.
pub fn describe(text: &str, folder: &str) -> (String, Option<String>) {
    let text = text.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = text.lines().collect();
    let mut name = None;
    let mut desc = None;
    let mut body_from = 0;
    if lines.first().is_some_and(|l| l.trim_end() == "---") {
        if let Some(end) = lines.iter().skip(1).position(|l| l.trim_end() == "---") {
            let head = &lines[1..end + 1];
            body_from = end + 2;
            let mut i = 0;
            while i < head.len() {
                let line = head[i];
                if let Some((k, v)) = line.split_once(':').filter(|_| !line.starts_with([' ', '\t'])) {
                    let v = v.trim();
                    let value = if matches!(v, "|" | ">" | "|-" | ">-" | "|+" | ">+") {
                        let mut parts = vec![];
                        while i + 1 < head.len() && (head[i + 1].starts_with([' ', '\t']) || head[i + 1].trim().is_empty()) {
                            i += 1;
                            if !head[i].trim().is_empty() {
                                parts.push(head[i].trim());
                            }
                        }
                        parts.join(" ")
                    } else {
                        unquote(v)
                    };
                    match k.trim() {
                        "name" if !value.is_empty() => name = Some(value),
                        "description" if !value.is_empty() => desc = Some(value),
                        _ => {}
                    }
                }
                i += 1;
            }
        }
    }
    let body = &lines[body_from.min(lines.len())..];
    if name.is_none() {
        name = body.iter().find_map(|l| l.trim().strip_prefix("# ").map(|h| h.trim().to_string())).filter(|h| !h.is_empty());
    }
    if desc.is_none() {
        let mut para: Vec<&str> = vec![];
        for l in body {
            let t = l.trim();
            if t.starts_with('#') || t.starts_with("```") {
                if para.is_empty() {
                    continue;
                }
                break;
            }
            if t.is_empty() {
                if para.is_empty() {
                    continue;
                }
                break;
            }
            para.push(t);
        }
        let p = para.join(" ");
        if !p.is_empty() {
            desc = Some(if p.chars().count() > 300 { format!("{}…", p.chars().take(299).collect::<String>()) } else { p });
        }
    }
    (name.unwrap_or_else(|| folder.to_string()), desc)
}

fn read_skill(dir: &Path) -> (String, Option<String>, Option<u64>) {
    let file = dir.join(SKILL_FILE);
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if remote_link(&file) {
        return (folder, None, None);
    }
    let meta = std::fs::metadata(&file).ok();
    let updated = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64);
    let text = if meta.is_some_and(|m| m.len() <= FILE_LIMIT) { std::fs::read_to_string(&file).unwrap_or_default() } else { String::new() };
    let (name, desc) = describe(&text, &folder);
    (name, desc, updated)
}

/// The same folder however it was reached: through links, and on Windows without case.
pub(crate) fn key(p: &Path) -> String {
    let c = canon(p).unwrap_or_else(|| p.to_path_buf());
    let s = c.to_string_lossy().to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// A path as the list prints it, without the long-path prefix.
pub(crate) fn plain(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix("\\\\?\\").map(str::to_string).unwrap_or(s)
}

/// A skill folder read: its folder, name, description, last change and, when the folder is not on
/// this disk, the key that lists it once however it was reached.
type Read = Vec<(PathBuf, String, Option<String>, Option<u64>, Option<String>)>;

/// T-243-b: one folder of a WSL distribution, asked through the runner. An answer that cannot be
/// read, or a distribution that cannot be reached, is an error root; a missing folder is not-found.
fn scan_wsl(spot: &Spot, runner: &dyn wsl::Runner, cancel: &Arc<AtomicBool>) -> (Read, &'static str, Option<String>) {
    let Some((distro, dir)) = &spot.wsl else { return (vec![], "error", Some("No WSL folder named".into())) };
    match runner.run(distro, dir, cancel).and_then(|b| wsl::parse(&b)) {
        Err(e) => (vec![], "error", Some(e)),
        Ok(wsl::Answer::NotFound) => (vec![], "not-found", None),
        Ok(wsl::Answer::Skills(list)) => {
            let mut seen = HashSet::new();
            let mut out: Read = vec![];
            for f in list {
                let folder = f.dir.rsplit('/').next().unwrap_or("").to_string();
                if crate::skill_delete::is_set_aside(&folder) || f.dir.split('/').any(crate::skill_delete::is_set_aside) || !seen.insert(f.real.clone()) {
                    continue;
                }
                let (name, desc) = if f.text.len() as u64 <= FILE_LIMIT { describe(&f.text, &folder) } else { (folder, None) };
                out.push((wsl::unc(distro, &f.dir), name, desc, f.updated, Some(format!("wsl:{}:{}", distro.to_lowercase(), f.real))));
            }
            (out, "scanned", None)
        }
    }
}

/// Scan every spot at once, each on its own thread with a time limit. WSL is unavailable here; the
/// real scan (`scan`) and the tests of the WSL roots pass a runner to `run_with`.
#[cfg(test)]
fn run(spots: Vec<Spot>, bundled: &[(&str, &str)], limit: Duration) -> Scan {
    run_with(spots, bundled, limit, Arc::new(wsl::Unavailable))
}

fn run_with(spots: Vec<Spot>, bundled: &[(&str, &str)], limit: Duration, runner: Arc<dyn wsl::Runner>) -> Scan {
    let (tx, rx) = mpsc::channel();
    let cancel = Arc::new(AtomicBool::new(false));
    for (i, s) in spots.iter().enumerate() {
        let tx = tx.clone();
        let s = s.clone();
        let cancel = cancel.clone();
        let runner = runner.clone();
        std::thread::spawn(move || {
            if s.kind == Kind::Wsl {
                let (read, state, note) = scan_wsl(&s, &*runner, &cancel);
                let _ = tx.send((i, read, state, note));
                return;
            }
            let answer = scan_spot(&s, &cancel);
            let read: Read = answer
                .0
                .iter()
                .map(|d| {
                    let (n, de, u) = read_skill(d);
                    (d.clone(), n, de, u, None)
                })
                .collect();
            let _ = tx.send((i, read, answer.1, answer.2));
        });
    }
    drop(tx);
    let deadline = Instant::now() + limit;
    let mut answers: Vec<Option<_>> = vec![None; spots.len()];
    while answers.iter().any(Option::is_none) {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok((i, read, state, note)) => answers[i] = Some((read, state, note)),
            Err(_) => break,
        }
    }
    // Threads still walking past the limit stop at their next folder entry instead of running on.
    cancel.store(true, Ordering::Relaxed);
    let mut skills: Vec<Skill> = vec![];
    let mut by_key: HashMap<String, usize> = HashMap::new();
    let mut roots = vec![];
    for (s, a) in spots.iter().zip(answers) {
        let agents: Vec<String> = s.agents.iter().map(|a| a.to_string()).collect();
        let Some((read, state, note)) = a else {
            roots.push(Root { path: plain(&s.path), label: s.label.clone(), source: s.source.into(), agents, state: "error".into(), count: 0, note: Some(format!("Took longer than {} seconds", limit.as_secs())) });
            continue;
        };
        roots.push(Root { path: plain(&s.path), label: s.label.clone(), source: s.source.into(), agents: agents.clone(), state: state.into(), count: read.len(), note });
        for (dir, name, description, updated, own_key) in read {
            // A skill reached from several roots (through a link, say) is listed once.
            let k = own_key.unwrap_or_else(|| key(&dir));
            if let Some(&at) = by_key.get(&k) {
                for a in &agents {
                    if !skills[at].agents.contains(a) {
                        skills[at].agents.push(a.clone());
                    }
                }
                continue;
            }
            by_key.insert(k, skills.len());
            skills.push(Skill { name, description, updated, path: plain(&dir.join(SKILL_FILE)), source: s.source.into(), agents: agents.clone(), plugin: s.plugin.clone() });
        }
    }
    for (name, guide) in bundled {
        let (n, d) = describe(guide, name);
        skills.push(Skill { name: n, description: d, updated: None, path: format!("kolux:{name}"), source: "bundled".into(), agents: vec![], plugin: None });
    }
    roots.push(Root { path: "kolux".into(), label: "Built into Kolux".into(), source: "bundled".into(), agents: vec![], state: "scanned".into(), count: bundled.len(), note: None });
    skills.sort_by_key(|s| s.name.to_lowercase());
    Scan { skills, roots }
}

pub fn scan(env: &Env, workspace: Option<&Path>) -> Scan {
    run_with(spots(env, workspace), &crate::cli::bundled_skills(), ROOT_LIMIT, Arc::new(wsl::Real))
}

/// SKILL-022: where a delete may act. `deletable` are the home and workspace skills folders that
/// were scanned; `plugin` are the folders plugins put skills in (never deleted from here);
/// `wsl_roots` are (distribution, skill folder in it) for the distribution the open project lives
/// in (T-180-b), where a delete runs inside the distribution instead of through the share.
pub struct Places {
    pub deletable: Vec<PathBuf>,
    pub plugin: Vec<PathBuf>,
    pub wsl_roots: Vec<(String, String)>,
}

pub fn places(env: &Env, workspace: Option<&Path>) -> Places {
    let all = spots(env, workspace);
    // One root per real folder: the home folder opened as the workspace, or a skills folder that
    // is a link to another, would otherwise list every skill in it twice.
    let mut seen = HashSet::new();
    let deletable = all
        .iter()
        .filter(|s| s.kind == Kind::Skills && s.skip.is_none() && matches!(s.source, "home" | "workspace"))
        .map(|s| s.path.clone())
        .filter(|p| seen.insert(key(p)))
        .collect();
    let plugin = all.iter().filter(|s| s.source == "plugin").map(|s| s.path.clone()).collect();
    let wsl_roots = all.iter().filter(|s| s.kind == Kind::Wsl && s.skip.is_none() && matches!(s.source, "home" | "workspace")).filter_map(|s| s.wsl.clone()).collect();
    Places { deletable, plugin, wsl_roots }
}

/// SKILL-022: every skill folder under `root`, links included, without the scan's merging: a link
/// and the folder it points at are both listed, so a delete can take both. Links are followed only
/// `DEPTH` folders down and never back into a folder they came from. A folder that cannot be read
/// is an error, so a delete never works from a short list.
pub fn occurrences(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn every(dir: &Path, depth: usize, chain: &mut Vec<PathBuf>, out: &mut Vec<PathBuf>) -> Result<(), String> {
        let mut kids: Vec<PathBuf> = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?.map(|e| e.map(|e| e.path()).map_err(|e| format!("{}: {e}", dir.display()))).collect::<Result<_, _>>()?;
        kids.sort();
        for p in kids {
            if remote_link(&p) || p.file_name().and_then(|n| n.to_str()).is_some_and(crate::skill_delete::is_set_aside) || !p.is_dir() {
                continue;
            }
            let Some(c) = canon(&p) else { continue };
            if chain.contains(&c) {
                continue;
            }
            let file = p.join(SKILL_FILE);
            if remote_link(&file) {
                continue;
            }
            if file.is_file() {
                out.push(p);
            } else if depth > 0 {
                chain.push(c);
                every(&p, depth - 1, chain, out)?;
                chain.pop();
            }
        }
        Ok(())
    }
    let mut out = vec![];
    // A share is never opened, so it holds nothing a delete may take.
    if !local_dir(root) {
        return Ok(out);
    }
    let mut chain: Vec<PathBuf> = canon(root).into_iter().collect();
    every(root, DEPTH, &mut chain, &mut out)?;
    Ok(out)
}

/// SKILL-022: a finished delete makes the next list a fresh scan.
pub fn forget_scans() {
    if let Ok(mut g) = CACHE.lock() {
        *g = None;
    }
}

static CACHE: Mutex<Option<HashMap<String, (Instant, Scan)>>> = Mutex::new(None);
static SCANNING: Mutex<()> = Mutex::new(());

/// Repeated scans of the same workspace are merged and cached; `refresh` forces a new one.
pub fn scan_cached(workspace: Option<String>, refresh: bool) -> Scan {
    let k = workspace.clone().unwrap_or_default();
    let fresh = |c: &Mutex<Option<HashMap<String, (Instant, Scan)>>>| c.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(&k)).filter(|(at, _)| at.elapsed() < CACHE_FOR).map(|(_, s)| s.clone()));
    if !refresh {
        if let Some(s) = fresh(&CACHE) {
            return s;
        }
    }
    let _one = SCANNING.lock();
    // A scan that finished while this one waited answers it, unless this is a Refresh.
    if !refresh {
        if let Some(s) = fresh(&CACHE) {
            return s;
        }
    }
    let s = scan(&Env::current(), workspace.as_deref().map(Path::new));
    if let Ok(mut g) = CACHE.lock() {
        g.get_or_insert_with(HashMap::new).insert(k, (Instant::now(), s.clone()));
    }
    s
}

#[tauri::command]
pub async fn skills_scan(workspace: Option<String>, refresh: bool) -> Result<Scan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_cached(workspace, refresh)).await.map_err(|e| e.to_string())
}

/// SKILL-020: Reveal file opens only a skill file the list shows, on this computer and still there;
/// a bundled skill (no file) or any other path is refused.
fn revealable(scan: &Scan, path: &str) -> Result<PathBuf, String> {
    let s = scan.skills.iter().find(|s| s.path == path).ok_or("That skill is not in the list any more; refresh first")?;
    if s.source == "bundled" {
        return Err("Built into Kolux; there is no file on disk".into());
    }
    let p = PathBuf::from(&s.path);
    if remote_path(&p) || remote_link(&p) || !p.is_file() {
        return Err("That skill file is no longer on disk; refresh first".into());
    }
    Ok(p)
}

#[tauri::command]
pub async fn skills_reveal(workspace: Option<String>, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || revealable(&scan_cached(workspace, false), &path).and_then(|p| crate::links::reveal(&p))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;
    use std::fs;

    fn skill(dir: &Path, text: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(SKILL_FILE), text).unwrap();
    }

    fn env(home: &Path) -> Env {
        Env { home: home.to_path_buf(), claude: None, codex: None, grok: None, hermes: None, local_app_data: Some(home.join("AppData").join("Local")), windows: true }
    }

    fn link_dir(link: &Path, target: &Path) {
        #[cfg(windows)]
        {
            let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
            assert!(ok, "could not make a junction");
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[test]
    fn front_matter_gives_name_and_description() {
        let (n, d) = describe("---\nname: \"pdf-tools\"\ndescription: >\n  Reads PDFs\n  and fills forms.\n---\n# Ignored\n", "folder");
        assert_eq!(n, "pdf-tools");
        assert_eq!(d.as_deref(), Some("Reads PDFs and fills forms."));
    }

    #[test]
    fn no_front_matter_takes_first_heading_and_paragraph() {
        let (n, d) = describe("\u{feff}\n# Release notes\n\nWrites the release notes\nfrom the git log.\n\nMore.", "rn");
        assert_eq!(n, "Release notes");
        assert_eq!(d.as_deref(), Some("Writes the release notes from the git log."));
        let (n, d) = describe("", "bare");
        assert_eq!((n.as_str(), d), ("bare", None));
    }

    #[test]
    fn link_loop_completes_and_lists_each_skill_once() {
        let home = temp("skills-loop");
        let root = home.join(".claude").join("skills");
        skill(&root.join("alpha"), "---\nname: alpha\n---\n");
        skill(&root.join("team").join("beta"), "# beta\n");
        link_dir(&root.join("team").join("back"), &root);
        link_dir(&root.join("again"), &root.join("alpha"));
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta"]);
        let claude = s.roots.iter().find(|r| r.label == "Claude Code").unwrap();
        assert_eq!((claude.state.as_str(), claude.count), ("scanned", 2));
    }

    /// Hang folders that saw the cancel flag and stopped (the cancel test reads it).
    pub(super) static HANG_STOPPED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    /// A link made with a target that never resolves; None where this account may not make links.
    fn share_link(link: &Path) -> Option<()> {
        #[cfg(windows)]
        return std::os::windows::fs::symlink_dir(r"\\kolux-unc-test.invalid\share\skills", link).ok();
        #[cfg(not(windows))]
        return std::os::unix::fs::symlink("//kolux-unc-test.invalid/share/skills", link).ok();
    }

    /// `share_link`, but a skip is never silent: only a missing symbolic-link right (Windows
    /// error 1314, Developer Mode off) skips, and says so on stderr (shown with --nocapture);
    /// any other failure fails the test.
    fn share_link_or_say_why(link: &Path, test: &str) -> bool {
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(r"\\kolux-unc-test.invalid\share\skills", link);
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink("//kolux-unc-test.invalid/share/skills", link);
        match made {
            Ok(()) => true,
            Err(e) if e.raw_os_error() == Some(1314) => {
                eprintln!("SKIPPED {test}: its share-link half did not run, this account cannot make symbolic links ({e}); turn on Developer Mode to run it");
                false
            }
            Err(e) => panic!("{test}: the share link could not be made: {e}"),
        }
    }

    #[test]
    fn skill020_reveal_opens_only_a_listed_skill_file_still_on_disk() {
        let home = temp("skills-reveal");
        let root = home.join(".claude").join("skills");
        skill(&root.join("alpha"), "# alpha\n");
        skill(&root.join("beta"), "# beta\n");
        let s = run(spots(&env(&home), None), &[("orchestration", "# o\n")], ROOT_LIMIT);
        let alpha = s.skills.iter().find(|k| k.name == "alpha").unwrap().path.clone();
        assert!(same_file(&revealable(&s, &alpha).unwrap(), &root.join("alpha").join(SKILL_FILE)));
        // A bundled skill has no file; a path the list does not show is refused even if it exists.
        let bundled = s.skills.iter().find(|k| k.source == "bundled").unwrap().path.clone();
        assert!(revealable(&s, &bundled).unwrap_err().contains("no file on disk"));
        let elsewhere = home.join("notes.txt");
        fs::write(&elsewhere, "x").unwrap();
        assert!(revealable(&s, &elsewhere.to_string_lossy()).unwrap_err().contains("refresh first"));
        // Gone since the list loaded.
        let beta = s.skills.iter().find(|k| k.name == "beta").unwrap().path.clone();
        fs::remove_dir_all(root.join("beta")).unwrap();
        assert!(revealable(&s, &beta).unwrap_err().contains("no longer on disk"));
    }

    fn same_file(a: &Path, b: &Path) -> bool {
        canon(a).is_some() && canon(a) == canon(b)
    }

    #[test]
    fn skill022_a_delete_never_lists_a_skill_reached_through_a_share() {
        let home = temp("skills-unc-delete");
        let root = home.join(".claude").join("skills");
        skill(&root.join("alpha"), "# alpha\n");
        let began = Instant::now();
        // A share root is refused by its text: nothing to delete there, and nothing waited on.
        assert_eq!(occurrences(Path::new(r"\\kolux-unc-test.invalid\share\skills")).unwrap(), Vec::<PathBuf>::new());
        if share_link_or_say_why(&root.join("share"), "skill022_a_delete_never_lists_a_skill_reached_through_a_share") {
            assert_eq!(occurrences(&root).unwrap(), vec![root.join("alpha")]);
        }
        assert!(began.elapsed() < Duration::from_secs(2), "the delete list waited on a share: {:?}", began.elapsed());
    }

    #[test]
    fn links_to_another_computer_are_never_followed() {
        let home = temp("skills-unc");
        let root = home.join(".claude").join("skills");
        skill(&root.join("alpha"), "# alpha\n");
        // A local junction is still followed; its hop is judged and found local.
        link_dir(&root.join("local"), &root.join("alpha"));
        assert!(!remote_link(&root.join("local")));
        // The junction is seen as a link (so its hop is judged), not as a plain folder.
        assert!(fs::symlink_metadata(root.join("local")).unwrap().file_type().is_symlink());
        assert!(!remote_link(&root.join("alpha")));
        if !share_link_or_say_why(&root.join("share"), "links_to_another_computer_are_never_followed") {
            return;
        }
        assert!(remote_link(&root.join("share")));
        // Two hops: a local link to the share link is judged at its second hop.
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(root.join("share"), root.join("hop")).unwrap();
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(root.join("share"), root.join("hop")).unwrap();
        assert!(remote_link(&root.join("hop")));
        // The long-path form of a share is judged the same way.
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(r"\\?\UNC\kolux-unc-test.invalid\share\skills", root.join("long")).unwrap();
            assert!(remote_link(&root.join("long")));
        }
        let began = Instant::now();
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        assert!(began.elapsed() < Duration::from_secs(2), "the walk waited on a share: {:?}", began.elapsed());
        let claude = s.roots.iter().find(|r| r.label == "Claude Code").unwrap();
        assert_eq!((claude.state.as_str(), claude.count), ("scanned", 1), "{:?}", claude.note);
        // A skills folder that is itself a link to a share is not opened at all.
        let home2 = temp("skills-unc-root");
        std::fs::create_dir_all(home2.join(".claude")).unwrap();
        share_link(&home2.join(".claude").join("skills")).unwrap();
        let s = run(spots(&env(&home2), None), &[], ROOT_LIMIT);
        let claude = s.roots.iter().find(|r| r.label == "Claude Code").unwrap();
        assert_eq!(claude.state, "not-scanned");
        assert!(claude.note.as_deref().unwrap().contains("another computer"));
    }

    #[test]
    fn a_walk_past_the_time_limit_is_told_to_stop() {
        let home = temp("skills-cancel");
        let mut slow = Spot::new(home.to_path_buf(), "Slow", "home", &["claude"]);
        slow.kind = Kind::Hang;
        let before = HANG_STOPPED.load(std::sync::atomic::Ordering::SeqCst);
        let s = run(vec![slow], &[], Duration::from_millis(100));
        assert_eq!(s.roots[0].state, "error");
        // The hang thread notices the flag within a few of its 10 ms naps, well before its 3 s.
        let end = Instant::now() + Duration::from_secs(2);
        while HANG_STOPPED.load(std::sync::atomic::Ordering::SeqCst) == before && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(HANG_STOPPED.load(std::sync::atomic::Ordering::SeqCst) > before, "the timed-out walker kept running");
    }

    #[test]
    fn skill_reached_from_two_roots_counts_in_both_and_lists_once() {
        let home = temp("skills-two");
        let shared = home.join(".agents").join("skills");
        skill(&shared.join("tidy"), "---\nname: tidy\ndescription: Tidies\n---\n");
        fs::create_dir_all(home.join(".claude").join("skills")).unwrap();
        link_dir(&home.join(".claude").join("skills").join("tidy"), &shared.join("tidy"));
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        assert_eq!(s.skills.len(), 1);
        let mut a = s.skills[0].agents.clone();
        a.sort();
        assert_eq!(a, vec!["claude", "codex", "shared"]);
        assert_eq!(s.roots.iter().find(|r| r.label == "Claude Code").unwrap().count, 1);
        assert_eq!(s.roots.iter().find(|r| r.label == "Shared skills folder").unwrap().count, 1);
    }

    #[test]
    fn home_and_workspace_both_count_when_the_workspace_is_home() {
        let home = temp("skills-homews");
        skill(&home.join(".claude").join("skills").join("one"), "# one\n");
        let s = run(spots(&env(&home), Some(&home)), &[], ROOT_LIMIT);
        assert_eq!(s.skills.len(), 1);
        assert_eq!(s.skills[0].source, "home");
        assert_eq!(s.roots.iter().find(|r| r.label == "Workspace: Claude Code").unwrap().count, 1);
    }

    #[test]
    fn only_enabled_claude_plugins_add_skills_from_the_version_in_effect() {
        let home = temp("skills-plugins");
        let claude = home.join(".claude");
        let ws = home.join("repo");
        fs::create_dir_all(ws.join(".claude")).unwrap();
        let on_user = home.join("p").join("on").join("1.0");
        let on_proj = home.join("p").join("on").join("2.0");
        let off = home.join("p").join("off").join("1.0");
        skill(&on_user.join("skills").join("old"), "# old\n");
        skill(&on_proj.join("skills").join("new"), "# new\n");
        skill(&off.join("skills").join("hidden"), "# hidden\n");
        fs::create_dir_all(claude.join("plugins")).unwrap();
        fs::write(claude.join("settings.json"), r#"{"enabledPlugins":{"on@m":true,"off@m":true}}"#).unwrap();
        fs::write(ws.join(".claude").join("settings.json"), r#"{"enabledPlugins":{"off@m":false}}"#).unwrap();
        let installed = serde_json::json!({"version":2,"plugins":{
            "on@m":[{"scope":"user","installPath":on_user},{"scope":"project","projectPath":ws,"installPath":on_proj}],
            "off@m":[{"scope":"user","installPath":off}]}});
        fs::write(claude.join("plugins").join("installed_plugins.json"), installed.to_string()).unwrap();
        let s = run(spots(&env(&home), Some(&ws)), &[], ROOT_LIMIT);
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["new"]);
        assert_eq!(s.skills[0].plugin.as_deref(), Some("on"));
        // Without the project the user install is the one in effect, and off is on again.
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["hidden", "old"]);
    }

    #[test]
    fn hermes_app_data_wins_and_bad_overrides_are_ignored() {
        let home = temp("skills-hermes");
        let e = env(&home);
        skill(&home.join(".hermes").join("skills").join("legacy"), "# legacy\n");
        assert_eq!(hermes_home(&e), home.join(".hermes"));
        fs::create_dir_all(home.join("AppData").join("Local").join("hermes")).unwrap();
        assert_eq!(hermes_home(&e), home.join("AppData").join("Local").join("hermes"));
        let mut e2 = e.clone();
        e2.claude = Some(home.join("missing").to_string_lossy().into());
        assert_eq!(claude_home(&e2), home.join(".claude"));
        e2.claude = Some("relative\\dir".into());
        assert_eq!(claude_home(&e2), home.join(".claude"));
        let real = home.join("cc");
        fs::create_dir_all(&real).unwrap();
        e2.claude = Some(real.to_string_lossy().into());
        assert_eq!(claude_home(&e2), real);
    }

    #[test]
    fn unreadable_or_slow_root_is_an_error_not_a_shorter_list() {
        let home = temp("skills-slow");
        // A folder that hangs past the time limit is reported as an error the user can retry.
        let mut slow = Spot::new(home.to_path_buf(), "Slow", "home", &["claude"]);
        slow.kind = Kind::Hang;
        let s = run(vec![slow], &[], Duration::from_millis(300));
        let r = &s.roots[0];
        assert_eq!(r.state, "error");
        assert!(r.note.as_deref().unwrap().contains("longer"));
        // A missing folder is not found, never an error.
        let s = run(vec![Spot::new(home.join("nope"), "Gone", "home", &["claude"])], &[], ROOT_LIMIT);
        assert_eq!(s.roots[0].state, "not-found");
    }

    #[test]
    fn codex_plugin_cache_reads_the_newest_version_and_a_wsl_project_without_wsl_is_an_error() {
        let home = temp("skills-codex");
        let cache = home.join(".codex").join("plugins").join("cache");
        skill(&cache.join("m").join("tools").join("1.0").join("skills").join("one"), "# one\n");
        skill(&cache.join("m").join("bare").join("local").join("two"), "# two\n");
        let s = run(spots(&env(&home), Some(Path::new("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo"))), &[("kolux-cli", "---\ndescription: Drives Kolux\n---\n")], ROOT_LIMIT);
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["kolux-cli", "one", "two"]);
        // WSL is unavailable to `run`: the distribution's roots are errors with the reason, never empty lists.
        let wsl_roots: Vec<&Root> = s.roots.iter().filter(|r| r.label.starts_with("WSL Ubuntu")).collect();
        assert_eq!(wsl_roots.len(), 8);
        assert!(wsl_roots.iter().all(|r| r.state == "error" && r.note.as_deref().is_some_and(|n| n.contains("WSL is not available"))));
        let b = s.skills.iter().find(|k| k.source == "bundled").unwrap();
        assert_eq!(b.description.as_deref(), Some("Drives Kolux"));
    }

    /// A fake WSL: answers by (distribution, folder), counts the calls.
    struct FakeWsl {
        answers: HashMap<(String, String), Result<String, String>>,
        calls: Mutex<Vec<(String, String)>>,
    }

    impl FakeWsl {
        fn new(answers: Vec<(&str, &str, Result<String, &str>)>) -> Arc<FakeWsl> {
            let answers = answers.into_iter().map(|(d, f, a)| ((d.to_string(), f.to_string()), a.map_err(str::to_string))).collect();
            Arc::new(FakeWsl { answers, calls: Mutex::new(vec![]) })
        }
    }

    impl wsl::Runner for FakeWsl {
        fn run(&self, distro: &str, dir: &str, _cancel: &AtomicBool) -> Result<Vec<u8>, String> {
            self.calls.lock().unwrap().push((distro.to_string(), dir.to_string()));
            match self.answers.get(&(distro.to_string(), dir.to_string())) {
                Some(a) => a.clone().map(String::into_bytes),
                None => Ok(b"KOLUX-WSL-SKILLS 1\nNOTFOUND\nEND 0\n".to_vec()),
            }
        }

        fn delete(&self, _distro: &str, _root: &str, _dir: &str, _step: wsl::Step) -> Result<Vec<u8>, String> {
            panic!("a scan never deletes")
        }
    }

    const WSL_PROJECT: &str = r"\\wsl.localhost\Ubuntu\home\me\repo";

    #[test]
    fn a_wsl_project_lists_its_distributions_skills() {
        let home = temp("skills-wsl");
        let pdf = wsl::answer_for(&[("/home/me/.claude/skills/pdf", "/home/me/.claude/skills/pdf", "---\nname: pdf-tools\ndescription: Reads PDFs\n---\n")]);
        let repo = wsl::answer_for(&[("/home/me/repo/.claude/skills/lint", "/home/me/repo/.claude/skills/lint", "# Lint\n\nChecks style.\n")]);
        let fake = FakeWsl::new(vec![("Ubuntu", "~/.claude/skills", Ok(pdf)), ("Ubuntu", "/home/me/repo/.claude/skills", Ok(repo))]);
        let s = run_with(spots(&env(&home), Some(Path::new(WSL_PROJECT))), &[], ROOT_LIMIT, fake.clone());
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["Lint", "pdf-tools"]);
        let pdf = s.skills.iter().find(|k| k.name == "pdf-tools").unwrap();
        assert_eq!((pdf.source.as_str(), pdf.agents.clone(), pdf.description.as_deref()), ("home", vec!["claude".to_string()], Some("Reads PDFs")));
        assert_eq!(pdf.path, r"\\wsl.localhost\Ubuntu\home\me\.claude\skills\pdf\SKILL.md");
        assert_eq!(s.skills.iter().find(|k| k.name == "Lint").unwrap().source, "workspace");
        let root = |label: &str| s.roots.iter().find(|r| r.label == label).unwrap();
        assert_eq!((root("WSL Ubuntu: Claude Code").state.as_str(), root("WSL Ubuntu: Claude Code").count), ("scanned", 1));
        assert_eq!(root("WSL Ubuntu: Codex").state, "not-found");
        // One call per WSL folder (5 home + 3 project), none for a Windows path.
        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 8);
        assert!(calls.iter().all(|(d, _)| d == "Ubuntu"));
        assert!(calls.contains(&("Ubuntu".to_string(), "/home/me/repo/.agents/skills".to_string())));
    }

    #[test]
    fn a_garbled_wsl_answer_is_an_error_not_an_empty_list() {
        let home = temp("skills-wsl-garbled");
        let cut = wsl::answer_for(&[("/home/me/.claude/skills/pdf", "/home/me/.claude/skills/pdf", "# pdf\n")]).replace("END 1\n", "");
        let fake = FakeWsl::new(vec![("Ubuntu", "~/.claude/skills", Ok(cut)), ("Ubuntu", "~/.codex/skills", Ok("nonsense".into())), ("Ubuntu", "~/.agents/skills", Err("wsl.exe ended with exit code 1"))]);
        let s = run_with(spots(&env(&home), Some(Path::new(WSL_PROJECT))), &[], ROOT_LIMIT, fake);
        assert!(s.skills.is_empty());
        for label in ["WSL Ubuntu: Claude Code", "WSL Ubuntu: Codex", "WSL Ubuntu: Shared skills folder"] {
            let r = s.roots.iter().find(|r| r.label == label).unwrap();
            assert_eq!(r.state, "error", "{label}");
            assert_eq!(r.count, 0);
        }
        let note = |label: &str| s.roots.iter().find(|r| r.label == label).unwrap().note.clone().unwrap();
        assert!(note("WSL Ubuntu: Claude Code").contains("could not read"));
        assert!(note("WSL Ubuntu: Shared skills folder").contains("exit code 1"));
        // A folder that simply is not there stays not-found.
        assert_eq!(s.roots.iter().find(|r| r.label == "WSL Ubuntu: Grok").unwrap().state, "not-found");
    }

    #[test]
    fn a_skill_reached_twice_in_wsl_is_listed_once_and_set_aside_folders_are_hidden() {
        let home = temp("skills-wsl-twice");
        let a = wsl::answer_for(&[("/home/me/.claude/skills/one", "/real/one", "# one\n"), ("/home/me/.claude/skills/.kolux-deleting-12-34-gone", "/real/gone", "# gone\n")]);
        let b = wsl::answer_for(&[("/home/me/.agents/skills/one", "/real/one", "# one\n")]);
        let fake = FakeWsl::new(vec![("Ubuntu", "~/.claude/skills", Ok(a)), ("Ubuntu", "~/.agents/skills", Ok(b))]);
        let s = run_with(spots(&env(&home), Some(Path::new(WSL_PROJECT))), &[], ROOT_LIMIT, fake);
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["one"]);
        assert!(s.skills[0].agents.contains(&"claude".to_string()) && s.skills[0].agents.contains(&"shared".to_string()));
    }

    #[test]
    fn a_windows_project_never_calls_wsl_and_wsl_roots_are_never_deletable() {
        let home = temp("skills-wsl-none");
        let ws = home.join("repo");
        fs::create_dir_all(&ws).unwrap();
        let fake = FakeWsl::new(vec![]);
        let s = run_with(spots(&env(&home), Some(&ws)), &[], ROOT_LIMIT, fake.clone());
        assert!(fake.calls.lock().unwrap().is_empty());
        assert!(!s.roots.iter().any(|r| r.label.starts_with("WSL")));
        let p = places(&env(&home), Some(Path::new(WSL_PROJECT)));
        assert!(p.deletable.iter().all(|d| !d.to_string_lossy().contains("Ubuntu")), "{:?}", p.deletable);
    }

    /// SKILL-022 (T-180-b): a delete inside WSL may act only in the skill folders of the
    /// distribution the open project lives in; a Windows project offers none.
    #[test]
    fn skill022_wsl_a_project_in_a_distribution_offers_its_eight_skill_folders_for_delete() {
        let home = temp("skills-wsl-places");
        let p = places(&env(&home), Some(Path::new(WSL_PROJECT)));
        assert_eq!(p.wsl_roots.len(), 8, "{:?}", p.wsl_roots);
        assert!(p.wsl_roots.iter().all(|(d, _)| d == "Ubuntu"));
        for root in ["~/.claude/skills", "~/.codex/skills", "~/.agents/skills", "~/.grok/skills", "~/.hermes/skills", "/home/me/repo/.claude/skills", "/home/me/repo/.agents/skills", "/home/me/repo/.grok/skills"] {
            assert!(p.wsl_roots.contains(&("Ubuntu".to_string(), root.to_string())), "{root} missing from {:?}", p.wsl_roots);
        }
        let ws = home.join("repo");
        fs::create_dir_all(&ws).unwrap();
        assert!(places(&env(&home), Some(&ws)).wsl_roots.is_empty());
        assert!(places(&env(&home), None).wsl_roots.is_empty());
    }

    /// The same local folder reached as a share on this computer (`\\localhost\G$\...`): a target
    /// that really resolves, so a check that is missing shows up as a listed skill. None when this
    /// computer has no admin share for the drive.
    fn as_share(p: &Path, long: bool) -> Option<PathBuf> {
        let s = p.to_string_lossy().replace('/', "\\");
        let s = s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string();
        let (drive, rest) = s.split_once(":\\")?;
        let share = if long { format!("\\\\?\\UNC\\localhost\\{drive}$\\{rest}") } else { format!("\\\\localhost\\{drive}$\\{rest}") };
        let share = PathBuf::from(share);
        share.exists().then_some(share)
    }

    #[test]
    fn a_skill_file_that_links_to_a_share_is_never_read() {
        let home = temp("skills-unc-file");
        let real = home.join("real");
        skill(&real, "# leaked\n");
        let Some(far) = as_share(&real.join(SKILL_FILE), false) else {
            eprintln!("skipped: no admin share for this drive");
            return;
        };
        let far_long = as_share(&real.join(SKILL_FILE), true).unwrap();
        let root = home.join(".claude").join("skills");
        skill(&root.join("plain"), "# plain\n");
        for (name, target) in [("x", far), ("y", far_long), ("z", PathBuf::from(r"\\x.invalid\s\SKILL.md"))] {
            fs::create_dir_all(root.join(name)).unwrap();
            #[cfg(windows)]
            let made = std::os::windows::fs::symlink_file(&target, root.join(name).join(SKILL_FILE)).is_ok();
            #[cfg(not(windows))]
            let made = std::os::unix::fs::symlink(&target, root.join(name).join(SKILL_FILE)).is_ok();
            if !made {
                eprintln!("skipped: this account cannot make symbolic links");
                return;
            }
            assert!(remote_link(&root.join(name).join(SKILL_FILE)), "{name}");
            // Reading the skill straight away gives nothing from the far side.
            assert_eq!(read_skill(&root.join(name)), (name.to_string(), None, None), "{name}");
        }
        let began = Instant::now();
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        assert!(began.elapsed() < Duration::from_secs(2), "the scan waited on a share: {:?}", began.elapsed());
        let names: Vec<&str> = s.skills.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["plain"]);
    }

    /// Council FS1 (FIX-2): the NT object form `\??\UNC\host\share` names a share as much as
    /// `\\?\UNC\` does, so a plugin installPath or link target written that way is never probed.
    #[test]
    fn an_nt_object_path_to_a_share_is_refused_by_its_text() {
        for p in [r"\??\UNC\x.invalid\s", r"\??\unc\x.invalid\s\SKILL.md", "/??/UNC/x.invalid/s", r"\??\GLOBALROOT\Device\Mup\x.invalid\s"] {
            assert!(remote_path(Path::new(p)), "{p}");
        }
        assert_eq!(usable(&Some(r"\??\UNC\x.invalid\s".into())), None);
        assert!(!remote_path(Path::new(r"\??\C:\Windows")), "an NT path to a local drive stays local");
    }

    #[test]
    fn share_overrides_plugin_paths_and_linked_parents_are_refused_by_their_text() {
        let home = temp("skills-unc-spots");
        let far_dir = home.join("far");
        skill(&far_dir.join("skills").join("leaked"), "# leaked\n");
        let Some(far) = as_share(&far_dir, false) else {
            eprintln!("skipped: no admin share for this drive");
            return;
        };
        // An AI home override on a share is ignored, judged by its text alone.
        let over = Some(far.to_string_lossy().to_string());
        assert_eq!(usable(&over), None);
        assert_eq!(usable(&Some(r"\\x.invalid\c".into())), None);
        assert_eq!(usable(&Some(as_share(&far_dir, true).unwrap().to_string_lossy().into())), None);
        // A plugin installed on a share is listed as not scanned.
        let claude = home.join(".claude");
        fs::create_dir_all(claude.join("plugins")).unwrap();
        fs::write(claude.join("settings.json"), r#"{"enabledPlugins":{"far@m":true}}"#).unwrap();
        let installed = serde_json::json!({"version":2,"plugins":{"far@m":[{"scope":"user","installPath":far}]}});
        fs::write(claude.join("plugins").join("installed_plugins.json"), installed.to_string()).unwrap();
        // A Codex plugin version whose skills folder links to a share.
        let ver = home.join(".codex").join("plugins").join("cache").join("m").join("tools").join("1.0");
        fs::create_dir_all(&ver).unwrap();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(far.join("skills"), ver.join("skills")).is_ok();
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink(far.join("skills"), ver.join("skills")).is_ok();
        let s = run(spots(&env(&home), None), &[], ROOT_LIMIT);
        assert!(s.skills.is_empty(), "{:?}", s.skills.iter().map(|k| &k.path).collect::<Vec<_>>());
        let plugin = s.roots.iter().find(|r| r.label == "Claude plugin: far").unwrap();
        assert_eq!(plugin.state, "not-scanned");
        if !made {
            eprintln!("skipped the link halves: this account cannot make symbolic links");
            return;
        }
        // A home folder whose parent is a link to a share: the skills folder under it is not opened.
        let home2 = temp("skills-unc-parent");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&far, home2.join(".claude")).unwrap();
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(&far, home2.join(".claude")).unwrap();
        let s = run(spots(&env(&home2), None), &[], ROOT_LIMIT);
        assert!(s.skills.is_empty());
        assert_eq!(s.roots.iter().find(|r| r.label == "Claude Code").unwrap().state, "not-scanned");
    }
}
