# Profile fixture for the upgrade regression test (APP-048 box 2)

`src-tauri/tests/fixtures/profile-v0.1.5/` is a profile folder written by the **v0.1.5 release's own code**: the
settings object (setting names and the saved layout) by that release's window code (`layoutOf`, `FIELD`, `LOOK_FIELD`),
the files by its `Store`, the projects by its `save_projects`, the start count by its `count_start`. Nothing in it is typed by hand.
Two tests read it with today's code:

| Test | Reads | With |
|---|---|---|
| `app048_box2_a_profile_written_by_the_previous_release_reads_back_identical` (src-tauri/tests/cards_19.rs) | the whole folder, copied to a scratch folder | `Store::open` + `stamp_look()` (as lib.rs does at startup) |
| `src/terminal/layout.app048.test.ts` | `settings.json` | `restoreLayout`, `readAppearance`, `readLook`, `stampLook` (what src/main.tsx `settle()` calls) |

Files: `settings.json`, `settings.json.bak` (the last good copy, made by the second settings write), `state.db`
(the key/value table), `expected.json` (the snapshot, built by `scripts/profile-fixture-expected.mjs` from the other files).
`.gitattributes` there keeps git from rewriting line endings in them.

## Regenerate it for the next release

Do this when a new version is released (the fixture should always be from the newest release), never from `main`.
If a step below no longer compiles in the release, adapt the temporary code to its renamed API; do not change the fixture by hand.

1. Make a throwaway checkout of the release tag (replace `vNEW` and the folder name) and install in it:
   `git -C G:/Dev/kolux-rs worktree add --detach G:/Dev/kolux-rs-sessions/wt/fx-vNEW vNEW` then `pnpm install --frozen-lockfile` there.
2. **Window half.** Put the file in "Generator 1" below at `src/terminal/zzMakeFixture.test.ts` in that checkout and run
   `FIXTURE_JSON=<scratch>/settings-ts.json npx vitest run src/terminal/zzMakeFixture.test.ts`.
   It writes the settings the release's window would save, layout included.
3. **Store half.** Append "Generator 2" below inside `mod tests` at the end of `src-tauri/src/state.rs` and run
   `FIXTURE_OUT=<scratch>/out FIXTURE_JSON=<scratch>/settings-ts.json cargo test --manifest-path src-tauri/Cargo.toml --lib zz_make_profile_fixture`
   (use the cargo env and scratch-slot rules of the lane you are in).
4. Copy `settings.json`, `settings.json.bak` and `state.db` from `<scratch>/out` into `src-tauri/tests/fixtures/profile-vNEW/`
   (`git mv` the folder, or update `profile-v0.1.5` in cards_19.rs and layout.app048.test.ts). No `state.db-wal` / `state.db-shm` should be there.
