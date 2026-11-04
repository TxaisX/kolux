//! spec/12 P0 boxes (batch 1): EDIT-001 and EDIT-003 file back end, on real files under the scratch
//! root (found from the home marker), folder edit12.

mod scratch_root;

use kolux_rs_lib::files::{read_text, stamp_of, text_hash, write_checked};
use std::path::{Path, PathBuf};

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    let base = scratch_root::root().join("edit12");
    let d = base.join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

#[test]
fn edit001_box1_save_puts_the_typed_character_on_disk() {
    let d = scratch("e1b1");
    let f = d.join("main.rs");
    std::fs::write(&f, "fn main() {}\n").unwrap();
    let loaded = read_text(&f).unwrap();
    let hash = text_hash(loaded.as_bytes());
    let typed = format!("x{loaded}");
    write_checked(&f, &typed, Some(&hash)).unwrap();
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "xfn main() {}\n");
    assert_eq!(read_text(&f).unwrap(), typed);
}

#[cfg(windows)]
#[test]
fn edit001_box4_an_unreadable_file_fails_then_loads_after_access_returns() {
    use std::os::windows::fs::OpenOptionsExt;
    let d = scratch("e1b4");
    let f = d.join("secret.txt");
    std::fs::write(&f, "hello there\n").unwrap();
    // An exclusive handle (share mode 0) stands in for removed read permission: opening for read is refused.
    let lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(&f).unwrap();
    let first = read_text(&f);
    assert!(first.is_err(), "reading a refused file must fail, got {first:?}");
    let second = read_text(&f);
    assert!(second.is_err(), "a second try (Retry) still fails while access is withheld");
    drop(lock);
    assert_eq!(read_text(&f).unwrap(), "hello there\n");
}

#[test]
fn edit003_box4_kolux_save_leaves_a_stable_stamp_that_an_outside_rewrite_changes() {
    let d = scratch("e3b4");
    let f = d.join("note.md");
    std::fs::write(&f, "one\n").unwrap();
    let hash = text_hash(b"one\n");
    write_checked(&f, "one\ntwo\n", Some(&hash)).unwrap();
    let after_save = stamp_of(&f).unwrap();
    assert_eq!(after_save.size, 8);
    assert_eq!(stamp_of(&f), Some(after_save), "nothing moved since Kolux's own save, so the check sees no change");
    std::fs::write(&f, "one\ntwo\nthree\n").unwrap(); // an agent's rewrite
    assert_ne!(stamp_of(&f), Some(after_save));
}

// ---- batch 2: EDIT-034 explorer file operations (scratch root edit12b) ----

use kolux_rs_lib::fsops::{copy_into, create, restore, trash_each};

fn scratch_b(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("edit12b").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

#[test]
fn edit034_box1_create_on_a_taken_name_is_refused_and_the_original_is_untouched() {
    let d = scratch_b("e34b1");
    std::fs::write(d.join("notes.txt"), "original text").unwrap();
    let err = create(&d, "notes.txt", false).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    let err = create(&d, "notes.txt", true).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(std::fs::read_to_string(d.join("notes.txt")).unwrap(), "original text");
    assert!(d.join("notes.txt").is_file());
    // a free name is created empty
    let made = create(&d, "fresh.txt", false).unwrap();
    assert_eq!(std::fs::read_to_string(made).unwrap(), "");
}

#[test]
fn edit034_box2_two_files_go_to_the_trash_in_one_call_and_undo_brings_both_back() {
    let d = scratch_b("e34b2");
    let tag = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let a = d.join(format!("cards-del-a-{tag}.txt"));
    let b = d.join(format!("cards-del-b-{tag}.txt"));
    std::fs::write(&a, "alpha body").unwrap();
    std::fs::write(&b, "beta body").unwrap();
    let paths = vec![a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned()];
    // one fs_trash call carries both selected paths
    let gone = trash_each(&paths, &[], &[]);
    assert_eq!(gone.len(), 2);
    for g in &gone {
        assert!(g.error.is_none(), "{:?}", g.error);
        assert!(!g.permanent, "scratch is not a WSL share, so this goes to the trash");
    }
    assert!(!a.exists() && !b.exists(), "both left the folder");
    // the undo call (fs_restore with the same paths)
    restore(&paths).unwrap();
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "alpha body");
    assert_eq!(std::fs::read_to_string(&b).unwrap(), "beta body");
}

