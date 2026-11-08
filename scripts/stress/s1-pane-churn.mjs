// S1 pane churn: open 40 terminals and close them all, 5 rounds. Bars: no pane host process left behind, the app's memory
// after round 5 within 15% of its memory after round 1, no page error.
import { join } from "node:path";
import { NEW_TERMINAL_JS, PANE_PROCS, TERM, addProjectAndOpen, appMemMB, fmt, gitInit, installProbe, pageErrors, paneProcs, seedProfile, snapshot, stats } from "./lib.mjs";

export const title = "Pane churn (40 panes x 5 rounds)";
export const seed = seedProfile;
const ROUNDS = 5;
const PANES = 40;

// In the page: open terminals with the window's New terminal tab key (Mod+T) until `target` exist; returns the ms each open took.
const openScript = (target) => `(async () => {
  ${NEW_TERMINAL_JS}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = () => document.querySelectorAll(${JSON.stringify(TERM)}).length;
  const times = [];
  const t00 = performance.now();
  while (count() < ${target}) {
    if (performance.now() - t00 > 240000) return { error: "opening stalled at " + count(), times };
    const before = count(), t0 = performance.now();
    await newTerminal(sleep);
    for (let i = 0; i < 500 && count() === before; i++) await sleep(20);
    if (count() === before) return { error: "the New terminal tab key added no pane at " + before + " (toast: " + (document.querySelector(".toast")?.textContent ?? "none") + ")", times };
    times.push(Math.round(performance.now() - t0));
  }
  return { count: count(), times };
})()`;

