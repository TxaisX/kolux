//! A token nobody outside this machine can guess, for the app's own local channels: the hooks
//! endpoint, the terminal service and its window links, and each pane's key.

/// Two hashes seeded from the OS's randomness.
pub(crate) fn secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    let seed = std::collections::hash_map::RandomState::new();
    let mut h = seed.build_hasher();
    h.write_u64(u64::from(std::process::id()));
    format!("{:016x}{:016x}", h.finish(), std::collections::hash_map::RandomState::new().build_hasher().finish())
}
