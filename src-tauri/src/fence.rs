// ACCT-055: the app window reads and writes files only inside the user's projects and their
// worktrees, plus single files the user picked in Kolux's own Open a file dialog (granted
// exactly, never their folder). Network shares and drive roots are never a root, and every path
// is resolved through its links first, so a link inside a project cannot reach outside it.
use crate::git::Git;
use crate::state::Store;
use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// At most this many picked files are granted; the oldest grant goes first.
pub const GRANT_CAP: usize = 100;
/// Where the picked-file grants are kept, so a restored tab for a picked file opens again.
const KEY_GRANTS: &str = "file_grants";
/// ponytail: worktree folders are read from Git at most this often on a miss; a worktree added
/// outside Kolux opens after this delay at worst (one Kolux makes or removes re-reads at once).
const TREES_FRESH: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct Fence {
    grants: Mutex<VecDeque<PathBuf>>,
    /// When it was read, `git::worktree_changes()` then, and the worktree folders.
    trees: Mutex<Option<(Instant, u64, Vec<PathBuf>)>>,
    /// The paths of the latest drop from outside Kolux: the Explorer may copy these in.
    drop: Mutex<Vec<PathBuf>>,
}

/// A file that may be granted: on this computer, not a folder and not a drive root.
fn grantable(real: &Path) -> bool {
    !is_share(real) && !is_drive_root(real) && !real.is_dir()
}

/// A network share or a namespace path: `\\server\share`, `//server/share`, `\\?\UNC\...`, and
/// every other spelling that starts with two separators (the device namespace `\\.\` and the
/// verbatim `\\?\` ones, such as `\\.\UNC\host\share` or `\\?\GLOBALROOT\Device\Mup\host\share`,
/// which reach a share too) except a verbatim disk path such as `\\?\C:\...`. Decided from the
/// spelling alone, so a refused path is never resolved and its host never contacted (FIX-2).
fn is_share(p: &Path) -> bool {
    let s = p.to_string_lossy();
    let sep = |c: Option<char>| matches!(c, Some('\\' | '/'));
    let mut chars = s.chars();
    if sep(chars.next()) && sep(chars.next()) {
        return !matches!(p.components().next(), Some(Component::Prefix(x)) if matches!(x.kind(), Prefix::VerbatimDisk(..)));
    }
    matches!(p.components().next(), Some(Component::Prefix(x)) if matches!(x.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..)))
}

/// FIX-3 (council FIX-SOON 1): a full path on one of this computer's drives, `C:\...` or the
/// verbatim `\\?\C:\...`. Anything else (`\??\UNC\...`, `\??\GLOBALROOT\...`, a device path, a
/// share, the drive-relative `C:x`, the root-relative `\x`, a relative path) is refused from the
/// spelling, before anything resolves it, so Windows never hands it to the NT namespace.
#[cfg(windows)]
fn on_a_drive(p: &Path) -> bool {
    let mut parts = p.components();
    matches!(parts.next(), Some(Component::Prefix(x)) if matches!(x.kind(), Prefix::Disk(..) | Prefix::VerbatimDisk(..))) && matches!(parts.next(), Some(Component::RootDir))
}

#[cfg(not(windows))]
fn on_a_drive(p: &Path) -> bool {
    p.is_absolute()
}

fn is_drive_root(p: &Path) -> bool {
    p.parent().is_none()
}

/// The path with every link resolved; a file that does not exist yet resolves through its folder.
fn resolve(p: &Path) -> Option<PathBuf> {
    p.canonicalize().ok().or_else(|| Some(p.parent()?.canonicalize().ok()?.join(p.file_name()?)))
}

fn refused(p: &Path) -> String {
    format!("Kolux opens files only from your projects and their worktrees, or a file you picked: {} is outside them", p.display())
}

/// FIX-5 (council P2 P11): a `\\?\Volume{GUID}\` path is a local volume, not another computer, so the
/// refusal says to use the drive letter instead of blaming a share.
fn is_volume_guid(p: &Path) -> bool {
    // FIX-6 (council d2 AFTER 4): the device spelling `\\.\Volume{` is the same volume.
    p.to_string_lossy().get(..11).is_some_and(|h| {
        let h = h.replace('/', "\\");
        h.eq_ignore_ascii_case(r"\\?\Volume{") || h.eq_ignore_ascii_case(r"\\.\Volume{")
    })
}