// In the page: close panes by their own close button until none are left (an ask dialog is answered with its confirm button).
const closeScript = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const panes = () => [...document.querySelectorAll(${JSON.stringify(TERM)})];
  const times = [];
  const t00 = performance.now();
  while (panes().length > 0) {
    if (performance.now() - t00 > 240000) return { error: "closing stalled at " + panes().length, times };
    const before = panes().length, t0 = performance.now();
    const b = panes()[0].querySelector('button[title^="Close pane"]');
    if (!b) return { error: "no close button on pane 1 of " + before, times };
    b.click();
    for (let i = 0; i < 150 && panes().length === before; i++) {
      await sleep(20);
      const d = document.querySelector('[role="alertdialog"] .btn-row');
      if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click();
    }
    if (panes().length === before) return { error: "closing did not remove a pane at " + before, times };
    times.push(Math.round(performance.now() - t0));
  }
  return { count: 0, times };
})()`;

export async function run({ launch, checks }) {
  const app = await launch("s1");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s1");
  await installProbe(app);
  await addProjectAndOpen(app, repo);
  const start = Date.now();
  const seen = new Map(); // pid|created -> name of every pane host process the app's tree ever held
  const rounds = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const opened = await app.evalJs(openScript(PANES));
    if (!Array.isArray(opened?.times)) throw new Error("the open script gave no timings: " + JSON.stringify(opened).slice(0, 300));
    const peakSnap = await snapshot(app);
    for (const p of paneProcs(peakSnap)) seen.set(`${p.pid}|${p.created}`, p);
    const opens = stats(opened.times);
    const closed = await app.evalJs(closeScript);
    // The shells get a moment to leave: a process still in the tree afterwards is a leak, not a slow exit.
    await app.sleep(5000);
    const after = await snapshot(app);
    const left = paneProcs(after);
    // Working set swings with the web view's garbage collection: the floor of three readings 4 s apart is the round's memory.
    const mems = [appMemMB(after)];
    for (let i = 0; i < 2; i++) {
      await app.sleep(4000);
      mems.push(appMemMB(await snapshot(app)));
    }
    rounds.push({ r, panes: opened.count ?? 0, openErr: opened.error, closeErr: closed.error, openP95: opens.p95, openMax: opens.max, peakProcs: paneProcs(peakSnap).length, procsLeft: left.length, leftNames: left.map((p) => p.name).join("+"), memMB: Math.min(...mems), memReadings: mems.map((m) => Math.round(m)).join("/"), peakMB: appMemMB(peakSnap), closeMax: stats(closed.times).max });
    console.log(`  round ${r}: ${JSON.stringify(rounds[r - 1])}`);
    if (opened.error || closed.error) {
      // A stall: is the page still answering, and what does it show?
      const t1 = Date.now();
      const probe = await Promise.race([
        app.evalJs(`({ panes: document.querySelectorAll(${JSON.stringify(TERM)}).length, menuOpen: !!document.querySelector('[role="menu"]'), dialog: (document.querySelector('[role="alertdialog"]')?.textContent ?? "").slice(0, 120), notice: [...document.querySelectorAll('.notice, .toast, [role="alert"], [role="status"]')].map((e) => e.textContent.trim().slice(0, 100)).filter(Boolean) })`).catch((e) => `ERR ${e.message.slice(0, 100)}`),
        app.sleep(15000).then(() => "NO ANSWER in 15 s"),
      ]);
      const procs = (await snapshot(app)).filter((p) => /kolux-rs|msedgewebview2/.test(p.name)).map((p) => `${p.name}#${p.pid} threads ${p.threads}`).join(", ");
      checks.note(`stall in round ${r}: page probe after ${((Date.now() - t1) / 1000).toFixed(1)} s = ${JSON.stringify(probe)}; ${procs}`);
      break;
    }
  }
  checks.add(`every round opened ${PANES} panes and closed them all`, `${ROUNDS} rounds, no stall`, rounds.map((x) => `r${x.r}: ${x.panes} open${x.openErr ? ` ERROR ${x.openErr}` : ""}${x.closeErr ? ` CLOSE ERROR ${x.closeErr}` : ""}`).join("; "), rounds.length === ROUNDS && rounds.every((x) => x.panes === PANES && !x.openErr && !x.closeErr));
  const last = rounds[rounds.length - 1];
  checks.add("pane host processes still in the app's tree after the final close", "0", `${last.procsLeft} (${paneProcs(await snapshot(app)).map((p) => p.name).join(", ") || "none"}); per round [${rounds.map((x) => x.procsLeft + (x.leftNames ? ":" + x.leftNames : "")).join(" ")}]`, last.procsLeft === 0);
  // Anything the tree ever held that is still alive but no longer under the app is an orphan.
  const aliveNow = await app.survivorsOf([...seen.values()]);
  const inTree = new Set((await snapshot(app)).map((p) => p.pid));
  const orphans = aliveNow.filter((p) => !inTree.has(p.pid));
  checks.add("orphan shell / console host processes (seen under the app, alive, no longer its children)", "0", `${orphans.length}${orphans.length ? ` (${app.byName(orphans)})` : ""} of ${seen.size} ever seen`, orphans.length === 0);
  await app.killAll(orphans); // cleanup, not the check
  const base = rounds[0].memMB;
  const final = last.memMB;
  checks.add("app memory after round 5 vs after round 1 (app + web view working set, MB; floor of 3 readings per round)", "within +15% of round 1", `${fmt(base)} -> ${fmt(final)} MB (${fmt(((final - base) / base) * 100, 1)}%); per round [${rounds.map((x) => fmt(x.memMB)).join(" ")}]; peak per round [${rounds.map((x) => fmt(x.peakMB)).join(" ")}]`, final <= base * 1.15);
  const errs = await pageErrors(app);
  checks.add("page errors (window error, unhandled rejection, console.error) during the run", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);
  checks.note(`open time per pane p95 by round [${rounds.map((x) => fmt(x.openP95)).join(" ")}] ms, max [${rounds.map((x) => fmt(x.openMax)).join(" ")}] ms; close max [${rounds.map((x) => fmt(x.closeMax)).join(" ")}] ms; ${((Date.now() - start) / 1000).toFixed(0)} s total; pane host process names counted: ${[...PANE_PROCS].join(", ")}`);
}
