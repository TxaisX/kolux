# GPU, done properly: per-engine counters for the spike's own pid, reported engine by engine so a
# summed row can't hide what is actually busy. Round 4 rejected the summed figure because the sum of
# every engine instance reads ~100 % for an idle window; this prints the instances instead.
# Usage: powershell -File gpu-probe.ps1 [-Rows 10000] [-Seconds 15] [-Tag scroll]
param(
  [int]$Rows = 0,
  [int]$Panes = 8,
  [int]$Seconds = 15,
  [string]$Tag = "gpu",
  [string[]]$Extra = @()
)
$exe = ".\target\release\rune-terminal.exe"
$runArgs = if ($Rows -gt 0) { @("--scrollback", "$Rows", "--size", "1440x900") } else { @("--scene", "$Panes", "--size", "1440x900") }
$runArgs += $Extra
$p = Start-Process -FilePath $exe -ArgumentList $runArgs -PassThru -RedirectStandardOutput "evidence/_gpu-$Tag.out" -RedirectStandardError "evidence/_gpu-$Tag.err" -NoNewWindow
Write-Output "pid=$($p.Id) tag=$Tag"
Start-Sleep -Seconds 8
$all = @{}
for ($i = 0; $i -lt $Seconds; $i++) {
  Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*pid_$($p.Id)_*" } |
    ForEach-Object {
      $eng = ($_.Name -split "engtype_")[-1]
      if (-not $all.ContainsKey($eng)) { $all[$eng] = @() }
      $all[$eng] += [double]$_.UtilizationPercentage
    }
  Start-Sleep -Milliseconds 900
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
foreach ($eng in ($all.Keys | Sort-Object)) {
  $vals = $all[$eng]
  $mean = [math]::Round((($vals | Measure-Object -Average).Average), 2)
  $max = [math]::Round((($vals | Measure-Object -Maximum).Maximum), 2)
  Write-Output ("GPU_ENGINE tag={0} engine={1} mean_pct={2} max_pct={3} samples={4}" -f $Tag, $eng, $mean, $max, $vals.Count)
}
