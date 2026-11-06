<#
.SYNOPSIS
  Clean-room firewall check for the Kolux spec files.
.DESCRIPTION
  Greps the behaviour spec for things that must never cross from the old code base:
  source paths, code-file names, camelCase / snake_case / SCREAMING_SNAKE identifiers,
  multi-hump PascalCase component names, code keywords, inline or fenced code that is not a
  `kolux` command, and the old app's library names. Tokens in scripts/firewall-allowlist.txt
  are accepted. Prints every hit as file:line [rule] match and exits 1 when hits > 0.

  -Baseline (T-541, the gate CI and the merge gate run): scans only spec/*.md, SPEC.md and
  COMPAT.md, and fails only on hits that are not in scripts/firewall-baseline.txt. A baseline
  entry is "file [rule] match" (no line number, so notes added above a hit do not move it); the
  same entry listed twice allows two such hits. PROVENANCE.md and DECISIONS.md are logs and stay
  outside the gate. -WriteBaseline rewrites the baseline from the current hits; run it only in a
  coordinator-reviewed spec commit, never to make a builder's hit pass.
.EXAMPLE
  powershell -NoProfile -File scripts/firewall-check.ps1            # all spec files, every hit
  powershell -NoProfile -File scripts/firewall-check.ps1 -Path spec/03-terminals-panes.md
  pwsh -NoProfile -File scripts/firewall-check.ps1 -Baseline        # the gate: new hits only
  pwsh -NoProfile -File scripts/firewall-check.ps1 -Baseline -WriteBaseline
#>
param(
  [string[]]$Path,
  [switch]$Quiet,
  [switch]$Baseline,
  [switch]$WriteBaseline
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$baselineFile = Join-Path $PSScriptRoot 'firewall-baseline.txt'
if ($Baseline -or $WriteBaseline) {
  # The gate's scope is fixed: the spec cards and the two behaviour companions builders read.
  $Path = @('SPEC.md', 'COMPAT.md') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
  $Path += (Get-ChildItem (Join-Path $root 'spec') -Filter *.md | Sort-Object Name | ForEach-Object FullName)
} elseif (-not $Path -or $Path.Count -eq 0) {
  $Path = @('SPEC.md', 'PRIORITIES.md', 'COMPAT.md', 'DECISIONS.md', 'PROVENANCE.md') |
    ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
  $specDir = Join-Path $root 'spec'
  if (Test-Path $specDir) { $Path += (Get-ChildItem $specDir -Filter *.md | ForEach-Object FullName) }
}
$allowFile = Join-Path $PSScriptRoot 'firewall-allowlist.txt'
$allowExact = New-Object 'System.Collections.Generic.HashSet[string]'
$allowRe = @()
foreach ($line in Get-Content $allowFile -Encoding UTF8) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#')) { continue }
  if ($t.StartsWith('re:')) { $allowRe += $t.Substring(3) } else { [void]$allowExact.Add($t) }
}
function Allowed([string]$m) {
  if ($allowExact.Contains($m)) { return $true }
  foreach ($r in $allowRe) { if ($m -match $r) { return $true } }
  return $false
}
# Repo-relative path with forward slashes (works on Windows PowerShell 5.1 and pwsh alike).
function RelPath([string]$file) {
  $full = (Resolve-Path $file).Path
  $prefix = $root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  if ($full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { $full = $full.Substring($prefix.Length) }
  return $full.Replace('\', '/')
}
$rules = @(
  @{ name = 'old-src-path';   re = '(?<![\w-])(src|tests|docs|resources|scripts|cli|relay)[\\/][\w.\\/-]+' },
  @{ name = 'code-file';      re = '(?<![\w/.-])[\w.-]+\.(tsx?|jsx?|mjs|cjs|json|ya?ml|html|css|scss|ps1|sh|sql|md|svg|webp|png)(?![\w-])' },
  @{ name = 'camelCase';      re = '\b[a-z]+(?:[A-Z][a-z0-9]+)+\b' },
  @{ name = 'snake_case';     re = '\b[a-z0-9]+(?:_[a-z0-9]+)+\b' },
  @{ name = 'SCREAMING_SNAKE';re = '\b[A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b' },
  @{ name = 'PascalCase-3';   re = '\b(?:[A-Z][a-z0-9]+){3,}\b' },
  @{ name = 'PascalCase-sfx'; re = '\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*(Pane|Service|Handler|Manager|Store|Dialog|Provider|Controller|Component|Hook|Types|Utils|Config|Registry|Daemon|Server|Client|Module|Reducer|Context|Bridge)\b' },
  @{ name = 'code-keyword';   re = '=>|\bconst\s+\w+\s*=|\bfunction\s*\w*\s*\(|\bimport\s+[{\w*]|\brequire\(|\bexport\s+(const|function|default|class)\b|\bawait\s+\w+\(' },
  @{ name = 'old-library';    re = '\b(?i:electron|pnpm|node-pty|zustand|tailwind|radix|lucide|vitest|playwright|xterm|monaco|vite|electron-builder|electron-updater)\b|\bReact\b' }
)
$found = New-Object 'System.Collections.Generic.List[object]'
function Hit([string]$file, [int]$n, [string]$rule, [string]$match) {
  $found.Add([pscustomobject]@{ File = $file; Line = $n; Rule = $rule; Match = $match })
}
foreach ($file in $Path) {
  if (-not (Test-Path $file)) { Write-Warning "missing: $file"; continue }
  $rel = RelPath $file
  $lines = @(Get-Content $file -Encoding UTF8)
  $inFence = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $n = $i + 1
    # fenced blocks: allowed only when the first content line is a kolux command
    if ($line -match '^\s*```') {
      if (-not $inFence) {
        $inFence = $true
        $first = if ($i + 1 -lt $lines.Count) { $lines[$i + 1].Trim() } else { '' }
        if ($first -notmatch '^(\$ )?kolux(\s|$)') { Hit $rel $n 'fenced-code' $first }
      } else { $inFence = $false }
      continue
    }
    if ($inFence) { continue }
    # inline backticks must be kolux commands, flags, or allowlisted interface tokens
    foreach ($m in [regex]::Matches($line, '`([^`]+)`')) {
      $inner = $m.Groups[1].Value.Trim()
      if (-not (Allowed $inner)) { Hit $rel $n 'inline-code' $inner }
    }
    $stripped = [regex]::Replace($line, '`[^`]+`', ' ')
    foreach ($rule in $rules) {
      foreach ($m in [regex]::Matches($stripped, $rule.re)) {
        if (-not (Allowed $m.Value)) { Hit $rel $n $rule.name $m.Value }
      }
    }
  }
}
function Key($h) { return '{0} [{1}] {2}' -f $h.File, $h.Rule, $h.Match }
$utf8 = New-Object System.Text.UTF8Encoding($false)

if ($WriteBaseline) {
  $head = @(
    '# Firewall baseline (T-541): hits in spec/*.md, SPEC.md and COMPAT.md accepted on the date below.',
    '# One line per hit: "file [rule] match". scripts/firewall-check.ps1 -Baseline fails only on hits not listed here.',
    '# Regenerate with -WriteBaseline only in a coordinator-reviewed spec commit; never to let a builder hit pass.',
    ('# Written ' + (Get-Date -Format 'yyyy-MM-dd') + ': ' + $found.Count + ' hit(s).')
  )
  $body = @($found | ForEach-Object { Key $_ } | Sort-Object -CaseSensitive)
  [System.IO.File]::WriteAllLines($baselineFile, [string[]]($head + $body), $utf8)
  "firewall-check: baseline written, {0} hit(s) -> scripts/firewall-baseline.txt" -f $found.Count
  exit 0
}

if ($Baseline) {
  if (-not (Test-Path $baselineFile)) { "firewall-check: scripts/firewall-baseline.txt is missing"; exit 1 }
  $allowed = @{}
  foreach ($l in [System.IO.File]::ReadAllLines($baselineFile, $utf8)) {
    if (-not $l -or $l.StartsWith('#')) { continue }
    if ($allowed.ContainsKey($l)) { $allowed[$l]++ } else { $allowed[$l] = 1 }
  }
  $new = 0
  foreach ($h in $found) {
    $k = Key $h
    if ($allowed.ContainsKey($k) -and $allowed[$k] -gt 0) { $allowed[$k]--; continue }
    $new++
    if (-not $Quiet) { "NEW {0}:{1} [{2}] {3}" -f $h.File, $h.Line, $h.Rule, $h.Match }
  }
  $gone = 0
  foreach ($v in $allowed.Values) { $gone += $v }
  "firewall-check -Baseline: {0} hit(s) in {1} file(s), {2} new, {3} baseline entr(ies) no longer present" -f $found.Count, $Path.Count, $new, $gone
  if ($new -gt 0) { exit 1 } else { exit 0 }
}

if (-not $Quiet) { foreach ($h in $found) { "{0}:{1} [{2}] {3}" -f $h.File, $h.Line, $h.Rule, $h.Match } }
"firewall-check: {0} hit(s) across {1} file(s)" -f $found.Count, $Path.Count
if ($found.Count -gt 0) { exit 1 } else { exit 0 }