#[test]
fn edit034_box3_a_dropped_folder_onto_one_that_holds_the_same_name_arrives_under_a_new_name() {
    let d = scratch_b("e34b3");
    let desk = d.join("desktop").join("proj");
    std::fs::create_dir_all(desk.join("sub")).unwrap();
    std::fs::write(desk.join("a.txt"), "from the desktop").unwrap();
    std::fs::write(desk.join("sub").join("b.txt"), "nested").unwrap();
    let target = d.join("tree").join("folder");
    std::fs::create_dir_all(target.join("proj")).unwrap();
    std::fs::write(target.join("proj").join("mine.txt"), "already here").unwrap();

    let (to, skipped) = copy_into(&desk, &target).unwrap();
    assert_eq!(skipped, 0);
    assert_eq!(to.file_name().unwrap().to_string_lossy(), "proj copy");
    assert_eq!(std::fs::read_to_string(to.join("a.txt")).unwrap(), "from the desktop");
    assert_eq!(std::fs::read_to_string(to.join("sub").join("b.txt")).unwrap(), "nested");
    // the folder that was already there is untouched, and the source is still whole
    assert_eq!(std::fs::read_to_string(target.join("proj").join("mine.txt")).unwrap(), "already here");
    assert!(!target.join("proj").join("a.txt").exists());
    assert_eq!(std::fs::read_to_string(desk.join("a.txt")).unwrap(), "from the desktop");
    // a second drop does not overwrite the first copy either
    let (again, _) = copy_into(&desk, &target).unwrap();
    assert_eq!(again.file_name().unwrap().to_string_lossy(), "proj copy 2");
}

// ---- batch 3: EDIT-045 (fence) and EDIT-053 (nothing launches) -------------------------------

use kolux_rs_lib::{fence, links};

