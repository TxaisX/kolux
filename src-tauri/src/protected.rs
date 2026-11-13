//! SAFE-009..014: the built-in protected rules. When Claude Code is about to run a shell command
//! in a Kolux pane, its PreToolUse hook asks `check`; a hit makes Claude show its own permission
//! prompt with the rule's name, so the command waits for the user. Only Claude is guarded (Codex
//! hooks can refuse but not ask), only its Bash and PowerShell tools are read, and a command that
//! matches nothing gets no opinion, so Claude's usual permission flow carries on.
//!
//! Settings: `protectedAsk` (the master switch, never saved means on) and `protectedOff` (the ids
//! of built-ins switched off); both are read on every command, so a change applies at once.
//!
//! SAFE-013/014: a command is read as a chain (operators, grouping, `$( )` and backtick
//! substitutions four levels deep), wrappers and their option values are stepped over, and what
//! sh -c, cmd /c, PowerShell (-Command or encoded), eval, iex and wsl are given to run is read
//! too; the recursive-delete rule judges paths as text against the workspace and the temp roots.
//!
//! T-604: a command is read more than one way (`Reading`): as written, as a shell reads it
//! (comments, heredoc and here-string bodies, escaped quotes, continued lines), and with quotes
//! ignored when a quote never closed; a rule asks when any reading trips it, so a stray quote
//! cannot hide the rest of a command. Every word is read with its backslashes kept and with them
//! dropped as bash does. A recursive delete asks outright when a target (or a cd before it) holds a
//! backtick, a caret, a backslash before anything but a plain path character, or a drive-relative
//! form (`unclear_target`): those escapes are read differently by each shell. A cd (also pushd,
//! Set-Location, Push-Location, and a wrapper's folder option: env -C, sudo -D, start /D, wsl --cd)
//! to such a folder, or to a relative one while CDPATH may apply, makes the folder unknown. A command over 256 KB (`LONG_COMMAND`) is asked about outright, unread,
//! so the answer stays well inside the hook's 1.5 s on a slow machine.
//!
//! ponytail: the workspace is Claude's own hook `cwd` (a Kolux pane starts Claude in the worktree
//! folder); a pane variable naming the worktree would tell a cd before launch apart from it.

use serde_json::Value;
use std::cell::{Cell, OnceCell};

pub const ASK_FIELD: &str = "protectedAsk";
pub const OFF_FIELD: &str = "protectedOff";

/// One built-in rule: its id (kept in settings), the name Claude's prompt shows, and the test.
pub struct Rule {
    pub id: &'static str,
    pub name: &'static str,
    /// SAFE-015: two commands the rule asks about, shown as its examples on the Safety page.
    pub samples: [&'static str; 2],
    hit: fn(&Read, &Base) -> bool,
}

pub static RULES: [Rule; 7] = [
    Rule { id: "stripe", name: "Stripe changes", samples: ["stripe refunds create --charge ch_1", "stripe customers delete cus_1"], hit: stripe },
    Rule { id: "force-push", name: "Force-push to main", samples: ["git push --force origin main", "git push origin +main"], hit: force_push },
    Rule { id: "db-drop", name: "Deleting database tables", samples: ["psql -c \"DROP TABLE users\"", "dropdb production"], hit: db_drop },
    Rule { id: "infra", name: "Infrastructure changes", samples: ["terraform apply -auto-approve", "pulumi destroy"], hit: infra },
    Rule { id: "prod-deploy", name: "Production deploys", samples: ["vercel --prod", "netlify deploy --prod"], hit: prod_deploy },
    Rule { id: "delete", name: "Deleting folders outside the workspace", samples: ["rm -rf ../other-project", "rm -rf ~"], hit: recursive_delete },
    Rule { id: "discard", name: "Throwing away uncommitted work", samples: ["git reset --hard", "git clean -fdx"], hit: discard },
];

/// T-604 (round 3 review of PR #15): a command longer than this many bytes is asked about outright,
/// unread (`TOO_LONG`), so the answer stays well inside the hook's 1.5 s even on a slow machine; an
/// agent's real commands are far shorter, and one this long is worth a look anyway.
pub const LONG_COMMAND: usize = 256 * 1024;

/// What a command over `LONG_COMMAND` trips. It is not one of `RULES`: it cannot be switched off
/// on its own (the master switch still stops it) and the Safety page does not list it.
pub static TOO_LONG: Rule = Rule {
    id: "too-long",
    name: "Commands over 256 KB, too long to read in time",
    samples: ["", ""],
    hit: |_, _| true,
};

/// The first rule `command` trips, honouring the master switch and the switched-off list.
pub fn check(command: &str, base: &Base, settings: &Value) -> Option<&'static Rule> {
    check_with(command, &OnceCell::new(), base, settings)
}

/// `check`, reading `command` into `read` when a rule first needs it, so the user's own rules can
/// use the same reading (T-604: a long command is read once per hook answer).
pub(crate) fn check_with<'a>(command: &'a str, read: &OnceCell<Read<'a>>, base: &Base, settings: &Value) -> Option<&'static Rule> {
    if settings.get(ASK_FIELD) == Some(&Value::Bool(false)) {
        return None;
    }
    if command.len() > LONG_COMMAND {
        return Some(&TOO_LONG);
    }
    let off: Vec<&str> = settings.get(OFF_FIELD).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    RULES.iter().find(|r| !off.contains(&r.id) && (r.hit)(read.get_or_init(|| Read::new(command)), base))
}

/// What Claude's prompt says (SAFE-009): the rule's name, cut to 120 characters, and what allowing
/// or refusing does.
pub fn reason(rule_name: &str) -> String {
    let name: String = rule_name.chars().take(120).collect();
    format!("Kolux protected action: {name}. The command waits for you; allow it once to run it, or refuse to leave it unrun.")
}

/// What a recursive delete is judged against (SAFE-013): the workspace, the folder the command
/// began in, the home folder and the temp roots, all as text; nothing is looked up on disk.
#[derive(Clone, Debug, Default)]
pub struct Base {
    pub workspace: Option<String>,
    pub cwd: Option<String>,
    pub home: Option<String>,
    pub temp: Vec<String>,
}

impl Base {
    /// Whether the paths are Windows paths (a drive letter), where a backslash separates folders.
    fn windows(&self) -> bool {
        [&self.workspace, &self.cwd, &self.home].into_iter().flatten().chain(&self.temp).any(|p| p.as_bytes().get(1) == Some(&b':') && p.as_bytes()[0].is_ascii_alphabetic())
    }

    /// From Claude's hook `cwd` (the folder its session began in, which is the worktree folder
    /// when a Kolux pane started it) and this process's environment.
    pub fn from_env(cwd: Option<&str>) -> Base {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let mut temp: Vec<String> = ["TMPDIR", "TEMP", "TMP"].iter().filter_map(|k| var(k)).collect();
        temp.extend(["/tmp".to_string(), "/var/tmp".to_string()]);
        Base { workspace: cwd.map(String::from), cwd: cwd.map(String::from), home: var("USERPROFILE").or_else(|| var("HOME")), temp }
    }
}

// SAFE-013: a recursive delete that reaches outside the workspace, or whose target is unknown.
// Each reading's chain is walked in order so an earlier cd, pushd or Set-Location shifts the base.
fn recursive_delete(c: &Read, base: &Base) -> bool {
    // On a Windows base a backslash is a folder separator, so the `Bash` reading's paths are not
    // all judged as written (`C:\Users` would read `C:Users`): it is paired word for word with
    // `Shell`, every word taken from `Bash` (so `r\m -\rf` is `rm -rf` and `x/\.\.` is `x/..`)
    // except a path that lost its meaning there (`lost`), taken from `Shell`. `Shell` is judged on
    // its own as well, so a delete runs only when both readings of each path are safe. Anywhere else
    // both readings are judged in full; unpaired chains are judged in full too.
    let windows = base.windows();
    // T-604 (round 7 review of PR #15): with CDPATH named in the command or set for the hook, a
    // relative cd may land anywhere, so it makes the folder unknown.
    let cdpath = c.text.to_ascii_uppercase().contains("CDPATH") || std::env::var_os("CDPATH").is_some_and(|v| !v.is_empty());
    let paired = windows.then(|| pair(&c.chains[1], &c.chains[2])).flatten();
    let how = How { cdpath };
    c.chains.iter().enumerate().any(|(i, chain)| {
        if i == 2 && paired.is_some() {
            return false;
        }
        deletes_outside(chain.iter(), base, how)
    }) || paired.is_some_and(|chain| deletes_outside(chain.iter(), base, how))
}

/// What `deletes_outside` needs to know about the whole command.
#[derive(Clone, Copy)]
struct How {
    /// CDPATH may apply, so a relative cd is unknown (round 7).
    cdpath: bool,
}

/// Whether a path lost its meaning in the `Bash` reading, so on a Windows base only its `Shell`
/// form is judged: it became drive-relative (`C:\Users\me` read as `C:Usersme`) or has no folder
/// separator left (`build\out` read as `buildout`), and it was written with backslashes only (a word
/// that also has a `/`, as `x/\.\.`, is judged as bash reads it).
fn lost(shell: &str, bash: &str) -> bool {
    !shell.contains('/') && (drive_relative(bash) || !bash.contains(['/', '\\']))
}

/// The `Shell` and `Bash` chains word for word (see `recursive_delete`), or None when they do not
/// line up (a different count of commands or words, or the program at a different place).
fn pair(shell: &[Seg], bash: &[Seg]) -> Option<Vec<Seg>> {
    if shell.len() != bash.len() {
        return None;
    }
    shell
        .iter()
        .zip(bash)
        .map(|(s, b)| {
            if s.words.len() != b.words.len() || s.at != b.at {
                return None;
            }
            let words = s.words.iter().zip(&b.words).enumerate().map(|(k, (sw, bw))| if sw == bw || k <= s.at || bw.starts_with('-') || !lost(sw, bw) { bw.clone() } else { sw.clone() }).collect();
            Some(Seg { words, at: s.at })
        })
        .collect()
}

fn deletes_outside<'a>(chain: impl Iterator<Item = &'a Seg>, base: &Base, how: How) -> bool {
    let cdpath = how.cdpath;
    let mut dir = base.cwd.clone().or_else(|| base.workspace.clone());
    let mut chain = chain.peekable();
    while let Some(full) = chain.next() {
        let seg = full.program_words();
        let p = program(seg);
        let args: Vec<&str> = seg[1..].iter().map(String::as_str).collect();
        // A wrapper's own folder option (env -C, sudo -D, start /D, wsl --cd) is a cd for the
        // program it runs only (round 7 review of PR #15); T-604b (b): nested wrappers' folders are
        // joined in order, as each wrapper starts the next in its own folder.
        let here = wrapper_folders(&full.words[..full.at]).into_iter().fold(dir.clone(), |d, f| f.and_then(|f| cd_to(&f, d.as_deref(), base, cdpath)));
        // T-604b (c): find's -delete (its own word, among its own arguments) removes what matches
        // under each start point, never the start point's folder above it, so a start point inside
        // the workspace runs, the workspace root included; its .git and anything outside ask.
        // T-604b follow-up (cycle 3): the reading splits at `(` and `)`, so the expression after an
        // escaped group (`find .. \( -name x -delete \)`) lands in the next parts. A command never
        // starts with `-`, `!` or `,`, so those parts are put back before find is judged; an empty
        // part is skipped and a real command ends the group. T-604b (e): keeping the escaped group
        // whole means its start points are seen, and a start point that is a link is judged where it
        // leads.
        if p == "find" {
            let mut words: Vec<&str> = args.clone();
            while let Some(next) = chain.peek() {
                let nw = next.program_words();
                if !(nw.is_empty() || nw.first().is_some_and(|w| w.starts_with(['-', '!', ',']) || w == "\\")) {
                    break;
                }
                if let Some(next) = chain.next() {
                    words.extend(next.words.iter().map(String::as_str));
                }
            }
            if words.contains(&"-delete") {
                // T-604b (e): -L (and its older name -follow) follows links found inside the tree too,
                // where no reading can tell where they lead, so a delete under it asks outright.
                if words.iter().any(|a| *a == "-L" || *a == "-follow") {
                    return true;
                }
                let ws = base.workspace.as_deref().or(base.cwd.as_deref()).map(norm);
                let root = |t: &str| ws.is_some() && locate(t, here.as_deref(), base) == ws;
                if find_targets(&words).iter().any(|t| unclear_target(t) || start_links_out(t, here.as_deref(), base) || (risky_following_links(t, here.as_deref(), base) && !root(t))) {
                    return true;
                }
            }
            continue;
        }
        // T-604b (c): the other recursive deletes, each judged by its targets as rm -rf is.
        let other = match p.as_str() {
            "rimraf" => Some(args.iter().filter(|a| !a.starts_with('-')).map(|a| a.to_string()).collect()),
            "robocopy" => robocopy_target(&args),
            "[io.directory]::delete" | "[system.io.directory]::delete" => directory_delete(chain.peek().map(|s| s.words.as_slice())),
            _ => None,
        };
        if let Some(targets) = other {
            if targets.is_empty() || targets.iter().any(|t| unclear_target(t) || risky(t, here.as_deref(), base)) {
                return true;
            }
            continue;
        }
        match p.as_str() {
            "cd" | "chdir" | "set-location" | "sl" | "pushd" | "push-location" => {
                let target = args.iter().find(|a| !(a.starts_with('-') && a.len() > 1) && !a.eq_ignore_ascii_case("/d"));
                dir = match target {
                    None if matches!(p.as_str(), "pushd" | "push-location") => None,
                    None => base.home.clone(),
                    Some(t) => cd_to(t, here.as_deref(), base, cdpath),
                };
            }
            "popd" | "pop-location" => dir = None,
            "rm" | "rd" | "rmdir" | "del" | "erase" | "remove-item" | "ri" => {
                if let Some(targets) = delete_targets(&p, &args) {
                    // T-604b (d): whether a PowerShell wildcard can match `..` is unproven, so a
                    // PowerShell delete with any wildcard asks.
                    // ponytail: `rm`, `del` and `rd` are PowerShell aliases too; they are read as bash
                    // and cmd read them, since the command does not say which shell runs it.
                    let ps_wild = matches!(p.as_str(), "remove-item" | "ri") && targets.iter().any(|t| t.contains(['*', '?', '[']));
                    if ps_wild || targets.is_empty() || targets.iter().any(|t| unclear_target(t) || risky(t, here.as_deref(), base)) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    false
}

/// Where a cd to `t` from `dir` lands, or None when that cannot be told: the same check as a
/// folder part of a delete target (round 6 review of PR #15: a wildcard, an escape or a
/// drive-relative form), `-`, or a relative folder while CDPATH may apply (round 7).
fn cd_to(t: &str, dir: Option<&str>, base: &Base, cdpath: bool) -> Option<String> {
    if unclear_target(t) || t.contains(['*', '?', '[']) || t == "-" || (cdpath && !is_abs(t) && !t.starts_with('~')) {
        return None;
    }
    locate(t, dir, base)
}

/// The folders the wrappers in `w` (the words before the program) tell the program to start in, in
/// order: env's -C / --chdir, sudo's -D / --chdir, cmd start's /D and wsl's --cd. Each wrapper starts
/// the next in its folder, so they are joined in turn (T-604b (b)); one wrapper naming two is None
/// (unknown: which one it uses is the program's own choice).
fn wrapper_folders(w: &[String]) -> Vec<Option<String>> {
    let mut out = Vec::new();
    let mut found: Option<Option<String>> = None;
    let mut wrapper = String::new();
    let mut i = 0;
    while i < w.len() {
        let o = w[i].as_str();
        let next = || w.get(i + 1).cloned();
        let value = match wrapper.as_str() {
            "env" if o == "-C" || o == "--chdir" => next(),
            "env" => o.strip_prefix("--chdir=").or_else(|| o.strip_prefix("-C").filter(|v| !v.is_empty())).map(String::from),
            "sudo" if o == "-D" || o == "--chdir" => next(),
            "sudo" => o.strip_prefix("--chdir=").or_else(|| o.strip_prefix("-D").filter(|v| !v.is_empty())).map(String::from),
            "start" if o.eq_ignore_ascii_case("/d") => next(),
            "start" if o.len() > 2 && o[..2].eq_ignore_ascii_case("/d") => Some(o[2..].to_string()),
            "wsl" if o == "--cd" => next(),
            _ => None,
        };
        if value.is_some() {
            found = Some(if found.is_some() { None } else { value });
            i += if o.len() <= 2 || o == "--chdir" || o == "--cd" { 2 } else { 1 };
            continue;
        }
        let name = program(&w[i..]);
        if WRAPPERS.iter().any(|(n, _)| *n == name) {
            out.extend(found.take());
            wrapper = name;
        }
        i += 1;
    }
    out.extend(found);
    out
}

/// T-604b (c): the start points of a `find` (after its -H, -L, -P, -D and -O options, up to the first
/// expression word); none means `.`, as find does.
fn find_targets(args: &[&str]) -> Vec<String> {
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match *a {
            "-H" | "-L" | "-P" => i += 1,
            "-D" => i += 2,
            o if o.starts_with("-O") => i += 1,
            _ => break,
        }
    }
    let starts: Vec<String> = args[i.min(args.len())..].iter().take_while(|a| {
        let bare = a.trim_start_matches('\\');
        !(a.is_empty() || bare.is_empty() || bare.starts_with(['-', '(', ')', '!', ',']))
    }).map(|a| a.to_string()).collect();
    if starts.is_empty() { vec![".".to_string()] } else { starts }
}

/// T-604b (e): find follows a symbolic link named as a start point (POSIX requires it), so one
/// that resolves outside the workspace asks even when its text lies inside.
/// ponytail: a start point that is not there is left to the text check; find errors on a dangling
/// link and deletes nothing.
fn start_links_out(t: &str, dir: Option<&str>, base: &Base) -> bool {
    let Some(ws) = base.workspace.as_deref().or(base.cwd.as_deref()) else { return false };
    let Some(path) = locate(t, dir, base) else { return false };
    let (Ok(real), Ok(root)) = (std::fs::canonicalize(&path), std::fs::canonicalize(ws)) else { return false };
    !real.starts_with(&root)
}

/// T-604b (c): what `robocopy <source> <destination> ... /MIR` (or /PURGE) deletes: the files of the
/// destination its source lacks, so the destination is its target; None without either switch. A
/// word of a slash, letters and an optional `:value` is a switch (`/tmp` among them, so a destination
/// written so is missing and the delete asks).
fn robocopy_target(args: &[&str]) -> Option<Vec<String>> {
    let switch = |a: &str| a.strip_prefix('/').is_some_and(|r| r.split(':').next().is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-')));
    let mirrors = args.iter().any(|a| switch(a) && (a.eq_ignore_ascii_case("/mir") || a.eq_ignore_ascii_case("/purge")));
    let places: Vec<&str> = args.iter().copied().filter(|a| !switch(a)).collect();
    mirrors.then(|| places.get(1).map(|d| vec![d.to_string()]).unwrap_or_default())
}

/// T-604b (c): `[IO.Directory]::Delete(path, recursive)`: the reading splits its bracket off, so its
/// arguments are the next command's words. A true second argument (anything but `$false`, `0` or
/// `false`) makes it recursive; a missing argument list is unknown (empty, so it asks).
fn directory_delete(next: Option<&[String]>) -> Option<Vec<String>> {
    let Some(words) = next else { return Some(Vec::new()) };
    let joined = words.join(" ");
    let parts: Vec<&str> = joined.split(',').map(str::trim).collect();
    let recursive = parts.get(1).is_some_and(|f| !(f.eq_ignore_ascii_case("$false") || *f == "0" || f.eq_ignore_ascii_case("false")));
    recursive.then(|| vec![parts[0].to_string()])
}

/// The targets of a recursive delete, or None when the command is not recursive: rm's -r in any
/// bundle, cmd's /s (run together with other switches too), PowerShell's -Recurse and every
/// shortening of it, with -Path and -LiteralPath values read as targets.
fn delete_targets(program: &str, args: &[&str]) -> Option<Vec<String>> {
    let cmd_style = matches!(program, "rd" | "rmdir" | "del" | "erase");
    let mut recursive = false;
    let mut targets = Vec::new();
    let mut literal = false;
    let mut i = 0;
    while i < args.len() {
        let a = args[i];
        i += 1;
        if literal {
            targets.push(a.to_string());
            continue;
        }
        if a == "--" {
            literal = true;
            continue;
        }
        if cmd_style && a.starts_with('/') && a[1..].split('/').all(|t| t.len() == 1 || (t.len() == 3 && t.as_bytes()[1] == b':')) {
            recursive |= a[1..].split('/').any(|t| t.eq_ignore_ascii_case("s"));
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            // Any unambiguous shortening: `--recu`, `--r`.
            recursive |= !rest.is_empty() && "recursive".starts_with(rest);
            continue;
        }
        if a.len() > 1 && a.starts_with('-') {
            let (name, attached) = match a[1..].split_once(':') {
                Some((n, v)) => (n.to_ascii_lowercase(), Some(v)),
                None => (a[1..].to_ascii_lowercase(), None),
            };
            if name == "lp" || ["path", "literalpath", "pspath"].iter().any(|s| s.starts_with(name.as_str())) {
                let value = attached.or_else(|| {
                    i += 1;
                    args.get(i - 1).copied()
                });
                targets.extend(value.unwrap_or("").split(',').map(str::to_string));
            } else if name.len() >= 2 && ["include", "exclude", "filter", "credential"].iter().any(|s| s.starts_with(name.as_str())) {
                i += usize::from(attached.is_none());
            } else if "recurse".starts_with(name.as_str()) || (name.contains('r') && name.chars().all(|c| "rfvdi".contains(c))) {
                recursive = true;
            }
            continue;
        }
        targets.push(a.to_string());
    }
    recursive.then_some(targets)
}

/// T-604 (round 4 review of PR #15): a delete target, or a folder a cd moves to, that no reading
/// can be sure of, so a recursive delete of it asks whatever its path reads as. It holds a
/// PowerShell backtick or a cmd caret (escapes no reading drops), a backslash before anything but a
/// plain path character (a letter or digit, `_`, `-`, `%`, a wildcard, or the end of the word:
/// `C:\Users\me`, `dist\*.o` and `build\out_1` read plainly, while `\.\.` or `\:` may be bash
/// escapes), or a drive-relative form (`C:` with no separator after it, or `C\:`).
fn unclear_target(t: &str) -> bool {
    let b = t.as_bytes();
    let escaped = t.contains(['`', '^'])
        || t.char_indices().any(|(i, c)| c == '\\' && t[i + 1..].chars().next().is_some_and(|n| !(n.is_alphanumeric() || matches!(n, '_' | '-' | '%' | '*' | '?'))));
    let drive_relative = b.len() >= 2 && b[0].is_ascii_alphabetic() && ((b[1] == b':' && !matches!(b.get(2), Some(b'/' | b'\\'))) || (b[1] == b'\\' && b.get(2) == Some(&b':')));
    escaped || drive_relative
}

/// Whether deleting `target` must ask: unknown, outside the workspace, the workspace itself or
/// its git folder; a temp location runs; a wildcard (`*`, `?`, `[`) in the last part is judged by its
/// folder, and one in a folder part always asks.
/// T-604b (e): find follows a link named as a start point (POSIX requires it), so the last part is
/// judged where it leads instead of asking the way a plain `rm link` does.
fn risky_following_links(target: &str, dir: Option<&str>, base: &Base) -> bool {
    risky_at(target, dir, base, true)
}

fn risky(target: &str, dir: Option<&str>, base: &Base) -> bool {
    risky_at(target, dir, base, false)
}

fn risky_at(target: &str, dir: Option<&str>, base: &Base, follow_last: bool) -> bool {
    const WILD: [char; 3] = ['*', '?', '['];
    let t = target.replace('\\', "/");
    // T-604 (round 5 review of PR #15): a wildcard in a folder part cannot be judged as written
    // (`.?` matches `..` on bash 5.1 and older), so it asks; one in the last part is judged by its folder.
    let t = match t.rsplit_once('/') {
        Some((folder, _)) if folder.contains(WILD) => return true,
        Some((folder, last)) if last.contains(WILD) => folder.to_string(),
        _ if t.contains(WILD) => ".".to_string(),
        _ => t,
    };
    let Some(path) = locate(&t, dir, base) else { return true };
    // HOME and its ancestors are never temp deletes, even when HOME lies under a temp root.
    let reaches_home = base.home.as_deref().is_some_and(|h| under(&norm(h), &path));
    if !reaches_home {
        let temp: Vec<String> = base.temp.iter().map(|r| norm(r)).collect();
        if let Some(root) = temp.iter().find(|r| under(&path, r)) {
            // T-604b (a): a link on the way may lead out of the temp folder.
            return link_answers(&path, root, &temp, None, base, follow_last);
        }
    }
    let Some(ws) = base.workspace.as_deref().or(base.cwd.as_deref()) else { return true };
    let ws = norm(ws);
    let git = format!("{ws}/.git");
    if path == ws || under(&path, &git) || !under(&path, &ws) { return true; }
    // T-604b follow-up (cycle 3): a delete at or through a link is judged where the link leads.
    link_answers(&path, &ws, std::slice::from_ref(&ws), Some(&git), base, follow_last)
}

/// T-604b (a) and its cycle-3 follow-up: whether a delete of `path` under `root` goes through a link (a
/// symlink, or a junction on Windows). A start point that is itself a link asks: once normalized, `rm link`
/// (which removes the link) and `rm link/` (which follows it) cannot be told apart, and `find link/` follows.
/// A link on the way is resolved: one that stays under a root in `roots` (every temp root, or the workspace),
/// and out of `git` when one is given, runs; one that leads elsewhere, or cannot be resolved (it leads
/// nowhere, or the rest of the path is not there), asks. A path with no link on the way stays where its text
/// says.
fn link_answers(path: &str, root: &str, roots: &[String], git: Option<&str>, base: &Base, follow_last: bool) -> bool {
    let rest = path.get(root.len()..).unwrap_or("").trim_start_matches('/');
    let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();
    let mut at = std::path::PathBuf::from(root);
    let mut linked = false;
    for (i, part) in parts.iter().enumerate() {
        at.push(part);
        match std::fs::symlink_metadata(&at) {
            Ok(m) if m.file_type().is_symlink() => {
                if i + 1 == parts.len() && !follow_last {
                    return true;
                }
                linked = true;
                break;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    if !linked {
        return false;
    }
    let Ok(real) = std::fs::canonicalize(path) else { return true };
    if !roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|r| real.starts_with(r)) {
        return true;
    }
    if let Some(g) = git.and_then(|g| std::fs::canonicalize(g).ok()) {
        if real.starts_with(g) {
            return true;
        }
    }
    base.home.as_deref().and_then(|h| std::fs::canonicalize(h).ok()).is_some_and(|h| h.starts_with(&real))
}

/// Where `arg` points as text, or None when it cannot be known: a variable, another user's home,
/// a drive-relative path, or a relative path with no known base.
fn locate(arg: &str, dir: Option<&str>, base: &Base) -> Option<String> {
    let a = arg.trim();
    if a.is_empty() || a.contains(['$', '%', '`']) || drive_relative(a) {
        return None;
    }
    let a = match a.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => format!("{}{rest}", base.home.as_deref()?),
        Some(_) => return None,
        None => a.to_string(),
    };
    let full = if is_abs(&a) { a } else { format!("{}/{a}", dir?) };
    Some(norm(&full))
}

fn is_abs(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with(['/', '\\']) || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\'))
}

fn drive_relative(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && !is_abs(p)
}

/// A path as comparable text: backslashes to slashes, a Git Bash drive (`/c/x`) to `c:/x`, `.`
/// and `..` folded (never above the root), no trailing slash; letter case is ignored on Windows.
fn norm(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    if cfg!(windows) {
        p = p.to_ascii_lowercase();
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[0] == b'/' && b[1].is_ascii_alphabetic() && (b.len() == 2 || b[2] == b'/') {
        p = format!("{}:{}", &p[1..2], &p[2..]);
    }
    let abs = p.starts_with('/');
    let drive = p.len() >= 2 && p.as_bytes()[1] == b':';
    let mut parts: Vec<&str> = Vec::new();
    for part in p.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.len() > usize::from(drive) {
                    parts.pop();
                }
            }
            x => parts.push(x),
        }
    }
    let joined = parts.join("/");
    if abs { format!("/{joined}") } else { joined }
}

fn under(path: &str, root: &str) -> bool {
    path == root || (root == "/" && path.starts_with('/')) || path.starts_with(&format!("{root}/"))
}

/// The words of a command, quotes honoured and stripped.
fn words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut had = false;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '\'' || c == '"' => {
                quote = Some(c);
                had = true;
            }
            None if c.is_whitespace() => {
                if !cur.is_empty() || had {
                    out.push(std::mem::take(&mut cur));
                }
                had = false;
            }
            None => cur.push(c),
        }
    }
    if !cur.is_empty() || had {
        out.push(cur);
    }
    out
}

/// How a command's text is read (T-604, R03-safety-accounts.1). `Plain` reads it as written
/// (SAFE-014). `Shell` reads it as a shell would (`shell_text`): comments gone, escaped quotes and
/// the quotes of heredoc and here-string bodies plain text, continued lines joined, every other
/// backslash kept (a Windows path's separator). `Bash` is the same with a backslash before an
/// ordinary character dropped, as bash does (`g\it` is `git`); every word is read both ways. `Blind`
/// ignores quotes; it is read only when one of the other two ended inside a quote that never
/// closed. A rule asks when any reading trips it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reading {
    Plain,
    Shell,
    Bash,
    Blind,
}

/// One command as written, and where its program starts (`program_at`).
struct Seg {
    words: Vec<String>,
    at: usize,
}

impl Seg {
    /// The command with its wrappers dropped, so the program comes first.
    fn program_words(&self) -> &[String] {
        &self.words[self.at..]
    }
}

/// A command as the rules read it: its text and the chain of each reading, worked out once for
/// all seven rules and the user's own starts-with rules.
pub(crate) struct Read<'a> {
    text: &'a str,
    chains: Vec<Vec<Seg>>,
}

impl<'a> Read<'a> {
    pub(crate) fn new(text: &'a str) -> Self {
        Read { text, chains: chains(text) }
    }

    /// Every command of every reading, the program first.
    fn segments(&self) -> impl Iterator<Item = &[String]> {
        self.chains.iter().flatten().map(Seg::program_words)
    }
}

