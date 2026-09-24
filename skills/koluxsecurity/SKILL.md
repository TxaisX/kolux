---
name: koluxsecurity
description: >-
  Senior security-engineer instincts for AI coding agents. Activate whenever the
  agent reads, writes, reviews, or refactors code — backend, frontend,
  infrastructure-as-code, CI/CD pipelines, container manifests, or cloud config.
  Detects and prevents vulnerabilities across OWASP Top 10, OWASP API Top 10,
  OWASP LLM Top 10, and CWE Top 25: injection (SQLi, NoSQLi, command, template),
  SSRF, XSS, CSRF, IDOR/BOLA/BOPLA, path traversal, insecure deserialization,
  auth/authz flaws, JWT misuse, weak crypto, secrets exposure, supply-chain
  risks, container/Kubernetes hardening, cloud misconfig (S3, IAM, RDS), GitHub
  Actions injection, prototype pollution, ReDoS, race conditions, mass
  assignment, open redirect, XXE, Server Action authorization, hydration data
  leaks. Covers JavaScript/ TypeScript, Python, Go, Rust, Java/Spring,
  Ruby/Rails, PHP, React/Next.js. Critical for any agent shipping code to
  production.
---

# KoluxSecurity

This discovery stub loads the version-matched KoluxSecurity guide that ships with Kolux.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `KOLUX_CLI_COMMAND` environment variable is set, use its value. Kolux exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `KOLUX_DEV_REPO_ROOT`, use `kolux-dev`.
- Otherwise, on Linux outside a Kolux-managed terminal, use `kolux-ide`. Never run bare
  `kolux` there — outside Kolux's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `kolux`.

Below, `KOLUX` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `KOLUX` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Kolux build.

## Load the version-matched guide before reviewing or writing code

```text
KOLUX skills get koluxsecurity
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Kolux is not running, start it with `KOLUX open --json`
and retry. If `skills get` is unknown, explain that updating Kolux restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