fn scratch_c(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("edit12c").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn link_file(to: &Path, at: &Path) {
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(to, at).expect("this test needs permission to make a symlink (Developer Mode)");
    #[cfg(unix)]
    std::os::unix::fs::symlink(to, at).unwrap();
}

#[test]
fn edit045_box1_a_file_reached_through_a_symlink_that_points_outside_the_worktree_is_refused() {
    let base = scratch_c("fence1");
    let (project, outside) = (base.join("worktree"), base.join("outside"));
    std::fs::create_dir_all(project.join("src")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(project.join("src").join("a.txt"), "inside").unwrap();
    std::fs::write(outside.join("secret.txt"), "outside").unwrap();
    link_file(&outside.join("secret.txt"), &project.join("escape.txt"));
    link_file(&project.join("src").join("a.txt"), &project.join("stays.txt"));
    let escape = project.join("escape.txt");
    // the window's read gate (file_read -> fence::check) and the EDIT-045 fence both refuse the link
    let roots = vec![project.clone()];
    assert!(fence::check(&project.join("src").join("a.txt"), &roots, &[], false).is_ok(), "a plain file inside is fine");
    assert!(fence::check(&project.join("stays.txt"), &roots, &[], false).is_ok(), "a link that stays inside is fine");
    let err = fence::check(&escape, &roots, &[], false).unwrap_err();
    assert!(!err.is_empty());
    let text_roots = vec![project.to_string_lossy().into_owned()];
    let none = std::collections::HashSet::new();
    let err = links::fence(&escape.to_string_lossy(), &text_roots, &none, true).unwrap_err();
    assert!(err.contains("through a link"), "{err}");
    assert!(links::fence(&project.join("stays.txt").to_string_lossy(), &text_roots, &none, true).is_ok());
    // the file really is readable by the OS, so the refusal is the fence's doing, not a missing target
    assert_eq!(std::fs::read_to_string(&escape).unwrap(), "outside");
}

#[test]
fn edit045_box2_a_terminal_link_to_a_file_on_another_computers_share_is_refused_without_a_lookup() {
    let base = scratch_c("fence2");
    let roots = vec![base.to_string_lossy().into_owned()];
    // the targets a terminal link yields: a UNC path as printed, and a file:// URL turned into one (links.ts fromFileUrl)
    let targets = [r"\\kolux-no-such-host.invalid\share\doc.md", r"\\kolux-no-such-host.invalid\share\sub\..\doc.md", "//kolux-no-such-host.invalid/share/doc.md", r"\\?\UNC\kolux-no-such-host.invalid\share\doc.md", "file://kolux-no-such-host.invalid/share/doc.md"];
    let none = std::collections::HashSet::new();
    let started = std::time::Instant::now();
    for t in targets {
        let e = links::refuse_host(t, &roots).err().unwrap_or_else(|| panic!("{t} was not refused"));
        assert!(e.contains("another computer"), "{t}: {e}");
        let e = links::fence(t, &roots, &none, true).err().unwrap_or_else(|| panic!("{t} was not fenced"));
        assert!(e.contains("another computer"), "{t}: {e}");
        if !t.starts_with("file:") {
            assert!(fence::check(Path::new(t), std::slice::from_ref(&base), &[], true).is_err(), "{t}");
        }
    }
    // an SMB or DNS lookup for a host that does not exist takes seconds; text-only refusal takes microseconds
    assert!(started.elapsed() < std::time::Duration::from_secs(1), "refusals took {:?}", started.elapsed());
}

#[test]
fn edit053_box1_and_3_programs_scripts_and_shortcuts_are_launchable_and_documents_are_not() {
    let d = scratch_c("launch");
    for name in ["run.bat", "RUN.CMD", "script.ps1", "tool.exe", "Tool.EXE", "link.lnk", "setup.msi", "tool.exe.", "tool.exe . ."] {
        let f = d.join(name);
        if std::fs::write(&f, "echo hi").is_ok() {
            assert!(links::launchable(&f), "{name} must be revealed, not run");
        }
        assert!(links::launchable(&d.join(name)), "{name} (by name)");
    }
    for name in ["notes.txt", "readme.md", "report.docx", "photo.png", "a.exe.txt"] {
        let f = d.join(name);
        std::fs::write(&f, "text").unwrap();
        assert!(!links::launchable(&f), "{name} opens in its default app");
    }
}

#[test]
fn edit053_box4_a_link_to_a_file_on_another_computer_is_refused_before_anything_is_handed_to_the_system() {
    let d = scratch_c("remote");
    let roots = vec![d.to_string_lossy().into_owned()];
    for t in [r"\\kolux-no-such-host.invalid\share\a.txt", "file://kolux-no-such-host.invalid/share/a.txt", r"\\kolux-no-such-host.invalid\share\run.bat"] {
        let e = links::refuse_host(t, &roots).err().unwrap_or_else(|| panic!("{t} was not refused")); // open_path's first line
        assert!(e.contains("another computer"), "{t}: {e}");
    }
    // and a local link of the same kind is not refused
    assert!(links::refuse_host(&d.join("a.txt").to_string_lossy(), &roots).is_ok());
}

#[test]
fn edit053_box1_a_program_like_file_is_revealed_never_opened() {
    let d = scratch_c("choice-program");
    for base in ["run.bat", "script.ps1", "tool.exe", "link.lnk"] {
        for name in [base.to_string(), base.to_uppercase(), format!("{base}.")] {
            // Windows strips trailing dots when it creates a file; the dotted spelling then names the plain file.
            std::fs::write(d.join(&name), "echo hi").unwrap();
            let path = d.join(&name).to_string_lossy().into_owned();
            assert_eq!(links::open_choice(&path), Ok(links::OpenChoice::Reveal), "{name}");
        }
    }
}

#[test]
fn edit053_box1_trailing_dots_and_spaces_still_count_as_programs() {
    let d = scratch_c("choice-trailing");
    for name in ["run.bat ", "run.bat . .", "script.ps1.", "tool.exe ", "link.lnk .", "RUN.BAT."] {
        // A trailing space cannot be told apart on disk, so the spelling itself is judged.
        assert!(links::launchable(&d.join(name)), "{name:?} must be revealed, not run");
    }
}

#[test]
fn edit053_box3_a_plain_text_file_is_opened_in_its_app() {
    let d = scratch_c("choice-text");
    let f = d.join("notes.txt");
    std::fs::write(&f, "text").unwrap();
    assert_eq!(links::open_choice(&f.to_string_lossy()), Ok(links::OpenChoice::Open));
}

#[test]
fn edit053_open_choice_refuses_a_relative_path_and_a_non_file() {
    let d = scratch_c("choice-refuse");
    assert_eq!(links::open_choice("run.bat"), Err("run.bat is not a full path".to_string()));
    let missing = d.join("missing.bat").to_string_lossy().into_owned();
    assert_eq!(links::open_choice(&missing), Err(format!("{missing} is not a file")));
    let dir = d.to_string_lossy().into_owned();
    assert_eq!(links::open_choice(&dir), Err(format!("{dir} is not a file")));
}
