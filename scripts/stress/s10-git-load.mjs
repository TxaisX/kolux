// S10 Git under load: a ~50k-file repo (branch 200 commits ahead, ~2k modified, ~500 untracked) is opened as a project with one
// shell pane. For 60 s a key goes into the pane every 50 ms (an echo program answers each byte with a numbered token) while the
// app's own git paths run: the changes view opens, a refresh + file-watcher change, direct status/summary/base-changes calls,
// a diff of a big file and the All Changes tab. Bars: echo p95 < 100 ms, page timer gap worst < 250 ms, 0 page errors, clean quit.
// Status-settle times are measurements, not bars. The repo lives under G:/Temp/stress-s10/ (S10_REPO overrides), never in a checkout.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TERM, addProjectAndOpen, fmt, installProbe, pageErrors, paneText, seedProfile, slash, stats, typeInto, openDiffFromCli } from "./lib.mjs";
import { BIG, buildRepo } from "./s10-repo.mjs";

export const title = "Git under load (50k files, 200 commits ahead)";
export const seed = seedProfile;
const ECHO_P95_MS = 100;
const GAP_MS = 250;
const RUN_MS = 60000;
const KEY_GAP_MS = 50;
const REPO = process.env.S10_REPO || "G:/Temp/stress-s10/repo";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
const SLOT = process.env.KOLUX_SLOTS ? join(process.env.KOLUX_SLOTS, "slot.mjs") : join(ROOT, "..", "kolux-rs-slots", "slot.mjs");
const DIAG = process.env.S10_DIAG === "1";
const DIAG_LOG = "G:/Temp/stress-logs/s10-diag.log";

// S10_DIAG=1: long tasks, long animation frames (script attribution) and the full console.error arguments, with wall-clock starts.
const DIAG_JS = `(() => {
  if (window.__diag) return "already";
  const D = (window.__diag = { tasks: [], loaf: [], errs: [] });
  const wall = (t) => Math.round(performance.timeOrigin + t);
  const watch = (type, sink, pick) => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (sink.length < 3000) sink.push(pick(e)); }).observe({ type, buffered: true }); } catch (e) { D[type + "Err"] = String(e).slice(0, 100); } };
  watch("longtask", D.tasks, (e) => ({ w: wall(e.startTime), d: Math.round(e.duration), a: (e.attribution || []).map((x) => x.name + ":" + x.containerType).join(",") }));
  watch("long-animation-frame", D.loaf, (e) => ({ w: wall(e.startTime), d: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: (e.scripts || []).slice(0, 4).map((s) => ({ d: Math.round(s.duration), inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: String(s.sourceURL || "").slice(-80), ch: s.sourceCharPosition })) }));
  const ce = console.error.bind(console);
  console.error = (...a) => { if (D.errs.length < 20) D.errs.push({ w: Date.now(), args: a.map((x) => (x && x.stack) || String(x)).map((x) => x.slice(0, 1500)) }); ce(...a); };
  return "diag installed";
})()`;
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);
const slotStatus = () => {
  try {
    return execFileSync(process.execPath, [SLOT, "status"], { encoding: "utf8", timeout: 15000, windowsHide: true }).trim().split(/\r?\n/).join(" | ");
  } catch (e) {
    return `slot status failed: ${e.message.slice(0, 80)}`;
  }
};

const ECHO_JS = `// answers every byte it reads with a numbered token on its own line
let n = 0;
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (d) => { for (const b of d) { if (b === 3) process.exit(0); process.stdout.write("[E" + ++n + "]\\r\\n"); } });
process.stdout.write("ECHO-READY\\r\\n");
`;

