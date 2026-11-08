# Starts one program on its own Windows desktop, so it can never put a window on the person's screen or take
# focus from them (T-790 rule: proof runs are silent). Everything the program starts inherits that desktop.
#
#   powershell -NoProfile -File hidden-desktop.ps1 -Exe <path> -CmdArgs "<args>" -Cwd <dir> [-Wait] [-Desktop <name>]
#   powershell -NoProfile -File hidden-desktop.ps1 -CloseOf <pid>     asks that program's windows there to close
#   powershell -NoProfile -File hidden-desktop.ps1 -ListWindows       lists the visible windows on that desktop
#
# Prints "pid <n>"; with -Wait it waits for the program and prints "exit <code>".
# The program inherits this script's environment (the rig sets that before it calls the script).
param(
  [string]$Exe = "",
  [int]$CloseOf = 0,
  [switch]$ListWindows,
  [switch]$All,
  [string]$CmdArgs = "",
  [string]$Cwd = "",
  [string]$Desktop = "kolux-proof-rig",
  [switch]$Wait
)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HiddenDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devmode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
    IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr OpenDesktopW(string name, int flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr desk, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
  public static string Describe(int h) {
    var c = new System.Text.StringBuilder(128); var t = new System.Text.StringBuilder(128);
    GetClassNameW((IntPtr)h, c, 128); GetWindowTextW((IntPtr)h, t, 128);
    return c.ToString() + " / " + t.ToString();
  }
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr desk);
  public static System.Collections.Generic.List<int[]> Windows(IntPtr desk) {
    var list = new System.Collections.Generic.List<int[]>();
    EnumDesktopWindows(desk, (h, l) => { int pid; GetWindowThreadProcessId(h, out pid); list.Add(new int[] { h.ToInt32(), pid, IsWindowVisible(h) ? 1 : 0 }); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$GENERIC_ALL = 0x10000000
if ($CloseOf -gt 0 -or $ListWindows) {
  $d = [HiddenDesktop]::OpenDesktopW($Desktop, 0, $false, $GENERIC_ALL)
  if ($d -eq [IntPtr]::Zero) { "no desktop"; exit 0 }
  $n = 0
  # A thread can only post to windows on its own desktop, so this one joins the hidden desktop first.
  if (-not [HiddenDesktop]::SetThreadDesktop($d)) { "SetThreadDesktop failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  foreach ($w in [HiddenDesktop]::Windows($d)) {
    if ($ListWindows -and ($All -or $w[2] -eq 1)) { "window $($w[0]) pid $($w[1]) [$([HiddenDesktop]::Describe($w[0]))]"; $n++ }
    # WM_CLOSE is the ordinary request to close a window (the app's own close handler then decides).
    if ($CloseOf -gt 0 -and $w[1] -eq $CloseOf -and $w[2] -eq 1) { if ([HiddenDesktop]::PostMessageW([IntPtr]$w[0], 0x10, [IntPtr]::Zero, [IntPtr]::Zero)) { $n++ } else { "post failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" } }
  }
  if ($ListWindows) { "visible windows on the hidden desktop: $n" } else { "closed $n window(s) of pid $CloseOf" }
  [void][HiddenDesktop]::CloseDesktop($d)
  exit 0
}
if (-not $Exe) { throw "give -Exe, -CloseOf or -ListWindows" }
$desk = [HiddenDesktop]::CreateDesktopW($Desktop, [IntPtr]::Zero, [IntPtr]::Zero, 0, $GENERIC_ALL, [IntPtr]::Zero)
if ($desk -eq [IntPtr]::Zero) { throw "CreateDesktop failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$si = New-Object HiddenDesktop+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
$si.lpDesktop = "WinSta0\$Desktop"
$pi = New-Object HiddenDesktop+PROCESS_INFORMATION
$cmd = "`"$Exe`" $CmdArgs"
$cwdArg = [NullString]::Value
if ($Cwd) { $cwdArg = $Cwd }
# 0x400 = CREATE_UNICODE_ENVIRONMENT is moot with a null environment block (the child inherits ours).
$ok = [HiddenDesktop]::CreateProcessW($Exe, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, $cwdArg, [ref]$si, [ref]$pi)
if (-not $ok) { throw "CreateProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
"pid $($pi.dwProcessId)"
if ($Wait) {
  [void][HiddenDesktop]::WaitForSingleObject($pi.hProcess, [uint32]::MaxValue)
  $code = 0
  [void][HiddenDesktop]::GetExitCodeProcess($pi.hProcess, [ref]$code)
  "exit $code"
}
[void][HiddenDesktop]::CloseHandle($pi.hThread)
[void][HiddenDesktop]::CloseHandle($pi.hProcess)
# The desktop lives on while a process runs on it; closing our handle does not stop that process.
[void][HiddenDesktop]::CloseDesktop($desk)