fn share(p: &Path) -> String {
    if is_volume_guid(p) {
        return format!("Kolux opens files by their drive letter, not by a volume GUID path: {}", p.display());
    }
    format!("Kolux does not open files from other computers' shares: {}", p.display())
}

fn not_on_a_drive(p: &Path) -> String {
    format!("Kolux opens files only by their full path on this computer's drives, never from shares or device paths: {}", p.display())
}

/// `path` as given, so callers keep their own spelling rather than the long resolved form, once
/// its resolved form is inside one of `roots` or, with `exact` set, is one of the granted files.
pub fn check(path: &Path, roots: &[PathBuf], grants: &[PathBuf], exact: bool) -> Result<PathBuf, String> {
    if is_share(path) {
        return Err(share(path));
    }
    if !on_a_drive(path) {
        return Err(not_on_a_drive(path));
    }
    let real = resolve(path).ok_or_else(|| refused(path))?;
    if is_share(&real) {
        return Err(share(path));
    }
    let inside = roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| !is_share(&r) && !is_drive_root(&r) && real.starts_with(&r));
    let granted = exact && grants.contains(&real);
    if inside || granted {
        Ok(path.to_path_buf())
    } else {
        Err(refused(path))
    }
}

/// Why [`Fence::grant`] granted nothing, or not durably.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantError {
    /// The fence refused the path; nothing was granted.
    Refused(String),
    /// The grant is live in memory for this run, but the grants list could not be saved.
    SaveFailed(String),
}

impl std::fmt::Display for GrantError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (Self::Refused(m) | Self::SaveFailed(m)) = self;
        f.write_str(m)
    }
}

impl Fence {
    /// The grants an earlier run saved, each checked again (a file since deleted drops out); a
    /// damaged list grants nothing.
    pub fn load(store: &Mutex<Store>) -> Fence {
        let list: Vec<PathBuf> = store.lock().ok().map(|s| crate::orchestration::kept::or_default_held(&s, KEY_GRANTS)).unwrap_or_default();
        let mut grants: VecDeque<PathBuf> = list.into_iter().filter(|p| !is_share(p) && on_a_drive(p)).filter_map(|p| p.canonicalize().ok()).filter(|p| grantable(p) && p.to_str().is_some()).collect();
        while grants.len() > GRANT_CAP {
            grants.pop_front();
        }
        Fence { grants: Mutex::new(grants), ..Default::default() }
    }

    /// Grants one picked file exactly and saves the list; folders, drive roots and shares are never granted.
    /// `Refused`: nothing was granted. `SaveFailed`: the grant holds in memory this run, only the save failed.
    pub fn grant(&self, path: &Path, store: &Store) -> Result<(), GrantError> {
        if is_share(path) || !on_a_drive(path) {
            return Err(GrantError::Refused(not_on_a_drive(path)));
        }
        let real = path.canonicalize().map_err(|e| GrantError::Refused(format!("{}: {e}", path.display())))?;
        if !grantable(&real) {
            return Err(GrantError::Refused(refused(path)));
        }
        // A link can resolve to a name that is not valid Unicode; the saved list could not hold it.
        if real.to_str().is_none() {
            return Err(GrantError::Refused(format!("{} resolves to a name Kolux cannot save", path.display())));
        }
        let mut g = self.grants.lock().map_err(|e| GrantError::Refused(e.to_string()))?;
        g.retain(|x| *x != real);
        g.push_back(real);
        while g.len() > GRANT_CAP {
            g.pop_front();
        }
        let list = serde_json::to_string(&*g).map_err(|e| GrantError::SaveFailed(e.to_string()))?;
        store.set(KEY_GRANTS, &list).map_err(|e| GrantError::SaveFailed(e.to_string()))
    }

