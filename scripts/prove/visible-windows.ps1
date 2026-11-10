# Watches the person's own desktop while a proof runs and records any VISIBLE top-level window that belongs to
# the proof (a program under -Under, or one whose command line mentions a scratch identifier), plus any moment
# such a program held the keyboard focus. A proof that never pops a window leaves "visible proof windows: 0".
#
#   powershell -NoProfile -File visible-windows.ps1 -Out <report> -Stop <file> -Under <dir> -Marks a,b
#
# Polls about every 100 ms until the -Stop file exists, then writes the report and exits. It runs on the
# default desktop, so EnumWindows sees exactly what the person could see.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Stop,
  [Parameter(Mandatory = $true)][string]$Under,
  [string]$Marks = "kolux-proof"
)
$ErrorActionPreference = "Continue"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  public static List<IntPtr> Visible() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { if (IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$markList = @($Marks.Split(",") | Where-Object { $_ })
$underDir = $Under.TrimEnd("\").ToLowerInvariant()
$verdicts = @{}   # pid -> $true when it belongs to the proof
$seen = @{}       # "pid|class|title" -> first-seen line
$focus = @{}
$polls = 0
function Belongs([int]$procId) {
  if ($verdicts.ContainsKey($procId)) { return $verdicts[$procId] }
  $v = $false
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
    $path = ("" + $p.ExecutablePath).ToLowerInvariant()
    $cmd = ("" + $p.CommandLine).ToLowerInvariant()
    if ($path.StartsWith($underDir)) { $v = $true }
    foreach ($m in $markList) { if ($cmd.Contains($m.ToLowerInvariant())) { $v = $true } }
  } catch { }
  $verdicts[$procId] = $v
  return $v
}
function Describe([IntPtr]$h) {
  $procId = 0
  [void][Win]::GetWindowThreadProcessId($h, [ref]$procId)
  $t = New-Object Text.StringBuilder 256
  $c = New-Object Text.StringBuilder 256
  [void][Win]::GetWindowText($h, $t, 256)
  [void][Win]::GetClassName($h, $c, 256)
  return @{ pid = $procId; title = $t.ToString(); cls = $c.ToString() }
}
"ready" | Set-Content -LiteralPath "$Out.ready"
while (-not (Test-Path -LiteralPath $Stop)) {
  $polls++
  foreach ($h in [Win]::Visible()) {
    $d = Describe $h
    if ($d.pid -le 4) { continue }
    if (Belongs $d.pid) {
      $key = "$($d.pid)|$($d.cls)|$($d.title)"
      if (-not $seen.ContainsKey($key)) { $seen[$key] = (Get-Date).ToString("HH:mm:ss.fff") }
    }
  }
  $fg = [Win]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    $d = Describe $fg
    if ($d.pid -gt 4 -and (Belongs $d.pid)) {
      $key = "$($d.pid)|$($d.cls)|$($d.title)"
      if (-not $focus.ContainsKey($key)) { $focus[$key] = (Get-Date).ToString("HH:mm:ss.fff") }
    }
  }
  Start-Sleep -Milliseconds 100
}
$lines = @()
$lines += "polls of the default desktop: $polls"
$lines += "visible proof windows: $($seen.Count)"
foreach ($k in $seen.Keys) { $lines += "  WINDOW at $($seen[$k]): $k" }
$lines += "proof programs that held the keyboard focus: $($focus.Count)"
foreach ($k in $focus.Keys) { $lines += "  FOCUS at $($focus[$k]): $k" }
$lines | Set-Content -LiteralPath $Out -Encoding utf8
