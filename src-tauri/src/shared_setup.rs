//! Shared instructions: Claude's global `CLAUDE.md` is the source of truth, and a marked block of
//! it is mirrored into every other agent's global instruction file, so all models follow the same
//! rules. The block is fenced by two HTML comments, so the user's own text in each file is kept
//! byte for byte and a second run changes nothing.
//!
//! Only the files named in `targets` are written, all under the user's home folder. A target that
//! is a link is written through the link (the file it names), never replaced by a plain copy. The
//! source is size-capped, and a missing source is an error rather than an empty block.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// The fence around the mirrored text. HTML comments are invisible in every Markdown renderer.
pub const START: &str = "<!-- kolux:shared-instructions:start -->";
pub const END: &str = "<!-- kolux:shared-instructions:end -->";
/// The most of `CLAUDE.md` that is mirrored: a memory file is meant to stay small.
const MAX_SOURCE: u64 = 256 * 1024;
/// A skill folder larger than this is reported, not copied into the shared folder.
const MAX_SKILL: u64 = 8 * 1024 * 1024;

/// One agent's global instruction file.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub agent: &'static str,
    pub label: &'static str,
    pub path: String,
    /// synced, stale, missing, absent or unreadable
    pub state: &'static str,
}

/// One of Claude's global skills and whether the shared folder already has it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    pub name: String,
    pub shared: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SharedSetup {
    pub source: String,
    /// found, missing or unreadable
    pub source_state: &'static str,
    pub targets: Vec<Target>,
    pub skills: Vec<SkillRow>,
    pub notes: Vec<String>,
}

/// The global instruction file each agent reads, in the order the page lists them. Every path is
/// under the user's home folder; an agent whose file is not documented is left out rather than
/// guessed at.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Markdown,
    /// Cursor's rule files need frontmatter to be applied at all.
    Mdc,
}

fn targets(home: &Path) -> Vec<(&'static str, &'static str, PathBuf, Kind)> {
    vec![
        ("codex", "Codex", home.join(".codex").join("AGENTS.md"), Kind::Markdown),
        ("gemini", "Gemini CLI", home.join(".gemini").join("GEMINI.md"), Kind::Markdown),
        ("grok", "Grok", home.join(".grok").join("AGENTS.md"), Kind::Markdown),
        ("copilot", "Copilot CLI", home.join(".copilot").join("copilot-instructions.md"), Kind::Markdown),
        ("droid", "Droid", home.join(".factory").join("AGENTS.md"), Kind::Markdown),
        ("cursor", "Cursor", home.join(".cursor").join("rules").join("kolux-shared.mdc"), Kind::Mdc),
        ("hermes", "Hermes", home.join(".hermes").join("SOUL.md"), Kind::Markdown),
        ("shared", "Shared folder", home.join(".agents").join("AGENTS.md"), Kind::Markdown),
    ]
}

/// Cursor ignores a rule file without frontmatter, so a new one gets the "always apply" header.
fn with_frontmatter(existing: &str, kind: Kind) -> String {
    if kind == Kind::Mdc && !existing.trim_start().starts_with("---") {
        return format!("---\ndescription: Kolux shared instructions\nalwaysApply: true\n---\n\n{existing}");
    }
    existing.to_string()
}

/// The block written into every target: the source text between the two fences.
pub fn block(source: &str) -> String {
    format!("{START}\n{}\n{END}\n", source.trim())
}

/// `existing` with the block replaced in place, or the block appended when there is none. Text
/// outside the fences is never touched.
pub fn merge(existing: &str, block: &str) -> String {
    if let Some(a) = existing.find(START) {
        if let Some(b) = existing.find(END) {
            if a < b {
                let mut out = String::with_capacity(existing.len() + block.len());
                out.push_str(&existing[..a]);
                out.push_str(block);
                let rest = existing[b + END.len()..].strip_prefix('\n').unwrap_or(&existing[b + END.len()..]);
                out.push_str(rest);
                return out;
            }
        } else {
            // A start with no end: the rest of the file is the old block.
            let mut out = existing[..a].to_string();
            out.push_str(block);
            return out;
        }
    }
    let mut out = existing.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(block);
    out
}

