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
//
// With the setting on, three more things are read after the timed runs (none of them is timed):
// - the hooks identity in a pane that took a warm shell: the first such pane prints its KOLUX_HOOK_IDENTITY, which must
//   name the warm identity (pane key 4294967295) and the terminal the pane was handed, so an agent typed there reports;
// - what one warm shell costs (MEM_ROUNDS times, default 3): the processes under the app and their working sets, read
//   while the folder has its pane and its warm shell, then the setting is switched off, and the processes that ended
//   are the warm shell's (its shell and its console host); the app's own Resource Manager figure for the warm shell's
//   session (`resources`) is logged beside it;
// - switching the setting off ends the warm shell at once (within 3 s), and nothing else.
import { mkdirSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, waitFor, LIVE_LOGS, TERM, TID } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const RUNS = Math.max(1, Number(process.env.WARM_RUNS) || 5);
const MEM_ROUNDS = Math.max(0, Number(process.env.MEM_ROUNDS ?? 3));
// A new terminal's prompt took a median 0.9 to 1.6 s on GitHub's windows-latest runner (NATIVE-TERMINAL.md); the next
// warm shell must be up before the next sample, or that sample measures a cold start with the setting on.
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
  const id = Number(/"id"\s*:\s*(\d+)/.exec(attach?.answer ?? "")?.[1] ?? NaN);
  const program = /"program"\s*:\s*"([^"]*)"/.exec(attach?.answer ?? "")?.[1] ?? null;
  return { askedWarm: /"warm"\s*:\s*\{/.test(attach?.asked ?? ""), attach: state, id, program, spawned: calls.some((c) => c.cmd === "terminal_spawn") };
}

// The pane key a kept-warm shell's hooks carry until a pane takes it (src-tauri hooks.rs WARM_PANE, u32::MAX).
const WARM_PANE = 4294967295;
// What the sample pane's shell prints: its hooks identity, decoded (PowerShell; the runner's default shell).
const SHOW_IDENTITY = "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KOLUX_HOOK_IDENTITY))";
const SAMPLE_INDEX = `[...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null).indexOf(document.querySelector('[data-warm-sample="1"]'))`;
// The app's own Resource Manager figures (resources.rs): each session's process tree, the app's own tree.
const RESOURCES = `window.__TAURI_INTERNALS__.invoke("resources").then((r) => JSON.stringify({ app: r.app.bytes, sessions: r.sessions.map((s) => ({ id: s.id, pid: s.pid, bytes: s.bytes, committed: s.committed, processes: s.processes })) }))`;
const mb = (n) => (typeof n === "number" ? `${(n / 1048576).toFixed(1)} MB` : "n/a");

/** Every process under the app, with its working set and private bytes, by pid. */
async function workingSets(app) {
  const tree = await app.treeOf(app.pid);
  if (!tree.length) return new Map();
  const out = await app.ps(`Get-Process -Id ${tree.map((p) => p.pid).join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.ProcessName)|$($_.WorkingSet64)|$($_.PrivateMemorySize64)" }`);
  return new Map(
    out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split("|"))
      .map(([pid, name, ws, priv]) => [Number(pid), { name, ws: Number(ws), priv: Number(priv) }]),
  );
}

/** One "new terminal" press in the focused pane's New session menu; resolves once the new pane shows a prompt. */
async function newTerminal(app, mode, label) {
  await app.evalJs(ARM);
  const before = await app.shown(TERM);
  const opened = await app.evalJs(OPEN_MENU);
  if (opened !== "opened") throw new Error(`[${mode}] ${label}: ${opened}`);
  await waitFor("the New session menu", () => app.exists(TID.newSessionMenu), 5000);
  const pressed = await app.evalJs(PRESS);
  if (pressed !== "pressed") throw new Error(`[${mode}] ${label}: ${pressed}`);
  await waitFor("a new pane", async () => (await app.shown(TERM)) > before, 30000);
  await waitFor("its shell prompt", () => app.evalJs("window.__warmLat.prompt !== null"), 30000).catch(() => null);
  await sleep(500); // the last call answers land in the log
  return before;
}

/** Closes the sample pane and waits until the panes on screen are `before` again. */
async function closeSample(app, mode, label, before) {
  const closed = await app.evalJs(CLOSE);
  await waitFor("the sample pane closed", async () => (await app.shown(TERM)) === before, 10000).catch(() => null);
  if (closed !== "closed") log(`[${mode}] ${label}: ${closed}`);
}

/** One memory round: the folder has its pane and a warm shell; the setting goes off, and what ended is the warm
 *  shell's. Then the setting goes on again and a new terminal (opened and closed) starts the folder's next warm shell. */
