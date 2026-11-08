//! APP-041 box 2 (needs evidence/cards-APP-041-lib.rs.patch, which makes `diag` pub): logs past the REAL size caps.
//! To run: git apply evidence/cards-APP-041-lib.rs.patch && cp evidence/cards-APP-041-diag-test.rs.txt src-tauri/tests/cards_19_diag.rs
//!   && cargo test --manifest-path src-tauri/Cargo.toml --test cards_19_diag   (then revert the patch and delete the copy).

mod scratch_root;

use kolux_lib::diag::{write, FILE_CAP, TOTAL_CAP};
use std::fs;

const LINE: usize = 4 * 1024;

/// About 8 MB goes through the public `write` with the shipped 512 KB / 2 MB caps: no file passes the per-file cap
/// (plus the one line that tipped it), the files moved aside stay within the total cap, the oldest are the ones deleted,
/// and the newest line is still there.
#[test]
fn app041_box2_logs_past_the_real_caps_delete_the_oldest_and_the_total_stays_below_the_cap() {
    let dir = scratch_root::root().join("app41").join(format!("diag-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".kolux-rs-scratch"), "").unwrap();
    let pad = "x".repeat(LINE);
    let n = 2000; // 2000 * ~4 KB = ~8 MB, four times the total cap
    for i in 0..n {
        write(&dir, &format!("seq{i:05} {pad}"));
    }
    let logs = dir.join("logs");
    let mut live = 0u64;
    let mut aside = 0u64;
    let mut asides = 0;
    let mut text = String::new();
    for e in fs::read_dir(&logs).unwrap().flatten() {
        let len = e.metadata().unwrap().len();
        assert!(len <= FILE_CAP + LINE as u64 + 64, "{:?} is {len} bytes, past the per-file cap", e.file_name());
        if e.file_name() == "kolux.log" {
            live = len;
        } else {
            aside += len;
            asides += 1;
        }
        text.push_str(&fs::read_to_string(e.path()).unwrap());
    }
    assert!(asides >= 1, "the cap was crossed, so something was moved aside");
    assert!(aside <= TOTAL_CAP, "files moved aside hold {aside} bytes, past the {TOTAL_CAP} total cap");
    assert!(aside + live <= TOTAL_CAP + FILE_CAP + LINE as u64 + 64, "folder total {} is more than the total cap plus the live file", aside + live);
    assert!(!text.contains("seq00000 "), "the oldest line must have been deleted");
    assert!(text.contains(&format!("seq{:05} ", n - 1)), "the newest line must still be there");
    let _ = fs::remove_dir_all(&dir);
}
