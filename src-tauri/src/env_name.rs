//! Kolux's own environment variables (`KOLUX_<X>`), read with a fallback to the name they had
//! before the rename to Kolux (`KOLUX_RS_<X>`), so a machine or build script that still sets the
//! old name keeps working. The new name wins when both are set.

use std::ffi::OsString;

/// The prefix the variables carried before the rename.
const LEGACY_PREFIX: &str = "KOLUX_RS_";

/// The old name of `name` (`KOLUX_X` gives `KOLUX_RS_X`), when it is one of Kolux's.
fn legacy(name: &str) -> Option<String> {
    name.strip_prefix("KOLUX_").map(|rest| format!("{LEGACY_PREFIX}{rest}"))
}

/// `name`'s value from `get`, else its old name's.
pub fn pick<T>(name: &str, get: impl Fn(&str) -> Option<T>) -> Option<T> {
    get(name).or_else(|| legacy(name).and_then(|old| get(&old)))
}

/// `std::env::var` with the old-name fallback.
pub fn var(name: &str) -> Option<String> {
    pick(name, |n| std::env::var(n).ok())
}

/// `std::env::var_os` with the old-name fallback.
pub fn var_os(name: &str) -> Option<OsString> {
    pick(name, |n| std::env::var_os(n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn rename_the_old_name_is_read_when_the_new_one_is_unset() {
        let env: HashMap<&str, &str> = [("KOLUX_RS_UPDATE_COMPAT", "1")].into();
        let get = |n: &str| env.get(n).map(|v| v.to_string());
        assert_eq!(pick("KOLUX_UPDATE_COMPAT", get).as_deref(), Some("1"));
        let both: HashMap<&str, &str> = [("KOLUX_RS_X", "old"), ("KOLUX_X", "new")].into();
        assert_eq!(pick("KOLUX_X", |n: &str| both.get(n).map(|v| v.to_string())).as_deref(), Some("new"), "the new name wins");
        assert_eq!(pick("KOLUX_Y", |n: &str| env.get(n).map(|v| v.to_string())), None);
        assert_eq!(pick("OTHER", |n: &str| (n == "KOLUX_RS_OTHER").then(|| "x".to_string())), None, "only Kolux's own names fall back");
    }
}
