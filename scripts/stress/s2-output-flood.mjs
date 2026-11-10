// S2 output flood: 8 panes each print ~50 MB at once while a 9th pane echoes typed keys. Bars: the 9th pane's echo
// p95 <= 250 ms during the flood, memory bounded, the final line of every pane shows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TERM, addProjectAndOpen, appMemMB, fmt, memByRole, gitInit, installProbe, pageErrors, paneText, perfSession, seedProfile, slash, snapshot, stats, typeInto } from "./lib.mjs";

// S2_GPU=1: the panes draw on WebGL, as a user's do with the GPU setting on automatic. The screen is a canvas
// then, so the echo is timed from the token reaching the page (the output bus probe) plus two frames, and the
// final lines are not read back from the screen (the done files still prove every byte was accepted).
const GPU = process.env.S2_GPU === "1";
export const title = `Output flood (8 panes x ~50 MB)${GPU ? ", WebGL panes" : ""}`;
export const seed = (app, settings = {}) => seedProfile(app, GPU ? { terminalGpu: true, ...settings } : settings);
const FLOODERS = 8;
const LINES = 500_000; // x 100 bytes = ~50 MB per pane
const FLOOD_BUDGET_S = 600;
const MEM_PEAK_MB = 1024; // app + web view growth over the pre-flood working set
const MEM_AFTER_MB = 512; // growth 10 s after the last pane finished

const FLOOD_JS = `// prints ${LINES} lines of 100 bytes, honours back-pressure, then END-<k> and a done file once the last byte was accepted
const fs = require("node:fs");
const [k, done] = [process.argv[2], process.argv[3]];
const line = "x".repeat(98) + "\\n";
let i = 0;
function go() {
  while (i < ${LINES}) {
    i++;
    if (!process.stdout.write(line)) return process.stdout.once("drain", go);
  }
  process.stdout.write("END-" + k + "\\n", () => fs.writeFileSync(done, String(Date.now())));
}
go();
`;
const ECHO_JS = `// answers every byte it reads with a numbered token on its own line
let n = 0;
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (d) => { for (const b of d) { if (b === 3) process.exit(0); process.stdout.write("[E" + ++n + "]\\r\\n"); } });
process.stdout.write("ECHO-READY\\r\\n");
`;

// GPU mode: the output bus probe notes when each echo token reaches the page. Only short chunks are decoded
// (an echo token or the ready line is a few bytes; a flood chunk is kilobytes), so the probe adds little work to the flood.
const ECHO_PROBE_JS = `(() => {
  const bus = window.__koluxOutputBus;
  if (!bus) return "no output bus";
  window.__echoAt = new Map();
  bus.probe = (batch) => {
    const t = performance.now();
    for (const it of batch.items || []) {
      if (typeof it.data !== "string" || it.data.length > 512) continue;
      const text = atob(it.data);
      if (text.includes("ECHO-READY")) window.__echoReady = true;
      for (const m of text.matchAll(/\\[E(\\d+)\\]/g)) if (!window.__echoAt.has(m[0])) window.__echoAt.set(m[0], t);
    }
  };
  return "installed";
})()`;

