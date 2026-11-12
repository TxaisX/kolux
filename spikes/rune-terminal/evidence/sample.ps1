# Samples memory, CPU% and GPU% of an N-pane Rune spike run, once a second, then reports the means.
# Usage: powershell -File sample.ps1 [-Exe path] [-Panes 8] [-Seconds 20] [-Out csv]
param(
  [string]$Exe = ".\target\debug\rune-terminal.exe",
  [int]$Panes = 8,
  [int]$Seconds = 20,
  [string]$Out = "evidence/sample.csv",
  [switch]$PowerShellShell,
  [switch]$Windowed
)

if ($Windowed) {
  # A real window: no --snap/--at, so the sampler stops it when it has enough.
  $runArgs = @("--scene", "$Panes", "--realtime")
} else {
  $runArgs = @("--snap", "evidence/_sample.png", "--scene", "$Panes", "--realtime", "--at", "$Seconds")
}
if (-not $PowerShellShell) { $runArgs += "--cmd" }
$p = Start-Process -FilePath $Exe -ArgumentList $runArgs -PassThru -RedirectStandardOutput "evidence/_sample.out" -RedirectStandardError "evidence/_sample.err" -NoNewWindow
Write-Output "pid=$($p.Id) panes=$Panes seconds=$Seconds exe=$Exe"

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$samples = @()
$lastCpu = 0.0
$lastAt = Get-Date
# Skip GPU init and shell start-up so the numbers describe the steady state.
Start-Sleep -Seconds 8
$deadline = (Get-Date).AddSeconds($Seconds)

while (-not $p.HasExited) {
  if ((Get-Date) -gt $deadline) { break }
  try { $proc = Get-Process -Id $p.Id -ErrorAction Stop } catch { break }
  $now = Get-Date
  $cpuNow = $proc.TotalProcessorTime.TotalSeconds
  $span = ($now - $lastAt).TotalSeconds
  $cpuPct = if ($span -gt 0) { (($cpuNow - $lastCpu) / $span / $cores) * 100.0 } else { 0 }
  $lastCpu = $cpuNow
  $lastAt = $now

  $gpu = $null
  $engines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*pid_$($p.Id)_*" -and $_.UtilizationPercentage -gt 0 }
  if ($engines) { $gpu = ($engines | Measure-Object -Property UtilizationPercentage -Sum).Sum }

  $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" -ErrorAction SilentlyContinue
  $kidMb = if ($kids) { [math]::Round((($kids | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum) / 1MB, 1) } else { 0 }

  $samples += [pscustomobject]@{
    t           = $now.ToString("HH:mm:ss")
    working_mb  = [math]::Round($proc.WorkingSet64 / 1MB, 1)
    private_mb  = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
    cpu_pct     = [math]::Round($cpuPct, 2)
    gpu_pct     = $gpu
    threads     = $proc.Threads.Count
    children    = if ($kids) { ($kids | Measure-Object).Count } else { 0 }
    child_mb    = $kidMb
  }
  Start-Sleep -Milliseconds 1000
}
$p.WaitForExit()
if ($Windowed -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force; Write-Output "stopped pid=$($p.Id) (started by this sampler)" }
$samples | Export-Csv -Path $Out -NoTypeInformation
$samples | Format-Table -AutoSize

if ($samples.Count -gt 0) {
  $ws = $samples | Measure-Object -Property working_mb -Average -Maximum
  $pv = $samples | Measure-Object -Property private_mb -Average -Maximum
  $cu = $samples | Measure-Object -Property cpu_pct -Average -Maximum
  $gu = $samples | Where-Object { $null -ne $_.gpu_pct }
  $ck = $samples | Measure-Object -Property child_mb -Average -Maximum
  Write-Output ("samples {0}  cores {1}" -f $samples.Count, $cores)
  Write-Output ("window working set MB   mean {0}  max {1}" -f [math]::Round($ws.Average,1), $ws.Maximum)
  Write-Output ("window private MB       mean {0}  max {1}" -f [math]::Round($pv.Average,1), $pv.Maximum)
  Write-Output ("window cpu % of all     mean {0}  max {1}" -f [math]::Round($cu.Average,2), $cu.Maximum)
  Write-Output ("shells working set MB   mean {0}  max {1}" -f [math]::Round($ck.Average,1), $ck.Maximum)
  if ($gu) {
    $gg = $gu | Measure-Object -Property gpu_pct -Average -Maximum
    Write-Output ("gpu % summed engines    mean {0}  max {1}" -f [math]::Round($gg.Average,2), $gg.Maximum)
  } else { Write-Output "gpu: no counters returned" }
}
Write-Output "last lines of the run:"
if (Test-Path "evidence/_sample.out") { Get-Content "evidence/_sample.out" | Select-Object -Last 4 }
