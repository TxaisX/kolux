# Captures the running Kolux window into a PNG by PrintWindow (the window draws itself into
# the bitmap, so nothing else on the screen is caught). Optional: -Grow <px> widens and heightens
# the window first, to prove resizing. Usage: .\shot.ps1 -Out C:\path\T-00x.png
param([Parameter(Mandatory)][string]$Out, [int]$Grow = 0, [int]$ProcessId = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Shot {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  // The app's own window. Not MainWindowHandle: once the window is minimised that names tao's hidden "Tao Thread
  // Event Target" window instead (the first visible unowned window in z-order), so the capture or the resize never
  // reached the app (measured 2026-11-09; same rule as WIN_PS in scripts/evidence/app-launch.mjs).
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr AppWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64); var t = new StringBuilder(64); GetWindowText(h, t, 64);
      if (c.ToString() == "Tauri Window" && t.ToString() == "Kolux") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# With two lanes running their own dev apps, pass -ProcessId so the right window is caught. An off-screen window (the
# harness parks it at -32000,-32000) reports no MainWindowTitle, so the process is found by name too.
$cands = if ($ProcessId -ne 0) { @(Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) } else { @(Get-Process | Where-Object { $_.ProcessName -like "kolux*" -or $_.MainWindowTitle -like "Kolux*" }) }
if (-not $cands.Count) { Write-Error "no Kolux window"; exit 1 }
$h = [IntPtr]::Zero; $p = $null
foreach ($c in $cands) { $w = [Shot]::AppWindow($c.Id); if ($w -ne [IntPtr]::Zero) { $h = $w; $p = $c; break } }
if (-not $p) { $p = $cands[0]; $h = $p.MainWindowHandle }  # a build that renames its window still gets captured
if ($h -eq [IntPtr]::Zero) { Write-Error "no window for pid $($p.Id)"; exit 1 }
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
