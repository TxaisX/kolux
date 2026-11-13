# Proves the preferences file is re-read while the app runs: start on one setup, swap the file to
# very different setups (including per-pane overrides), break it on purpose twice, then fix it
# again, and print the app's own log lines.
param(
  [string]$Exe = ".\target\release\rune-terminal.exe",
  [string]$Out = "evidence/prefs-reload.txt"
)
$ErrorActionPreference = "Stop"
$live = "evidence/_live-prefs.json"
$stdout = "evidence/_reload.out"
Remove-Item $stdout, "evidence/_reload.err", $live -ErrorAction SilentlyContinue

Copy-Item prefs/midnight-focus.json $live -Force
$p = Start-Process -FilePath $Exe -ArgumentList @("--prefs", $live) `
  -PassThru -RedirectStandardOutput $stdout -RedirectStandardError "evidence/_reload.err" -NoNewWindow
Write-Output "pid=$($p.Id) started on midnight-focus.json (4 panes, dark)"
Start-Sleep -Seconds 12

Copy-Item prefs/daylight-reading.json $live -Force
Write-Output "swapped the file to daylight-reading.json (3 panes, light) while it is running"
Start-Sleep -Seconds 9

Copy-Item prefs/pane-overrides.json $live -Force
Write-Output "swapped to pane-overrides.json (4 panes; pane 2 purple with its own shell, pane 4 light-on-paper)"
Start-Sleep -Seconds 9

# A rule of ours, not a shape error: a colour that is not a colour. The message must name the
# field and the line it is on.
@'
{
  "theme": {
    "cursor_bg": "#nope"
  }
}
'@ | Set-Content $live
Write-Output "wrote a broken colour on purpose (theme.cursor_bg is not hex)"
Start-Sleep -Seconds 6

# An override that points at a pane that does not exist.
'{ "layout": { "panes": 2, "pane_overrides": [ { "pane": 7 } ] } }' | Set-Content $live
Write-Output "pointed an override at pane 7 of 2"
Start-Sleep -Seconds 6

# A shape error: serde reports the line and column itself.
'{ "layout": { "panes": "three" } }' | Set-Content $live
Write-Output "wrote a shape error on purpose (panes as a string)"
Start-Sleep -Seconds 6

Copy-Item prefs/pane-overrides.json $live -Force
Write-Output "fixed it again"
Start-Sleep -Seconds 6

if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; Write-Output "stopped pid=$($p.Id) (started by this script)" }
$log = Get-Content $stdout -ErrorAction SilentlyContinue
$log | Set-Content $Out
Write-Output "--- the app's log ---"
$log
Remove-Item $live, $stdout, "evidence/_reload.err" -ErrorAction SilentlyContinue