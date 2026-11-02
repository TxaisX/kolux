# Drives the system Save dialog that Export opens (title "Export theme"): puts the file path into the
# File name box and presses Save, with plain Win32 messages to the dialog's own child windows.
# Prints "dialog found", "typed: ..." and "saved", or the reason it could not.
param([string]$Path, [int]$WaitSeconds = 20)
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W32 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr n, StringBuilder sb);
  public static string Text(IntPtr h) { var sb = new StringBuilder(1024); SendMessage(h, 0x000D, (IntPtr)1024, sb); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static List<IntPtr> Children(IntPtr p) { var l = new List<IntPtr>(); EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
"@
$end = (Get-Date).AddSeconds($WaitSeconds)
$dlg = [IntPtr]::Zero
while ((Get-Date) -lt $end -and $dlg -eq [IntPtr]::Zero) {
  $dlg = [W32]::FindWindow("#32770", "Export theme")
  if ($dlg -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 300 }
}
if ($dlg -eq [IntPtr]::Zero) { Write-Output "no dialog titled Export theme appeared"; exit 1 }
Write-Output "dialog found"
Start-Sleep -Seconds 2
$kids = [W32]::Children($dlg)
# The File name box: the Edit inside the ComboBox; the Save button: the Button with control id 1 (IDOK).
$edit = [IntPtr]::Zero; $ok = [IntPtr]::Zero
foreach ($k in $kids) {
  $c = [W32]::Cls($k)
  if ($edit -eq [IntPtr]::Zero -and $c -eq "Edit" -and ([W32]::Cls([W32]::GetParent($k)) -like "*ComboBox*") -and [W32]::Text($k) -like "kolux-theme*") { $edit = $k }
  if ($ok -eq [IntPtr]::Zero -and $c -eq "Button" -and [W32]::GetDlgCtrlID($k) -eq 1) { $ok = $k }
}
if ($edit -eq [IntPtr]::Zero) { Write-Output ("no File name edit; child classes: " + (($kids | ForEach-Object { [W32]::Cls($_) } | Select-Object -Unique) -join ", ")); exit 2 }
[void][W32]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Path)
Write-Output ("typed: " + $Path)
if ($ok -eq [IntPtr]::Zero) { Write-Output "no Save button (id 1)"; exit 3 }
[void][W32]::SendMessage($ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
$gone = $false
for ($i = 0; $i -lt 20 -and -not $gone; $i++) { Start-Sleep -Milliseconds 250; $gone = -not [W32]::IsWindow($dlg) }
Write-Output ("dialog closed: " + $gone)
if ($gone) { Write-Output "saved" } else { exit 4 }