/// The chains a command is read as, one per reading (`Reading`): each the commands in order
/// (SAFE-014), split on `;`, `&`, `|`, newlines and grouping outside quotes, with `$( )` and
/// backtick substitutions pulled out (four levels deep) and what a shell is given to run (sh -c,
/// cmd /c, PowerShell -Command or encoded, eval, iex, wsl) read in its place.
fn chains(command: &str) -> Vec<Vec<Seg>> {
    let read = |r: Reading, open: &mut bool| {
        let mut chain = Vec::new();
        collect(command, 0, r, &mut chain, open);
        chain
    };
    let mut open = false;
    // The `Bash` reading differs from `Shell` only where a backslash is: in the text, or in what a
    // PowerShell encoded command decodes to. Without either it would be `Shell` again, so it is empty.
    let bash = command.contains('\\') || {
        let lower = command.to_ascii_lowercase();
        lower.contains("powershell") || lower.contains("pwsh")
    };
    let mut out = vec![read(Reading::Plain, &mut open), read(Reading::Shell, &mut open), if bash { read(Reading::Bash, &mut open) } else { Vec::new() }];
    if open {
        out.push(read(Reading::Blind, &mut open));
    }
    out
}

fn collect(text: &str, depth: usize, r: Reading, out: &mut Vec<Seg>, open: &mut bool) {
    if depth > 4 {
        return;
    }
    let shell;
    let text = match r {
        Reading::Shell | Reading::Bash => {
            shell = shell_text(text, r == Reading::Bash);
            shell.as_str()
        }
        _ => text,
    };
    let (outer, inners) = substitutions(text, r);
    for inner in inners {
        collect(&inner, depth + 1, r, out, open);
    }
    for part in split(&outer, r, open) {
        let words = words(&part);
        if let Some(inner) = env_split(&words) {
            collect(&inner, depth + 1, r, out, open);
            continue;
        }
        let at = program_at(&words, |_| {});
        if at == words.len() {
            continue;
        }
        match inner_command(&words[at..]) {
            Some(inner) => collect(&inner, depth + 1, r, out, open),
            None => out.push(Seg { words, at }),
        }
    }
}

/// T-604: `text` as a shell reads it, for the `Shell` reading. A `#` comment that begins a word
/// outside quotes and a PowerShell `<# #>` block go; a line ending in a backslash or a backtick
/// joins the next; a quote escaped with a backslash (not inside single quotes) or a backtick, and
/// every quote of a heredoc or PowerShell here-string body and of its closing mark, becomes `_`,
/// so none can open a quote that swallows the rest of the command. Bodies stay where they are and
/// are still read line by line, since a heredoc may feed a shell.
fn shell_text(text: &str, unescape: bool) -> String {
    let b = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut quote: Option<u8> = None;
    // Heredocs opened on the current line: each delimiter, and whether tabs may lead its closing line (`<<-`).
    let mut pending: Vec<(Vec<u8>, bool)> = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let (c, next) = (b[i], b.get(i + 1).copied());
        match quote {
            Some(b'\'') => {
                if c == b'\'' {
                    quote = None;
                }
                out.push(c);
            }
            Some(_) => {
                if let (b'\\' | b'`', Some(n)) = (c, next) {
                    // `\"`, `\\` and PowerShell's `` `" ``: the escaped character is text.
                    out.extend([c, if n == b'"' { b'_' } else { n }]);
                    i += 2;
                    continue;
                }
                if c == b'"' {
                    quote = None;
                }
                out.push(c);
            }
            None => {
                let continued = matches!(c, b'\\' | b'`') && (next == Some(b'\n') || (next == Some(b'\r') && b.get(i + 2) == Some(&b'\n')));
                if continued {
                    // Bash joins `\` + line break to nothing (`--ha\<LF>rd` is `--hard`);
                    // PowerShell's backtick leaves the words apart.
                    if c == b'`' {
                        out.push(b' ');
                    }
                    i += if next == Some(b'\r') { 3 } else { 2 };
                    continue;
                }
                if unescape && c == b'\\' && next.is_some_and(|n| !b"'\"`\\;&|()<>$#*?[~ \t\r\n".contains(&n)) {
                    // The `Bash` reading: a backslash before an ordinary character is dropped (`g\it`
                    // is `git`, `--forc\e` is `--force`, `\.\.` is `..`). One before a quote, a shell
                    // mark or a wildcard stays below, so the words split exactly as in `Shell`.
                    i += 1;
                    continue;
                }
                if let (b'\\' | b'`', Some(n)) = (c, next) {
                    // An escaped character is text: a quote opens nothing, a `#` starts no comment.
                    out.extend([c, plain(n)]);
                    i += 2;
                    continue;
                }
                if c == b'$' && next == Some(b'\'') {
                    // Bash's ANSI-C quote `$'..'`: a backslash escapes the next character, `\'`
                    // included, so its quote cannot swallow what follows.
                    out.extend(b"$'");
                    i += 2;
                    while i < b.len() && b[i] != b'\'' {
                        if b[i] == b'\\' && i + 1 < b.len() {
                            out.extend([b'\\', plain(b[i + 1])]);
                            i += 2;
                        } else {
                            out.push(b[i]);
                            i += 1;
                        }
                    }
                    if i < b.len() {
                        out.push(b'\'');
                        i += 1;
                    }
                    continue;
                }
                if c == b'$' && (b[i..].starts_with(b"${IFS}") || (b[i..].starts_with(b"$IFS") && !b.get(i + 4).is_some_and(|x| x.is_ascii_alphanumeric() || *x == b'_'))) {
                    // `$IFS` splits words as a space does.
                    out.push(b' ');
                    i += if b[i + 1] == b'{' { 6 } else { 4 };
                    continue;
                }
                if matches!(c, b'\'' | b'"') && i > 0 && b[i - 1] == b'@' && (next == Some(b'\n') || next == Some(b'\r')) {
                    // A PowerShell here-string, `@'` to a line that begins `'@`.
                    out.push(b'_');
                    i = copy_body(b, i + 1, &mut out, |line| (line.len() >= 2 && line[0] == c && line[1] == b'@').then_some(2));
                    continue;
                }
                if matches!(c, b'\'' | b'"') {
                    quote = Some(c);
                } else if c == b'#' && (i == 0 || matches!(b[i - 1], b' ' | b'\t' | b'\r' | b'\n' | b';' | b'&' | b'|' | b'(' | b')')) {
                    i += b[i..].iter().position(|&x| x == b'\n').unwrap_or(b.len() - i);
                    continue;
                } else if c == b'<' && next == Some(b'#') {
                    out.push(b' ');
                    i = b[i + 2..].windows(2).position(|w| w == b"#>").map_or(b.len(), |k| i + 2 + k + 2);
                    continue;
                } else if c == b'<' && next == Some(b'<') && b.get(i + 2) != Some(&b'<') && (i == 0 || b[i - 1] != b'<') {
                    let dash = b.get(i + 2) == Some(&b'-');
                    let mut q = i + 2 + usize::from(dash);
                    q += b[q..].iter().take_while(|x| matches!(x, b' ' | b'\t')).count();
                    let word = b[q..].iter().take_while(|x| !(x.is_ascii_whitespace() || matches!(x, b';' | b'|' | b'&' | b'<' | b'>' | b'(' | b')'))).count();
                    let delimiter: Vec<u8> = b[q..q + word].iter().copied().filter(|x| !matches!(x, b'"' | b'\'' | b'\\')).collect();
                    if !delimiter.is_empty() {
                        pending.push((delimiter, dash));
                    }
                    out.extend_from_slice(&b[i..q + word]);
                    i = q + word;
                    continue;
                } else if c == b'\n' && !pending.is_empty() {
                    // The end of a line that opened heredocs: their bodies follow, one after another.
                    out.push(c);
                    i += 1;
                    for (delimiter, dash) in std::mem::take(&mut pending) {
                        i = copy_body(b, i, &mut out, |line| {
                            let t = line.strip_suffix(b"\r").unwrap_or(line);
                            let t = if dash { &t[t.iter().take_while(|x| **x == b'\t').count()..] } else { t };
                            (t == delimiter.as_slice()).then_some(line.len())
                        });
                    }
                    continue;
                }
                out.push(c);
            }
        }
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

/// A quote or backtick as plain text (`_`), anything else as it is.
fn plain(c: u8) -> u8 {
    if matches!(c, b'\'' | b'"' | b'`') {
        b'_'
    } else {
        c
    }
}

/// Copies the lines of a heredoc or here-string body from `from` into `out` with every quote and
/// backtick plain (`_`), up to the line that `closes`: it answers how many of that line's bytes
/// close the body, and those are copied too. Returns where reading goes on, the end of the text
/// when no line closes the body.
fn copy_body(b: &[u8], from: usize, out: &mut Vec<u8>, closes: impl Fn(&[u8]) -> Option<usize>) -> usize {
    let mut line = from;
    while line < b.len() {
        let end = b[line..].iter().position(|&x| x == b'\n').map_or(b.len(), |k| line + k);
        let shut = closes(&b[line..end]).map(|n| line + n);
        let stop = shut.unwrap_or((end + 1).min(b.len()));
        out.extend(b[line..stop].iter().map(|&c| plain(c)));
        if shut.is_some() {
            return stop;
        }
        line = stop;
    }
    b.len()
}

/// `$( )` and backtick substitutions pulled out of `text`: the outer text with each replaced by
/// `$sub` (so it reads as a variable), and the inner commands. Single quotes hide them; in the
/// `Shell` reading a `'` inside double quotes is text (`"it's" $(..)`), and in the `Blind` one
/// nothing hides them.
fn substitutions(text: &str, r: Reading) -> (String, Vec<String>) {
    let c: Vec<char> = text.chars().collect();
    let mut outer = String::new();
    let mut inners = Vec::new();
    let (mut single, mut double) = (false, false);
    let mut i = 0;
    while i < c.len() {
        if c[i] == '\'' && r != Reading::Blind && !double {
            single = !single;
        } else if c[i] == '"' && matches!(r, Reading::Shell | Reading::Bash) && !single {
            double = !double;
        } else if !single && c[i] == '$' && c.get(i + 1) == Some(&'(') {
            let mut depth = 0;
            let mut j = i + 1;
            while j < c.len() {
                if c[j] == '(' {
                    depth += 1;
                } else if c[j] == ')' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                j += 1;
            }
            inners.push(c[(i + 2).min(j)..j.min(c.len())].iter().collect());
            outer.push_str("$sub");
            i = j + 1;
            continue;
        } else if !single && c[i] == '`' {
            let j = c[i + 1..].iter().position(|&x| x == '`').map_or(c.len(), |p| i + 1 + p);
            inners.push(c[i + 1..j].iter().collect());
            outer.push_str("$sub");
            i = j + 1;
            continue;
        }
        outer.push(c[i]);
        i += 1;
    }
    (outer, inners)
}

/// The pieces of a chain: split on `;`, `&`, `|`, newlines and grouping marks outside quotes (in
/// the `Blind` reading, everywhere). `open` hears of a quote that never closed.
fn split(text: &str, r: Reading, open: &mut bool) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    // T-604b (e): an odd run of backslashes before a bracket escapes it (`\(` is find's own group),
    // so it is not a command separator.
    let mut slashes = 0u32;
    for c in text.chars() {
        let escaped = slashes % 2 == 1;
        match quote {
            Some(q) if c == q => {
                quote = None;
                cur.push(c);
            }
            Some(_) => cur.push(c),
            None if (c == '\'' || c == '"') && r != Reading::Blind => {
                quote = Some(c);
                cur.push(c);
            }
            None if escaped && matches!(c, '(' | ')' | '{' | '}') => cur.push(c),
            None if matches!(c, ';' | '&' | '|' | '\n' | '(' | ')' | '{' | '}') => parts.push(std::mem::take(&mut cur)),
            None => cur.push(c),
        }
        slashes = if quote.is_none() && c == '\\' { slashes + 1 } else { 0 };
    }
    *open |= quote.is_some();
    parts.push(cur);
    parts
}

/// Wrapper programs and the options of theirs that take a value, so neither is mistaken for the
/// program (SAFE-014, audit finding S2).
const WRAPPERS: [(&str, &[&str]); 19] = [
    ("sudo", &["u", "g", "C", "D", "h", "p", "r", "t", "T", "U", "user", "group", "host", "prompt", "chdir", "role", "type", "close-from"]),
    ("doas", &["u", "C"]),
    ("nohup", &[]),
    ("time", &[]),
    ("exec", &[]),
    ("command", &[]),
    ("builtin", &[]),
    ("start", &[]),
    ("nice", &["n", "adjustment"]),
    ("env", &["u", "C", "S", "unset", "chdir", "split-string"]),
    ("xargs", &["I", "i", "n", "P", "d", "s", "L", "E", "a", "max-args", "max-procs", "delimiter", "replace", "max-lines", "max-chars", "arg-file", "eof"]),
    ("timeout", &["s", "k", "signal", "kill-after"]),
    ("npx", &["p", "package"]),
    ("bunx", &["p", "package"]),
    ("pnpm", &[]),
    ("yarn", &[]),
    ("npm", &[]),
    ("bun", &[]),
    ("wsl", &["d", "u", "distribution", "user", "cd"]),
];

/// Where the program starts in `w`: past leading assignments, wrapper programs with their options,
/// the timeout length and a package runner's exec subcommand. Every step passes words at the
/// front only, so `step` hears where each one leaves the command (T-604: the user's starts-with
/// rules match at any of them), and it counts instead of removing from the front, so a long run
/// of wrappers or assignments stays linear (R03-safety-accounts.2).
fn program_at(w: &[String], mut step: impl FnMut(usize)) -> usize {
    let mut k = 0;
    loop {
        step(k);
        let Some(first) = w.get(k) else { return k };
        if first.contains('=') && !first.starts_with('-') {
            k += 1;
            continue;
        }
        let f = program(&w[k..]);
        let Some((_, values)) = WRAPPERS.iter().find(|(n, _)| *n == f) else { return k };
        k += 1;
        if matches!(f.as_str(), "pnpm" | "yarn" | "npm" | "bun") {
            if w.get(k).is_some_and(|s| matches!(s.as_str(), "exec" | "dlx" | "x")) {
                k += 1;
            }
            continue;
        }
        while let Some(o) = w.get(k) {
            if f == "start" && o.eq_ignore_ascii_case("/d") {
                // cmd's `start /D folder`: the folder is not the program.
                k = (k + 2).min(w.len());
                continue;
            }
            if (f == "start" && (o.is_empty() || o.starts_with('/'))) || (f == "wsl" && matches!(o.as_str(), "--" | "-e" | "--exec")) {
                k += 1;
                continue;
            }
            if !o.starts_with('-') || o == "-" {
                break;
            }
            let body = o.trim_start_matches('-');
            let takes_next = if o.starts_with("--") { !body.contains('=') && values.contains(&body) } else { body.len() == 1 && values.contains(&body) };
            k = (k + 1 + usize::from(takes_next)).min(w.len());
        }
        if f == "timeout" && k < w.len() {
            k += 1;
        }
    }
}

impl Read<'_> {
    /// T-604 (R03-safety-accounts.3, SAFE-016): whether one of the commands, in any reading, begins
    /// with `want` (lower-case words, the first a program name) at any step of `program_at`:
    /// `npm publish`, `sudo npm publish`, `npx prisma ..`, `C:\tools\kubectl.exe delete ..` and
    /// `bash -c "kubectl delete .."` each begin with what they run.
    pub(crate) fn start_with(&self, want: &[String]) -> bool {
        let Some((first, rest)) = want.split_first() else { return false };
        let first = program(std::slice::from_ref(first));
        self.chains.iter().flatten().any(|s| {
            let mut hit = false;
            program_at(&s.words, |k| {
                let w = &s.words[k..];
                hit |= w.len() > rest.len() && program(w) == first && w[1..=rest.len()].iter().zip(rest).all(|(a, b)| a.to_lowercase() == *b);
            });
            hit
        })
    }
}

enum Ps {
    Command,
    Encoded,
    File,
    Value,
    Flag,
}

/// What a PowerShell switch (lowercased, dashes off) means under any unambiguous shortening:
/// -Command, -EncodedCommand, -File, a switch that takes a value, or a plain flag (audit S1).
fn ps_switch(name: &str) -> Ps {
    const VALUES: [&str; 10] = ["executionpolicy", "windowstyle", "workingdirectory", "inputformat", "outputformat", "configurationname", "psconsolefile", "version", "settingsfile", "custompipename"];
    const SHORT: [&str; 8] = ["ep", "wd", "if", "of", "inp", "o", "w", "v"];
    if name.is_empty() || name == "i" {
        Ps::Flag
    } else if "command".starts_with(name) {
        Ps::Command
    } else if "encodedcommand".starts_with(name) || name == "ec" {
        Ps::Encoded
    } else if "file".starts_with(name) {
        Ps::File
    } else if SHORT.contains(&name) || VALUES.iter().any(|v| v.starts_with(name)) {
        Ps::Value
    } else {
        Ps::Flag
    }
}

/// The command a shell in `w` is told to run (SAFE-014), or None for a plain program, a
/// PowerShell -File run, or a shell reading its script from a file or stdin.
fn inner_command(w: &[String]) -> Option<String> {
    let args = &w[1..];
    match program(w).as_str() {
        "sh" | "bash" | "zsh" | "dash" | "ksh" | "fish" | "ash" | "busybox" => {
            let i = args.iter().position(|a| a.starts_with('-') && !a.starts_with("--") && a[1..].contains('c'))?;
            args.get(i + 1).cloned()
        }
        "eval" | "iex" | "invoke-expression" => Some(args.join(" ")).filter(|s| !s.is_empty()),
        "git" => git_alias(w),
        "cmd" => {
            let i = args.iter().position(|a| {
                let s = a.trim_start_matches('/').to_ascii_lowercase();
                a.starts_with('/') && (s == "c" || s == "k" || s.ends_with("/c") || s.ends_with("/k"))
            })?;
            Some(args[i + 1..].join(" ")).filter(|s| !s.is_empty())
        }
        "powershell" | "pwsh" => {
            let mut i = 0;
            while i < args.len() {
                let a = &args[i];
                i += 1;
                let Some(sw) = a.strip_prefix('-') else {
                    // A bare word is a command to run, unless it is a script file.
                    return if a.to_ascii_lowercase().ends_with(".ps1") { None } else { Some(args[i - 1..].join(" ")) };
                };
                let (name, attached) = match sw.split_once(':') {
                    Some((n, v)) => (n.to_ascii_lowercase(), Some(v.to_string())),
                    None => (sw.to_ascii_lowercase(), None),
                };
                match ps_switch(&name) {
                    Ps::Command => {
                        let rest: Vec<String> = attached.into_iter().chain(args[i..].iter().cloned()).collect();
                        return Some(rest.join(" ")).filter(|s| !s.is_empty() && s != "-");
                    }
                    Ps::Encoded => {
                        let value = attached.or_else(|| args.get(i).cloned())?;
                        return decode_ps(&value);
                    }
                    Ps::File => return None,
                    Ps::Value => i += usize::from(attached.is_none()),
                    Ps::Flag => {}
                }
            }
            None
        }
        _ => None,
    }
}

/// A git command that runs an alias defined on its own command line (`git -c alias.p='push -f' p
/// main`): `git` and the alias expanded in its place, or for a `!` alias the shell
/// command it runs, with the remaining words after it. Alias names match case-blind, as git's do.
fn git_alias(w: &[String]) -> Option<String> {
    let mut aliases: Vec<(String, &str)> = Vec::new();
    let mut i = 1;
    while i < w.len() {
        let a = w[i].as_str();
        if !a.starts_with('-') {
            break;
        }
        let takes_value = matches!(a, "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--exec-path" | "--super-prefix");
        if a == "-c" {
            if let Some((key, value)) = w.get(i + 1).and_then(|v| v.split_once('=')) {
                if let Some(name) = key.to_ascii_lowercase().strip_prefix("alias.") {
                    aliases.push((name.to_string(), value));
                }
            }
        }
        i += if takes_value { 2 } else { 1 };
    }
    let sub = w.get(i)?.to_ascii_lowercase();
    let (_, value) = aliases.iter().rev().find(|(n, _)| *n == sub)?;
    let rest = w[i + 1..].join(" ");
    Some(match value.strip_prefix('!') {
        Some(shell) => format!("{shell} {rest}"),
        None => format!("git {value} {rest}"),
    })
}

/// What `env -S` / `--split-string` is given to run, with the words after it, read as a command
/// of its own (`env -S 'git push -f origin main'`), found at any wrapper step of `program_at`.
fn env_split(words: &[String]) -> Option<String> {
    let mut found = None;
    program_at(words, |k| {
        if found.is_some() || program(&words[k..]) != "env" {
            return;
        }
        let mut j = k + 1;
        while let Some(o) = words.get(j) {
            let value = if o == "-S" || o == "--split-string" {
                j += 1;
                words.get(j).cloned()
            } else if let Some(v) = o.strip_prefix("--split-string=") {
                Some(v.to_string())
            } else if let Some(v) = o.strip_prefix("-S") {
                Some(v.to_string())
            } else if matches!(o.as_str(), "-u" | "-C" | "--unset" | "--chdir") {
                j += 2;
                continue;
            } else if o.starts_with('-') && o.len() > 1 {
                j += 1;
                continue;
            } else {
                break;
            };
            found = value.map(|v| std::iter::once(v).chain(words[j + 1..].iter().cloned()).collect::<Vec<_>>().join(" "));
            break;
        }
    });
    found
}

/// A PowerShell encoded command: base64 of UTF-16LE text.
fn decode_ps(b64: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    Some(String::from_utf16_lossy(&units))
}

/// The program name of a segment, without its folder or `.exe`.
fn program(seg: &[String]) -> String {
    let p = seg.first().map(String::as_str).unwrap_or("");
    let mut p = p.rsplit(['/', '\\']).next().unwrap_or(p).to_ascii_lowercase();
    if p.ends_with(".exe") || p.ends_with(".cmd") {
        p.truncate(p.len() - 4);
    }
    p
}

fn is_search(seg: &[String]) -> bool {
    let p = program(seg);
    matches!(p.as_str(), "grep" | "rg" | "ag" | "ack" | "findstr" | "select-string" | "sls") || (p == "git" && seg.get(1).is_some_and(|s| s == "grep"))
}

// SAFE-010: force-push or deletion aimed at main/master (or an unclear target), by `git push`.
fn force_push(c: &Read, _base: &Base) -> bool {
    c.segments().any(|seg| {
        let Some(args) = git_args(seg, "push") else { return false };
        let mut force = false;
        let mut delete = false;
        let mut all = false;
        let mut refspecs: Vec<&str> = Vec::new();
        let mut positional = 0;
        for a in args {
            if a.starts_with("--") {
                // git takes any unambiguous shortening of a long option (`--del`, `--force-w`,
                // `--mirr`); an ambiguous one is refused by git, so reading it as either asks safely.
                let name = a.split_once('=').map_or(a.as_str(), |(k, _)| k).trim_start_matches('-');
                let is = |full: &[&str]| !name.is_empty() && full.iter().any(|f| f.starts_with(name));
                force |= is(&["force", "force-with-lease", "force-if-includes", "mirror"]);
                delete |= is(&["delete"]);
                all |= ["all", "branches", "tags"].contains(&name);
            } else if a.starts_with('-') && a.len() > 1 {
                force |= a.contains('f');
                delete |= a.contains('d');
            } else if let Some(r) = a.strip_prefix('+') {
                force = true;
                refspecs.push(r);
            } else {
                positional += 1;
                if positional > 1 {
                    // An empty source (`:main`) deletes the branch it names.
                    delete |= a.starts_with(':');
                    refspecs.push(a);
                }
            }
        }
        if !force && !delete {
            return false;
        }
        if all || refspecs.is_empty() {
            return true;
        }
        refspecs.iter().any(|r| {
            let r: &str = r;
            let dst = r.split_once(':').map_or(r, |(_, d)| d);
            if dst.is_empty() {
                return false;
            }
            let name = dst.rsplit('/').next().unwrap_or(dst);
            matches!(name, "main" | "master" | "HEAD" | "@") || dst.contains('$') || dst.contains('`')
        })
    })
}

/// The arguments after git's subcommand `sub`, with git's own options before it skipped.
fn git_args<'a>(seg: &'a [String], sub: &str) -> Option<&'a [String]> {
    if program(seg) != "git" {
        return None;
    }
    let mut i = 1;
    while i < seg.len() {
        let w = seg[i].as_str();
        if w == sub {
            return Some(&seg[i + 1..]);
        }
        if !w.starts_with('-') {
            return None;
        }
        // These take their value as the next word unless written with `=`.
        let takes_value = matches!(w, "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--exec-path" | "--super-prefix");
        i += if takes_value { 2 } else { 1 };
    }
    None
}

// SAFE-010: a hard reset, or a forced clean that is not a dry run.
fn discard(c: &Read, _base: &Base) -> bool {
    c.segments().any(|seg| {
        if let Some(args) = git_args(seg, "reset") {
            return args.iter().any(|a| a.len() > 2 && a.starts_with("--") && "hard".starts_with(&a[2..]));
        }
        if let Some(args) = git_args(seg, "clean") {
            let dry = args.iter().any(|a| a == "--dry-run" || (a.starts_with('-') && !a.starts_with("--") && a.contains('n')));
            let force = args.iter().any(|a| (a.len() > 2 && a.starts_with("--") && "force".starts_with(&a[2..])) || (a.starts_with('-') && !a.starts_with("--") && a.contains('f')));
            return force && !dry;
        }
        false
    })
}

// SAFE-011: a database client given a drop or truncate anywhere on the line, or dropdb itself.
fn db_drop(c: &Read, _base: &Base) -> bool {
    const CLIENTS: [&str; 18] = ["psql", "mysql", "mariadb", "sqlite3", "sqlcmd", "mongosh", "mongo", "supabase", "prisma", "wrangler", "bq", "duckdb", "turso", "pscale", "neonctl", "cockroach", "clickhouse-client", "usql"];
    if c.segments().any(|s| program(s) == "dropdb") {
        return true;
    }
    if !c.segments().any(|s| CLIENTS.contains(&program(s).as_str())) {
        return false;
    }
    let text = c.text.to_ascii_lowercase();
    if text.contains("truncate") || text.contains(".drop(") || text.contains("dropdatabase(") || text.contains("dropcollection(") {
        return true;
    }
    let toks: Vec<&str> = text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|t| !t.is_empty()).collect();
    toks.iter().enumerate().any(|(i, t)| {
        *t == "drop"
            && toks[i + 1..]
                .iter()
                .take(3)
                .any(|k| matches!(*k, "table" | "database" | "schema" | "view" | "index" | "user" | "role" | "collection" | "type" | "sequence" | "function" | "trigger"))
    })
}

// SAFE-012: live Stripe data changes.
fn stripe(c: &Read, _base: &Base) -> bool {
    const VERBS: [&str; 12] = ["create", "update", "delete", "cancel", "refund", "post", "capture", "confirm", "void", "detach", "attach", "trigger"];
    let lower = c.text.to_ascii_lowercase();
    if (lower.contains("sk_live_") || lower.contains("rk_live_")) && !c.segments().all(is_search) {
        return true;
    }
    c.segments().any(|seg| program(seg) == "stripe" && (seg.iter().any(|a| a == "--live") || seg.iter().skip(1).take(3).any(|w| VERBS.contains(&w.to_ascii_lowercase().as_str()))))
}

// SAFE-012: applying or tearing down infrastructure.
fn infra(c: &Read, _base: &Base) -> bool {
    c.segments().any(|seg| {
        let subs: Vec<String> = seg.iter().skip(1).filter(|a| !a.starts_with('-')).take(2).map(|s| s.to_ascii_lowercase()).collect();
        let first = subs.first().map(String::as_str).unwrap_or("");
        let second = subs.get(1).map(String::as_str).unwrap_or("");
        match program(seg).as_str() {
            "terraform" | "tofu" => matches!(first, "apply" | "destroy"),
            "terragrunt" => matches!(first, "apply" | "destroy") || (first == "run-all" && matches!(second, "apply" | "destroy")),
            "pulumi" => matches!(first, "up" | "update" | "destroy"),
            "cdk" => matches!(first, "deploy" | "destroy"),
            _ => false,
        }
    })
}

// SAFE-012: a production marker together with a deployment tool or a deploy verb.
fn prod_deploy(c: &Read, _base: &Base) -> bool {
    const CLIS: [&str; 14] = ["vercel", "netlify", "firebase", "wrangler", "fly", "flyctl", "railway", "heroku", "gcloud", "az", "serverless", "sls", "sst", "eb"];
    c.segments().any(|seg| {
        let lower: Vec<String> = seg.iter().map(|w| w.to_ascii_lowercase()).collect();
        let marker = lower.iter().any(|w| {
            let bare = w.trim_start_matches('-');
            matches!(bare.rsplit_once('=').map_or(bare, |(_, v)| v), "prod" | "production")
        });
        marker && (CLIS.contains(&program(seg).as_str()) || lower.iter().any(|w| w == "deploy"))
    })
}

// SAFE-015: what the Safety page lists. The page reads this so its names and examples can never
// drift from the rules that actually ask.
#[derive(serde::Serialize)]
pub struct RuleInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub samples: [&'static str; 2],
}

/// The built-in rules in the order they are checked.
pub fn catalog() -> Vec<RuleInfo> {
    RULES.iter().map(|r| RuleInfo { id: r.id, name: r.name, samples: r.samples }).collect()
}

#[tauri::command]
pub fn protected_rules() -> Vec<RuleInfo> {
    catalog()
}

// SAFE-019: a command that was paused is masked before it is kept or shown. Pure text in, text
// out; nothing here reads a file or the clock. Stripe secret keys keep their prefix and last four
// characters (enough to tell two keys apart); everything else a secret could be is replaced by
// HIDDEN. The passes run in this order, and a second run changes nothing.
pub const HIDDEN: &str = "[hidden]";

const STRIPE_PREFIXES: [&str; 5] = ["sk_live_", "sk_test_", "rk_live_", "rk_test_", "whsec_"];

/// The passes are run again until a run changes nothing (fix-hooks AFTER, masking fuzz): a hidden
/// value's `]` can give a secret glued right after it the word start it lacked, so one run could
/// leave that secret showing and a second hide it. Each extra run only hides more; MASK_RUNS caps
/// the loop.
#[allow(dead_code)] // the recent-attempts list (T-156-b, SAFE-018) is its first caller
pub fn mask(text: &str) -> String {
    mask_cut(text, false)
}

