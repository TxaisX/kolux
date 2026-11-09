param([int]$AppPid, [int]$Seconds = 30)
# gpu-process (and renderer) CPU % of one core over $Seconds, plus GPU engine % summed over the gpu-process engines.
$all = Get-CimInstance Win32_Process
$want = @($AppPid); $i = 0
while ($i -lt $want.Count) { $p = $want[$i]; $i++; foreach ($c in $all) { if ($c.ParentProcessId -eq $p -and $want -notcontains [int]$c.ProcessId) { $want += [int]$c.ProcessId } } }
$wv = $all | Where-Object { $want -contains [int]$_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' }
$gpu = ($wv | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | Select-Object -First 1).ProcessId
$ren = @($wv | Where-Object { $_.CommandLine -like '*--type=renderer*' } | ForEach-Object { [int]$_.ProcessId })
$t0 = @{}; foreach ($x in @($gpu) + $ren + @($AppPid)) { $t0[$x] = (Get-Process -Id $x).TotalProcessorTime.TotalMilliseconds }
$job = Start-Job -ArgumentList $gpu, $Seconds -ScriptBlock { param($g, $s)
  $n = [Math]::Max(2, [int]($s / 2))
  $v = Get-Counter -Counter "\GPU Engine(pid_$($g)_*)\Utilization Percentage" -SampleInterval 2 -MaxSamples $n -ErrorAction SilentlyContinue | ForEach-Object { ($_.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum }
  ($v | Measure-Object -Average).Average }
$sw = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$el = $sw.Elapsed.TotalMilliseconds
$g1 = (Get-Process -Id $gpu).TotalProcessorTime.TotalMilliseconds
$r1 = 0; $r0 = 0; foreach ($x in $ren) { $r1 += (Get-Process -Id $x).TotalProcessorTime.TotalMilliseconds; $r0 += $t0[$x] }
$a1 = (Get-Process -Id $AppPid).TotalProcessorTime.TotalMilliseconds
$eng = Receive-Job -Job $job -Wait
"gpuCpu={0:N2} rendererCpu={1:N2} windowCpu={2:N2} gpuEng={3:N2} gpuPid={4}" -f (100 * ($g1 - $t0[$gpu]) / $el), (100 * ($r1 - $r0) / $el), (100 * ($a1 - $t0[$AppPid]) / $el), $eng, $gpu
