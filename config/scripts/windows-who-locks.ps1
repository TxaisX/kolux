# Lists the processes holding a file open, via the Windows Restart Manager (no Sysinternals needed).
# Why: a silent update (installer /S) aborts with exit code 2 when any installed file is locked,
# and the locker is often not Kolux at all (a VS Code window held resources\app.asar).
#   powershell -NoProfile -ExecutionPolicy Bypass -File config\scripts\windows-who-locks.ps1 -Path "$env:LOCALAPPDATA\Programs\kolux\resources\app.asar"
param([Parameter(Mandatory = $true)][string]$Path)
$sig = @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class RM {
  [StructLayout(LayoutKind.Sequential)] public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct RM_PROCESS_INFO { public RM_UNIQUE_PROCESS Process; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string strAppName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string strServiceShortName; public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable; }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
  public static List<int> Who(string path) {
    uint h; string key = Guid.NewGuid().ToString(); var res = new List<int>();
    if (RmStartSession(out h, 0, key) != 0) throw new Exception("RmStartSession failed");
    try {
      if (RmRegisterResources(h, 1, new string[]{path}, 0, null, 0, null) != 0) throw new Exception("RmRegisterResources failed");
      uint needed = 0, count = 0, reasons = 0;
      int rc = RmGetList(h, out needed, ref count, null, ref reasons);
      if (rc == 234) { var info = new RM_PROCESS_INFO[needed]; count = needed; rc = RmGetList(h, out needed, ref count, info, ref reasons); if (rc == 0) { for (int i = 0; i < count; i++) res.Add(info[i].Process.dwProcessId); } }
      else if (rc != 0) throw new Exception("RmGetList rc=" + rc);
    } finally { RmEndSession(h); }
    return res;
  }
}
"@
Add-Type -TypeDefinition $sig
$ids = [RM]::Who($Path)
"holders: $($ids.Count)"
foreach ($id in $ids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
  "$id  $($p.Name)  parent=$($p.ParentProcessId)  $($p.CommandLine)"
}
