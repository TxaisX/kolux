//! LAG-06B-SCAN: the sidebar's folder scan (`workspace_scan`) runs its blocking work (store reads,
//! `git worktree list`, folder checks) on the blocking pool, never on an async worker thread.
//! No stopwatch: the proof is a nested `block_on` probe, which only works on a thread that is NOT
//! driving async tasks (an async worker or a thread already inside `block_on` panics on it).
use super::*;

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-lag06b-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// True when this thread may block: a nested `block_on` here does not panic.
fn may_block_here() -> bool {
    std::panic::catch_unwind(|| tauri::async_runtime::block_on(async { 7 })).is_ok()
}

#[test]
fn the_scan_body_runs_on_the_blocking_pool_not_an_async_worker() {
    let outer = std::thread::current().id();
    let got = tauri::async_runtime::block_on(async {
        // The probe answers false here: this future is being driven by block_on.
        let driver_may_block = may_block_here();
        let inner = on_blocking_pool(|| Ok((std::thread::current().id(), may_block_here()))).await;
        (driver_may_block, inner)
    });
    let (driver_may_block, inner) = got;
    assert!(!driver_may_block, "the probe must see the async driver thread as one that may not block");
    let (thread, may_block) = inner.expect("the work's own Ok value comes back");
    assert_ne!(thread, outer, "the work ran on the calling thread (inline), not on the blocking pool");
    assert!(may_block, "the work ran on a thread that drives async tasks (an async worker), not on the blocking pool");
}

#[test]
fn the_blocking_pool_hands_back_the_work_result_and_its_error() {
    let ok: Result<u32, String> = tauri::async_runtime::block_on(on_blocking_pool(|| Ok(41 + 1)));
    assert_eq!(ok, Ok(42));
    let err: Result<u32, String> = tauri::async_runtime::block_on(on_blocking_pool(|| Err("that project is no longer registered".to_string())));
    assert_eq!(err, Err("that project is no longer registered".to_string()));
}

#[test]
fn a_panicking_scan_becomes_an_error_not_a_crash() {
    let got: Result<u32, String> = tauri::async_runtime::block_on(on_blocking_pool(|| -> Result<u32, String> { panic!("lag06b boom") }));
    assert!(got.is_err(), "a panic in the work must come back as Err, got {got:?}");
}

#[test]
fn the_sync_scan_answers_what_the_old_body_answered() {
    let base = temp("same");
    let plain = base.join("plain");
    fs::create_dir_all(&plain).unwrap();
    let store = Arc::new(Mutex::new(Store::open(&base.join("db")).unwrap()));
    let project = crate::folder_projects::add_folder(&store.lock().unwrap(), &plain).unwrap();
    let git = Git { version: "git version 2.0.0".to_string() };
    // The old body: scan, then decorate and the unseen list with the store locked.
    let old = |id: &str| -> Result<Scanned, String> {
        let (p, all) = scan(&git, &store, id)?;
        scanned_of(&store.lock().unwrap(), &p, all)
    };
    let first_old = old(&project.id).unwrap();
    let now = workspace_scan_now(&git, &store, &project.id).unwrap();
    assert_eq!(now.list, first_old.list);
    assert_eq!(now.unseen, first_old.unseen);
    assert_eq!(now.list.len(), 1, "a folder project has its one folder workspace");
    let again_old = old(&project.id).unwrap();
    assert_eq!((now.list.clone(), now.unseen.clone()), (again_old.list, again_old.unseen));
    // The same through the blocking pool.
    let (g, s, id) = (git.clone(), store.clone(), project.id.clone());
    let pooled = tauri::async_runtime::block_on(on_blocking_pool(move || workspace_scan_now(&g, &s, &id))).unwrap();
    assert_eq!((pooled.list, pooled.unseen), (now.list, now.unseen));
    // The error case is unchanged.
    let missing_old = old("no-such-project").err();
    let missing_now = workspace_scan_now(&git, &store, "no-such-project").err();
    assert_eq!(missing_now, missing_old);
    assert_eq!(missing_now.as_deref(), Some("that project is no longer registered"));
    let (g, s) = (git.clone(), store.clone());
    let missing_pooled = tauri::async_runtime::block_on(on_blocking_pool(move || workspace_scan_now(&g, &s, "no-such-project"))).err();
    assert_eq!(missing_pooled, missing_old);
    drop(store);
    let _ = fs::remove_dir_all(&base);
}

/// The text of `pub async fn workspace_scan(`, up to the closing brace at the start of a line.
fn command_text() -> String {
    let src = include_str!("projects.rs").replace("\r\n", "\n");
    let start = src.find("pub async fn workspace_scan(").expect("workspace_scan is still an async command");
    let rest = &src[start..];
    let end = rest.find("\n}\n").expect("workspace_scan has a closing brace on its own line");
    rest[..end].to_string()
}

#[test]
fn the_workspace_scan_command_hands_its_body_to_the_blocking_pool() {
    let body = command_text();
    assert!(body.contains("on_blocking_pool("), "workspace_scan must call on_blocking_pool:\n{body}");
    assert!(body.contains("workspace_scan_now("), "workspace_scan must run workspace_scan_now inside the pool:\n{body}");
    let code: String = body.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    for banned in [".lock()", "scanned_of(", ".worktrees(", "spawn(", "block_on("] {
        assert!(!code.contains(banned), "workspace_scan must not call `{banned}` itself:\n{body}");
    }
    let src = include_str!("projects.rs").replace("\r\n", "\n");
    let tail = src.trim_end();
    assert!(
        tail.ends_with("#[cfg(test)]\n#[path = \"projects_scan_board_tests.rs\"]\nmod scan_board_tests;")
            || tail.ends_with("#[cfg(test)] #[path = \"projects_scan_board_tests.rs\"] mod scan_board_tests;"),
        "the board tests are registered at the end of projects.rs"
    );
}
