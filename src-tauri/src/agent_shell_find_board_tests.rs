//! PERF-01 board tests (locked): a shell program looked up once is remembered across pane starts.
//! Declared from agent_shell.rs as `mod find_board_tests`; reaches the new items through `super::`.

use super::{path_stamp, search_key_of, ProgramMemo};
use std::cell::{Cell, RefCell};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

fn pwsh() -> PathBuf {
    PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe")
}

fn stamp(s: &'static str) -> impl Fn() -> String {
    move || s.to_string()
}

/// A1: ten starts with the same search path walk it once; every start gets the same answer.
#[test]
fn ten_starts_with_the_same_search_path_walk_it_once() {
    fn shared<T: Send + Sync>() {}
    shared::<ProgramMemo>();
    let memo = ProgramMemo::new();
    let searches = Cell::new(0u32);
    for _ in 0..10 {
        let got = memo.find("key-1", "pwsh.exe", |n| {
            assert_eq!(n, "pwsh.exe", "the search is asked for the name given");
            searches.set(searches.get() + 1);
            Some(pwsh())
        }, |_| true, stamp("s1"));
        assert_eq!(got, Some(pwsh()));
    }
    assert_eq!(searches.get(), 1, "the PATH walk ran once for ten starts");
}

/// A2: a remembered program is checked before use; one that is gone is searched for again and the
/// new answer replaces it.
#[test]
fn a_remembered_program_that_is_gone_is_searched_for_again() {
    let memo = ProgramMemo::new();
    let searches = Cell::new(0u32);
    let moved = PathBuf::from(r"D:\tools\pwsh\pwsh.exe");
    assert_eq!(memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(pwsh()) }, |_| true, stamp("s")), Some(pwsh()));
    let checked = RefCell::new(Vec::<PathBuf>::new());
    let got = memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(moved.clone()) }, |p: &Path| {
        checked.borrow_mut().push(p.to_path_buf());
        false
    }, stamp("s"));
    assert_eq!(got, Some(moved.clone()), "the fresh search's answer is used, not the stale one");
    assert_eq!(searches.get(), 2);
    assert!(checked.borrow().contains(&pwsh()), "the remembered path was the one checked: {:?}", checked.borrow());
    let got = memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); None }, |_| true, stamp("s"));
    assert_eq!(got, Some(moved));
    assert_eq!(searches.get(), 2, "the replacement is remembered");
}

/// A2b: a remembered program that is gone, and found nowhere now, is reported as not found (never the stale path).
#[test]
fn a_program_uninstalled_since_is_not_found() {
    let memo = ProgramMemo::new();
    memo.find("k", "pwsh.exe", |_| Some(pwsh()), |_| true, stamp("s"));
    assert_eq!(memo.find("k", "pwsh.exe", |_| None, |_| false, stamp("s")), None);
    let searches = Cell::new(0u32);
    assert_eq!(memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(pwsh()) }, |_| true, stamp("s")), None, "the miss now stands");
    assert_eq!(searches.get(), 0, "and is remembered while the folders are unchanged");
}

/// A3: a changed search path (another key) searches again, for a remembered hit and a remembered miss.
#[test]
fn a_changed_search_path_searches_again() {
    let memo = ProgramMemo::new();
    let searches = Cell::new(0u32);
    let other = PathBuf::from(r"C:\Other\pwsh.exe");
    assert_eq!(memo.find("path-a", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(pwsh()) }, |_| true, stamp("s")), Some(pwsh()));
    assert_eq!(memo.find("path-b", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(other.clone()) }, |_| true, stamp("s")), Some(other.clone()));
    assert_eq!(searches.get(), 2, "the new path was searched");
    assert_eq!(memo.find("path-b", "pwsh.exe", |_| { searches.set(searches.get() + 1); None }, |_| true, stamp("s")), Some(other));
    assert_eq!(searches.get(), 2, "and its answer is remembered under the new path");
    // A miss is tied to its search path too.
    assert_eq!(memo.find("path-b", "wsl.exe", |_| { searches.set(searches.get() + 1); None }, |_| true, stamp("s")), None);
    assert_eq!(memo.find("path-c", "wsl.exe", |_| { searches.set(searches.get() + 1); Some(PathBuf::from(r"C:\w\wsl.exe")) }, |_| true, stamp("s")), Some(PathBuf::from(r"C:\w\wsl.exe")));
    assert_eq!(searches.get(), 4, "a new path searches past a remembered miss");
}

/// A4: "not found" is remembered only while the folders' stamp is unchanged: a program installed
/// later (a folder on the path changed) is found by the next start.
#[test]
fn not_found_is_remembered_only_while_the_folders_are_unchanged() {
    let memo = ProgramMemo::new();
    let searches = Cell::new(0u32);
    for _ in 0..3 {
        assert_eq!(memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); None }, |_| true, stamp("before")), None);
    }
    assert_eq!(searches.get(), 1, "three starts without pwsh walk the path once");
    assert_eq!(memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); Some(pwsh()) }, |_| true, stamp("after")), Some(pwsh()), "installed later: found");
    assert_eq!(searches.get(), 2);
    assert_eq!(memo.find("k", "pwsh.exe", |_| { searches.set(searches.get() + 1); None }, |_| true, stamp("later-still")), Some(pwsh()));
    assert_eq!(searches.get(), 2, "a hit is remembered whatever the stamp; it is checked with still_there instead");
}

