# Round-5 proof for requirement f: the same binary, three preference files, one PNG each.
# Each render is headless (no window) with real ConPTY shells, 8 s after the shells start so the
# prompts are on screen. Also prints the preferences the app actually resolved.
param(
  [string]$Exe = ".\target\release\rune-terminal.exe",
  [int]$At = 8
)
$ErrorActionPreference = "Continue"
$sets = @(
  @{ file = "prefs/midnight-focus.json"; out = "evidence/r5-midnight.png" },
  @{ file = "prefs/daylight-reading.json"; out = "evidence/r5-daylight.png" },
  @{ file = "prefs/pane-overrides.json"; out = "evidence/r5-pane-overrides.png" }
)
foreach ($s in $sets) {
  if (Test-Path $s.out) { Remove-Item $s.out }
  & $Exe --prefs $s.file --snap $s.out --realtime --at $At 2>&1 | Select-String -Pattern "PREFS_|snap|wrote" | ForEach-Object { $_.Line }
  if (-not (Test-Path $s.out)) { throw "no render for $($s.file)" }
  $len = (Get-Item $s.out).Length
  Write-Output ("RENDER {0} -> {1} ({2} bytes)" -f $s.file, $s.out, $len)
}