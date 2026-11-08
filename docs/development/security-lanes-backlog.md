# Security lanes backlog (held out of 0.1.11)

Txais, 2026-11-08: the two security lanes are **not** in 0.1.11. They stay on their own branches
and are worked from this list. 0.1.11 is `lane/ready-int` plus `lane/ready-identity` (T-790),
`lane/ready-nowin` (T-816) and `lane/ready-smoke` only.

Hard rules that still apply: `src-tauri/src/trust.rs` is read-only; any `hooks.rs` change needs an
independent review; `tauri.conf.json` changes arrive only as an evidence patch; nothing may open a
visible window or steal focus; never push to `main` or release without Txais's in-session yes.
Decided and not to be reopened: T-793 S1 stays unscoped; T-779 S4 is included.

## lane/ready-sec (T-779 untrusted-folder git protections; T-780 pre-trust)

Head after 2026-11-08 cloud session: `f7a07019`.

State:
- Review fix 3 (B1, B2, S1-S3) done and gated earlier (`evidence/T-779.txt`).
- S4 code complete: in an untrusted folder a write, ref change or transfer is refused when the folder
  has its own credential helper (transfers), `core.hooksPath`, an executable hook the command would
  start, a merge driver (merging commands), or `remote.<name>.uploadpack`/`receivepack` (transfers).
  `core.sshCommand` and `core.gitProxy` are replaced through `GIT_SSH_COMMAND`/`GIT_PROXY_COMMAND`
  (the user's own value or git's default).
- Change from the WIP: upload-pack/receive-pack are REFUSED, not replaced. git keeps the first value it
  reads for those keys and the folder's config is read before anything Kolux passes, so the WIP's
  replacement never took effect (verified by hand: the folder's program ran).
- Window hiding for git/scm/auto_pr was already finished in review fix 3; nothing left there.
- Cloud run (Linux): `cargo test --lib t779` 31 passed, 1 failed. The failure is
  `t779b_a_repositorys_own_gpg_program_never_runs_under_kolux_git_log`, whose control step finds the
  cloud container's git does not run gpg. It fails on the untouched WIP head too and passed on Windows.

To do, in order:
1. Windows: `cargo test --lib t779` and `cargo test --lib` + `cargo clippy --all-targets -- -D warnings`
   on Txais's PC. Record red runs for the S4 tests (revert S4's `write_access` additions and
   `net_overrides`) and the green run in `evidence/T-779.txt` under a "Review fix 4 / S4" heading.
2. Independent read-only review of S4 (git.rs `write_access`, `hook_in_the_way`, `hooks_run_by`,
   `ref_write`, `network`, `merges`, `net_overrides`, `user_net_values`; auto_pr.rs `commit_step`,
   `push_step`). Ask specifically about: commands missing from `network`/`merges`/`ref_write`
   (e.g. `submodule sync`, `bundle`, `archive --remote`, `gc --auto` hooks), `hooks_run_by` coverage,
   and a read in a partial clone that lazy-fetches (it would use the folder's credential helper or
   upload-pack; consider `GIT_NO_LAZY_FETCH=1`, git 2.44+, on reads in an untrusted folder).
3. Lane carries T-780 `trust.rs` edits (`a46017c`, `e4b2917`) made under the review-fix batch
   clearance (`evidence/T-780.txt`). Txais must confirm before they are integrated.
4. Then merge `lane/ready-sec` into `lane/ready-sec-2`.

## lane/ready-sec-2 (T-793 worker-pane scope + per-pane HMAC hook tokens, DT-C228)

Head: `9cd43f16`.

State:
- `41491bd7` (WIP) added the three `t793_fix2_*` tests and the DECISIONS/security.md text; the
  implementation (`starts_program`, `resets_dispatches` in `src-tauri/src/cli/mod.rs`) arrived in
  `9cd43f16` three minutes later from another session (Sonnet co-author). Its message says red runs
  are in `evidence/T-793.txt`; they are not: the file has nothing for fix 2.
- The lane changes `hooks.rs` (`1cc8b38`, `a59fb2d` B4); the evidence notes B4 "needs the
  opus-high-review again". No record of that review.

To do, in order:
1. Run `cargo test --lib t793` (fix 2 tests never ran) and record red (with `starts_program` /
   `resets_dispatches` reverted) and green in `evidence/T-793.txt`.
2. Independent read-only review of fix 2 (N1, N2, automations) AND of every `hooks.rs` change on the
   lane (required by the hooks.rs rule).
3. Merge `lane/ready-sec` in (after its step 4 above), rerun the full gate.
4. Release note when it ships: agents started before the update must be restarted once (B4).
