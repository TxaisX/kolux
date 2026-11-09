# Samples the app's own processes (the window, the detached terminal service when there is one, every msedgewebview2.exe under the
# window) for -WindowS seconds and prints one JSON document on stdout. Read-only: it never touches a process.
# The process set is found once by Win32_Process (the window's descendants, plus a --terminal-service kolux-rs.exe whose command line
# holds -ServiceMatch, so another Kolux such as the installed one is never sampled); then every -IntervalS seconds each pid is read
# through System.Diagnostics.Process (WorkingSet64, PrivateMemorySize64 = private bytes, TotalProcessorTime). GPU process memory and
# engine utilization come from one Get-Counter job running beside the loop (the counters are slow, so they are not read per tick).
# Used by scripts/stress/s11-footprint.mjs through lib.mjs footprint().
param([int]$AppPid, [string]$ServiceMatch, [int]$WindowS = 60, [int]$IntervalS = 2)
$ErrorActionPreference = 'Stop'
$cores = [Environment]::ProcessorCount
$gpuStep = 5
$job = Start-Job -ArgumentList $WindowS, $gpuStep -ScriptBlock {
  param($w, $step)
  Get-Counter -Counter '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage', '\GPU Process Memory(*)\Total Committed', '\GPU Engine(*)\Utilization Percentage' -SampleInterval $step -MaxSamples ([Math]::Max(2, [int]($w / $step))) | ForEach-Object {
    $t = $_.Timestamp
    foreach ($x in $_.CounterSamples) { if ($x.InstanceName -match '^pid_(\d+)_') { [pscustomobject]@{ pid = [int]$Matches[1]; kind = $x.Path.Substring($x.Path.LastIndexOf(')') + 2); v = [double]$x.CookedValue; t = $t.Ticks } } }
  }
}

function Get-Role($p) {
  $cmd = [string]$p.CommandLine
  if ($p.Name -eq 'kolux-rs.exe') { if ($cmd -like '*--terminal-service*') { return 'service' } else { return 'window' } }
  if ($cmd -match '--type=(\S+)') { return $Matches[1] }
  return 'wv-browser'
}

$all = Get-CimInstance Win32_Process
$want = New-Object System.Collections.Generic.List[int]
$want.Add($AppPid)
$i = 0
while ($i -lt $want.Count) {
  $q = $want[$i]; $i++
  foreach ($c in $all) { if ($c.ParentProcessId -eq $q -and -not $want.Contains([int]$c.ProcessId)) { $want.Add([int]$c.ProcessId) } }
}
foreach ($c in $all) {
  if ($c.Name -eq 'kolux-rs.exe' -and ([string]$c.CommandLine) -like '*--terminal-service*' -and ([string]$c.CommandLine).Replace('\', '/') -like "*$($ServiceMatch.Replace('\', '/'))*" -and -not $want.Contains([int]$c.ProcessId)) { $want.Add([int]$c.ProcessId) }
}
$roles = @{}
foreach ($p in $all) {
  if (-not $want.Contains([int]$p.ProcessId)) { continue }
  if ($p.Name -ne 'kolux-rs.exe' -and $p.Name -ne 'msedgewebview2.exe') { continue } # shells, conhost and agents are not the app
  $roles[[int]$p.ProcessId] = Get-Role $p
}

$ticks = @()
$end = [DateTime]::UtcNow.AddSeconds($WindowS)
while ($true) {
  $started = [DateTime]::UtcNow
  $procs = @()
  foreach ($id in $roles.Keys) {
    try {
      $p = [System.Diagnostics.Process]::GetProcessById($id)
      $procs += [pscustomobject]@{ pid = $id; role = $roles[$id]; ws = [int64]$p.WorkingSet64; priv = [int64]$p.PrivateMemorySize64; cpu100ns = [int64]$p.TotalProcessorTime.Ticks; handles = [int]$p.HandleCount; threads = [int]$p.Threads.Count }
    } catch { }
  }
  $ticks += [pscustomobject]@{ t = [DateTime]::UtcNow.ToString('o'); procs = $procs }
  if ([DateTime]::UtcNow.AddSeconds($IntervalS) -gt $end) { break }
  $wait = $IntervalS - ([DateTime]::UtcNow - $started).TotalSeconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
}

# GPU: per pid, the mean of each counter over the job's samples (memory counters in bytes, engine utilization summed over engines per sample).
$gpu = @{}
$rows = @()
$gpuErr = ''
try { $rows = @(Receive-Job -Job $job -Wait -ErrorVariable jobErr -ErrorAction SilentlyContinue); if ($jobErr) { $gpuErr = ($jobErr | ForEach-Object { $_.ToString() }) -join ' | ' } } catch { $gpuErr = $_.ToString() }
Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
if ($rows.Count -eq 0) { # the background read gave nothing: one plain read so the phase is not left without GPU numbers
  try { $rows = @(Get-Counter -Counter 'GPU Process Memory(*)Dedicated Usage', 'GPU Process Memory(*)Shared Usage', 'GPU Process Memory(*)Total Committed', 'GPU Engine(*)Utilization Percentage' -SampleInterval 2 -MaxSamples 2 | ForEach-Object { $t = $_.Timestamp; foreach ($x in $_.CounterSamples) { if ($x.InstanceName -match '^pid_(d+)_') { [pscustomobject]@{ pid = [int]$Matches[1]; kind = $x.Path.Substring($x.Path.LastIndexOf(')') + 2); v = [double]$x.CookedValue; t = $t.Ticks } } } }); $gpuErr += ' (retried once)' } catch { $gpuErr += ' retry: ' + $_.ToString() }
}
foreach ($r in $rows) {
  if (-not $roles.ContainsKey([int]$r.pid)) { continue }
  $k = "$($r.pid)"
  if (-not $gpu.ContainsKey($k)) { $gpu[$k] = @{ samples = @{}; ded = @{}; shared = @{}; commit = @{}; eng = @{} } }
  $slot = [string]$r.t
  $g = $gpu[$k]
  $g.samples[$slot] = 1
  switch -Wildcard ($r.kind) {
    'dedicated usage' { $g.ded[$slot] = [double]$g.ded[$slot] + $r.v }
    'shared usage' { $g.shared[$slot] = [double]$g.shared[$slot] + $r.v }
    'total committed' { $g.commit[$slot] = [double]$g.commit[$slot] + $r.v }
    'utilization percentage' { $g.eng[$slot] = [double]$g.eng[$slot] + $r.v }
  }
}
$gpuOut = @{}
foreach ($k in $gpu.Keys) {
  $g = $gpu[$k]
  $mean = { param($h) if ($h.Count -eq 0) { 0 } else { ($h.Values | Measure-Object -Average).Average } }
  $gpuOut[$k] = [pscustomobject]@{ ded = (& $mean $g.ded); shared = (& $mean $g.shared); commit = (& $mean $g.commit); eng = (& $mean $g.eng); samples = $g.samples.Count }
}
[pscustomobject]@{ cores = $cores; ticks = $ticks; gpu = $gpuOut; gpuRows = $rows.Count; gpuErr = $gpuErr } | ConvertTo-Json -Depth 6 -Compress
