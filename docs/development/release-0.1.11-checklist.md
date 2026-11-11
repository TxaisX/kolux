# Kolux 0.1.11 checklist (for Txais)

Integration branch: `lane/ready-int` at the commit that adds this file (built on `38958f00`, the 0.1.10
release line, which is not on GitHub `main`: `main` is still `75be2b46` = tag v0.1.10).

## In 0.1.11

| Lane | What | Cloud status |
|---|---|---|
| ready-tools (already in) | T-813, T-811, T-791 | merged before this session |
| ready-smoke `237461a1` | Smoke flow 3 checks the Explorer delete prompt; hidden smoke | tests green |
| ready-nowin `dc6428ef` | T-816: no console window from any background process (`winproc`, guards for Rust and scripts) | tests green; independent review: no blockers, should-fixes done |
| ready-identity `75a0e954` | T-790: "Kolux" identity + profile move; T-785 update proof rig | tests green; two independent reviews: both blockers fixed, should-fixes done or listed in `evidence/T-790.txt` |

**Held out** (Txais, 2026-11-08): ready-sec (T-779/T-780) and ready-sec-2 (T-793). What is left on them:
`docs/development/security-lanes-backlog.md`.

## Cloud gate on ready-int (Linux) — passed, compared against the pre-merge `aa56260d`

- `pnpm check`: OK (tsc, license, plan, workflow, invoke-contract, glossary, guide, memory).
- `pnpm test`: 875 files, 6465 tests passed, 1 skipped.
- `cargo test --tests`: the same tests fail before and after the merge (Linux-only environment
  failures: pty, agent install, PATH, Windows paths), plus ONE new one:
  `t_152_b_2 ... identifier_matches_the_app`, which passes once the T-790 conf patch is applied (step 1).
- `cargo clippy --all-targets -D warnings`: 107 findings before and after, same files (Linux-only code paths).

## Before you build (on your PC)

1. **Apply `evidence/T-790-tauri-conf.patch`** (productName "Kolux", identifier `com.txaisxiong.kolux`) in the
   same commit you release from. Without it the CLI, the agent hooks and the app disagree on the data
   folder: the code already says `com.txaisxiong.kolux`.
2. `cargo test` and `cargo clippy --all-targets -- -D warnings` on Windows (the Windows-only tests never run
   in the cloud), and `pnpm check` + `pnpm test`.

## Windows-only proofs still PENDING (must run on your PC, not the cloud)

3. **Silent smoke** (ready-smoke): the hidden-desktop smoke run, including flow 3's Explorer delete prompt.
4. **No-popup check** (T-816): `scripts/prove/live-T-816-nowin.mjs` -> `evidence/T-816.txt` shows 0 visible
   console windows from Kolux children. Note: the proof drives start-up, add project, a terminal, an agent
   seat, fonts and resources only; search, reveal/open, git panels, Codex usage and automations are not
   exercised by it.
5. **Live update proof** (T-790/T-785) on the scratch identity, per `evidence/T-790.txt` "PENDING":
   old identity with a project, a managed Claude account and a Codex account -> signed update -> new
   identity has the same projects and accounts (running from the NEW folder), one Apps entry, one PATH
   entry, Start-menu/desktop shortcuts present, old profile intact; repeat with the old app running and with
   the old uninstaller cancelled (install must stop and change nothing). Build the old side from the v0.1.10
   tag if you can (the rig builds it from today's tree).

## Known limits shipping with 0.1.11 (decide: accept or hold)

- T-790: a dev or lane build with no `bin\kolux.exe` puts its own folder (which now holds the GUI `kolux.exe`)
  on its panes' PATH, so `kolux` typed there starts the app. Installed copies are not affected.
- T-790: on the very first start after the update, the safe-graphics flag and browser proxy are read before
  the profile move; the copy also runs before the (hidden) window appears, so a large profile looks slow.
- T-790: paths in another case or slash form, and absolute paths inside account config files, are not
  repointed (they keep pointing at the intact old folder).

## Release (needs your explicit yes in-session; nothing here pushes to main or releases)

6. Merge `lane/ready-int` to `main`, then `pnpm ship --main` (or the release workflow). Signing key
   at `~/.kolux/release-signing/`. Tell users to restart agents once only when the security lanes ship
   (not in 0.1.11).