/// A4b: the stamp is only asked for when a miss is in play: a remembered hit never pays for it.
#[test]
fn a_remembered_hit_never_asks_for_the_stamp() {
    let memo = ProgramMemo::new();
    memo.find("k", "pwsh.exe", |_| Some(pwsh()), |_| true, stamp("s"));
    let asked = Cell::new(0u32);
    for _ in 0..5 {
        let got = memo.find("k", "pwsh.exe", |_| None, |_| true, || {
            asked.set(asked.get() + 1);
            "s".to_string()
        });
        assert_eq!(got, Some(pwsh()));
    }
    assert_eq!(asked.get(), 0, "the folder stamp is not computed for a hit");
}

/// A5: each name is remembered on its own: interleaved asks for three shells search each once.
#[test]
fn each_name_is_remembered_on_its_own() {
    let memo = ProgramMemo::new();
    let asked = RefCell::new(Vec::<String>::new());
    let path_of = |n: &str| PathBuf::from(format!(r"C:\bin\{n}"));
    for _ in 0..4 {
        for name in ["pwsh.exe", "powershell.exe", "wsl.exe"] {
            let got = memo.find("k", name, |n| {
                asked.borrow_mut().push(n.to_string());
                Some(path_of(n))
            }, |_| true, stamp("s"));
            assert_eq!(got, Some(path_of(name)), "{name} gets its own answer");
        }
    }
    let mut asked = asked.into_inner();
    asked.sort();
    assert_eq!(asked, vec!["powershell.exe", "pwsh.exe", "wsl.exe"], "each name searched once");
}

/// A5b: names are told apart exactly as given (no answer leaks between two names).
#[test]
fn a_hit_for_one_name_is_not_an_answer_for_another() {
    let memo = ProgramMemo::new();
    memo.find("k", "pwsh.exe", |_| Some(pwsh()), |_| true, stamp("s"));
    assert_eq!(memo.find("k", "wsl.exe", |_| None, |_| true, stamp("s")), None);
    assert_eq!(memo.find("k", "pwsh", |_| None, |_| true, stamp("s")), None);
}

/// A6: the key of a search path changes when any of its inputs changes, including when text only
/// moves from one input to the next.
#[test]
fn the_search_key_follows_every_input() {
    let base = search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), Some(r"C:\u"), Some(".COM;.EXE"));
    assert_eq!(base, search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), Some(r"C:\u"), Some(".COM;.EXE")), "same inputs, same key");
    let changed = [
        search_key_of(Some(OsStr::new(r"C:\a;C:\b;C:\new")), Some(r"C:\Windows"), Some(r"C:\u"), Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows;C:\x"), Some(r"C:\u"), Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), Some(r"C:\u;C:\Tools"), Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), Some(r"C:\u"), Some(".COM;.EXE;.PS1")),
        search_key_of(None, Some(r"C:\Windows"), Some(r"C:\u"), Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), None, Some(r"C:\u"), Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), None, Some(".COM;.EXE")),
        search_key_of(Some(OsStr::new(r"C:\a;C:\b")), Some(r"C:\Windows"), Some(r"C:\u"), None),
    ];
    for (i, k) in changed.iter().enumerate() {
        assert_ne!(*k, base, "input change {i} must change the key");
    }
    assert_ne!(search_key_of(None, Some("ab"), Some("c"), None), search_key_of(None, Some("a"), Some("bc"), None));
    assert_ne!(search_key_of(None, Some("x"), None, None), search_key_of(None, None, Some("x"), None));
    assert_ne!(search_key_of(Some(OsStr::new("x")), None, None, None), search_key_of(None, None, None, Some("x")));
}

/// A6b: the folder stamp is stable for unchanged folders and tells a missing folder from an existing one.
#[test]
fn the_folder_stamp_is_stable_and_sees_a_folder_appear() {
    let root = std::env::temp_dir().join(format!("kolux-perf01-stamp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("a")).unwrap();
    let dirs = vec![root.join("a"), root.join("b")];
    let first = path_stamp(&dirs);
    assert_eq!(first, path_stamp(&dirs), "nothing changed, same stamp");
    std::fs::create_dir_all(root.join("b")).unwrap();
    assert_ne!(first, path_stamp(&dirs), "a folder that appeared changes the stamp");
    assert_ne!(path_stamp(&[root.join("a")]), path_stamp(&[root.join("a"), root.join("a")]), "every folder counts, in order");
    let _ = std::fs::remove_dir_all(&root);
}

/// A7: the remembered lookup answers what the plain lookup answers, on this machine, every time.
#[test]
fn find_shell_answers_what_find_program_answers() {
    for name in ["cargo", "no-such-program-perf01-board"] {
        let plain = crate::agents::find_program(name);
        assert_eq!(super::find_shell(name), plain, "first ask for {name}");
        assert_eq!(super::find_shell(name), plain, "second ask for {name}");
    }
    assert!(super::find_shell("no-such-program-perf01-board").is_none());
    assert_eq!(super::search_key(), super::search_key(), "the live key is stable while nothing changes");
}
