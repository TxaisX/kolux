# T-816: runs one program the way the release app runs (no console of its own) on a private desktop that
# nobody sees, and samples every window and every new process on that desktop every 20 ms. A console
# window that a child of the app opens shows up here as a visible ConsoleWindowClass window; nothing is
# ever shown on the user's screen and no focus is taken, because the desktop is not the one the user is on.
#
#   powershell -NoProfile -File nowin-probe.ps1 -Exe <path> -StopFile <file> -Report <file> [-MaxSeconds 300] [-Cwd <dir>] [-Args "<command line after the exe>"]
#
# The program is started with DETACHED_PROCESS (no console at all, like the release build, which has the
# "windows" subsystem) and inherits this process's environment. It runs until StopFile exists or MaxSeconds
# pass; then the whole process tree is stopped and Report is written as JSON:
#   { visibleConsoleWindows: n, windows: [{t, class, title, pid, exe, visible}], processes: [{t, pid, ppid, exe, parent}] }
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [Parameter(Mandatory = $true)][string]$Report,
  [int]$MaxSeconds = 300,
  [string]$Cwd = "",
  [string]$Args = ""
)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NW {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PROCESSENTRY32 { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile; }
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateDesktop(string name, string dev, IntPtr devmode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr d, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32First(IntPtr s, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32Next(IntPtr s, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();

  public static IntPtr Desktop;
  public static string DesktopName;
  public static int Start(string exe, string args, string cwd) {
    DesktopName = "kolux-nowin-" + Guid.NewGuid().ToString("N").Substring(0, 8);
    Desktop = CreateDesktop(DesktopName, null, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    if (Desktop == IntPtr.Zero) throw new Exception("CreateDesktop failed: " + Marshal.GetLastWin32Error());
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.lpDesktop = "WinSta0\\" + DesktopName;
    PROCESS_INFORMATION pi;
    // DETACHED_PROCESS (0x8): no console, like the release build. The environment is this process's own.
    if (!CreateProcess(null, new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(args) ? "" : " " + args)), IntPtr.Zero, IntPtr.Zero, false, 0x8, IntPtr.Zero, string.IsNullOrEmpty(cwd) ? null : cwd, ref si, out pi)) throw new Exception("CreateProcess failed: " + Marshal.GetLastWin32Error());
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }
  // What console the process has: "none" (no console, or not ready yet), "console, no window" (CREATE_NO_WINDOW or a
  // pseudo console), "window hidden" or "WINDOW VISIBLE". Attaches to its console for an instant; this process has none of its own.
  public static string ConsoleOf(uint pid) {
    FreeConsole();
    try {
      if (!AttachConsole(pid)) return "none";
      IntPtr h = GetConsoleWindow();
      if (h == IntPtr.Zero) return "console, no window";
      return IsWindowVisible(h) ? "WINDOW VISIBLE " + h.ToString("x") : "window hidden " + h.ToString("x");
    } finally { FreeConsole(); }
  }
  public static void Stop() { if (Desktop != IntPtr.Zero) { CloseDesktop(Desktop); Desktop = IntPtr.Zero; } }
  // One row per top-level window on the private desktop: class|title|pid|visible
  public static List<string> Windows() {
    var rows = new List<string>();
    EnumDesktopWindows(Desktop, (h, lp) => {
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      rows.Add(c + "|" + t.ToString().Replace("|", "/") + "|" + pid + "|" + (IsWindowVisible(h) ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    return rows;
  }
  // pid -> "ppid|exe"
  public static Dictionary<uint, string> Processes() {
    var map = new Dictionary<uint, string>();
    IntPtr s = CreateToolhelp32Snapshot(2, 0);
    var e = new PROCESSENTRY32(); e.dwSize = (uint)Marshal.SizeOf(e);
    if (Process32First(s, ref e)) { do { map[e.th32ProcessID] = e.th32ParentProcessID + "|" + e.szExeFile; } while (Process32Next(s, ref e)); }
    CloseHandle(s);
    return map;
  }
}
"@

$t0 = [DateTime]::UtcNow
[NW]::ConsoleOf(0) | Out-Null   # drop this process's own console first
$known = [NW]::Processes()
$appPid = [NW]::Start($Exe, $Args, $Cwd)
$tree = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$tree.Add([uint32]$appPid)
$seenWin = @{}
$windows = New-Object System.Collections.ArrayList
$procs = New-Object System.Collections.ArrayList
$seenProc = @{}
$tries = @{}
$deadline = $t0.AddSeconds($MaxSeconds)
$samples = 0
while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $StopFile)) {
  $samples++
  $now = [int]([DateTime]::UtcNow - $t0).TotalMilliseconds
  $all = [NW]::Processes()
  foreach ($k in $all.Keys) {
    if ($known.ContainsKey($k) -or $seenProc.ContainsKey($k)) { continue }
    $p = $all[$k].Split('|', 2)
    $ppid = [uint32]$p[0]
    # a process belongs to the app when its parent is in the tree (the tree grows as children are seen)
    if ($tree.Contains($ppid)) {
      [void]$tree.Add([uint32]$k)
      $seenProc[$k] = $true
      $parent = if ($all.ContainsKey($ppid)) { $all[$ppid].Split('|', 2)[1] } else { "?" }
      $tries[[int]$k] = 1
      [void]$procs.Add([ordered]@{ t = $now; pid = [int]$k; ppid = [int]$ppid; exe = $p[1]; parent = $parent; console = [NW]::ConsoleOf([uint32]$k) })
    }
  }
  foreach ($p in $procs) {
    if ($p.console -eq "none" -and $tries[$p.pid] -lt 4 -and $all.ContainsKey([uint32]$p.pid)) {
      $tries[$p.pid]++
      $p.console = [NW]::ConsoleOf([uint32]$p.pid)
    }
  }
  foreach ($row in [NW]::Windows()) {
    $f = $row.Split('|')
    $key = $row
    if ($seenWin.ContainsKey($key)) { continue }
    $seenWin[$key] = $true
    $wpid = [int]$f[2]
    $exe = if ($all.ContainsKey([uint32]$wpid)) { $all[[uint32]$wpid].Split('|', 2)[1] } else { "(gone)" }
    [void]$windows.Add([ordered]@{ t = $now; class = $f[0]; title = $f[1]; pid = $wpid; exe = $exe; visible = ($f[3] -eq "1") })
  }
  Start-Sleep -Milliseconds 20
}
# Stop the app and everything it started.
foreach ($id in @($tree)) { try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }
$wait = [DateTime]::UtcNow.AddSeconds(5)
while ([DateTime]::UtcNow -lt $wait -and (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 100 }
Start-Sleep -Milliseconds 300
[NW]::Stop()
$consoleClasses = @("ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "PseudoConsoleWindow")
$visibleConsole = @($windows | Where-Object { $_.visible -and $consoleClasses -contains $_.class })
$visibleByProcess = @($procs | Where-Object { $_.console -like "WINDOW VISIBLE*" })
$pids = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($p in $visibleByProcess) { [void]$pids.Add($p.console) }
$visibleCount = [Math]::Max($pids.Count, $visibleConsole.Count)
$out = [ordered]@{
  exe = $Exe; appPid = $appPid; samples = $samples; seconds = [int]([DateTime]::UtcNow - $t0).TotalSeconds
  visibleConsoleWindows = $visibleCount
  windows = $windows; processes = $procs
}
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Report -Encoding UTF8
Write-Output ("probe done: {0} samples, {1} child processes, {2} windows, {3} visible console windows" -f $samples, $procs.Count, $windows.Count, $visibleCount)
