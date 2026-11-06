# Contributing

Kolux is in early alpha. Bug reports and feedback are welcome. Code changes are considered case by case, so open an issue before you start a substantial one.

## Report a bug

Open an [issue](https://github.com/TxaisX/kolux/issues) with:

- the version, from Help, About;
- your Windows version;
- what you did, what you expected, and what happened;
- a diagnostics report from Settings, General, Diagnostics, **Copy diagnostics**. It masks keys, tokens, and passwords. **Write a review copy and open it** lets you read it before sharing.

If the problem involves a terminal, the pane menu also has **Copy terminal diagnostics**.

Do not paste real keys, tokens, cookies, or private repository contents into an issue.

## Request a feature

Describe the problem first, then the change you want. Say who it is for and what they do today instead. A small, concrete example is more useful than a long specification.

## Security

Do not open a public issue for a security problem. Follow the [security policy](SECURITY.md) and use GitHub's private vulnerability reporting.

## Code changes

Open an issue first. Once the scope is agreed:

1. Keep the change focused. Do not reformat unrelated files or mix a refactor with a behaviour change.
2. Add or update the test that proves the change. The test should fail before the change and pass after.
3. Run the gates:
   - `pnpm check`
   - `. .\scripts\test-env.ps1` then `cargo test`
   - `cargo clippy --all-targets -- -D warnings`
4. Update the user guide or architecture docs if the behaviour or a boundary changed.
5. For a visible change, include a screenshot from the app's own window in `evidence/`.

Match the style of the file you are editing. The code comments explain why, not what. Do not add a dependency for a small job an existing crate or the standard library already does.

Do not add attribution lines to commits, comments, or UI. Keep the work as the project's own.

## Clean-room provenance

Kolux is a clean-room rebuild. Every line is meant to be original work owned by the project owner. The old Kolux app was built on someone else's MIT-licensed code, so code derived from it cannot be used.

Do not copy, paraphrase, or paste from:

- the old Kolux repository, its install folder, its backups, or its workspace folders;
- Orca's source, or any fork of it;
- the old app's hook scripts under `~\.kolux\agent-hooks\`;
- any document that quotes file paths, function names, or code from those sources.

The allowed sources for behaviour are the spec in this repository (`SPEC.md`, `spec/`, `COMPAT.md`, `PRIORITIES.md`, `DECISIONS.md`, `PROVENANCE.md`) and public documentation for other tools.

If you have seen forbidden source, say so in your issue before contributing. If you realize a contribution was derived from it, stop and report it. A provenance breach voids the clean-room record, so it is better to ask than to guess.

## License and contribution terms

Kolux is source-available. Copyright (c) 2026 Txais Xiong. All rights reserved. See [LICENSE](LICENSE).

The source is public so you can read and review it. It is not open source. Do not send a substantial code change until the owner has agreed in the issue how the contribution will be licensed.

## Commit messages

Write an imperative subject under 72 characters that says what the user can now do or what was fixed. No attribution trailers. If the change needs a longer explanation, put it in the body, not in the subject.
