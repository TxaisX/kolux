# Threat Modeling — The 10 Questions

Before declaring code "secure", an agent must answer all of these. If any answer is "I don't know" — the code is **not** cleared.

This is the discipline a senior security engineer applies. It takes minutes per code path, not hours.

---

## 1. Trust Boundaries

**Where does data cross from untrusted (user, network, file, env, repo, third-party API) to trusted (DB, command, render, log, RPC)?**

List every crossing. For each, a contract must be enforced:
- Validation (shape, type, length, charset, range)
- Authentication (who is this?)
- Authorization (are they allowed?)
- Sanitization for the destination context

**Examples**:
- HTTP body → DB query (SQL boundary — parameterize)
- HTTP body → file path (FS boundary — resolve + prefix-check)
- HTTP body → shell command (process boundary — array args, no shell)
- HTTP body → HTML render (DOM boundary — escape per context)
- HTTP body → outbound URL (network boundary — allowlist + private-IP block)
- Cloud webhook → state mutation (signature verification before processing)
- Repo file → agent execution (don't auto-run; surface to user)

---

## 2. Authentication & Authorization

**Is identity verified server-side on every state-changing operation? Is *ownership* (not just role) checked?**

Not just: "is the user logged in?" but:
- Is the resource being modified owned by the current user (or accessible to their tenant)?
- Is there a `WHERE userId = current_user_id` (or equivalent) on every query that returns user data?
- Are admin checks done server-side, not just by hiding UI?

**Anti-patterns**:
- `findById(id)` returning data without ownership check (IDOR / BOLA)
- Admin actions guarded only by URL obscurity
- Auth check done in middleware only, not re-checked in handler (CVE-2025-29927 class)
- `User.update(req.body)` accepting arbitrary fields (mass assignment / BOPLA)
- Role check in client code, no server enforcement
- `assert user.is_admin` in Python (stripped in `-O` mode)

---

## 3. Input Validation

**Is there a schema (zod / Pydantic / class-validator / JSON Schema) validating type, shape, length, charset, range — and does it run *before* any side effect?**

Validation must be:
- **At the boundary** — every API endpoint, every Server Action, every webhook handler.
- **Strict** — reject unknown fields, not just missing required ones (`disallowUnknownFields`).
- **Pre-effect** — validate before any DB query, file write, network call.
- **Type-coercing safely** — `Number(input)` not `+input`; `String(input)` to defeat NoSQL injection.

**Detection**: handlers that destructure `req.body` and immediately use it without a schema parse step.

---

## 4. Output Encoding

**Is data escaped for the destination context (HTML / SQL / shell / log / URL / header / JSON / XML / LDAP)?**

The same string needs different escapes for different contexts. Wrong context = wrong escape = vulnerability.

| Destination | Escape mechanism |
|---|---|
| HTML body | Default React/Vue/Svelte escaping; `DOMPurify.sanitize` if HTML allowed |
| HTML attribute | Same as body but attention to event handlers |
| `<script>` | JSON-encode + careful whitespace |
| URL component | `encodeURIComponent` |
| URL path | `encodeURI` |
| SQL | parameterized queries / prepared statements |
| Shell | array args (`execFile`), no shell |
| Logger | structured fields, separate "value" from "format string" |
| LDAP | `escape_filter_chars` |
| XML | XML-aware library, never string concat |
| JSON | `JSON.stringify` (correct by default) |
| CSV | prefix `=`, `+`, `-`, `@`, tab, CR with `'` to neutralize formula injection |
| Email header | reject CRLF; libraries handle this if used correctly |

---

## 5. Secrets

**Are secrets in env / vault / KMS — never in code, logs, client bundles, or error responses? Is there a rotation plan?**

- Source code → `process.env.X` (or platform equivalent)
- Env vars → only at runtime; never baked into images
- Logs → redact known secret-shaped values
- Client bundles → review what's in `NEXT_PUBLIC_*` / Vite `import.meta.env.VITE_*` / publicEnv
- Error responses → never echo configuration values
- Container `ENV` → never set secrets via `ENV` directive
- Kubernetes → `secretRef`, never `value:`
- Git history → run gitleaks on full history
- Rotation plan → documented, tested, executed at each incident

---

## 6. Failure Mode

**On error, does the system fail closed (deny) or open (allow)?**

- Auth check throws → return 401/403, **never** proceed-as-anonymous.
- Authz check throws → return 403, never `null` user that downstream treats as service-account.
- Rate limiter unreachable → block, don't allow unbounded.
- Token verification fails → reject the request, don't fall back to "no auth".
- Crypto verification fails → reject the data, don't accept unverified.

**Detection**: `try { auth() } catch { /* swallow */ }` patterns. `if (user) { ... }` without `else { 403 }`.

Also check: are stack traces and DB error messages hidden from clients in production? They're a goldmine for attackers.

---

## 7. Blast Radius

**If this code is fully owned by an attacker, what else falls?**

- Network egress — can the compromised process reach the internet? Internal services? Cloud metadata?
- File system — what else can it read/write? `~/.ssh`, `~/.aws`, sibling tenants' data?
- Sibling tenants — does the architecture isolate them, or is one bug → all-tenant compromise?
- Cloud metadata — IMDSv2 enforced? Without it, SSRF → IAM credential theft (Capital One 2019 class).
- CI/CD — if a service token leaks, what can it deploy / push / delete?

**Architectural defenses**:
- NetworkPolicy default-deny in k8s; egress allowlist
- IAM least-privilege; per-service roles, not shared "app" role
- IMDSv2 required on all EC2
- Container `runAsNonRoot`, `readOnlyRootFilesystem`, drop ALL capabilities
- Per-tenant DB rows scoped by RLS or query filter (every query)
- CI tokens scoped to specific repos and minimum verbs

The blast radius determines whether a Medium bug is actually a Critical.

---

## 8. Supply Chain

**Are dependencies pinned (lockfile + SHA where possible)? Has anything new been added in this PR?**

- `package-lock.json` / `pnpm-lock.yaml` / `Cargo.lock` / `poetry.lock` committed
- New deps reviewed for: maintainer reputation, recent activity, install-script analysis (`npm install` ran arbitrary code on machines until npm fixed)
- GitHub Actions pinned to full SHAs, not tags (CVE-2025-30066)
- Docker images pinned to digest, not `:latest`
- `<script src>` to third-party domains have SRI hashes
- Internal package registry preferred over npm/PyPI proxy

**Run on every PR**: `npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, `osv-scanner`, `trivy`.

---

## 9. Logging & Detection

**Is there a log line for the security-relevant event? Is sensitive data redacted?**

Log:
- Authentication attempts (success + failure)
- Authorization denials
- Admin actions
- Key/secret use (which key, when, by whom)
- Rate-limit triggers
- Anomalous patterns (mass deletion, mass export, off-hours admin login)

Redact:
- Passwords, tokens, API keys, JWTs (even structured fields containing them)
- PII per regulation (GDPR, CCPA — depends on context)
- Full URLs containing query-string secrets
- Stack traces in production responses (log server-side only)

**Detection**: `console.log(req.body)`, `logger.info(error.stack)`, `logger.info('login', { email, password })`.

---

## 10. Replay Protection

**Are idempotency keys, nonces, CSRF tokens, and rate limits in place where needed?**

- **Payments** — idempotency key on every charge attempt; clients retrying network errors must not double-charge.
- **State-changing endpoints** — CSRF token (or SameSite=Strict cookies + Origin check).
- **Login / reset / signup** — rate limit per IP and per account.
- **Replayable tokens** — single-use, expire ≤ 15 min for security tokens.
- **Webhook receivers** — nonce + signature verification; reject duplicate event IDs.
- **OAuth** — `state` parameter (CSRF) + PKCE for public clients.

---

## How to Apply

For any change you're reviewing or generating, walk the 10 questions out loud:

```
1. Trust boundary: <where does data cross?>
2. AuthN/AuthZ: <verified server-side? Ownership checked?>
3. Input validation: <schema at boundary?>
4. Output encoding: <correct context?>
5. Secrets: <safe storage?>
6. Failure mode: <fail closed?>
7. Blast radius: <what falls if owned?>
8. Supply chain: <deps pinned?>
9. Logging: <event logged? PII redacted?>
10. Replay: <protections in place?>
```

If you can answer each crisply, the code is plausibly secure. If any answer is "uncertain" or "not applicable" — pause and verify, don't approve.

---

## Severity Calibration via Threat Model

The same bug can be Critical or Low depending on the answers above:

- **SQLi on a public unauth endpoint** → Critical (no AuthN, full data exposure, blast radius = whole DB).
- **SQLi on an admin endpoint behind MFA + IP allowlist + read-only role** → High (still serious, but blast radius reduced).
- **SQLi in an internal CLI script run by SREs** → Medium (small attack surface but still a fix-this-sprint bug).

Don't rate by class alone. Rate by **(class × exploitability × blast radius)**.

---

## Common Findings That Should Trip All 10 Questions

- A new public API endpoint
- A new Server Action
- A new admin route
- A new file-upload handler
- A new outbound webhook receiver
- A new cron / background job processing user data
- A new IAM policy or k8s manifest
- A new third-party dependency

Walk the 10 every time.
