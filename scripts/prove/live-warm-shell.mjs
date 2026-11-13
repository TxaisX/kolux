// LIVE check (NATIVE-TERMINAL.md, kept-warm shell): "new terminal" timed in the running app with the kept-warm
// shell off and then on, RUNS times each (default 5), one app launch per setting.
//
//   node scripts/prove/live-warm-shell.mjs          (PROVE_* variables as for every live check; WARM_RUNS=<n>)
//
// One sample, the live-latency way (scripts/prove/live-latency.mjs): performance.now() in the page from pressing
// "Blank terminal" in a pane's New session menu to the new pane's xterm buffer holding (a) any text and (b) a shell
// prompt line (a line ending in >, $, # or %). Both ends are inside the page, so the CDP transport is not counted.
// xterm takes every byte the session prints whether or not it draws it, so (b) is the moment the prompt is there to
// draw, not a later frame. The new pane is closed after each sample, so every sample starts from one pane, and the
// run waits SETTLE_MS between samples: with the setting on, the folder's next warm shell starts after each take.
//
// So that a fast number cannot come from a path the setting did not take, each sample also records the backend calls
// the new pane made: with the setting on it must be answered "attached" by terminal_attach (it took the folder's warm
// shell) and make no terminal_spawn; with it off it must start its own with terminal_spawn.
import { mkdirSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, waitFor, LIVE_LOGS, TERM, TID } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const RUNS = Math.max(1, Number(process.env.WARM_RUNS) || 5);
// A PowerShell start is about 0.8 s on the owner's PC and slower on a cloud runner; the next warm shell must be up
// before the next sample, or that sample measures a cold start with the setting on.
const SETTLE_MS = Math.max(1000, Number(process.env.WARM_SETTLE_MS) || 6000);
const PROMPT = "/[>$#%]$/";

