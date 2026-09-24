# Security Tooling Landscape

What an agent should know about, when to recommend each, and what each is best at. The agent should suggest these to users as part of remediation, and may invoke them via shell when appropriate.

---

## Static Analysis (SAST)

### Semgrep
**URL**: https://semgrep.dev | https://semgrep.dev/r
**Best for**: per-language pattern rules, fast, custom rules in YAML. The default first stop.
**Rule packs**: `p/owasp-top-ten`, `p/r2c-security-audit`, `p/javascript`, `p/typescript`, `p/python`, `p/golang`, `p/django`, `p/flask`, `p/react`, `p/nextjs`, `p/nodejs`, `p/ruby`, `p/rails`, `p/java`, `p/spring`, `p/secrets`.
**Run**: `semgrep --config p/owasp-top-ten --config p/secrets .`
**Cost**: free OSS, paid Pro engine for cross-file taint tracking.

### CodeQL
**URL**: https://github.com/github/codeql
**Best for**: deep dataflow / taint analysis. Highest signal, slowest.
**When**: high-assurance review, GitHub Advanced Security customers, before major releases.
**Cost**: free for public repos via GitHub Code Scanning; GHAS license for private repos.

### SonarQube / SonarCloud
**Best for**: managed teams wanting quality + security hotspots in a dashboard.
**Weakness**: weaker on novel patterns; rules are slower to update.

### Snyk Code (DeepCode)
**Best for**: ML-assisted SAST + dependency scanning combined; strong on JS/TS/Python; IDE integrations.

### Bearer
**URL**: https://github.com/Bearer/bearer
**Best for**: PII / data-flow / sensitive-data discovery. Maps where personal data flows. Complementary to traditional SAST.

---

## Container & IaC Scanning

### Trivy
**URL**: https://aquasecurity.github.io/trivy/
**Best for**: containers, IaC, deps, secrets. Single binary. Great default in CI.
**Run**: `trivy fs .`, `trivy image my/app:tag`, `trivy config terraform/`.

### Grype + Syft
**Best for**: SBOM generation (Syft) + vuln scan against SBOM (Grype). Generates CycloneDX/SPDX.

### Checkov
**URL**: https://www.checkov.io/
**Best for**: Terraform / CloudFormation / Kubernetes / Helm / Dockerfile / GitHub Actions / Bicep / Serverless. Most comprehensive IaC scanner.
**Run**: `checkov -d .`

### tfsec
**Best for**: Terraform-specific. Faster, simpler rules than Checkov. Now part of Trivy.

### terrascan
**Best for**: Multi-cloud IaC compliance (CIS, NIST, PCI, HIPAA).

### kube-bench
**Best for**: CIS Kubernetes Benchmark assessment of running clusters.

### kube-hunter
**Best for**: Penetration-testing-style probing of k8s clusters for misconfigs.

### kube-linter
**Best for**: Static analysis of k8s manifests pre-deploy.

### cfn-nag
**Best for**: AWS CloudFormation specifically.

---

## Secret Scanning

### Gitleaks
**URL**: https://github.com/gitleaks/gitleaks
**Best for**: pre-commit hooks, CI, full-history scans. Fast, configurable.
**Run**: `gitleaks detect --source . --redact`

### TruffleHog
**URL**: https://github.com/trufflesecurity/trufflehog
**Best for**: scanning git history + verifying live keys against provider APIs.
**Run**: `trufflehog git file://. --only-verified`

### detect-secrets
**Best for**: pre-commit hook with baseline file; less noisy on legacy repos.

### GitHub Secret Scanning
**Built-in for public repos**, partner regex set covering 100+ secret types. Push-protection blocks commits with detected secrets.

---

## Dependency Scanning

| Ecosystem | Tool |
|---|---|
| JS/Node | `npm audit`, `pnpm audit`, `yarn audit`, `socket.dev` (typosquat / install-time analysis), Snyk |
| Python | `pip-audit` (OSV-backed), `safety`, Snyk |
| Ruby | `bundle-audit`, Brakeman (also SAST) |
| Java | OWASP Dependency-Check, Snyk |
| Rust | `cargo audit`, `cargo-deny` (advisories + licenses) |
| Go | `govulncheck` (function-level reachability — much better signal than dep-only scanners) |
| Multi-eco | `osv-scanner` (Google, OSV.dev-backed), Trivy, Snyk |

