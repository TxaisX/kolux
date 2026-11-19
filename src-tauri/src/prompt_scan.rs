//! ORCH-056: open agent prompts noticed with no hook reporting them. Some agents stop at a menu
//! that sends no hook (Cursor's approval menus, a trust screen, a numbered question), so Kolux reads
//! the pane's newest output for an open choice and marks the agent waiting through the same path an
//! in-band status takes (STAT-034). A prompt that sits only in restored scrollback never counts: each
//! pane remembers the output cursor its restore ended at and the scan starts after it. The scan is
//! memoised by the log cursor and forgotten when the pane's transcript is pruned (T-129-d).

use crate::terminal::{strip_ansi, Read};
use std::collections::HashMap;
use std::sync::Mutex;

/// How many newest lines make up the frame the scan looks at.
pub const FRAME_LINES: usize = 40;
/// A menu's option lines are read upward from the bottom at most this many lines.
const MENU_LINES: usize = 10;
/// The question is looked for at most this many lines above the menu.
const QUESTION_REACH: usize = 6;
/// How much of the question line is kept.
const TEXT_MAX: usize = 160;

/// An open prompt read off the screen: what kind of wait it is and the line that asks.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Prompt {
    /// "approval" (a permission or accept/reject menu), "trust" (a trust-this-folder screen) or
    /// "question" (a multiple-choice question).
    pub kind: &'static str,
    pub text: String,
    /// The menu's option lines as they stand on screen, top to bottom (T-035-c reads the answer
    /// keys off them).
    pub options: Vec<String>,
}

impl Prompt {
    /// The pane state the prompt means (STAT-034's in-band vocabulary).
    pub fn state(&self) -> &'static str {
        if self.kind == "question" {
            "waiting"
        } else {
            "permission"
        }
    }
}

/// Words an option line offers: a choice, not a composer placeholder or a shell prompt.
const OPTION_WORDS: [&str; 15] = ["yes", "no", "allow", "deny", "accept", "reject", "approve", "always", "never", "trust", "proceed", "cancel", "skip", "once", "don't ask"];
/// Lines a menu prints under its options; they never end a prompt.
const HINTS: [&str; 10] = ["esc to", "enter to", "to navigate", "to select", "to confirm", "tab to", "ctrl+c", "ctrl-c", "↑/↓", "arrow keys"];
/// Phrases that make the asking line an approval rather than a plain question.
const APPROVAL_WORDS: [&str; 12] = ["proceed", "allow", "approve", "run this", "run the", "execute", "apply", "edit", "accept", "permission", "command", "make this"];

fn clean(line: &str) -> String {
    let plain = strip_ansi(line);
    // Box borders of a dialog are decoration: drop the drawing characters at both ends.
    plain.trim().trim_matches(|c: char| matches!(c, '│' | '┃' | '|' | '╭' | '╮' | '╰' | '╯' | '─' | '━' | '┌' | '┐' | '└' | '┘' | '┤' | '├')).trim().to_string()
}

fn is_hint(l: &str) -> bool {
    let low = l.to_lowercase();
    HINTS.iter().any(|h| low.contains(h))
}

/// A line that offers an option: a pointer glyph or a number before a choice word, a y/n tail, or
/// an accept-and-reject pair. The text after a pointer must read as a choice, so Claude Code's
/// composer pointer with its placeholder, and a shell's own `>` prompt, never count.
fn is_option(l: &str) -> bool {
    let low = l.to_lowercase();
    let yn = ["[y/n]", "(y/n)", "[y/n/a]", "[yes/no]"];
    if yn.iter().any(|t| low.contains(t)) {
        return true;
    }
    if low.contains("accept") && low.contains("reject") {
        return true;
    }
    let body = low.trim_start_matches(['❯', '›', '>', '●', '○', '◉', '•', '*', '[', ']', '(', ')', ' ', 'x']);
    let body = body.trim_start();
    let numbered = body.chars().next().is_some_and(|c| c.is_ascii_digit()) && body.chars().nth(1).is_some_and(|c| c == '.' || c == ')');
    let rest = if numbered { body[2..].trim_start() } else { body };
    // A whole word: "no" matches "No, exit" and never "notes"; "yes" never "yesterday".
    let word = |w: &str| rest.starts_with(w) && rest[w.len()..].chars().next().is_none_or(|c| !c.is_alphanumeric());
    !rest.is_empty() && rest.len() < 80 && OPTION_WORDS.iter().any(|w| word(w))
}

