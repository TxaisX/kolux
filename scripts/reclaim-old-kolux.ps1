<#
.SYNOPSIS
  Frees the disk space the old Kolux app's code folders take on this PC. Read docs/reclaim-old-kolux.md first.
.DESCRIPTION
  What it does, in plain words:
  - It finds the old Kolux code folders by reading LOOP.md in this repository (section 0, the
    "NEVER open" list: only the lines that start with a G:\Dev\ folder). They are the old repo,
    its scratch and workspace folders, and the backups of it: 5 folders. No folder name is written
    in this script, so it can never pick anything LOOP.md does not list.
  - If LOOP.md does not give exactly those 5 folders, all inside G:\Dev\, it stops: the list has
    changed and this script needs a review before it runs.
  - It refuses any folder that is not inside G:\Dev\, is G:\Dev itself, holds this repository, or
    is a link (junction or symlink) to somewhere else. It also stops if G:\Dev is a link.
  - It does not touch anything in your user folder (.kolux, .kolux-rs, .claude stay as they are).
  - It prints each folder and its size. Folders that are already gone are skipped.
  - It deletes NOTHING unless you start it with -Delete and then type DELETE when asked.
    It then removes each folder and prints how much space came back. If any folder could not be
    removed, it says so and ends with exit code 1.
  Run it on your Windows PC in PowerShell 7 (pwsh). Close the old app and Kolux first.
.EXAMPLE
  pwsh -NoProfile -File scripts/reclaim-old-kolux.ps1            # look only: list folders and sizes
  pwsh -NoProfile -File scripts/reclaim-old-kolux.ps1 -Delete    # remove them after you type DELETE
#>
#Requires -Version 7.0
param([switch]$Delete)
$ErrorActionPreference = 'Stop'
$expectedCount = 5

$repo = (Resolve-Path (Split-Path $PSScriptRoot -Parent)).Path.TrimEnd('\')
$loopFile = Join-Path $repo 'LOOP.md'
if (-not (Test-Path -LiteralPath $loopFile)) { throw "LOOP.md not found next to this script's folder ($loopFile)." }

# Section 0 of LOOP.md, then its "NEVER open" list (it ends at the next bold line).
$text = (Get-Content -LiteralPath $loopFile -Raw) -replace "`r", ''
$section = ($text -split "`n## 0\.", 2)[1]
if (-not $section) { throw 'LOOP.md has no section 0.' }
$section = ($section -split "`n## ", 2)[0]
$list = ($section -split '\*\*NEVER open', 2)[1]
if (-not $list) { throw "LOOP.md section 0 has no 'NEVER open' list." }
$list = ($list -split "`n\*\*", 2)[0]

$prefix = '- `G:\Dev\'
$found = @()
foreach ($line in ($list -split "`n")) {
  if (-not $line.StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
  foreach ($m in [regex]::Matches($line, '`(G:\\[^`]+)`')) { $found += $m.Groups[1].Value }
}

function Test-Inside([string]$child, [string]$parent) {
  $c = $child.TrimEnd('\') + '\'; $p = $parent.TrimEnd('\') + '\'
  return $c.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)
}

$underDev = @($found | Where-Object { $_.StartsWith('G:\Dev\', [StringComparison]::OrdinalIgnoreCase) }).Count
if ($found.Count -ne $expectedCount -or $underDev -ne $found.Count) {
  Write-Host "STOPPED: the folder list in LOOP.md section 0 has changed (found $($found.Count) folders, $underDev inside G:\Dev\; expected $expectedCount, all inside G:\Dev\)."
  Write-Host 'This script needs a review before it runs again. Nothing was deleted.'
  exit 1
}

if ((Test-Path -LiteralPath 'G:\Dev') -and (Get-Item -LiteralPath 'G:\Dev' -Force).LinkType) {
  Write-Host 'STOPPED: G:\Dev is a link to another place, so its folders may not be what they seem. Nothing was deleted.'
  exit 1
}

$targets = @()
foreach ($raw in $found) {
  $p = $raw.TrimEnd('\')
  if ($p -match '[\*\?\[\]]' -or $p -match '(^|\\)\.\.(\\|$)') { Write-Host "REFUSED (odd characters): $raw"; continue }
  if ($p -ieq 'G:\Dev' -or -not (Test-Inside $p 'G:\Dev')) { Write-Host "REFUSED (not inside G:\Dev\): $raw"; continue }
  if ((Test-Inside $repo $p) -or (Test-Inside $p $repo)) { Write-Host "REFUSED (this repository): $raw"; continue }
  $targets += $p
}

function Get-Size([string]$dir) {
  # PowerShell 7 does not follow folder links here, so a link's target is never counted.
  $sum = (Get-ChildItem -LiteralPath $dir -Recurse -Force -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum
  if ($null -eq $sum) { return 0 } else { return [int64]$sum }
}
function Format-Size([int64]$b) {
  if ($b -ge 1GB) { return '{0:N1} GB' -f ($b / 1GB) }
  if ($b -ge 1MB) { return '{0:N1} MB' -f ($b / 1MB) }
  return '{0:N0} KB' -f ($b / 1KB)
}

$present = @()
$total = [int64]0
foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t)) { Write-Host "skip (not there): $t"; continue }
  if ((Get-Item -LiteralPath $t -Force).LinkType) { Write-Host "REFUSED (a link to another place, not a real folder): $t"; continue }
  $size = Get-Size $t
  $total += $size
  $present += [pscustomobject]@{ Path = $t; Size = $size }
  Write-Host ('{0,10}  {1}' -f (Format-Size $size), $t)
}
Write-Host ('{0,10}  in all' -f (Format-Size $total))

if (-not $Delete) { Write-Host 'Nothing was deleted. Run again with -Delete to remove these folders.'; exit 0 }
if ($present.Count -eq 0) { Write-Host 'Nothing to delete.'; exit 0 }

$answer = Read-Host 'Type DELETE (capital letters) to remove the folders listed above'
if ($answer -cne 'DELETE') { Write-Host 'Not confirmed. Nothing was deleted.'; exit 1 }

$freed = [int64]0
$failed = 0
foreach ($item in $present) {
  try {
    # Remove links (junctions, symlinks) inside the folder on their own first, so nothing outside it is touched.
    Get-ChildItem -LiteralPath $item.Path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue |
      Sort-Object { $_.FullName.Length } -Descending |
      ForEach-Object { if ($_.PSIsContainer) { [System.IO.Directory]::Delete($_.FullName) } else { [System.IO.File]::Delete($_.FullName) } }
    Remove-Item -LiteralPath $item.Path -Recurse -Force
    $freed += $item.Size
    Write-Host ('freed {0,10}  {1}' -f (Format-Size $item.Size), $item.Path)
  } catch {
    $failed++
    Write-Host "FAILED: $($item.Path): $($_.Exception.Message)"
  }
}
Write-Host ('Freed about {0} in all.' -f (Format-Size $freed))
if ($failed -gt 0) { Write-Host "$failed folder(s) could not be removed; see FAILED above."; exit 1 }
exit 0