### Dependabot / Renovate
**Best for**: auto-PR upgrades. Renovate is more configurable; Dependabot is GitHub-native.

---

## DAST (Dynamic Analysis)

Outside the typical agent scope but worth naming for reports:

- **OWASP ZAP** — free, scriptable, CI-friendly.
- **Burp Suite** — paid, gold standard for manual web pen-testing.
- **Nuclei** — templated DAST for known CVEs; useful for appliance fingerprinting in scope.

---

## Cloud Posture (CSPM)

- **Prowler** — AWS, GCP, Azure, M365. Open source, comprehensive.
- **ScoutSuite** — multi-cloud audit reports.
- **CloudSploit** — Aqua-owned, similar to Prowler.
- **Steampipe** — SQL-style queries over cloud APIs; great for custom audits.

---

## SAST/DAST Aggregators

- **DefectDojo** — vulnerability management; ingests many tools' output, deduplicates, tracks remediation.
- **Faraday** — collaborative pen-test workspace.

---

## Mobile

- **MobSF** — Static + dynamic analysis for Android/iOS apps.
- **frida** — Runtime instrumentation; bypassing client-side checks during testing.
- **objection** — frida-based scripting for common mobile testing tasks.
- **apktool** — APK decompilation.

---

## Default Agent Playbook

When reviewing a codebase or PR, the agent should suggest (or run, if permitted) this default stack:

```bash
# Static analysis (per language autoselect)
semgrep --config p/owasp-top-ten --config p/secrets --config auto .

# IaC (if present)
trivy config .
checkov -d .

# Container (if Dockerfile present)
trivy fs --security-checks vuln,config Dockerfile
hadolint Dockerfile

# Dependencies (per ecosystem)
npm audit                                    # or pnpm/yarn
pip-audit                                    # or safety
cargo audit                                  # if Rust
govulncheck ./...                            # if Go

# Secrets (full history)
gitleaks detect --source . --redact

# Cloud (if scope includes account)
prowler aws                                  # or aws/gcp/azure
```

Surface findings with **severity, file:line, fix recommendation**. Don't dump raw tool output — synthesize.

---

## Tool Selection Heuristics

- **Time budget low + general review needed** → Semgrep + Gitleaks + ecosystem dep scanner.
- **Pre-merge PR review** → Semgrep diff-aware mode + Trivy (if IaC/Dockerfile changed).
- **High-assurance audit** → CodeQL + Semgrep Pro + manual review of taint-flagged paths.
- **Mobile app review** → MobSF + manual review.
- **Cloud audit** → Prowler + Steampipe custom queries.
- **Container hardening** → Trivy + hadolint + dockle.
- **k8s cluster hardening** → kube-bench + kube-linter + Polaris.

---

## What Tools Don't Cover

Tools have blind spots. The agent's value-add is the *gap*:

- **Business logic flaws** — race conditions in payment flow, idempotency gaps, negative-quantity orders, coupon stacking. No SAST catches these.
- **Authorization gaps** — IDOR, BOLA, BOPLA. SAST flags missing auth, but not whether *ownership* is enforced.
- **Architecture-level issues** — secrets in single tenant trust boundary, multi-tenancy bleed-through.
- **Process gaps** — no rotation on incident, no incident-response runbook, no logging of security events.

Tools find what they have rules for. The agent reasons about what tools missed.

---

## Reporting Format

When surfacing tool findings, normalize to:

```
[severity] [tool] [file:line] [rule-id]
  Vulnerability: <one-line description>
  Code:
    <verbatim snippet>
  Why it's a problem: <one paragraph>
  Fix:
    <unified diff or replacement code>
  References: <CWE, CVE, doc link>
```

The agent's job is to consolidate, deduplicate, prioritize, and explain — not to dump.