/// The state of one target against the block that would be written.
fn state_of(path: &Path, block: &str) -> &'static str {
    match fs::read_to_string(path) {
        Ok(text) if text.contains(block) => "synced",
        Ok(text) if text.contains(START) => "stale",
        Ok(_) => "missing",
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "absent",
        Err(_) => "unreadable",
    }
}

/// The source file and its state.
fn source_of(home: &Path) -> (PathBuf, &'static str) {
    let path = home.join(".claude").join("CLAUDE.md");
    let state = match fs::metadata(&path) {
        Ok(m) if m.is_file() => "found",
        Ok(_) => "unreadable",
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
        Err(_) => "unreadable",
    };
    (path, state)
}

/// Claude's global skills and whether the shared folder has each one.
fn skills_of(home: &Path) -> Vec<SkillRow> {
    let claude = home.join(".claude").join("skills");
    let shared = home.join(".agents").join("skills");
    let Ok(entries) = fs::read_dir(&claude) else { return Vec::new() };
    let mut rows: Vec<SkillRow> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            (!name.starts_with('.')).then(|| SkillRow { shared: shared.join(&name).exists(), name })
        })
        .collect();
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    rows
}

/// What the page shows: the source, each target's state and the skills. Nothing is written.
pub fn status(home: &Path) -> SharedSetup {
    let (source_path, source_state) = source_of(home);
    let source = fs::read_to_string(&source_path).unwrap_or_default();
    let block = block(&source);
    let targets = targets(home)
        .into_iter()
        .map(|(agent, label, path, _)| Target { agent, label, path: path.display().to_string(), state: state_of(&path, &block) })
        .collect();
    let mut notes = Vec::new();
    if source_state == "missing" {
        notes.push(format!("{} does not exist yet; write it first.", source_path.display()));
    }
    SharedSetup { source: source_path.display().to_string(), source_state, targets, skills: skills_of(home), notes }
}

/// Writes the block into every target and copies any missing skill into the shared folder. Returns
/// the state after the write. A missing or oversized source is an error and nothing is written.
pub fn apply(home: &Path) -> Result<SharedSetup, String> {
    let (source_path, source_state) = source_of(home);
    if source_state != "found" {
        return Err(format!("{} is {source_state}; nothing was written", source_path.display()));
    }
    let source = fs::read_to_string(&source_path).map_err(|e| format!("{}: {e}", source_path.display()))?;
    if source.len() as u64 > MAX_SOURCE {
        return Err(format!("{} is larger than {} KB; nothing was written", source_path.display(), MAX_SOURCE / 1024));
    }
    let block = block(&source);
    let mut notes = Vec::new();
    for (_, label, path, kind) in targets(home) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let existing = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => {
                notes.push(format!("{label}: {}: {e}", path.display()));
                continue;
            }
        };
        let existing = with_frontmatter(&existing, kind);
        let next = merge(&existing, &block);
        if next != existing {
            write_through(&path, &next).map_err(|e| format!("{label}: {}: {e}", path.display()))?;
        }
    }
    for row in skills_of(home) {
        if row.shared {
            continue;
        }
        let src = home.join(".claude").join("skills").join(&row.name);
        let dst = home.join(".agents").join("skills").join(&row.name);
        match copy_skill(&src, &dst) {
            Ok(()) => {}
            Err(e) => notes.push(format!("{}: {e}", row.name)),
        }
    }
    let mut out = status(home);
    out.notes.extend(notes);
    Ok(out)
}