/// T-604 (R03-safety-accounts.2): `mask` of the first `n` characters of `text`, the part a long
/// command is shown by, so masking takes the same time however long the command is. Where the cut
/// fell inside a JSON secret value, the value is hidden to the end (`json_values`).
pub fn mask_head(text: &str, n: usize) -> String {
    let head = text.char_indices().nth(n).map_or(text, |(i, _)| &text[..i]);
    mask_cut(head, head.len() < text.len())
}

fn mask_cut(text: &str, cut: bool) -> String {
    let mut t = mask_once(text, cut);
    for _ in 1..MASK_RUNS {
        let next = mask_once(&t, cut);
        if next == t {
            break;
        }
        t = next;
    }
    t
}

const MASK_RUNS: usize = 8;

fn mask_once(text: &str, cut: bool) -> String {
    let t = stripe_keys(text);
    let t = pem_blocks(&t);
    let t = url_credentials(&t);
    let t = provider_keys(&t);
    let t = auth_headers(&t);
    let t = header_values(&t);
    let t = json_values(&t, cut);
    let t = piped_passwords(&t);
    let t = secure_strings(&t);
    let t = secret_flags(&t);
    let t = labelled_values(&t);
    env_lines(&t)
}

/// Rewrites `t`: at each byte offset `f` may claim a span `i..end` and give its replacement.
fn scan(t: &str, f: impl Fn(&str, usize) -> Option<(usize, String)>) -> String {
    let mut out = String::with_capacity(t.len());
    let (mut i, mut last) = (0, 0);
    while i < t.len() {
        match f(t, i) {
            Some((end, rep)) if end > i && t.is_char_boundary(end) => {
                out.push_str(&t[last..i]);
                out.push_str(&rep);
                i = end;
                last = end;
            }
            _ => i += 1,
        }
    }
    out.push_str(&t[last..]);
    out
}

/// How many leading bytes of `s` are accepted by `ok` (ASCII only, so the cut is a char boundary).
fn run(s: &str, ok: impl Fn(u8) -> bool) -> usize {
    s.bytes().take_while(|b| ok(*b)).count()
}

/// A word begins at `i` when the byte before it is not a letter or digit.
fn word_start(t: &str, i: usize) -> bool {
    i == 0 || !t.as_bytes()[i - 1].is_ascii_alphanumeric()
}

fn key_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn stripe_keys(t: &str) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?;
        // Not inside a longer name such as `my_sk_live_...` (a file name), unlike `KEY=sk_live_...`.
        if !word_start(t, i) || (i > 0 && t.as_bytes()[i - 1] == b'_') {
            return None;
        }
        for p in STRIPE_PREFIXES {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_alphanumeric());
                if n >= 8 {
                    return Some((i + p.len() + n, format!("{p}....{}", &tail[n - 4..n])));
                }
            }
        }
        None
    })
}

/// A private key block (any `-----BEGIN ... PRIVATE KEY-----`) up to its END line, or to the end
/// of the text when it was cut short.
fn pem_blocks(t: &str) -> String {
    scan(t, |t, i| {
        let head = t.get(i..)?.strip_prefix("-----BEGIN ")?;
        let close = head.find("-----")?;
        if !head[..close].ends_with("PRIVATE KEY") {
            return None;
        }
        let after = i + "-----BEGIN ".len() + close + 5;
        let end = match t[after..].find("-----END ") {
            Some(k) => {
                let e = after + k + "-----END ".len();
                t[e..].find("-----").map_or(t.len(), |m| e + m + 5)
            }
            None => t.len(),
        };
        Some((end, HIDDEN.to_string()))
    })
}

/// `scheme://user:password@host`: the user and password go, in any scheme.
fn url_credentials(t: &str) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?.strip_prefix("://")?;
        let auth = run(rest, |b| !(b.is_ascii_whitespace() || matches!(b, b'/' | b'?' | b'#' | b'\'' | b'"' | b'`' | b'<' | b'>')));
        let at = rest[..auth].rfind('@')?;
        let info = &rest[..at];
        (info.contains(':') && info != HIDDEN).then(|| (i + 3 + at, format!("://{HIDDEN}")))
    })
}

/// Well-known provider keys: Anthropic, OpenAI, xAI, Google, GitHub, GitLab, npm, Hugging Face, AWS, Slack and JSON web tokens.
fn provider_keys(t: &str) -> String {
    // (prefix, shortest tail) over letters, digits, `_` and `-`.
    const KEYS: [(&str, usize); 12] = [("sk-ant-", 16), ("sk-", 20), ("xai-", 20), ("AIza", 30), ("ghp_", 30), ("gho_", 30), ("ghu_", 30), ("ghs_", 30), ("ghr_", 30), ("github_pat_", 20), ("glpat-", 20), ("xox", 0)];
    // npm and Hugging Face tokens are letters and digits only after the prefix, so an identifier
    // such as `npm_config_cache` or `hf_hub_download` is never mistaken for one.
    const PLAIN_KEYS: [(&str, usize); 2] = [("npm_", 36), ("hf_", 30)];
    scan(t, |t, i| {
        if !word_start(t, i) {
            return None;
        }
        let rest = t.get(i..)?;
        for (p, min) in KEYS {
            if let Some(tail) = rest.strip_prefix(p) {
                if p == "xox" {
                    // Slack: xoxb-, xoxa-, xoxp-, xoxr-, xoxs- and a long run after it.
                    let kind = tail.as_bytes().first().copied();
                    let after = tail.get(1..)?.strip_prefix('-')?;
                    let n = run(after, |b| b.is_ascii_alphanumeric() || b == b'-');
                    if matches!(kind, Some(b'a' | b'b' | b'p' | b'r' | b's')) && n >= 10 {
                        return Some((i + 5 + n, HIDDEN.to_string()));
                    }
                    continue;
                }
                let n = run(tail, key_char);
                if n >= min {
                    return Some((i + p.len() + n, HIDDEN.to_string()));
                }
            }
        }
        for (p, min) in PLAIN_KEYS {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_alphanumeric());
                if n >= min {
                    return Some((i + p.len() + n, HIDDEN.to_string()));
                }
            }
        }
        for p in ["AKIA", "ASIA"] {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_uppercase() || b.is_ascii_digit());
                if n >= 16 {
                    return Some((i + 4 + n, HIDDEN.to_string()));
                }
            }
        }
        if rest.starts_with("eyJ") {
            let a = run(rest, key_char);
            let r1 = rest[a..].strip_prefix('.')?;
            let b = run(r1, key_char);
            let r2 = r1[b..].strip_prefix('.')?;
            let c = run(r2, key_char);
            if a >= 8 && b >= 4 && c >= 1 {
                return Some((i + a + 1 + b + 1 + c, HIDDEN.to_string()));
            }
        }
        None
    })
}

/// `Bearer <token>` and `Basic <encoded>` as an Authorization header carries them.
fn auth_headers(t: &str) -> String {
    let context = HeaderContext::new(t);
    scan(t, |t, i| {
        if !word_start(t, i) {
            return None;
        }
        let rest = t.get(i..)?;
        for word in ["bearer ", "basic "] {
            let head = rest.get(..word.len())?;
            if head.eq_ignore_ascii_case(word) {
                let tail = &rest[word.len()..];
                let n = run(tail, |b| b.is_ascii_alphanumeric() || b"._~+/=-".contains(&b));
                // Plain prose after "basic" is not a token: a token has a digit or a symbol in it,
                // or, where a header carries it, mixes upper and lower case the way encoded text does.
                let body = &tail[..n];
                let mixed = body.bytes().any(|b| b.is_ascii_uppercase()) && body.bytes().any(|b| b.is_ascii_lowercase());
                if n >= 8 && (body.bytes().any(|b| !b.is_ascii_alphabetic()) || (mixed && context.holds(i))) {
                    return Some((i + word.len() + n, format!("{head}{HIDDEN}")));
                }
            }
        }
        None
    })
}

/// Whether the text before `i` says a header is being written (`holds`): `Authorization` or
/// `--header` on its line, or curl's `-H` in the command that `i` belongs to. One text is asked about
/// at many offsets, so what each answer needs is looked up in an index built once (S9 row 833: a
/// scan of everything before `i` per label was quadratic).
struct HeaderContext<'a> {
    t: &'a str,
    index: OnceCell<HeaderIndex>,
    /// `(offset, command start there)` of the last `command_start` answer.
    start: Cell<Option<(usize, usize)>>,
}

/// The bytes that can move `segment_start` or change what its quote look-ahead sees: quotes and the
/// backslash, line breaks, separators, brackets, backtick, and `>` (it makes a `&` after it a redirect).
const SEGMENT_MOVERS: &[u8] = b"\"'\\\n;|&()`>";

/// Where the things `HeaderContext::holds` looks for sit in the text.
struct HeaderIndex {
    newlines: Vec<usize>,
    /// `)` and backtick: the only bytes that can move a command's start back before its line.
    closers: Vec<usize>,
    labels: Marks,
    dash_h: Marks,
    programs: Marks,
}

impl<'a> HeaderContext<'a> {
    fn new(t: &'a str) -> Self {
        Self { t, index: OnceCell::new(), start: Cell::new(None) }
    }

    /// `segment_start(&t[..i])`, reused from the last answer when nothing between the two offsets
    /// can change the scanner's state (S9 row 833: a `)` or `curl -H x;` earlier on the line made
    /// every later label rescan the line).
    // ponytail: `token:;` repeated still rescans (each `;` is a mover); that needs a resumable `segment_start`.
    fn command_start(&self, i: usize) -> usize {
        let b = self.t.as_bytes();
        let kept = self.start.get().filter(|&(from, _)| from <= i && !b[from..i].iter().any(|c| SEGMENT_MOVERS.contains(c)));
        let start = kept.map_or_else(|| segment_start(&self.t[..i]), |(_, start)| start);
        self.start.set(Some((i, start)));
        start
    }

    fn holds(&self, i: usize) -> bool {
        let ix = self.index.get_or_init(|| HeaderIndex::new(self.t));
        let line = ix.newlines.partition_point(|&n| n < i).checked_sub(1).map_or(0, |k| ix.newlines[k] + 1);
        if ix.labels.within(line, i) {
            return true;
        }
        // The command `i` belongs to starts at or after its line (`segment_start`: a line break is a
        // hard start) unless a `)` or backtick closed on this line; its words then lie inside the line,
        // so with no `-H` or no HTTP program there they cannot say yes.
        let k = ix.closers.partition_point(|&c| c < line);
        let closed = ix.closers.get(k).is_some_and(|&c| c < i);
        if !closed && !(ix.dash_h.within(line, i) && ix.programs.within(line, i)) {
            return false;
        }
        // Each word is a lower-cased piece of the command's own text, so `-h` and a program name
        // must occur wholly inside it before reading its words can say yes.
        let start = self.command_start(i);
        if !(ix.dash_h.within(start, i) && ix.programs.within(start, i)) {
            return false;
        }
        let words = words_in(self.t, start, i);
        words.iter().any(|w| w.name == "-h") && runs(&words, |w| matches!(w, "curl" | "wget" | "http" | "https" | "xh"))
    }
}

impl HeaderIndex {
    fn new(t: &str) -> Self {
        let b = t.as_bytes();
        let positions = |want: &[u8]| b.iter().enumerate().filter(|(_, c)| want.contains(c)).map(|(p, _)| p).collect();
        Self {
            newlines: positions(b"\n"),
            closers: positions(b")`"),
            labels: Marks::find(b, &["authorization", "--header"]),
            dash_h: Marks::find(b, &["-h"]),
            programs: Marks::find(b, &["curl", "wget", "http", "xh"]),
        }
    }
}

/// Where words occur in a text, ignoring ASCII case: `(start, end)` by start.
struct Marks {
    spans: Vec<(usize, usize)>,
    /// `min_end[k]`: the smallest end among `spans[k..]`.
    min_end: Vec<usize>,
}

impl Marks {
    fn find(b: &[u8], words: &[&str]) -> Self {
        let mut spans = Vec::new();
        for (p, c) in b.iter().enumerate() {
            for w in words {
                let w = w.as_bytes();
                if c.eq_ignore_ascii_case(&w[0]) && b.len() - p >= w.len() && b[p..p + w.len()].eq_ignore_ascii_case(w) {
                    spans.push((p, p + w.len()));
                }
            }
        }
        let mut min_end = vec![usize::MAX; spans.len()];
        let mut low = usize::MAX;
        for (k, s) in spans.iter().enumerate().rev() {
            low = low.min(s.1);
            min_end[k] = low;
        }
        Self { spans, min_end }
    }

    /// Whether one of the words lies wholly inside `from..to`.
    fn within(&self, from: usize, to: usize) -> bool {
        let k = self.spans.partition_point(|s| s.0 < from);
        self.min_end.get(k).is_some_and(|&e| e <= to)
    }
}

/// Where the command that ends at the end of `head` begins: just after the last `;`, `|`, `&` or
/// `(` that is not inside a quoted argument already closed by then, or after the last backtick or
/// line break. A separator inside the quote that wraps the command (`bash -c "cd x; mysql ..`) is
/// still a separator, because that quote is still open. Quotes are paired as they come, one kind
/// inside another (`"a 'b; c' d"`), and an escaped quote (`\"`) is a kind of its own. A `'` inside an
/// open `"` is an opener only when a matching `'` comes before the next `"` (`"it's; ..` is text),
/// and the other way round: a `"` inside an open `'` opens only when a `"` comes before the next `'`
/// (`'a "b; c'`). A `$(` or an opening backtick starts a command of its own, and its `)` or closing
/// backtick gives back the command it interrupted (`$(which mysql) -u root -p..` is one command).
fn segment_start(head: &str) -> usize {
    let b = head.as_bytes();
    // Open quotes as (kind, id); a separator remembers the ids that were open where it stood.
    let mut open: Vec<(u8, usize)> = Vec::new();
    let mut seps: Vec<(usize, Vec<usize>)> = Vec::new();
    // `(` and opening backticks not closed yet: (kind, separators kept, line start kept, quote ids).
    let mut frames: Vec<(u8, usize, usize, Vec<usize>)> = Vec::new();
    let (mut next_id, mut hard, mut p) = (0, 0, 0);
    while p < b.len() {
        let c = b[p];
        let top = open.last().map(|(top, _)| *top);
        let kind = match c {
            b'\\' if matches!(b.get(p + 1), Some(b'"' | b'\'')) => {
                p += 1;
                Some(b[p] | 0x80)
            }
            b'\'' if top == Some(b'"') && !opens_quote(&b[p + 1..], b'\'', b'"') => None,
            b'"' if top == Some(b'\'') && !opens_quote(&b[p + 1..], b'"', b'\'') => None,
            b'"' | b'\'' => Some(c),
            _ => None,
        };
        let ids = || open.iter().map(|(_, id)| *id).collect::<Vec<usize>>();
        if let Some(k) = kind {
            if top == Some(k) {
                open.pop();
            } else {
                open.push((k, next_id));
                next_id += 1;
            }
        } else if c == b'\n' {
            hard = p + 1;
        } else if c == b'&' && ((p > 0 && matches!(b[p - 1], b'>' | b'<')) || b.get(p + 1) == Some(&b'>')) {
            // A redirect (`2>&1`, `&>file`), not a separator.
        } else if matches!(c, b'`' | b')') {
            // The closer of the nearest opener of its kind that stood inside the same quotes.
            let opener = if c == b'`' { b'`' } else { b'(' };
            let here = ids();
            if let Some(k) = frames.iter().rposition(|f| f.0 == opener && f.3 == here) {
                seps.truncate(frames[k].1);
                hard = frames[k].2;
                frames.truncate(k);
            } else if c == b'`' && (top != Some(b'\'') || opens_quote(&b[p + 1..], b'`', b'\'')) {
                // Inside single quotes a backtick opens a command only when another one closes it
                // before the quote does (`'a`b'` is text).
                frames.push((b'`', seps.len(), hard, here));
                hard = p + 1;
            }
        } else if matches!(c, b';' | b'|' | b'&' | b'(') {
            if c == b'(' {
                frames.push((b'(', seps.len(), hard, ids()));
            }
            seps.push((p + 1, ids()));
        }
        p += 1;
    }
    let now: Vec<usize> = open.iter().map(|(_, id)| *id).collect();
    let live = seps.iter().rev().find(|(_, ids)| now.starts_with(ids)).map_or(0, |(pos, _)| *pos);
    live.max(hard)
}

/// Whether the text after a quote of one kind that sits inside an open quote of the other kind holds
/// a `want` quote before the next `stop` quote that is not escaped: only then does that quote open
/// one of its own (`"mysql -e 'a; b'"`, `'say "hi; there"'`), else it is a lone mark inside text
/// (`"don't; ..."`, `'a "b; c'`).
fn opens_quote(rest: &[u8], want: u8, stop: u8) -> bool {
    let mut p = 0;
    while p < rest.len() {
        match rest[p] {
            b'\\' => p += 1,
            c if c == want => return true,
            c if c == stop => return false,
            _ => {}
        }
        p += 1;
    }
    false
}

/// One word of a command: `name` is lower case, without a folder or `.exe`; `raw` keeps its case
/// (`sudo -S` and `sudo -s` are different options); `folder` says the word had a folder part and is
/// no program path (`/var/lib/mysql`, `C:\ProgramData\MySQL\my.ini`). A `.exe` path is a program,
/// and so is a path whose parent folder is `bin` or `sbin` (`/usr/local/mysql/bin/mysql`). `end` is
/// the byte offset in the text where the word ends.
struct Word {
    name: String,
    raw: String,
    folder: bool,
    end: usize,
}

/// The words of the command before byte `i`, back to the start of that command (`segment_start`):
/// without a folder (cut at `/` and at `\`) or `.exe`, so `sudo C:\bin\MySQL.exe -p..` reads as
/// `sudo`, `mysql`. Quotes and brackets split words too, so a wrapped command (`bash -c "mysql ..`)
/// or `$(which mysql)` still shows its program.
fn words_before(t: &str, i: usize) -> Vec<Word> {
    words_in(t, segment_start(&t[..i]), i)
}

/// The words of `t[from..to]` (see `words_before`).
fn words_in(t: &str, from: usize, to: usize) -> Vec<Word> {
    let seg = &t[from..to];
    word_spans(seg)
        .into_iter()
        .filter_map(|(a, z)| {
            let w = &seg[a..z];
            let mut parts = w.rsplit(['/', '\\']);
            let raw = parts.next().unwrap_or(w);
            if raw.is_empty() {
                return None;
            }
            let parent = parts.next().unwrap_or("");
            let bin = parent.eq_ignore_ascii_case("bin") || parent.eq_ignore_ascii_case("sbin");
            let lower = raw.to_ascii_lowercase();
            let exe = lower.strip_suffix(".exe");
            Some(Word { name: exe.unwrap_or(&lower).to_string(), raw: raw.to_string(), folder: raw.len() < w.len() && exe.is_none() && !bin, end: from + z })
        })
        .collect()
}

/// Where the words of `seg` begin and end: cut at white space, quotes, brackets and backticks, except
/// that a quoted path which begins a word and holds spaces in its folders is one word
/// (`"C:\Program Files\7-Zip\7z" a ..`, see `quoted_path`).
fn word_spans(seg: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let (mut from, mut p) = (None, 0);
    while p < seg.len() {
        let c = seg[p..].chars().next().unwrap_or(' ');
        if c.is_whitespace() || matches!(c, '"' | '\'' | '(' | ')' | '`') {
            if let Some(f) = from.take() {
                spans.push((f, p));
            }
            if let Some(q) = quoted_path(seg, p) {
                spans.push((p + 1, q));
                p = q;
            }
        } else if from.is_none() {
            from = Some(p);
        }
        p += seg[p..].chars().next().map_or(1, char::len_utf8);
    }
    if let Some(f) = from {
        spans.push((f, seg.len()));
    }
    spans
}

/// When a quote at byte `p` of `seg` begins a word and closes a path that holds spaces in its folders
/// (`"C:\Program Files\7-Zip\7z"`, `'/opt/my tools/curl'`), where the closing quote is. The path
/// starts like one (a drive, `/`, `\\`, `./`, `.\`, `~/`) and the part after its last `/` or `\` is a
/// single word, else it is a quoted command line (`"/usr/bin/env mysql"`) that is read word by word.
fn quoted_path(seg: &str, p: usize) -> Option<usize> {
    let quote = *seg.as_bytes().get(p).filter(|b| matches!(**b, b'"' | b'\''))?;
    if !seg[..p].chars().next_back().is_none_or(char::is_whitespace) {
        return None;
    }
    let q = p + 1 + seg[p + 1..].find(quote as char)?;
    let body = &seg[p + 1..q];
    let b = body.as_bytes();
    let starts = (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'/' | b'\\')) || body.starts_with(['/', '\\']) || body.starts_with("./") || body.starts_with(".\\") || body.starts_with("~/");
    let last = body.rsplit(['/', '\\']).next().unwrap_or(body);
    (starts && body.contains(char::is_whitespace) && !last.is_empty() && !last.starts_with('-') && !last.contains(char::is_whitespace)).then_some(q)
}

/// Words that only run the command after them: wrappers, shells, and the keywords a shell script
/// puts in front of a command (`then`, `do`, `else`, `!`, `{`). Shells, `cmd` and PowerShell are the
/// ones whose options (`-c`, `/c`, `-Command`) never take a value of their own.
const PASS_THROUGH: &[&str] = &["sudo", "doas", "env", "nohup", "time", "exec", "command", "nice", "ionice", "xargs", "stdbuf", "timeout", "setsid", "watch", "start", "call", "winpty", "bash", "sh", "zsh", "dash", "ksh", "fish", "cmd", "powershell", "pwsh", "if", "elif", "while", "until", "then", "do", "else", "!", "{"];
const SHELLS: [&str; 9] = ["bash", "sh", "zsh", "dash", "ksh", "fish", "cmd", "powershell", "pwsh"];
/// The options of a wrapper whose value is the next word (`sudo -u root mysql`, `xargs -n 1 curl`).
/// They are per wrapper and case sensitive: `sudo -n`, `-i`, `-s`, `-S` and `env -i` take no value.
fn takes_value(wrapper: &str, option: &str) -> bool {
    let options: &[&str] = match wrapper {
        "sudo" => &["-u", "-g", "-p", "-C", "-D", "-R", "-r", "-t", "-T", "-U", "--user", "--group", "--prompt", "--chdir", "--role", "--type"],
        "doas" => &["-u", "-C"],
        "env" => &["-u", "-C", "--unset", "--chdir"],
        "nice" => &["-n"],
        "ionice" => &["-c", "-n", "-p", "-P", "-u"],
        "timeout" => &["-s", "-k", "--signal", "--kill-after"],
        "xargs" => &["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"],
        "stdbuf" => &["-i", "-o", "-e"],
        "watch" => &["-n"],
        "time" => &["-f", "-o"],
        "exec" => &["-a"],
        _ => &[],
    };
    options.contains(&option)
}

/// Programs that run another program given later on their line (`ssh host mysql -p..`).
const LAUNCHERS: [&str; 15] = ["ssh", "docker", "podman", "nerdctl", "kubectl", "oc", "wsl", "su", "runuser", "chroot", "nsenter", "lxc", "incus", "distrobox", "toolbox"];

/// The index of the command word in `words` (what `words_before` returns): the first word that is
/// not a wrapper, a wrapper's own option or value (`sudo -u root`, `timeout 5`, `cmd /c`) or a
/// `NAME=value` placed before the program.
fn command_index(words: &[Word]) -> Option<usize> {
    let mut wrapper: Option<&str> = None;
    let mut k = 0;
    while k < words.len() {
        let w = words[k].name.as_str();
        let raw = words[k].raw.as_str();
        k += 1;
        if PASS_THROUGH.contains(&w) {
            wrapper = Some(w);
            continue;
        }
        if w.contains('=') && !w.starts_with('-') {
            continue;
        }
        let Some(wrap) = wrapper else { return Some(k - 1) };
        if w.starts_with('-') {
            if !SHELLS.contains(&wrap) && takes_value(wrap, raw) {
                k += 1;
            }
            continue;
        }
        let duration = w.as_bytes().first().is_some_and(u8::is_ascii_digit) && w.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b's' | b'm' | b'h' | b'd'));
        // `cmd /c`: the slash was taken for a folder separator, so the flag reads `c`.
        if duration || (wrap == "cmd" && matches!(w, "c" | "k")) {
            continue;
        }
        return Some(k - 1);
    }
    None
}

/// Whether the program these words run is one `is` accepts: the command word itself, or any other
/// word that is not part of a folder path (`echo "mysql -p.."` writes a command, `winpty mysql ..`
/// and `ssh host mysql ..` run one), or any word after a launcher, folder or not. A folder part
/// (`find /var/lib/mysql`) is no program. A program name that is the pattern of a search tool
/// (`grep curl -u a:b notes.txt`) counts: a pattern that spells a credential is one. A `.exe` path
/// and a path under a `bin` folder are programs.
fn runs(words: &[Word], is: impl Fn(&str) -> bool) -> bool {
    if let Some(k) = command_index(words) {
        let name = words[k].name.as_str();
        if is(name) || (LAUNCHERS.contains(&name) && words[k + 1..].iter().any(|w| is(&w.name))) {
            return true;
        }
    }
    words.iter().any(|w| !w.folder && is(&w.name))
}

/// Programs that take their password attached to a short flag (`-pSecret`). That flag is read as a
/// password only for them: elsewhere `-p` words are ordinary (`find -print`, `gcc -pthread`).
fn takes_attached_password(word: &str) -> bool {
    // A file name (`mysql.log`) is no program.
    (!word.contains('.') && (word.starts_with("mysql") || word.starts_with("mariadb"))) || matches!(word, "7z" | "7za" | "7zr" | "7zz" | "rar" | "unrar" | "sshpass")
}

/// Whether a setting, variable or flag name holds a secret. A flag also hides a value that names
/// a file or folder less often than it hides a secret, so those names are let through.
fn secretish(name: &str, flag: bool) -> bool {
    const PARTS: [&str; 12] = ["token", "secret", "password", "passwd", "passphrase", "credential", "apikey", "api_key", "api-key", "accesskey", "access_key", "access-key"];
    let lower = name.to_ascii_lowercase();
    if ["file", "path", "dir", "folder"].iter().any(|s| lower.ends_with(s)) {
        return false;
    }
    // Limits, tokenizers and "read it from stdin" only sound like secrets (`--max-tokens`, `--password-stdin`).
    const NOT_SECRET: [&str; 14] = ["stdin", "tokens", "tokenizer", "tokenize", "through", "limit", "max", "min", "count", "length", "ttl", "expiry", "expires", "type"];
    if lower.split(['_', '-', '.']).any(|s| NOT_SECRET.contains(&s)) {
        return false;
    }
    if PARTS.iter().any(|p| lower.contains(p)) || lower.contains("privatekey") || lower.contains("private_key") || lower.contains("private-key") {
        return true;
    }
    lower.split(['_', '-', '.']).any(|s| matches!(s, "pwd" | "auth" | "pass") || (!flag && s == "key"))
}

/// Where a bare flag value ends besides a space: a command separator, which is not part of it
/// (`curl -u a:b; ls` keeps its `;`, or a second mask would read `ls` as curl's next word).
const COMMAND_END: &[u8] = b";|&";

/// The value that begins `rest`: a quoted one (also `\"..\"` inside a quoted command, and the shell's
/// `$'..'` and `$".."`) to its closing quote and on through the text stuck to it (`'my pass'-x` is one
/// word), or a bare one to the next space, quote or any byte in `stops`. 0 when none.
fn value_span(rest: &str, stops: &[u8]) -> usize {
    let b = rest.as_bytes();
    let skip = usize::from(b.first() == Some(&b'\\') && matches!(b.get(1), Some(b'"' | b'\'')));
    // `$'..'` honours a backslash before its closing quote (`$'it\'s'`); the dollar is part of the value.
    let ansi = skip == 0 && b.first() == Some(&b'$') && matches!(b.get(1), Some(b'"' | b'\''));
    let open = skip + usize::from(ansi);
    match b.get(open) {
        Some(q @ (b'"' | b'\'')) => {
            let close = if ansi {
                let mut p = open + 1;
                while p < b.len() && b[p] != *q {
                    p += if b[p] == b'\\' { 2 } else { 1 };
                }
                (p < b.len()).then_some(p)
            } else {
                rest[open + 1..].find(*q as char).map(|k| open + 1 + k)
            };
            let Some(close) = close else { return rest.len() };
            // Text stuck to the closing quote belongs to the word, not a quote or a bracket (the quote
            // may close the command around it). Inside a quoted command (`\"..\"`) a backslash ends it too.
            let tail = run(&rest[close + 1..], |c| !(c.is_ascii_whitespace() || matches!(c, b'"' | b'\'' | b'`' | b'(' | b')') || stops.contains(&c) || (skip > 0 && c == b'\\')));
            close + 1 + tail
        }
        _ => run(rest, |c| !(c.is_ascii_whitespace() || matches!(c, b'"' | b'\'' | b'`') || stops.contains(&c))),
    }
}

/// A value that needs no hiding: already hidden, a Stripe key already masked, a variable
/// reference such as `$TOKEN`, `${TOKEN}` or `$(cmd)`, or nothing at all. A `$` inside single
/// quotes is text, not a reference, and `$3cr3t` is not a name, so both are hidden.
fn already(value: &str) -> bool {
    already_as(value, true)
}

/// `already`, where `refs` says whether a `$name` counts as a variable reference. Inside a JSON body
/// it never does: the body is text that goes to a server, whatever the shell around it would do.
fn already_as(value: &str, refs: bool) -> bool {
    let single = value.trim_start_matches('\\').starts_with('\'');
    let v = value.trim_matches(|c| matches!(c, '"' | '\'' | '\\'));
    let reference = refs && !single && v.strip_prefix('$').and_then(|r| r.bytes().next()).is_some_and(|b| b.is_ascii_alphabetic() || matches!(b, b'_' | b'{' | b'('));
    // `[hidden]` with a bracket or other punctuation stuck to it (`'pw')`, `\'pw'$(x`) is a hidden value
    // that `value_span` stopped short of, not a new one.
    let hidden = v.strip_prefix(HIDDEN).is_some_and(|r| r.is_empty() || r.starts_with(|c: char| !c.is_alphanumeric() && !matches!(c, '"' | '\'')));
    v.is_empty() || hidden || reference || STRIPE_PREFIXES.iter().any(|p| v.strip_prefix(p).is_some_and(|r| r.starts_with("....")))
}

