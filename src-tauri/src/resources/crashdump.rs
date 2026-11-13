//! T-286-b (APP-040): when a crash dump exists, the report names the module that faulted.
//!
//! The interface's browser engine writes a minidump for each of its processes that crashes. This
//! reads only the two streams the report needs, per Microsoft's published minidump layout
//! (minidumpapiset.h): the exception stream (code and faulting address) and the module list (which
//! loaded module holds that address). Only the module's file name is kept, never its folder, so a
//! report carries no user path. Anything malformed reads as "no module" rather than an error.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const SIGNATURE: u32 = 0x504d_444d; // "MDMP"
const MODULE_LIST: u32 = 4;
const EXCEPTION: u32 = 6;
const MODULE_SIZE: usize = 108;
/// The engine's own folder under the webview data folder where crash dumps land.
pub const DUMP_FOLDER: &str = "EBWebView/Crashpad";

/// What a dump says about its crash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fault {
    pub code: u32,
    pub address: u64,
    /// The file name of the module holding the faulting address, when one does.
    pub module: Option<String>,
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    let lo = u32_at(b, at)? as u64;
    let hi = u32_at(b, at + 4)? as u64;
    Some(lo | (hi << 32))
}

/// A MINIDUMP_STRING: a byte length, then UTF-16. Only the file name after the last separator.
fn name_at(b: &[u8], rva: usize) -> Option<String> {
    let len = u32_at(b, rva)? as usize;
    let raw = b.get(rva + 4..rva + 4 + len)?;
    let units: Vec<u16> = (0..raw.len() / 2).map(|i| u16::from_le_bytes([raw[2 * i], raw[2 * i + 1]])).collect();
    let full = String::from_utf16_lossy(&units);
    let file = full.rsplit(['\\', '/']).next().unwrap_or(&full).trim().to_string();
    (!file.is_empty()).then_some(file)
}

/// Reads the faulting code, address and module out of a minidump's bytes.
pub fn fault(b: &[u8]) -> Option<Fault> {
    if u32_at(b, 0)? != SIGNATURE {
        return None;
    }
    let streams = u32_at(b, 8)? as usize;
    let dir = u32_at(b, 12)? as usize;
    let (mut exc, mut mods) = (None, None);
    for i in 0..streams.min(4096) {
        let at = dir + i * 12;
        match u32_at(b, at)? {
            EXCEPTION => exc = Some(u32_at(b, at + 8)? as usize),
            MODULE_LIST => mods = Some(u32_at(b, at + 8)? as usize),
            _ => {}
        }
    }
    // MINIDUMP_EXCEPTION_STREAM: thread id, alignment, then MINIDUMP_EXCEPTION (code, flags, record, address).
    let exc = exc?;
    let code = u32_at(b, exc + 8)?;
    let address = u64_at(b, exc + 24)?;
    let module = mods.and_then(|m| {
        let count = u32_at(b, m)? as usize;
        (0..count.min(65_536)).find_map(|i| {
            let at = m + 4 + i * MODULE_SIZE;
            let base = u64_at(b, at)?;
            let size = u32_at(b, at + 8)? as u64;
            (address >= base && address < base.saturating_add(size)).then(|| name_at(b, u32_at(b, at + 20)? as usize)).flatten()
        })
    });
    Some(Fault { code, address, module })
}

/// The plain words for the common exception codes, else the code in hex.
pub fn code_text(code: u32) -> String {
    let word = match code {
        0xC000_0005 => " (access violation)",
        0xC000_00FD => " (stack overflow)",
        0xC000_0409 => " (security check failure)",
        0xC000_001D => " (illegal instruction)",
        0xC000_0094 => " (integer divide by zero)",
        0xC000_0017 | 0xE000_0008 => " (out of memory)",
        0x8000_0003 => " (breakpoint)",
        _ => "",
    };
    format!("0x{code:08X}{word}")
}

/// One dump file on disk: its name (the store's key) and when it was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dump {
    pub name: String,
    pub path: PathBuf,
    pub when: u64,
}

/// Every `.dmp` file under `root` (the engine keeps them one or two folders down), oldest first.
pub fn dumps(root: &Path) -> Vec<Dump> {
    let mut out = Vec::new();
    let mut dirs = vec![(root.to_path_buf(), 0)];
    while let Some((d, depth)) = dirs.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_dir() {
                if depth < 2 {
                    dirs.push((p, depth + 1));
                }
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("dmp")) {
                let when = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                out.push(Dump { name: e.file_name().to_string_lossy().into_owned(), path: p, when });
            }
        }
    }
    out.sort_by(|a, b| (a.when, &a.name).cmp(&(b.when, &b.name)));
    out
}

