//! The chat write-up: every chat writes a plain-language record into the History folder the user
//! picked, `<History>\<Folder>\<YYYY-MM-DD HHmm> <title>.md`. That file is the permanent record of
//! the chat; Claude deletes its own transcript after 30 days, so a raw copy is kept beside the
//! write-up (`<same name>.transcript.jsonl`) and put back before a resume.
//!
//! The helpers take plain inputs (paths, strings, a civil date and time), never engine types.
//! Folder and chat names become Windows-safe names: illegal characters, trailing dots and spaces,
//! reserved device names and long names are all handled, and a file that already exists is never
//! overwritten (a counter is added). Every append opens the file, writes one block and closes it,
//! so a crash loses at most the block being written.
#![allow(dead_code)] // wired in the chat-app screens stage

use jiff::civil::DateTime;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The most characters kept of a folder name or a chat title in a file name.
pub const NAME_MAX: usize = 80;
/// The folder log's file name, inside each folder of the History folder.
pub const FOLDER_LOG: &str = "_folder log.md";
/// What a raw transcript copy is called: the write-up's name plus this ending.
pub const TRANSCRIPT_END: &str = ".transcript.jsonl";

const DATE_FORMAT: &str = "%Y-%m-%d %H%M";
/// `YYYY-MM-DD HHmm` is 15 characters; the title follows after one space.
const DATE_LEN: usize = 15;

/// The device names Windows does not allow as a file or folder name, with or without an extension.
fn reserved(stem: &str) -> bool {
    let up = stem.to_ascii_uppercase();
    matches!(up.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| up.strip_prefix(p).is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9')))
}

/// A name that is safe as one Windows path component, never empty. Illegal characters become `-`,
/// runs of spaces collapse, trailing dots and spaces go, a reserved device name gets a `_` in
/// front, and the result is cut to [`NAME_MAX`] characters.
pub fn safe_name(raw: &str, fallback: &str) -> String {
    let mut out = String::new();
    let mut last_space = true;
    for c in raw.chars() {
        // A tab or line break is whitespace (one space), not a control character to dash out.
        let c = if !c.is_whitespace() && (c.is_control() || "<>:\"/\\|?*".contains(c)) { '-' } else { c };
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(c);
            last_space = false;
        }
    }
    let mut name: String = out.chars().take(NAME_MAX).collect();
    while name.ends_with(['.', ' ']) {
        name.pop();
    }
    while name.starts_with(' ') {
        name.remove(0);
    }
    if name.is_empty() {
        name = fallback.to_string();
    }
    // `CON.txt` is as reserved as `CON`: judge the part before the first dot.
    if reserved(name.split('.').next().unwrap_or("")) {
        name.insert(0, '_');
    }
    name
}

/// Local date and time from milliseconds since 1970, for a caller that holds a timestamp.
pub fn civil_from_millis(ms: i64) -> Option<DateTime> {
    let ts = jiff::Timestamp::from_millisecond(ms).ok()?;
    Some(ts.to_zoned(jiff::tz::TimeZone::system()).datetime())
}

/// The folder inside the History folder that holds one app folder's chats.
pub fn folder_dir(history_root: &Path, folder_name: &str) -> PathBuf {
    history_root.join(safe_name(folder_name, "Folder"))
}

/// An open write-up. Cheap to clone: it is only the file's path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Writeup {
    path: PathBuf,
}

/// Starts a write-up: creates `<History>\<Folder>\<date> <title>.md` with its heading. Folders are
/// created as needed; an existing file of the same name is kept and ` (2)`, ` (3)` ... is added.
pub fn start(history_root: &Path, folder_name: &str, chat_title: &str, started_at: DateTime) -> io::Result<Writeup> {
    let dir = folder_dir(history_root, folder_name);
    fs::create_dir_all(&dir)?;
    let title = safe_name(chat_title, "Chat");
    let stamp = started_at.strftime(DATE_FORMAT).to_string();
    for n in 1u32..10_000 {
        let name = if n == 1 { format!("{stamp} {title}.md") } else { format!("{stamp} {title} ({n}).md") };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                let heading = format!("# {}\n\n_Started {}_\n\n", chat_title.trim().replace('\n', " "), started_at.strftime("%Y-%m-%d %H:%M"));
                f.write_all(heading.as_bytes())?;
                return Ok(Writeup { path });
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "too many write-ups with the same name"))
}

