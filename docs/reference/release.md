# Releasing Kolux

How a Windows release actually gets cut and installed on this machine, distilled from
`package.json`, `config/electron-builder.config.cjs`, `.github/workflows/release.yml`, and
`HANDOFF.md`'s release entries.

## Prerequisites

Work happens on `main` (or lands there via `pnpm ship --main`), not a stray worktree. `gh`
CLI authenticated (CI itself uses `GITHUB_TOKEN`, not a personal token). Windows is the
only platform actually released — Mac/Linux builds exist but ship to no one. Releases are
unsigned unless `KOLUX_WIN_SIGNPATH=1` (SignPath cert) — don't set it for a normal release.

## 1. Version bump

Versions are `0.x.y`, never `1.0.0` without the owner's say (`HANDOFF.md` line 326).
**x** (`0.X.0`, y resets): new capability, or users must change how they work. **y**
(`0.x.Y`): behavior gets better, nothing new to learn (fixes/perf/polish/deps). No bump:
nothing user-visible (docs/tests/CI/refactors). Both kinds in one release: the larger wins.

Only `version` in `package.json` changes — confirmed by the diff in commit `4b76b9dce`
(0.10.0 → 0.11.0, package.json only, no lockfile/other version field touched).

Commit message shape, seen verbatim in history:
```
0.11.0 — x: adds plan review, event-triggered automations, model routing, the Runs view and grid layout presets, and removes OpenCode support
0.10.0 — x: the app is Kolux, and its GitHub repo is TxaisX/kolux
```
`<new version> — <x|y>: <what changed and why>`. `pnpm ship` normally has Claude Haiku
write the message, so a version-bump commit instead uses `pnpm ship --main --message "..."`
to preserve the required x/y reason verbatim and land on `main` in one step
(`AGENTS.md`, `HANDOFF.md` line 11).

## 2. Tag and push

```
git tag v0.11.0
git push origin main v0.11.0
```
(`HANDOFF.md` "Releasing and auto-update" section, steps 1–2.) The tag must be `vX.Y.Z` and
must exactly match `package.json`'s `version` — the workflow checks this and fails fast if
they disagree (`.github/workflows/release.yml`, "Check tag matches package.json version" step).

## 3. What CI does (`.github/workflows/release.yml`, triggers on `v0.*` tag push)

Runs on `windows-latest`, in order:
1. Verify tag == `package.json` version, then `pnpm install --frozen-lockfile`.
2. `pnpm run build:desktop && pnpm run build:native && pnpm run ensure:electron-runtime`
3. `gh release create "$TAG" --title "$TAG" --notes "" --verify-tag --draft` — draft created
   *before* packaging, because electron-builder's parallel publishers each try to create
   the release if missing, which once produced two `v0.1.0` releases.
4. `pnpm exec electron-builder --config config/electron-builder.config.cjs --win --publish always`
   with `EP_DRAFT=true` — publishes `kolux-windows-setup.exe`, `.blockmap`, `latest.yml`
   (publish target: GitHub, owner `TxaisX`, repo `kolux`, per `electron-builder.config.cjs`).
5. `node config/scripts/release-packaged-smoke.mjs` — smoke-tests the packaged CLI
   (`--version` must equal `package.json`'s version, plus `--help`) and an isolated
   Nightshift→Kolux profile migration.
6. Confirm all three assets exist, then `gh release edit "$TAG" --draft=false --latest`.

Nothing else runs locally for a normal release — CI does the build, publish, and the
GitHub release lifecycle end to end (draft → un-draft → `--latest`). Local work is
steps 1–2 only (bump + tag); no manual `gh release` commands are needed.

## 4. Local build (testing only, not part of a real release)

```
pnpm install
pnpm run build:win       # unsigned installer in dist/
```
(`HANDOFF.md` "Working here".) Runs `build:desktop` then `electron-builder --win`, no
`--publish`. **Clean `out/` first** — gitignored and never pruned, so a file removed from
source can still ship (a leftover `fleet-workspaces-dir.js` once shipped this way).

## 5. Local install and verifying the installed version

Install **from PowerShell, never Git Bash** — Git Bash rewrites `/S` into a path and drops
into interactive UI instead of running silently (`HANDOFF.md` "Working here"; also
`nightshift.md` memory):
```
Start-Process dist\kolux-windows-setup.exe -ArgumentList '/S','/currentuser' -Wait
```
Close any editor/window holding the repo or install folder first — a lock aborts the
install; `config/scripts/windows-who-locks.ps1 -Path <file>` names the holder if it fails.

Verify the installed version:
```
kolux --version
```
(`kolux` = installed CLI's bin name, `package.json` `bin.kolux` → `./out/cli/index.js`;
`release-packaged-smoke.mjs` asserts this equals `package.json`'s version before a release
can publish.) In-app, the sidebar footer's update button (`SidebarUpdateButton.tsx`) shows
current/available version via Check for updates → Update to vX → Restart to update.

Builds before 2026-09-14 carry a SignPath `publisherName` and need one manual reinstall
before auto-update works again; after that, updates are automatic (checked once/day
against `TxaisX/kolux` releases) — per `HANDOFF.md`.

## Rollback

**UNVERIFIED / inferred — no rollback procedure is documented in this repo.** The update
mechanism only moves forward; there's no in-app downgrade. If a release is bad:
`gh release edit vX.Y.Z --draft` (or delete it) to pull it from the update feed — inferred
from how CI un-drafts releases, not tested. To roll a local machine back, download an
older release's `kolux-windows-setup.exe` and install it with the same `Start-Process`
command above — not observed in any transcript, best-effort only.

## Known pitfalls (from `HANDOFF.md` release entries)

- Two `v0.1.0` releases were once published because electron-builder's parallel uploaders
  each tried to create the release — CI now pre-creates a draft first.
- A packaging failure came from a module not listed in `asarUnpack`, invisible to the
  CLI's `ELECTRON_RUN_AS_NODE` loader inside `app.asar`; `electron-builder-config.test.mjs`
  now guards this.
- Stale `out/` (gitignored, never pruned) can ship deleted files inside the installer —
  clean it before packaging.
- A worktree's first `pnpm install` once left `node-pty` empty; a second
  `pnpm install --frozen-lockfile` fixed it.
