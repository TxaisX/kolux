# Security lanes backlog (held out of 0.1.11)

Txais, 2026-11-08: the two security lanes are **not** in 0.1.11. They stay on their own branches
and are worked from this list. 0.1.11 is `lane/ready-int` plus `lane/ready-identity` (T-790),
`lane/ready-nowin` (T-816) and `lane/ready-smoke` only.

Hard rules that still apply: `src-tauri/src/trust.rs` is read-only; any `hooks.rs` change needs an
independent review; `tauri.conf.json` changes arrive only as an evidence patch; nothing may open a
visible window or steal focus; never push to `main` or release without Txais's in-session yes.
Decided and not to be reopened: T-793 S1 stays unscoped; T-779 S4 is included.

## Status 2026-11-09 (cloud session)

`lane/ready-sec` was merged into `lane/ready-sec-2` (backlog step done). **Work from `lane/ready-sec-2`.**

| Lane head | What |
|---|---|
| `lane/ready-sec` `6707237e` | T-779 S4 plus review fixes 4–7, T-780 |
| `lane/ready-sec-2` `c0fea821` | T-793 fix 2 (tests run for the first time) and fix 3, the cards tests updated for per-pane tokens, and all of ready-sec |

Cloud gate on `lane/ready-sec-2` (Linux), against the pre-merge ready-int baseline `aa56260d`:
`pnpm check` OK, `pnpm test` 862 files / 6372 tests passed; `cargo test --tests`: the same tests fail
as on the baseline (Linux-only environment failures), plus one: `t779b_..._gpg_program_...`, whose
control step finds this container's git does not run gpg (it passed on Windows).

### Reviews done (independent, read-only)

- **T-793 fix 2 + every hooks.rs change on the lane** (the required hooks.rs review): hooks.rs no
  blocker (HMAC per RFC 4231, constant-time compare, secret never on disk or in a log). One CLI
  blocker (A1 `worktree rm`) and two should-fixes (A2, A3) — fixed in review fix 3 with red/green.
- **T-779 S4**, four rounds (6 blockers, then 2, then 1, then 2): fixed in review fixes 4–7 with
  red/green for each (`evidence/T-779.txt`). The last round's two push bypasses are fixed, and a
  git-level backstop was added (an untrusted push carries `protocol.file.allow=never`), but **the
  fix-7 commit itself has not had its own review yet.**

## To do, in order

1. **Independent review of T-779 review fix 7** (`6707237e`), focused on the push gate and the
   `protocol.file.allow=never` backstop. If it holds, T-779 is done in the cloud.
2. **Windows (Txais's PC):**
   - full `cargo test` and `cargo clippy --all-targets -- -D warnings` on `lane/ready-sec-2`;
   - red runs that need NTFS / Git for Windows: T-779 B6 (`<hook>.exe`, letter case, the old
     4096-entry listing cap) — see `evidence/T-779.txt`;
   - restart agents once after this update (T-793 B4 release note).
3. **Txais to confirm** the T-780 `trust.rs` edits (`a46017c`, `e4b2917`, made under the review-fix
   batch clearance, `evidence/T-780.txt`) before the lane is integrated.
4. Integrate `lane/ready-sec-2` into the next release's integration lane and run the full gate.

## Known limits left (nits, decide later)

- T-779: a hook written mid-command into a git dir that lies inside the worktree (`gitdir: ./g`,
  time-of-check/time-of-use); an incomplete submodule listing lets a pure ref change through without
  the submodules' hooks checked; `~`/`/c/` forms of `core.hooksPath`; transports other than the six
  named ones on an untrusted partial clone's read, and `remote.<n>.vcs` helpers (programs on PATH,
  not from the folder); git older than 2.31 ignores all injected config pairs.
- T-793: A5 `worktree create`'s default setup tab (gated by the setup-trust prompt); B1
  `cli::secret()` uses `RandomState`, not a CSPRNG; B2 a closed pane's endpoint file and token stay for
  the run; B3 `write_pane_file` truncates in place; B4 the shared spool file takes no token
  (same-user limit, DT-C240 (3)).
