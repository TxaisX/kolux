# Security policy

Kolux is in early alpha. Security fixes land on the latest 0.1.x build. Older builds are not supported.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting:

https://github.com/TxaisX/kolux/security/advisories/new

Include:

- the affected version, from Help, About;
- your Windows version;
- the steps to reproduce;
- what an attacker could do;
- any proof of concept, with secrets removed.

I aim to acknowledge a report within 7 days. If the report is accepted, we will agree on a disclosure timeline, and I will credit you if you want.

## Scope

In scope:

- the app's own code and local services;
- the hook listener, the terminal service, and the CLI loopback;
- the update and release path;
- the file fence and the protected-action rules;
- storage and handling of keys and sign-ins.

Out of scope:

- vulnerabilities in third-party agents, their providers, or their CLIs;
- a command an agent runs because you approved it;
- problems that require an already-compromised machine;
- social engineering.

## Good-faith research

I will not pursue legal action for good-faith research that follows this policy, stays within your own installation and data, and does not disrupt other people. Do not access data that is not yours, and do not run destructive tests against machines you do not own.

## What the app sends

Kolux has no telemetry, analytics, or crash upload. The outbound connections are listed in Settings, General, Privacy and in the [user guide](docs/guide/safety.md).