impl Writeup {
    /// A write-up that already exists (a resumed chat appends to the same file).
    pub fn open_existing(path: PathBuf) -> Writeup {
        Writeup { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn append(&self, block: &str) -> io::Result<()> {
        let mut f = OpenOptions::new().append(true).create(true).open(&self.path)?;
        f.write_all(block.as_bytes())
    }

    /// What the user said, under a "You" heading.
    pub fn append_user(&self, text: &str) -> io::Result<()> {
        self.append(&format!("## You\n\n{}\n\n", text.trim_end()))
    }

    /// What Claude answered, under a "Claude" heading.
    pub fn append_reply(&self, text: &str) -> io::Result<()> {
        self.append(&format!("## Claude\n\n{}\n\n", text.trim_end()))
    }

    /// One plain step Claude took ("Read the budget sheet"), as a list line.
    pub fn append_step(&self, line: &str) -> io::Result<()> {
        self.append(&format!("- {}\n", line.trim().replace('\n', " ")))
    }

    /// A notable event ("Saved your work", "Pull request opened"), bold, with its link if it has one.
    pub fn append_event(&self, line: &str, link: Option<&str>) -> io::Result<()> {
        let line = line.trim().replace('\n', " ");
        match link.map(str::trim).filter(|l| !l.is_empty()) {
            Some(l) => self.append(&format!("\n**{line}:** {l}\n\n")),
            None => self.append(&format!("\n**{line}**\n\n")),
        }
    }

    /// Where the raw transcript copy of this chat lives: beside the write-up.
    pub fn transcript_path(&self) -> PathBuf {
        let stem = self.path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        self.path.with_file_name(format!("{stem}{TRANSCRIPT_END}"))
    }

    /// Keeps a copy of Claude's raw transcript (`src_jsonl`) beside the write-up, replacing the
    /// earlier copy. Returns the copy's path.
    pub fn copy_transcript(&self, src_jsonl: &Path) -> io::Result<PathBuf> {
        let to = self.transcript_path();
        fs::copy(src_jsonl, &to)?;
        Ok(to)
    }

    /// Puts the kept transcript back at `dest_jsonl` (where Claude looks for it) before a resume.
    /// Nothing is done when Claude's own file is there and at least as long as the copy. Returns
    /// whether a file was written; `Ok(false)` also when there is no kept copy.
    pub fn restore_transcript(&self, dest_jsonl: &Path) -> io::Result<bool> {
        let from = self.transcript_path();
        let Ok(kept) = fs::metadata(&from) else { return Ok(false) };
        if let Ok(have) = fs::metadata(dest_jsonl) {
            if have.is_file() && have.len() >= kept.len() {
                return Ok(false);
            }
        }
        if let Some(parent) = dest_jsonl.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&from, dest_jsonl)?;
        Ok(true)
    }
}

/// Adds one line, with the time, to `<History>\<Folder>\_folder log.md`.
pub fn folder_log(history_root: &Path, folder: &str, line: &str) -> io::Result<()> {
    folder_log_at(history_root, folder, line, jiff::Zoned::now().datetime())
}

/// [`folder_log`] with the time given.
pub fn folder_log_at(history_root: &Path, folder: &str, line: &str, at: DateTime) -> io::Result<()> {
    let dir = folder_dir(history_root, folder);
    fs::create_dir_all(&dir)?;
    let path = dir.join(FOLDER_LOG);
    let fresh = !path.exists();
    let mut f = OpenOptions::new().append(true).create(true).open(&path)?;
    if fresh {
        f.write_all(b"# Folder log\n\n")?;
    }
    f.write_all(format!("- {} {}\n", at.strftime("%Y-%m-%d %H:%M"), line.trim().replace('\n', " ")).as_bytes())
}

/// One entry of a "Past chats" list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PastChat {
    pub title: String,
    /// `YYYY-MM-DD HH:MM`, the start time from the file name.
    pub date: String,
    pub path: PathBuf,
}

/// The write-ups of one folder, newest first. Files that do not carry the `YYYY-MM-DD HHmm` name
/// (the folder log, a note the user added) are not chats and are left out. A missing folder is an
/// empty list.
pub fn list_past_chats(history_root: &Path, folder: &str) -> Vec<PastChat> {
    let Ok(rd) = fs::read_dir(folder_dir(history_root, folder)) else { return Vec::new() };
    let mut rows: Vec<(String, PastChat)> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".md")?;
            let (stamp, title) = split_stamp(stem)?;
            let date = format!("{} {}:{}", &stamp[..10], &stamp[11..13], &stamp[13..15]);
            Some((stem.to_string(), PastChat { title: title.to_string(), date, path: e.path() }))
        })
        .collect();
    rows.sort_by(|a, b| b.1.date.cmp(&a.1.date).then_with(|| b.0.cmp(&a.0)));
    rows.into_iter().map(|(_, c)| c).collect()
}

