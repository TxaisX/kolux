# Captures the running Kolux window into a PNG by PrintWindow (the window draws itself into
# the bitmap, so nothing else on the screen is caught). Optional: -Grow <px> widens and heightens
# the window first, to prove resizing. Usage: .\shot.ps1 -Out C:\path\T-00x.png
param([Parameter(Mandatory)][string]$Out, [int]$Grow = 0, [int]$ProcessId = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Shot {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
# With two lanes running their own dev apps, pass -ProcessId so the right window is caught.
if ($ProcessId -ne 0) { $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue }
else { $p = Get-Process | Where-Object { $_.MainWindowTitle -like "Kolux*" } | Select-Object -First 1 }
if (-not $p) { Write-Error "no Kolux window"; exit 1 }
$h = $p.MainWindowHandle
if ($Grow -ne 0) {
  $rg = New-Object Shot+RECT; [Shot]::GetWindowRect($h, [ref]$rg) | Out-Null
  [Shot]::MoveWindow($h, $rg.L, $rg.T, ($rg.R - $rg.L) + $Grow, ($rg.B - $rg.T) + $Grow, $true) | Out-Null
  Start-Sleep -Milliseconds 800
}
$r = New-Object Shot+RECT
[Shot]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Shot]::PrintWindow($h, $hdc, 2) | Out-Null   # PW_RENDERFULLCONTENT: includes the WebView2 surface
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Write-Output "saved $Out ($w x $hh) pid $($p.Id)"
