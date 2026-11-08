// LIVE proof, APP-052 boxes 1 and 2 (spec/19). Hidden app, scratch profile, one shell pane.
// b1: print a marker, quit and relaunch three times -> the marker is shown after each launch.
// b2: kill ONLY the terminal-service process tied to this scratch root (its data-folder argument lies under it), relaunch
// -> the terminal comes back from its saved history.
// A development build links the background terminal service only with KOLUX_TERMINAL_SERVICE=1 (pty_link.rs `wanted`; an
// installed build always does), so this script sets it for the app it launches (live-common strips every KOLUX_ variable at import).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, waitFor, dismissFirstRun, TERM, LIVE_BASE } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = {};
const check = (box, name, pass, detail) => {
  (asserts[box] ??= []).push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${box}: ${name}: ${detail}`);
};
const stamp = Date.now().toString(36).slice(-4);
const M1 = `APP052-A${stamp}-END`;
const M2 = `APP052-B${stamp}-END`;
const ROOT = `${LIVE_BASE}/run-APP-052`.replaceAll("\\", "/").toLowerCase();
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", windowsHide: true }).trim();
// Terminal-service processes whose command line names this scratch root (never any other service on the machine).
const services = () => {
  const out = ps(`Get-CimInstance Win32_Process -Filter "CommandLine like '%--terminal-service%'" | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }`);
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, ppid, ...rest] = l.split("|");
    return { pid: Number(pid), ppid: Number(ppid), cmd: rest.join("|") };
  });
};
const mine = () => services().filter((s) => s.cmd.replaceAll("\\", "/").toLowerCase().includes(ROOT));
const lines = async (i) => ((await ctx.text(i)) ?? "").split("\n").map((l) => l.trim());
const back = async (app) => {
  await dismissFirstRun(app, log);
  await waitFor("one terminal pane back", async () => (await app.shown(TERM)) >= 1, 60000, 500);
  await waitFor("its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 1, 30000);
  await sleep(4000);
};
try {
  process.env.KOLUX_TERMINAL_SERVICE = "1";
  ctx = await startPlain("APP-052", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await ctx.typeInto(0, `Write-Output '${M1}'`);
  await waitFor("marker 1", async () => (await lines(0)).includes(M1), 30000, 500);
  log(`marker ${M1} printed; terminal services tied to ${ROOT}: ${JSON.stringify(mine().map((s) => ({ pid: s.pid, ppid: s.ppid })))}`);
  for (let round = 1; round <= 3; round++) {
    const closed = await app.closeAndCount(app.pid);
    log(`round ${round} quit: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)}); services tied to this root after quit: ${JSON.stringify(mine().map((s) => s.pid))}`);
    await app.relaunch();
    await back(app);
    const l = await lines(0);
    check("b1", `round ${round}: the marker is shown after the relaunch`, l.includes(M1), `${l.length} buffer rows, panes shown ${await app.shown(TERM)}`);
    log(`round ${round} services tied to this root: ${JSON.stringify(mine().map((s) => ({ pid: s.pid, ppid: s.ppid })))}`);
    if (round === 1) log(`screenshot: ${await ctx.shot("APP-052-round1")}`);
  }
  log(`screenshot: ${await ctx.shot("APP-052-round3")}`);

  // b2
  const svc = mine();
  log(`b2: terminal services tied to this root: ${svc.length}; command lines: ${JSON.stringify(svc.map((s) => s.cmd.slice(0, 300)))}`);
  check("b2", "exactly one terminal service is tied to this scratch root (proved by its data-folder argument)", svc.length === 1, `${svc.length}`);
  if (svc.length === 1) {
    await ctx.typeInto(0, `Write-Output '${M2}'`);
    await waitFor("marker 2", async () => (await lines(0)).includes(M2), 30000, 500);
    await sleep(2500);
    const target = svc[0].pid;
    ps(`Stop-Process -Id ${target} -Force`);
    const gone = await waitFor("the service to be gone", async () => !services().some((s) => s.pid === target), 15000, 300).then(() => true, () => false);
    check("b2", "only that service was killed", gone && services().filter((s) => !svc.some((m) => m.pid === s.pid)).length === services().length, `pid ${target} gone ${gone}; other services on the machine untouched: ${services().length}`);
    await sleep(2000);
    log(`app after the kill: pid ${app.pid}, window still answering: ${await app.evalJs("1+1").then(String, (e) => "no " + e.message)}`);
    const closed = await app.closeAndCount(app.pid);
    log(`b2 quit: ${closed.how}; survivors ${closed.survivors.length}`);
    await app.relaunch();
    await back(app);
    const l = await lines(0);
    check("b2", "after the kill and a relaunch the terminal is back with its earlier output (marker 2)", l.includes(M2), `${l.length} buffer rows; marker 1 kept ${l.includes(M1)}; tail ${JSON.stringify(l.filter(Boolean).slice(-4))}`);
    log(`services tied to this root after the relaunch: ${JSON.stringify(mine().map((s) => ({ pid: s.pid, ppid: s.ppid })))}`);
    log(`screenshot: ${await ctx.shot("APP-052-after-kill")}`);
  }
  ok = Object.values(asserts).flat().every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
// Cleanup of what this script started: services tied to this root (the final close leaves them running by design).
try {
  const left = mine();
  for (const s of left) ps(`Stop-Process -Id ${s.pid} -Force`);
  log(`cleanup: ended ${left.length} terminal service(s) tied to this root: ${JSON.stringify(left.map((s) => s.pid))}`);
} catch (e) {
  log(`cleanup error ${e.message}`);
}
log(`BOX-RESULT b1 ${asserts.b1?.length ? asserts.b1.every(Boolean) : "none"}; b2 ${asserts.b2?.length ? asserts.b2.every(Boolean) : "none"}`);
process.exit(ctx ? await finish(ctx, "APP-052", ev, ok) : 1);
