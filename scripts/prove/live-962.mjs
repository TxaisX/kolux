// LIVE proof, after.md row 962 (fix-other card 37 NIT): the New session sheet still lists models when `grok models` and
// `cursor-agent --list-models` run with stdout piped, stdin null, stderr dropped, only exit 0 accepted and a 10 s limit.
// A stand-in cursor-agent.cmd sits in a scratch folder at the front of the app's PATH BEFORE the app starts. The app searches
// the registry PATH (the real machine and user PATH) before the process PATH, so the real grok.exe in WinGet's Links folder
// beats any grok.cmd stand-in; Grok is therefore observed through its own `grok models` (listing only, no sign-in) and the
// big-output / hang / stdin-wait variants run through cursor-agent, which is not installed on this machine.
// The listing is asked once per agent per app run, so each variant is its own launch:
//   node live-962.mjs 1   cursor-agent = a list followed by about 200 KB of banner (over the 64 KB pipe buffer)
//   node live-962.mjs 2   cursor-agent = hangs for an hour: the 10 s listing limit and the kill of its process tree
//   node live-962.mjs 3   cursor-agent = waits on stdin (findstr reads NUL) then prints its list
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reporter, startPlain, finish, sleep, LIVE_BASE } from "./live-common.mjs";
import { PLUS } from "./live-SESS-004.mjs";

const RUN = Number(process.argv[2]) || 1;
const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const win = (p) => p.replaceAll("/", "\\");
const BIN = `${LIVE_BASE}/standin-962-${RUN}`;
const CALLS = `${LIVE_BASE}/standin-962-${RUN}-calls.log`;
const HANG = 3600 + RUN; // unique ping count, so the pid check finds only this stand-in's child
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const stand = () => ps(`Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -match '^(cmd|ping|findstr)\\.exe$' -and $_.CommandLine -match 'standin-962|ping -n ${HANG}' } | ForEach-Object { "$($_.ProcessId):$($_.Name)" }`).split(/\r?\n/).filter(Boolean);
const clock = (d = new Date()) => d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0").slice(0, 2);

const VARIANT = { 1: "list + about 200 KB banner", 2: "hangs", 3: "waits on stdin, then lists" }[RUN];
function writeStandin() {
  if (existsSync(BIN)) rmSync(BIN, { recursive: true, force: true });
  mkdirSync(BIN, { recursive: true });
  writeFileSync(CALLS, "");
  const calls = win(CALLS);
  const head = [`@echo off`, `if "%~1"=="--version" (echo cursor-agent 0.0.0-standin & exit /b 0)`, `echo %time% cursor-agent start %* >> "${calls}"`];
  const row = (id, name) => `echo ${id} - ${name}`;
  const body = {
    1: [row("cursor-standin-one", "Standin One"), row("cursor-standin-two", "Standin Two"), `for /L %%i in (1,1,3000) do echo Tip %%i: this banner line only pads the output well past the 64 KB pipe buffer xxxxxxxxxxxx`, `echo %time% cursor-agent end >> "${calls}"`],
    2: [`ping -n ${HANG} 127.0.0.1 >nul`, `echo %time% cursor-agent end >> "${calls}"`, row("cursor-standin-late", "Standin Late")],
    3: [`findstr "^" >nul`, `echo %time% cursor-agent stdin returned >> "${calls}"`, row("cursor-standin-one", "Standin One"), row("cursor-standin-two", "Standin Two")],
  }[RUN];
  writeFileSync(`${BIN}/cursor-agent.cmd`, [...head, ...body, `exit /b 0`].join("\r\n") + "\r\n");
}

const radios = (app, group) =>
  app.evalJs(`(() => { const g = document.querySelector('[role=radiogroup][aria-label=${JSON.stringify(group)}]'); return g ? [...g.querySelectorAll("label.choice")].map(l => ({ t: l.textContent.trim(), c: l.querySelector("input")?.checked })) : null; })()`);