const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const median = (a) => {
  const s = a.filter((n) => typeof n === "number").sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const ms = (n) => (typeof n === "number" ? `${n.toFixed(1)} ms` : "n/a");

// Logs the three calls that decide how a pane got its terminal, with what was asked and answered. It sits over the
// IPC guard's fetch (armed by startPlain), so blocked commands stay blocked. Tauri sends each command as a fetch to
// ipc.localhost; the guard already fails the run when that stops being true.
const WATCH = `(() => {
  if (window.__warmWatch) return "already";
  const prev = window.fetch;
  window.__warmCalls = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const m = /^(?:https?:\\/\\/ipc\\.localhost|ipc:\\/\\/localhost)\\/([^?#]+)/.exec(url);
    const cmd = m ? decodeURIComponent(m[1]) : "";
    const p = prev(input, init);
    if (cmd === "terminal_attach" || cmd === "terminal_spawn" || cmd === "terminal_live_history") {
      const at = performance.now();
      const asked = typeof init?.body === "string" ? init.body.slice(0, 200) : "";
      p.then((r) => r.clone().text()).then(
        (text) => window.__warmCalls.push({ cmd, at, asked, answer: text.slice(0, 160) }),
        () => window.__warmCalls.push({ cmd, at, asked, answer: "(failed)" }),
      );
    }
    return p;
  };
  window.__warmWatch = true;
  return "watching";
})()`;

// Arms one sample: remembers the panes on screen, then follows the first new one every frame until it shows a prompt.
const ARM = `(() => {
  const shown = () => [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null);
  const before = new Set(shown());
  const t = (window.__warmLat = { start: 0, pane: null, first: null, prompt: null, promptLine: "" });
  const tick = () => {
    if (t.prompt !== null) return;
    const fresh = t.start ? shown().find((p) => !before.has(p)) : null;
    if (fresh) {
      fresh.dataset.warmSample = "1";
      const now = performance.now() - t.start;
      if (t.pane === null) t.pane = now;
      let host = null;
      for (const d of fresh.querySelectorAll("div")) if (d.__koluxTerm) { host = d; break; }
      if (host) {
        const b = host.__koluxTerm.buffer.active;
        const rows = [];
        for (let y = 0; y < b.length; y++) rows.push((b.getLine(y)?.translateToString(true) ?? "").trim());
        if (t.first === null && rows.some(Boolean)) t.first = now;
        const p = rows.filter((r) => ${PROMPT}.test(r)).pop();
        if (p) { t.prompt = now; t.promptLine = p.slice(0, 80); return; }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

// Opens the New session menu on the focused pane (the first shown one when none is focused).
const OPEN_MENU = `(() => {
  const panes = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null);
  const pane = panes.find((p) => p.classList.contains("focused")) ?? panes[0];
  const b = pane?.querySelector(${JSON.stringify(TID.paneNewSession)});
  if (!b) return "no New session button";
  b.click();
  return "opened";
})()`;

// The press and its timestamp in one page call, as live-latency does: element.click() fires no mousedown.
const PRESS = `(() => {
  const item = [...document.querySelectorAll(${JSON.stringify(TID.newSessionMenu)} + ' [role="menuitem"]')]
    .find((x) => /^\\s*Blank terminal\\s*$/.test((x.querySelector(".name") ?? x).textContent || ""));
  if (!item) return "no Blank terminal item";
  window.__warmLat.start = performance.now();
  item.click();
  return "pressed";
})()`;

// The sample's numbers and the calls made since its press; then the new pane is closed by its own Close button.
const READ = `(() => {
  const t = window.__warmLat;
  const calls = (window.__warmCalls ?? []).filter((c) => c.at >= t.start).map(({ cmd, asked, answer }) => ({ cmd, asked, answer }));
  return { pane: t.pane, first: t.first, prompt: t.prompt, promptLine: t.promptLine, calls };
})()`;
const CLOSE = `(() => {
  const p = document.querySelector('[data-warm-sample="1"]');
  const b = p && [...p.querySelectorAll("header button")].find((x) => /ends the program/.test(x.title));
  if (!b) return "no Close button";
  b.click();
  return "closed";
})()`;

/** How the pane got its terminal, read from its calls. */
function pathOf(calls) {
  const attach = calls.find((c) => c.cmd === "terminal_attach");
  const state = /"state"\s*:\s*"(\w+)"/.exec(attach?.answer ?? "")?.[1] ?? "none";
  return { askedWarm: /"warm"\s*:\s*\{/.test(attach?.asked ?? ""), attach: state, spawned: calls.some((c) => c.cmd === "terminal_spawn") };
}

// The app this run has open now: whatever happens, finish() below closes it.
let ctx;

/** RUNS samples with the setting `mode`, pushed into `samples` as they come, so a run that fails late keeps the rest. */
async function series(mode, samples) {
  const on = mode === "on";
  ctx = await startPlain(`WARM-${mode}`, { report: rep, settings: { terminalWarmShell: on } });
  const { app } = ctx;
  log(`[${mode}] watch: ${await app.evalJs(WATCH)}`);
  // The first pane's shell comes up; with the setting on, the folder's first warm shell starts beside it.
  await sleep(SETTLE_MS);
  for (let i = 1; i <= RUNS; i++) {
    await app.evalJs(ARM);
    const before = await app.shown(TERM);
    const opened = await app.evalJs(OPEN_MENU);
    if (opened !== "opened") throw new Error(`[${mode}] run ${i}: ${opened}`);
    await waitFor("the New session menu", () => app.exists(TID.newSessionMenu), 5000);
    const pressed = await app.evalJs(PRESS);
    if (pressed !== "pressed") throw new Error(`[${mode}] run ${i}: ${pressed}`);
    await waitFor("a new pane", async () => (await app.shown(TERM)) > before, 30000);
    await waitFor("its shell prompt", () => app.evalJs("window.__warmLat.prompt !== null"), 30000).catch(() => null);
    await sleep(500); // the last call answers land in the log
    const s = await app.evalJs(READ);
    const path = pathOf(s.calls ?? []);
    samples.push({ run: i, ...s, path });
    log(`[${mode}] run ${i}: prompt ${ms(s.prompt)} (first text ${ms(s.first)}, pane drawn ${ms(s.pane)}); terminal_attach ${path.attach}${path.askedWarm ? " (asked for the warm shell)" : ""}, ${path.spawned ? "terminal_spawn" : "no terminal_spawn"}; prompt ${JSON.stringify(s.promptLine)}`);
    const closed = await app.evalJs(CLOSE);
    await waitFor("the sample pane closed", async () => (await app.shown(TERM)) === before, 10000).catch(() => null);
    if (closed !== "closed") log(`[${mode}] run ${i}: ${closed}`);
    await sleep(SETTLE_MS);
  }
}

let ok = false;
const result = { runs: RUNS, settleMs: SETTLE_MS, date: new Date().toISOString(), off: [], on: [] };
try {
  await series("off", result.off);
  const closed = await ctx.stop().catch((e) => [false, String(e.message)]);
  ctx = null;
  log(`[off] app closed: ${JSON.stringify(closed)}`);
  await sleep(3000); // the dev server's port is free again before the next launch takes it
  await series("on", result.on);

  const offMed = median(result.off.map((s) => s.prompt));
  const onMed = median(result.on.map((s) => s.prompt));
  check(`off: every new pane started its own shell (terminal_spawn), ${RUNS} of ${RUNS}`, result.off.length === RUNS && result.off.every((s) => s.path.spawned && s.path.attach !== "attached"), result.off.map((s) => `${s.path.attach}/${s.path.spawned ? "spawn" : "-"}`).join(", "));
  check(`on: every new pane took the folder's warm shell (attached, no terminal_spawn), ${RUNS} of ${RUNS}`, result.on.length === RUNS && result.on.every((s) => s.path.askedWarm && s.path.attach === "attached" && !s.path.spawned), result.on.map((s) => `${s.path.attach}/${s.path.spawned ? "spawn" : "-"}`).join(", "));
  check("every sample reached a shell prompt", [...result.off, ...result.on].every((s) => typeof s.prompt === "number"), `${[...result.off, ...result.on].filter((s) => typeof s.prompt === "number").length} of ${2 * RUNS}`);
  check("the warm shell opens a new terminal sooner (median to prompt)", offMed !== null && onMed !== null && onMed < offMed, `off ${ms(offMed)}, on ${ms(onMed)}`);
  result.median = { off: { prompt: offMed, first: median(result.off.map((s) => s.first)), pane: median(result.off.map((s) => s.pane)) }, on: { prompt: onMed, first: median(result.on.map((s) => s.first)), pane: median(result.on.map((s) => s.pane)) } };
  log("| run | warm shell off: to prompt | warm shell on: to prompt |");
  log("|---|---|---|");
  for (let i = 0; i < RUNS; i++) log(`| ${i + 1} | ${ms(result.off[i]?.prompt)} | ${ms(result.on[i]?.prompt)} |`);
  log(`| median | ${ms(offMed)} | ${ms(onMed)} |`);
  log(`SUMMARY new terminal to prompt, median of ${RUNS}: warm shell off ${ms(offMed)}, on ${ms(onMed)}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
mkdirSync(LIVE_LOGS, { recursive: true });
writeFileSync(`${LIVE_LOGS}/WARM-samples.json`, `${JSON.stringify(result, null, 2)}\n`);
process.exit(ctx ? await finish(ctx, "WARM", ev, ok) : 1);
