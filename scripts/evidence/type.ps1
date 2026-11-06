# Drives the running Kolux window without the shared keyboard or mouse: clicks and keystrokes
# are posted straight to the app's own web view child window (Chrome_RenderWidgetHostHWND), so
# nothing lands in whatever program the user has in front. Never uses SendKeys.
#   -Click "x,y"   click at that point of the web view (client pixels, top-left origin)
#   -Text "..."    type this text after the click; a newline (`n) presses Enter, a backspace (`b) deletes
#   -Out path.png  capture the window afterwards (same PrintWindow capture as shot.ps1)
#   -SettleMs n    wait this long after typing before capturing (default 1500)
#   -PerCharMs n   pause between characters (default 120; faster than ~100 loses characters while the page re-renders)
# Usage: .\type.ps1 -Click "120,140" -Text "C:\repo`n" -Out C:\path\after.png
param([string]$Click = "", [string]$Text = "", [string]$Out = "", [int]$SettleMs = 1500, [int]$PerCharMs = 120)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Drive {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static IntPtr FindChild(IntPtr parent, string cls) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, (h, l) => {
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (sb.ToString() == cls) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static int PerCharMs = 40;
  public static void Type(IntPtr h, string text) {
    foreach (char c in text) {
      if (c == '\n') {
        PostMessage(h, 0x0100, (IntPtr)0x0D, (IntPtr)0x001C0001);                      // WM_KEYDOWN Enter
        PostMessage(h, 0x0101, (IntPtr)0x0D, unchecked((IntPtr)(int)0xC01C0001));     // WM_KEYUP Enter
      } else if (c == (char)127) {
        PostMessage(h, 0x0100, (IntPtr)0x2E, (IntPtr)0x01530001);                      // WM_KEYDOWN Delete
        PostMessage(h, 0x0101, (IntPtr)0x2E, unchecked((IntPtr)(int)0xC1530001));     // WM_KEYUP Delete
      } else if (c == '\b') {
        PostMessage(h, 0x0100, (IntPtr)0x08, (IntPtr)0x000E0001);                      // WM_KEYDOWN Backspace
        PostMessage(h, 0x0101, (IntPtr)0x08, unchecked((IntPtr)(int)0xC00E0001));     // WM_KEYUP Backspace
      } else {
        PostMessage(h, 0x0102, (IntPtr)c, (IntPtr)1);                                  // WM_CHAR
      }
      System.Threading.Thread.Sleep(PerCharMs);
    }
  }
  public static void Click(IntPtr h, int x, int y) {
    IntPtr lp = (IntPtr)((y << 16) | (x & 0xFFFF));
    PostMessage(h, 0x0200, IntPtr.Zero, lp);          // WM_MOUSEMOVE
    PostMessage(h, 0x0201, (IntPtr)1, lp);            // WM_LBUTTONDOWN
    PostMessage(h, 0x0202, IntPtr.Zero, lp);          // WM_LBUTTONUP
  }
}
"@
$p = Get-Process | Where-Object { $_.MainWindowTitle -like "Kolux*" } | Select-Object -First 1
if (-not $p) { Write-Error "no Kolux window"; exit 1 }
$h = $p.MainWindowHandle
$child = [Drive]::FindChild($h, "Chrome_RenderWidgetHostHWND")
if ($child -eq [IntPtr]::Zero) { Write-Error "no web view child window"; exit 1 }
if ($Click -ne "") {
  $xy = $Click.Split(",")
  [Drive]::Click($child, [int]$xy[0], [int]$xy[1])
  Start-Sleep -Milliseconds 300
}
if ($Text -ne "") {
  [Drive]::Type($child, $Text)
}
Start-Sleep -Milliseconds $SettleMs
if ($Out -ne "") {
  $r = New-Object Drive+RECT
  [Drive]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [Drive]::PrintWindow($h, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Output "saved $Out ($w x $hh) pid $($p.Id)"
}