async function memoryRound(n, rounds) {
  const { app } = ctx;
  const res0 = JSON.parse(await app.evalJs(RESOURCES));
  const ws0 = await workingSets(app);
  await app.invoke("settings_patch", { set: { terminalWarmShell: false }, remove: [] });
  await sleep(3000);
  const res1 = JSON.parse(await app.evalJs(RESOURCES));
  const ws1 = await workingSets(app);
  const ended = res0.sessions.filter((s) => !res1.sessions.some((a) => a.id === s.id));
  const gone = [...ws0].filter(([pid]) => !ws1.has(pid)).map(([pid, p]) => ({ pid, ...p }));
  const round = {
    round: n,
    sessionsBefore: res0.sessions.map((s) => s.id),
    sessionsAfter: res1.sessions.map((s) => s.id),
    ended,
    gone,
    goneWorkingSet: gone.reduce((a, p) => a + p.ws, 0),
    gonePrivate: gone.reduce((a, p) => a + p.priv, 0),
  };
  rounds.push(round);
  log(`[on] memory ${n}: sessions ${round.sessionsBefore.join(",")} -> ${round.sessionsAfter.join(",")}; ended with the setting: ${gone.map((p) => `${p.name} ${mb(p.ws)}`).join(", ") || "nothing"}; working set ${mb(round.goneWorkingSet)}, private ${mb(round.gonePrivate)}; Resource Manager for that session: ${ended.map((s) => `${mb(s.bytes)} in ${s.processes} process(es), committed ${mb(s.committed)}`).join("; ") || "none"}`);
  await app.invoke("settings_patch", { set: { terminalWarmShell: true }, remove: [] });
  await sleep(1000);
  const before = await newTerminal(app, "on", `memory ${n}`);
  await closeSample(app, "on", `memory ${n}`, before);
  await sleep(SETTLE_MS);
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
    const before = await newTerminal(app, mode, `run ${i}`);
    const s = await app.evalJs(READ);
    const path = pathOf(s.calls ?? []);
    samples.push({ run: i, ...s, path });
    log(`[${mode}] run ${i}: prompt ${ms(s.prompt)} (first text ${ms(s.first)}, pane drawn ${ms(s.pane)}); terminal_attach ${path.attach}${path.askedWarm ? " (asked for the warm shell)" : ""}${path.program ? ` running ${path.program}` : ""}, ${path.spawned ? "terminal_spawn" : "no terminal_spawn"}; prompt ${JSON.stringify(s.promptLine)}`);
    // The first pane that took a warm shell (untimed from here): its shell's hooks identity.
    if (on && i === 1 && path.attach === "attached") {
      const index = await app.evalJs(SAMPLE_INDEX);
      await ctx.typeInto(index, SHOW_IDENTITY);
      const found = await waitFor("the identity line", async () => /\{"paneKey":\d+[^}]*\}/.exec((await ctx.text(index)) ?? "")?.[0], 10000).catch(() => null);
      let parsed = null;
      try {
        parsed = found ? JSON.parse(found) : null;
      } catch {}
      result.identity = { line: found, terminal: path.id, parsed };
      log(`[on] run 1: KOLUX_HOOK_IDENTITY in the pane that took the warm shell: ${found ?? "(not printed)"}; terminal_attach handed it terminal ${path.id}`);
    }
    await closeSample(app, mode, `run ${i}`, before);
    await sleep(SETTLE_MS);
  }
  if (on) for (let n = 1; n <= MEM_ROUNDS; n++) await memoryRound(n, result.memory);
}

let ok = false;
const result = { runs: RUNS, settleMs: SETTLE_MS, date: new Date().toISOString(), off: [], on: [], identity: null, memory: [] };
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
  const id = result.identity;
  check("a pane that took a warm shell carries the warm hooks identity of the terminal it was handed", id?.parsed?.paneKey === WARM_PANE && Number.isInteger(id?.terminal) && id.parsed.terminal === id.terminal, JSON.stringify(id));
  check("every pane that took a warm shell was told the shell it runs (header, icon, drops)", result.on.every((s) => s.path.attach !== "attached" || !!s.path.program), result.on.map((s) => s.path.program).join(", "));
  if (MEM_ROUNDS > 0) {
    check(`switching the setting off ended exactly the warm shell's session at once, ${MEM_ROUNDS} of ${MEM_ROUNDS}`, result.memory.length === MEM_ROUNDS && result.memory.every((r) => r.ended.length === 1 && r.sessionsAfter.length === r.sessionsBefore.length - 1), result.memory.map((r) => `${r.sessionsBefore.join(",")}->${r.sessionsAfter.join(",")}`).join("; "));
    const wsMed = median(result.memory.map((r) => r.goneWorkingSet));
    const privMed = median(result.memory.map((r) => r.gonePrivate));
    const rmMed = median(result.memory.map((r) => r.ended[0]?.bytes));
    result.memoryMedian = { workingSet: wsMed, private: privMed, resourceManager: rmMed };
    log(`SUMMARY one warm shell, median of ${MEM_ROUNDS}: the processes that ended with it ${mb(wsMed)} working set, ${mb(privMed)} private; Resource Manager's figure for its session ${mb(rmMed)}`);
  }
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
