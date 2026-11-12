// retired: it watches git traces while the Source Control panel sits open; that panel was removed by T-644, and the GIT-001/004 fixtures it also runs are retired
// LIVE proof, GIT-007 box 2 (spec/11): an unpublished branch left open for ten minutes -> git traces show no repeating remote checks.
// One launch: GIT_TRACE2 points at a folder, so every git process the app (and its shells) starts leaves a trace file. While the ten
// minutes run, the same launch also proves GIT-001 boxes 2+3 and GIT-004 boxes 2+3 (their own scripts' run functions), then the app
// sits idle with the branch still unpublished. PROVE_FAST=1 skips the waiting (development only; not evidence).
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, addUnpublishedBranch, ensurePanel, scmReading, readTrace, isRemoteCall, git, LIVE_BASE } from "./live-git-common.mjs";
import { git001Fixture, run001 } from "./live-GIT-001.mjs";
import { git004Fixture, run004 } from "./live-GIT-004.mjs";

const MIN = 60_000;
const WINDOW = process.env.PROVE_FAST ? 20_000 : 10 * MIN;
const fmt = (e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.name || "?"} :: ${e.start.replace(/\s+/g, " ").slice(0, 110)}`;

const rep = reporter();
const { log, lines: ev } = rep;
const chk = checker(log);
const { check } = chk;
let ctx;
let ok = false;
try {
  const f1 = git001Fixture();
  const f4 = git004Fixture();
  const trace = `${LIVE_BASE}/trace-GIT-007`;
  ctx = await startPlain("GIT-007", {
    report: rep,
    trace,
    files: { ...f1.files, ...f4.files },
    dirty: { ...f1.dirty, ...f4.dirty },
    prepare: (repo) => addUnpublishedBranch(repo, `${LIVE_BASE}/work/GIT-007-origin.git`),
  });
  const { app, repo } = ctx;
  await sleep(3000);
  await ensurePanel(app);
  const t0 = Date.now();
  const up = await git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then(() => "has upstream", (e) => `no upstream (${String(e.stderr || e.message).split("\n")[0].slice(0, 80)})`);
  const reading = await poll(async () => { const r = await scmReading(app); return r?.branch ? r : null; }, 15000, 500);
  log(`t0 ${new Date(t0).toISOString()}: branch ${reading?.branch}; ${up}; remotes: ${(await git(repo, ["remote", "-v"])).trim().split("\n")[0]}`);
  check("setup: the open branch is feature and it has no upstream", reading?.branch === "feature" && up.startsWith("no upstream"), `${reading?.branch}; ${up}`);

  // The other boxes, driven while the ten minutes run.
  for (const [name, fn] of [["GIT-001", run001], ["GIT-004", run004]]) {
    log(`--- ${name} (driven inside the observation window, +${Math.round((Date.now() - t0) / 1000)} s) ---`);
    try {
      await fn(ctx, { check, log });
    } catch (e) {
      check(`${name} ran to the end`, false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
    }
  }
  const drivenEnd = Date.now();
  log(`driving finished at +${Math.round((drivenEnd - t0) / 1000)} s; the branch is still unpublished: ${await git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then(() => "NO (has upstream)", () => "yes")}`);
  await app.evalJs(`document.querySelector("button.branch").click()`);
  await ensurePanel(app);
  // Idle until the branch has been open for ten minutes, ticking once a minute.
  while (Date.now() < t0 + WINDOW) {
    await sleep(Math.min(60_000, t0 + WINDOW - Date.now()));
    const all = readTrace(trace);
    log(`  +${Math.round((Date.now() - t0) / 1000)} s: ${all.length} git processes traced, ${all.filter(isRemoteCall).length} remote-contacting`);
  }
  const tEnd = Date.now();
  const all = readTrace(trace);
  const remote = all.filter(isRemoteCall);
  const byName = {};
  for (const e of all) byName[e.name || "?"] = (byName[e.name || "?"] ?? 0) + 1;
  log(`git processes traced over ${Math.round((tEnd - t0) / 1000)} s: ${all.length}; by command: ${JSON.stringify(byName)}`);
  log(`remote-contacting commands in the window: ${remote.length}`);
  for (const e of remote) log(`  remote: +${Math.round((e.t - t0) / 1000)} s ${fmt(e)}`);
  const idleFrom = Math.max(drivenEnd, t0 + WINDOW / 2);
  const idleCalls = all.filter((e) => e.t >= idleFrom);
  const idleRemote = idleCalls.filter(isRemoteCall);
  log(`idle part (from +${Math.round((idleFrom - t0) / 1000)} s to +${Math.round((tEnd - t0) / 1000)} s): ${idleCalls.length} git processes, ${idleRemote.length} remote-contacting`);
  for (const e of idleCalls.slice(0, 12)) log(`  idle git: +${Math.round((e.t - t0) / 1000)} s ${fmt(e)}`);
  const repeats = {};
  for (const e of remote) repeats[`${e.name}|${e.start}`] = (repeats[`${e.name}|${e.start}`] ?? 0) + 1;
  const repeated = Object.entries(repeats).filter(([, n]) => n > 1);
  check("the trace recorded the app's git work (the capture works)", all.length > 10, `${all.length} processes`);
  check("no remote check repeats in the ten minutes (no command with the same arguments twice)", repeated.length === 0, JSON.stringify(repeated));
  check("nothing talks to the remote in the idle part of the window", idleRemote.length === 0, `${idleRemote.length} remote-contacting of ${idleCalls.length}`);

  // Positive control: a real remote action from the Remote menu leaves a remote-contacting trace, so the filter above would have seen one.
  const nBefore = readTrace(trace).filter(isRemoteCall).length;
  await app.evalJs(`document.querySelector('.sidebar.scm button[title="Remote actions"]').click()`);
  await sleep(1200);
  const items = await app.evalJs(`[...document.querySelectorAll('[role=menu][aria-label="Remote actions"] [role=menuitem], [role=menu][aria-label="Remote actions"] .menu-item')].map(i=>i.textContent.trim().replace(/\\s+/g," ")+(i.disabled?" [disabled]":""))`);
  log(`Remote actions menu on the unpublished branch: ${JSON.stringify(items)}`);
  const fetched = await app.evalJs(`(()=>{const i=[...document.querySelectorAll('[role=menu][aria-label="Remote actions"] .menu-item')].find(i=>/^Fetch/.test(i.textContent.trim())&&!i.disabled); if(!i) return false; i.click(); return true;})()`);
  await sleep(4000);
  const after = readTrace(trace).filter(isRemoteCall);
  log(`control: Fetch clicked=${fetched}; remote-contacting traces ${nBefore} -> ${after.length}${after.length > nBefore ? `; new: ${fmt(after[after.length - 1])}` : ""}`);
  check("control: choosing Fetch from the Remote menu does leave a remote-contacting trace (so the quiet window means something)", fetched && after.length > nBefore, `Fetch clicked=${fetched}; ${nBefore} -> ${after.length}`);
  log(`screenshot: ${await ctx.shot("GIT-007-end")}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "GIT-007", ev, ok) : 1);