const pickAi = (app, re) =>
  app.evalJs(`(() => {
    const g = () => document.querySelector('[role=radiogroup][aria-label="Seat 1: which AI"]');
    let l = [...g().querySelectorAll("label.choice")].find(l => ${re}.test(l.textContent));
    if (!l) { const more = [...g().querySelectorAll("button.agent-link")].find(b => /^More agents/.test(b.textContent)); if (more) more.click(); }
    return new Promise(r => setTimeout(() => { l = [...g().querySelectorAll("label.choice")].find(l => ${re}.test(l.textContent)); if (!l) return r(null); l.querySelector("input").click(); r({ text: l.textContent.trim(), title: l.title }); }, 400));
  })()`);
const labelsOf = async (app) => ((await radios(app, "Seat 1: which model")) ?? []).map((r) => r.t.replace(/^Model/, ""));
const agentExes = async (app) => (await app.treeOf(app.pid)).filter((p) => /^(claude|codex|grok|cursor-agent|cursor)(\.exe)?$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`);

try {
  writeStandin();
  log(`run ${RUN} (${VARIANT}): cursor-agent.cmd stand-in in ${BIN}, call log ${CALLS}`);
  ctx = await startPlain(`962-${RUN}`, { report: rep, pathDirs: [BIN] });
  const { app } = ctx;
  await sleep(3000);
  log(`agent exes in the app tree at start: ${JSON.stringify(await agentExes(app))}`);
  const t0 = Date.now();
  log(`opening the sheet at ${clock()}`);
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  for (let i = 0; i < 30 && !(await app.exists('[role=menu][aria-label="New session"]')); i++) await sleep(300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^Open a pane that asks/.test(b.title)); b.click(); return true; })()`);
  let sheet = false;
  for (let i = 0; i < 40 && !sheet; i++) {
    sheet = await app.exists('[role=radiogroup][aria-label="Seat 1: which AI"]');
    if (!sheet) await sleep(300);
  }
  check("the New session sheet opens with the Seat 1 AI choices", sheet, `${Date.now() - t0} ms after the click`);
  log(`AI choices: ${JSON.stringify((await radios(app, "Seat 1: which AI")).map((r) => r.t))}`);
  log(`screenshot: ${await ctx.shot(`962-${RUN}-chooser`)}`);

  // Grok: the real install answers (the sheet asks it once when it opens).
  const grok = await pickAi(app, "/grok/i");
  let gl = [];
  for (let i = 0; i < 30; i++) {
    gl = await labelsOf(app);
    if (gl.length && !gl.includes("Grok 4")) break;
    await sleep(500);
  }
  log(`Grok: ${JSON.stringify(grok)}; model choices ${JSON.stringify(gl)} (the built-in list holds only "Grok 4")`);
  check("Grok's model choices come from its own listing (more than the built-in default alone)", gl.some((x) => x !== "Program default") && !gl.includes("Grok 4"), `${JSON.stringify(gl)} (polled up to 15 s)`);
  log(`screenshot: ${await ctx.shot(`962-${RUN}-grok`)}`);

  // Cursor: the stand-in.
  const cur = await pickAi(app, "/cursor/i");
  log(`Cursor: ${JSON.stringify(cur)}`);
  check("Cursor resolves to the stand-in cursor-agent.cmd on the scratch PATH", !!cur && /standin-962/i.test(cur.title ?? ""), JSON.stringify(cur));
  if (RUN !== 2) {
    let labels = [];
    for (let i = 0; i < 40; i++) {
      labels = await labelsOf(app);
      if (labels.some((x) => /Standin Two/.test(x))) break;
      await sleep(500);
    }
    log(`Cursor model choices ${Date.now() - t0} ms after the sheet opened: ${JSON.stringify(labels)}`);
    check(RUN === 1 ? "a listing over 64 KB (rows first, about 200 KB of banner after) is still read: Standin One and Standin Two show" : "a listing that first waits on stdin is read (stdin is null, so it does not hang): Standin One and Standin Two show", labels.some((x) => /Standin One/.test(x)) && labels.some((x) => /Standin Two/.test(x)), JSON.stringify(labels));
    log(`screenshot: ${await ctx.shot(`962-${RUN}-cursor`)}`);
  } else {
    // The hanging stand-in: watch its process tree appear and disappear; the sheet must stay usable meanwhile.
    let firstSeen = null;
    let goneAt = null;
    const lat = [];
    for (let i = 0; i < 60 && goneAt === null; i++) {
      const s = Date.now();
      await app.evalJs("1+1");
      lat.push(Date.now() - s);
      const alive = stand();
      if (alive.length && firstSeen === null) {
        firstSeen = Date.now();
        log(`stand-in tree first seen ${firstSeen - t0} ms after the sheet opened: ${JSON.stringify(alive)}`);
      }
      if (!alive.length && firstSeen !== null) goneAt = Date.now();
      await sleep(500);
    }
    // The listing starts when the sheet opens; the call log (written by the stand-in itself) holds its start time.
    const m = /^(\d+):(\d+):(\d+)\.(\d+)/.exec(readFileSync(CALLS, "utf8").trim());
    const started = m ? new Date().setHours(+m[1], +m[2], +m[3], +m[4] * 10) : firstSeen;
    const lived = goneAt !== null && started ? goneAt - started : null;
    log(`stand-in listing started ${started - t0} ms after the click (its own call log) and was gone by ${goneAt - t0} ms: about ${lived} ms (limit 10000, sampled every ~1.5 s); page round-trips while it hung: max ${Math.max(...lat)} ms over ${lat.length} samples`);
    check("the hanging listing is cut off at the 10 s limit and its whole process tree ends (cmd and ping gone)", lived !== null && lived >= 9500 && lived <= 13500, `${lived} ms`);
    check("the sheet stays responsive while a listing hangs (page round-trips under 1 s)", Math.max(...lat) < 1000, `max ${Math.max(...lat)} ms`);
    const c = await labelsOf(app);
    log(`Cursor model choices ${Date.now() - t0} ms after the sheet opened: ${JSON.stringify(c)}`);
    check("the hanging listing adds no models (Cursor keeps its default choices)", !c.some((x) => /Standin Late/.test(x)), JSON.stringify(c));
    log(`screenshot: ${await ctx.shot(`962-${RUN}-cursor-hang`)}`);
  }

  await sleep(2000);
  const left = stand();
  log(`stand-in processes (cmd/ping/findstr of the stand-in) alive ${Date.now() - t0} ms after the sheet opened: ${JSON.stringify(left)}`);
  check("no stand-in process outlives the listing", left.length === 0, JSON.stringify(left));
  log(`stand-in call log:\n${readFileSync(CALLS, "utf8").trim()}`);
  const exes = await agentExes(app);
  log(`agent exes in the app tree now: ${JSON.stringify(exes)} (a real grok.exe, if listed, ran only its own listing command)`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
const code = ctx ? await finish(ctx, `962-${RUN}`, ev, ok) : 1;
const evidence = process.env.KOLUX_PROVE_EVIDENCE || join(fileURLToPath(new URL("../../", import.meta.url)), "evidence", "live-962-model-listing.txt");
const stamp = new Date().toISOString().slice(0, 10);
const section = `LIVE ${stamp} (batch 8) run ${RUN} of 3: cursor-agent stand-in ${VARIANT} (scripts/prove/live-962.mjs ${RUN})\n${ev.join("\n")}\nresult: ${ctx?.verdict(ok) ?? (ok ? "PASS" : "FAIL")}\n\n`;
if (RUN === 1) writeFileSync(evidence, `After.md row 962: do grok models / cursor-agent --list-models (stdout piped, stdin null, 10 s limit) still fill the New session sheet?\nGrok answers from the real install (WinGet link; the app searches the registry PATH first); cursor-agent is a stand-in script.\n\n${section}`);
else appendFileSync(evidence, section);
process.exit(code);
