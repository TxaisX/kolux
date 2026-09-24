# Secrets Detection Patterns

Regex catalog for the most-leaked secret types. Source-grade reference: combine with entropy filtering and path filters (skip test fixtures, `.env.example`, vendored dirs).

**Important**: never read or display the contents of `.env*` files. This skill respects the project rule. Detection is for source code, committed configs, container ENVs, CI logs — not for the user's actual env files.

---

## Cloud Provider Keys

| Secret | Regex |
|---|---|
| AWS Access Key ID | `\b(AKIA\|ASIA)[0-9A-Z]{16}\b` |
| AWS Secret Access Key | `(?i)aws(.{0,20})?['"][0-9a-zA-Z/+]{40}['"]` |
| AWS Session Token | `\bFQoG[A-Za-z0-9/+=]{100,}\b` |
| GCP API Key | `\bAIza[0-9A-Za-z_\-]{35}\b` |
| GCP OAuth Client | `\b[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com\b` |
| GCP Service Account JSON | `"type"\s*:\s*"service_account"` co-located with `"private_key"` |
| Azure Storage Account Key | `\b[A-Za-z0-9+/]{86}==\b` (88 chars) — needs context |
| Azure SAS Token | `sv=\d{4}-\d{2}-\d{2}.*&sig=` |

---

## VCS / DevOps

| Secret | Regex |
|---|---|
| GitHub PAT (classic) | `\bghp_[A-Za-z0-9]{36}\b` |
| GitHub OAuth Token | `\bgho_[A-Za-z0-9]{36}\b` |
| GitHub Server-to-Server | `\bghs_[A-Za-z0-9]{36}\b` |
| GitHub Refresh Token | `\bghr_[A-Za-z0-9]{36}\b` |
| GitHub Fine-Grained PAT | `\bgithub_pat_[A-Za-z0-9_]{82}\b` |
| GitHub App Installation Token | `\bv1\.[A-Fa-f0-9]{40}\b` |
| GitLab PAT | `\bglpat-[A-Za-z0-9_\-]{20}\b` |
| GitLab Runner Token | `\bGR1348941[A-Za-z0-9_\-]{20}\b` |
| Bitbucket App Password | (no fixed prefix; rely on context + entropy) |

---

## Payments / Commerce

| Secret | Regex |
|---|---|
| Stripe Live Secret | `\bsk_live_[A-Za-z0-9]{24,}\b` |
| Stripe Live Publishable | `\bpk_live_[A-Za-z0-9]{24,}\b` |
| Stripe Restricted | `\brk_live_[A-Za-z0-9]{24,}\b` |
| Stripe Test | `\bsk_test_[A-Za-z0-9]{24,}\b` (still flag — leaks env shape) |
| Square Access | `\bsq0(atp\|csp)-[A-Za-z0-9_\-]{22,}\b` |
| Shopify Access Token | `\bshp(at\|ca\|pa\|ss)_[a-f0-9]{32}\b` |
| PayPal Braintree | (no fixed prefix; check for `production_*` patterns) |

---

## AI / LLM

| Secret | Regex |
|---|---|
| OpenAI (legacy) | `\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b` |
| OpenAI Project | `\bsk-proj-[A-Za-z0-9_\-]{40,}\b` |
| Anthropic | `\bsk-ant-(api03\|admin01)-[A-Za-z0-9_\-]{80,}\b` |
| HuggingFace | `\bhf_[A-Za-z0-9]{34}\b` |
| Replicate | `\br8_[A-Za-z0-9]{37}\b` |
| Cohere | (no fixed prefix; rely on entropy) |
| Together.ai | (no fixed prefix; rely on entropy) |

---

## Communication / Collaboration

| Secret | Regex |
|---|---|
| Slack Bot Token | `\bxoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}\b` |
| Slack User Token | `\bxoxp-[0-9]{10,}-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{32}\b` |
| Slack Workspace | `\bxoxa-[0-9]+-[A-Za-z0-9]+\b` |
| Slack App | `\bxapp-[0-9]+-[A-Za-z0-9]+\b` |
| Slack Webhook | `https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]{24}` |
| Discord Token | `\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}\b` |
| Discord Webhook | `https://(canary\.\|ptb\.)?discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_\-]+` |
| Microsoft Teams Webhook | `https://[a-z]+\.webhook\.office\.com/webhookb2/[a-f0-9\-]+@[a-f0-9\-]+/IncomingWebhook/[a-f0-9]+/[a-f0-9\-]+` |

---

## Email / SMS

| Secret | Regex |
|---|---|
| SendGrid | `\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b` |
| Mailgun | `\bkey-[a-f0-9]{32}\b` |
| Mailchimp | `\b[a-f0-9]{32}-us[0-9]{1,2}\b` |
| Postmark | `\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b` (UUID — needs context) |
| Twilio Account SID | `\bAC[a-f0-9]{32}\b` |
| Twilio API Key | `\bSK[a-f0-9]{32}\b` |
| Twilio Auth Token | `\b[a-f0-9]{32}\b` co-located with `AC[a-f0-9]{32}` |