/// `--password hunter2` and `--token abc` (a space before the value; `--token=abc` is the labelled
/// pass), also with one dash (`-Password hunter2`, a PowerShell parameter), curl's `-u user:password`,
/// sshpass's `-p secret`, and a short password flag with the value attached, `-pS3cret`, for the programs
/// that take one (MySQL and MariaDB clients, 7z, rar, sshpass).
fn secret_flags(t: &str) -> String {
    // T-604 (R03-safety-accounts.2): the words before a flag are read at most once per flag, and not
    // at all when no program the flag belongs to is named anywhere in the text (a word's name is a
    // piece of the text), so a long run of `-p` or `-u` flags no longer re-reads the command from its
    // start at each one. ponytail: with such a program named the read stays one per flag; masking is
    // only asked for the head of a command (`protected_custom::paused`), which bounds it.
    let lower = t.to_ascii_lowercase();
    let curl = lower.contains("curl");
    let sshpass = lower.contains("sshpass");
    let attached = ["mysql", "mariadb", "7z", "rar", "sshpass"].iter().any(|p| lower.contains(p));
    scan(t, |t, i| {
        let prev = if i == 0 { b' ' } else { t.as_bytes()[i - 1] };
        if !(prev.is_ascii_whitespace() || matches!(prev, b'"' | b'\'' | b'\\' | b'(' | b'`')) {
            return None;
        }
        let rest = t.get(i..)?;
        let words = OnceCell::new();
        let before = || words.get_or_init(|| words_before(t, i));
        // curl: `-u user:password` (also `-U`, `--user`, `--proxy-user`; a space, or `=` for the long ones).
        for f in ["--proxy-user", "--user", "-u", "-U"] {
            let Some(after) = rest.strip_prefix(f) else { continue };
            let gap = run(after, |b| b == b' ' || b == b'\t');
            let eq = f.starts_with("--") && after.starts_with('=');
            if (gap == 0 && !eq) || !curl || !runs(before(), |w| w == "curl") {
                continue;
            }
            let at = if eq { 1 } else { gap };
            let value = &after[at..];
            let len = value_span(value, COMMAND_END);
            let bare = value[..len].trim_matches(|c| matches!(c, '"' | '\'' | '\\'));
            if bare.split_once(':').is_some_and(|(_, pw)| !pw.is_empty() && !already(pw)) {
                return Some((i + f.len() + at + len, format!("{f}{}{HIDDEN}", &after[..at])));
            }
        }
        // sshpass: `-p secret` straight after the program (only its own options before the value).
        if let Some(after) = rest.strip_prefix("-p") {
            let gap = run(after, |b| b == b' ' || b == b'\t');
            let own = || {
                let words = before();
                words.iter().rposition(|w| w.name == "sshpass").is_some_and(|p| words[p + 1..].iter().all(|w| w.name.starts_with('-')))
            };
            if gap > 0 && sshpass && own() {
                let value = &after[gap..];
                let len = value_span(value, COMMAND_END);
                if len > 0 && !value.starts_with('-') && !already(&value[..len]) {
                    return Some((i + 2 + gap + len, format!("-p{}{HIDDEN}", &after[..gap])));
                }
            }
        }
        if !rest.starts_with("--") {
            if let Some(tail) = rest.strip_prefix("-p") {
                let len = value_span(tail, COMMAND_END);
                let value = &tail[..len];
                let program = attached && runs(before(), takes_attached_password);
                if program && !value.is_empty() && !value.starts_with('-') && !value.starts_with('=') && !already(value) {
                    return Some((i + 2 + len, format!("-p{HIDDEN}")));
                }
            }
        }
        flag_value(rest).map(|(len, shown)| (i + len, shown))
    })
}

/// A flag at the start of `rest` (`--name` or `-Name`) whose name says it holds a secret, a space and its
/// value: how many bytes they take and what they become (`--password [hidden]`). None when the name is
/// no secret, the value is missing, hidden already or another flag.
fn flag_value(rest: &str) -> Option<(usize, String)> {
    let dashes = if rest.starts_with("--") { 2 } else if rest.starts_with('-') && rest.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic) { 1 } else { return None };
    let flag = &rest[dashes..];
    let n = run(flag, key_char);
    if n == 0 || !secretish(&flag[..n], true) {
        return None;
    }
    let after = &flag[n..];
    let gap = run(after, |b| b == b' ' || b == b'\t');
    if gap == 0 {
        return None;
    }
    let value = &after[gap..];
    let len = value_span(value, COMMAND_END);
    // A redirect after a switch (`gh auth login --with-token < token.txt`) is no value of the flag.
    if len == 0 || value.starts_with(['-', '<', '>']) || already(&value[..len]) {
        return None;
    }
    Some((dashes + n + gap + len, format!("{}{}{}{HIDDEN}", &rest[..dashes], &flag[..n], &after[..gap])))
}

/// The password that `echo` or `printf` (or PowerShell's `Write-Output` / `write`, or one quoted literal) pipes into a command
/// that reads one from its input: `sudo -S` (`--stdin`, also inside a cluster such as `-nS`), also behind
/// wrappers and launchers (`env FOO=1 sudo -S`, `ssh host sudo -S`), or any command with `--password-stdin`
/// (`docker login`). The word after `<<<` goes for such a command too. The argument of `echo` /
/// `printf` goes (`echo -n pw | sudo -S ..` becomes `echo -n [hidden] | sudo -S ..`), up to a `;`, `&`,
/// line break or unbalanced `)`, except a variable reference such as `"$SUDO_PW"`.
fn piped_passwords(t: &str) -> String {
    let b = t.as_bytes();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for i in (0..b.len()).filter(|&i| b[i] == b'|' && b.get(i + 1) != Some(&b'|') && (i == 0 || b[i - 1] != b'|')) {
        let left = words_before(t, i);
        let found = echoed_value(t, i, &left).or_else(|| brace_group_echo(t, i, &left));
        let Some((from, to)) = found.filter(|&(from, to)| from < to && !already_words(&t[from..to])) else { continue };
        if reaches_password_reader(t, i) {
            spans.push((from, to));
        }
    }
    for (p, _) in t.match_indices("<<") {
        if let Some(body) = here_document_body(t, p) {
            spans.push(body);
        }
    }
    for (p, _) in t.match_indices("<<<") {
        if !reads_stdin_password(&words_before(t, p)) {
            continue;
        }
        let after = &t[p + 3..];
        let gap = run(after, |c| c == b' ' || c == b'\t');
        let len = value_span(&after[gap..], COMMAND_END);
        // A value that begins with the mark is hidden already (a quoted word cut off right before more text).
        if len > 0 && !after[gap..].starts_with(HIDDEN) && !already(&after[gap..gap + len]) {
            spans.push((p + 3 + gap, p + 3 + gap + len));
        }
    }
    spans.sort_unstable();
    let mut out = String::with_capacity(t.len());
    let mut last = 0;
    for (from, to) in spans {
        if from < last {
            continue;
        }
        out.push_str(&t[last..from]);
        out.push_str(HIDDEN);
        last = to;
    }
    out.push_str(&t[last..]);
    out
}

/// Whether the pipe at byte `i` feeds a command that reads a password from its input, also through
/// filters (`echo pw | cat | sudo -S ls`). A command passed over must have its quotes closed, else the
/// pipe sits inside a quoted word (`echo "a|b" | sudo -S ls`) and does not feed what follows.
fn reaches_password_reader(t: &str, i: usize) -> bool {
    let b = t.as_bytes();
    let mut pipe = i;
    for _ in 0..8 {
        let (start, end) = right_side(t, pipe);
        if reads_stdin_password(&words_in(t, start, end)) || quoted_rest_reads(t, start, end) {
            return true;
        }
        let stage = &t[start..end];
        let next_is_pipe = b.get(end) == Some(&b'|') && b.get(end + 1) != Some(&b'|');
        if !next_is_pipe || stage.matches('"').count() % 2 == 1 || stage.matches('\'').count() % 2 == 1 {
            return false;
        }
        pipe = end;
    }
    false
}

/// When the command `t[start..end]` that a pipe feeds was cut at a separator inside its own open quote
/// (`ssh host "ls; sudo -S x"`), whether one of the commands after that separator, up to where the
/// quote closes, reads a password from its input: they all share the launcher's input.
fn quoted_rest_reads(t: &str, start: usize, end: usize) -> bool {
    let b = t.as_bytes();
    // Only a quote that a launcher or a shell opens holds a command (`echo "a|b" | ..` closes a quote instead).
    let Some(open) = unclosed_quote(&t[start..end]).map(|k| start + k) else { return false };
    let words = words_in(t, start, open);
    let runs_command = match command_index(&words) {
        None => words.iter().any(|w| SHELLS.contains(&w.name.as_str())),
        Some(k) => LAUNCHERS.contains(&words[k].name.as_str()) || SHELLS.contains(&words[k].name.as_str()),
    };
    if !runs_command {
        return false;
    }
    let mut e = end;
    for _ in 0..16 {
        if e >= b.len() || unclosed_quote(&t[start..e]).is_none() {
            return false;
        }
        let mut s = e;
        while s < b.len() && matches!(b[s], b';' | b'|' | b'&' | b'\n') {
            s += 1;
        }
        let (from, to) = right_side(t, s - 1);
        if reads_stdin_password(&words_in(t, from, to)) {
            return true;
        }
        e = to.max(s);
    }
    false
}

/// The body of the here-document that the `<<` at byte `p` opens, as byte offsets, when the command before
/// it reads a password from its input: the lines after the one that holds `<<` up to the line that is
/// the delimiter (to the end of the text when none comes), without the line breaks at either end. `<<<`
/// is a here-string, and a body that is hidden already or only variable references is left alone.
fn here_document_body(t: &str, p: usize) -> Option<(usize, usize)> {
    let b = t.as_bytes();
    if (p > 0 && b[p - 1] == b'<') || b.get(p + 2) == Some(&b'<') {
        return None;
    }
    let dash = b.get(p + 2) == Some(&b'-');
    let mut q = p + 2 + usize::from(dash);
    q += run(&t[q..], |c| c == b' ' || c == b'\t');
    let len = run(&t[q..], |c| !(c.is_ascii_whitespace() || matches!(c, b';' | b'|' | b'&' | b'<' | b'>' | b'(' | b')')));
    let delimiter: String = t[q..q + len].chars().filter(|c| !matches!(c, '"' | '\'' | '\\')).collect();
    // The command reads a password itself, or pipes the document on to one (`cat <<EOF | sudo -S ls`).
    let line_end = t[q + len..].find('\n').map_or(t.len(), |k| q + len + k);
    let piped = (q + len..line_end).any(|k| b[k] == b'|' && b.get(k + 1) != Some(&b'|') && b[k - 1] != b'|' && reaches_password_reader(t, k));
    if delimiter.is_empty() || !(piped || reads_stdin_password(&words_before(t, p))) {
        return None;
    }
    let body = q + len + t[q + len..].find('\n')? + 1;
    let mut line = body;
    let mut stop = None;
    loop {
        let end = t[line..].find('\n').map_or(t.len(), |k| line + k);
        let text = t[line..end].trim_end_matches('\r');
        if (if dash { text.trim_start_matches('\t') } else { text }) == delimiter {
            // The line break before the delimiter (and the carriage return before it) stays.
            let at = line - 1;
            stop = Some(if at > body && b[at - 1] == b'\r' { at - 1 } else { at });
            break;
        }
        if end >= t.len() {
            break;
        }
        line = end + 1;
    }
    let stop = stop.unwrap_or(body + t[body..].trim_end_matches(['\r', '\n']).len());
    let hidden = stop <= body || t[body..stop].lines().all(|l| l.trim().is_empty() || already(l.trim()));
    (!hidden).then_some((body, stop))
}

/// Words that write their arguments to the pipe: `echo`, `printf`, PowerShell's `Write-Output` and `write`.
fn writes_text(name: &str) -> bool {
    matches!(name, "echo" | "printf" | "write-output" | "write")
}

/// The text a pipe at byte `i` carries, when it is typed in the command: the arguments of the `echo`
/// (or `printf`, ..) that is the command word, or that a launcher runs (`ssh host "echo pw | .."`), or one
/// quoted literal that makes up the whole command (`"S3cret" | docker login ..`). `left` is
/// `words_before(t, i)`. As byte offsets of `t`; echo's own flags (`-n`, `-e`) stay out.
fn echoed_value(t: &str, i: usize, left: &[Word]) -> Option<(usize, usize)> {
    let k = command_index(left);
    let at = k.and_then(|k| {
        if writes_text(&left[k].name) {
            return Some(k);
        }
        let launcher = LAUNCHERS.contains(&left[k].name.as_str());
        launcher.then(|| (k + 1..left.len()).find(|&m| !left[m].folder && writes_text(&left[m].name))).flatten()
    });
    let Some(m) = at else { return quoted_literal(t, i) };
    let mut from = left[m].end;
    loop {
        let rest = &t[from..i];
        let skipped = rest.len() - rest.trim_start().len();
        let word = rest.split_whitespace().next().unwrap_or("");
        if left[m].name == "echo" && word.len() > 1 && word.starts_with('-') && word[1..].bytes().all(|c| c.is_ascii_alphabetic()) {
            from += skipped + word.len();
        } else {
            from += skipped;
            break;
        }
    }
    let mut to = from + t[from..i].trim_end().len();
    // A quote that only closes the line around the command (`bash -c "echo pw | sudo -S .."`) stays.
    if let Some(q) = t[from..to].chars().next_back().filter(|c| matches!(c, '"' | '\'')) {
        if t[from..to].matches(q).count() % 2 == 1 {
            to -= 1;
        }
    }
    let to = span_end(t, from, to);
    Some((from, from + t[from..to].trim_end().len()))
}

/// Where the arguments of an `echo` that begin at `from` end, no later than `to`: at a `;`, `&`, `|` or
/// line break outside quotes, or at a `)` that closes nothing opened in the arguments (`(echo pw) | ..`).
/// The `|` matters when the pipe that was found is the outer one of a quoted command that holds a pipe
/// of its own (`ssh host "echo pw | sudo -S x" | sudo -S y`): both pipes then hide the same word.
fn span_end(t: &str, from: usize, to: usize) -> usize {
    let b = t.as_bytes();
    let (mut depth, mut quote, mut p) = (0usize, None::<u8>, from);
    while p < to {
        let c = b[p];
        match (quote, c) {
            (_, b'\\') => p += 1,
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            // A redirect of the echo's own output (`2>&1`, `>/dev/null`, `&>log`) is no part of the value.
            (None, _) if (p == from || b[p - 1].is_ascii_whitespace()) && redirect_at(&b[p..to]) => return p,
            (None, b'"' | b'\'') => quote = Some(c),
            (None, b'(') => depth += 1,
            (None, b')') if depth == 0 => return p,
            (None, b')') => depth -= 1,
            (None, b';' | b'&' | b'|' | b'\n') => return p,
            _ => {}
        }
        p += 1;
    }
    to
}

/// Whether a word that begins `w` is a redirect: optional file-descriptor digits then `>` or `<`, or `&>`.
fn redirect_at(w: &[u8]) -> bool {
    let digits = w.iter().take_while(|c| c.is_ascii_digit()).count();
    matches!(w.get(digits), Some(b'>' | b'<')) || w.starts_with(b"&>")
}

/// `already` for the arguments of an `echo`, word by word: `$(date) pw` still holds a typed password,
/// while `$PASS` or `"$(cat pw.txt)"` is a reference only. Words split at white space outside quotes
/// and brackets.
fn already_words(v: &str) -> bool {
    let b = v.as_bytes();
    let (mut depth, mut quote, mut start, mut p) = (0usize, None::<u8>, 0, 0);
    let mut words = Vec::new();
    while p < b.len() {
        match (quote, b[p]) {
            (_, b'\\') => p += 1,
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, c @ (b'"' | b'\'')) => quote = Some(c),
            (None, b'(') => depth += 1,
            (None, b')') => depth = depth.saturating_sub(1),
            (None, b' ' | b'\t') if depth == 0 => {
                words.push(&v[start..p]);
                start = p + 1;
            }
            _ => {}
        }
        p += 1;
    }
    words.push(&v[start.min(v.len())..]);
    words.into_iter().filter(|w| !w.is_empty()).all(already)
}

/// The value an `echo` inside a brace group carries when the group's `}` is all there is before the pipe
/// at byte `i` (`{ echo pw; } | sudo -S ls`): the echo just before the `;` or line break that ends it.
fn brace_group_echo(t: &str, i: usize, left: &[Word]) -> Option<(usize, usize)> {
    if left.len() != 1 || left[0].raw != "}" {
        return None;
    }
    let j = segment_start(&t[..i]).checked_sub(1)?;
    matches!(t.as_bytes()[j], b';' | b'\n').then(|| echoed_value(t, j, &words_before(t, j))).flatten()
}

/// When the command before the pipe at byte `i` is one quoted literal (`"S3cret" | docker login ..`), where
/// the literal, quotes included, begins and ends. Also when the pipe is inside the quoted command of a
/// shell or a launcher and the literal opens that command (`powershell -Command "'S3cret' | .."`).
fn quoted_literal(t: &str, i: usize) -> Option<(usize, usize)> {
    let start = segment_start(&t[..i]);
    literal_in(t, start, i).or_else(|| {
        let open = start + unclosed_quote(&t[start..i])?;
        let words = words_in(t, start, open);
        let runs_command = match command_index(&words) {
            None => words.iter().any(|w| SHELLS.contains(&w.name.as_str())),
            Some(k) => LAUNCHERS.contains(&words[k].name.as_str()),
        };
        if runs_command { literal_in(t, open + 1, i) } else { None }
    })
}

/// Where the quote that is still open at the end of `seg` begins (a backslash hides the byte after it,
/// except inside single quotes).
fn unclosed_quote(seg: &str) -> Option<usize> {
    let b = seg.as_bytes();
    let (mut open, mut p) = (None::<(u8, usize)>, 0);
    while p < b.len() {
        match (open, b[p]) {
            (Some((b'\'', _)), b'\'') | (Some((b'"', _)), b'"') => open = None,
            (Some((b'"', _)) | None, b'\\') => p += 1,
            (None, c @ (b'"' | b'\'')) => open = Some((c, p)),
            _ => {}
        }
        p += 1;
    }
    open.map(|(_, at)| at)
}

/// The quoted literal that makes up all of `t[start..end]` (white space aside), quotes included.
fn literal_in(t: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    let seg = &t[start..end];
    let body = seg.trim();
    let q = *body.as_bytes().first().filter(|c| matches!(c, b'"' | b'\''))?;
    let inner = body.as_bytes().get(1..body.len().checked_sub(1)?)?;
    if body.len() < 2 || body.as_bytes()[body.len() - 1] != q {
        return None;
    }
    let mut p = 0;
    while p < inner.len() {
        match inner[p] {
            b'\\' if q == b'"' => p += 1,
            c if c == q => return None,
            _ => {}
        }
        p += 1;
    }
    let from = start + seg.len() - seg.trim_start().len();
    Some((from, from + body.len()))
}

/// The command that a pipe at byte `i` feeds: from after the pipe (and a `&` of `|&`, white space, line
/// breaks and backslash-newlines) to the next `;`, `|`, `&` or line break that does not continue the line.
fn right_side(t: &str, i: usize) -> (usize, usize) {
    let b = t.as_bytes();
    let join = |p: usize| match (b.get(p), b.get(p + 1), b.get(p + 2)) {
        (Some(b'\\'), Some(b'\n'), _) => 2,
        (Some(b'\\'), Some(b'\r'), Some(b'\n')) => 3,
        _ => 0,
    };
    let mut s = i + 1 + usize::from(b.get(i + 1) == Some(&b'&'));
    while s < b.len() {
        match b[s] {
            b' ' | b'\t' | b'\r' | b'\n' => s += 1,
            _ if join(s) > 0 => s += join(s),
            _ => break,
        }
    }
    let mut e = s;
    while e < b.len() {
        match b[e] {
            b';' | b'|' | b'&' | b'\n' => break,
            _ if join(e) > 0 => e += join(e),
            _ => e += 1,
        }
    }
    (s, e)
}

/// The index of the `sudo` that these words run: reached through wrappers (`env FOO=1`, `nohup`,
/// `command`) and through a launcher, whose own arguments (`ssh -p 22 host`) can be anything.
fn reached_sudo(words: &[Word]) -> Option<usize> {
    let (mut wrapper, mut launched, mut k) = (None::<&str>, false, 0);
    while k < words.len() {
        let name = words[k].name.as_str();
        k += 1;
        if name == "sudo" && !words[k - 1].folder {
            return Some(k - 1);
        }
        if PASS_THROUGH.contains(&name) {
            wrapper = Some(name);
        } else if LAUNCHERS.contains(&name) {
            (launched, wrapper) = (true, None);
        } else if launched || (name.contains('=') && !name.starts_with('-')) {
            continue;
        } else if let Some(wrap) = wrapper.filter(|_| name.starts_with('-')) {
            k += usize::from(!SHELLS.contains(&wrap) && takes_value(wrap, &words[k - 1].raw));
        } else if !wrapper.is_some_and(|wrap| is_wrapper_value(wrap, name)) {
            return None;
        }
    }
    None
}

/// A word that a wrapper takes for its own: a duration (`timeout 5`) or the `/c` of `cmd`.
fn is_wrapper_value(wrapper: &str, name: &str) -> bool {
    let duration = name.as_bytes().first().is_some_and(u8::is_ascii_digit) && name.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b's' | b'm' | b'h' | b'd'));
    duration || (wrapper == "cmd" && matches!(name, "c" | "k"))
}

/// Whether the command these words make reads a password from its input: `--password-stdin`,
/// `--with-token` (`gh auth login`), a `sudo` (see `reached_sudo`) with `-S` / `--stdin` among its
/// options, or PowerShell's `ConvertTo-SecureString -AsPlainText`.
fn reads_stdin_password(words: &[Word]) -> bool {
    if words.iter().any(|w| w.raw == "--password-stdin" || w.raw == "--with-token") || (words.iter().any(|w| w.name == "convertto-securestring") && words.iter().any(|w| w.name == "-asplaintext")) {
        return true;
    }
    let Some(s) = reached_sudo(words) else { return false };
    let mut m = s + 1;
    let mut found = false;
    while m < words.len() && words[m].raw.starts_with('-') {
        let r = words[m].raw.as_str();
        found |= r == "--stdin" || (!r.starts_with("--") && r.contains('S'));
        m += 1 + usize::from(takes_value("sudo", r));
    }
    found
}

/// A header written `Name: value` (a curl `-H` argument, a raw request): `Authorization` and
/// cookies whatever their value, and any other hyphenated name that says it holds a secret
/// (`X-Api-Key`, `PRIVATE-TOKEN`). Where `-H` or `--header` says a header is being written, any
/// name that says it holds a secret goes (`Token`, `X_API_KEY`). A secret-sounding `name: value` that
/// begins a line or a quoted string (a YAML line, `echo "password: ..."`) goes too when its value is
/// one word, so a sentence such as `"token: rotate the keys"` stays. For `Authorization` the scheme
/// word stays (`token`, `Bearer`).
fn header_values(t: &str) -> String {
    let context = HeaderContext::new(t);
    scan(t, |t, i| {
        let prev = if i == 0 { b' ' } else { t.as_bytes()[i - 1] };
        if key_char(prev) {
            return None;
        }
        let rest = t.get(i..)?;
        let n = run(rest, key_char);
        let name = &rest[..n];
        let lower = name.to_ascii_lowercase();
        let auth = matches!(lower.as_str(), "authorization" | "proxy-authorization");
        if n < 3 || !(auth || matches!(lower.as_str(), "cookie" | "set-cookie") || secretish(name, false)) {
            return None;
        }
        let after = rest[n..].strip_prefix(':')?;
        let header_like = name.contains('-') || matches!(lower.as_str(), "authorization" | "cookie" | "apikey") || context.holds(i);
        if !header_like && !begins_line_or_quote(t, i) {
            return None;
        }
        let gap = run(after, |b| b == b' ' || b == b'\t');
        let value = &after[gap..];
        let len = run(value, |b| !matches!(b, b'"' | b'\'' | b'\\' | b'\n' | b'\r' | b'`'));
        let value = value[..len].trim_end();
        if value.is_empty() || value.contains(HIDDEN) || value.starts_with("//") || (!header_like && value.contains(char::is_whitespace)) {
            return None;
        }
        let shown = match (auth, value.split_once(char::is_whitespace)) {
            (true, Some((scheme, _))) => format!("{scheme} {HIDDEN}"),
            _ => HIDDEN.to_string(),
        };
        Some((i + n + 1 + gap + value.len(), format!("{name}:{}{shown}", &after[..gap])))
    })
}

/// Whether `i` is the first thing on its line (indentation aside) or right after an opening quote.
fn begins_line_or_quote(t: &str, i: usize) -> bool {
    // Walks back over the white space just before `i` only, not over the whole line.
    let blank = t[..i].chars().rev().find(|c| !c.is_whitespace() || *c == '\n').is_none_or(|c| c == '\n');
    blank || matches!(t.as_bytes()[i - 1], b'"' | b'\'')
}

/// The offset of the quote `q` (`"` or `\"`) that ends a JSON string whose text starts `value`: one
/// with a backslash before it (an odd number of them for `"`) belongs to the value.
fn json_end(value: &str, q: &str) -> Option<usize> {
    let b = value.as_bytes();
    let mut from = 0;
    while let Some(k) = value[from..].find(q) {
        let at = from + k;
        let slashes = b[..at].iter().rev().take_while(|c| **c == b'\\').count();
        if !(if q.len() == 1 { slashes % 2 == 1 } else { slashes > 0 }) {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

/// A JSON string value whose key says it holds a secret: `"password":"..."`, also written with
/// escaped quotes inside a quoted command (`{\"token\":\"..\"}`). In a text `cut` short (T-604,
/// `mask_head`) a value with no closing quote is hidden to the end, as a private key cut short is:
/// the cut took its closing quote.
fn json_values(t: &str, cut: bool) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?;
        let q = if rest.starts_with("\\\"") {
            "\\\""
        } else if rest.starts_with('"') {
            "\""
        } else {
            return None;
        };
        let body = &rest[q.len()..];
        let n = run(body, key_char);
        if n == 0 || !secretish(&body[..n], true) {
            return None;
        }
        let after = body[n..].strip_prefix(q)?.trim_start().strip_prefix(':')?.trim_start();
        let value = after.strip_prefix(q)?;
        let end = json_end(value, q).or(cut.then_some(value.len()))?;
        if already_as(&value[..end], false) {
            return None;
        }
        let consumed = rest.len() - value.len();
        Some((i + consumed + end, format!("{}{HIDDEN}", &rest[..consumed])))
    })
}

/// `NAME=value` where the name says it holds a secret. A PowerShell variable (`$password = 'pw'`) may
/// have white space on both sides of the `=`.
fn labelled_values(t: &str) -> String {
    scan(t, |t, i| {
        if t.as_bytes()[i] != b'=' {
            return None;
        }
        let before = &t.as_bytes()[..i];
        let space = before.iter().rev().take_while(|b| matches!(b, b' ' | b'\t')).count();
        let end = i - space;
        let start = before[..end].iter().rposition(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))).map_or(0, |p| p + 1);
        let name = &t[start..end];
        let variable = start > 0 && before[start - 1] == b'$';
        if name.len() < 2 || (space > 0 && !variable) || !secretish(name, name.starts_with('-')) {
            return None;
        }
        let rest = &t[i + 1..];
        let gap = if variable { run(rest, |b| b == b' ' || b == b'\t') } else { 0 };
        let len = value_span(&rest[gap..], if variable { b"&;,)|".as_slice() } else { b"&;,)".as_slice() });
        (len > 0 && !already(&rest[gap..gap + len])).then(|| (i + 1 + gap + len, format!("={}{HIDDEN}", &rest[..gap])))
    })
}

/// What PowerShell's `ConvertTo-SecureString` is given to turn into a secure string, when `-AsPlainText`
/// is among its arguments: every argument that is no parameter and no reference, to the end of the
/// command (`ConvertTo-SecureString 'pw' -AsPlainText -Force`, `-String 'pw'`). More than one is hidden so
/// that a second run finds nothing left to hide.
fn secure_strings(t: &str) -> String {
    const CMDLET: &str = "convertto-securestring";
    scan(t, |t, i| {
        let rest = t.get(i..)?;
        let head = rest.get(..CMDLET.len())?;
        if !head.eq_ignore_ascii_case(CMDLET) || (i > 0 && key_char(t.as_bytes()[i - 1])) || rest.as_bytes().get(CMDLET.len()).is_some_and(|b| key_char(*b)) {
            return None;
        }
        let line_end = rest.find('\n').map_or(t.len(), |k| i + k);
        let end = span_end(t, i, line_end);
        let (mut p, mut plain, mut out, mut changed) = (i + CMDLET.len(), false, t[i..i + CMDLET.len()].to_string(), false);
        while p < end {
            let gap = run(&t[p..end], |b| b == b' ' || b == b'\t');
            out.push_str(&t[p..p + gap]);
            p += gap;
            if p >= end {
                break;
            }
            let flag = t.as_bytes()[p] == b'-';
            let len = if flag { run(&t[p..end], |b| !b.is_ascii_whitespace()) } else { value_span(&t[p..end], b"") };
            if len == 0 {
                break;
            }
            let word = &t[p..p + len];
            plain |= flag && word.eq_ignore_ascii_case("-AsPlainText");
            if flag || already(word) {
                out.push_str(word);
            } else {
                out.push_str(HIDDEN);
                changed = true;
            }
            p += len;
        }
        out.push_str(&t[p..end]);
        (plain && changed).then_some((end, out))
    })
}

/// A line written as an env file writes it (`NAME=value`, optionally after `export`): its value
/// goes whatever the name says, because such lines are where secrets are pasted.
fn env_lines(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for (n, line) in t.split('\n').enumerate() {
        if n > 0 {
            out.push('\n');
        }
        out.push_str(&env_line(line));
    }
    out
}

