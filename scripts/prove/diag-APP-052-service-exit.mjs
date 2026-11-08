// Diagnostic for APP-052: when exactly does the background terminal service (and its shell) end during a window quit?
// Polls the service pid, its shell child and the app pid every 200 ms while the window closes. Not a box proof.
import { execFileSync } from "node:child_process";
import { reporter, startPlain, finish, sleep, TERM, LIVE_BASE } from "./live-common.mjs";

process.env.KOLUX_TERMINAL_SERVICE = "1";
const rep = reporter();
const { log, lines: ev } = rep;
const ROOT = `${LIVE_BASE}/run-APP-052d`.toLowerCase();
const ps = (c) => execFileSync("powershell", ["-NoProfile", "-Command", c], { encoding: "utf8", windowsHide: true }).trim();
const snap = () =>
  ps(`Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }`)
    .split(/\r?\n/).map((l) => l.split("|"));
let ctx;
let ok = false;
try {
  ctx = await startPlain("APP-052d", { report: rep });
  const { app } = ctx;
  await sleep(4000);
  const all = snap();
  const svc = all.find((r) => /--terminal-service/.test(r.slice(3).join("|")) && r.slice(3).join("|").replaceAll("\\", "/").toLowerCase().includes(ROOT));
  const kids = svc ? all.filter((r) => r[1] === svc[0]) : [];
  log(`app pid ${app.pid}; service ${svc ? `${svc[0]} (ppid ${svc[1]})` : "none"}; its children ${JSON.stringify(kids.map((r) => `${r[0]}:${r[2]}`))}`);
  const inJob = (pid) => ps(`Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);' -Name J -Namespace K; $r=$false; [void][K.J]::IsProcessInJob((Get-Process -Id ${pid}).Handle, [IntPtr]::Zero, [ref]$r); $r`);
  log(`in a job object: app ${inJob(app.pid)}, service ${svc ? inJob(svc[0]) : "n/a"}, the node harness ${inJob(process.pid)}`);
  const t0 = Date.now();
  const watch = [app.pid, svc?.[0], ...kids.map((r) => r[0])].filter(Boolean);
  const gone = {};
  const t1 = Date.now();
  if (process.argv[2] === "kill") ps(`Stop-Process -Id ${app.pid} -Force`);
  log(`app end requested (the call took ${Date.now() - t1} ms)`);
  const hard = process.argv[2] === "kill";
  log(hard ? "closing by ending the app process only (Stop-Process on the app pid)" : "closing by the window close request");
  const closing = hard ? Promise.resolve() : app.gracefulClose(app.pid).catch((e) => log(`close error ${e.message}`));
  const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
  for (let i = 0; i < 400; i++) {
    const live = new Set(watch.filter(alive).map(String));
    for (const p of watch) if (!live.has(p) && gone[p] === undefined) gone[p] = Date.now() - t0;
    if (Object.keys(gone).length === watch.length) break;
    if (hard && gone[app.pid] !== undefined && i > 200) break;
    await sleep(50);
  }
  await closing;
  log(`ended (ms after the close request): ${JSON.stringify(gone)} for pids ${JSON.stringify(watch)} (app, service, service children)`);
  ok = true;
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
try {
  for (const r of snap()) if (/--terminal-service/.test(r.slice(3).join("|")) && r.slice(3).join("|").replaceAll("\\", "/").toLowerCase().includes(ROOT)) ps(`Stop-Process -Id ${r[0]} -Force`);
} catch {}
process.exit(ctx ? await finish(ctx, "APP-052d", ev, ok) : 1);
