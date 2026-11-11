# Release 0.1.11 report (2026-11-10)

## Outcome
Kolux 0.1.11 is published on TxaisX/kolux (`v0.1.11`: `Kolux_0.1.11_x64-setup.exe`, `.sig`, `latest.json`). It was built from `acb30816`, and CI was green on that exact commit. The update feed at `releases/latest/download/latest.json` serves 0.1.11 with the hand-written notes from `CHANGELOG.md`.

## What shipped
| Area | Change | Tasks |
|---|---|---|
| Identity | Kolux RS becomes Kolux: productName "Kolux", identifier `com.txaisxiong.kolux`, crate `kolux_lib`, profile migration from the old name | T-790, DT-C221 |
| Untrusted folders | No push into local repos and no programs from a folder's own git config while the folder is untrusted | T-779 (DT-C241) |
| Agent hooks | Hook tokens hardened | T-793 (DT-C240) |
| Pre-trust | A worktree is pre-trusted only when HEAD is proven to be on the user's own `origin` branches, at creation and at every launch; fails closed on graft files, in-progress operations, legacy remotes, worktree-config remotes, case-twin remotes and non-ASCII destinations | T-780 rounds 3-5 + gaps |
| Console windows | Every production spawn is hidden (winproc), guarded by a source scanner test | T-816 |
| Performance | Out-of-sight window, hidden browser tabs suspended, idle animations stop after 10 s; release-build footprint benchmark | DT-C228-C230, DT-C239 |
| Dependencies | KaTeX 0.18.11 | - |

## Verification
- Full suite on the integration lane: clippy 0 warnings; cargo lib 3097 passed (one environmental failure that passes alone; t_152_b_2 fixed by the identity patch); other cargo binaries 247/0; agent_hooks 151/0; pnpm test 6522/6522; pnpm check OK; cargo-deny OK; firewall 0 new.
- Hidden-desktop smoke: 4/4 silent, no visible window, no focus taken.
- Identity update live proof (`evidence/T-790-fix-2026-11-09.txt`): U1-U7, U8b, U9, V, C 8/8, C2, Q 14/14 pass; U8 known (state.db-shm only).
- Release script: smoke (installer, `kolux --version`, `--help`, old-profile migration all report 0.1.11), signature verified against the app's public key, CI gate passed.

## Known effects for users (in the notes)
Pins are not carried over the rename; a failed update needs one click; the first agent start in a worktree with unpushed commits shows Claude's trust prompt once; repos without an `origin` remote lose pre-trust.

## Left
- T-778 (bridging key release) stays open; it was not a 0.1.11 condition.
- P3 notes, no action: `remote.pushDefault` over-refuses pre-trust; terminal chunk masking runs even for panes with no history.
- Accepted by design (T-780): trust already written is never revoked; uncommitted content is not judged.