/// `2026-11-19 1405 Title` into the stamp and the title; `None` when the name is not that shape.
fn split_stamp(stem: &str) -> Option<(&str, &str)> {
    let b = stem.as_bytes();
    if b.len() <= DATE_LEN + 1 || !stem.is_char_boundary(DATE_LEN) || b[DATE_LEN] != b' ' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    let ok = digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10) && b[10] == b' ' && digits(11..15);
    ok.then(|| (&stem[..DATE_LEN], &stem[DATE_LEN + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::datetime;

    fn at(h: i8, m: i8) -> DateTime {
        datetime(2026, 11, 19, h, m, 0, 0)
    }

    #[test]
    fn the_file_is_named_by_date_and_title_in_the_folders_directory() {
        let root = crate::test_dir::temp("writeup-name");
        let w = start(&root, "Taxes 2026", "Sort the receipts", at(14, 5)).unwrap();
        assert_eq!(w.path(), root.join("Taxes 2026").join("2026-11-19 1405 Sort the receipts.md"));
        let text = fs::read_to_string(w.path()).unwrap();
        assert!(text.starts_with("# Sort the receipts\n"), "{text}");
        assert!(text.contains("_Started 2026-11-19 14:05_"));
    }

    #[test]
    fn names_are_made_safe_for_windows() {
        assert_eq!(safe_name("a<b>c:d\"e/f\\g|h?i*j", "x"), "a-b-c-d-e-f-g-h-i-j");
        assert_eq!(safe_name("  report...  ", "x"), "report");
        assert_eq!(safe_name("two   spaces\there", "x"), "two spaces here");
        assert_eq!(safe_name("CON", "x"), "_CON");
        assert_eq!(safe_name("nul.txt", "x"), "_nul.txt");
        assert_eq!(safe_name("com3", "x"), "_com3");
        assert_eq!(safe_name("COM10", "x"), "COM10", "only COM1 to COM9 are devices");
        assert_eq!(safe_name("console", "x"), "console");
        assert_eq!(safe_name("...", "Chat"), "Chat");
        assert_eq!(safe_name("", "Folder"), "Folder");
        assert_eq!(safe_name(&"w".repeat(300), "x").chars().count(), NAME_MAX);
        let cut = safe_name(&format!("{}. ", "v".repeat(NAME_MAX - 1)), "x");
        assert!(!cut.ends_with(['.', ' ']), "{cut:?}");
        assert_eq!(safe_name("naïve 日本語", "x"), "naïve 日本語");
    }

    #[test]
    fn a_hostile_folder_and_title_stay_inside_the_history_folder() {
        let root = crate::test_dir::temp("writeup-hostile");
        let w = start(&root, "..\\..\\evil/", "..", at(9, 0)).unwrap();
        assert!(w.path().starts_with(&*root), "{:?}", w.path());
        assert_eq!(w.path().parent().unwrap().parent().unwrap(), &*root);
        let w2 = start(&root, "NUL", "AUX", at(9, 0)).unwrap();
        assert!(w2.path().starts_with(root.join("_NUL")), "{:?}", w2.path());
    }

    #[test]
    fn an_existing_file_is_never_overwritten() {
        let root = crate::test_dir::temp("writeup-counter");
        let a = start(&root, "F", "Same", at(8, 30)).unwrap();
        a.append_user("first").unwrap();
        let b = start(&root, "F", "Same", at(8, 30)).unwrap();
        let c = start(&root, "F", "Same", at(8, 30)).unwrap();
        assert!(b.path().file_name().unwrap().to_string_lossy().ends_with("Same (2).md"));
        assert!(c.path().file_name().unwrap().to_string_lossy().ends_with("Same (3).md"));
        assert!(fs::read_to_string(a.path()).unwrap().contains("first"));
        assert!(!fs::read_to_string(b.path()).unwrap().contains("first"));
    }

    #[test]
    fn appends_land_in_order() {
        let root = crate::test_dir::temp("writeup-append");
        let w = start(&root, "F", "Order", at(10, 0)).unwrap();
        w.append_user("How much did I spend?\n").unwrap();
        w.append_step("Read the budget sheet").unwrap();
        w.append_reply("You spent 120 on food.").unwrap();
        w.append_event("Saved your work", None).unwrap();
        w.append_event("Pull request opened", Some("https://example.test/pr/1")).unwrap();
        let text = fs::read_to_string(w.path()).unwrap();
        let at_of = |s: &str| text.find(s).unwrap_or_else(|| panic!("missing {s:?} in {text}"));
        let order = ["## You", "How much did I spend?", "- Read the budget sheet", "## Claude", "You spent 120", "**Saved your work**", "**Pull request opened:** https://example.test/pr/1"];
        for pair in order.windows(2) {
            assert!(at_of(pair[0]) < at_of(pair[1]), "{} before {}", pair[0], pair[1]);
        }
        let again = Writeup::open_existing(w.path().to_path_buf());
        again.append_user("one more").unwrap();
        assert!(fs::read_to_string(w.path()).unwrap().trim_end().ends_with("one more"));
    }

    #[test]
    fn the_transcript_is_copied_beside_the_write_up_and_restored_when_gone() {
        let root = crate::test_dir::temp("writeup-transcript");
        let claude = crate::test_dir::temp("writeup-transcript-claude");
        let src = claude.join("projects").join("p").join("abc.jsonl");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, "{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n").unwrap();
        let w = start(&root, "F", "Keep", at(11, 0)).unwrap();
        let copy = w.copy_transcript(&src).unwrap();
        assert_eq!(copy.parent(), w.path().parent());
        assert!(copy.file_name().unwrap().to_string_lossy().ends_with(".transcript.jsonl"));
        assert_eq!(fs::read(&copy).unwrap(), fs::read(&src).unwrap());
        // Claude deletes its own after 30 days.
        fs::remove_file(&src).unwrap();
        assert!(w.restore_transcript(&src).unwrap(), "the missing file is put back");
        assert_eq!(fs::read(&src).unwrap(), fs::read(&copy).unwrap());
        assert!(!w.restore_transcript(&src).unwrap(), "a file that is there is left alone");
        // A shorter file (cut off) is replaced by the longer copy; a longer one is kept.
        fs::write(&src, "x").unwrap();
        assert!(w.restore_transcript(&src).unwrap());
        fs::write(&src, "a much longer file than the kept copy has in it, so it is kept as it is").unwrap();
        assert!(!w.restore_transcript(&src).unwrap());
        // No copy kept: nothing to restore.
        let other = start(&root, "F", "Nothing", at(11, 1)).unwrap();
        assert!(!other.restore_transcript(&claude.join("gone.jsonl")).unwrap());
        assert!(!claude.join("gone.jsonl").exists());
    }

    #[test]
    fn the_folder_log_collects_lines() {
        let root = crate::test_dir::temp("writeup-folderlog");
        folder_log_at(&root, "F", "Started: Sort receipts", at(12, 0)).unwrap();
        folder_log(&root, "F", "Saved your work").unwrap();
        let text = fs::read_to_string(root.join("F").join(FOLDER_LOG)).unwrap();
        assert!(text.starts_with("# Folder log\n"));
        assert!(text.contains("- 2026-11-19 12:00 Started: Sort receipts\n"));
        assert!(text.trim_end().ends_with("Saved your work"));
        assert_eq!(text.matches("# Folder log").count(), 1);
    }

    #[test]
    fn past_chats_come_newest_first_and_skip_what_is_not_a_chat() {
        let root = crate::test_dir::temp("writeup-list");
        assert!(list_past_chats(&root, "Nope").is_empty());
        start(&root, "F", "Old one", datetime(2026, 11, 1, 9, 0, 0, 0)).unwrap();
        start(&root, "F", "Newest", datetime(2026, 11, 19, 23, 59, 0, 0)).unwrap();
        let mid = start(&root, "F", "Middle", datetime(2026, 11, 10, 8, 5, 0, 0)).unwrap();
        mid.copy_transcript(&mid.path().to_path_buf()).unwrap();
        folder_log(&root, "F", "a line").unwrap();
        fs::write(root.join("F").join("notes.md"), "mine").unwrap();
        fs::create_dir_all(root.join("F").join("2026-11-30 1200 a folder.md")).unwrap();
        let list = list_past_chats(&root, "F");
        let titles: Vec<&str> = list.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["Newest", "Middle", "Old one"]);
        assert_eq!(list[0].date, "2026-11-19 23:59");
        assert_eq!(list[1].date, "2026-11-10 08:05");
        assert!(list[2].path.is_file());
    }

    #[test]
    fn a_timestamp_becomes_a_local_date_and_time() {
        let d = civil_from_millis(1_800_000_000_000).unwrap();
        assert!(d.year() >= 2027);
        assert!(civil_from_millis(i64::MAX).is_none());
    }
}
