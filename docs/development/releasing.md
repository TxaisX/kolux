# Releasing

A Kolux RS release is a signed installer, a signed update manifest, and a GitHub release. The release script does the mechanical work. The owner decides when to publish and holds the signing key.

## Versioning

The release script picks the next version as **one patch above the higher of** the project version and the newest release tag (`scripts/release.mjs:47-54`). It edits three files in the release checkout:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Do not hand-edit versions in the working tree. The release checkout is the source of the published build.

Tags and releases are named `v<version>`. The installer file is `Kolux RS_<version>_x64-setup.exe`; the download URL replaces the spaces with dots.

## Before you release

- `main` is green in CI for the exact commit you are about to publish.
- The signing key exists at `~/.kolux-rs/release-signing/kolux-rs.key` with its `.pub` beside it. A password is supported through `KOLUX_RELEASE_KEY_PASSWORD`.
- `gh` is authenticated for the `TxaisX/kolux-rs` repository.
- `git status` is clean. `pnpm ship` stages everything with `git add -A`, so unrelated working-tree changes would be included.
- You have decided whether the release is a normal build or a recovery build.

## The owner flow

```powershell
pnpm ship --main
```

`pnpm ship --main`:

1. commits the working tree, using `--message` or an AI-written subject;
2. merges `origin/main` into the branch, never rebases, and stops on a conflict;
3. pushes the branch and `HEAD:main`;
4. starts `scripts/release.mjs` as a detached background job.

Without `--main`, `pnpm ship` only commits and pushes the current branch. It does not touch `main` and does not start a release.

Useful variants:

```powershell
pnpm ship --main --dry-run          # print the steps, change nothing
pnpm ship --main --message "..."    # use a fixed commit subject
pnpm ship --main --no-release       # land on main without releasing
pnpm release --dry-run              # print the next version and notes
pnpm release --no-publish           # build, smoke-test, and sign, then stop
```

`pnpm release` builds in `~/.kolux-rs/release-checkout`, not in the working tree. That checkout is kept only for releases. A lock prevents two release builds at once; a lock older than 3 hours or owned by a dead process is treated as stale.

## What the release script does

`scripts/release.mjs` runs this sequence:

1. Take the release lock and confirm the checkout.
2. Compute the next version.
3. Collect up to 30 commit subjects since the previous release marker for the notes, plus a hidden `<!-- kolux-rs-source: <sha> -->` comment.
4. Edit the version in `package.json`, `tauri.conf.json`, and `Cargo.toml`.
5. Run the CI gate on the exact commit.
6. Build the release CLI with `--features release-cli`.
7. Run `pnpm tauri build --bundles nsis` with the generated release config.
8. Smoke-test the installer and the CLI: the installer is at least 1 MiB, `kolux --version` matches, `kolux --help` lists the commands, an old profile migrates, and the app version matches.
9. Sign the installer with the minisign key.
10. Verify the signature offline: key id, payload hash, trusted comment, and the version in the comment.
11. Write `latest.json`.
12. Publish the installer and its `.sig` first, then the manifest last.

The order matters. A client that sees the manifest must be able to fetch a complete installer and signature.

The notes are generated from commit subjects, so they read like a changelog for the build, not a user-facing announcement. If a release needs human notes, write them in the GitHub release body after the script publishes.

## The CI gate

`scripts/ci-gate.mjs` waits up to 30 minutes for a CI run on the exact commit, polling every 30 seconds. It refuses when no run appears, when the run is still going at the limit, or when any conclusion is not `success`. The refusal is written to the job summary.

The release script calls the gate before the build and again immediately before publishing. `KOLUX_RELEASE_ALLOW_RED=1` is the documented emergency bypass. It is for recovery only; it is not a normal path.

## Signing

The update manifest is signed with minisign. The public key is compiled into the app from `KOLUX_RS_RELEASE_PUBKEY`; a release build without a key refuses to update. The private key is read from `KOLUX_RELEASE_KEY` or `~/.kolux-rs/release-signing/kolux-rs.key`.

The release workflow keeps the private key only inside the signing step: it writes the key from a GitHub secret, runs the signer, and deletes the file on exit (`/.github/workflows/release.yml:63-81`). The build step runs without the private key.

Two cautions:

- The key currently has no password. The script and workflow support `KOLUX_RELEASE_KEY_PASSWORD`; use it before the user base grows.
- There is no published key rotation or revocation path. A compromised key can sign an update that every installed copy accepts. Treat the key as the highest-value secret in the project.

## The manual workflow

`.github/workflows/release.yml` is a manual `workflow_dispatch` job with a `publish` boolean. It:

1. checks out `main`;
2. runs the CI gate on the checked-out commit;
3. writes the public key to the runner temp folder;
4. runs `release.mjs --build-only`;
5. writes the private key only for the signing step and runs `--finish` or `--finish --no-publish`.

The workflow needs three repository secrets: `KOLUX_RELEASE_PUBKEY`, `KOLUX_RELEASE_KEY`, and `KOLUX_RELEASE_KEY_PASSWORD`.

The owner's PC path and the workflow use the same script. The owner's PC path is the current one; the workflow exists for a runner-based release when the owner chooses it.

## What gets published

A release has three assets:

| Asset | Purpose |
|---|---|
| `Kolux RS_<version>_x64-setup.exe` | The NSIS installer |
| `Kolux RS_<version>_x64-setup.exe.sig` | The minisign signature |
| `latest.json` | The update manifest the app reads |

`latest.json` points at `https://github.com/TxaisX/kolux-rs/releases/download/v<version>/Kolux.RS_<version>_x64-setup.exe` and carries the signature and publication date.

## The installer

The installer is NSIS. It installs for the current user, adds `<install>\bin` to the user PATH, and removes exactly that entry at uninstall. A PATH longer than NSIS can hold is left alone, and the app finishes the registration on its first start.

The installer is not Authenticode-signed today. SmartScreen warns on first run. The update manifest is signed separately, so the app can still verify updates even though Windows cannot verify the publisher.

## Update behavior

Installed copies check `releases/latest/download/latest.json` at startup and every 30 minutes, with backoff after a failure. The app downloads the installer into memory, verifies the signature, checks the Windows publisher, and installs through the NSIS passive mode. The manifest is published last so a client never sees a version before its installer exists.

Two paths are still being proven:

- **Quit-to-install.** The app can install a downloaded update when it quits, but the end-to-end proof is open. Use **Restart to update** when the app offers it.
- **Authenticode.** The installer has no publisher signature yet, so the Windows publisher check is permissive by design.

[Status](../STATUS.md) tracks both.

## Rollback

There is no automatic rollback. If a release is bad:

1. Publish a new patch with the fix as soon as CI is green.
2. Tell users to use **Restart to update** or download the previous installer from the Releases page.
3. If the bad release must be hidden, delete the release or mark it as a pre-release, but remember that `releases/latest` is what installed copies read.

Do not force-push `main` to undo a release. The release marker and the update feed are tied to commits, and rewriting history breaks the trail.

## Release checklist

- [ ] `git status` is clean, or the only changes are the ones you intend to ship.
- [ ] CI is green on the commit.
- [ ] The signing key and its `.pub` are present.
- [ ] `gh auth status` is good for the repository.
- [ ] `pnpm release --dry-run` prints the expected version and notes.
- [ ] The release job finishes without an error.
- [ ] The GitHub release has the installer, `.sig`, and `latest.json`.
- [ ] A clean install of the new version starts and shows the new version in Help, About.
- [ ] An installed older copy sees the update and installs it with **Restart to update**.
