# Scratch homes for the Rust integration tests (src-tauri/tests/scratch_root): they refuse to run unless
# USERPROFILE, HOME, CLAUDE_CONFIG_DIR and CODEX_HOME all sit under a folder marked .kolux-scratch,
# so no test can touch the real Claude or Codex settings, and the agent-hooks fence refuses a temp folder
# that holds the home, so TEMP and TMP move to the scratch root too. APPDATA and LOCALAPPDATA are not
# redirected. The Rust toolchain keeps pointing at the real CARGO_HOME and RUSTUP_HOME. KRS_SCRATCH_ROOT keeps
# the root, so running it again in one session reuses it instead of nesting a new one under the TMP it set.
# Dot-source it in the shell that runs the tests (CI and the local gate):
#   . ./scripts/test-env.ps1; cargo test
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
if (-not $env:KRS_SCRATCH_ROOT) { $env:KRS_SCRATCH_ROOT = Join-Path $base 'krs-scratch' }
$root = $env:KRS_SCRATCH_ROOT
if (-not $env:CARGO_HOME) { $env:CARGO_HOME = Join-Path $env:USERPROFILE '.cargo' }
if (-not $env:RUSTUP_HOME) { $env:RUSTUP_HOME = Join-Path $env:USERPROFILE '.rustup' }
foreach ($d in 'home', 'claude-config', 'codex', 'tmp') { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }
New-Item -ItemType File -Force -Path (Join-Path $root '.kolux-scratch') | Out-Null
$env:USERPROFILE = Join-Path $root 'home'
$env:HOME = $env:USERPROFILE
$env:CLAUDE_CONFIG_DIR = Join-Path $root 'claude-config'
$env:CODEX_HOME = Join-Path $root 'codex'
$env:TEMP = Join-Path $root 'tmp'
$env:TMP = $env:TEMP
Write-Host "scratch homes under $root"
