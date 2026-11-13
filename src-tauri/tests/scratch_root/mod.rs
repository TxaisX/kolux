//! The scratch root the cards proofs run under, found from the redirected home instead of a fixed path.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MARKER: &str = ".kolux-scratch";
/// The marker's name before the rename; a scratch root a not-yet-updated script made still counts.
pub const LEGACY_MARKER: &str = ".kolux-rs-scratch";

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn within(path: &Path, root: &Path) -> bool {
    let (p, r) = (norm(path), norm(root));
    p == r || p.starts_with(&format!("{r}/"))
}

/// The nearest folder above `home` that holds the marker file; `home` itself is not a candidate.
pub fn resolve_from(home: &Path) -> Result<PathBuf, String> {
    let found = home.ancestors().skip(1).filter(|a| a.parent().is_some()).find(|a| a.join(MARKER).is_file() || a.join(LEGACY_MARKER).is_file());
    found.map(Path::to_path_buf).ok_or_else(|| format!("no {MARKER} marker in any folder above {home:?}; create one in the scratch root that holds the home"))
}

/// Why `root` would be (or hold) the user's real home, if it would.
pub fn real_home_conflict(root: &Path, real_home: Option<&Path>) -> Option<String> {
    let home = real_home?;
    (within(home, root)).then(|| format!("scratch root {root:?} is or contains the real home {home:?}"))
}

fn real_home() -> Option<PathBuf> {
    let (drive, path) = (std::env::var_os("HOMEDRIVE")?, std::env::var_os("HOMEPATH")?);
    let mut home = drive;
    home.push(path);
    Some(PathBuf::from(home))
}

/// The scratch root, after checking all four redirected homes sit under it and it is not the real home.
pub fn root() -> &'static Path {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let profile = std::env::var("USERPROFILE").unwrap_or_default();
        assert!(!profile.is_empty(), "USERPROFILE must point into a scratch folder");
        let root = resolve_from(Path::new(&profile)).unwrap_or_else(|e| panic!("{e}"));
        for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
            let v = std::env::var(var).unwrap_or_default();
            assert!(!v.is_empty() && within(Path::new(&v), &root), "{var} must point under the scratch root {root:?}, not {v}");
        }
        if let Some(why) = real_home_conflict(&root, real_home().as_deref()) {
            panic!("{why}");
        }
        root
    })
}
