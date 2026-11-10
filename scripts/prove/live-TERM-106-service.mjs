// LIVE proof, TERM-106 box 1 (spec/03) against the REAL background host (batch 14, 2026-10-28):
// "After killing the host, reopened panes show their earlier output above a new prompt."
// Hidden app with KOLUX_TERMINAL_SERVICE=1 (a dev build links the service only then), scratch profile, one shell pane.
// Only the terminal-service process tied to this scratch root (its data-folder argument lies under it) is killed; the app is not.
// Then: does the app re-link by itself? If not, quit and relaunch on the same profile. One reading, three readings:
//   (a) marker row < restored note row < new prompt row in the xterm buffer
//   (b) the new prompt accepts `echo M2-<rand>` and the output shows within 10 s
//   (c) the new shell's cwd equals the old one
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { reporter, startPlain, finish, sleep, waitFor, dismissFirstRun, TERM, LIVE_BASE } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
let tRelaunch = 0;
const asserts = [];
const check = (box, name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${box}: ${name}: ${detail}`);
};
const norm = (s) => s.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const stamp = Date.now().toString(36).slice(-4);
const M = `H${stamp}-OUTPUT-END`;
const M2 = `M2-${Math.random().toString(36).slice(2, 8)}`;
const NOTE = "restored after a restart";
const ROOT = `${LIVE_BASE}/run-TERM-106`.replaceAll("\\", "/").toLowerCase();
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", windowsHide: true }).trim();
const services = () => {
  const out = ps(`Get-CimInstance Win32_Process -Filter "CommandLine like '%--terminal-service%'" | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }`);
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, ppid, ...rest] = l.split("|");
    return { pid: Number(pid), ppid: Number(ppid), cmd: rest.join("|") };
  });
};
const mine = () => services().filter((s) => s.cmd.replaceAll("\\", "/").toLowerCase().includes(ROOT));
const rowsOf = async () => ((await ctx.text(0)) ?? "").split("\n").map((l) => l.trimEnd());
const logCounts = (profile, what) => {
  const f = join(profile, "logs", "kolux.log");
  if (!existsSync(f)) return log(`${what}: no kolux.log under the scratch profile`);
  const t = readFileSync(f, "utf8").split(/\r?\n/);
  const hits = (re) => t.filter((l) => re.test(l)).length;
  log(`${what}: kolux.log ${statSync(f).size} bytes, ${t.length} lines; terminal-service ${hits(/terminal.service/i)}; linked ${hits(/linked/i)}; taken back ${hits(/taken back/i)}; error/warn ${hits(/error|warn|fail/i)}`);
  for (const l of t.filter((x) => /terminal.service|linked|adopt|relink|lost/i.test(x)).slice(-6)) log(`  log: ${l.replaceAll("\\", "/").replace(/[A-Za-z]:\/[^\s"']*/g, "<path>").slice(0, 200)}`);
};
try {
  process.env.KOLUX_TERMINAL_SERVICE = "1";
  ctx = await startPlain("TERM-106", { report: rep });
  const { app } = ctx;
  const profile = app.paths.profile;
  await sleep(3000);
  await ctx.typeInto(0, `Write-Output '${M}'`);
  await waitFor("the marker", async () => (await rowsOf()).some((l) => l.trim() === M), 30000, 500);
  await ctx.typeInto(0, "Write-Output ('WD=' + (Get-Location).Path)");
  const wdLine = await waitFor("the folder line", async () => (await rowsOf()).map((l) => l.trim()).find((l) => /^WD=/.test(l)) ?? null, 30000, 500);
  const wd0 = wdLine.slice(3);
  log(`pane folder before: ${wd0}`);
  await sleep(3000);
  const svc = mine();
  log(`terminal services tied to ${ROOT}: ${svc.length}; ${JSON.stringify(svc.map((s) => ({ pid: s.pid, ppid: s.ppid, dataArg: (s.cmd.match(/--[a-z-]*(?:dir|folder|data)[a-z-]*[ =]"?([^"]+?)"?(?:\s--|$)/i) ?? [])[1]?.replaceAll("\\", "/").toLowerCase().includes(ROOT) ?? "see cmd" })))}`);
  log(`service command line (paths redacted): ${svc.map((s) => s.cmd.replaceAll("\\", "/").replace(/"?[A-Za-z]:\/[^\s"]*/g, "<path>").slice(0, 160)).join(" || ")}`);
  check("setup", "exactly one terminal service tied to this scratch root", svc.length === 1, String(svc.length));
  if (svc.length !== 1) throw new Error("no unique service to kill");
  const target = svc[0].pid;
  const before = services().length;
  log(`app pid ${app.pid}; all terminal services on the machine: ${before}`);
  logCounts(profile, "before the kill");
  log(`screenshot: ${await ctx.shot("TERM-106s-before-kill")}`);
  ps(`Stop-Process -Id ${target} -Force`);
  const gone = await waitFor("the service to be gone", async () => !services().some((s) => s.pid === target), 15000, 300).then(() => true, () => false);
  log(`killed ONLY service pid ${target}: gone ${gone}; app pid ${app.pid} still alive: ${await app.alive?.(app.pid)}; services on the machine now ${services().length}`);
  check("setup", "only that service was killed (app untouched)", gone, `pid ${target}`);

  // Does the app re-link by itself?
  await sleep(500);
  let self = "no";
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (mine().length > 0) {
      self = "a new service for this root appeared";
      break;
    }
    await sleep(1000);
  }
  const rowsAfterKill = await rowsOf();
  log(`20 s after the kill: new service tied to this root: ${mine().length}; self-relink: ${self}`);
  log(`pane tail after the kill: ${JSON.stringify(rowsAfterKill.filter((l) => l.trim()).slice(-6))}`);
  log(`pane rows: note present ${rowsAfterKill.some((l) => l.includes(NOTE))}; window answering: ${await app.evalJs("1+1").then(String, (e) => "no " + e.message)}`);
  logCounts(profile, "after the kill");
  log(`screenshot: ${await ctx.shot("TERM-106s-after-kill")}`);
  const noteNow = rowsAfterKill.some((l) => l.includes(NOTE));
  let path;
  if (self !== "no" && noteNow) {
    path = "self-relink";
  } else {
    path = "quit+relaunch";
    const closed = await app.closeAndCount(app.pid);
    log(`quit: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)}); services tied to this root after quit: ${JSON.stringify(mine().map((s) => s.pid))}`);
    await app.relaunch();
    tRelaunch = Date.now();
    // Diagnostic poller: when does the pane first show the ended line, and what is the log/service doing at that moment?
    const t1 = Date.now();
    let seenEnd = false;
    const poller = (async () => {
      while (!seenEnd && Date.now() - t1 < 60000) {
        const txt = (await ctx.text(0).catch(() => null)) ?? "";
        const lg = (() => { try { return readFileSync(join(profile, "logs", "kolux.log"), "utf8").split(/\r?\n/).filter((l) => /terminal \d+ (started|exited)/.test(l)).map((l) => l.replace(/^(\d+) .*?(terminal \d+ \w+).*$/, "$1 $2")).slice(-3).join(" ; "); } catch { return ""; } })();
        if (/\[process ended/.test(txt)) {
          seenEnd = true;
          log(`poller: ended line first seen ${((Date.now() - t1) / 1000).toFixed(1)} s after the relaunch; log: ${lg}; services ${JSON.stringify(mine().map((s) => s.pid))}`);
        }
        await sleep(500);
      }
    })();
    await dismissFirstRun(app, log);
    await waitFor("a pane back", async () => (await app.shown(TERM)) >= 1, 60000, 500);
    await waitFor("its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 1, 30000);
    await sleep(5000);
  }
  log(`path to the reopened pane: ${path}; services tied to this root now: ${JSON.stringify(mine().map((s) => ({ pid: s.pid, ppid: s.ppid })))}`);
  logCounts(profile, "after the reopen");
  log(`screenshot: ${await ctx.shot("TERM-106s-restored-view")}`);
  const r1 = await rowsOf();
  const iM = r1.findIndex((l) => l.trim() === M);
  const iNote = r1.findIndex((l) => l.includes(NOTE));
  const iPrompt = r1.findIndex((l, i) => i > iNote && iNote >= 0 && /^PS .*>/.test(l.trim()));
  log(`rows before any typing: marker ${iM}, restored note ${iNote}, new prompt ${iPrompt} (buffer ${r1.length} rows)`);
  log(`buffer tail: ${JSON.stringify(r1.filter((l) => l.trim()).slice(-8))}`);
  check("a", "marker row above the restored note, above a new prompt", iM >= 0 && iNote > iM && iPrompt > iNote, `marker ${iM} < note ${iNote} < prompt ${iPrompt}`);

  await ctx.typeInto(0, `echo ${M2}`);
  const out2 = await waitFor("the echo output", async () => (await rowsOf()).findIndex((l, i) => i > iPrompt && l.trim() === M2) >= 0, 10000, 500).then(() => true, () => false);
  check("b", `the new prompt accepts echo ${M2} and its output shows within 10 s`, out2, `output row seen ${out2}`);
  log(`buffer tail after typing: ${JSON.stringify((await rowsOf()).filter((l) => l.trim()).slice(-6))}`);
  log(`screenshot: ${await ctx.shot("TERM-106s-after-typing")}`);
  let wd2 = "";
  if (out2) {
    await ctx.typeInto(0, "Write-Output ('WD2=' + (Get-Location).Path)");
    const l2 = await waitFor("the new shell's folder", async () => (await rowsOf()).map((l) => l.trim()).find((l) => /^WD2=/.test(l)) ?? null, 10000, 500).catch(() => null);
    wd2 = l2 ? l2.slice(4) : "";
  }
  check("c", "the new shell's cwd equals the old one", !!wd2 && norm(wd2) === norm(wd0), `${wd2 || "(no answer: the pane did not take input)"} vs ${wd0}`);
  // Batch 15: hold the restored pane to 65 s after the relaunch, tracking service pids and kolux.log terminal lines.
  if (tRelaunch) {
    const track = [];
    let lastKey = "";
    while (Date.now() < tRelaunch + 65000) {
      const key = JSON.stringify(mine().map((s) => s.pid));
      if (key !== lastKey) track.push(`+${((Date.now() - tRelaunch) / 1000).toFixed(0)}s services ${key}`);
      lastKey = key;
      await sleep(4000);
    }
    log(`hold: service pid changes after the relaunch: ${track.join(" ; ")}`);
    const rowsHold = await rowsOf();
    const ended = rowsHold.some((l) => /process ended/.test(l));
    log(`hold: 65 s after the relaunch the pane shows an ended line: ${ended}; buffer tail ${JSON.stringify(rowsHold.filter((l) => l.trim()).slice(-4))}`);
    const relEpoch = Math.floor(tRelaunch / 1000);
    const termLines = readFileSync(join(profile, "logs", "kolux.log"), "utf8").split(/\r?\n/).filter((l) => /terminal (service|\d+)|taken back/.test(l));
    for (const l of termLines) {
      const m = l.match(/^(\d{9,})\s/);
      log(`  kolux.log ${m ? `${Number(m[1]) - relEpoch >= 0 ? "+" : ""}${Number(m[1]) - relEpoch}s vs relaunch` : "(no time)"}: ${l.replace(/^\d+\s*/, "").slice(0, 120)}`);
    }
    const exitedAfter = termLines.filter((l) => /terminal \d+ exited/.test(l) && Number((l.match(/^(\d{9,})/) ?? [])[1]) >= relEpoch);
    check("hold", "no 'terminal N exited' line after the relaunch and no ended line at 65 s", !ended && exitedAfter.length === 0, `ended ${ended}; exited lines after relaunch ${exitedAfter.length}`);
    await ctx.typeInto(0, `echo M3-${stamp}`);
    const out3 = await waitFor("the late echo", async () => (await rowsOf()).some((l) => l.trim() === `M3-${stamp}`), 10000, 500).then(() => true, () => false);
    check("hold", "a late echo M3-<stamp> after 65 s still answers", out3, `output row seen ${out3}`);
  }
  if (!out2) {
    // Task 2 diagnostics: what the pane's session maps to, and whether keystrokes reach any pty.
    const show = async (cmd) => log(`diag ${cmd}: ${String(await app.invoke(cmd, {}).then((v) => JSON.stringify(v), (e) => "ERR " + e)).replace(/[A-Za-z]:[\\/][^"]*/g, "<path>").slice(0, 700)}`);
    for (const c of ["terminal_service_info", "terminal_diagnostics", "terminal_host_sessions", "terminal_busy"]) await show(c);
    const svcNow = mine();
    log(`app tree: ${app.byName(await app.treeOf(app.pid))}`);
    const kids = svcNow.length ? ps(`Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -in @(${svcNow.map((s) => s.pid).join(",")}) } | ForEach-Object { "$($_.Name):$($_.ProcessId)" }`).replace(/\r?\n/g, " ") : "(no service)";
    log(`service now: ${JSON.stringify(svcNow.map((s) => s.pid))}; its children: ${kids}`);
    log(`pane attrs: ${await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find(e => e.offsetParent !== null); return p ? JSON.stringify([...p.attributes].map(a => a.name + "=" + a.value.slice(0, 60))) : null; })()`)}`);
    await ctx.typeInto(0, `Write-Output 'PROBE-${stamp}'`);
    await sleep(3000);
    log(`probe typed; rows tail: ${JSON.stringify((await rowsOf()).filter((l) => l.trim()).slice(-4))}`);
  }
  logCounts(profile, "end");
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
// Cleanup: services tied to this root (the final close leaves them running by design).
try {
  const left = mine();
  for (const s of left) ps(`Stop-Process -Id ${s.pid} -Force`);
  log(`cleanup: ended ${left.length} terminal service(s) tied to this root: ${JSON.stringify(left.map((s) => s.pid))}`);
} catch (e) {
  log(`cleanup error ${e.message}`);
}
process.exit(ctx ? await finish(ctx, "TERM-106-service", ev, ok) : 1);