5. Build `expected.json` from the generated files: `node scripts/profile-fixture-expected.mjs src-tauri/tests/fixtures/profile-vNEW`
   (settings = the parsed `settings.json`; kv = every row of `state.db`, read with Node's built-in sqlite). Then update the literal
   expected values in `layout.app048.test.ts` if the layout or look changed in Generator 1.
6. Remove the throwaway checkout: `git -C G:/Dev/kolux-rs worktree remove --force G:/Dev/kolux-rs-sessions/wt/fx-vNEW`. Commit nothing in it.
7. Run `cargo test --manifest-path src-tauri/Cargo.toml --test cards_19 app048_box2` (under the scratch homes of `scripts/test-env.ps1`)
   and `npx vitest run src/terminal/layout.app048.test.ts`.

If today's code cannot read the fixture, that is a real upgrade bug: fix the reader, do not edit the fixture.

## Generator 1: the window code (v0.1.5 checkout only, never committed)

```ts
// TEMPORARY (profile fixture, scripts/profile-fixture.md in the main repo): writes the settings object the v0.1.5 window
// would save, with its own layoutOf and its own setting names, into $FIXTURE_JSON. Never committed.
import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { FIELD } from "../theme";
import { LOOK_FIELD } from "../settings/general";
import { LAYOUT_FIELD, layoutOf } from "./layout";

const base = { branch: null, program: null, args: [] as string[] };

test("zz make the v0.1.5 settings object", () => {
  const out = process.env.FIXTURE_JSON;
  expect(out, "FIXTURE_JSON").toBeTruthy();
  const panes = [
    { ...base, key: 1, cwd: "C:/fixture/alpha", agent: "claude" as const, agentId: "claude", program: "claude", title: "alpha main", group: 1, session: "5b0f6c1e-7a52-4c1d-9e0b-3f2a8d4c6b71", account: null },
    { ...base, key: 2, cwd: "C:/fixture/alpha", agent: "shell" as const, kind: "editor" as const, path: "C:/fixture/alpha/README.md", title: "README.md", group: 1 },
    { ...base, key: 3, cwd: "C:/fixture/alpha", agent: "shell" as const, kind: "editor" as const, path: "C:/fixture/alpha/src/main.rs", title: "main.rs", group: 1 },
    { ...base, key: 4, cwd: "C:/fixture/beta", agent: "shell" as const, title: "beta shell", group: 4 },
  ];
  const layout = layoutOf(panes, { 1: 3, 4: 4 }, 3, "C:/fixture/alpha", { "C:/fixture/beta": true }, { pinned: new Set([1]), colors: { 1: "blue", 4: "green" } });
  const settings = { [FIELD.theme]: "cobalt", [FIELD.mode]: "dark", [FIELD.appFont]: "Segoe UI", [LOOK_FIELD]: "new", [LAYOUT_FIELD]: layout };
  writeFileSync(out!, JSON.stringify(settings, null, 2));
});
```

## Generator 2: the store (v0.1.5 checkout only, never committed)

```rust
    /// TEMPORARY (profile fixture, scripts/profile-fixture.md): writes the release's own profile into $FIXTURE_OUT.
    /// The settings come from $FIXTURE_JSON, made by the release's own window code (src/terminal/zzMakeFixture.test.ts);
    /// the projects and the start count are written by the release's own functions.
    #[test]
    fn zz_make_profile_fixture() {
        let dir = PathBuf::from(std::env::var("FIXTURE_OUT").expect("FIXTURE_OUT"));
        let json = fs::read(std::env::var("FIXTURE_JSON").expect("FIXTURE_JSON")).unwrap();
        let settings: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&json).unwrap();
        let _ = fs::remove_dir_all(&dir);
        {
            let s = Store::open(&dir).unwrap();
            // two writes, so settings.json.bak holds the first one (the last good copy), as it does for a user who changed a setting twice
            let (layout, rest): (Vec<_>, Vec<_>) = settings.into_iter().partition(|(k, _)| k == "savedLayout");
            s.patch_settings(&rest.into_iter().collect(), &[]).unwrap();
            s.patch_settings(&layout.into_iter().collect(), &[]).unwrap();
            let project = |id: &str, name: &str, path: &str| crate::projects::Project { id: id.into(), name: name.into(), path: path.into(), workspaces_dir: None, base: None, display_name: None };
            let mut alpha = project("p1", "alpha", "C:/fixture/alpha");
            alpha.workspaces_dir = Some("C:/fixture/alpha-workspaces".into());
            alpha.base = Some("origin/main".into());
            let mut beta = project("p2", "beta", "C:/fixture/beta");
            beta.display_name = Some("Beta site".into());
            crate::projects::save_projects(&s, &[alpha, beta]).unwrap();
            for _ in 0..7 {
                crate::onboarding::count_start(&s).unwrap();
            }
        }
        // dropping the Store closed the connection, which folds the WAL into state.db
        assert!(dir.join("settings.json").exists() && dir.join("settings.json.bak").exists() && dir.join("state.db").exists());
    }
```

(The closing `}` of `mod tests` stays where it was.) Made on 2026-11-01 from tag v0.1.5 (ed636846), round 2 of PR #71.