    /// Notes the paths of a drop from outside Kolux, in place of the last drop's.
    pub fn dropped(&self, paths: &[PathBuf]) {
        let real = paths.iter().filter(|p| !is_share(p) && on_a_drive(p)).filter_map(|p| p.canonicalize().ok()).filter(|p| !is_share(p) && !is_drive_root(p)).collect();
        if let Ok(mut d) = self.drop.lock() {
            *d = real;
        }
    }

    /// Whether `path` is one of the latest drop's paths.
    pub fn was_dropped(&self, path: &Path) -> bool {
        !is_share(path) && on_a_drive(path) && path.canonicalize().is_ok_and(|r| self.drop.lock().is_ok_and(|d| d.contains(&r)))
    }

    /// EDIT-034 copy: a source inside the fence, or one the user just dropped in from outside.
    pub fn allow_source(&self, path: &str, store: &Mutex<Store>, git: &Git) -> Result<PathBuf, String> {
        if self.was_dropped(Path::new(path)) {
            return Ok(PathBuf::from(path));
        }
        self.allow(path, store, git, false)
    }

    /// Every one of `paths` inside the fence (projects, worktrees), or the first refusal.
    pub fn allow_all<'a>(&self, paths: impl IntoIterator<Item = &'a String>, store: &Mutex<Store>, git: &Git) -> Result<(), String> {
        paths.into_iter().try_for_each(|p| self.allow(p, store, git, false).map(drop))
    }

    /// `check` against the projects in the store, then, on a miss, their worktrees too.
    pub fn allow(&self, path: &str, store: &Mutex<Store>, git: &Git, exact: bool) -> Result<PathBuf, String> {
        let projects = crate::projects::load_projects(&*store.lock().map_err(|e| e.to_string())?);
        let mut roots: Vec<PathBuf> = projects.iter().map(|p| PathBuf::from(&p.path)).collect();
        let grants: Vec<PathBuf> = self.grants.lock().map_err(|e| e.to_string())?.iter().cloned().collect();
        let path = Path::new(path);
        if let Ok(p) = check(path, &roots, &grants, exact) {
            return Ok(p);
        }
        let mut trees = self.trees.lock().map_err(|e| e.to_string())?;
        // The count is read before Git lists, so a worktree made meanwhile still forces a re-read.
        let changes = crate::git::worktree_changes();
        if !trees.as_ref().is_some_and(|(at, seen, _)| at.elapsed() < TREES_FRESH && *seen == changes) {
            let all = projects.iter().flat_map(|p| git.worktrees(Path::new(&p.path)).unwrap_or_default()).map(|w| PathBuf::from(w.path)).collect();
            *trees = Some((Instant::now(), changes, all));
        }
        roots.extend(trees.as_ref().map(|(_, _, t)| t.clone()).unwrap_or_default());
        check(path, &roots, &grants, exact)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn temp(name: &str) -> Temp {
        let d = std::env::temp_dir().join(format!("krs-fence-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("project/src")).unwrap();
        fs::create_dir_all(d.join("outside")).unwrap();
        fs::write(d.join("project/src/a.txt"), "a").unwrap();
        fs::write(d.join("outside/picked.txt"), "p").unwrap();
        fs::write(d.join("outside/other.txt"), "o").unwrap();
        Temp(d)
    }

    #[test]
    fn acct_055_files_outside_every_project_are_refused() {
        let t = temp("outside");
        let roots = [t.0.join("project")];
        assert!(check(&t.0.join("project/src/a.txt"), &roots, &[], true).is_ok());
        assert!(check(&t.0.join("project/src/new.md"), &roots, &[], true).is_ok(), "a new file inside a project can be saved");
        assert!(check(&t.0.join("outside/other.txt"), &roots, &[], true).is_err());
        assert!(check(&t.0.join("project/../outside/other.txt"), &roots, &[], true).is_err(), "dot-dot does not climb out");
        assert!(check(Path::new(r"\\server\share\x.txt"), &roots, &[], true).is_err());
        assert!(check(Path::new("//server/share/x.txt"), &roots, &[], true).is_err());
        let drive = t.0.ancestors().last().unwrap().to_path_buf();
        assert!(check(&t.0.join("outside/other.txt"), &[drive], &[], true).is_err(), "a drive root is never a root");
    }

    // FIX-2 (council FS-1): the device-namespace and verbatim spellings of a share are refused as
    // shares from the spelling, before anything resolves them (the old code canonicalized them, which
    // contacts the host, and only then said "outside"); a verbatim disk path still works.
    #[cfg(windows)]
    #[test]
    fn acct_055_namespace_spellings_of_a_share_are_refused_before_they_resolve() {
        let t = temp("namespace");
        let roots = [t.0.join("project")];
        for p in [
            r"\\.\UNC\kolux-none.invalid\share\p.txt",
            r"\\?\GLOBALROOT\Device\Mup\kolux-none.invalid\share\p.txt",
            r"\\?\UNC\kolux-none.invalid\share\p.txt",
            r"\/.\UNC\kolux-none.invalid\share\p.txt",
            r"\\.\C:\Windows\win.ini",
        ] {
            let err = check(Path::new(p), &roots, &[], true).unwrap_err();
            assert!(err.contains("shares"), "{p}: {err}");
        }
        // FIX-5: a local volume GUID path is refused too, but the words say drive letter, not share.
        let err = check(Path::new(r"\\?\Volume{00000000-0000-0000-0000-000000000000}\p.txt"), &roots, &[], true).unwrap_err();
        assert!(err.contains("drive letter") && !err.contains("shares"), "{err}");
        // FIX-6: and so is the device spelling of it.
        let err = check(Path::new(r"\\.\Volume{00000000-0000-0000-0000-000000000000}\p.txt"), &roots, &[], true).unwrap_err();
        assert!(err.contains("drive letter") && !err.contains("shares"), "{err}");
        let verbatim = t.0.join("project/src/a.txt").canonicalize().unwrap();
        assert!(verbatim.to_string_lossy().starts_with(r"\\?\"), "{}", verbatim.display());
        assert!(check(&verbatim, &roots, &[], true).is_ok(), "a verbatim disk path inside a project is fine");
    }

    // FIX-3 (council FIX-SOON 1): the NT spellings `\??\UNC\...` and `\??\GLOBALROOT\...` start with
    // one separator, carry no drive, and Windows passes them through to the NT namespace, so the old
    // two-separator test missed them and canonicalize contacted the host. Every path without a drive
    // (or a verbatim drive) is refused before anything resolves it, the drive-relative `C:x` and the
    // root-relative `\x` too; the refusal names shares, and the drive's own spellings still work.
    #[cfg(windows)]
    #[test]
    fn acct_055_a_path_without_a_drive_is_refused_before_it_resolves() {
        let t = temp("nodrive");
        let roots = [t.0.join("project")];
        for p in [
            r"\??\UNC\kolux-none.invalid\share\p.txt",
            r"\??\GLOBALROOT\Device\Mup\kolux-none.invalid\share\p.txt",
            r"\??\C:\Windows\win.ini",
            r"\Windows\win.ini",
            r"C:Windows\win.ini",
            r"relative\a.txt",
            "",
        ] {
            assert!(!on_a_drive(Path::new(p)), "{p}");
            let err = check(Path::new(p), &roots, &[], true).unwrap_err();
            assert!(err.contains("shares"), "{p}: {err}");
        }
        let plain = t.0.join("project/src/a.txt");
        assert!(on_a_drive(&plain) && on_a_drive(&plain.canonicalize().unwrap()));
        assert!(check(&plain, &roots, &[], true).is_ok());
        // the other doors that take a page's path: a drop and a grant never accept one either
        let f = Fence::default();
        f.dropped(&[PathBuf::from(r"\??\C:\Windows\win.ini")]);
        assert!(!f.was_dropped(Path::new(r"\??\C:\Windows\win.ini")));
        let store = Store::open(&t.0.join("data")).unwrap();
        assert!(f.grant(Path::new(r"\??\UNC\kolux-none.invalid\share\p.txt"), &store).is_err());
    }

    #[test]
    fn acct_055_a_picked_file_grants_only_itself() {
        let t = temp("grant");
        let store = Store::open(&t.0.join("data")).unwrap();
        let f = Fence::default();
        f.grant(&t.0.join("outside/picked.txt"), &store).unwrap();
        assert!(f.grant(&t.0.join("outside"), &store).is_err(), "a folder is never granted");
        let grants: Vec<PathBuf> = f.grants.lock().unwrap().iter().cloned().collect();
        let roots = [t.0.join("project")];
        assert!(check(&t.0.join("outside/picked.txt"), &roots, &grants, true).is_ok());
        assert!(check(&t.0.join("outside/other.txt"), &roots, &grants, true).is_err(), "the picked file's folder stays closed");
        assert!(check(&t.0.join("outside/picked.txt"), &roots, &grants, false).is_err(), "listing and diffs need a project");
        for i in 0..GRANT_CAP + 5 {
            let p = t.0.join(format!("outside/g{i}.txt"));
            fs::write(&p, "").unwrap();
            f.grant(&p, &store).unwrap();
        }
        assert_eq!(f.grants.lock().unwrap().len(), GRANT_CAP);
        assert!(!f.grants.lock().unwrap().contains(&t.0.join("outside/picked.txt").canonicalize().unwrap()), "the oldest grant went first");
    }

    // A valid-Unicode link that resolves to a non-Unicode name must not be granted: serde could not save it.
    #[cfg(windows)]
    #[test]
    fn row909_a_link_that_resolves_to_a_non_unicode_name_is_refused() {
        use std::os::windows::ffi::OsStringExt;
        let t = temp("nonunicode");
        let store = Store::open(&t.0.join("data")).unwrap();
        let f = Fence::default();
        let odd = t.0.join(std::ffi::OsString::from_wide(&[0x61, 0xD800, 0x2E, 0x64]));
        fs::create_dir_all(&odd).unwrap();
        fs::write(odd.join("f.txt"), "x").unwrap();
        let link = t.0.join("link");
        if let Err(e) = std::os::windows::fs::symlink_dir(&odd, &link) {
            eprintln!("skipped: symlink_dir needs developer mode or admin ({e})");
            return;
        }
        assert!(link.to_str().is_some());
        assert!(matches!(f.grant(&link.join("f.txt"), &store), Err(GrantError::Refused(_))));
        assert!(f.grants.lock().unwrap().is_empty(), "nothing was granted");
    }

    // A saved grant whose link now resolves to a non-Unicode name must drop out at load, or every later save fails.
    #[cfg(windows)]
    #[test]
    fn row914_load_drops_a_saved_grant_that_now_resolves_to_a_non_unicode_name() {
        use std::os::windows::ffi::OsStringExt;
        let t = temp("loadnonunicode");
        let store = Mutex::new(Store::open(&t.0.join("data")).unwrap());
        let odd = t.0.join(std::ffi::OsString::from_wide(&[0x61, 0xD800, 0x2E, 0x64]));
        fs::create_dir_all(&odd).unwrap();
        fs::write(odd.join("f.txt"), "x").unwrap();
        let link = t.0.join("link");
        if let Err(e) = std::os::windows::fs::symlink_dir(&odd, &link) {
            eprintln!("skipped: symlink_dir needs developer mode or admin ({e})");
            return;
        }
        store.lock().unwrap().set(KEY_GRANTS, &serde_json::json!([link.join("f.txt")]).to_string()).unwrap();
        let after = Fence::load(&store);
        assert!(after.grants.lock().unwrap().is_empty(), "the non-Unicode path was dropped");
        after.grant(&t.0.join("outside/picked.txt"), &store.lock().unwrap()).unwrap();
    }

    #[test]
    fn acct_055_picked_file_grants_are_kept_across_a_restart() {
        let t = temp("restart");
        let store = Mutex::new(Store::open(&t.0.join("data")).unwrap());
        let picked = t.0.join("outside/picked.txt");
        Fence::default().grant(&picked, &store.lock().unwrap()).unwrap();
        // the next run starts from what was saved: the picked file opens, its folder stays closed
        let after = Fence::load(&store);
        let grants: Vec<PathBuf> = after.grants.lock().unwrap().iter().cloned().collect();
        assert_eq!(grants, vec![picked.canonicalize().unwrap()]);
        // a saved list someone edited by hand: a folder, a share and a drive root are never let in
        let drive = t.0.ancestors().last().unwrap().to_string_lossy().into_owned();
        let edited = serde_json::json!([t.0.join("outside"), r"\\server\share\x.txt", drive, picked]).to_string();
        store.lock().unwrap().set(KEY_GRANTS, &edited).unwrap();
        let kept: Vec<PathBuf> = Fence::load(&store).grants.lock().unwrap().iter().cloned().collect();
        assert_eq!(kept, vec![picked.canonicalize().unwrap()], "the picked file, in the form a request is checked in");
        store.lock().unwrap().set(KEY_GRANTS, "not json").unwrap();
        assert!(Fence::load(&store).grants.lock().unwrap().is_empty(), "a damaged list grants nothing");
    }

    #[test]
    fn acct_055_only_the_files_of_the_latest_drop_may_be_copied_in_from_outside() {
        let t = temp("drop");
        let f = Fence::default();
        let (picked, other) = (t.0.join("outside/picked.txt"), t.0.join("outside/other.txt"));
        assert!(!f.was_dropped(&picked));
        f.dropped(std::slice::from_ref(&picked));
        assert!(f.was_dropped(&picked) && !f.was_dropped(&other), "a file next to a dropped one is not");
        f.dropped(std::slice::from_ref(&other));
        assert!(!f.was_dropped(&picked) && f.was_dropped(&other), "a new drop replaces the last one");
        f.dropped(&[PathBuf::from(r"\\server\share\x.txt")]);
        assert!(!f.was_dropped(Path::new(r"\\server\share\x.txt")), "never from a share");
    }

    #[cfg(windows)]
    #[test]
    fn acct_055_a_link_inside_a_project_does_not_reach_outside() {
        let t = temp("link");
        let link = t.0.join("project").join("link");
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(t.0.join("outside")).output().is_ok_and(|o| o.status.success());
        if !made {
            eprintln!("no junction made; link rule not checked");
            return;
        }
        assert!(check(&link.join("other.txt"), &[t.0.join("project")], &[], true).is_err());
        let _ = fs::remove_dir(&link);
    }

    #[test]
    fn row881_a_grants_list_that_could_not_be_kept_aside_is_never_saved_over() {
        let t = temp("poisoned");
        let db = t.0.join("data");
        let store = Mutex::new(Store::open(&db).unwrap());
        let broken = r#"["C:/picked.txt", tru"#;
        store.lock().unwrap().set(KEY_GRANTS, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&db);
        let f = Fence::load(&store);
        assert!(f.grants.lock().unwrap().is_empty(), "a damaged list grants nothing");
        let err = f.grant(&t.0.join("outside/picked.txt"), &store.lock().unwrap()).unwrap_err();
        assert!(matches!(err, GrantError::SaveFailed(_)), "the grant is live, only the save failed: {err:?}");
        let err = err.to_string();
        assert!(err.contains(KEY_GRANTS) && err.contains("not saving over it"), "{err}");
        assert_eq!(store.lock().unwrap().get(KEY_GRANTS).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
    }

    /// Row 898: every shape `grant` refuses, and the words it says; recorded on the old string error
    /// and kept after `grant` got a typed one, so the refusal set cannot drift.
    #[test]
    fn row898_every_shape_grant_refuses_stays_refused_with_the_same_words() {
        let t = temp("refused-shapes");
        let store = Store::open(&t.0.join("data")).unwrap();
        let f = Fence::default();
        let said = |p: &Path| {
            let e = f.grant(p, &store).unwrap_err();
            assert!(matches!(e, GrantError::Refused(_)), "{}: {e:?}", p.display());
            e.to_string()
        };
        // The first is root-relative (one backslash, no server); the next four are the real UNC and device spellings.
        for p in [r"\server\share\a.txt", r"\\server\share\a.txt", r"\\?\UNC\server\share\a.txt", r"\\.\C:\a.txt", r"\\?\GLOBALROOT\Device\x", "//server/share/a.txt", r"\??\UNC\kolux-none.invalid\share\p.txt", r"\??\C:\Windows\win.ini", r"C:Windows\win.ini", r"relative\a.txt", ""] {
            assert_eq!(said(Path::new(p)), not_on_a_drive(Path::new(p)), "{p}");
        }
        let gone = t.0.join("outside/gone.txt");
        let err = said(&gone);
        assert!(err.starts_with(&format!("{}: ", gone.display())), "{err}");
        for dir in [t.0.join("outside"), t.0.join("project"), t.0.ancestors().last().unwrap().to_path_buf()] {
            assert_eq!(said(&dir), refused(&dir), "{}", dir.display());
        }
        // outside every root is check's refusal, not grant's
        assert!(check(&t.0.join("outside/other.txt"), &[t.0.join("project")], &[], true).is_err());
        assert!(f.grants.lock().unwrap().is_empty());
        assert_eq!(store.get(KEY_GRANTS).unwrap(), None::<String>, "a refusal saves nothing");
        f.grant(&t.0.join("outside/picked.txt"), &store).unwrap();
        assert_eq!(f.grants.lock().unwrap().len(), 1, "the one shape that is let in");
    }

    /// A repository saved as the only project, with the Fence and Git that read it.
    fn project_repo(t: &Temp) -> (Mutex<Store>, PathBuf, Git) {
        let repo = t.0.join("project");
        let git = |args: &[&str]| crate::git::run(args, Some(&repo)).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@example.com"]);
        git(&["config", "user.name", "Kolux test"]);
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "first"]);
        let store = Mutex::new(Store::open(&t.0.join("data")).unwrap());
        let entry = crate::projects::Project { id: "p1".into(), name: "p".into(), path: repo.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None };
        crate::projects::save_projects(&store.lock().unwrap(), &[entry]).unwrap();
        (store, repo, Git::detect().unwrap())
    }

    // CLI-018 b2 (live proof 2026-10-27): a miss filled the worktree cache, then Kolux made a
    // worktree inside the cache's 3 s window and the Explorer was refused it.
    #[test]
    fn cli018_a_worktree_kolux_just_made_opens_at_once_after_an_earlier_miss() {
        let t = temp("fresh-worktree");
        let (store, repo, git) = project_repo(&t);
        let fence = Fence::default();
        let elsewhere = t.0.join("ws/a");
        git.worktree_add(&repo, &elsewhere, "a", "HEAD").unwrap();
        assert!(fence.allow(&elsewhere.to_string_lossy(), &store, &git, false).is_ok(), "the first worktree fills the cache");
        let made = t.0.join("ws/c");
        assert!(fence.allow(&made.to_string_lossy(), &store, &git, false).is_err(), "not made yet: a miss, cached");
        git.worktree_add(&repo, &made, "c", "HEAD").unwrap();
        let spelled = made.to_string_lossy().to_lowercase().replace('\\', "/");
        assert!(fence.allow(&made.to_string_lossy(), &store, &git, false).is_ok(), "made through Kolux, opened at once");
        assert!(fence.allow(&spelled, &store, &git, false).is_ok(), "the CLI's lowercase forward-slash spelling: {spelled}");
        git.worktree_remove(&repo, &made, Some("c")).unwrap();
        assert!(fence.allow(&made.to_string_lossy(), &store, &git, false).is_err(), "removed through Kolux: no longer a root");
    }

    #[test]
    fn cli018_a_path_outside_every_project_stays_refused_after_a_worktree_is_made() {
        let t = temp("fresh-worktree-outside");
        let (store, repo, git) = project_repo(&t);
        let fence = Fence::default();
        let outside = t.0.join("outside/other.txt");
        assert!(fence.allow(&outside.to_string_lossy(), &store, &git, false).is_err());
        git.worktree_add(&repo, &t.0.join("ws/c"), "c", "HEAD").unwrap();
        assert!(fence.allow(&outside.to_string_lossy(), &store, &git, false).is_err(), "a new worktree widens nothing else");
        assert!(fence.allow(&t.0.join("ws/c/../../outside/other.txt").to_string_lossy(), &store, &git, false).is_err(), "dot-dot out of a worktree");
    }
}
