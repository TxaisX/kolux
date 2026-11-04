//! spec/15 P0 boxes SKILL-035 and SKILL-036 (Rust halves): the real artifacts::Library on real files under the
//! scratch root, folder skill15. No network: the CDN fetch closure is always a stand-in.

mod scratch_root;

use kolux_rs_lib::artifacts::{self, Library, Origin};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("skill15").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn no_fetch(_: &str) -> Option<Vec<u8>> {
    panic!("no script is fetched in this test")
}

fn rows(lib: &Library) -> Vec<Value> {
    lib.list().unwrap().into_iter().map(|l| serde_json::to_value(l).unwrap()).collect()
}

fn claude(url: &str, at: u64) -> Origin {
    Origin { origin: url.into(), source: "claude", project: Some("repo".into()), session: Some("sess-1".into()), at }
}

#[test]
fn skill035_box1_publishing_the_same_page_twice_leaves_one_entry_showing_the_second_version() {
    let d = scratch("s35b1");
    let page = d.join("report.html");
    let lib = Library::new(d.join("lib"));
    let url = "https://claude.ai/artifact/same-page";
    std::fs::write(&page, "<title>Report v1</title><p>first version</p>").unwrap();
    let first = lib.add(&page, claude(url, 1_000), &no_fetch).unwrap();
    std::fs::write(&page, "<title>Report v2</title><p>second version</p>").unwrap();
    let second = lib.add(&page, claude(url, 2_000), &no_fetch).unwrap();
    assert_eq!(first.id, second.id, "the same URL is the same entry");
    let list = rows(&lib);
    assert_eq!(list.len(), 1, "one entry, not two");
    assert_eq!((list[0]["title"].as_str(), list[0]["added"].as_u64(), list[0]["state"].as_str()), (Some("Report v2"), Some(2_000), Some("ok")));
    assert_eq!((list[0]["source"].as_str(), list[0]["project"].as_str(), list[0]["session"].as_str()), (Some("claude"), Some("repo"), Some("sess-1")));
    let (body, _) = lib.file(&format!("/{}/report.html", second.id)).expect("the stored page");
    let body = String::from_utf8(body).unwrap();
    assert!(body.contains("second version") && !body.contains("first version"), "{body}");
    // A replayed older publish of the same URL does not bring the first version back.
    std::fs::write(&page, "<title>Report v1</title><p>first version</p>").unwrap();
    lib.add(&page, claude(url, 1_500), &no_fetch).unwrap();
    assert_eq!(rows(&lib)[0]["title"], "Report v2");
    // Another URL is another entry.
    lib.add(&page, claude("https://claude.ai/artifact/other", 3_000), &no_fetch).unwrap();
    assert_eq!(rows(&lib).len(), 2);
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn skill035_box2_a_file_outside_the_pages_own_folder_is_not_copied_in() {
    let d = scratch("s35b2");
    let site = d.join("site");
    std::fs::create_dir_all(site.join("img")).unwrap();
    std::fs::create_dir_all(d.join("elsewhere")).unwrap();
    std::fs::write(d.join("secret.txt"), "PARENT-SECRET").unwrap();
    std::fs::write(d.join("elsewhere").join("pic.png"), "SIBLING-PIC").unwrap();
    std::fs::write(site.join("img").join("ok.png"), "OWN-PIC").unwrap();
    let html = "<title>Out</title><img src=\"img/ok.png\"><img src=\"../secret.txt\"><img src=\"../elsewhere/pic.png\"><link href=\"..\\secret.txt\">";
    std::fs::write(site.join("page.html"), html).unwrap();
    let lib = Library::new(d.join("lib"));
    let e = lib.add(&site.join("page.html"), Origin::hand(&site.join("page.html")), &no_fetch).unwrap();
    assert_eq!(e.state, "ok");
    assert!(lib.file(&format!("/{}/img/ok.png", e.id)).is_some(), "a file inside the page's folder is kept");
    for outside in ["secret.txt", "../secret.txt", "../elsewhere/pic.png", "elsewhere/pic.png", "pic.png"] {
        assert!(lib.file(&format!("/{}/{outside}", e.id)).is_none(), "{outside} must not be served");
    }
    // Nothing outside the folder is anywhere in the stored copy.
    let mut stored = vec![];
    let mut stack = vec![d.join("lib").join(&e.id)];
    while let Some(p) = stack.pop() {
        for ent in std::fs::read_dir(&p).unwrap().flatten() {
            if ent.path().is_dir() {
                stack.push(ent.path());
            } else {
                stored.push(std::fs::read_to_string(ent.path()).unwrap_or_default());
            }
        }
    }
    assert_eq!(stored.len(), 2, "the page and its one in-folder image");
    assert!(!stored.iter().any(|s| s.contains("PARENT-SECRET") || s.contains("SIBLING-PIC")));
    std::fs::remove_dir_all(&d).unwrap();
}

#[cfg(windows)]
#[test]
fn skill035_box3_a_page_on_a_network_share_is_listed_unavailable_and_never_read() {
    let d = scratch("s35b3");
    let lib = Library::new(d.join("lib"));
    // A share that does not exist: a read attempt would come back as Err("could not read ..."), so Ok proves none was made.
    for (n, share) in [r"\\cards-fake-server.invalid\share\page.html", r"\\?\UNC\cards-fake-server.invalid\share\page.html"].iter().enumerate() {
        let e = lib.add(Path::new(share), claude(&format!("https://claude.ai/artifact/share-{n}"), 5_000), &no_fetch).expect("listed, not an error");
        assert_eq!((e.state.as_str(), e.size), ("unavailable", 0));
        assert!(!d.join("lib").join(&e.id).exists(), "nothing is stored for it");
    }
    let list = rows(&lib);
    assert_eq!(list.len(), 2);
    assert!(list.iter().all(|r| r["state"] == "unavailable" && r["stored"] == false && r["title"] == "page.html"));
    // The same through the hand-added route.
    let hand = Path::new(r"\\cards-fake-server.invalid\share\other.html");
    let e = lib.add(hand, Origin::hand(hand), &no_fetch).unwrap();
    assert_eq!(e.state, "unavailable");
    // WSL's own shares are this machine, not a network share.
    assert!(!artifacts::on_network_share(Path::new(r"\\wsl.localhost\Ubuntu\home\a.html")));
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn skill036_box3_an_unreadable_file_is_an_error_and_the_list_is_unchanged() {
    let d = scratch("s36b3");
    let lib = Library::new(d.join("lib"));
    let page = d.join("good.html");
    std::fs::write(&page, "<title>Good</title>").unwrap();
    let good = lib.add(&page, Origin::hand(&page), &no_fetch).unwrap();
    let before = rows(&lib);
    let missing = d.join("missing.html");
    let err = lib.add(&missing, Origin::hand(&missing), &no_fetch).unwrap_err();
    assert!(err.starts_with("could not read missing.html"), "{err}");
    // A folder in place of a file cannot be read either.
    let folder = d.join("folder.html");
    std::fs::create_dir_all(&folder).unwrap();
    let err2 = lib.add(&folder, Origin::hand(&folder), &no_fetch).unwrap_err();
    assert!(err2.starts_with("could not read folder.html"), "{err2}");
    assert_eq!(rows(&lib), before, "the list is unchanged");
    // Re-adding a page whose file has since gone fails and leaves its stored copy as it was.
    std::fs::remove_file(&page).unwrap();
    assert!(lib.add(&page, Origin::hand(&page), &no_fetch).is_err());
    assert_eq!(rows(&lib)[0]["title"], "Good");
    assert!(lib.file(&format!("/{}/good.html", good.id)).is_some());
    // The exact text the toast carries, replayed by src/artifacts/__cards__/SKILL-036.test.ts.
    save_replay("addError", json!(err));
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn skill036_box2_the_served_page_carries_the_link_hand_off_and_open_external_takes_only_web_and_mail_links() {
    let d = scratch("s36b2");
    let page = d.join("viewed.html");
    std::fs::write(&page, "<!doctype html><title>Viewed</title><a href=\"https://example.invalid/x\">out</a>").unwrap();
    let lib = Library::new(d.join("lib"));
    let e = lib.add(&page, Origin::hand(&page), &no_fetch).unwrap();
    let req = tauri::http::Request::builder().uri(format!("http://kolux-artifact.localhost/{}/viewed.html", e.id)).body(Vec::new()).unwrap();
    let resp = artifacts::serve(&lib, &req);
    assert_eq!(resp.status(), 200);
    let body = String::from_utf8(resp.body().clone()).unwrap();
    assert!(body.starts_with("<!doctype html>"), "standards mode kept");
    let at = body.find("<script>document.addEventListener(\"click\"").expect("the link script is appended to the page");
    let script = body[at..].trim_start_matches("<script>").trim_end_matches("</script>").to_string();
    assert!(script.contains("parent.postMessage({koluxOpen:u.href},\"*\")"));
    // A request for a file the entry does not hold gets nothing.
    let other = tauri::http::Request::builder().uri("http://kolux-artifact.localhost/0000000000000000/viewed.html").body(Vec::new()).unwrap();
    assert_eq!(artifacts::serve(&lib, &other).status(), 404);
    // The app side of the hand-off accepts web and mail links only; anything else is refused before any opener runs.
    for bad in ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "kolux-artifact://localhost/x", "C:\\Windows\\notepad.exe"] {
        assert!(artifacts::open_external(bad.into()).unwrap_err().contains("is not a web or mail link"), "{bad}");
    }
    save_replay("script", json!(script));
    save_replay("id", json!(e.id));
    std::fs::remove_dir_all(&d).unwrap();
}

static REPLAY: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Keeps a produced value in evidence/cards-SKILL-036-replay.json for the TS half; written only with CARDS_REGEN=1 (the id differs per run).
fn save_replay(key: &str, value: Value) {
    if std::env::var_os("CARDS_REGEN").is_none() {
        return;
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("evidence").join("cards-SKILL-036-replay.json");
    let _guard = REPLAY.lock().unwrap_or_else(|e| e.into_inner());
    let mut doc: Value = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    doc[key] = value;
    std::fs::write(&path, serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
}