fn env_line(line: &str) -> String {
    let body = line.trim_end_matches('\r');
    let ending = &line[body.len()..];
    let lead = body.len() - body.trim_start().len();
    let rest = &body[lead..];
    let rest_nx = rest.strip_prefix("export ").map_or(rest, str::trim_start);
    let name_len = run(rest_nx, |b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
    let name = &rest_nx[..name_len];
    let Some(raw) = rest_nx[name_len..].strip_prefix('=') else { return line.to_string() };
    let value = raw.trim_end();
    let single = match value.chars().next() {
        Some(q @ ('"' | '\'')) => value.len() >= 2 && value.ends_with(q) && !value[1..value.len() - 1].contains(q),
        Some(_) => !value.contains(char::is_whitespace),
        None => false,
    };
    if name.len() < 2 || !name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_') || !single || already(value) {
        return line.to_string();
    }
    let start = body.len() - raw.len();
    format!("{}{HIDDEN}{}{ending}", &body[..start], &body[start + value.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Base {
        Base { workspace: Some("/home/me/app".into()), cwd: Some("/home/me/app".into()), home: Some("/home/me".into()), temp: vec!["/tmp".into(), "/var/tmp".into()] }
    }

    fn hit(cmd: &str) -> Option<&'static str> {
        check(cmd, &base(), &json!({})).map(|r| r.id)
    }

    #[test]
    fn safe010_force_push_and_deletion_aimed_at_main_ask_feature_branches_and_plain_pushes_run() {
        for c in ["git push -f", "git push origin :main", "git push --force origin main", "git push -f origin @:main", "git push --force origin @", "git push --mirror origin", "git -C repo push --force origin HEAD", "git -c core.autocrlf=false push --force-with-lease origin master", "git push origin +main", "git push --delete origin main", "git push -fu origin $(git branch --show-current)", "cd app && git push -f"] {
            assert_eq!(hit(c), Some("force-push"), "{c}");
        }
        for c in ["git push -f origin feature", "git push origin main", "git push origin @", "git push --delete origin feature", "git status", "git push --force-with-lease origin topic:refs/heads/topic", "echo 'git push -f'"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe010_hard_reset_and_forced_clean_ask_soft_reset_and_dry_run_run() {
        for c in ["git reset --hard", "git reset --hard HEAD~1", "git clean -fdx", "git clean --force -d", "git -C x clean -xdf"] {
            assert_eq!(hit(c), Some("discard"), "{c}");
        }
        for c in ["git reset --soft HEAD~1", "git reset", "git clean -n", "git clean -fdn", "git clean -d --dry-run"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe011_database_clients_dropping_or_truncating_ask_but_the_words_elsewhere_run() {
        for c in ["psql -c \"DROP TABLE users\"", "echo 'TRUNCATE sessions;' | psql mydb", "dropdb production", "mysql -e 'drop database if exists shop'", "psql <<EOF\nDROP SCHEMA public CASCADE;\nEOF", "mongosh --eval 'db.users.drop()'", "npx prisma db execute --stdin < drop.sql; psql -c 'drop view v'"] {
            assert_eq!(hit(c), Some("db-drop"), "{c}");
        }
        for c in ["git commit -m 'drop the users table'", "grep -r 'DROP TABLE' migrations", "psql -c 'select 1'", "cat schema.sql"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_stripe_changes_and_live_keys_ask_listening_listing_and_searching_run() {
        for c in ["stripe subscriptions cancel sub_1", "stripe customers delete cus_1", "stripe refunds create --charge ch_1", "stripe customers list --live", "curl -u sk_live_abc: https://api.stripe.com/v1/charges", "STRIPE_KEY=rk_live_x node pay.js"] {
            assert_eq!(hit(c), Some("stripe"), "{c}");
        }
        for c in ["stripe listen --forward-to localhost:3000", "stripe customers list", "grep -r sk_live_ src", "rg sk_live_ .", "stripe --help"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_infrastructure_apply_and_destroy_ask_plan_and_init_run() {
        for c in ["terraform apply -auto-approve", "npx cdk deploy", "terraform destroy", "tofu apply", "terragrunt run-all apply", "terragrunt destroy", "pulumi up -y", "pulumi destroy", "cdk destroy --all"] {
            assert_eq!(hit(c), Some("infra"), "{c}");
        }
        for c in ["terraform plan", "terraform init", "terragrunt run-all plan", "pulumi preview", "cdk diff", "cdk synth"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_production_deploys_ask_plain_deploys_and_production_installs_run() {
        for c in ["vercel --prod", "wrangler deploy --env production", "netlify deploy --prod", "firebase deploy -P prod", "fly deploy -e production", "railway up --environment production", "npm run deploy -- --stage=prod", "gcloud run deploy api --env=prod"] {
            assert_eq!(hit(c), Some("prod-deploy"), "{c}");
        }
        for c in ["vercel deploy", "npm install --production", "wrangler deploy", "NODE_ENV=production npm run build", "ls production", "vercel env pull"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe009_the_master_switch_and_a_switched_off_rule_stop_asking_at_once() {
        let s = json!({ ASK_FIELD: false });
        assert!(check("git push -f", &Base::default(), &s).is_none());
        let s = json!({ OFF_FIELD: ["force-push"] });
        assert!(check("git push -f", &Base::default(), &s).is_none());
        assert_eq!(check("git reset --hard", &Base::default(), &s).map(|r| r.id), Some("discard"));
        assert_eq!(check("git push -f", &Base::default(), &json!({ ASK_FIELD: true, OFF_FIELD: [] })).map(|r| r.name), Some("Force-push to main"));
        let long = "x".repeat(200);
        let r = reason(&long);
        assert!(r.starts_with(&format!("Kolux protected action: {}.", "x".repeat(120))) && !r.contains(&"x".repeat(121)));
        assert_eq!(RULES.len(), 7);
    }

    /// SAFE-013: the acceptance commands, with the workspace at /home/me/app.
    #[test]
    fn safe013_recursive_deletes_outside_unknown_or_piped_ask_inside_and_temp_run() {
        let del = |c: &str| hit(c) == Some("delete");
        for c in [
            "rm -rf /", "rm -rf ~/Documents/old", "rm -rf ..", "rm -rf .", "rm -rf .git", "rm -rf $DIR", "rm -rf \"$DIR\"",
            "cd $HOME && rm -rf build", "cd && rm -rf build", "popd && rm -rf build", "find . -name node_modules | xargs rm -rf",
            "Remove-Item -Recurse -Force ~", "Get-ChildItem . | Remove-Item -Recurse", "rd /s /q C:\\Users\\me\\Documents",
            "rm -rf ~alice/tmp", "rm -r C:build", "rm -rf /tmp/../etc", "cd - && rm -rf build", "rm -rf $(pwd)",
        ] {
            assert!(del(c), "asks: {c}");
        }
        for c in [
            "rm -rf node_modules dist", "rm -rf build/*", "cd packages/web && rm -rf dist", "rm -rf /tmp/scratch", "rd /s /q node_modules",
            "rm -rf ./build/", "cd /tmp && rm -rf cache", "rm file.txt", "rmdir -p a/b", "Remove-Item -Path dist -Recurse -Force", "del /s /q dist\\*.o",
        ] {
            assert!(!del(c), "runs: {c}");
        }
        // No workspace and no cwd: a relative delete asks, a temp one still runs.
        let none = Base { home: Some("/home/me".into()), temp: vec!["/tmp".into()], ..Base::default() };
        assert!(check("rm -rf build", &none, &json!({})).is_some());
        assert!(check("rm -rf /tmp/x", &none, &json!({})).is_none());
        // Windows form: Git Bash drive paths and letter case are read as the same workspace.
        let win = Base { workspace: Some("C:\\Users\\me\\app".into()), cwd: Some("C:\\Users\\me\\app".into()), home: Some("C:\\Users\\me".into()), temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()] };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id) == Some("delete");
        assert!(w("rm -rf /c/Users/me/app/.git") && w("rd /s /q C:\\Users\\me") && w("Remove-Item -Recurse -Force -LiteralPath C:\\Users\\me\\app"));
        assert!(!w("rd /s /q node_modules") && !w("rm -rf C:\\Users\\me\\AppData\\Local\\Temp\\x"));
        // Letter case is ignored on Windows only.
        if cfg!(windows) {
            assert!(!w("rm -rf /c/users/ME/app/dist"));
        }
    }

    /// A scratch HOME under TEMP: HOME and every ancestor of it still ask; siblings and children run.
    #[test]
    fn safe013_home_or_an_ancestor_of_home_under_temp_is_never_a_temp_delete() {
        let b = Base {
            workspace: Some("/home/me/app".into()),
            cwd: Some("/home/me/app".into()),
            home: Some("/tmp/scratch/home".into()),
            temp: vec!["/tmp".into()],
        };
        let del = |c: &str| check(c, &b, &json!({})).map(|r| r.id) == Some("delete");
        for c in [
            "rm -rf ~", "rm -rf ~/", "rm -rf $HOME", "rm -rf \"/tmp/scratch/home\"", "rm -rf /tmp/scratch", "rm -rf /tmp",
            "rm -r /tmp/scratch/home/..", "rm -rf /tmp/scratch/home/", "rm -rf /tmp/scratch/home/.", "rm -rf ~/sub/..",
            "rm -rf /tmp/scratch/home/sub/../", "Remove-Item -Recurse -Force ~", "rm -rf /tmp/scratch\\home\\",
        ] {
            assert!(del(c), "asks: {c}");
        }
        for c in ["rm -rf /tmp/scratch/home/sub/build", "rm -rf ~/sub/build", "rm -rf /tmp/other", "rm -rf /tmp/scratch/other"] {
            assert!(!del(c), "runs: {c}");
        }
        let win = Base {
            workspace: Some("C:\\Users\\me\\app".into()),
            cwd: Some("C:\\Users\\me\\app".into()),
            home: Some("C:\\Users\\me\\AppData\\Local\\Temp\\scratch\\home".into()),
            temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()],
        };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id) == Some("delete");
        assert!(w("rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\scratch\\home\\") && w("rm -rf /c/Users/me/AppData/Local/Temp/scratch"));
        assert!(w("rd /s /q C:\\Users\\me\\AppData\\Local\\Temp") && w("Remove-Item -Recurse -Force ~"));
        assert!(!w("rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\scratch\\home\\sub\\build") && !w("rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\other"));
        // Letter case is ignored on Windows only.
        if cfg!(windows) {
            assert!(w("rd /s /q C:\\USERS\\ME\\appdata\\local\\temp\\SCRATCH\\Home") && w("rm -rf /c/users/ME/appdata/local/TEMP/Scratch"));
            assert!(!w("rd /s /q C:\\USERS\\me\\AppData\\Local\\Temp\\Scratch\\HOME\\Sub"));
        }
    }

    /// SAFE-014: wrapped, chained, nested and encoded commands, and the harmless lookalikes.
    #[test]
    fn safe014_wrapped_chained_nested_and_encoded_commands_still_ask_and_lookalikes_run() {
        use base64::Engine;
        let enc = |c: &str| base64::engine::general_purpose::STANDARD.encode(c.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
        let ta = "terraform apply -auto-approve";
        for (c, id) in [
            ("bash -c \"rm -rf /\"", "delete"), ("echo $(rm -rf /)", "delete"), ("echo `rm -rf /`", "delete"), ("cmd /c rd /s /q C:\\Users", "delete"),
            (&*format!("powershell -ExecutionPolicy Bypass -Command \"{ta}\""), "infra"), (&*format!("powershell -ep bypass -Command {ta}"), "infra"),
            (&*format!("powershell -WindowStyle Hidden -Command \"{ta}\""), "infra"), (&*format!("pwsh -of text -c \"{ta}\""), "infra"),
            (&*format!("powershell -EncodedCommand {}", enc(ta)), "infra"), (&*format!("powershell -nop -e {}", enc(ta)), "infra"), (&*format!("powershell -enc {}", enc(ta)), "infra"),
            (&*format!("powershell -File deploy.ps1; {ta}"), "infra"),
            ("cmd //c rd /s /q C:\\Windows", "delete"), ("rd /s/q C:\\Windows", "delete"), ("del /q/s C:\\Windows\\system32\\x.dll", "delete"),
            ("sudo -u root rm -rf /usr", "delete"), ("sudo -uroot rm -rf /usr", "delete"), ("nice -n 10 rm -rf /usr", "delete"), ("env -u NAME rm -rf /usr", "delete"),
            ("timeout 5 rm -rf /usr", "delete"), (&*format!("timeout 30s {ta}"), "infra"), ("wsl -d Ubuntu -- rm -rf /usr", "delete"), ("eval \"rm -rf /\"", "delete"),
            ("echo $(echo $(echo $(echo $(rm -rf /))))", "delete"), ("( rm -rf / )", "delete"), ("true || { rm -rf /; }", "delete"),
        ] {
            assert_eq!(hit(c), Some(id), "asks: {c}");
        }
        for c in [
            "sudo -u root ls build", "timeout 5 ls", "nice -n 10 echo hi", "powershell -ExecutionPolicy Bypass -Command \"Write-Host hi\"", "rd /s/q build",
            "echo \"rm -rf /\"", "echo 'rm -rf /'", "bash -c \"echo 'rm -rf /'\"", "powershell -File rm.ps1 -rf /", "echo $(echo $(echo $(echo $(echo $(rm -rf /)))))",
        ] {
            assert_eq!(hit(c), None, "runs: {c}");
        }
    }

    /// T-604 (R03-safety-accounts.1): the audit's commands. An apostrophe in a `#` comment or in a
    /// heredoc or PowerShell here-string body, a backslash-escaped quote, the `'\''` idiom or a
    /// PowerShell backtick-escaped quote once hid the rest of the command from every rule.
    #[test]
    fn safe014_comments_heredocs_here_strings_and_escapes_cannot_hide_a_command() {
        for (c, id) in [
            ("# Let's publish the fix\ngit push --force origin main", "force-push"),
            ("git add -A # don't forget new files\ngit reset --hard origin/main", "discard"),
            ("cat > NOTES.md <<'EOF'\nIt's done\nEOF\ngit push --force origin main", "force-push"),
            ("cat > NOTES.md <<EOF\nIt's done\nEOF\ngit push --force origin main", "force-push"),
            ("$notes = @'\nIt's done\n'@\n...\nRemove-Item -Recurse -Force C:\\Users\\me\\Documents", "delete"),
            ("git commit -m 'Don'\\''t crash' && git push --force origin main", "force-push"),
            ("echo It\\'s done; rm -rf ~/Documents", "delete"),
            ("git commit -m \"Say `\"hi`\"\" ; git push -f origin main", "force-push"),
            // The same tricks with the stray quotes paired up, so no reading ends inside a quote.
            ("# it's late\ngit push --force origin main\n# it's done", "force-push"),
            ("echo It\\'s; rm -rf ~/Documents; echo it\\'s", "delete"),
            ("cat > a.md <<'EOF'\nIt's\nEOF\ngit reset --hard\ncat > b.md <<'EOF'\nit's\nEOF", "discard"),
            ("$a = @'\nIt's\n'@\nRemove-Item -Recurse -Force ~\n$b = @'\nit's\n'@", "delete"),
            ("<# it's #>\ngit clean -fdx\n<# it's #>", "discard"),
            // A line continued with a backslash (or PowerShell's backtick) is one command.
            ("git push \\\n  --force origin main", "force-push"),
            ("git push `\n  --force origin main", "force-push"),
        ] {
            assert_eq!(hit(c), Some(id), "asks: {c:?}");
        }
        for c in [
            "# git push --force origin main\ngit status",
            "git commit -m 'Don'\\''t push --force to main'",
            "echo \"it's fine\" # rm -rf ~",
            "printf '%s\\n' \"a \\\" b\"",
            "cat > notes.md <<'EOF'\nIt's done: git status\nEOF\ngit status",
        ] {
            assert_eq!(hit(c), None, "runs: {c:?}");
        }
    }

    /// T-604 review of PR #15, blocking 1: a backslash at a line's end joins the next line with
    /// nothing between them, as bash does (LF or CRLF); only PowerShell's backtick leaves a space.
    #[test]
    fn t604r1_a_backslash_line_join_joins_the_words_with_nothing_between() {
        let mut missed: Vec<String> = Vec::new();
        for (c, id) in [
            ("git reset --ha\\\nrd", "discard"),
            ("git push -f origin ma\\\nin", "force-push"),
            ("git reset --ha\\\r\nrd", "discard"),
            ("git push -f origin ma\\\r\nin", "force-push"),
            ("git push `\n  --force origin main", "force-push"),
        ] {
            if hit(c) != Some(id) {
                missed.push(format!("should ask ({id}): {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 review of PR #15, blocking 2: outside quotes a backslash before an ordinary character
    /// is dropped, as bash does, so `--forc\e` is `--force` and `g\it` is `git`.
    #[test]
    fn t604r2_a_backslash_before_an_ordinary_character_is_dropped() {
        let mut missed: Vec<String> = Vec::new();
        for (c, id) in [
            ("git push --forc\\e origin main", "force-push"),
            ("g\\it reset --hard", "discard"),
            ("git re\\set --ha\\rd", "discard"),
            ("bash -c 'g\\it reset --hard'", "discard"),
        ] {
            if hit(c) != Some(id) {
                missed.push(format!("should ask ({id}): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["find . -name '*.tmp' -exec echo {} \\;", "echo a\\;git status", "del /s /q dist\\*.o", "rm -rf .\\build\\out", "rm -rf ..\\app\\build"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 review of PR #15, blocking 3: bash's ANSI-C quote `$'..'` honours `\'`, so a stray
    /// quote inside one cannot open a quote that hides the next command.
    #[test]
    fn t604r3_an_ansi_c_quote_honours_its_escaped_quote() {
        let cases = [("echo $'\\'' ; git push -f origin main #'", Some("force-push")), ("printf $'it\\'s\\n'; git reset --hard", Some("discard")), ("echo $'a\\'b' && git status", None)];
        let missed: Vec<String> = cases.iter().filter(|(c, want)| hit(c) != *want).map(|(c, want)| format!("{c:?}: want {want:?}, got {:?}", hit(c))).collect();
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 review of PR #15, should-fix: a `-c alias.X=..` that the command then runs, shortened
    /// long options, any rm bundle holding r, `env -S`, and `$IFS` as a word break.
    #[test]
    fn t604r4_aliases_short_options_rm_bundles_env_split_and_ifs_cannot_hide_a_command() {
        let mut missed: Vec<String> = Vec::new();
        for (c, id) in [
            ("git -c alias.p='push -f' p origin main", "force-push"),
            ("git -c alias.x='!git reset --hard' x", "discard"),
            ("git -c alias.X=reset x --hard", "discard"),
            ("git reset --ha", "discard"),
            ("git push --del origin main", "force-push"),
            ("git push --force-w origin main", "force-push"),
            ("git push --mirr origin", "force-push"),
            ("rm --recu ~/Documents", "delete"),
            ("rm -rrrrf ~/Documents", "delete"),
            ("rm -fRv ~/Documents", "delete"),
            ("env -S 'git push -f origin main'", "force-push"),
            ("env --split-string='git reset --hard'", "discard"),
            ("env -S'git reset --hard' ", "discard"),
            ("git${IFS}reset${IFS}--hard", "discard"),
            ("git$IFS'push' -f origin main", "force-push"),
        ] {
            if hit(c) != Some(id) {
                missed.push(format!("should ask ({id}): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["git -c alias.st=status st", "git -c alias.p='push -f' status", "git push --follow-tags origin main", "env -S 'git status'", "echo \"${IFS}\"; git status"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 re-review of PR #15: every word is read both with its backslashes kept and with them
    /// dropped by bash's rules, and a rule asks when either reading trips it. A `:` earlier in a word,
    /// a backtick or `$(` cannot make a backslash count as a Windows separator, and `\.\.` cannot
    /// stop `..` from leaving the temp folder. On a Windows base a backslash in a path is still a
    /// separator, while the program and its options are read the bash way too.
    #[test]
    fn t604r6_each_word_is_read_with_and_without_its_backslashes() {
        let mut missed: Vec<String> = Vec::new();
        for (c, id) in [
            ("git push -f origin HEAD:ma\\in", "force-push"),
            ("git push -f origin :ma\\in", "force-push"),
            ("git push -f origin +HEAD:ma\\in", "force-push"),
            ("echo C:`g\\it reset --hard`", "discard"),
            ("echo C:$(g\\it reset --hard)", "discard"),
            ("echo %X%`g\\it push --forc\\e origin main`", "force-push"),
            ("mkdir /tmp/a:; rm -rf /tmp/a:/\\.\\./\\.\\.$HOME", "delete"),
            ("mkdir /tmp/a:; rm -rf /tmp/a:/\\.\\./\\.\\./home/me", "delete"),
            ("rm -rf /tmp/\\.\\./home/me", "delete"),
        ] {
            if hit(c) != Some(id) {
                missed.push(format!("should ask ({id}): {c:?}, got {:?}", hit(c)));
            }
        }
        let win = Base {
            workspace: Some("C:\\Users\\me\\app".into()),
            cwd: Some("C:\\Users\\me\\app".into()),
            home: Some("C:\\Users\\me".into()),
            temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()],
        };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id);
        for c in ["r\\m -rf ~", "rm -\\rf ~", "r\\m -r C:\\Users\\me\\Documents", "rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\..\\..\\Roaming"] {
            if w(c) != Some("delete") {
                missed.push(format!("should ask on Windows (delete): {c:?}, got {:?}", w(c)));
            }
        }
        for c in ["rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\other", "rm -rf C:\\Users\\me\\app\\build", "del /s /q dist\\*.o", "Remove-Item -Recurse -Force .\\build\\out"] {
            if w(c).is_some() {
                missed.push(format!("should run on Windows: {c:?}, got {:?}", w(c)));
            }
        }
        for c in ["rm -rf /tmp/build", "rm -rf ./build\\ out"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 round 3 review of PR #15: on a Windows base the path of each word is judged in both
    /// readings, so Git Bash's `\.\.` (`..`) is not read as `/./.`; the `Shell` path stands alone only
    /// where the `Bash` word lost its meaning (drive-relative, or no separator left).
    #[test]
    fn t604r7_on_a_windows_base_both_readings_of_a_path_are_judged() {
        let win = Base {
            workspace: Some("C:\\Users\\me\\app".into()),
            cwd: Some("C:\\Users\\me\\app".into()),
            home: Some("C:\\Users\\me".into()),
            temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()],
        };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in ["rm -rf x/\\.\\./\\.\\./\\.\\.", "rm -rf C:/Users/me/app/build/\\.\\.", "rm -rf C:\\Users\\me\\AppData\\Local\\Temp\\x/\\.\\./\\.\\./\\.\\./Documents"] {
            if w(c) != Some("delete") {
                missed.push(format!("should ask on Windows (delete): {c:?}, got {:?}", w(c)));
            }
        }
        for c in ["rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\other", "rm -rf C:\\Users\\me\\app\\build", "Remove-Item -Recurse -Force .\\build\\out", "rm -rf build\\out", "del /s /q dist\\*.o"] {
            if w(c).is_some() {
                missed.push(format!("should run on Windows: {c:?}, got {:?}", w(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 round 3 review of PR #15: a command over 256 KB is asked about outright, unread, so
    /// the answer stays well inside the hook's 1.5 s on a slow machine; one just under is read as
    /// usual, and the master switch still turns asking off.
    #[test]
    fn t604r8_a_command_over_256_kb_is_asked_about_unread() {
        let long = format!("echo {}", "a".repeat(256 * 1024));
        let t0 = std::time::Instant::now();
        let asked = check(&long, &base(), &json!({})).map(|r| r.name);
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(asked, Some("Commands over 256 KB, too long to read in time"), "after {ms:.0} ms");
        assert!(ms < 50.0, "asked in {ms:.0} ms");
        assert_eq!(check(&format!("echo {}", "a".repeat(256 * 1024 - 5)), &base(), &json!({})).map(|r| r.id), None);
        assert_eq!(check(&long, &base(), &json!({ ASK_FIELD: false })).map(|r| r.id), None);
    }

    /// T-604 round 4 review of PR #15: a recursive delete whose target holds a backtick, a caret, a
    /// backslash before anything but a plain path character, or a drive-relative form asks, whatever
    /// any reading makes of it; plain Windows paths still run.
    #[test]
    fn t604r9_a_delete_target_with_escapes_or_a_drive_relative_form_asks() {
        let win = Base {
            workspace: Some("C:\\Users\\me\\app".into()),
            cwd: Some("C:\\Users\\me\\app".into()),
            home: Some("C:\\Users\\me".into()),
            temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()],
        };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in [
            "Remove-Item -Recurse -Force .`.\\.`.",
            "rd /s /q .^.\\.^.",
            "rm -rf C\\:",
            "rm -rf C:",
            "rd /s /q C:build",
            "rm -rf build\\.\\.",
            "cd .^.\\.^. && rd /s /q build",
        ] {
            if w(c) != Some("delete") {
                missed.push(format!("should ask on Windows (delete): {c:?}, got {:?}", w(c)));
            }
        }
        for c in [
            "rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\other",
            "del /s /q dist\\*.o",
            "rm -rf C:\\Users\\me\\app\\build",
            "Remove-Item -Recurse -Force .\\build\\out",
            "rd /s /q build\\out_1\\x-2",
            "rm -rf ..\\app\\build",
            "rd /s /q \"C:\\Users\\me\\app\\My Build\"",
        ] {
            if w(c).is_some() {
                missed.push(format!("should run on Windows: {c:?}, got {:?}", w(c)));
            }
        }
        for c in ["rm -rf C\\:", "rm -rf build^", "rm -rf b`uild"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["rm -rf build", "rm -rf ./build/out", "rm -rf /tmp/cache"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 round 5 review of PR #15: a wildcard (`*`, `?` or `[`) in a folder part of a delete
    /// target cannot be judged as written (`.?` is `..` on bash 5.1 and older), so the delete asks;
    /// a wildcard in the last part is judged by its folder as before.
    #[test]
    fn t604r10_a_wildcard_in_a_folder_part_of_a_delete_target_asks() {
        let mut missed: Vec<String> = Vec::new();
        for c in ["rm -rf .?/*", "rm -rf .[.]/*", "rm -rf build/*/../../..", "rm -rf a[b]/c"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["rm -rf build/*", "rm -rf dist/*.o", "del /s /q dist\\*.o", "rm -rf build/[ab]*.log"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 round 6 review of PR #15: a folder a cd, pushd or Set-Location moves to gets the same
    /// check as a folder part of a delete target: a wildcard, an escape or a drive-relative form
    /// makes it unknown, so a recursive delete after it asks.
    #[test]
    fn t604r11_a_cd_to_a_wildcard_or_escaped_folder_makes_a_later_delete_ask() {
        let mut missed: Vec<String> = Vec::new();
        for c in ["cd .?; rm -rf *", "cd .[.] && rm -rf *", "pushd .* && rm -rf build", "Set-Location .? ; Remove-Item -Recurse -Force *"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["cd build && rm -rf *", "cd src/app; rm -rf dist"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604 round 7 review of PR #15: Push-Location and Pop-Location move like pushd and popd; a
    /// wrapper's own folder option (env -C, sudo -D, start /D, wsl --cd) is a cd for the program it
    /// runs; and with CDPATH named in the command (or set for the hook), a relative cd is unknown.
    #[test]
    fn t604r12_push_location_wrapper_folders_and_cdpath_move_the_delete() {
        let win = Base {
            workspace: Some("C:\\Users\\me\\app".into()),
            cwd: Some("C:\\Users\\me\\app".into()),
            home: Some("C:\\Users\\me".into()),
            temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()],
        };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in [
            "Push-Location ..\\..; Remove-Item -Recurse -Force build",
            "Push-Location ../..; Remove-Item -Recurse -Force build",
            "Pop-Location; rm -rf build",
            "env -C ../.. rm -rf build",
            "env --chdir=../.. rm -rf build",
            "env --chdir ../.. rm -rf build",
            "env -C../.. rm -rf build",
            "sudo -D ../.. rm -rf build",
            "sudo -u root -D ../.. rm -rf build",
            "sudo --chdir=../.. rm -rf build",
            "sudo --chdir ../.. rm -rf build",
            "export CDPATH=/; cd home; rm -rf *",
            "CDPATH=/ cd home && rm -rf build",
        ] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["start /D ..\\.. rd /s /q build", "start /D C:\\Users rd /s /q build", "start /DC:\\Users rd /s /q build"] {
            if w(c) != Some("delete") {
                missed.push(format!("should ask on Windows (delete): {c:?}, got {:?}", w(c)));
            }
        }
        for c in ["cd build && rm -rf *", "cd home; rm -rf *", "env -C build rm -rf out", "sudo -D build rm -rf out", "Push-Location build; Remove-Item -Recurse -Force out"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        if w("start /D build rd /s /q out").is_some() {
            missed.push("should run on Windows: start /D build rd /s /q out".into());
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604: every rule's own examples still ask behind one to three harmless lines of the kinds
    /// that once hid what followed (comments, heredocs, here-strings and escapes with stray quotes),
    /// joined by a line break or a chain operator. A fixed-seed xorshift draws the mix, so a
    /// failure names its command and repeats.
    #[test]
    fn safe014_known_asking_commands_still_ask_behind_comment_heredoc_and_escape_prefixes() {
        // (prefix, whether only a line break may follow it: a comment runs to the end of its line,
        // and a heredoc's closing line stands alone)
        const PREFIXES: [(&str, bool); 12] = [
            ("# Let's go", true),
            ("ls # don't", true),
            ("<# it's a block #>", false),
            ("cat > N.md <<'EOF'\nIt's done\nEOF", true),
            ("cat > N.md <<-EOF\n\tit's \"odd\n\tEOF", true),
            ("$n = @'\nIt's done\n'@", false),
            ("$n = @\"\nSay \"hi\n\"@", false),
            ("echo It\\'s done", false),
            ("git commit -m 'Don'\\''t crash'", false),
            ("Write-Host \"Say `\"hi`\"\"", false),
            ("echo \"a \\\" b\"", false),
            ("echo 'unclosed", true),
        ];
        const JOINS: [&str; 4] = ["\n", "; ", " && ", " || "];
        let mut seed: u64 = 0x5AFE_0604_C0DE_0001;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let samples: Vec<(&str, &str)> = RULES.iter().flat_map(|r| r.samples.iter().map(move |s| (*s, r.id))).collect();
        let mut missed = Vec::new();
        for _ in 0..3000 {
            let mut c = String::new();
            for _ in 0..1 + next() % 3 {
                let (prefix, line) = PREFIXES[(next() % PREFIXES.len() as u64) as usize];
                c.push_str(prefix);
                c.push_str(if line { "\n" } else { JOINS[(next() % JOINS.len() as u64) as usize] });
            }
            let (sample, id) = samples[(next() % samples.len() as u64) as usize];
            c.push_str(sample);
            if hit(&c) != Some(id) {
                missed.push(c);
            }
        }
        assert!(missed.is_empty(), "{} of 3000 missed; first: {:?}", missed.len(), missed.first());
    }

    /// SAFE-015: the page lists the seven rules by plain name with two examples each, and every
    /// example really trips its own rule (so the page never shows a command that would not ask).
    #[test]
    fn safe015_the_catalog_lists_seven_plain_names_and_each_example_trips_its_own_rule() {
        let names: Vec<&str> = catalog().iter().map(|r| r.name).collect();
        assert_eq!(names, ["Stripe changes", "Force-push to main", "Deleting database tables", "Infrastructure changes", "Production deploys", "Deleting folders outside the workspace", "Throwing away uncommitted work"]);
        for r in catalog() {
            for s in r.samples {
                assert_eq!(hit(s), Some(r.id), "{} example {s}", r.id);
            }
        }
        let v = serde_json::to_value(catalog()).unwrap();
        assert_eq!((v[1]["id"].as_str(), v[1]["samples"][0].as_str()), (Some("force-push"), Some("git push --force origin main")));
    }

    /// SAFE-015 acceptance, through the real hook answer with a stand-in PreToolUse event: the
    /// settings are written exactly as the Safety page writes them.
    #[test]
    fn safe015_switching_force_push_off_and_on_and_the_master_switch_change_the_next_answer() {
        let ev = br#"{"hook_event_name":"PreToolUse","tool_name":"Bash","cwd":"/home/me/app","tool_input":{"command":"git push --force origin main"}}"#;
        let ask = |s: &Value| crate::hooks::reply_body("/claude", ev, s) != "{}";
        // Never saved: the master switch is on and every rule asks.
        assert!(ask(&json!({})));
        // The rule's switch off: the page saves protectedOff holding the id, and the next one runs.
        assert!(!ask(&json!({ OFF_FIELD: ["force-push"] })));
        // Switched back on: the page saves the list without it, and it asks again.
        assert!(ask(&json!({ OFF_FIELD: [] })));
        // Another rule off leaves this one asking.
        assert!(ask(&json!({ OFF_FIELD: ["discard"] })));
        // The master switch off: no protected command asks, whatever the list says.
        assert!(!ask(&json!({ ASK_FIELD: false })));
        assert!(!ask(&json!({ ASK_FIELD: false, OFF_FIELD: [] })));
        assert!(ask(&json!({ ASK_FIELD: true })));
        // A garbled list (hand-edited file) fails closed: the rules stay on.
        assert!(ask(&json!({ OFF_FIELD: "force-push" })));
        assert!(ask(&json!({ OFF_FIELD: [7, null] })));
    }

    /// mask, and a second run over its own answer must change nothing (SAFE-019): every input of
    /// every safe019 test below goes through this, so the whole set is proven twice-safe.
    fn masked(text: &str) -> String {
        let once = mask(text);
        assert_eq!(mask(&once), once, "a second mask changed {text:?}");
        once
    }

    const STRIPE_LIVE: &str = "sk_live_51HabcdEFGH1234567890WXYZ";

    #[test]
    fn safe019_stripe_secret_keys_keep_their_prefix_and_last_four_and_nothing_else() {
        let cmd = format!("curl -u {STRIPE_LIVE}: https://api.stripe.com/v1/charges");
        assert_eq!(masked(&cmd), "curl -u sk_live_....WXYZ: https://api.stripe.com/v1/charges");
        for (raw, shown) in [("sk_test_4eC39HqLyjWDarjtT1zdp7dc", "sk_test_....p7dc"), ("rk_live_51HabcdEFGH1234567890Qrst", "rk_live_....Qrst"), ("rk_test_abcdefgh12345678", "rk_test_....5678"), ("whsec_8f3a9c1d2e4b5a6c7d8e9f0a", "whsec_....9f0a")] {
            assert_eq!(masked(&format!("echo {raw} | tee k")), format!("echo {shown} | tee k"), "{raw}");
        }
        assert!(!masked(&format!("STRIPE_SECRET_KEY={STRIPE_LIVE} node pay.js")).contains("51Habcd"));
        // Too short to be a key, a publishable key, and a name in a path stay as typed.
        assert_eq!(masked("grep -r sk_live_ src"), "grep -r sk_live_ src");
        assert_eq!(masked("echo pk_live_51HabcdEFGH1234567890WXYZ"), "echo pk_live_51HabcdEFGH1234567890WXYZ");
        assert_eq!(masked("cat my_sk_live_51HabcdEFGH1234567890WXYZ.txt"), "cat my_sk_live_51HabcdEFGH1234567890WXYZ.txt");
    }

    #[test]
    fn safe019_a_value_already_masked_passes_the_general_pass_untouched_and_a_second_run_changes_nothing() {
        for already in ["curl -u sk_live_....WXYZ: https://x", "STRIPE_KEY=sk_live_....WXYZ", "export WEBHOOK_SECRET=whsec_....9f0a", "--token sk_test_....p7dc", "API_KEY=[hidden]", "DB_PASSWORD=$DB_PASSWORD"] {
            assert_eq!(masked(already), already);
        }
        for c in [format!("STRIPE_KEY={STRIPE_LIVE}"), "mysql -u root -pS3cretPass".to_string(), "psql postgres://admin:hunter2@db:5432/app".to_string(), "FOO=bar\nTOKEN=abc123".to_string()] {
            let once = masked(&c);
            assert_eq!(masked(&once), once, "{c}");
        }
    }

    /// SAFE-019 acceptance: a short password flag with the value attached, a token flag, and a
    /// connection URL carrying a user and password.
    #[test]
    fn safe019_attached_password_flags_token_flags_and_url_credentials_are_hidden() {
        let m = masked("mysql -u root -pS3cretPass -h db.example.com shop");
        assert_eq!(m, "mysql -u root -p[hidden] -h db.example.com shop");
        assert_eq!(masked("mysqldump -pa shop"), "mysqldump -p[hidden] shop", "a one-letter password to a MySQL client");
        assert_eq!(masked("gh auth login --token ghp_not_a_real_one_but_long_enough_xx"), "gh auth login --token [hidden]");
        assert_eq!(masked("deploy --token abc123def456 --env x"), "deploy --token [hidden] --env x");
        assert_eq!(masked("deploy --token=abc123def456 --env x"), "deploy --token=[hidden] --env x");
        assert_eq!(masked("deploy --password \"two words\" go"), "deploy --password [hidden] go");
        assert_eq!(masked("bash -c \"deploy --password \\\"two words\\\" go\""), "bash -c \"deploy --password [hidden] go\"");
        assert_eq!(masked("psql postgres://admin:hunter2@db.example.com:5432/app -c 'select 1'"), "psql postgres://[hidden]@db.example.com:5432/app -c 'select 1'");
        assert_eq!(masked("redis-cli -u redis://:pw0rd@cache:6379"), "redis-cli -u redis://[hidden]@cache:6379");
        assert_eq!(masked("git clone https://user:glpat-abcdef@gitlab.com/o/r.git"), "git clone https://[hidden]@gitlab.com/o/r.git");
        assert_eq!(masked("amqp://guest:guest@localhost/vhost"), "amqp://[hidden]@localhost/vhost");
        let m = masked(&format!("psql postgres://admin:hunter2@db:5432/app && mysql -pHunter2x && curl --token {STRIPE_LIVE}"));
        assert!(!m.contains("hunter2") && !m.contains("Hunter2x") && !m.contains("51Habcd"), "{m}");
    }

    #[test]
    fn safe019_labelled_secrets_provider_keys_headers_and_env_file_lines_are_hidden() {
        assert_eq!(masked("API_KEY=abc123 node app.js"), "API_KEY=[hidden] node app.js");
        assert_eq!(masked("PGPASSWORD='my pass' psql"), "PGPASSWORD=[hidden] psql");
        assert_eq!(masked("curl 'https://x.test/hook?token=abc123&x=1'"), "curl 'https://x.test/hook?token=[hidden]&x=1'");
        assert_eq!(masked("aws configure set aws_secret_access_key=wJalrXUtnFEMI"), "aws configure set aws_secret_access_key=[hidden]");
        let tail = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
        for key in [format!("sk-ant-api03-{tail}"), format!("sk-proj-{tail}"), format!("xai-{tail}"), format!("AIzaSy{tail}x"), format!("ghp_{tail}abcd"), format!("github_pat_{tail}"), "AKIAIOSFODNN7EXAMPLE".to_string(), "ASIAIOSFODNN7EXAMPLE".to_string(), "xoxb-1234567890-abcdefghij".to_string(), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP".to_string()] {
            assert_eq!(masked(&format!("echo {key} > out")), "echo [hidden] > out", "{key}");
        }
        assert_eq!(masked("curl -H 'Authorization: Bearer abcDEF123.456_xyz' https://x"), "curl -H 'Authorization: Bearer [hidden]' https://x");
        assert_eq!(masked("curl -H \"Authorization: Basic dXNlcjpwYXNz\" https://x"), "curl -H \"Authorization: Basic [hidden]\" https://x");
        let pem = "echo '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----' > id";
        assert_eq!(masked(pem), "echo '[hidden]' > id");
        assert_eq!(masked("echo '-----BEGIN PRIVATE KEY-----\nMIIBOg"), "echo '[hidden]", "a block cut short hides to the end");
        // An env-file style line hides its value whatever the name, and keeps the export and the line ending.
        assert_eq!(masked("cat > .env <<EOF\nDATABASE_HOST=db.internal\r\nexport SESSION_SALT=\"s a l t\"\nEOF"), "cat > .env <<EOF\nDATABASE_HOST=[hidden]\r\nexport SESSION_SALT=[hidden]\nEOF");
    }

    #[test]
    fn safe019_ordinary_commands_and_prose_are_left_exactly_as_typed() {
        for c in [
            "git commit -m \"fix the token bug\"", "ls -p", "ssh -p 2222 host", "docker run -p 8080:80 nginx", "perl -pe 's/a/b/' f", "git push origin main",
            "NODE_ENV=production npm run build", "echo author=bob", "npm run build -- --prefix /usr", "tool --password-file ./pw.txt run", "echo basic configuration", "cat key.pem",
            "curl https://example.com/a@b", "git clone git@github.com:o/r.git", "ssh://git@host/repo", "echo $TOKEN", "TOKEN=$OTHER run", "tool --token --verbose", "rm -rf build", "",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
        // Non-ASCII text next to a secret never splits a character.
        assert_eq!(masked("echo héllo ünï --token sécrét-é wörld"), "echo héllo ünï --token [hidden] wörld");
        assert_eq!(masked("naïve=ü TOKEN=é"), "naïve=ü TOKEN=[hidden]");
    }

    /// FIX-SOON 1: the attached -pVALUE form belongs to password-taking programs only.
    #[test]
    fn safe019_attached_p_is_hidden_for_password_programs_and_left_alone_for_everything_else() {
        for c in ["find . -name x -print", "find . -perm 644 -path src -prune -printf x", "gcc -pthread -pedantic -pipe main.c", "tar -pxzf backup.tgz", "ls -la -pq", "sort -pfoo f", "cp -pfoo a b"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("7z a -pS3cret out.7z src"), "7z a -p[hidden] out.7z src");
        assert_eq!(masked("sudo mysql -u root -pS3cretPass shop"), "sudo mysql -u root -p[hidden] shop");
        assert_eq!(masked("cd x && mariadb-dump -pab db > out.sql"), "cd x && mariadb-dump -p[hidden] db > out.sql");
        assert_eq!(masked("bash -c \"mysql -e 'select 1' -pHunter2x\""), "bash -c \"mysql -e 'select 1' -p[hidden]\"");
        assert_eq!(masked("/usr/bin/mysqladmin -pHunter2x status"), "/usr/bin/mysqladmin -p[hidden] status");
        // A different command later in the line is not a password program, though an earlier one was.
        assert_eq!(masked("mysql -pHunter2x db; find . -perm 644"), "mysql -p[hidden] db; find . -perm 644");
    }

    /// FIX-SOON 2: limits, tokenizers and "read it from stdin" are not secrets.
    #[test]
    fn safe019_flags_that_only_sound_like_secrets_are_left_as_typed() {
        for c in ["llm --max-tokens 500 go", "llm --tokenizer gpt2 go", "cat token.txt | docker login --password-stdin ghcr.io", "tool --pass-through x run", "tool --token-limit 20 run", "tool --max-token-count 20 run", "MAX_TOKENS=500 node app.js", "tool --tokens 5 run"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("tool --password hunter2 run"), "tool --password [hidden] run", "the real flag still hides");
    }

    /// FIX-SOON 3: Bearer/Basic with a mixed-case word is a token only where a header carries it.
    #[test]
    fn safe019_bearer_and_basic_words_in_prose_stay_and_in_a_header_go() {
        for c in ["git commit -m \"Add Basic HttpClient\"", "echo basic Configuration", "echo Bearer Application", "git commit -m 'Bearer TokenRefresh support'"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("curl -H 'Authorization: Bearer AbcdEfghIj' https://x"), "curl -H 'Authorization: Bearer [hidden]' https://x");
        assert_eq!(masked("curl --header \"Authorization: Basic AbcdEfghIj\" https://x"), "curl --header \"Authorization: Basic [hidden]\" https://x");
        assert_eq!(masked("curl -H 'Authorization:Bearer AbcdEfghIj' https://x"), "curl -H 'Authorization:Bearer [hidden]' https://x");
        // Outside a header a digit still marks a token.
        assert_eq!(masked("echo Bearer abc123def456"), "echo Bearer [hidden]");
    }

    /// FIX-SOON 4: forms of the same secrets that the first pass missed.
    #[test]
    fn safe019_user_pass_pairs_sshpass_colon_headers_json_keys_new_prefixes_and_single_quoted_dollars_are_hidden() {
        assert_eq!(masked("curl -u admin:hunter2 https://api.example.com"), "curl -u [hidden] https://api.example.com");
        assert_eq!(masked("curl --user admin:hunter2 https://api.example.com"), "curl --user [hidden] https://api.example.com");
        assert_eq!(masked("curl -sS -u 'admin:hunter2' https://api.example.com"), "curl -sS -u [hidden] https://api.example.com");
        assert_eq!(masked("sshpass -p secret ssh host"), "sshpass -p [hidden] ssh host");
        assert_eq!(masked("sshpass -p secret ssh -p 2222 host"), "sshpass -p [hidden] ssh -p 2222 host");
        assert_eq!(masked("sshpass -pSecret ssh host"), "sshpass -p[hidden] ssh host");
        assert_eq!(masked("curl -H \"X-Api-Key: v4lue\" https://x"), "curl -H \"X-Api-Key: [hidden]\" https://x");
        assert_eq!(masked("curl -H 'PRIVATE-TOKEN: v4lue' https://x"), "curl -H 'PRIVATE-TOKEN: [hidden]' https://x");
        assert_eq!(masked("curl -H 'Authorization: token v4lue' https://x"), "curl -H 'Authorization: token [hidden]' https://x");
        assert_eq!(masked("curl -H 'Authorization: v4lue' https://x"), "curl -H 'Authorization: [hidden]' https://x");
        assert_eq!(masked("curl -H 'Cookie: sid=abc; theme=dark' https://x"), "curl -H 'Cookie: [hidden]' https://x");
        assert_eq!(masked("curl -d '{\"password\":\"v4lue\"}' https://x"), "curl -d '{\"password\":\"[hidden]\"}' https://x");
        assert_eq!(masked("curl -d '{\"user\": \"bob\", \"api_key\": \"v4lue\"}' https://x"), "curl -d '{\"user\": \"bob\", \"api_key\": \"[hidden]\"}' https://x");
        assert_eq!(masked("bash -c \"curl -d '{\\\"token\\\":\\\"v4lue\\\"}' x\""), "bash -c \"curl -d '{\\\"token\\\":\\\"[hidden]\\\"}' x\"");
        let tail = "a1B2c3D4e5F6g7H8i9J0";
        for key in [format!("glpat-{tail}"), format!("npm_{tail}{tail}abcdefghijklmn"), format!("hf_{tail}{tail}abcdefghij")] {
            assert_eq!(masked(&format!("echo {key} > out")), "echo [hidden] > out", "{key}");
        }
        assert_eq!(masked("PASSWORD='$3cr3t' ./run"), "PASSWORD=[hidden] ./run");
        assert_eq!(masked("export API_TOKEN='$up3r'"), "export API_TOKEN=[hidden]");
        assert_eq!(masked("tool --token '$up3r' go"), "tool --token [hidden] go");
        // A real variable reference (bare or in double quotes) is not a secret; id:gid pairs and header names with no secret in them stay.
        for c in ["PASSWORD=\"$DB_PASS\" ./run", "PASSWORD=${DB_PASS} ./run", "PASSWORD=$(cat pw.txt) ./run", "docker exec -u 1000:1000 c ls", "docker run --user 1000:1000 img", "curl -H 'Accept: application/json' https://x", "curl -H 'Content-Type: text/plain' https://x", "echo \"note: remember the password\"", "curl -d '{\"name\":\"bob\",\"key\":\"abc\"}' https://x", "env npm_config_update_notifier_disabled=true npm i", "python -c 'from huggingface_hub import hf_hub_download_all_the_files_please'"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-2 item 3 (stand-in review FIX-SOON 1): a `;`, `&`, `|` or `(` inside a quoted argument
    /// that is already closed does not end the command, so the program is still known.
    #[test]
    fn safe019_separators_inside_closed_quotes_do_not_hide_the_program() {
        assert_eq!(masked("curl \"https://api.example.com/v1?a=1&b=2\" -u admin:hunter2"), "curl \"https://api.example.com/v1?a=1&b=2\" -u [hidden]");
        assert_eq!(masked("mysql -u root -e \"use shop; select 1\" -pS3cret"), "mysql -u root -e \"use shop; select 1\" -p[hidden]");
        assert_eq!(masked("mysql -e 'select 1 | select 2' -pS3cret"), "mysql -e 'select 1 | select 2' -p[hidden]");
        assert_eq!(masked("mysql -e \"select (1)\" -pS3cret"), "mysql -e \"select (1)\" -p[hidden]");
        assert_eq!(masked("sshpass -p secret ssh -o 'ProxyCommand=nc %h %p; true' host"), "sshpass -p [hidden] ssh -o 'ProxyCommand=nc %h %p; true' host");
        // A separator in the quote that wraps the command is still a separator, and so is one outside every quote.
        assert_eq!(masked("bash -c \"cd x; find . -perm 644; mysql -pS3cret\""), "bash -c \"cd x; find . -perm 644; mysql -p[hidden]\"");
        assert_eq!(masked("bash -c \"mysql -e 'a; b' -pS3cret\""), "bash -c \"mysql -e 'a; b' -p[hidden]\"");
        assert_eq!(masked("curl \"a;b\" -u x:y; ls -u admin:hunter2"), "curl \"a;b\" -u [hidden]; ls -u admin:hunter2");
        assert_eq!(masked("mysql -e \"a;b\"; find . -perm 644"), "mysql -e \"a;b\"; find . -perm 644");
    }

    /// FIX-2 item 4 (FIX-SOON 2): in a header the name needs no hyphen; a secret-sounding `name: value`
    /// at the start of a line or of a quoted string goes too, but prose with spaces in it stays.
    #[test]
    fn safe019_any_secretish_header_name_and_name_colon_value_at_a_line_or_quote_start_are_hidden() {
        assert_eq!(masked("curl -H \"Token: v4lue\" https://x"), "curl -H \"Token: [hidden]\" https://x");
        assert_eq!(masked("curl -H 'X_API_KEY: v4lue' x"), "curl -H 'X_API_KEY: [hidden]' x");
        assert_eq!(masked("curl --header 'Secret: v4lue' x"), "curl --header 'Secret: [hidden]' x");
        assert_eq!(masked("echo \"password: hunter2\" >> config.yml"), "echo \"password: [hidden]\" >> config.yml");
        assert_eq!(masked("password: hunter2\nname: bob"), "password: [hidden]\nname: bob");
        assert_eq!(masked("db:\n  api_key: v4lue\n  host: x"), "db:\n  api_key: [hidden]\n  host: x");
        for c in ["echo \"note: remember the password\"", "git commit -m \"token: rotate the keys\"", "curl -H 'Accept: application/json' https://x", "curl -H \"X-Request-Id: abc\" https://x", "echo password: reset", "grep -r \"token: \" src", "note: the token is rotated weekly"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-2 item 5 (AFTER 1): inside a JSON body a `$` is text, and an escaped quote does not end the value.
    #[test]
    fn safe019_json_values_with_a_dollar_or_an_escaped_quote_are_hidden_whole() {
        assert_eq!(masked("curl -d '{\"password\":\"$ecretPass\"}' https://x"), "curl -d '{\"password\":\"[hidden]\"}' https://x");
        assert_eq!(masked("curl -d '{\"token\":\"$HOME_not_a_ref\"}' x"), "curl -d '{\"token\":\"[hidden]\"}' x");
        assert_eq!(masked("curl -d '{\"password\":\"ab\\\"cd\"}' x"), "curl -d '{\"password\":\"[hidden]\"}' x");
        assert_eq!(masked("curl -d '{\"password\":\"ab\\\\\\\"cd\",\"user\":\"bob\"}' x"), "curl -d '{\"password\":\"[hidden]\",\"user\":\"bob\"}' x");
        assert_eq!(masked("bash -c \"curl -d '{\\\"token\\\":\\\"$up3r\\\"}' x\""), "bash -c \"curl -d '{\\\"token\\\":\\\"[hidden]\\\"}' x\"");
        assert_eq!(masked("bash -c \"curl -d '{\\\"token\\\":\\\"ab\\\\\\\"cd\\\"}' x\""), "bash -c \"curl -d '{\\\"token\\\":\\\"[hidden]\\\"}' x\"");
        // An empty value, one already hidden, and a key that is no secret stay; a variable reference outside JSON still stays.
        for c in ["curl -d '{\"password\":\"\"}' x", "curl -d '{\"password\":\"[hidden]\"}' x", "curl -d '{\"name\":\"$USER\"}' x", "PASSWORD=\"$DB_PASS\" ./run"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-2 item 6 (AFTER 2): the program is the command word, not any word that looks like one, so a
    /// path or an argument that only contains `mysql` or `-h` is left as typed; a wrapper or a launcher
    /// in front of the real program still shows it.
    #[test]
    fn safe019_the_command_word_decides_which_program_it_is() {
        for c in ["find /var/lib/mysql -perm 644", "cat /etc/mysql/my.cnf -pfoo", "ls -h; echo \"Basic HttpClient\"", "ls -h \"Basic HttpClient\""] {
            assert_eq!(masked(c), c, "{c}");
        }
        for (raw, shown) in [
            // FIX-4: a search tool's pattern is still a credential when it spells one.
            ("grep curl -u admin:hunter2 notes.txt", "grep curl -u [hidden] notes.txt"),
            ("sudo -u root mysql -pS3cret db", "sudo -u root mysql -p[hidden] db"),
            ("timeout 5 mysql -pS3cret db", "timeout 5 mysql -p[hidden] db"),
            ("MYSQL_HOST=x mysql -pS3cret db", "MYSQL_HOST=x mysql -p[hidden] db"),
            ("env FOO=1 mysqldump -pS3cret db", "env FOO=1 mysqldump -p[hidden] db"),
            ("ssh db mysql -pS3cret", "ssh db mysql -p[hidden]"),
            ("docker exec db mysql -pS3cret", "docker exec db mysql -p[hidden]"),
            ("kubectl exec pod -- mysql -pS3cret", "kubectl exec pod -- mysql -p[hidden]"),
            ("sudo curl -u admin:hunter2 https://x", "sudo curl -u [hidden] https://x"),
            ("ssh host curl -u admin:hunter2 https://x", "ssh host curl -u [hidden] https://x"),
            ("bash -c \"curl -u admin:hunter2 https://x\"", "bash -c \"curl -u [hidden] https://x\""),
            ("curl -H 'Authorization: Bearer AbcdEfghIj' https://x", "curl -H 'Authorization: Bearer [hidden]' https://x"),
            ("ssh host curl -H 'X-Note: Bearer AbcdEfghIj' https://x", "ssh host curl -H 'X-Note: Bearer [hidden]' https://x"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
    }

    /// FIX-3 item 2a (stand-in review FIX-SOON 1): a Windows folder in front of the program, or a
    /// command that only writes another command, still shows the program. A path that merely
    /// contains `mysql` or `curl` stays as typed.
    #[test]
    fn safe019_windows_paths_and_commands_that_write_commands_still_show_the_program() {
        for (raw, shown) in [
            (r"C:\xampp\mysql\bin\mysql.exe -u root -pS3cret", r"C:\xampp\mysql\bin\mysql.exe -u root -p[hidden]"),
            (r".\7z.exe a -pS3cret out.7z src", r".\7z.exe a -p[hidden] out.7z src"),
            (r#"& "C:\Program Files\7-Zip\7z.exe" a -pS3cret x.7z"#, r#"& "C:\Program Files\7-Zip\7z.exe" a -p[hidden] x.7z"#),
            (r"C:\Windows\System32\curl.exe -u admin:hunter2 https://x", r"C:\Windows\System32\curl.exe -u [hidden] https://x"),
            ("C:/xampp/mysql/bin/mysql.exe -pS3cret shop", "C:/xampp/mysql/bin/mysql.exe -p[hidden] shop"),
            ("echo \"mysql -pS3cret\" >> ~/.bashrc", "echo \"mysql -p[hidden]\" >> ~/.bashrc"),
            ("echo curl -u admin:hunter2", "echo curl -u [hidden]"),
            ("printf 'mysql -u root -pS3cret' > run.sh", "printf 'mysql -u root -p[hidden]' > run.sh"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in [r"find C:\xampp\mysql -perm 644", r"cat C:\ProgramData\MySQL\my.ini -pfoo", r"dir C:\tools\curl -u admin:hunter2", "find /var/lib/mysql -perm 644", "ls /opt/curl -u admin:hunter2"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-3 item 2b (FIX-SOON 1): wrapper options take a value only where that wrapper's own option
    /// does (`sudo -u root`, not `sudo -n`), and `then`, `do`, `else`, `!`, `{` and `winpty` pass through.
    #[test]
    fn safe019_wrapper_options_and_shell_keywords_do_not_hide_the_program() {
        for (raw, shown) in [
            ("sudo -n mysql -pS3cret", "sudo -n mysql -p[hidden]"),
            ("sudo -i mysql -pS3cret db", "sudo -i mysql -p[hidden] db"),
            ("sudo -s mysql -pS3cret", "sudo -s mysql -p[hidden]"),
            ("env -i mysql -pS3cret", "env -i mysql -p[hidden]"),
            ("sudo -n curl -u admin:hunter2 https://x", "sudo -n curl -u [hidden] https://x"),
            ("sudo --user root mysql -pS3cret", "sudo --user root mysql -p[hidden]"),
            ("timeout -s KILL 5 mysql -pS3cret", "timeout -s KILL 5 mysql -p[hidden]"),
            ("if true; then mysql -pS3cret; fi", "if true; then mysql -p[hidden]; fi"),
            ("for d in a b; do mysql -pS3cret $d; done", "for d in a b; do mysql -p[hidden] $d; done"),
            ("if false; then true; else mysql -pS3cret; fi", "if false; then true; else mysql -p[hidden]; fi"),
            ("! mysql -pS3cret", "! mysql -p[hidden]"),
            ("{ mysql -pS3cret; }", "{ mysql -p[hidden]; }"),
            ("winpty mysql -pS3cret", "winpty mysql -p[hidden]"),
            ("winpty docker exec -it db mysql -pS3cret", "winpty docker exec -it db mysql -p[hidden]"),
            // FIX-4: a search tool behind a wrapper hides a pattern that spells a credential too.
            ("sudo -n grep curl -u admin:hunter2 notes.txt", "sudo -n grep curl -u [hidden] notes.txt"),
            ("env -i grep curl -u admin:hunter2 notes.txt", "env -i grep curl -u [hidden] notes.txt"),
            ("sudo -S grep curl -u admin:hunter2 notes.txt", "sudo -S grep curl -u [hidden] notes.txt"),
            ("sudo -u root grep curl -u admin:hunter2 notes.txt", "sudo -u root grep curl -u [hidden] notes.txt"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
    }

    /// FIX-3 item 3 (FIX-SOON 2): a lone `'` inside a double-quoted argument is text, so a `;` or `&`
    /// in that argument does not end the command and the program stays known.
    #[test]
    fn safe019_a_lone_apostrophe_inside_double_quotes_is_text_and_does_not_hide_the_program() {
        assert_eq!(masked("mysql -u root -e \"select 1; -- don't\" -pS3cret"), "mysql -u root -e \"select 1; -- don't\" -p[hidden]");
        assert_eq!(masked("curl \"https://x/?q=it's&a=1\" -u admin:hunter2"), "curl \"https://x/?q=it's&a=1\" -u [hidden]");
        assert_eq!(masked("mysql -e \"it's; fine\" -e 'a;b' -pS3cret"), "mysql -e \"it's; fine\" -e 'a;b' -p[hidden]");
        assert_eq!(masked("bash -c \"echo don't; mysql -pS3cret\""), "bash -c \"echo don't; mysql -p[hidden]\"");
        assert_eq!(masked("bash -c \"mysql -e 'a; b' -pS3cret\""), "bash -c \"mysql -e 'a; b' -p[hidden]\"");
        assert_eq!(masked("bash -c \"curl -d '{\\\"x\\\":1}' -u admin:hunter2 x\""), "bash -c \"curl -d '{\\\"x\\\":1}' -u [hidden] x\"");
        // A separator outside the quote still ends the command.
        assert_eq!(masked("mysql -e \"it's\"; find . -perm 644"), "mysql -e \"it's\"; find . -perm 644");
    }

    /// FIX-4 item 2 (stand-in review FIX-SOON 1): a search tool as the command word no longer exempts
    /// its pattern (`grep -rn "mysql -p.."` is how someone hunts a leaked password), and `)` and a
    /// closing backtick end a `$(..)` or backtick command and bring back the one that was running.
    #[test]
    fn safe019_search_patterns_and_command_substitutions_still_show_the_program() {
        for (raw, shown) in [
            (r#"grep -rn "mysql -pS3cret" ."#, r#"grep -rn "mysql -p[hidden]" ."#),
            (r#"rg -e "curl -u admin:hunter2" logs/"#, r#"rg -e "curl -u [hidden]" logs/"#),
            ("$(which mysql) -u root -pS3cret", "$(which mysql) -u root -p[hidden]"),
            ("$(which curl) -u admin:hunter2 https://x", "$(which curl) -u [hidden] https://x"),
            ("`which mysql` -pS3cret", "`which mysql` -p[hidden]"),
            ("`which curl` -u admin:hunter2 https://x", "`which curl` -u [hidden] https://x"),
            ("man curl -u admin:hunter2", "man curl -u [hidden]"),
            // The substitution can sit inside a longer line, and the command around it is still known.
            ("cd x && $(which mysql) -u root -pS3cret", "cd x && $(which mysql) -u root -p[hidden]"),
            ("echo $(date) && `which curl` -u admin:hunter2 https://x", "echo $(date) && `which curl` -u [hidden] https://x"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        // After the `)` or the closing backtick the line goes on as before: a separator still cuts it,
        // and a path that only contains a program name stays as typed.
        for c in ["echo $(date; ls); find /var/lib/mysql -perm 644", "echo `date`; find /opt/curl -u admin:hunter2", "echo $(ls /opt) > /var/lib/mysql/list -pr"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-4 item 3 (FIX-SOON 2): a path whose parent folder is `bin` or `sbin` (any case) is a
    /// program, wherever it stands in the line, and a quoted run that starts a command and holds
    /// spaces in its folders is one word. A path under any other folder stays no program.
    #[test]
    fn safe019_a_program_under_a_bin_folder_or_in_a_quoted_command_is_still_a_program() {
        for (raw, shown) in [
            (r#""C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql" -u root -pS3cret"#, r#""C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql" -u root -p[hidden]"#),
            (r"doskey db=C:\xampp\mysql\bin\mysql -u root -pS3cret", r"doskey db=C:\xampp\mysql\bin\mysql -u root -p[hidden]"),
            ("alias db='/usr/local/mysql/bin/mysql -u root -pS3cret'", "alias db='/usr/local/mysql/bin/mysql -u root -p[hidden]'"),
            ("echo \"/usr/bin/mysql -pS3cret\" >> ~/.bashrc", "echo \"/usr/bin/mysql -p[hidden]\" >> ~/.bashrc"),
            ("echo /usr/sbin/curl -u admin:hunter2 https://x", "echo /usr/sbin/curl -u [hidden] https://x"),
            (r"echo C:\Tools\BIN\mysql -u root -pS3cret", r"echo C:\Tools\BIN\mysql -u root -p[hidden]"),
            // A quoted command that has spaces in its folders and no `bin` or `.exe`.
            (r#""C:\Program Files\7-Zip\7z" a -pS3cret x.7z"#, r#""C:\Program Files\7-Zip\7z" a -p[hidden] x.7z"#),
            (r#"& "C:\Program Files (x86)\7-Zip\7z" a -pS3cret x.7z"#, r#"& "C:\Program Files (x86)\7-Zip\7z" a -p[hidden] x.7z"#),
            ("'/opt/my tools/curl' -u admin:hunter2 https://x", "'/opt/my tools/curl' -u [hidden] https://x"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in [
            "find /var/lib/mysql -perm 644",
            r"dir C:\tools\curl -u admin:hunter2",
            "cat /etc/mysql/my.cnf -pfoo",
            "ls /opt/bin/data/mysql -pr",
            r#"find "C:\Program Files\Some Tool\mysql" -pfoo"#,
            r#"dir "C:\Program Files\MySQL\data" -pfoo"#,
            "ls /usr/bin -pr",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-4 item 4 (FIX-SOON 3): the password that `echo` or `printf` pipes into `sudo -S` /
    /// `--stdin`, or into a command with `--password-stdin`, is hidden. A variable reference, a pipe
    /// that goes nowhere near a password reader, and `||` stay as typed.
    #[test]
    fn safe019_a_password_echoed_into_sudo_or_a_password_stdin_command_is_hidden() {
        for (raw, shown) in [
            ("echo pw | sudo -S mysql -pS3cret", "echo [hidden] | sudo -S mysql -p[hidden]"),
            ("echo -n hunter2 | sudo -S ls", "echo -n [hidden] | sudo -S ls"),
            ("printf '%s\\n' hunter2 | sudo --stdin ls", "printf [hidden] | sudo --stdin ls"),
            ("echo \"my pass\" | sudo -S -p '' apt update", "echo [hidden] | sudo -S -p '' apt update"),
            ("echo hunter2 | sudo -nS ls", "echo [hidden] | sudo -nS ls"),
            ("echo S3cret | docker login -u bob --password-stdin", "echo [hidden] | docker login -u bob --password-stdin"),
            ("echo S3cret | docker login --password-stdin registry.example.com", "echo [hidden] | docker login --password-stdin registry.example.com"),
            ("bash -c \"echo pw | sudo -S mysql -pS3cret\"", "bash -c \"echo [hidden] | sudo -S mysql -p[hidden]\""),
            ("cd x && echo hunter2 | sudo -S rm -rf y", "cd x && echo [hidden] | sudo -S rm -rf y"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in [
            "echo hello | sudo tee out.txt",
            "echo hello | sudo -n ls",
            "echo \"$SUDO_PW\" | sudo -S ls",
            "echo $PW | docker login --password-stdin",
            "echo hello | grep -S x",
            "echo pw | cat",
            "echo pw || sudo -S ls",
            "echo hello | docker login --username bob",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-4 item 5 (AFTER 1): the mirror of the apostrophe rule. A `"` inside single quotes opens a
    /// quote of its own only when another `"` comes before the next `'`; a lone one is text.
    #[test]
    fn safe019_a_lone_double_quote_inside_single_quotes_is_text_and_does_not_hide_the_program() {
        for (raw, shown) in [
            ("mysql -e 'a \"b; c' -pS3cret", "mysql -e 'a \"b; c' -p[hidden]"),
            ("curl 'https://x/?q=a\"b&c=1' -u admin:hunter2", "curl 'https://x/?q=a\"b&c=1' -u [hidden]"),
            ("mysql -e 'say \"hi; there\"' -pS3cret", "mysql -e 'say \"hi; there\"' -p[hidden]"),
            ("bash -c 'echo \"x\"; mysql -pS3cret'", "bash -c 'echo \"x\"; mysql -p[hidden]'"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        // A separator outside the quote still ends the command.
        assert_eq!(masked("mysql -e 'a \"b'; find . -perm 644"), "mysql -e 'a \"b'; find . -perm 644");
    }

    /// FIX-5 item 2 (stand-in review FIX-SOON 1): the echoed password is found when a launcher or a
    /// shell wraps the left side (`ssh host "echo pw | sudo -S .."`), and `sudo -S` is found behind
    /// wrappers and launchers on the right (`echo pw | ssh host sudo -S x`, `| env FOO=1 sudo -S`).
    #[test]
    fn safe019_a_password_echoed_through_a_launcher_or_into_one_is_hidden() {
        for (raw, shown) in [
            ("ssh host \"echo hunter2 | sudo -S systemctl restart x\"", "ssh host \"echo [hidden] | sudo -S systemctl restart x\""),
            ("wsl bash -c \"echo pw | sudo -S apt update\"", "wsl bash -c \"echo [hidden] | sudo -S apt update\""),
            ("docker exec c sh -c \"echo pw | sudo -S ls\"", "docker exec c sh -c \"echo [hidden] | sudo -S ls\""),
            ("ssh host 'echo \"my pass\" | sudo -S ls'", "ssh host 'echo [hidden] | sudo -S ls'"),
            ("su -c \"printf pw | sudo -S ls\"", "su -c \"printf [hidden] | sudo -S ls\""),
            ("echo pw | wsl sudo -S apt update", "echo [hidden] | wsl sudo -S apt update"),
            ("echo pw | ssh host sudo -S x", "echo [hidden] | ssh host sudo -S x"),
            ("echo pw | ssh -p 22 host sudo -nS x", "echo [hidden] | ssh -p 22 host sudo -nS x"),
            ("echo pw | docker exec -i c sudo --stdin ls", "echo [hidden] | docker exec -i c sudo --stdin ls"),
            ("echo pw | env FOO=1 sudo -S ls", "echo [hidden] | env FOO=1 sudo -S ls"),
            ("echo pw | env -u FOO sudo -S ls", "echo [hidden] | env -u FOO sudo -S ls"),
            ("echo pw | nohup sudo -S ls", "echo [hidden] | nohup sudo -S ls"),
            ("echo pw | command sudo -S ls", "echo [hidden] | command sudo -S ls"),
            ("echo pw | ssh host docker login --password-stdin", "echo [hidden] | ssh host docker login --password-stdin"),
            ("ssh host \"echo pw | sudo -S x\" && ls", "ssh host \"echo [hidden] | sudo -S x\" && ls"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in [
            "ssh host \"echo hi | grep x\"",
            "echo hi | ssh host ls",
            "echo hi | env FOO=1 ls",
            "echo hi | wsl cat",
            "ssh host \"echo \\\"$SUDO_PW\\\" | sudo -S ls\"",
            "ssh host ls | sudo -S tee out",
            "echo pw | ssh host ls -S",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-5 item 3 (stand-in review FIX-SOON 2): the word after `<<<` is hidden when the command
    /// reads a password from its input, `Write-Output` and `write` count as `echo`, and a quoted
    /// literal before the `|` is the value.
    #[test]
    fn safe019_a_here_string_or_powershell_literal_password_is_hidden() {
        for (raw, shown) in [
            ("sudo -S apt update <<< hunter2", "sudo -S apt update <<< [hidden]"),
            ("docker login -u bob --password-stdin <<< S3cret", "docker login -u bob --password-stdin <<< [hidden]"),
            ("sudo --stdin ls <<< \"my pass\"", "sudo --stdin ls <<< [hidden]"),
            ("sudo -nS ls <<<pw", "sudo -nS ls <<<[hidden]"),
            ("sudo -S ls <<< 'my pass'-x", "sudo -S ls <<< [hidden]"),
            ("ssh host sudo -S x <<< pw", "ssh host sudo -S x <<< [hidden]"),
            ("env FOO=1 sudo -S ls <<< pw && ls", "env FOO=1 sudo -S ls <<< [hidden] && ls"),
            ("\"S3cret\" | docker login -u bob --password-stdin", "[hidden] | docker login -u bob --password-stdin"),
            ("'S3cret' | sudo -S ls", "[hidden] | sudo -S ls"),
            ("cd x; \"my pass\" | sudo -S ls", "cd x; [hidden] | sudo -S ls"),
            ("Write-Output S3cret | docker login -u bob --password-stdin", "Write-Output [hidden] | docker login -u bob --password-stdin"),
            ("Write-Output \"my pass\" | docker login --password-stdin", "Write-Output [hidden] | docker login --password-stdin"),
            ("write pw | sudo -S ls", "write [hidden] | sudo -S ls"),
            ("WRITE-OUTPUT pw | sudo -S ls", "WRITE-OUTPUT [hidden] | sudo -S ls"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in [
            "cat f <<< x",
            "sudo ls <<< x",
            "sudo -S ls <<< \"$SUDO_PW\"",
            "docker login --password-stdin <<< $PW",
            "\"$env:PW\" | docker login --password-stdin",
            "\"hello\" | docker login --username bob",
            "'hello' | grep h",
            "Write-Output hi | docker login --username bob",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// FIX-5 item 4 (stand-in review AFTER 1-2): the hidden echo span ends at `;`, `&`, a line break or
    /// an unbalanced `)` (a `;` inside quotes does not end it), `|&` is a pipe, and the right side goes on
    /// past a line break that follows the `|` or a trailing backslash.
    #[test]
    fn safe019_the_hidden_echo_ends_at_the_command_and_the_pipe_may_continue_on_the_next_line() {
        for (raw, shown) in [
            ("(echo pw) | sudo -S ls", "(echo [hidden]) | sudo -S ls"),
            ("(echo start; make) | sudo -S tee log", "(echo [hidden]; make) | sudo -S tee log"),
            ("echo \"a;b\" | sudo -S ls", "echo [hidden] | sudo -S ls"),
            ("echo pw; echo x | sudo -S ls", "echo pw; echo [hidden] | sudo -S ls"),
            ("echo pw |& sudo -S ls", "echo [hidden] |& sudo -S ls"),
            ("echo pw |\nsudo -S ls", "echo [hidden] |\nsudo -S ls"),
            ("echo pw |\r\nsudo -S ls", "echo [hidden] |\r\nsudo -S ls"),
            ("echo pw | \\\nsudo -S ls", "echo [hidden] | \\\nsudo -S ls"),
            ("echo pw | sudo \\\n  -S ls", "echo [hidden] | sudo \\\n  -S ls"),
            ("echo pw | sudo -S ls |\n tee out", "echo [hidden] | sudo -S ls |\n tee out"),
        ] {
            assert_eq!(masked(raw), shown, "{raw}");
        }
        for c in ["(echo a) | cat", "echo pw |\nls", "echo pw |\n\nsudo ls", "echo pw ;\nsudo -S ls", "echo pw |\n"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }

    /// The mask of `raw`, which must not change when it is masked again (SAFE-019). Asserted in the
    /// test itself so that the failing input is named.
    fn stable(raw: &str) -> String {
        let once = mask(raw);
        let twice = mask(&once);
        assert_eq!(twice, once, "a second mask changed {raw:?}");
        once
    }

    /// FIX-6 item 2 (stand-in review FIX-SOON 1): the hidden echo stops at a `|` outside quotes, so a
    /// wrapped `echo pw | sudo -S x` that is itself piped into another reader is hidden once and a
    /// second mask changes nothing.
    #[test]
    fn safe019_a_wrapped_echo_piped_again_is_hidden_once_and_stays_that_way() {
        for (raw, shown) in [
            ("ssh host \"echo pw | sudo -S x\" | sudo -S y", "ssh host \"echo [hidden] | sudo -S x\" | sudo -S y"),
            ("bash -c \"echo pw | sudo -S x\" | sudo -S y", "bash -c \"echo [hidden] | sudo -S x\" | sudo -S y"),
            ("ssh host 'echo pw | sudo -S x' | sudo -S y", "ssh host 'echo [hidden] | sudo -S x' | sudo -S y"),
            ("echo \"a|b\" | sudo -S ls", "echo [hidden] | sudo -S ls"),
        ] {
            assert_eq!(stable(raw), shown, "{raw}");
        }
    }

    /// FIX-6 item 3 (stand-in review FIX-SOON 2): `$'..'` is one quoted value after `<<<`, the body of a
    /// here-document is hidden when the command reads a password from its input, and a quoted literal
    /// that opens a shell's or a launcher's quoted command is the value of the pipe inside it.
    #[test]
    fn safe019_ansi_c_here_strings_here_documents_and_literals_in_a_shell_command_are_hidden() {
        for (raw, shown) in [
            ("sudo -S ls <<< $'S3cret\\n'", "sudo -S ls <<< [hidden]"),
            ("docker login --password-stdin <<< $'pw word'", "docker login --password-stdin <<< [hidden]"),
            ("sudo -S ls <<< $'it\\'s'", "sudo -S ls <<< [hidden]"),
            ("sudo -S ls <<EOF\nS3cret\nEOF", "sudo -S ls <<EOF\n[hidden]\nEOF"),
            ("docker login -u bob --password-stdin <<EOF\nS3cret\nEOF\nls", "docker login -u bob --password-stdin <<EOF\n[hidden]\nEOF\nls"),
            ("sudo -S ls <<-EOF\n\tS3cret\n\tEOF", "sudo -S ls <<-EOF\n[hidden]\n\tEOF"),
            ("sudo -S ls <<'EOF'\nS3cret\nmore\nEOF", "sudo -S ls <<'EOF'\n[hidden]\nEOF"),
            ("sudo -S ls << \"END\"\nS3cret\nEND\n", "sudo -S ls << \"END\"\n[hidden]\nEND\n"),
            ("sudo -S ls <<EOF\r\nS3cret\r\nEOF\r\n", "sudo -S ls <<EOF\r\n[hidden]\r\nEOF\r\n"),
            ("sudo -S ls <<EOF\nS3cret", "sudo -S ls <<EOF\n[hidden]"),
            ("env FOO=1 sudo -S ls <<EOF\npw\nEOF", "env FOO=1 sudo -S ls <<EOF\n[hidden]\nEOF"),
            ("powershell -Command \"'S3cret' | docker login --password-stdin\"", "powershell -Command \"[hidden] | docker login --password-stdin\""),
            ("bash -c \"'pw' | sudo -S ls\"", "bash -c \"[hidden] | sudo -S ls\""),
            ("bash -c '\"pw\" | sudo -S ls'", "bash -c '[hidden] | sudo -S ls'"),
            ("ssh host \"'pw' | sudo -S ls\"", "ssh host \"[hidden] | sudo -S ls\""),
        ] {
            assert_eq!(stable(raw), shown, "{raw}");
        }
        for c in [
            "cat <<EOF\nS3cret\nEOF",
            "sudo ls <<EOF\nhello\nEOF",
            "sudo -S ls <<EOF\nEOF",
            "sudo -S ls <<EOF\n$SUDO_PW\nEOF",
            "docker login --password-stdin <<EOF\n$PW\nEOF",
            "sudo -S ls <<< $SUDO_PW",
            "powershell -Command \"'hi' | grep h\"",
            "bash -c \"'hi' | cat\"",
            "ssh host \"'hi' | grep h\"",
        ] {
            assert_eq!(stable(c), c, "{c}");
        }
    }

    /// FIX-6 item 4 (stand-in review FIX-SOON 3): PowerShell variables assigned with spaces round the `=`,
    /// the text `ConvertTo-SecureString` turns into a secure string, and single-dash parameters that
    /// sound secret.
    #[test]
    fn safe019_powershell_assignments_secure_strings_and_single_dash_secret_parameters_are_hidden() {
        for (raw, shown) in [
            ("$password = 'S3cret'; $password | docker login -u bob --password-stdin", "$password = [hidden]; $password | docker login -u bob --password-stdin"),
            ("$Token = \"abc def\"", "$Token = [hidden]"),
            ("$secret ='x'", "$secret =[hidden]"),
            ("$apiKey\t=\tabc123", "$apiKey\t=\t[hidden]"),
            ("ConvertTo-SecureString 'S3cret' -AsPlainText -Force", "ConvertTo-SecureString [hidden] -AsPlainText -Force"),
            ("ConvertTo-SecureString -String \"my pass\" -AsPlainText -Force", "ConvertTo-SecureString -String [hidden] -AsPlainText -Force"),
            ("ConvertTo-SecureString -AsPlainText -Force 'pw'", "ConvertTo-SecureString -AsPlainText -Force [hidden]"),
            ("$s = convertto-securestring S3cret -asplaintext -force; $c = New-Object PSCredential('bob', $s)", "$s = convertto-securestring [hidden] -asplaintext -force; $c = New-Object PSCredential('bob', $s)"),
            ("$s = (ConvertTo-SecureString 'pw' -AsPlainText -Force)", "$s = (ConvertTo-SecureString [hidden] -AsPlainText -Force)"),
            ("'S3cret' | ConvertTo-SecureString -AsPlainText -Force", "[hidden] | ConvertTo-SecureString -AsPlainText -Force"),
            ("Connect-Thing -Server x -Password S3cret", "Connect-Thing -Server x -Password [hidden]"),
            ("Invoke-Thing -Token 'abc 123' -Name y", "Invoke-Thing -Token [hidden] -Name y"),
            ("tool -passphrase hunter2", "tool -passphrase [hidden]"),
        ] {
            assert_eq!(stable(raw), shown, "{raw}");
        }
        for c in [
            "$path = 'C:\\x'",
            "$count = 3",
            "$password = $env:PW",
            "$password = $null",
            "$token_count = 5",
            "ConvertFrom-SecureString $s",
            "ConvertTo-SecureString $enc",
            "ConvertTo-SecureString $env:PW -AsPlainText -Force",
            "ConvertTo-SecureString 'abc' -Key $k",
            "'abc' | ConvertTo-SecureString",
            "Get-Thing -Path C:\\x -Name y",
            "Connect-Thing -Password $pw -Server x",
            "Connect-Thing -PasswordFile C:\\x -Server y",
            "gcc -pthread -O2 x.c",
        ] {
            assert_eq!(stable(c), c, "{c}");
        }
    }

    /// FIX-6 item 5 (stand-in review AFTER 1 and 3): a quoted value goes on through the text stuck to it,
    /// and a pipe that goes on through a filter still reaches the password reader.
    #[test]
    fn safe019_a_quoted_value_continues_through_adjacent_text_and_chained_pipes_reach_the_reader() {
        for (raw, shown) in [
            ("sudo -S ls <<< \"a b\"c", "sudo -S ls <<< [hidden]"),
            ("tool --password 'a b'x y", "tool --password [hidden] y"),
            ("API_TOKEN=\"abc\"def ls", "API_TOKEN=[hidden] ls"),
            ("bash -c \"tool --token 'abc'\" more", "bash -c \"tool --token [hidden]\" more"),
            ("bash -c 'tool --token \"abc\"' more", "bash -c 'tool --token [hidden]' more"),
            ("echo pw | cat | sudo -S ls", "echo [hidden] | cat | sudo -S ls"),
            ("echo pw | tee /dev/null | sudo -S ls", "echo [hidden] | tee /dev/null | sudo -S ls"),
            ("echo pw |& cat |& docker login --password-stdin", "echo [hidden] |& cat |& docker login --password-stdin"),
            ("echo pw | cat |\n sudo -S ls", "echo [hidden] | cat |\n sudo -S ls"),
        ] {
            assert_eq!(stable(raw), shown, "{raw}");
        }
        for c in ["echo pw | cat | tee out", "echo hi | cat || sudo -S ls", "echo hi | cat; sudo -S ls", "echo hi | cat\nsudo -S ls", "cat f | cat | sudo -S ls"] {
            assert_eq!(stable(c), c, "{c}");
        }
    }

    /// After-list row 641: a password piped into a reader through a redirect, a brace group, a `$(..)`
    /// beside it, a lone backtick in single quotes, a launcher whose quoted command reaches `sudo -S`
    /// after a separator, a here-document piped on, and `gh auth login --with-token` are all hidden.
    #[test]
    fn safe019_row641_pipe_reader_leaks_are_hidden() {
        for (c, want) in [
            ("echo ghp_abc | gh auth login --with-token", "echo [hidden] | gh auth login --with-token"),
            ("echo pw 2>&1 | sudo -S ls", "echo [hidden] 2>&1 | sudo -S ls"),
            ("echo pw &>/dev/null | sudo -S ls", "echo [hidden] &>/dev/null | sudo -S ls"),
            ("{ echo pw; } | sudo -S ls", "{ echo [hidden]; } | sudo -S ls"),
            ("echo $(date) pw | sudo -S ls", "echo [hidden] | sudo -S ls"),
            ("echo pw | ssh host \"ls; sudo -S x\"", "echo [hidden] | ssh host \"ls; sudo -S x\""),
            ("echo pw | ssh host \"ls && sudo -S x\"", "echo [hidden] | ssh host \"ls && sudo -S x\""),
            ("echo 'a`b' | sudo -S ls", "echo [hidden] | sudo -S ls"),
            ("cat <<EOF | sudo -S ls\nhunter2\nEOF", "cat <<EOF | sudo -S ls\n[hidden]\nEOF"),
        ] {
            assert_eq!(stable(c), want, "{c}");
        }
        // Nothing typed, a reader nowhere in reach, or a quoted separator that ends the launcher's command.
        for c in ["echo $PASS | sudo -S ls", "echo $(cat pw.txt) | sudo -S ls", "echo pw 2>&1 | grep x", "{ echo hi; } | cat", "cat <<EOF | grep x\nhello\nEOF", "echo pw | ssh host \"ls; cat\"", "echo 'a`b' | cat", "gh auth login --with-token < token.txt", "cp mysql.log /bak -pr"] {
            assert_eq!(stable(c), c, "{c}");
        }
    }

    const FUZZ_PARTS: &[&str] = &[
        " ", " ", "  ", "\n", "\t", "=", ":", ";", "|", "||", "&", "&&", ">", "2>&1", "<", "<<", "<<<", "(", ")", "{", "}", "[", "]", "'", "'", "\"", "\"", "`", "\\", "$", "$(", "${", "#", ",", "-", "--", "/", "@", "!", "*", ".", "....",
        "echo", "printf", "cat", "sudo", "-S", "ssh", "host", "bash", "-c", "pwsh", "env", "export", "set", "curl", "-u", "-H", "--header", "-d", "--data", "mysql", "-p", "-ppw", "psql", "docker", "login", "--password", "--password-stdin", "--token", "--with-token", "--api-key", "--secret", "-k", "gh", "auth",
        "password", "PASSWORD", "pass", "pw", "token", "TOKEN", "secret", "api_key", "API_KEY", "apiKey", "AWS_SECRET_ACCESS_KEY", "client_secret", "Authorization", "Bearer", "Basic", "X-Api-Key", "Cookie", "ConvertTo-SecureString", "-AsPlainText", "-Force",
        "sk_live_51HabcdEFGH1234567890WXYZ", "sk_test_", "whsec_8f3a9c1d2e4b5a6c7d8e9f0a", "sk_live_....WXYZ", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_pat_11ABCDEFG0123456789_abcdefghij", "xoxb-1234-5678-abcdefgh", "AKIAIOSFODNN7EXAMPLE", "sk-ant-api03-abcdefghijklmnop", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
        "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "https://", "http://u:p@h", "user:pa55@", "example.com", "[hidden]", "[hidden]'", "\"[hidden]\"",
        "hunter2", "s3cr3t", "x", "abc", "1234", "EOF", "a.txt", "C:\\x", "~/.ssh/id_rsa", "\u{e9}", "\u{1f511}", "{\"password\":", "\"token\": \"", "\"}", "key=", "PW=", "--password=", "-p=", "Bearer abcdefghijklmnopqrstuvwxyz012345",
        // S9 row 833 (second pass): line breaks, header-command spellings, non-ASCII that changes case or width, and the prefixes that defeated the first index.
        "\r\n", "-h", "xh", "wget", "HTTP", "\u{130}", "\u{1e9e}", "\u{212a}", "\u{2028}", "\u{85}", "\u{a0}", "curl -H x; ", "x) ", "a`b` ",
    ];

    /// The equivalence net of S9 row 833 (`mask` made linear): what `mask` answered for each input,
    /// written down from the code before the change. Labels near words, keys of every kind, Unicode,
    /// quoting, command wrappers and separators; small, so the old code ran them in no time.
    const EQUIV_CASES: &[(&str, &str)] = &[
        ("", ""),
        (" ", " "),
        ("\n", "\n"),
        ("token: ", "token: "),
        ("token: x", "token: [hidden]"),
        ("token: token: token: ", "token: token: token: "),
        ("token:x token: y", "token:x token: y"),
        ("  token: abcdef", "  token: [hidden]"),
        ("\ttoken: abcdef", "\ttoken: [hidden]"),
        ("token: abc def", "token: abc def"),
        ("my token: abc", "my token: abc"),
        ("x token: abc\ntoken: def\n  token: ghi", "x token: abc\ntoken: [hidden]\n  token: [hidden]"),
        ("\"token\": \"abc123\"", "\"token\": \"[hidden]\""),
        ("{\"token\":\"abc\",\"password\":\"x y\"}", "{\"token\":\"[hidden]\",\"password\":\"[hidden]\"}"),
        ("'token: abc'", "'token: [hidden]'"),
        ("\"token: abc\"", "\"token: [hidden]\""),
        ("say \"token: abc\" now", "say \"token: [hidden]\" now"),
        ("password=hunter2", "password=[hidden]"),
        ("password = hunter2", "password = hunter2"),
        ("$password = 'pw' ; $x = 1", "$password = [hidden] ; $x = 1"),
        ("password=hunter2&user=bob;", "password=[hidden]&user=bob;"),
        ("PASSWORD=secretvalue", "PASSWORD=[hidden]"),
        ("api_key=abcdef0123456789 and API_KEY=zzz", "api_key=[hidden] and API_KEY=[hidden]"),
        ("export API_KEY=abcdef0123456789\nHOME=/home/me\nSECRET_TOKEN=\"quoted value\"", "export API_KEY=[hidden]\nHOME=[hidden]\nSECRET_TOKEN=[hidden]"),
        ("NAME=value\nTOKEN=x", "NAME=[hidden]\nTOKEN=[hidden]"),
        ("Authorization: Bearer abcDEF123456", "Authorization: Bearer [hidden]"),
        ("authorization: basic dXNlcjpwYXNz", "authorization: basic [hidden]"),
        ("Proxy-Authorization: Basic dXNlcjpwYXNz", "Proxy-Authorization: Basic [hidden]"),
        ("curl -H 'Authorization: Bearer abcDEF123456' https://x.test", "curl -H 'Authorization: Bearer [hidden]' https://x.test"),
        ("curl -H \"token: abc\" https://x.test", "curl -H \"token: [hidden]\" https://x.test"),
        ("curl -H token: abc https://x.test", "curl -H token: [hidden]"),
        ("curl -H x token: abc token: def", "curl -H x token: [hidden]"),
        ("curl --header token:abc https://x.test", "curl --header token:[hidden]"),
        ("curl -H x; token: abc", "curl -H x; token: abc"),
        ("curl -H x\ntoken: abc", "curl -H x\ntoken: [hidden]"),
        ("wget --header=\"token: abc\" https://x.test", "wget --header=\"token: [hidden]\" https://x.test"),
        ("http -H token:abc", "http -H token:[hidden]"),
        ("echo -H token: abc", "echo -H token: abc"),
        ("ls -h token: abc", "ls -h token: abc"),
        ("/usr/bin/curl -H token: abc", "/usr/bin/curl -H token: [hidden]"),
        ("C:\\tools\\curl.exe -H token: abc", "C:\\tools\\curl.exe -H token: [hidden]"),
        ("/var/curl -H token: abc", "/var/curl -H token: [hidden]"),
        ("sudo -u root curl -H token: abc", "sudo -u root curl -H token: [hidden]"),
        ("ssh host curl -H token: abc", "ssh host curl -H token: [hidden]"),
        ("bash -c \"curl -H token: abc\"", "bash -c \"curl -H token: [hidden]\""),
        ("bash -c \"cd x; curl -H token: abc\"", "bash -c \"cd x; curl -H token: [hidden]\""),
        ("bash -c 'curl -H token: abc'", "bash -c 'curl -H token: [hidden]'"),
        ("$(which curl) -H token: abc", "$(which curl) -H token: [hidden]"),
        ("`which curl` -H token: abc", "`which curl` -H token: [hidden]"),
        ("x $(curl -H a) token: abc", "x $(curl -H a) token: [hidden]"),
        ("(curl -H a) token: abc", "(curl -H a) token: [hidden]"),
        ("echo 'it''s' \"it's token: abc\"", "echo 'it''s' \"it's token: abc\""),
        ("\"it's token: abc", "\"it's token: abc"),
        ("\"it's token: abc'", "\"it's token: abc'"),
        ("'say \"hi; there\"' token: abc", "'say \"hi; there\"' token: abc"),
        ("\"a 'b; c' d\" curl -H token: abc", "\"a 'b; c' d\" curl -H token: [hidden]"),
        ("\\\"curl -H token: abc\\\"", "\\\"curl -H token: [hidden]\\\""),
        ("curl -H \"Accept: x\" -H token: abc -H \"Cookie: a=b\"", "curl -H \"Accept: x\" -H token: [hidden] \"Cookie: [hidden]\""),
        ("Cookie: a=b; c=d", "Cookie: [hidden]"),
        ("Set-Cookie: sid=abc; Path=/", "Set-Cookie: [hidden]"),
        ("X-Api-Key: abcdef", "X-Api-Key: [hidden]"),
        ("X-Auth-Token:  abcdef ghi", "X-Auth-Token:  [hidden]"),
        ("apikey: abcdef", "apikey: [hidden]"),
        ("Bearer abcdefghijkl", "Bearer abcdefghijkl"),
        ("Bearer abcdEFGHIJKL", "Bearer abcdEFGHIJKL"),
        ("bearer abcdEFGH1234 and basic words here", "bearer [hidden] and basic words here"),
        ("basic authentication is basic", "basic authentication is basic"),
        ("Authorization header Bearer abcdEFGHijkl", "Authorization header Bearer [hidden]"),
        ("mysql -u root -pSecret123 db", "mysql -u root -p[hidden] db"),
        ("mysql -u root -p'my pass' db", "mysql -u root -p[hidden] db"),
        ("mysql --password=abc db", "mysql --password=[hidden] db"),
        ("mariadb -pXYZ", "mariadb -p[hidden]"),
        ("psql postgres://user:pw@host/db", "psql postgres://[hidden]@host/db"),
        ("https://user:pass@example.com/path", "https://[hidden]@example.com/path"),
        ("http://u:p@h http://u:p@h", "http://[hidden]@h http://[hidden]@h"),
        ("curl -u user:pass https://x.test", "curl -u [hidden] https://x.test"),
        ("curl --user user:pass https://x.test", "curl --user [hidden] https://x.test"),
        ("sshpass -p hunter2 ssh host", "sshpass -p [hidden] ssh host"),
        ("docker login -u me -p hunter2", "docker login -u me -p hunter2"),
        ("docker login --password-stdin", "docker login --password-stdin"),
        ("echo hunter2 | docker login -u me --password-stdin", "echo [hidden] | docker login -u me --password-stdin"),
        ("printf '%s' hunter2 | sudo -S ls", "printf [hidden] | sudo -S ls"),
        ("echo secret | sudo -S ls", "echo [hidden] | sudo -S ls"),
        ("cat <<EOF | sudo -S ls\nhunter2\nEOF", "cat <<EOF | sudo -S ls\n[hidden]\nEOF"),
        ("7z a -pSecret out.7z in", "7z a -p[hidden] out.7z in"),
        ("gcc -pthread x.c", "gcc -pthread x.c"),
        ("find . -print", "find . -print"),
        ("--token abc123", "--token [hidden]"),
        ("--token=abc123", "--token=[hidden]"),
        ("--token abc --max-tokens 100", "--token [hidden] --max-tokens 100"),
        ("--password abc --password-stdin", "--password [hidden] --password-stdin"),
        ("-p secret", "-p secret"),
        ("ConvertTo-SecureString 'pw' -AsPlainText -Force", "ConvertTo-SecureString [hidden] -AsPlainText -Force"),
        ("ConvertTo-SecureString -String pw -AsPlainText", "ConvertTo-SecureString -String [hidden] -AsPlainText"),
        ("sk_live_51HabcdEFGH1234567890WXYZ", "sk_live_....WXYZ"),
        ("curl -u sk_live_51HabcdEFGH1234567890WXYZ: https://api.stripe.com", "curl -u sk_live_....WXYZ: https://api.stripe.com"),
        ("sk_test_4eC39HqLyjWDarjtT1zdp7dc", "sk_test_....p7dc"),
        ("whsec_8f3a9c1d2e4b5a6c7d8e9f0a", "whsec_....9f0a"),
        ("ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[hidden]"),
        ("github_pat_11ABCDEFG0123456789_abcdefghij", "[hidden]"),
        ("xoxb-1234-5678-abcdefgh", "[hidden]"),
        ("AKIAIOSFODNN7EXAMPLE", "[hidden]"),
        ("sk-abcdefghijklmnopqrstuvwxyz", "[hidden]"),
        ("sk-sk-sk-sk-", "sk-sk-sk-sk-"),
        ("-----BEGIN PRIVATE KEY-----\nQUJDREVG\n-----END PRIVATE KEY-----", "[hidden]"),
        ("-----BEGIN RSA PRIVATE KEY-----\nQUJD", "[hidden]"),
        ("a -----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY----- b", "a [hidden] b"),
        ("[hidden]sk-aaaaaaaaaaaaaaaaaaaaaa", "[hidden][hidden]"),
        ("[hidden] token: [hidden]", "[hidden] token: [hidden]"),
        ("token: [hidden]", "token: [hidden]"),
        ("password=[hidden]", "password=[hidden]"),
        ("k=é中🔑 token: é中", "k=é中🔑 token: é中"),
        ("😀token: abc😀", "😀token: abc😀"),
        ("\u{202e}password=\u{301}x", "\u{202e}password=[hidden]"),
        ("café password=résumé done", "café password=[hidden] done"),
        ("ordinary command: ls -la /tmp && echo done", "ordinary command: ls -la /tmp && echo done"),
        ("plain prose with no secrets at all, just words.", "plain prose with no secrets at all, just words."),
        ("tokenizer: fast, tokens: 5, token_count: 7", "tokenizer: fast, tokens: 5, token_count: 7"),
        ("the token: is a word in prose", "the token: is a word in prose"),
        ("# comment\ntoken: abc\n# more", "# comment\ntoken: [hidden]\n# more"),
        ("line1\r\ntoken: abc\r\nline3\r\n", "line1\r\ntoken: [hidden]\r\nline3\r\n"),
        ("token:\tabc", "token:\t[hidden]"),
        ("TOKEN: ABC\nSecret: xyz\nPassword: p", "TOKEN: [hidden]\nSecret: [hidden]\nPassword: [hidden]"),
        ("secret: s\nsecret: t", "secret: [hidden]\nsecret: [hidden]"),
        ("client_secret: abc", "client_secret: [hidden]"),
        ("Authorization:Bearer abcDEF123456", "Authorization:Bearer [hidden]"),
        ("x-token: a", "x-token: [hidden]"),
        ("-H 'x-token: a' curl", "-H 'x-token: [hidden]' curl"),
        ("\"x\" token: a", "\"x\" token: a"),
        ("'x' token: a", "'x' token: a"),
        ("x=\"token: a\"", "x=\"token: [hidden]\""),
        ("a;b|c&d(e) token: f", "a;b|c&d(e) token: f"),
        ("a && b || c ; token: d", "a && b || c ; token: d"),
        ("echo a > f; curl -H a; token: b", "echo a > f; curl -H a; token: b"),
        ("curl -H a | grep x\ntoken: b", "curl -H a | grep x\ntoken: [hidden]"),
        ("2>&1 curl -H a token: b", "2>&1 curl -H a token: [hidden]"),
        ("curl -H a &> out token: b", "curl -H a &> out token: [hidden]"),
        ("{ curl -H a; } token: b", "{ curl -H a; } token: b"),
        ("echo $(echo `curl -H a` token: b)", "echo $(echo `curl -H a` token: [hidden]"),
        ("curl -H a \\ntoken: b", "curl -H a \\ntoken: [hidden]"),
        ("http -H x https -H y xh -H z token: a", "http -H x https -H y xh -H z token: [hidden]"),
        ("CURL -h TOKEN: a", "CURL -h TOKEN: [hidden]"),
        ("Curl.EXE -H Token: a", "Curl.EXE -H Token: [hidden]"),
        ("curl. -H token: a", "curl. -H token: a"),
        ("curl.exe -H token: a", "curl.exe -H token: [hidden]"),
        ("sudo curl -H token: a", "sudo curl -H token: [hidden]"),
        ("timeout 5 curl -H token: a", "timeout 5 curl -H token: [hidden]"),
        ("env A=b curl -H token: a", "env A=b curl -H token: [hidden]"),
        ("xargs -n 1 curl -H token: a", "xargs -n 1 curl -H token: [hidden]"),
        ("cmd /c curl -H token: a", "cmd /c curl -H token: [hidden]"),
        ("docker run curl -H token: a", "docker run curl -H token: [hidden]"),
        ("grep curl -H token: a notes.txt", "grep curl -H token: [hidden]"),
        ("find /var/lib/curl -H token: a", "find /var/lib/curl -H token: a"),
        ("\"C:\\Program Files\\curl\\curl.exe\" -H token: a", "\"C:\\Program Files\\curl\\curl.exe\" -H token: [hidden]"),
        ("'/opt/my tools/curl' -H token: a", "'/opt/my tools/curl' -H token: [hidden]"),
    ];
    /// FNV-1a over `mask`'s answers to generated inputs of the idempotence fuzz's fragments.
    fn equiv_digest(seed: u64, count: usize, max_parts: u64) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let mut seed = seed;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..count {
            let len = 1 + (next() % max_parts) as usize;
            let input: String = (0..len).map(|_| FUZZ_PARTS[(next() % FUZZ_PARTS.len() as u64) as usize]).collect();
            for b in mask(&input).bytes().chain([0xff]) {
                h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        h
    }

    #[test]
    fn mask_answers_the_written_down_cases_exactly() {
        for (input, want) in EQUIV_CASES {
            assert_eq!(mask(input), *want, "mask changed its answer for {input:?}");
        }
    }

    #[test]
    fn mask_answers_generated_inputs_exactly_as_before() {
        assert_eq!(equiv_digest(0xD1B5_4A32_D192_ED03, 12_000, 40), DIGEST_SHORT, "mask changed an answer on short generated input");
        assert_eq!(equiv_digest(0x2545_F491_4F6C_DD1D, 1_500, 160), DIGEST_LONG, "mask changed an answer on long generated input");
    }

    // Recorded from the code at 48ddb392 (before the index), never from the current mask; re-record the same way when FUZZ_PARTS changes.
    const DIGEST_SHORT: u64 = 0x3709_ac69_e168_3aa3;
    const DIGEST_LONG: u64 = 0xeb15_9d00_eb67_bc25;

    /// Reference for `HeaderContext::holds`: the straight reading of "what is before `i`", which the
    /// index answers without re-reading it per offset.
    fn header_context_reference(t: &str, i: usize) -> bool {
        let line = t[..i].rfind('\n').map_or(0, |p| p + 1);
        let head = t[line..i].to_ascii_lowercase();
        head.contains("authorization") || head.contains("--header") || {
            let words = words_before(t, i);
            words.iter().any(|w| w.name == "-h") && runs(&words, |w| matches!(w, "curl" | "wget" | "http" | "https" | "xh"))
        }
    }

    #[test]
    fn header_context_index_agrees_with_the_straight_reading_at_every_offset() {
        let mut seed: u64 = 0x1234_5678_9ABC_DEF1;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let (mut asked, mut yes) = (0, 0);
        for _ in 0..1_500 {
            let len = 1 + (next() % 60) as usize;
            let input: String = (0..len).map(|_| FUZZ_PARTS[(next() % FUZZ_PARTS.len() as u64) as usize]).collect();
            let context = HeaderContext::new(&input);
            for i in (0..=input.len()).filter(|i| input.is_char_boundary(*i)) {
                let want = header_context_reference(&input, i);
                assert_eq!(context.holds(i), want, "offset {i} of {input:?}");
                asked += 1;
                yes += usize::from(want);
            }
            // Offsets out of order must not trust the last command start.
            for i in (0..=input.len()).rev().filter(|i| input.is_char_boundary(*i)).step_by(3) {
                assert_eq!(context.holds(i), header_context_reference(&input, i), "offset {i} (backwards) of {input:?}");
            }
        }
        assert!(yes > 500 && yes < asked, "the generated input must hold both answers ({yes} of {asked})");
    }

    /// S9 row 833: hostile pieces for the time bar. One piece repeats a fragment the passes look for.
    fn hostile_pieces(total: usize) -> Vec<(&'static str, String)> {
        vec![
            ("plain", "lorem ipsum dolor sit amet ".repeat(total / 27)),
            ("bearer_run", "Bearer ".repeat(total / 7) + &"A1".repeat(10)),
            ("sk_run", "sk-".repeat(total / 3)),
            ("sk_one_long_token", format!("sk-{}", "a".repeat(total))),
            ("password_eq", "password=".repeat(total / 9)),
            ("pem_open_no_end", format!("-----BEGIN PRIVATE KEY-----\n{}", "QUJD".repeat(total / 4))),
            ("pem_many_begin", "-----BEGIN PRIVATE KEY-----\n".repeat(total / 28)),
            ("url_scheme_run", "http://a:b@".repeat(total / 11)),
            ("at_signs", "://".to_string() + &"@".repeat(total)),
            ("hidden_glue", "[hidden]sk-aaaaaaaaaaaaaaaaaaaaaa".repeat(total / 32)),
            ("env_lines", "API_KEY=abcdef0123456789\n".repeat(total / 25)),
            ("json_keys", "\"password\":\"x\",".repeat(total / 15)),
            ("one_line_no_space", "x".repeat(total)),
            ("quotes", "\"'".repeat(total / 2)),
            ("unicode", "\u{1F600}\u{e9}\u{4e2d}\u{202e}\u{0301}".repeat(total / 14)),
            ("newlines", "\n".repeat(total)),
            ("flags", "--token ".repeat(total / 8)),
            ("labels", "token: ".repeat(total / 7)),
            ("labels_after_curl_h", "curl -H x ".to_string() + &"token: ".repeat(total / 7)),
        ]
    }

    /// Debug builds run 30 times slower than release, so the bar scales: 1 s per MiB in release, 2 s
    /// for 64 KB in debug. The quadratic code took 12 s at 32 KB of labels.
    #[test]
    fn mask_time_stays_linear_on_hostile_pieces() {
        let (total, bar_ms) = if cfg!(debug_assertions) { (64 << 10, 2000.0) } else { (1 << 20, 1000.0) };
        let mut slow = Vec::new();
        for (label, text) in hostile_pieces(total) {
            let t0 = std::time::Instant::now();
            let _ = mask(&text);
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            println!("TIME mask {label} bytes={} ms={ms:.0}", text.len());
            if ms > bar_ms {
                slow.push(format!("{label}: {ms:.0} ms for {} bytes", text.len()));
            }
        }
        // Load flake fix: the bars are the optimized build's promise; a debug run only has to finish.
        assert!(cfg!(debug_assertions) || slow.is_empty(), "over {bar_ms} ms: {slow:#?}");
    }

    #[test]
    fn mask_of_32_kb_of_labels_takes_under_a_second() {
        let text = "token: ".repeat(32 * 1024 / 7);
        let t0 = std::time::Instant::now();
        let _ = mask(&text);
        let ms = t0.elapsed().as_millis();
        // Load flake fix: the 1 s bound is the optimized build's promise; a debug run only has to finish.
        assert!(cfg!(debug_assertions) || ms < 1000, "mask of a 32 KB run of {:?} took {ms} ms", "token: ");
    }

    /// S9 row 833 residual: a `)` or backtick, or `curl -H x;`, earlier on the line sent every later
    /// label back to a full rescan (5 s at 32 KB in release).
    #[test]
    fn mask_of_32_kb_of_labels_after_a_closer_or_separator_takes_under_a_second() {
        for prefix in ["curl -H x; ", "x) ", "`", "a`b` "] {
            let text = format!("{prefix}{}", "token: ".repeat(32 * 1024 / 7));
            let t0 = std::time::Instant::now();
            let _ = mask(&text);
            let ms = t0.elapsed().as_millis();
            println!("TIME mask prefix={prefix:?} bytes={} ms={ms}", text.len());
            // Load flake fix: the 1 s bound is the optimized build's promise; a debug run only has to finish.
            assert!(cfg!(debug_assertions) || ms < 1000, "mask of a 32 KB run of labels after {prefix:?} took {ms} ms");
        }
    }

    /// fix-hooks AFTER (masking fuzz, kolux-after.md): on any input, garbage included, a second
    /// mask over mask's own answer changes nothing. The inputs are generated from shell, header,
    /// key and quoting fragments by a fixed-seed xorshift, so a failure names its input and repeats.
    #[test]
    fn safe019_mask_is_idempotent_on_generated_input() {
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut broken = Vec::new();
        for _ in 0..20_000 {
            let len = 1 + (next() % 24) as usize;
            let input: String = (0..len).map(|_| FUZZ_PARTS[(next() % FUZZ_PARTS.len() as u64) as usize]).collect();
            let once = mask(&input);
            let twice = mask(&once);
            if twice != once {
                broken.push((input, once, twice));
            }
        }
        for (input, once, twice) in broken.iter().take(5) {
            println!("input {input:?}\n once {once:?}\ntwice {twice:?}");
        }
        assert!(broken.is_empty(), "{} of 20000 generated inputs changed on a second mask", broken.len());
    }


    /// T-604b (a), review of PR #15: a recursive delete under the temp folder runs only when no link
    /// on the way leads out of it; a link is resolved, and one that leads elsewhere (or cannot be
    /// resolved) asks. A real folder, or a link to another temp folder, still runs.
    #[cfg(unix)]
    #[test]
    fn t604b_a_delete_through_a_link_in_the_temp_folder_is_judged_where_the_link_leads() {
        let root = std::env::temp_dir().join(format!("krs-t604b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("real/sub")).unwrap();
        std::os::unix::fs::symlink("/etc", root.join("out")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("inner")).unwrap();
        std::os::unix::fs::symlink(root.join("nowhere"), root.join("dangling")).unwrap();
        let r = root.display().to_string();
        let b = Base { workspace: Some("/home/me/app".into()), cwd: Some("/home/me/app".into()), home: Some("/home/me".into()), temp: vec![r.clone()] };
        let h = |c: &str| check(c, &b, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in [format!("rm -rf {r}/out"), format!("rm -rf {r}/out/"), format!("rm -rf {r}/out/sub"), format!("rm -rf {r}/out/*"), format!("Remove-Item -Recurse -Force {r}/out"), format!("cd {r} && rm -rf out"), format!("rm -rf {r}/dangling/x")] {
            if h(&c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", h(&c)));
            }
        }
        for c in [format!("rm -rf {r}/real"), format!("rm -rf {r}/real/sub"), format!("rm -rf {r}/inner/sub"), format!("rm -rf {r}/not-made-yet"), format!("cd {r} && rm -rf real")] {
            if h(&c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", h(&c)));
            }
        }
        let _ = std::fs::remove_dir_all(&root);
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b (b), review of PR #15 round 8: nested folder wrappers are joined as the shell runs them
    /// (`env -C .. env -C x` is `../x`); one wrapper given two folders makes the folder unknown.
    #[test]
    fn t604b_nested_folder_wrappers_are_joined_in_order() {
        let mut missed: Vec<String> = Vec::new();
        for c in ["env -C .. env -C sub rm -rf x", "sudo -D .. env -C other rm -rf build", "env -C .. -C app rm -rf build", "env -C /home env -C me rm -rf app"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["env -C build env -C .. rm -rf out", "env -C .. env -C app rm -rf build", "env -C src env -C web rm -rf dist", "env -C /tmp env -C x rm -rf y"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b (c), review of PR #15: `find ... -delete`, `rimraf`, `[IO.Directory]::Delete(path, $true)`
    /// and `robocopy /MIR` are recursive deletes of their targets, judged by the same rule as rm -rf.
    #[test]
    fn t604b_find_delete_rimraf_directory_delete_and_robocopy_mir_are_recursive_deletes() {
        let win = Base { workspace: Some("C:\\Users\\me\\app".into()), cwd: Some("C:\\Users\\me\\app".into()), home: Some("C:\\Users\\me".into()), temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()] };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in [
            "find .. -name x -delete",
            "find / -delete",
            "find ~ -type f -delete",
            "find -L /etc -name '*.conf' -delete",
            "find $DIR -delete",
            "find .git -delete",
            "find . .. -name x -delete",
            "rimraf ../other",
            "npx rimraf /",
            "pnpm exec rimraf ~/code",
            "rimraf --glob '../**'",
            "[IO.Directory]::Delete('/home/me/other', $true)",
            "[System.IO.Directory]::Delete(\"..\", $true)",
            "pwsh -c \"[System.IO.Directory]::Delete('../x', $true)\"",
            "[io.directory]::delete( '/etc' , 1 )",
            "robocopy empty ../other /MIR",
            "robocopy.exe empty /home/me /mir /njh",
            "robocopy empty .. /PURGE",
        ] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["[IO.Directory]::Delete('C:\\Users\\me\\other', $true)", "robocopy empty C:\\Users\\me\\other /MIR", "find C:\\Users -delete"] {
            if w(c) != Some("delete") {
                missed.push(format!("should ask on Windows (delete): {c:?}, got {:?}", w(c)));
            }
        }
        for c in [
            "find . -name '*.pyc' -delete",
            "find . -name .DS_Store -delete",
            "find . -name '*soft-delete*'",
            "find . -name x; git push origin --delete feat",
            "find . -name '*soft-delete*' && git push origin --delete feat && rm -rf build",
            "cd .. && find app -delete",
            "find build -name '*.o' -delete",
            "find .. -name x -print",
            "find /tmp/cache -delete",
            "rimraf dist",
            "npx rimraf dist build/out",
            "[IO.Directory]::Delete('dist', $true)",
            "[IO.Directory]::Delete('/home/me/other')",
            "[IO.Directory]::Delete('/home/me/other', $false)",
            "robocopy src dist /MIR",
            "robocopy ../a ../b",
            "echo find / -delete",
        ] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        if w("robocopy src C:\\Users\\me\\app\\dist /MIR").is_some() {
            missed.push("should run on Windows: robocopy src C:\\Users\\me\\app\\dist /MIR".into());
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b (lane2 review): find deletes only with its own `-delete` word, and judges its start
    /// points by containment: inside the workspace (its root included) runs, outside asks.
    #[test]
    fn t604b_find_is_judged_by_its_own_delete_word_and_where_it_starts() {
        let mut missed: Vec<String> = Vec::new();
        for c in ["find .. -delete", "find / -name x -delete", "find ~ -delete", "find -L . -name '*.log' -delete", "find . -follow -name x -delete", "find -L build -delete"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["find . -name '*.pyc' -delete", "find . -name .DS_Store -delete", "find . -name '*soft-delete*'", "find . -name x && git push origin --delete feat", "find .. -name '*soft-delete*'", "find .. -print; git push origin --delete feat"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b (e): an escaped `\(` group is find's own expression, not a new command, so the
    /// `-delete` after it is read with find's start points; a start point outside still asks.
    #[test]
    fn t604b_e_find_delete_after_an_escaped_group_is_judged_by_its_start_points() {
        let mut missed: Vec<String> = Vec::new();
        for c in [
            r"find .. \( -name x -o -name y \) -delete",
            r"find ~ \( -name '*.log' \) -delete",
            r"cd .. && find . \( -name x \) -delete",
            r"find / \( -name x \) -delete",
        ] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in [
            r"find . \( -name '*.pyc' -o -name '*.log' \) -delete",
            r"find build \( -name x \) -delete",
            r"find . -name x \( -delete \)",
            r"echo find .. \( -name x \) -delete",
        ] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b (e): find follows a link named as a start point, so one inside the workspace that
    /// leads out of it asks, while one that stays inside still runs. A symlink on Unix; a junction
    /// on Windows, where making a symlink needs a privilege the build machine may not have.
    fn start_point_link_is_judged_where_it_leads(link: &dyn Fn(&std::path::Path, &std::path::Path)) {
        let root = std::env::temp_dir().join(format!("krs-t604b-e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let app = root.join("app");
        let other = root.join("other");
        std::fs::create_dir_all(app.join("sub")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        link(&other, &app.join("out"));
        link(&app.join("sub"), &app.join("inner"));
        let b = Base { workspace: Some(app.display().to_string()), cwd: Some(app.display().to_string()), home: Some(root.join("home").display().to_string()), temp: vec![root.join("tmp").display().to_string()] };
        let h = |c: &str| check(c, &b, &json!({})).map(|r| r.id);
        let mut missed: Vec<String> = Vec::new();
        for c in ["find out -delete", "find out/ -delete", "find out -name x -delete", "find out inner/../out -delete"] {
            if h(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", h(c)));
            }
        }
        for c in ["find . -delete", "find inner -delete", "find sub -name x -delete", "find ./out -print"] {
            if h(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", h(c)));
            }
        }
        let _ = std::fs::remove_dir_all(&root);
        assert!(missed.is_empty(), "{missed:#?}");
    }

    #[cfg(unix)]
    #[test]
    fn t604b_e_a_find_start_point_that_is_a_link_is_judged_where_it_leads() {
        start_point_link_is_judged_where_it_leads(&|target, at| std::os::unix::fs::symlink(target, at).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn t604b_e_a_find_start_point_that_is_a_junction_is_judged_where_it_leads() {
        start_point_link_is_judged_where_it_leads(&|target, at| {
            let made = std::process::Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:KOLUX_J_AT -Target $env:KOLUX_J_TARGET | Out-Null"]).env("KOLUX_J_AT", at).env("KOLUX_J_TARGET", target).status().is_ok_and(|s| s.success());
            assert!(made, "could not make a junction at {}", at.display());
        });
    }

    /// T-604b (d), review of PR #15 round 8: how PowerShell's wildcards treat `..` is unproven, so a
    /// PowerShell delete (Remove-Item, ri) with any wildcard in a target asks; bash and cmd wildcards
    /// are judged as before.
    #[test]
    fn t604b_a_powershell_delete_with_a_wildcard_asks() {
        let mut missed: Vec<String> = Vec::new();
        for c in ["Remove-Item -Recurse -Force build/*", "Remove-Item -Recurse -Force *.log", "ri -r -fo build\\.?", "Remove-Item -Path 'out/[ab]*' -Recurse", "cd build; Remove-Item -Recurse -Force .*"] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["rm -rf build/*", "del /s /q dist\\*.o", "Remove-Item -Recurse -Force build", "Remove-Item -Recurse -Force .\\build\\out"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// A folder link for the link tests: a symlink on Unix, a junction on Windows (no admin needed).
    fn link_dir(target: &std::path::Path, link: &std::path::Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let out = std::process::Command::new("cmd").arg("/C").arg("mklink").arg("/J").arg(link).arg(target).output().unwrap();
            assert!(out.status.success(), "mklink /J failed: {}", String::from_utf8_lossy(&out.stderr));
        }
    }

    /// T-604b follow-up (cycle 3, data loss): a delete whose start point is a link asks, and a delete that
    /// goes through a link is judged where the link leads. A link that stays inside the workspace runs; one
    /// that leads out of it, or nowhere, asks. A junction is a link on Windows too.
    #[test]
    fn t604c_a_delete_at_or_through_a_link_is_judged_by_where_the_link_leads() {
        let root = std::env::temp_dir().join(format!("krs-t604c-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("krs-t604c-out-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(root.join("real/sub")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        link_dir(&outside, &root.join("out"));
        link_dir(&root.join("real"), &root.join("inner"));
        link_dir(&root.join("nowhere"), &root.join("dangling"));
        let r = root.display().to_string();
        let sep = std::path::MAIN_SEPARATOR;
        // Every path is joined the platform's way: on Windows a mixed `\\` and `/` word is read two ways.
        let p = |name: &str| format!("{r}{sep}{}", name.replace('/', &sep.to_string()));
        let b = Base { workspace: Some(r.clone()), cwd: Some(r.clone()), home: Some("/home/me".into()), temp: vec![] };
        let mut missed: Vec<String> = Vec::new();
        for c in [
            format!("rm -rf {}", p("out")),
            format!("rm -rf {}{sep}", p("out")),
            format!("rm -rf {}", p("out/sub")),
            format!("rm -rf {}{sep}*", p("out")),
            format!("find {} -delete", p("out")),
            format!("find {} -name x -delete", p("out")),
            format!("Remove-Item -Recurse -Force {}", p("out")),
            format!("cd {} && rm -rf sub", p("out")),
            format!("rm -rf {}", p("dangling")),
            format!("rm -rf {}{sep}x", p("dangling")),
        ] {
            if check(&c, &b, &json!({})).map(|x| x.id) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", check(&c, &b, &json!({})).map(|x| x.id)));
            }
        }
        for c in [
            format!("rm -rf {}", p("real")),
            format!("rm -rf {}", p("real/sub")),
            format!("rm -rf {}", p("inner/sub")),
            format!("rm -rf {}", p("made-up")),
            format!("find {} -name x -delete", p("real")),
            format!("find {} -delete", p("inner/sub")),
        ] {
            if check(&c, &b, &json!({})).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", check(&c, &b, &json!({})).map(|x| x.id)));
            }
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        assert!(missed.is_empty(), "{missed:#?}");
    }

    /// T-604b follow-up (cycle 3, data loss): a `-delete` after an escaped group (`\\( ... \\)`) is still
    /// find's own word. The reading splits at the parenthesis, so the expression parts after it are put back
    /// before find is judged: a start point outside asks, one inside the workspace runs.
    #[test]
    fn t604c_a_delete_after_an_escaped_group_is_judged_as_find_delete() {
        let mut missed: Vec<String> = Vec::new();
        for c in [
            "find .. \\( -name x -delete \\)",
            "find .. \\( \\( -name x -delete \\) \\)",
            "find .. -name x \\( -delete \\)",
            "find ~ \\( -name x -delete \\)",
            "find ../other \\( -name x -delete \\)",
            "cd .. && find other \\( -name x -delete \\)",
        ] {
            if hit(c) != Some("delete") {
                missed.push(format!("should ask (delete): {c:?}, got {:?}", hit(c)));
            }
        }
        for c in ["find . \\( -name x -delete \\)", "find . -name x \\( -delete \\)", "find build \\( -name '*.o' -delete \\)", "find . -name x \\( -print \\)"] {
            if hit(c).is_some() {
                missed.push(format!("should run: {c:?}, got {:?}", hit(c)));
            }
        }
        assert!(missed.is_empty(), "{missed:#?}");
    }
}
