// Spike (c): host the Windows Terminal rendering engine (HwndTerminal flat C API in
// Microsoft.Terminal.Control.dll, the engine behind the WPF TerminalControl) inside a plain
// Win32/WinForms window, fed by OUR OWN ConPTY. No WPF involved.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

public static class HwndTerminalSpike
{
    // ---- Microsoft.Terminal.Control.dll (v1.25 flat C API, same as WPF control's NativeMethods.cs) ----
    const string T = "Microsoft.Terminal.Control.dll";
    [StructLayout(LayoutKind.Sequential)] public struct TilSize { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct TerminalTheme
    {
        public uint DefaultBackground; public uint DefaultForeground; public uint DefaultSelectionBackground; public uint CursorStyle;
        [MarshalAs(UnmanagedType.ByValArray, ArraySubType = UnmanagedType.U4, SizeConst = 16)] public uint[] ColorTable;
    }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate void WriteCallback([In, MarshalAs(UnmanagedType.LPWStr)] string data);

    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = false)] static extern void CreateTerminal(IntPtr parent, out IntPtr hwnd, out IntPtr terminal);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalSendOutput(IntPtr terminal, string data);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = false)] static extern void TerminalTriggerResize(IntPtr terminal, int width, int height, out TilSize dims);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalDpiChanged(IntPtr terminal, int dpi);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalRegisterWriteCallback(IntPtr terminal, WriteCallback cb);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalSendCharEvent(IntPtr terminal, char ch, ushort scanCode, ushort flags);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalSetTheme(IntPtr terminal, TerminalTheme theme, string font, short fontSize, int dpi);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall, PreserveSig = true)] static extern void TerminalSetFocused(IntPtr terminal, bool focused);
    [DllImport(T, CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)] static extern void DestroyTerminal(IntPtr terminal);

    // ---- Win32 ----
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string path);
    [DllImport("user32")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32")] static extern IntPtr SetFocus(IntPtr h);
    [DllImport("user32")] static extern IntPtr GetFocus();
    [DllImport("user32")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32")] static extern IntPtr GetParent(IntPtr h);
    const uint SWP_NOZORDER = 0x4, SWP_SHOWWINDOW = 0x40, WM_CHAR = 0x102;

    // ---- ConPTY ----
    [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
    [DllImport("kernel32", SetLastError = true)] static extern int CreatePseudoConsole(COORD size, SafeFileHandle hIn, SafeFileHandle hOut, uint flags, out IntPtr hPC);
    [DllImport("kernel32")] static extern int ResizePseudoConsole(IntPtr hPC, COORD size);
    [DllImport("kernel32")] static extern void ClosePseudoConsole(IntPtr hPC);
    [DllImport("kernel32", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle r, out SafeFileHandle w, IntPtr sa, int size);
    [DllImport("kernel32", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
    [DllImport("kernel32", SetLastError = true)] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string r; public string d; public string t; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }

    static readonly List<string> log = new List<string>();
    static void L(string s) { lock (log) { log.Add(DateTime.Now.ToString("HH:mm:ss.fff") + " " + s); } }

    public static string[] Run(string dllPath, string outDir, string samplePath)
    {
        try { L("SetProcessDpiAwarenessContext(PMv2) = " + SetProcessDpiAwarenessContext(new IntPtr(-4))); } catch (Exception e) { L("dpi ctx: " + e.Message); }
        IntPtr mod = LoadLibraryW(dllPath);
        L("LoadLibrary(" + Path.GetFileName(dllPath) + ") = 0x" + mod.ToString("X") + " err=" + Marshal.GetLastWin32Error());
        if (mod == IntPtr.Zero) return log.ToArray();

        long wsBefore = Process.GetCurrentProcess().WorkingSet64;
        var form = new Form { Text = "Kolux spike (c): HwndTerminal fed by our ConPTY", StartPosition = FormStartPosition.Manual, Location = new Point(60, 60), ClientSize = new Size(960, 560), TopMost = true, BackColor = Color.FromArgb(40, 40, 60) };
        var hostPanel = new Panel { Location = new Point(20, 40), Size = new Size(900, 480), BackColor = Color.Magenta };
        var label = new Label { Text = "WebView-like chrome (stands in for a Kolux pane header)", ForeColor = Color.White, Location = new Point(20, 10), AutoSize = true };
        form.Controls.Add(label); form.Controls.Add(hostPanel);

        IntPtr term = IntPtr.Zero, termHwnd = IntPtr.Zero, hPC = IntPtr.Zero; PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        SafeFileHandle inR = null, inW = null, outR = null, outW = null; FileStream inStream = null;
        var captured = new StringBuilder(); var typed = new StringBuilder();
        WriteCallback cb = null; // keep alive
        Exception fatal = null;

        Action<string> shot = name =>
        {
            Application.DoEvents();
            var r = form.RectangleToScreen(form.ClientRectangle);
            using (var bmp = new Bitmap(r.Width, r.Height))
            {
                using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(r.Location, Point.Empty, r.Size);
                bmp.Save(Path.Combine(outDir, name), ImageFormat.Png);
                // paint check inside the host panel rect: count pixels that are neither magenta placeholder nor the bg
                var pr = hostPanel.Bounds; int magenta = 0, other = 0; var colors = new HashSet<int>();
                for (int y = pr.Top; y < pr.Bottom; y += 2) for (int x = pr.Left; x < pr.Right; x += 2)
                    { var c = bmp.GetPixel(x, y); if (c.R > 240 && c.G < 20 && c.B > 240) magenta++; else other++; colors.Add(c.ToArgb()); }
                L("shot " + name + ": panel " + pr.Width + "x" + pr.Height + " sampled magenta(placeholder visible)=" + magenta + " other=" + other + " distinctColors=" + colors.Count);
            }
        };

        form.Shown += (s, e) =>
        {
            try
            {
                L("form dpi=" + GetDpiForWindow(form.Handle));
                CreateTerminal(hostPanel.Handle, out termHwnd, out term);
                var cls = new StringBuilder(256); GetClassNameW(termHwnd, cls, 256);
                L("CreateTerminal ok: hwnd=0x" + termHwnd.ToString("X") + " class=" + cls + " parentIsPanel=" + (GetParent(termHwnd) == hostPanel.Handle));
                var theme = new TerminalTheme { DefaultBackground = 0x0C0C0C, DefaultForeground = 0xCCCCCC, DefaultSelectionBackground = 0xFFFFFF, CursorStyle = 2,
                    ColorTable = new uint[] { 0x0C0C0C, 0x1F0FC5, 0x0EA113, 0x009CC1, 0xDA3700, 0x981788, 0xDD963A, 0xCCCCCC, 0x767676, 0x5648E7, 0x0CC616, 0xA5F1F9, 0xFF783B, 0x9E00B4, 0xD6D661, 0xF2F2F2 } };
                int dpi = (int)GetDpiForWindow(form.Handle);
                TerminalSetTheme(term, theme, "Cascadia Mono", 12, dpi);
                cb = data => { lock (typed) typed.Append(data); var b = Encoding.UTF8.GetBytes(data); try { inStream.Write(b, 0, b.Length); inStream.Flush(); } catch (Exception ex) { L("input write: " + ex.Message); } };
                TerminalRegisterWriteCallback(term, cb);
                SetWindowPos(termHwnd, IntPtr.Zero, 0, 0, hostPanel.Width, hostPanel.Height, SWP_NOZORDER | SWP_SHOWWINDOW);
                TilSize dims; TerminalTriggerResize(term, hostPanel.Width, hostPanel.Height, out dims);
                L("TriggerResize " + hostPanel.Width + "x" + hostPanel.Height + "px -> " + dims.X + " cols x " + dims.Y + " rows");

                // our own ConPTY, sized to what the engine computed
                CreatePipe(out inR, out inW, IntPtr.Zero, 0); CreatePipe(out outR, out outW, IntPtr.Zero, 0);
                int hr = CreatePseudoConsole(new COORD { X = (short)dims.X, Y = (short)dims.Y }, inR, outW, 0, out hPC);
                L("CreatePseudoConsole hr=0x" + hr.ToString("X"));
                IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                si.StartupInfo.flags = 0x100; // STARTF_USESTDHANDLES with null handles: otherwise cmd inherits the parent's redirected stdio instead of the pseudoconsole (first run proved this)
                si.lpAttributeList = Marshal.AllocHGlobal(size);
                InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, ref size);
                UpdateProcThreadAttribute(si.lpAttributeList, 0, new IntPtr(0x00020016), hPC, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero);
                var cmd = new StringBuilder("cmd.exe /d /k chcp 65001>nul & type \"" + samplePath + "\"");
                bool ok = CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00080000, IntPtr.Zero, null, ref si, out pi);
                L("CreateProcess(cmd under our ConPTY) ok=" + ok + " pid=" + pi.pid + " err=" + Marshal.GetLastWin32Error());
                inR.Dispose(); outW.Dispose();
                inStream = new FileStream(inW, FileAccess.Write);
                var reader = new Thread(() =>
                {
                    var fs = new FileStream(outR, FileAccess.Read); var dec = Encoding.UTF8.GetDecoder(); var buf = new byte[8192]; var cbuf = new char[16384];
                    try
                    {
                        int n; while ((n = fs.Read(buf, 0, buf.Length)) > 0)
                        {
                            int c = dec.GetChars(buf, 0, n, cbuf, 0); var str = new string(cbuf, 0, c);
                            lock (captured) captured.Append(str);   // <- the stream Kolux's status parsing would still see
                            form.BeginInvoke((Action)(() => { if (term != IntPtr.Zero) TerminalSendOutput(term, str); }));
                        }
                    }
                    catch (Exception ex) { L("reader end: " + ex.GetType().Name); }
                }) { IsBackground = true };
                reader.Start();
            }
            catch (Exception ex) { fatal = ex; L("FATAL in Shown: " + ex); }
        };

        var director = new Thread(() =>
        {
            Action<Action> ui = a => form.Invoke(a);
            try
            {
                Thread.Sleep(3000);
                if (fatal != null) { ui(() => form.Close()); return; }
                ui(() => shot("c1-initial.png"));

                // focus: foreground our form, then SetFocus the engine's HWND
                ui(() => { L("SetForegroundWindow(form)=" + SetForegroundWindow(form.Handle) + " fgIsForm=" + (GetForegroundWindow() == form.Handle)); SetFocus(termHwnd); L("GetFocus()==termHwnd: " + (GetFocus() == termHwnd)); TerminalSetFocused(term, true); });

                // input path 1: post WM_CHAR straight to the engine HWND (no global keystrokes)
                ui(() => { foreach (char ch in "echo posted-wmchar\r") PostMessageW(termHwnd, WM_CHAR, new IntPtr(ch), new IntPtr(1)); });
                Thread.Sleep(1500);
                string afterPost; lock (typed) afterPost = typed.ToString();
                L("write-callback after WM_CHAR posts: [" + afterPost.Replace("\r", "\\r") + "]");
                // input path 2: the explicit API the WPF host uses
                ui(() => { foreach (char ch in "echo via-api\r") TerminalSendCharEvent(term, ch, 0, 0); });
                Thread.Sleep(1500);
                lock (typed) L("write-callback total: [" + typed.ToString().Replace("\r", "\\r") + "]");
                ui(() => shot("c2-after-input.png"));
                // glyph check fed straight into the engine (cmd's `type` mangles UTF-8 through the OEM code page, a harness issue)
                ui(() => TerminalSendOutput(term, "\r\n[direct feed] box ┌──┐ │x│ └──┘  cjk 日本語  emoji 🚀✅  \u001b[38;2;215;119;87m●\u001b[0m Thinking…  ligature-candidates: => != -> <=\r\n"));
                Thread.Sleep(800);
                ui(() => shot("c2b-unicode.png"));

                // resize: shrink the placeholder, move/size the engine HWND, tell the engine and our ConPTY
                ui(() =>
                {
                    hostPanel.Size = new Size(560, 300);
                    SetWindowPos(termHwnd, IntPtr.Zero, 0, 0, 560, 300, SWP_NOZORDER);
                    TilSize d; TerminalTriggerResize(term, 560, 300, out d);
                    ResizePseudoConsole(hPC, new COORD { X = (short)d.X, Y = (short)d.Y });
                    L("resize 560x300px -> " + d.X + " cols x " + d.Y + " rows");
                });
                Thread.Sleep(1500);
                ui(() => shot("c3-resized.png"));

                // DPI change (as when the window is dragged to a 150% monitor)
                ui(() =>
                {
                    TerminalDpiChanged(term, 144);
                    TilSize d; TerminalTriggerResize(term, 560, 300, out d);
                    ResizePseudoConsole(hPC, new COORD { X = (short)d.X, Y = (short)d.Y });
                    L("dpi 144 at 560x300px -> " + d.X + " cols x " + d.Y + " rows");
                });
                Thread.Sleep(1500);
                ui(() => shot("c4-dpi144.png"));
                L("working set delta after engine+conpty: " + ((Process.GetCurrentProcess().WorkingSet64 - wsBefore) / (1024 * 1024)) + " MB");
            }
            catch (Exception ex) { L("director: " + ex); }
            finally { try { form.Invoke((Action)(() => form.Close())); } catch { } }
        }) { IsBackground = true };
        director.Start();

        var hardStop = new System.Windows.Forms.Timer { Interval = 30000 }; hardStop.Tick += (s, e) => { L("hard stop timer"); form.Close(); }; hardStop.Start();
        Application.Run(form);
        hardStop.Stop();

        // cleanup
        try { if (term != IntPtr.Zero) { DestroyTerminal(term); term = IntPtr.Zero; L("DestroyTerminal done"); } } catch (Exception ex) { L("destroy: " + ex.Message); }
        if (hPC != IntPtr.Zero) { ClosePseudoConsole(hPC); L("ClosePseudoConsole done"); }
        if (pi.hProcess != IntPtr.Zero) { L("TerminateProcess(cmd pid " + pi.pid + ")=" + TerminateProcess(pi.hProcess, 0)); CloseHandle(pi.hProcess); CloseHandle(pi.hThread); }
        try { if (inStream != null) inStream.Dispose(); } catch { }
        string cap; lock (captured) cap = captured.ToString();
        File.WriteAllText(Path.Combine(outDir, "c-captured-stream.txt"), cap);
        L("captured stream chars=" + cap.Length + " containsMarker(KOLUX-SPIKE-C)=" + cap.Contains("KOLUX-SPIKE-C") + " containsEchoedInput=" + cap.Contains("posted-wmchar") + "/" + cap.Contains("via-api"));
        L("cmd pid for cleanup check: " + pi.pid);
        return log.ToArray();
    }
}