// One install per page load: a 50 ms timer monitor, the steady typer, and named waits on the git views.
const PAGE_JS = `(() => {
  if (window.__s10) return "already";
  const TERM = ${JSON.stringify(TERM)};
  const S = (window.__s10 = { n: 0, seen: 0, byN: {}, run: null, t0: {}, marks: {}, gaps: [], maxGap: 0, ticks: 0 });
  let last = performance.now();
  setInterval(() => {
    const t = performance.now(), g = t - last; last = t; S.ticks++;
    if (g > S.maxGap) S.maxGap = g;
    if (g >= 100 && S.gaps.length < 2000) S.gaps.push([Date.now(), Math.round(g)]);
  }, 50);
  const num = (sel) => { const e = document.querySelector(sel); return e ? Number(e.textContent.replace(/[^0-9]/g, "")) : -1; };
  const P = {
    scmPanel: () => num('.scm-sec-wrap[data-section="Changes"] .scm-sec .count') >= 1000 && num('.scm-sec-wrap[data-section="Untracked"] .scm-sec .count') === 500,
    summary: () => !!document.querySelector("[data-summary] .scm-sum-row"),
    untracked540: () => num('.scm-sec-wrap[data-section="Untracked"] .scm-sec .count') === 540,
    diffState: () => !![...document.querySelectorAll(".notice.md-banner")].find((e) => /large/i.test(e.textContent)) || !!document.querySelector(".diff-body .cm-line"),
    acRows: () => !!document.querySelector(".all-changes .ac-row, .all-changes .ac-list > :not(.menu-hint)"),
  };
  S.start = (name) => { S.t0[name] = { p: performance.now(), w: Date.now() }; delete S.marks[name]; return "ok"; };
  S.watch = (name) => {
    const hit = () => { if (S.marks[name]) return true; if (!P[name]()) return false; S.marks[name] = { p: performance.now(), w: Date.now() }; return true; };
    if (hit()) return "already true";
    const obs = new MutationObserver(() => { if (hit()) obs.disconnect(); });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    return "watching";
  };
  S.read = (name) => (S.marks[name] && S.t0[name] ? Math.round(S.marks[name].p - S.t0[name].p) : null);
  S.counts = () => ({ changes: num('.scm-sec-wrap[data-section="Changes"] .scm-sec .count'), untracked: num('.scm-sec-wrap[data-section="Untracked"] .scm-sec .count'), acRows: document.querySelectorAll(".all-changes .ac-row").length, acBlocks: document.querySelectorAll(".all-changes .ac-list > :not(.menu-hint)").length, acHint: (document.querySelector(".all-changes .ac-list .menu-hint")?.textContent || "").slice(0, 40), sumRows: document.querySelectorAll("[data-summary] .scm-sum-row").length });
  S.startRun = () => { S.gaps = []; S.maxGap = 0; return "ok"; };
  S.typer = (idx, ms, gapMs) => {
    const pane = [...document.querySelectorAll(TERM)].filter((e) => e.offsetParent !== null)[idx];
    if (!pane) return "no pane";
    const ta = pane.querySelector(".xterm-helper-textarea"), rows = pane.querySelector(".xterm-rows");
    const run = (S.run = { keys: [], w0: Date.now(), done: false, hiddenSends: 0 });
    const obs = new MutationObserver(() => {
      const now = performance.now(), re = /\\[E(\\d+)\\]/g, text = rows.textContent;
      let m;
      while ((m = re.exec(text))) {
        const k = +m[1];
        if (k > S.seen) { for (let j = S.seen + 1; j <= k; j++) { const e = S.byN[j]; if (e && e.r === undefined) e.r = now; } S.seen = k; }
      }
    });
    obs.observe(rows, { subtree: true, childList: true, characterData: true });
    const end = performance.now() + ms;
    const tick = () => {
      if (performance.now() >= end) { setTimeout(() => { obs.disconnect(); run.w1 = Date.now(); run.done = true; }, 3000); return; }
      const n = ++S.n, e = { n, w: Date.now(), t: performance.now() };
      if (pane.offsetParent === null) run.hiddenSends++;
      S.byN[n] = e; run.keys.push(e);
      ta.value = "x";
      ta.dispatchEvent(new InputEvent("input", { data: "x", inputType: "insertText", bubbles: true }));
      setTimeout(tick, gapMs);
    };
    tick();
    return "typing";
  };
  S.status = () => (S.run ? { done: S.run.done, keys: S.run.keys.length } : null);
  S.result = () => ({ w: S.run.keys.map((e) => e.w), lat: S.run.keys.map((e) => (e.r === undefined ? -1 : Math.round(e.r - e.t))), hiddenSends: S.run.hiddenSends, w0: S.run.w0, w1: S.run.w1, gaps: S.gaps, maxGap: Math.round(S.maxGap), ticks: S.ticks });
  return "installed";
})()`;