---

## Generic / Cryptographic

| Secret | Regex |
|---|---|
| JWT | `\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b` |
| RSA/EC/PGP/DSA Private Key | `-----BEGIN ((RSA\|EC\|OPENSSH\|PGP\|DSA) )?PRIVATE KEY( BLOCK)?-----` |
| OpenSSH Private | `-----BEGIN OPENSSH PRIVATE KEY-----` |
| PuTTY Private (.ppk) | `^PuTTY-User-Key-File-` |
| PFX/PKCS12 | binary file `.pfx` / `.p12` |
| Hardcoded Password | `(?i)(password\|passwd\|pwd\|secret\|api[_-]?key\|token)\s*[:=]\s*['"][^'"\s]{6,}['"]` |
| DB Connection String | `\b(postgres\|postgresql\|mysql\|mongodb(\+srv)?\|redis\|amqp)://[^\s'"]+:[^\s'"]+@[^\s'"]+\b` |
| Generic High-Entropy | length ≥ 32, base64/hex charset, Shannon entropy ≥ 4.5 |

---

## Detection Algorithm

For every regex hit:

1. **Path filter** — skip files matching:
   - `**/test/**`, `**/__tests__/**`, `**/tests/**`, `*.test.{js,ts,py,rb,go}`, `*.spec.*`
   - `**/fixtures/**`, `**/__fixtures__/**`
   - `.env.example`, `.env.template`, `.env.sample`
   - `**/node_modules/**`, `**/vendor/**`, `**/.venv/**`
   - `**/docs/**` when the value is clearly placeholder

2. **Placeholder filter** — common dummies that should not flag:
   - `XXXXX`, `YYYYY`, `your_key_here`, `<YOUR_KEY>`, `placeholder`, `example`, `dummy`, `test_key`
   - Strings with `0123456789` or `abcdefghij` runs

3. **Entropy filter** — compute Shannon entropy:
   - `< 3.5` → likely placeholder, skip
   - `3.5–4.5` → flag as Low (might be real)
   - `≥ 4.5` → flag as High

4. **Context check** — look at surrounding identifier:
   - Variable named `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL` → high confidence.
   - In a comment that says "example" or "TODO" → reduce confidence.

5. **Verify (where possible)** — TruffleHog v3 verifies against the live API. **Do not** verify in environments where you don't control egress; verifying a key sends it to the third-party endpoint.

---

## Severity for Secret Findings

| Source location | Severity |
|---|---|
| Production-pattern key (`sk_live_`, `AKIA`, `ghp_`) committed to git | **Critical** — assume compromised; rotate immediately |
| Same key in CI logs / build artifacts | **Critical** |
| Test/dev key in production code | **High** — may indicate environment confusion |
| Key in `.env.example` with real value | **High** |
| Key in Docker image layer | **High** — `docker history` exposes |
| Placeholder/example key | **Info** — note for awareness |

---

## Common Sources of Leaks

1. `.env*` files committed (most common — protect via `.gitignore`).
2. Hardcoded in source for "quick test", forgotten.
3. Container `ENV` directive — visible in `docker history`.
4. Kubernetes `env: [{ value: ... }]` instead of `valueFrom: { secretKeyRef: ... }`.
5. CI logs (`echo $SECRET` in shell scripts).
6. Error responses leaking config (`Error: connect ECONNREFUSED ... at sk_live_...`).
7. Client bundles — Next.js `NEXT_PUBLIC_*` containing private values.
8. Public S3 buckets / storage with `.env` / `config.yaml`.
9. Frontend source maps shipping to prod.
10. Third-party services reflecting auth headers (Sentry, Datadog tags).

---

## Remediation When a Secret Is Found

1. **Rotate immediately** — assume the secret is in attacker hands the moment it touches a public surface.
2. **Audit usage logs** — most providers expose key-usage logs (CloudTrail, Stripe Dashboard, GitHub audit).
3. **Remove from git history** — `git filter-repo` or BFG; force-push; coordinate with team. *Note: if the repo is public and was public at the time of the leak, assume it's been mirrored. Rotation is the only real fix.*
4. **Add a pre-commit hook** — Gitleaks / TruffleHog protect.
5. **Migrate to a proper secret store** — AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Doppler, 1Password Secrets Automation.
6. **Add detection to CI** — fail the build on new secret introductions.
7. **Document the incident** — for compliance + lessons learned.

---

## Tooling

- [gitleaks](https://github.com/gitleaks/gitleaks) — fast, configurable, CI-friendly
- [trufflehog](https://github.com/trufflesecurity/trufflehog) — verifies live keys
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning) — built-in for public repos, partner regex set
- [detect-secrets](https://github.com/Yelp/detect-secrets) — pre-commit hook
- [Doppler](https://www.doppler.com/) / [Infisical](https://infisical.com/) — secret management at runtime
