<#
  Runs a command (normally `pnpm smoke -- ...`) on its own hidden Windows desktop, so no window of the run can
  appear on the user's screen, take the taskbar, or steal the focus. Every process the command starts (pnpm, cargo,
  the app, WebView2) inherits that desktop, so the smoke harness itself needs no change.

  While it runs, this script watches the user's own desktop and writes the proof to -Proof:
    - visible top-level windows on the user's desktop that belong to the run's process tree (must be 0)
    - how often the foreground window belonged to the run's tree (must be 0)
    - a positive control: windows of the run's tree that exist on the hidden desktop (the app is really up)

  Usage:  powershell -NoProfile -File scripts\evidence\silent-run.ps1 -Cwd <checkout> -Log <file> -Proof <file> -Command "pnpm smoke -- --port 1438 ..."
  Exit code: the command's, or 3 when a window of the run showed on the user's desktop.
#>
param(
  [Parameter(Mandatory)][string]$Cwd,
  [Parameter(Mandatory)][string]$Log,
  [Parameter(Mandatory)][string]$Proof,
  [Parameter(Mandatory)][string]$Command,
  [string]$Desktop = "kolux-silent-run"
)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Silent {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, IntPtr dev, IntPtr mode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr d, EnumProc p, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  public static IntPtr MakeDesktop(string name) {
    IntPtr d = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    if (d == IntPtr.Zero) throw new Exception("CreateDesktop failed: " + Marshal.GetLastWin32Error());
    return d;
  }
  public static int Start(string commandLine, string cwd, string desktop) {
    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.lpDesktop = "winsta0\\" + desktop;
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref si, out pi)) throw new Exception("CreateProcess failed: " + Marshal.GetLastWin32Error());
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }
  public static uint ForegroundPid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
  // "pid|title" of every visible top-level window on the calling thread's desktop (desk = Zero) or on the given desktop.
  public static List<string> Visible(IntPtr desk) {
    List<string> r = new List<string>();
    EnumProc cb = delegate (IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); StringBuilder t = new StringBuilder(120); GetWindowTextW(h, t, 120); r.Add(p + "|" + t); }
      return true;
    };
    if (desk == IntPtr.Zero) EnumWindows(cb, IntPtr.Zero); else EnumDesktopWindows(desk, cb, IntPtr.Zero);
    return r;
  }
}
'@

$desk = [Silent]::MakeDesktop($Desktop)
$lines = New-Object System.Collections.Generic.List[string]
$cmdline = "cmd.exe /c $Command > `"$Log`" 2>&1"
$root = [Silent]::Start($cmdline, $Cwd, $Desktop)
$lines.Add("silent run: pid $root on hidden desktop '$Desktop', started $(Get-Date -Format s)")
$lines.Add("command: $Command")

$tree = @{ $root = $true }
$violations = New-Object System.Collections.Generic.HashSet[string]
$fgHits = 0; $samples = 0; $hiddenSeen = New-Object System.Collections.Generic.HashSet[string]
$lastTree = [DateTime]::MinValue; $lastHidden = [DateTime]::MinValue
while ($true) {
  if (((Get-Date) - $lastTree).TotalSeconds -ge 1) {
    $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
    do { $grew = $false; foreach ($p in $all) { if ($tree.ContainsKey([int]$p.ParentProcessId) -and -not $tree.ContainsKey([int]$p.ProcessId)) { $tree[[int]$p.ProcessId] = $true; $grew = $true } } } while ($grew)
    $lastTree = Get-Date
  }
  foreach ($w in [Silent]::Visible([IntPtr]::Zero)) { $pid_ = [int]($w.Split("|")[0]); if ($tree.ContainsKey($pid_)) { [void]$violations.Add($w) } }
  if ($tree.ContainsKey([int][Silent]::ForegroundPid())) { $fgHits++ }
  $samples++
  if (((Get-Date) - $lastHidden).TotalSeconds -ge 5) {
    foreach ($w in [Silent]::Visible($desk)) { $pid_ = [int]($w.Split("|")[0]); if ($tree.ContainsKey($pid_) -and $w.Split("|")[1]) { [void]$hiddenSeen.Add($w) } }
    $lastHidden = Get-Date
  }
  if (-not (Get-Process -Id $root -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 100
}
# Anything the run left behind keeps the desktop open; give it a moment, then report.
Start-Sleep -Seconds 2
[void][Silent]::CloseDesktop($desk)

$lines.Add("sanity: the enumeration sees $([Silent]::Visible([IntPtr]::Zero).Count) visible windows in total on the user's desktop (so an empty result is a real zero)")
$lines.Add("watch: $samples samples of the user's desktop, $($tree.Count) processes seen in the run's tree")
$lines.Add("visible windows of the run on the user's desktop: $($violations.Count)" + $(if ($violations.Count) { " -> " + ($violations -join "; ") } else { "" }))
$lines.Add("samples where the foreground window belonged to the run: $fgHits")
$lines.Add("positive control, visible titled windows of the run on the hidden desktop: $($hiddenSeen.Count)" + $(if ($hiddenSeen.Count) { " -> " + ($hiddenSeen -join "; ") } else { "" }))
$silent = ($violations.Count -eq 0 -and $fgHits -eq 0)
$lines.Add("SILENT: $silent")
Set-Content -Path $Proof -Value $lines -Encoding utf8
$lines | ForEach-Object { Write-Output $_ }
$code = 0
try { $log = Get-Content -Raw $Log; if ($log -match "smoke: (\d)/4 flows passed") { $code = if ($Matches[1] -eq "4") { 0 } else { 1 } } else { $code = 1 } } catch { $code = 1 }
if (-not $silent) { exit 3 }
exit $code
