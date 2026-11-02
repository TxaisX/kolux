# Profile fixture for the upgrade regression test (APP-048 box 2)

`src-tauri/tests/fixtures/profile-v0.1.5/` is a profile folder written by the **v0.1.5 release's own code**.
The test `app048_box2_a_profile_written_by_the_previous_release_reads_back_identical` (src-tauri/tests/cards_19.rs)
copies it to a scratch folder, opens it with today's `Store::open`, and compares what it reads with `expected.json`.

Files: `settings.json`, `settings.json.bak` (the last good copy, made by the second settings write), `state.db`
(the key/value table), `expected.json` (the snapshot; the `kv` part is written by hand from the values below, not read back).
`.gitattributes` there keeps git from rewriting line endings in them.

## Regenerate it for the next release

Do this when a new version is released (the fixture should always be from the newest release), never from `main`.

1. Make a throwaway checkout of the release tag (replace `v0.1.5` and the folder name):
   `git -C G:/Dev/kolux-rs worktree add --detach G:/Dev/kolux-rs-sessions/wt/fx-vNEW vNEW`
2. In that checkout only, append the test below inside `mod tests` at the end of `src-tauri/src/state.rs`
   (the `Store` API has been `open`, `patch_settings`, `set`, `set_all` since v0.1.3; adapt the calls if the release renamed them).
3. Run it (use the cargo env and scratch-slot rules of the lane you are in):
   `FIXTURE_OUT=<empty scratch folder>/fx cargo test --manifest-path src-tauri/Cargo.toml --lib zz_make_profile_fixture`
4. Copy `settings.json`, `settings.json.bak` and `state.db` from `FIXTURE_OUT` into
   `src-tauri/tests/fixtures/profile-vNEW/` (and `git mv` the folder, or update `root.join("profile-v0.1.5")` in cards_19.rs).
   Check that no `state.db-wal` or `state.db-shm` file was left (the Store was dropped, so there should be none).
5. Rewrite `expected.json`: `settings` = the parsed `settings.json`; `kv` = the three rows below, sorted by key.
6. Remove the throwaway checkout: `git -C G:/Dev/kolux-rs worktree remove --force G:/Dev/kolux-rs-sessions/wt/fx-vNEW`. Commit nothing in it.
7. Run `cargo test --manifest-path src-tauri/Cargo.toml --test cards_19 app048_box2` (under the scratch homes of `scripts/test-env.ps1`).

If today's code cannot read the fixture, that is a real upgrade bug: fix the reader, do not edit the fixture.

The fixture's kv rows: `projects` = `[{"id":"p1","name":"alpha","path":"C:/fixture/alpha"},{"id":"p2","name":"beta","path":"C:/fixture/beta"}]`,
`worktrees` = `["C:/fixture/alpha","C:/fixture/beta"]`, `start_count` = `7`.

## The temporary test (v0.1.5 checkout only, never committed)

```rust
    /// TEMPORARY (profile fixture, scripts/profile-fixture.md): writes the release's own profile into $FIXTURE_OUT.
    #[test]
    fn zz_make_profile_fixture() {
        let dir = PathBuf::from(std::env::var("FIXTURE_OUT").expect("FIXTURE_OUT"));
        let _ = fs::remove_dir_all(&dir);
        let pane = |key: u32, cwd: &str, agent: &str| serde_json::json!({ "key": key, "cwd": cwd, "branch": null, "agent": agent, "program": null, "args": [] });
        let editor = |key: u32, cwd: &str, path: &str, title: &str| serde_json::json!({ "key": key, "cwd": cwd, "branch": null, "agent": "shell", "program": null, "args": [], "kind": "editor", "path": path, "title": title });
        let mut claude = pane(1, "C:/fixture/alpha", "claude");
        claude["title"] = serde_json::json!("alpha main");
        claude["pinned"] = serde_json::json!(true);
        let layout = serde_json::json!({
            "panes": [
                claude,
                editor(2, "C:/fixture/alpha", "C:/fixture/alpha/README.md", "README.md"),
                editor(3, "C:/fixture/alpha", "C:/fixture/alpha/src/main.rs", "main.rs"),
                pane(4, "C:/fixture/beta", "shell"),
            ],
            "activeTab": { "1": 3, "4": 4 },
            "focused": 3,
            "activeDir": "C:/fixture/alpha",
            "stacked": { "C:/fixture/beta": true },
            "workspaces": [
                { "name": "Alpha work", "dir": "C:/fixture/alpha", "panes": [1, 2, 3] },
                { "name": "Beta", "dir": "C:/fixture/beta", "panes": [4] }
            ]
        });
        {
            let s = Store::open(&dir).unwrap();
            let mut set = serde_json::Map::new();
            set.insert("theme".into(), serde_json::json!("dark"));
            set.insert("mode".into(), serde_json::json!("dark"));
            set.insert("appFont".into(), serde_json::json!("Segoe UI"));
            set.insert("uiLook".into(), serde_json::json!("new"));
            set.insert("projects".into(), serde_json::json!([
                { "id": "p1", "name": "alpha", "path": "C:/fixture/alpha" },
                { "id": "p2", "name": "beta", "path": "C:/fixture/beta" }
            ]));
            s.patch_settings(&set, &[]).unwrap();
            let mut set = serde_json::Map::new();
            set.insert("savedLayout".into(), layout);
            s.patch_settings(&set, &[]).unwrap();
            s.set_all(&[
                ("projects", "[{\"id\":\"p1\",\"name\":\"alpha\",\"path\":\"C:/fixture/alpha\"},{\"id\":\"p2\",\"name\":\"beta\",\"path\":\"C:/fixture/beta\"}]"),
                ("worktrees", "[\"C:/fixture/alpha\",\"C:/fixture/beta\"]"),
            ]).unwrap();
            s.set("start_count", "7").unwrap();
        }
        // dropping the Store closed the connection, which folds the WAL into state.db
        assert!(dir.join("settings.json").exists() && dir.join("state.db").exists());
    }
```

Made on 2026-11-01 from tag v0.1.5 (ed636846).