/// Writes `text` to `path`. A link is written through, so the file it names is updated and the link
/// stays a link; a plain file is replaced atomically.
fn write_through(path: &Path, text: &str) -> std::io::Result<()> {
    let is_link = fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    if is_link {
        return fs::write(path, text);
    }
    let dir = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent folder"))?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "shared".into());
    let tmp = dir.join(format!(".{name}.kolux-tmp"));
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

/// Copies one skill folder into the shared folder, refusing one that is too large.
fn copy_skill(src: &Path, dst: &Path) -> Result<(), String> {
    let size = folder_size(src);
    if size > MAX_SKILL {
        return Err(format!("larger than {} MB; not copied", MAX_SKILL / (1024 * 1024)));
    }
    copy_dir(src, dst).map_err(|e| e.to_string())
}

fn folder_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => folder_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// The Settings > Claude "Shared with other agents" section: nothing is written.
#[tauri::command(async)]
pub fn shared_setup_status() -> SharedSetup {
    status(&crate::skills::Env::current().home)
}

/// Mirrors Claude's global `CLAUDE.md` into every other agent's global instruction file and copies
/// any missing skill into the shared folder.
#[tauri::command(async)]
pub fn shared_setup_apply() -> Result<SharedSetup, String> {
    apply(&crate::skills::Env::current().home)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(tag: &str) -> PathBuf {
        let t = std::env::temp_dir().join(format!("kolux-shared-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        fs::create_dir_all(t.join(".claude")).unwrap();
        t
    }

    fn write(p: &Path, text: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn merge_appends_once_and_replaces_in_place() {
        let b = block("rule one");
        assert_eq!(merge("", &b), b);
        let once = merge("my own text\n", &b);
        assert_eq!(once, format!("my own text\n\n{b}"));
        let twice = merge(&once, &block("rule two"));
        assert_eq!(twice, format!("my own text\n\n{}", block("rule two")));
        assert!(twice.contains("my own text"), "the user's text is kept");
    }

    #[test]
    fn status_reports_each_target_and_apply_writes_the_block() {
        let t = tree("apply");
        write(&t.join(".claude").join("CLAUDE.md"), "# Rules\n\nBe brief.\n");
        write(&t.join(".codex").join("AGENTS.md"), "my codex notes\n");
        let before = status(&t);
        assert_eq!(before.source_state, "found");
        assert_eq!(before.targets.iter().find(|x| x.agent == "codex").unwrap().state, "missing");
        assert_eq!(before.targets.iter().find(|x| x.agent == "gemini").unwrap().state, "absent");

        let after = apply(&t).unwrap();
        assert!(after.targets.iter().all(|x| x.state == "synced"), "{:?}", after.targets);
        let codex = fs::read_to_string(t.join(".codex").join("AGENTS.md")).unwrap();
        assert!(codex.starts_with("my codex notes"), "the user's text is kept: {codex}");
        assert!(codex.contains("Be brief."));
        // A second run changes nothing.
        let again = apply(&t).unwrap();
        assert_eq!(again.targets, after.targets);
    }

    #[test]
    fn a_missing_source_is_an_error_and_nothing_is_written() {
        let t = tree("missing");
        let err = apply(&t).unwrap_err();
        assert!(err.contains("missing"), "{err}");
        assert!(!t.join(".codex").join("AGENTS.md").exists());
    }

    #[test]
    fn a_stale_block_is_replaced_and_the_rest_kept() {
        let t = tree("stale");
        write(&t.join(".claude").join("CLAUDE.md"), "new rules\n");
        write(&t.join(".codex").join("AGENTS.md"), &format!("before\n\n{}\nafter\n", block("old rules")));
        let after = apply(&t).unwrap();
        assert_eq!(after.targets.iter().find(|x| x.agent == "codex").unwrap().state, "synced");
        let text = fs::read_to_string(t.join(".codex").join("AGENTS.md")).unwrap();
        assert!(text.contains("before") && text.contains("after") && text.contains("new rules") && !text.contains("old rules"), "{text}");
    }

    #[test]
    fn a_cursor_rule_gets_frontmatter_so_it_applies() {
        let t = tree("cursor");
        write(&t.join(".claude").join("CLAUDE.md"), "rules\n");
        apply(&t).unwrap();
        let text = fs::read_to_string(t.join(".cursor").join("rules").join("kolux-shared.mdc")).unwrap();
        assert!(text.starts_with("---\n"), "{text}");
        assert!(text.contains("alwaysApply: true"));
        assert!(text.contains("rules"));
    }

    #[test]
    fn a_missing_skill_is_copied_into_the_shared_folder() {
        let t = tree("skills");
        write(&t.join(".claude").join("CLAUDE.md"), "rules\n");
        write(&t.join(".claude").join("skills").join("alpha").join("SKILL.md"), "alpha\n");
        let before = status(&t);
        assert_eq!(before.skills, vec![SkillRow { name: "alpha".into(), shared: false }]);
        apply(&t).unwrap();
        assert!(t.join(".agents").join("skills").join("alpha").join("SKILL.md").is_file());
        assert_eq!(status(&t).skills, vec![SkillRow { name: "alpha".into(), shared: true }]);
    }
}