export async function run({ launch, checks }) {
  if (!existsSync(join(REPO, ".git", "s10-facts.json"))) {
    const f = await buildRepo(REPO, (m) => console.log("  repo:", m));
    checks.note(`repo built: ${JSON.stringify(f)}`);
  }
  const facts = JSON.parse(readFileSync(join(REPO, ".git", "s10-facts.json"), "utf8"));
  checks.note(`repo facts: ${JSON.stringify(facts)}`);
  const slotStart = slotStatus();
  checks.note(`slot status at the start: ${slotStart}`);

  const app = await launch("s10");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "echo.js"), ECHO_JS);
  await installProbe(app);
  if (DIAG) await app.evalJs(DIAG_JS);
  const tAdd = Date.now();
  await addProjectAndOpen(app, REPO.replace(/\//g, "\\"));
  const addMs = Date.now() - tAdd;
  checks.note(`project add to first shell pane ready: ${(addMs / 1000).toFixed(1)} s`);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await app.waitFor("2 shell panes", async () => (await app.shown(TERM)) === 2, 30000);
  await app.waitFor("pane 2's input field", async () => unwrap(await app.evalJs(`!![...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[1]?.querySelector(".xterm-helper-textarea")`)), 30000);
  await app.sleep(8000); // the shells reach their prompts; the sidebar's own git scans finish
  await app.evalJs(PAGE_JS);
  await typeInto(app, 0, `node '${slash(join(files, "echo.js"))}'`);
  await app.waitFor("the echo program", async () => (await paneText(app, 0))?.includes("ECHO-READY"), 30000, 500);

  // Idle comparison: 10 s of the same typing with the changes view closed and nothing triggered.
  await app.evalJs(`window.__s10.startRun()`);
  await app.evalJs(`window.__s10.typer(0, 10000, ${KEY_GAP_MS})`);
  await app.waitFor("the idle typing run", async () => unwrap(await app.evalJs(`window.__s10.status()`))?.done === true, 40000, 500);
  const idleRes = unwrap(await app.evalJs(`window.__s10.result()`));
  const idleLat = idleRes.lat.filter((v) => v >= 0);
  const idleStats = stats(idleLat);
  checks.note(`idle typing in this repo (10 s, ${idleRes.lat.length} keys): echo p50 ${fmt(idleStats.p50)} / p95 ${fmt(idleStats.p95)} / max ${fmt(idleStats.max)} ms; page timer gap worst ${idleRes.maxGap} ms; ${idleRes.lat.length - idleLat.length} lost`);

  // ---- the scored run ----
  await app.evalJs(`window.__s10.startRun()`);
  const T0 = Date.now();
  const rel = () => Date.now() - T0;
  const wait = (ms) => app.sleep(Math.max(0, ms - rel()));
  const events = []; // { name, at, ms?, ... } (at = ms after the typing began)
  const note = (name, extra = {}) => events.push({ name, at: rel(), ...extra });
  console.log("  typing started:", await app.evalJs(`window.__s10.typer(0, ${RUN_MS}, ${KEY_GAP_MS})`));
  const slotMid = slotStatus();
  const step = async (name, fn) => {
    const t = rel();
    try {
      const r = await fn();
      note(name, { took: rel() - t, ...(r && typeof r === "object" ? r : {}) });
    } catch (e) {
      note(name, { took: rel() - t, error: e.message.slice(0, 160) });
    }
  };
  const poll = async (fn, limitMs, everyMs = 150) => {
    const t = Date.now();
    for (;;) {
      let v = null;
      try {
        v = unwrap(await fn());
      } catch {
        /* a busy page may time out one poll */
      }
      if (v) return v;
      if (Date.now() - t > limitMs) return null;
      await app.sleep(everyMs);
    }
  };

  await wait(5000);
  // B: open the changes view (Source Control in the right sidebar) and time how long until its lists and branch summary are there.
  await step("B open Source Control", async () => {
    await app.evalJs(`(() => { const S = window.__s10; S.start("scmPanel"); S.start("summary"); S.watch("scmPanel"); S.watch("summary"); if (!document.querySelector('aside.rside [role="tab"]')) document.querySelector("button.ib.panel")?.click(); return "ok"; })()`);
    await poll(() => app.evalJs(`!!document.querySelector('aside.rside [role="tab"]')`), 10000, 100);
    await app.clickWhere('aside.rside [role="tab"]', "/^\\s*Source Control\\s*$/");
    const hit = await poll(() => app.evalJs(`window.__s10.read("scmPanel")`), 60000);
    const sum = await poll(() => app.evalJs(`window.__s10.read("summary")`), 30000);
    await app.sleep(3000);
    const c = unwrap(await app.evalJs(`window.__s10.counts()`));
    return { listsSettledMs: hit, summaryMs: sum, countsAfter3s: JSON.stringify(c) };
  });
  await wait(15000);
  // C: refresh (focus), a burst of file changes the watcher has to notice, and the back-end calls timed directly.
  await step("C refresh + watcher + direct calls", async () => {
    await app.evalJs(`(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); return "ok"; })()`);
    await app.evalJs(`(() => { const S = window.__s10; S.start("untracked540"); S.watch("untracked540"); return "ok"; })()`);
    const w = Date.now();
    for (let k = 0; k < 40; k++) writeFileSync(join(REPO, `d${k % 25}`, `s10-watch-${k}.txt`), `watch ${k}\n`);
    const direct = unwrap(
      await app.evalJs(`(async () => {
        const out = {}, wt = ${JSON.stringify(REPO.replace(/\//g, "\\"))};
        const calls = [["status1", "scm_status", { worktree: wt }], ["status2", "scm_status", { worktree: wt }], ["summary", "scm_summary", { worktree: wt, pinned: null, upstream: false }], ["baseChanges", "scm_base_changes", { worktree: wt, pinned: null, known: null }], ["history", "scm_history", { worktree: wt }]];
        for (const [k, c, p] of calls) { const t = performance.now(); try { await window.__TAURI_INTERNALS__.invoke(c, p); } catch (e) { out[k + "Err"] = String(e).slice(0, 90); } out[k] = Math.round(performance.now() - t); }
        return out;
      })()`),
    );
    const seen = await poll(() => app.evalJs(`window.__s10.marks.untracked540 ? window.__s10.marks.untracked540.w : null`), 30000);
    return { watcherToPanelMs: seen ? seen - w : null, direct: JSON.stringify(direct) };
  });
  await wait(30000);
  // D: a diff of the big file, opened beside the second shell so the typing target stays on screen.
  let diffKind = null;
  await step("D diff of the big file", async () => {
    await app.focusPane(TERM, 1, ".xterm-helper-textarea");
    await app.evalJs(`(() => { const S = window.__s10; S.start("diffState"); S.watch("diffState"); return "ok"; })()`);
    await openDiffFromCli(app, REPO, BIG);
    const ms = await poll(() => app.evalJs(`window.__s10.read("diffState")`), 90000);
    diffKind = unwrap(await app.evalJs(`(() => { const ask = [...document.querySelectorAll(".notice.md-banner")].find((e) => /large/i.test(e.textContent)); return ask ? "asked" : document.querySelector(".diff-body .cm-line") ? "drawn" : "nothing"; })()`));
    const shellShown = unwrap(await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null).length`));
    return { diffMs: ms, diffKind, shellPanesShown: shellShown };
  });
  await wait(40000);
  await step("D close diff tab", async () => {
    await app.evalJs(`(() => { document.querySelector('section.pane.editor.diff:not([hidden]) button[title^="Close tab"], section.pane.editor.diff button[title^="Close tab"]')?.click(); return "x"; })()`);
    await app.sleep(600);
    await app.evalJs(`(() => { const d = document.querySelector('[role="alertdialog"] .btn-row'); if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click(); return "x"; })()`);
  });
  await wait(45000);
  // E: All Changes, every changed file's diff in one tab.
  await step("E All Changes", async () => {
    await app.focusPane(TERM, 1, ".xterm-helper-textarea");
    await app.evalJs(`(() => { const S = window.__s10; S.start("acRows"); S.watch("acRows"); return "ok"; })()`);
    await app.click('button[aria-label="All changes"]');
    const ms = await poll(() => app.evalJs(`window.__s10.read("acRows")`), 60000);
    await app.sleep(2000);
    const c = unwrap(await app.evalJs(`window.__s10.counts()`));
    return { firstRowMs: ms, treeRowsAfter2s: c.acRows, diffBlocksAfter2s: c.acBlocks, hint: c.acHint };
  });
  await wait(55000);
  await step("E close All Changes", async () => {
    await app.evalJs(`(() => { document.querySelector('section.pane.all-changes button[title^="Close tab"]')?.click(); return "x"; })()`);
    await app.sleep(600);
    await app.evalJs(`(() => { const d = document.querySelector('[role="alertdialog"] .btn-row'); if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click(); return "x"; })()`);
  });
  await wait(RUN_MS + 500);
  await app.waitFor("the typing run to finish", async () => unwrap(await app.evalJs(`window.__s10.status()`))?.done === true, 120000, 500);
  const res = unwrap(await app.evalJs(`window.__s10.result()`));
  const slotEnd = slotStatus();
  checks.note(`slot status mid-run: ${slotMid}`);
  checks.note(`slot status at the end: ${slotEnd}`);

  // ---- judge ----
  const lat = res.lat.filter((v) => v >= 0);
  const lost = res.lat.length - lat.length;
  const st = stats(lat);
  const sorted = [...lat].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)];
  checks.add(`echo latency, ${res.lat.length} keys (one per ${KEY_GAP_MS} ms for ${RUN_MS / 1000} s) while the app's git views run (in-page key to token on screen)`, `p95 < ${ECHO_P95_MS} ms`, `p50 ${fmt(st.p50)} ms, p95 ${fmt(st.p95)} ms, p99 ${fmt(p99)} ms, max ${fmt(st.max)} ms (idle in the same repo: p95 ${fmt(idleStats.p95)} ms)`, st.n > 0 && st.p95 < ECHO_P95_MS);
  checks.add("every typed key is echoed on screen", "0 lost", `${lost} of ${res.lat.length} lost; ${res.hiddenSends} sent while the pane was not on screen`, lost === 0 && res.hiddenSends === 0);
  const inRun = res.gaps.filter(([w]) => w >= T0);
  const worst = inRun.reduce((a, [, g]) => Math.max(a, g), 0);
  const over = inRun.filter(([, g]) => g >= GAP_MS);
  const gapLine = (o) => `t=${((o[0] - T0) / 1000).toFixed(1)}s ${o[1]}ms`;
  checks.add("page timer gap (50 ms timer) during the 60 s", `worst < ${GAP_MS} ms`, `worst ${worst} ms (max over the page's life ${res.maxGap}); gaps >= 100 ms: ${inRun.length}; >= ${GAP_MS} ms: ${over.length}${over.length ? ` [${over.slice(0, 8).map(gapLine).join(", ")}]` : ""}`, worst < GAP_MS);
  const errs = await pageErrors(app).catch((e) => [`page unreachable: ${e.message.slice(0, 80)}`]);
  checks.add("page errors during the run", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);

  // Where the slow echoes fell: per 5 s bucket p95/max, with the trigger events.
  const buckets = [];
  for (let b = 0; b < RUN_MS / 5000; b++) {
    const vals = res.w.map((w, i) => [w - T0, res.lat[i]]).filter(([t, l]) => t >= b * 5000 && t < (b + 1) * 5000 && l >= 0).map(([, l]) => l);
    const s = stats(vals);
    buckets.push(`${b * 5}-${b * 5 + 5}s p95 ${fmt(s.p95)} max ${fmt(s.max)}`);
  }
  checks.note(`echo per 5 s window (ms): ${buckets.join("; ")}`);
  for (const e of events) checks.note(`event t=${(e.at / 1000).toFixed(1)}s ${e.name}: ${Object.entries(e).filter(([k]) => k !== "name" && k !== "at").map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const e of events.filter((x) => x.took)) {
    const [a, b] = [e.at - e.took, e.at];
    const ls = res.w.map((w, i) => [w - T0, res.lat[i]]).filter(([t, l]) => t >= a && t <= b + 1000 && l >= 0).map(([, l]) => l);
    const gs = res.gaps.filter(([w]) => w - T0 >= a && w - T0 <= b + 1000).map(([, g]) => g);
    checks.note(`window of "${e.name}" (t=${(a / 1000).toFixed(1)}-${(b / 1000).toFixed(1)}s +1 s): ${ls.length} keys, echo p95 ${fmt(stats(ls).p95)} max ${fmt(stats(ls).max)} ms; worst page timer gap ${gs.length ? Math.max(...gs) : "<100"} ms`);
  }
  const slowest = res.w.map((w, i) => [w - T0, res.lat[i]]).filter(([, l]) => l >= 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, l]) => `t=${(t / 1000).toFixed(1)}s ${l}ms`);
  checks.note(`slowest six echoes: ${slowest.join(", ")}`);
  if (DIAG) {
    const d = unwrap(await app.evalJs(`JSON.stringify(window.__diag)`));
    const D = JSON.parse(d);
    const evs = events.map((e) => `[${((e.at - (e.took || 0)) / 1000).toFixed(1)}-${(e.at / 1000).toFixed(1)}s] ${e.name}`);
    const rt = (w) => `t=${((w - T0) / 1000).toFixed(2)}s`;
    const where = (w) => (events.filter((e) => w - T0 >= e.at - (e.took || 0) - 500 && w - T0 <= e.at + 1500).map((e) => e.name).join(" + ") || "no step");
    const L = [`events: ${evs.join("; ")}`, `longtask count ${D.tasks.length}; loaf count ${D.loaf.length}; errs ${D.errs.length}; ${D.longtaskErr || ""} ${D["long-animation-frame" + "Err"] || ""}`];
    for (const e of D.tasks.filter((x) => x.w >= T0).sort((a, b) => b.d - a.d).slice(0, 10)) L.push(`LONGTASK ${rt(e.w)} ${e.d}ms attr=${e.a} view=${where(e.w)}`);
    for (const e of D.loaf.filter((x) => x.w >= T0).sort((a, b) => b.d - a.d).slice(0, 10)) L.push(`LOAF ${rt(e.w)} ${e.d}ms block=${e.block} render=${e.render} style=${e.style} view=${where(e.w)} scripts=${JSON.stringify(e.scripts)}`);
    for (const e of D.errs) L.push(`CONSOLE.ERROR ${rt(e.w)} view=${where(e.w)} args=${JSON.stringify(e.args)}`);
    mkdirSync("G:/Temp/stress-logs", { recursive: true });
    writeFileSync(DIAG_LOG, L.join(String.fromCharCode(10)) + String.fromCharCode(10));
  }
  // Leave the repo as built: the watcher files go.
  for (let k = 0; k < 40; k++) rmSync(join(REPO, `d${k % 25}`, `s10-watch-${k}.txt`), { force: true });
}
