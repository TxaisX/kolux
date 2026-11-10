# Restores the given window and captures ITS OWN pixels (PrintWindow with PW_RENDERFULLCONTENT, so the
# DWM-composited WebView2 content is included and other windows on top do not matter) at several moments
# after the restore. Each frame's mean colour and its share of near-white pixels are printed.
# Usage: frames.ps1 -ProcId 123 -Out G:\dir\prefix -Hwnd 456
param([Parameter(Mandatory)][int]$ProcId, [Parameter(Mandatory)][string]$Out, [int[]]$At = @(0, 50, 120, 300, 1000), [long]$Hwnd = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class F {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$h = if ($Hwnd -ne 0) { [IntPtr]$Hwnd } else { (Get-Process -Id $ProcId).MainWindowHandle }
"restoring hwnd $h (iconic before: $([F]::IsIconic($h)))"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
[F]::ShowWindow($h, 9) | Out-Null
[F]::SetForegroundWindow($h) | Out-Null
$i = 0
foreach ($ms in $At) {
  while ($sw.ElapsedMilliseconds -lt $ms) { Start-Sleep -Milliseconds 1 }
  $r = New-Object F+RECT; [F]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  if ($w -le 0 -or $hh -le 0 -or $r.L -lt -20000) { "t=${ms}ms: window rect empty or off screen ($($r.L),$($r.T))"; continue }
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [F]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $took = $sw.ElapsedMilliseconds
  $g.Dispose()
  $path = "$Out-$i-$ms" + "ms.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  # Sample a grid of pixels for the mean colour and the near-white share.
  $n = 0; $sr = 0; $sg = 0; $sb = 0; $white = 0
  for ($y = 4; $y -lt $hh; $y += 16) { for ($x = 4; $x -lt $w; $x += 16) {
    $c = $bmp.GetPixel($x, $y); $n++; $sr += $c.R; $sg += $c.G; $sb += $c.B
    if ($c.R -gt 240 -and $c.G -gt 240 -and $c.B -gt 240) { $white++ }
  } }
  $bmp.Dispose()
  "t={0}ms (captured at {1}ms, PrintWindow ok={2}, {3}x{4}): mean rgb({5},{6},{7}) white={8:P1} {9}" -f $ms, $took, $ok, $w, $hh, [int]($sr/$n), [int]($sg/$n), [int]($sb/$n), ($white/$n), $path
  $i++
}