// In the page: type one character into pane `idx`'s input field and wait for the token the echo program answers with.
const echoScript = (idx, count, gap) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const pane = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${idx}];
  const ta = pane.querySelector(".xterm-helper-textarea"), rows = ${GPU} ? null : pane.querySelector(".xterm-rows");
  window.__echoN = window.__echoN || 0;
  const out = [];
  for (let i = 0; i < ${count}; i++) {
    const token = "[E" + (window.__echoN + 1) + "]";
    const ms = await new Promise((resolve) => {
      const t0 = performance.now();
      let poll = 0;
      const done = (v) => { obs?.disconnect(); clearInterval(poll); clearTimeout(to); resolve(v); };
      const obs = rows ? new MutationObserver(() => { if (rows.textContent.includes(token)) done(performance.now() - t0); }) : null;
      if (obs) obs.observe(rows, { subtree: true, childList: true, characterData: true });
      else poll = setInterval(() => { if (window.__echoAt.has(token)) { clearInterval(poll); frame().then(frame).then(() => done(performance.now() - t0)); } }, 2);
      const to = setTimeout(() => done(-1), 5000);
      ta.value = "x";
      ta.dispatchEvent(new InputEvent("input", { data: "x", inputType: "insertText", bubbles: true }));
    });
    if (ms >= 0) window.__echoN++; else window.__echoN++; // the token number advances either way: the program counted the byte
    out.push(Math.round(ms));
    await sleep(${gap});
  }
  return out;
})()`;

export async function run({ launch, checks }) {
  const app = await launch("s2");
  const repo = join(app.temp, "repo");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "flood.js"), FLOOD_JS);
  writeFileSync(join(files, "echo.js"), ECHO_JS);
  await gitInit(app, repo, "s2");
  await installProbe(app);
  await addProjectAndOpen(app, repo);
  for (let want = 2; want <= FLOODERS + 1; want++) {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await app.waitFor(`${want} shell panes`, async () => (await app.shown(TERM)) === want, 30000);
  }
  for (let i = 0; i < FLOODERS + 1; i++) await app.waitFor(`pane ${i + 1}'s input field`, async () => (await app.evalJs(`!!([...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${i}]?.querySelector(".xterm-helper-textarea"))`)), 20000);
  await app.sleep(4000); // the shells reach their prompts
  const echoPane = FLOODERS;
  if (GPU) checks.note(`echo probe: ${await app.evalJs(ECHO_PROBE_JS)}`);
  await typeInto(app, echoPane, `node '${slash(join(files, "echo.js"))}'`);
  await app.waitFor("the echo program", async () => (GPU ? await app.evalJs("!!window.__echoReady") : (await paneText(app, echoPane))?.includes("ECHO-READY")), 30000, 500);
  const idle = await app.evalJs(echoScript(echoPane, 30, 100));
  const idleStats = stats(idle.filter((v) => v >= 0));
  checks.add("echo latency in a 9th pane with nothing else running (30 keys, in-page key to token on screen)", "p95 <= 250 ms (the same bar as under flood)", `p50 ${fmt(idleStats.p50)} ms, p95 ${fmt(idleStats.p95)} ms, max ${fmt(idleStats.max)} ms; ${idle.filter((v) => v < 0).length} lost`, idleStats.p95 <= 250 && !idle.includes(-1));
  const before = await snapshot(app);
  const baseMB = appMemMB(before);
  // Per process role (kolux, wv-browser, wv-renderer, wv-gpu-process, wv-utility, conhost ...): working set and private bytes
  // before, at their own peak and 10 s after, plus the page's JS heap (performance.memory), so a growth names its process.
  const jsHeapMB = () => app.evalJs(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`).catch(() => NaN);
  const roleBase = memByRole(before);
  const rolePeak = {};
  const heap = { base: await jsHeapMB(), peak: -1 };
  const doneFile = (k) => join(files, `done-${k}`);
  // Which renderer each shown pane draws with: a WebGL pane's screen holds a canvas, a plain one draws rows as elements.
  checks.note(`renderers of the shown panes: ${JSON.stringify(await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null).map((p) => p.querySelector(".xterm-screen canvas") ? "webgl" : p.querySelector(".xterm-rows") ? "dom" : "?").join(",")`))}`);
  checks.note(`page engine: ${await app.evalJs(`navigator.userAgent.split(" ").find((x) => x.startsWith("Edg/")) +"; native base64 decode " + (typeof Uint8Array.fromBase64 === "function")`)}`);
  const perf = await perfSession(app.cdpPort).catch((e) => (checks.note(`perf session: ${e.message}`), null));
  const m0 = await perf?.metrics();
  const t0 = Date.now();
  for (let k = 0; k < FLOODERS; k++) await typeInto(app, k, `node '${slash(join(files, "flood.js"))}' ${k} '${slash(doneFile(k))}'`);
  const tStart = Date.now();
  checks.note(`all ${FLOODERS} flood commands typed in ${((tStart - t0) / 1000).toFixed(1)} s`);
  // Memory is sampled in the background while the echo samples are taken.
  const mem = [];
  const progress = [];
  let finished = false;
  const sampler = (async () => {
    while (!finished) {
      try {
        const snap = await snapshot(app);
        mem.push(appMemMB(snap));
        for (const [role, v] of Object.entries(memByRole(snap))) {
          const e = (rolePeak[role] ??= { wsMB: 0, privMB: 0 });
          e.wsMB = Math.max(e.wsMB, v.wsMB);
          e.privMB = Math.max(e.privMB, v.privMB);
        }
        const h = await jsHeapMB();
        if (h > heap.peak) heap.peak = h;
        progress.push(`${Math.round((Date.now() - tStart) / 1000)}s:${Array.from({ length: FLOODERS }, (_, k) => existsSync(doneFile(k))).filter(Boolean).length}/${FLOODERS}done:${Math.round(mem[mem.length - 1])}MB`);
      } catch {
        /* a sample missed is a sample missed */
      }
      await app.sleep(3000);
    }
  })();
  await app.sleep(3000);
  // 60 keys can take 60 x 5 s when every echo is lost; a page that stays silent for longer than that is frozen.
  app.cdpTimeoutMs = 420000;
  const tEcho = Date.now();
  const flooding = await app.evalJs(echoScript(echoPane, 60, 250)).catch((e) => ({ frozen: `the page did not answer in ${((Date.now() - tEcho) / 1000).toFixed(0)} s (${e.message.slice(0, 80)})` }));
  app.cdpTimeoutMs = 120000;
  if (flooding.frozen) {
    checks.add("echo latency in a 9th pane while 8 panes flood (60 keys, in-page key to token on screen)", "p95 <= 250 ms", `FROZEN: ${flooding.frozen}`, false);
  }
  // Page allocation over 20 s of the flood (short-lived garbage included), taken after the echo samples so it does not slow them.
  const busy = Array.from({ length: FLOODERS }, (_, k) => !existsSync(doneFile(k))).filter(Boolean).length;
  if (perf && busy === FLOODERS) {
    const a = await perf.allocations(20000).catch((e) => ({ err: e.message }));
    const busyAfter = Array.from({ length: FLOODERS }, (_, k) => !existsSync(doneFile(k))).filter(Boolean).length;
    checks.note(a.err ? `allocation sample failed: ${a.err}` : `page allocations over 20 s of flood (sampling heap profiler, collected objects kept): ${a.totalMB.toFixed(0)} MB; floods running at the end ${busyAfter} of ${FLOODERS}; top: ${a.top.join("; ")}`);
  } else checks.note(`allocation sample skipped: ${FLOODERS - busy} of ${FLOODERS} floods already done after the echo samples`);
  const floodStats = stats(flooding.frozen ? [] : flooding.filter((v) => v >= 0));
  const stillRunning = Array.from({ length: FLOODERS }, (_, k) => !existsSync(doneFile(k))).filter(Boolean).length;
  if (!flooding.frozen) checks.add("echo latency in a 9th pane while 8 panes flood (60 keys, in-page key to token on screen)", "p95 <= 250 ms", `p50 ${fmt(floodStats.p50)} ms, p95 ${fmt(floodStats.p95)} ms, max ${fmt(floodStats.max)} ms; ${(flooding.frozen ? [] : flooding).filter((v) => v < 0).length} keys never echoed within 5 s; ${stillRunning} of ${FLOODERS} floods still running when sampling ended`, floodStats.p95 <= 250 && !flooding.includes(-1));
  let pending = 0;
  try {
    await app.waitFor("every flood to finish", () => ((pending = Array.from({ length: FLOODERS }, (_, k) => existsSync(doneFile(k))).filter((x) => !x).length) === 0), FLOOD_BUDGET_S * 1000, 2000);
  } catch {
    /* judged below */
  }
  const tDone = Date.now();
  const m1 = await perf?.metrics().catch(() => null);
  if (m0 && m1) {
    const d = perf.diff(m0, m1);
    const span = (tDone - t0) / 1000;
    checks.note(`page main thread over the flood (${span.toFixed(0)} s, CDP Performance.getMetrics): task ${d.TaskDuration.toFixed(1)} s (${((100 * d.TaskDuration) / span).toFixed(0)}% busy), script ${d.ScriptDuration.toFixed(1)} s, layout ${d.LayoutDuration.toFixed(1)} s, style ${d.RecalcStyleDuration.toFixed(1)} s; JS heap used ${(m0.JSHeapUsedSize / 1048576).toFixed(0)} -> ${(m1.JSHeapUsedSize / 1048576).toFixed(0)} MB`);
  }
  perf?.close();
  finished = true;
  await sampler;
  const secs = (tDone - tStart) / 1000;
  checks.add(`all ${FLOODERS} floods finish (each ${LINES} lines, ~${Math.round((LINES * 100) / 1e6)} MB)`, `within ${FLOOD_BUDGET_S} s`, pending === 0 ? `${secs.toFixed(0)} s (${((FLOODERS * LINES * 100) / 1e6 / secs).toFixed(1)} MB/s total)` : `${pending} of ${FLOODERS} still running after ${FLOOD_BUDGET_S} s`, pending === 0);
  checks.note(`flood progress (seconds after start : floods done : app MB), every ~3 s, thinned: ${progress.filter((_, i) => i % 5 === 0).join(" ")}`);
  await app.sleep(10000);
  const afterSnap = await snapshot(app);
  const afterMB = appMemMB(afterSnap);
  const roleAfter = memByRole(afterSnap);
  heap.after = await jsHeapMB();
  const r0 = (m) => Math.round(m ?? 0);
  checks.note(`memory per process role, MB (working set / private bytes): ${Object.keys({ ...roleBase, ...rolePeak, ...roleAfter }).sort().map((role) => `${role} x${roleAfter[role]?.n ?? roleBase[role]?.n ?? "?"} before ${r0(roleBase[role]?.wsMB)}/${r0(roleBase[role]?.privMB)} peak ${r0(rolePeak[role]?.wsMB)}/${r0(rolePeak[role]?.privMB)} after ${r0(roleAfter[role]?.wsMB)}/${r0(roleAfter[role]?.privMB)}`).join("; ")}`);
  checks.note(`page JS heap (performance.memory.usedJSHeapSize), MB: before ${heap.base}, peak ${heap.peak}, 10 s after ${heap.after}`);
  const peak = Math.max(...mem, baseMB);
  checks.add("app memory growth at the peak during the flood (app + web view working set)", `<= ${MEM_PEAK_MB} MB over the pre-flood ${fmt(baseMB)} MB`, `peak ${fmt(peak)} MB (+${fmt(peak - baseMB)}); ${mem.length} samples`, peak - baseMB <= MEM_PEAK_MB);
  checks.add("app memory growth 10 s after the floods ended", `<= ${MEM_AFTER_MB} MB over the pre-flood level`, `${fmt(afterMB)} MB (+${fmt(afterMB - baseMB)})`, afterMB - baseMB <= MEM_AFTER_MB);
  // The final line: the bytes were accepted (done file); the screen has to show them too.
  const missing = [];
  let frozenEnd = null;
  for (let k = 0; k < (GPU ? 0 : FLOODERS); k++) {
    let ok = false;
    for (let i = 0; i < 60 && !ok && !frozenEnd; i++) {
      try {
        ok = ((await paneText(app, k)) ?? "").includes(`END-${k}`);
      } catch (e) {
        frozenEnd = `the page stopped answering while reading pane ${k + 1} (${e.message.slice(0, 80)})`;
      }
      if (!ok && !frozenEnd) await app.sleep(500);
    }
    if (!ok) missing.push(k + 1);
  }
  if (frozenEnd) checks.note(frozenEnd);
  if (GPU) checks.note("final lines not read back: WebGL panes draw on a canvas (the done files above prove every byte was accepted)");
  else checks.add("pane shows its final line (END-<k>) after the flood", "8 of 8 panes", `${FLOODERS - missing.length} of ${FLOODERS}${missing.length ? `; missing in pane(s) ${missing.join(", ")}` : ""}`, missing.length === 0);
  const errs = await pageErrors(app).catch((e) => [`page unreachable: ${e.message.slice(0, 80)}`]);
  checks.add("page errors during the run", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);
  const stamp = existsSync(doneFile(0)) ? readFileSync(doneFile(0), "utf8") : "never";
  checks.note(`pane 1 flood accepted its last byte at ${stamp}; the echo program keeps pane 9 (the key target) running until the app closes`);
}
