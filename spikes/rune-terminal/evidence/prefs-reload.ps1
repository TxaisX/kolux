# Proves the preferences file is re-read while the app runs: start on one setup, swap the file to a
# very different setup, break it on purpose, then fix it again, and print the app's own log lines.
param(
  [string]$Exe = ".\target\release\rune-terminal.exe",
  [string]$Out = "evidence/prefs-reload.txt"
)
$live = "evidence/_live-prefs.json"
$stdout = "evidence/_reload.out"
Remove-Item $stdout, "evidence/_reload.err" -ErrorAction SilentlyContinue

Copy-Item prefs/midnight-focus.json $live -Force
$p = Start-Process -FilePath $Exe -ArgumentList @("--prefs", $live) `
  -PassThru -RedirectStandardOutput $stdout -RedirectStandardError "evidence/_reload.err" -NoNewWindow
Write-Output "pid=$($p.Id) started on midnight-focus.json (4 panes, dark)"
Start-Sleep -Seconds 12

Copy-Item prefs/daylight-reading.json $live -Force
Write-Output "swapped the file to daylight-reading.json (3 panes, light) while it is running"
Start-Sleep -Seconds 9

'{ "layout": { "panes": "three" } }' | Set-Content $live
Write-Output "wrote a broken file on purpose (panes as a string)"
Start-Sleep -Seconds 6

Copy-Item prefs/daylight-reading.json $live -Force
Write-Output "fixed it again"
Start-Sleep -Seconds 6

if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; Write-Output "stopped pid=$($p.Id) (started by this script)" }
$log = Get-Content $stdout -ErrorAction SilentlyContinue
$log | Set-Content $Out
Write-Output "--- the app's log ---"
$log
Remove-Item $live -ErrorAction SilentlyContinue