/// What a dump file says about its crash; files over 64 MB are not read.
pub fn fault_of(path: &Path) -> Option<Fault> {
    if fs::metadata(path).ok()?.len() > 64 * 1024 * 1024 {
        return None;
    }
    fault(&fs::read(path).ok()?)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    fn put32(b: &mut Vec<u8>, at: usize, v: u32) {
        if b.len() < at + 4 {
            b.resize(at + 4, 0);
        }
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    fn put64(b: &mut Vec<u8>, at: usize, v: u64) {
        put32(b, at, v as u32);
        put32(b, at + 4, (v >> 32) as u32);
    }

    /// A minimal minidump: header, a two-entry directory, an exception at `address`, and modules
    /// given as (base, size, full path).
    pub fn minidump(code: u32, address: u64, modules: &[(u64, u32, &str)]) -> Vec<u8> {
        let mut b = Vec::new();
        put32(&mut b, 0, SIGNATURE);
        put32(&mut b, 8, 2);
        put32(&mut b, 12, 32);
        let exc = 32 + 2 * 12;
        let exc_len = 168;
        let mods = exc + exc_len;
        put32(&mut b, 32, EXCEPTION);
        put32(&mut b, 36, exc_len as u32);
        put32(&mut b, 40, exc as u32);
        put32(&mut b, 44, MODULE_LIST);
        put32(&mut b, 48, (4 + modules.len() * MODULE_SIZE) as u32);
        put32(&mut b, 52, mods as u32);
        put32(&mut b, exc + 8, code);
        put64(&mut b, exc + 24, address);
        put32(&mut b, mods, modules.len() as u32);
        let mut names = mods + 4 + modules.len() * MODULE_SIZE;
        for (i, (base, size, name)) in modules.iter().enumerate() {
            let at = mods + 4 + i * MODULE_SIZE;
            put64(&mut b, at, *base);
            put32(&mut b, at + 8, *size);
            put32(&mut b, at + 20, names as u32);
            let units: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
            put32(&mut b, names, units.len() as u32);
            b.resize(names + 4 + units.len(), 0);
            b[names + 4..names + 4 + units.len()].copy_from_slice(&units);
            names += 4 + units.len() + 2;
            b.resize(names, 0);
        }
        b
    }

    #[test]
    fn t286b_the_faulting_module_is_named_by_file_name_only() {
        let b = minidump(0xC000_0005, 0x7ff8_1000_2345, &[(0x7ff6_0000_0000, 0x10_0000, "C:\\Program Files\\Edge\\msedgewebview2.exe"), (0x7ff8_1000_0000, 0x20_0000, "C:\\Users\\someone\\gpu\\nvwgf2umx.dll")]);
        let f = fault(&b).expect("a fault");
        assert_eq!(f.code, 0xC000_0005);
        assert_eq!(f.address, 0x7ff8_1000_2345);
        assert_eq!(f.module.as_deref(), Some("nvwgf2umx.dll"), "the module holding the address, no folder");
        assert_eq!(code_text(f.code), "0xC0000005 (access violation)");
        assert_eq!(code_text(0x1234), "0x00001234");
    }

    #[test]
    fn t286b_an_address_outside_every_module_or_a_broken_dump_names_none() {
        let b = minidump(0xC000_0005, 0x10, &[(0x7ff6_0000_0000, 0x1000, "a.dll")]);
        assert_eq!(fault(&b).unwrap().module, None);
        assert_eq!(fault(b"MDMP short"), None, "too short");
        assert_eq!(fault(b"not a dump at all, just some bytes here"), None, "wrong signature");
        let mut cut = minidump(5, 0x1000, &[(0x1000, 0x10, "x.dll")]);
        cut.truncate(70);
        assert_eq!(fault(&cut), None, "a cut-off exception stream reads as nothing");
    }

    #[test]
    fn t286b_dumps_are_found_one_or_two_folders_down_oldest_first() {
        let root = std::env::temp_dir().join(format!("kolux-crashdump-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("reports")).unwrap();
        fs::write(root.join("reports").join("a.dmp"), minidump(5, 0x1008, &[(0x1000, 0x100, "C:\\x\\libGLESv2.dll")])).unwrap();
        fs::write(root.join("reports").join("notes.txt"), "x").unwrap();
        let found = dumps(&root);
        assert_eq!(found.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), vec!["a.dmp"]);
        assert_eq!(fault_of(&found[0].path).and_then(|f| f.module).as_deref(), Some("libGLESv2.dll"));
        assert!(dumps(&root.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
