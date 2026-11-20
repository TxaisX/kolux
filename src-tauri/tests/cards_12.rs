//! spec/12 P0 boxes: the file back end on real files under the scratch root (found from the home
//! marker).

mod scratch_root;

use std::path::{Path, PathBuf};

// ---- batch 3: EDIT-045 (fence) and EDIT-053 (nothing launches) -------------------------------

use kolux_lib::{fence, links};

fn scratch_c(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("edit12c").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-scratch"), "").unwrap();
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
    // the window's read gate (fence::check) and the EDIT-045 fence both refuse the link
    let roots = vec![project.clone()];
    assert!(fence::check(&project.join("src").join("a.txt"), &roots, &[], false).is_ok(), "a plain file inside is fine");
    assert!(fence::check(&project.join("stays.txt"), &roots, &[], false).is_ok(), "a link that stays inside is fine");
    let err = fence::check(&escape, &roots, &[], false).unwrap_err();
    assert!(!err.is_empty());
    let text_roots = vec![project.to_string_lossy().into_owned()];
    let err = links::fence(&escape.to_string_lossy(), &text_roots).unwrap_err();
    assert!(err.contains("through a link"), "{err}");
    assert!(links::fence(&project.join("stays.txt").to_string_lossy(), &text_roots).is_ok());
    // the file really is readable by the OS, so the refusal is the fence's doing, not a missing target
    assert_eq!(std::fs::read_to_string(&escape).unwrap(), "outside");
}

#[test]
fn edit045_box2_a_terminal_link_to_a_file_on_another_computers_share_is_refused_without_a_lookup() {
    let base = scratch_c("fence2");
    let roots = vec![base.to_string_lossy().into_owned()];
    // the targets a terminal link yields: a UNC path as printed, and a file:// URL turned into one (links.ts fromFileUrl)
    let targets = [r"\\kolux-no-such-host.invalid\share\doc.md", r"\\kolux-no-such-host.invalid\share\sub\..\doc.md", "//kolux-no-such-host.invalid/share/doc.md", r"\\?\UNC\kolux-no-such-host.invalid\share\doc.md", "file://kolux-no-such-host.invalid/share/doc.md"];
    let started = std::time::Instant::now();
    for t in targets {
        let e = links::refuse_host(t, &roots).err().unwrap_or_else(|| panic!("{t} was not refused"));
        assert!(e.contains("another computer"), "{t}: {e}");
        let e = links::fence(t, &roots).err().unwrap_or_else(|| panic!("{t} was not fenced"));
        assert!(e.contains("another computer"), "{t}: {e}");
        if !t.starts_with("file:") {
            assert!(fence::check(Path::new(t), std::slice::from_ref(&base), &[], true).is_err(), "{t}");
        }
    }
    // an SMB or DNS lookup for a host that does not exist takes seconds; text-only refusal takes microseconds
    assert!(started.elapsed() < std::time::Duration::from_secs(1), "refusals took {:?}", started.elapsed());
}

#[test]
fn edit053_box1_and_3_programs_scripts_and_shortcuts_are_revealed_and_documents_are_opened() {
    let d = scratch_c("launch");
    for name in ["run.bat", "RUN.CMD", "script.ps1", "tool.exe", "Tool.EXE", "link.lnk", "setup.msi", "tool.exe.", "tool.exe . ."] {
        let f = d.join(name);
        if std::fs::write(&f, "echo hi").is_ok() {
            assert_eq!(links::open_choice(&f.to_string_lossy()), Ok(links::OpenChoice::Reveal), "{name} must be revealed, not run");
        }
        assert!(!links::document(&d.join(name)), "{name} (by name)");
    }
    // wave 2: only a known document type is opened; an Office file (report.docx) is revealed too
    let report = d.join("report.docx");
    std::fs::write(&report, "text").unwrap();
    assert_eq!(links::open_choice(&report.to_string_lossy()), Ok(links::OpenChoice::Reveal), "report.docx");
    for name in ["notes.txt", "readme.md", "photo.png", "a.exe.txt"] {
        let f = d.join(name);
        std::fs::write(&f, "text").unwrap();
        assert_eq!(links::open_choice(&f.to_string_lossy()), Ok(links::OpenChoice::Open), "{name} opens in its default app");
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
        assert!(!links::document(&d.join(name)), "{name:?} must be revealed, not run");
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
