//! T-121 (STAT-016): Hermes status hooks, from Nous Research's public Event Hooks docs
//! (PROVENANCE.md, T-121): shell hooks are declared under a top-level `hooks:` key of the profile's
//! `config.yaml` (`~/.hermes`), keyed by event, each entry a `command` (split shell-style, no shell)
//! with a `timeout` in seconds; the payload on stdin carries `hook_event_name`, `session_id`,
//! `tool_name`, `tool_input` and `extra`. Hermes asks once per (event, command) before a hook first
//! runs and keeps the answer in `shell-hooks-allowlist.json` (`approvals`: `event` + exact `command`).
//!
//! Txais's call (2026-10-20, "Hermes consent = let Hermes ask"): Kolux never writes that allowlist.
//! Hermes shows its own first-use prompt and the user answers it; Kolux only reads the file to say
//! on the status row that the prompt is still to come. Removal never touches it either: an older
//! Kolux run kept no record of which pairs it wrote, and a pair for Kolux's command may since have
//! been approved by the user, so every entry in it is treated as the user's.
//!
//! Coordinator default (2026-10-20, Txais may overrule): the card's "switched-on plugin" route is
//! replaced by these documented shell hooks, since the plugin enable list's format is not documented.
//!
//! Kolux never rewrites the user's YAML: its entries go in as blocks between marker comment lines,
//! each begin line carrying a checksum of the block's lines. Taking the blocks out gives the file
//! back byte for byte; a block whose lines no longer match its checksum (edited by hand) is refused,
//! never overwritten or taken out.

use super::super::super::{script, write_atomic, write_script as write_named, SCRIPT_DIR};
use super::super::{backup_of, read_opt, target_dir, was_created, BACKUP_RECORD};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const SCRIPT: &str = "hermes.cmd";
/// STAT-016: the Hermes hook points the card's compat list names, by their documented names.
pub const EVENTS: [&str; 13] = [
    "on_session_start",
    "pre_llm_call",
    "post_llm_call",
    "pre_tool_call",
    "post_tool_call",
    "pre_approval_request",
    "post_approval_response",
    "on_human_input_request",
    "on_human_input_resolved",
    "on_session_end",
    "on_session_finalize",
    "on_session_reset",
    "agent_loop_stopped",
];
/// Seconds (Hermes's unit; its default is 60).
const TIMEOUT: u64 = 10;
const BEGIN: &str = "# >>> kolux-rs status hooks (";
const END: &str = "# <<< kolux-rs status hooks <<<";
/// The status row's hint while Hermes has not approved Kolux's hooks.
pub const CONSENT: &str = "Hermes has not approved Kolux's hooks yet; it asks once per hook on first use (or start it with --accept-hooks)";

/// Hermes's home: `HERMES_HOME` for the real home only (a scratch home keeps it inside).
pub fn home_of(home: &Path) -> PathBuf {
    (home == super::super::super::home_dir()).then(|| std::env::var_os("HERMES_HOME")).flatten().filter(|h| !h.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".hermes"))
}

pub fn file(home: &Path) -> PathBuf {
    home_of(home).join("config.yaml")
}

pub fn allow_file(home: &Path) -> PathBuf {
    home_of(home).join("shell-hooks-allowlist.json")
}

pub fn write_script(home: &Path) -> Result<String, String> {
    // A shell hook's stdout is read as a decision, so the script prints nothing.
    write_named(home, SCRIPT, &script("hermes", "hermes", false))
}

fn script_path(home: &Path) -> String {
    home.join(SCRIPT_DIR).join(SCRIPT).to_string_lossy().replace('\\', "/")
}

/// The hook's command as Hermes reads it: the script path quoted for its shell-style split.
pub fn command(path: &str) -> String {
    format!("\"{path}\"")
}

/// `cmd` as a YAML single-quoted scalar.
fn yaml(cmd: &str) -> String {
    format!("'{}'", cmd.replace('\'', "''"))
}