fn kind_of(question: &str) -> &'static str {
    let low = question.to_lowercase();
    if low.contains("trust") {
        "trust"
    } else if APPROVAL_WORDS.iter().any(|w| low.contains(w)) {
        "approval"
    } else {
        "question"
    }
}

/// The open prompt in `rows` (the newest output, oldest first), or None when the newest thing on
/// screen is not a menu waiting for a choice: output after a menu means it was answered.
pub fn find_prompt(rows: &[String]) -> Option<Prompt> {
    let start = rows.len().saturating_sub(FRAME_LINES);
    let lines: Vec<String> = rows[start..].iter().map(|l| clean(l)).collect();
    // Trailing blanks and hint lines are not an answer.
    let mut end = lines.len();
    while end > 0 && (lines[end - 1].is_empty() || is_hint(&lines[end - 1])) {
        end -= 1;
    }
    if end == 0 || !is_option(&lines[end - 1]) {
        return None;
    }
    // The menu: option, blank and hint lines read upward from the bottom.
    let mut top = end - 1;
    let mut options = Vec::new();
    while top > 0 && end - top < MENU_LINES {
        let l = &lines[top - 1];
        if is_option(l) {
            options.push(l.clone());
        } else if !(l.is_empty() || is_hint(l)) {
            break;
        }
        top -= 1;
    }
    options.push(lines[end - 1].clone());
    // The asking line: an option line that asks itself ("Allow command? [y/n]"), else the nearest
    // line above the menu that ends in a question mark, else the nearest line with words, else the
    // first option.
    let above: Vec<&String> = lines[top.saturating_sub(QUESTION_REACH)..top].iter().rev().filter(|l| !l.is_empty() && !is_hint(l)).collect();
    let asking = options.iter().find(|o| o.contains('?')).or_else(|| above.iter().find(|l| l.ends_with('?')).or(above.first()).copied()).or(options.last()).map(String::as_str).unwrap_or_default();
    let text: String = asking.chars().take(TEXT_MAX).collect();
    let kind = kind_of(&format!("{asking} {}", options.join(" ")));
    // Options were collected upward with the bottom one appended last: put them top to bottom.
    let bottom = options.pop();
    options.reverse();
    options.extend(bottom);
    Some(Prompt { kind, text, options })
}

#[derive(Default, Debug)]
struct PaneScan {
    /// The log cursor the pane's restore ended at: lines up to it are restored scrollback.
    restored_until: u64,
    /// The read this result was computed for: (newest cursor, pending text).
    key: Option<(u64, String)>,
    found: Option<Prompt>,
}

/// The per-pane scan memory.
#[derive(Default, Debug)]
pub struct Scanner {
    panes: HashMap<u32, PaneScan>,
}

impl Scanner {
    /// The pane's restored scrollback ends at `cursor`: nothing up to it is a live prompt.
    pub fn restored(&mut self, pane: u32, cursor: u64) {
        let p = self.panes.entry(pane).or_default();
        p.restored_until = cursor;
        p.key = None;
        p.found = None;
    }

    /// The pane's transcript was pruned (or the pane is gone): its scan memory goes with it.
    pub fn pruned(&mut self, pane: u32) {
        self.panes.remove(&pane);
    }

    /// The prompt open in `pane` as `read` shows its newest output; the same read gives the
    /// memoised answer. Lines inside the restored scrollback are skipped.
    pub fn scan(&mut self, pane: u32, read: &Read) -> Option<Prompt> {
        let p = self.panes.entry(pane).or_default();
        let key = (read.cursor, read.pending.clone());
        if p.key.as_ref() == Some(&key) {
            return p.found.clone();
        }
        let mut rows: Vec<String> = read.lines.iter().filter(|l| l.cursor > p.restored_until).map(|l| l.text.clone()).collect();
        if !read.pending.trim().is_empty() {
            rows.push(read.pending.clone());
        }
        p.found = find_prompt(&rows);
        p.key = Some(key);
        p.found.clone()
    }

