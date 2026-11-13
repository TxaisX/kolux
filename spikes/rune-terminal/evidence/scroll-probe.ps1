# Measures the scrollback probe in a real window: working set, process CPU%, and the app's own
# frame numbers (BENCH_RESULT after 10 s), so "a 10,000-row history streaming a row a frame"
# costs what this says, not what a headless run's forced frames say.
# Usage: powershell -File scroll-probe.ps1 [-Rows 10000] [-Seconds 25] [-Out evidence/r6-scroll-window.csv]
param(
  [int]$Rows = 10000,
  [int]$Seconds = 25,
  [string]$Out = "evidence/r6-scroll-window.csv",
  [string]$Tag = "10k",
  [string[]]$Extra = @()
)
$exe = ".\target\release\rune-terminal.exe"
$args = @("--scrollback", "$Rows", "--bench", "--size", "1440x900") + $Extra
$p = Start-Process -FilePath $exe -ArgumentList $args -PassThru -RedirectStandardOutput "evidence/_scroll-$Tag.out" -RedirectStandardError "evidence/_scroll-$Tag.err" -NoNewWindow
Write-Output "pid=$($p.Id) rows=$Rows seconds=$Seconds"

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$samples = @()
Start-Sleep -Seconds 8
$lastCpu = (Get-Process -Id $p.Id).TotalProcessorTime.TotalSeconds
$lastAt = Get-Date
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
  $samples += [pscustomobject]@{
    t          = $now.ToString("HH:mm:ss")
    working_mb = [math]::Round($proc.WorkingSet64 / 1MB, 1)
    private_mb = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
    cpu_pct    = [math]::Round($cpuPct, 2)
  }
  Start-Sleep -Milliseconds 800
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
$samples | Export-Csv -NoTypeInformation -Path $Out
$mean = { param($k) [math]::Round((($samples | Measure-Object -Property $k -Average).Average), 2) }
Write-Output ("MEAN working_mb={0} private_mb={1} cpu_pct={2} cores={3} samples={4}" -f (& $mean "working_mb"), (& $mean "private_mb"), (& $mean "cpu_pct"), $cores, $samples.Count)
Get-Content "evidence/_scroll-$Tag.out" | Where-Object { $_ -match "^(SCROLLBACK|BENCH_RESULT)" }