fn sum(body: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(body.join("\n").as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// One marked block at `indent` holding `body`, with the file's line break; `joined` when it is
/// appended to a last line that had none (taking the block out takes that break out too).
fn block(indent: &str, body: &[String], nl: &str, joined: bool) -> String {
    let refs: Vec<&str> = body.iter().map(String::as_str).collect();
    let mut out = String::new();
    if joined {
        out.push_str(nl);
    }
    out.push_str(&format!("{indent}{BEGIN}written by Kolux; taken out when its hooks go; edits inside are refused; sum {}{}) >>>{nl}", sum(&refs), if joined { "; joined" } else { "" }));
    for l in body {
        out.push_str(l);
        out.push_str(nl);
    }
    out.push_str(&format!("{indent}{END}{nl}"));
    out
}

fn lines(text: &str) -> Vec<(usize, &str)> {
    let mut at = 0;
    text.split_inclusive('\n')
        .map(|l| {
            let start = at;
            at += l.len();
            (start, l)
        })
        .collect()
}

fn bare(l: &str) -> &str {
    l.trim_end_matches(['\n', '\r'])
}

/// The byte spans of Kolux's blocks in `text`; an error for a block edited by hand or broken.
pub fn blocks(text: &str) -> Result<Vec<(usize, usize)>, String> {
    let mut out = Vec::new();
    let mut open: Option<(usize, String, bool, Vec<&str>)> = None;
    for (at, l) in lines(text) {
        let t = bare(l).trim_start();
        if let Some((start, want, joined, body)) = open.as_mut() {
            if t.starts_with(BEGIN) {
                return Err("a Kolux block opens inside another one; left alone".into());
            }
            if t == END {
                if sum(body) != *want {
                    return Err("Kolux's block was edited by hand; left alone".into());
                }
                let mut s = *start;
                if *joined {
                    s -= if text[..s].ends_with("\r\n") { 2 } else { usize::from(text[..s].ends_with('\n')) };
                }
                out.push((s, at + l.len()));
                open = None;
            } else {
                body.push(bare(l));
            }
            continue;
        }
        if let Some(rest) = t.strip_prefix(BEGIN) {
            let want = rest.split_once("sum ").map(|(_, s)| s.chars().take(16).collect()).unwrap_or_default();
            open = Some((at, want, rest.contains("; joined)"), Vec::new()));
        } else if t == END {
            return Err("an end line of Kolux's block has no begin line; left alone".into());
        }
    }
    if open.is_some() {
        return Err("Kolux's block has lost its end line; left alone".into());
    }
    Ok(out)
}

/// `text` without Kolux's blocks (`None` when it holds none).
pub fn without(text: &str) -> Result<Option<String>, String> {
    let spans = blocks(text)?;
    if spans.is_empty() {
        return Ok(None);
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (s, e) in spans {
        out.push_str(&text[at..s]);
        at = e;
    }
    out.push_str(&text[at..]);
    Ok(Some(out))
}

fn indent(l: &str) -> usize {
    l.len() - l.trim_start_matches(' ').len()
}

fn significant(l: &str) -> bool {
    let t = bare(l).trim();
    !t.is_empty() && !t.starts_with('#')
}

fn item_line(t: &str) -> bool {
    t == "-" || t.starts_with("- ")
}

/// A mapping line's key (unquoted) and what follows its colon, comments dropped.
fn key_of(line: &str) -> Option<(String, String)> {
    let t = bare(line).trim_start().trim_start_matches('\u{feff}');
    let (key, rest) = match t.chars().next() {
        Some(q @ ('"' | '\'')) => {
            let close = t[1..].find(q)? + 1;
            (t[1..close].to_string(), t[close + 1..].trim_start().strip_prefix(':')?)
        }
        _ => {
            let colon = t.char_indices().find(|&(i, c)| c == ':' && t[i + 1..].chars().next().is_none_or(char::is_whitespace))?.0;
            (t[..colon].trim_end().to_string(), &t[colon + 1..])
        }
    };
    let after = rest.trim();
    Some((key, if after.starts_with('#') { String::new() } else { after.to_string() }))
}

/// `base` (no Kolux blocks) with Kolux's blocks put in: one entry under each event the user
/// already hooks, the other events in one block opening the `hooks:` map, or, with no `hooks:`
/// key, one block at the end holding the whole key. Shapes a line editor cannot join safely are
/// refused.
pub fn with_blocks(file: &Path, base: Option<&str>, cmd: &str) -> Result<String, String> {
    let base = base.unwrap_or("");
    let nl = if base.contains("\r\n") { "\r\n" } else { "\n" };
    let refuse = |why: &str| format!("{} {why}; left alone", file.display());
    let items = |ind: usize| vec![format!("{}- command: {}", " ".repeat(ind), yaml(cmd)), format!("{}  timeout: {TIMEOUT}", " ".repeat(ind))];
    let events = |ind: usize, only: &[&str]| only.iter().flat_map(|e| std::iter::once(format!("{}{e}:", " ".repeat(ind))).chain(items(ind + 2))).collect::<Vec<_>>();
    let at_end = |offset: usize| offset == base.len() && !base.is_empty() && !base.ends_with('\n');
    let ls = lines(base);
    if let Some((_, first)) = ls.iter().find(|(_, l)| significant(l)) {
        let t = bare(first).trim_start().trim_start_matches('\u{feff}');
        if t.starts_with(['{', '[']) || item_line(t) {
            return Err(refuse("is not a plain YAML mapping"));
        }
    }
    let tops: Vec<usize> = (0..ls.len()).filter(|&i| significant(ls[i].1) && indent(ls[i].1) == 0 && key_of(ls[i].1).is_some_and(|(k, _)| k == "hooks")).collect();
    let Some(&top) = tops.first() else {
        let mut body = vec!["hooks:".to_string()];
        body.extend(events(2, &EVENTS));
        return Ok(format!("{base}{}", block("", &body, nl, at_end(base.len()))));
    };
    if tops.len() > 1 {
        return Err(refuse("has two hooks: keys"));
    }
    if !key_of(ls[top].1).map(|(_, a)| a).unwrap_or_default().is_empty() {
        return Err(refuse("sets hooks: on one line"));
    }
    let end = (top + 1..ls.len()).find(|&i| significant(ls[i].1) && indent(ls[i].1) == 0).unwrap_or(ls.len());
    let region: Vec<usize> = (top + 1..end).filter(|&i| significant(ls[i].1)).collect();
    let child = match region.first() {
        Some(&i) if item_line(bare(ls[i].1).trim_start()) => return Err(refuse("has hooks: as a list")),
        Some(&i) => indent(ls[i].1),
        None => 2,
    };
    let line_end = |i: usize| ls[i].0 + ls[i].1.len();
    let mut edits: Vec<(usize, String)> = Vec::new();
    let mut missing = Vec::new();
    for e in EVENTS {
        let found: Vec<usize> = region.iter().copied().filter(|&i| indent(ls[i].1) == child && !item_line(bare(ls[i].1).trim_start()) && key_of(ls[i].1).is_some_and(|(k, _)| k == e)).collect();
        let Some(&j) = found.first() else {
            missing.push(e);
            continue;
        };
        if found.len() > 1 {
            return Err(refuse(&format!("has {e}: twice")));
        }
        if !key_of(ls[j].1).map(|(_, a)| a).unwrap_or_default().is_empty() {
            return Err(refuse(&format!("sets {e}: on one line")));
        }
        let next = region.iter().copied().find(|&k| k > j).map(|k| (indent(ls[k].1), item_line(bare(ls[k].1).trim_start())));
        let ind = match next {
            Some((n, true)) if n >= child => n,
            Some((n, false)) if n > child => return Err(refuse(&format!("has {e}: that is not a list"))),
            _ => child + 2,
        };
        edits.push((line_end(j), block(&" ".repeat(ind), &items(ind), nl, at_end(line_end(j)))));
    }
    if !missing.is_empty() {
        let body = events(child, &missing);
        edits.push((line_end(top), block(&" ".repeat(child), &body, nl, at_end(line_end(top)))));
    }
    edits.sort_by_key(|e| std::cmp::Reverse(e.0));
    let mut out = base.to_string();
    for (at, text) in edits {
        out.insert_str(at, &text);
    }
    Ok(out)
}

/// The events whose (event, `cmd`) pair Hermes's allowlist does not hold.
fn unapproved(allow: &Path, cmd: &str) -> Result<Vec<&'static str>, String> {
    let v: Value = match read_opt(allow)? {
        Some(t) => serde_json::from_str(&t).map_err(|e| format!("{} is not JSON ({e})", allow.display()))?,
        None => json!({}),
    };
    let list = v.get("approvals").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(EVENTS.iter().copied().filter(|e| !list.iter().any(|a| a.get("event").and_then(Value::as_str) == Some(e) && a.get("command").and_then(Value::as_str) == Some(cmd))).collect())
}

/// STAT-016: Kolux's blocks go in (an older set comes out first); everything of the user's stays
/// byte for byte. A copy is kept before the first write. A block edited by hand is refused.
/// Hermes's allowlist is not touched: Hermes asks the user once per hook (Txais, 2026-10-20).
pub fn install(home: &Path, file: &Path) -> Result<bool, String> {
    let cmd = command(&write_script(home)?);
    let text = read_opt(file)?;
    let broken = |e: String| format!("{}: {e}", file.display());
    let old = match text.as_deref() {
        Some(t) => without(t).map_err(broken)?,
        None => None,
    };
    let mine_already = old.is_some();
    let new = with_blocks(file, old.as_deref().or(text.as_deref()), &cmd)?;
    if text.as_deref() == Some(new.as_str()) {
        return Ok(false);
    }
    super::keep_copy(home, file, "hermes", mine_already)?;
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// STAT-016: Kolux's blocks come out and the file is the user's again, byte for byte (a file
/// Kolux created and left empty goes). Hermes's allowlist is left as it is: its entries are the
/// user's answers. A second removal changes nothing; a block edited by hand is refused.
pub fn remove(home: &Path, file: &Path) -> Result<bool, String> {
    let mut changed = false;
    if let Some(text) = read_opt(file)? {
        if let Some(rest) = without(&text).map_err(|e| format!("{}: {e}", file.display()))? {
            let record = target_dir(home, file).join(BACKUP_RECORD);
            if rest.is_empty() && !backup_of(file).exists() && was_created(&record, file) {
                if fs::read(file).map_err(|e| format!("{}: {e}", file.display()))? != text.as_bytes() {
                    return Err(format!("{} {}", file.display(), super::super::super::CHANGED));
                }
                fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
                let _ = fs::remove_file(record);
            } else {
                write_atomic(file, rest.as_bytes(), Some(&text))?;
            }
            changed = true;
        }
    }
    Ok(changed)
}

/// The status row for Hermes: partial while a block is broken or stale, or while the user has not
/// yet answered Hermes's first-use prompt for Kolux's hooks (the allowlist is only read).
pub fn inspect(home: &Path, file: &Path, allow: &Path) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(None) => return ("not installed", None),
        Ok(Some(t)) => t,
        Err(e) => return ("error", Some(e)),
    };
    let rest = match without(&text) {
        Ok(None) => return ("not installed", None),
        Ok(Some(r)) => r,
        Err(e) => return ("partial", Some(format!("{}: {e}", file.display()))),
    };
    let cmd = command(&script_path(home));
    match with_blocks(file, Some(&rest), &cmd) {
        Ok(want) if want == text => {}
        Ok(_) => return ("partial", Some("Kolux's entries are not the current ones; they are rewritten at the next start".into())),
        Err(e) => return ("partial", Some(e)),
    }
    match unapproved(allow, &cmd) {
        Ok(left) if left.is_empty() => ("installed", None),
        Ok(_) => ("partial", Some(CONSENT.into())),
        Err(e) => ("partial", Some(e)),
    }
}

/// One Hermes event (route `hermes`, the event named in the payload) as the status rules read it.
pub fn event<'a>(name: &str, event: &'a Value) -> Option<(&'static str, Option<&'a str>, Value)> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let extra = event.get("extra");
    let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input") });
    let (name, out) = match name {
        // STAT-016: a turn starts with the model call; tools and answered approvals keep it working.
        "pre_llm_call" => ("UserPromptSubmit", json!({ "prompt": extra.and_then(|x| x.get("user_message")).and_then(Value::as_str) })),
        "pre_tool_call" => ("PreToolUse", tool()),
        "post_tool_call" => ("PostToolUse", json!({ "tool_name": str_of("tool_name") })),
        "pre_approval_request" => ("PermissionRequest", tool()),
        "post_approval_response" | "on_human_input_resolved" => ("PostToolUse", json!({})),
        "on_human_input_request" => ("PreToolUse", json!({ "kolux_ask": super::question(extra).unwrap_or("Hermes is asking you something") })),
        // A finished model call, a turn's end, teardown, reset or an interrupted loop: done.
        "post_llm_call" | "on_session_end" | "on_session_finalize" | "on_session_reset" | "agent_loop_stopped" => ("Stop", json!({})),
        // Session start fires while idle.
        _ => return None,
    };
    Some((name, str_of("session_id"), out))
}

#[cfg(test)]
#[path = "hermes_tests.rs"]
mod tests;