    /// What the last scan of `pane` found, without reading again.
    pub fn last(&self, pane: u32) -> Option<&Prompt> {
        self.panes.get(&pane).and_then(|p| p.found.as_ref())
    }
}

static SCANNER: std::sync::LazyLock<Mutex<Scanner>> = std::sync::LazyLock::new(|| Mutex::new(Scanner::default()));

fn with_scanner<T>(f: impl FnOnce(&mut Scanner) -> T) -> T {
    let mut s = SCANNER.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut s)
}

/// The prompt open on `terminal` as `read` shows it, through the shared scan memory (restored
/// scrollback skipped, result memoised). T-035-c answers from this same reading.
pub fn live_prompt(terminal: u32, read: &Read) -> Option<Prompt> {
    with_scanner(|s| s.scan(terminal, read))
}

/// The window's view of a scan: the prompt, or none.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub prompt: Option<Prompt>,
    /// The pane's status moved because of this scan.
    pub changed: bool,
}

/// ORCH-056: scan `terminal`'s newest output for an open prompt and show it: a prompt found marks
/// pane `pane_key` waiting the way an in-band status would, and a prompt gone marks it working
/// again; a pane whose hooks already report a state is left to them. Registered in lib.rs by the
/// coordinator (evidence/watch-T-129-d-lib.rs.patch).
#[tauri::command]
pub fn prompt_scan(app: tauri::AppHandle, terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32, terminal: u32) -> Scan {
    let read = terminals.read(terminal, None, Some(FRAME_LINES));
    let before = with_scanner(|s| s.last(terminal).cloned());
    let prompt = read.as_ref().and_then(|r| live_prompt(terminal, r));
    let hooked = crate::status::state_of(terminal).is_some();
    let changed = match (&before, &prompt) {
        (_, Some(p)) if !hooked => crate::status::status_inband(app, pane_key, Some(terminal), format!(r#"{{"state":"{}"}}"#, p.state())),
        (Some(_), None) if !hooked => crate::status::status_inband(app, pane_key, Some(terminal), r#"{"state":"working"}"#.into()),
        _ => false,
    };
    Scan { prompt, changed }
}

/// ORCH-056: the pane's restored scrollback has been replayed; the scan starts after it.
#[tauri::command]
pub fn prompt_scan_restored(terminals: tauri::State<'_, crate::terminal::Terminals>, terminal: u32) {
    let cursor = terminals.read(terminal, None, Some(1)).map(|r| r.cursor).unwrap_or(0);
    with_scanner(|s| s.restored(terminal, cursor));
}

/// ORCH-056: the pane's transcript was pruned (or its terminal ended): its scan memory goes.
#[tauri::command]
pub fn prompt_scan_pruned(terminal: u32) {
    with_scanner(|s| s.pruned(terminal));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::Line;

    fn rows(s: &[&str]) -> Vec<String> {
        s.iter().map(|l| l.to_string()).collect()
    }

    fn read_of(lines: &[&str], first_cursor: u64, pending: &str) -> Read {
        Read { lines: lines.iter().enumerate().map(|(i, t)| Line { cursor: first_cursor + i as u64, text: t.to_string() }).collect(), pending: pending.into(), cursor: first_cursor + lines.len() as u64 - 1, oldest: first_cursor, ..Read::default() }
    }

    #[test]
    fn orch056_claude_permission_trust_and_question_menus_are_read_off_the_screen() {
        // A permission menu, with colour codes and a dialog border, under earlier output.
        let p = find_prompt(&rows(&["Reading src/main.rs", "", "\x1b[1mDo you want to make this edit to main.rs?\x1b[0m", "│ ❯ 1. Yes", "│   2. Yes, and don't ask again this session", "│   3. No, and tell Claude what to do differently", "", "Esc to cancel"])).expect("a permission menu is a prompt");
        assert_eq!((p.kind, p.text.as_str(), p.state()), ("approval", "Do you want to make this edit to main.rs?", "permission"));
        // The trust screen.
        let t = find_prompt(&rows(&["Do you trust the files in this folder?", "", "  G:\\Temp\\watch-v3\\repo", "", "❯ 1. Yes, proceed", "  2. No, exit", "", "Enter to confirm · Esc to exit"])).expect("a trust screen is a prompt");
        assert_eq!((t.kind, t.state()), ("trust", "permission"));
        // A multiple-choice question is input, not approval.
        let q = find_prompt(&rows(&["Which framework should the new page use?", "❯ 1. Next.js", "  2. Remix", "  3. Skip this question", "  ↑/↓ to navigate"])).expect("a numbered question is a prompt");
        assert_eq!((q.kind, q.text.as_str(), q.state()), ("question", "Which framework should the new page use?", "waiting"));
    }

    #[test]
    fn orch056_codex_and_cursor_menus_that_send_no_hook_are_approvals() {
        let c = find_prompt(&rows(&["$ cargo test --lib", "Allow command? [y/n]"])).expect("a y/n tail is a prompt");
        assert_eq!((c.kind, c.text.as_str()), ("approval", "Allow command? [y/n]"));
        // Cursor's approval menu: the command, then accept / reject options.
        let u = find_prompt(&rows(&["Run this command?", "  pnpm exec vitest run", "", "● Accept    ○ Reject", "Tab to switch"])).expect("an accept/reject menu is a prompt");
        assert_eq!((u.kind, u.text.as_str()), ("approval", "Run this command?"));
    }

    #[test]
    fn orch056_a_composer_a_shell_prompt_working_output_and_an_answered_menu_are_no_prompt() {
        assert_eq!(find_prompt(&rows(&["│ > Try \"fix the failing test\"", "│", "  ? for shortcuts"])), None, "the composer's pointer is not a menu");
        assert_eq!(find_prompt(&rows(&["PS G:\\Temp> ", "> "])), None, "a shell prompt is not a menu");
        assert_eq!(find_prompt(&rows(&["Running tests...", "test a ... ok", "test b ... ok"])), None);
        // The menu was answered: output came after it.
        assert_eq!(find_prompt(&rows(&["Do you want to proceed?", "❯ 1. Yes", "  2. No", "", "Edited main.rs", "Running cargo build"])), None, "output after the menu means it was answered");
        assert_eq!(find_prompt(&[]), None);
    }

    #[test]
    fn orch056_restored_scrollback_never_counts_and_the_scan_is_memoised_until_pruned() {
        let mut s = Scanner::default();
        // The saved scrollback ends at cursor 12 and holds an old permission menu.
        s.restored(7, 12);
        let old = read_of(&["Do you want to proceed?", "❯ 1. Yes", "  2. No"], 10, "");
        assert_eq!(s.scan(7, &old), None, "a prompt only in restored scrollback marks nothing");
        // Live output after the mark with a menu is found; the same read answers from memory.
        let live = read_of(&["Do you want to proceed?", "❯ 1. Yes", "  2. No", "Allow command? [y/n]"], 10, "");
        let found = s.scan(7, &live).expect("the live line after the mark counts");
        assert_eq!((found.kind, found.text.as_str()), ("approval", "Allow command? [y/n]"));
        assert_eq!(s.last(7), Some(&found));
        assert_eq!(s.scan(7, &live), Some(found.clone()), "memoised by cursor");
        // More output answers it; a pending (unterminated) line is scanned too.
        let answered = read_of(&["Allow command? [y/n]", "ok, running"], 13, "");
        assert_eq!(s.scan(7, &answered), None);
        let pending = read_of(&["ok, running"], 14, "Apply this change? [y/N]");
        assert_eq!(s.scan(7, &pending).map(|p| p.text), Some("Apply this change? [y/N]".to_string()));
        // Pruning forgets the pane, mark included: an unrestored pane scans everything.
        s.pruned(7);
        assert_eq!(s.last(7), None);
        assert_eq!(s.scan(7, &old).map(|p| p.kind), Some("approval"));
        // Another pane keeps its own mark.
        s.restored(8, 100);
        assert_eq!(s.scan(8, &old), None);
    }
}
