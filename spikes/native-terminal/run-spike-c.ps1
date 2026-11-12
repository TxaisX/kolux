# Spike (c): Windows Terminal engine (HwndTerminal) inside a plain window, fed by our own ConPTY.
# Run:  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File spikes\native-terminal\run-spike-c.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll  = Join-Path $here '_pkg\x\runtimes\win-x64\native\Microsoft.Terminal.Control.dll'   # from NuGet CI.Microsoft.Terminal.Wpf 1.25.260303002
$out  = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out | Out-Null

# Sample output with colours, truecolor, box drawing, CJK and emoji, printed by cmd's `type` under our ConPTY.
$e = [char]27
$sample = @(
  "KOLUX-SPIKE-C  output from cmd.exe running under OUR ConPTY, drawn by the Windows Terminal engine",
  "$e[31mred $e[32mgreen $e[33myellow $e[34mblue $e[35mmagenta $e[36mcyan$e[0m  $e[1mbold$e[0m $e[4munderline$e[0m $e[7mreverse$e[0m",
  "$e[38;2;255;128;0mtruecolor orange$e[0m $e[48;2;0;64;128m truecolor bg $e[0m",
  "box: ┌──────┐ │ pane │ └──────┘   cjk: 日本語  emoji: 🚀✅",
  "Claude-ish prompt: $e[38;2;215;119;87m●$e[0m Thinking…  $e[2m(esc to interrupt)$e[0m",
  ""
) -join "`r`n"
$samplePath = Join-Path $out 'c-sample.txt'
[IO.File]::WriteAllText($samplePath, $sample, (New-Object Text.UTF8Encoding $false))

Add-Type -TypeDefinition (Get-Content -Raw (Join-Path $here 'HwndTerminalSpike.cs')) -ReferencedAssemblies System.Windows.Forms, System.Drawing
$lines = [HwndTerminalSpike]::Run($dll, $out, $samplePath)
$lines | Tee-Object -FilePath (Join-Path $out 'c-log.txt')

# cleanup check: no child processes of this PowerShell left behind
Start-Sleep -Milliseconds 800
$kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$PID" | Select-Object ProcessId, Name
"children of spike process after cleanup: " + (($kids | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ') | Tee-Object -FilePath (Join-Path $out 'c-log.txt') -Append
