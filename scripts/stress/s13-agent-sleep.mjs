// S13 agent sleep, live: the shipped build puts a finished, unseen, untouched Claude Code pane to sleep, its process ends and its
// memory is freed, and Wake brings it back on `--resume <its session id>`. And it leaves alone a visible agent, an agent with typed but
// unsent input, and a busy agent. Run on the release build (`--release --skip-build`): a release build ignores the development
// shortcut (agentSleepTestFast), so the shortest delay a user can pick applies, 5 minutes, and the check runs once a minute.
//
// Claude Code here is a STAND-IN (scripts/prove/agent-sleep-standin.cjs, copied into the scratch folder as claude.js beside a
// claude.cmd that runs it with node): no network, no account, no model. It holds 600 MB, runs the hooks Kolux installed in the
// scratch CLAUDE_CONFIG_DIR (so Kolux learns its session id and turn state through its own hook script and listener), and comes back
// on `--resume <id>`. The scratch profile points Claude's command at that claude.cmd and puts its folder first on PATH; the scratch
// HOME, USERPROFILE and CLAUDE_CONFIG_DIR are the stress run's own (lib.mjs newApp), never a real sign-in.
//
// One launch, four Claude panes opened from the pane header's "New session" menu, in this order (modes.txt, one line each):
//   A finished  - left in a background tab: must sleep, its process must end, and Wake must resume its session;
//   D finished  - after its turn finished, text typed into its terminal without Enter, then left in a background tab: must stay awake;
//   B busy      - a tool call that never ends, in a background tab: must stay awake;
//   V finished  - the tab left in front (visible): must stay awake.
// The run polls every 15 s until A has slept and D's typing is more than --hold minutes old (8 by default), then brings A's tab
// forward and presses Wake. Evidence: evidence/stress-s13-<sha>.txt (run.mjs) with the stand-in's own log lines.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addProjectAndOpen, fmt, gitInit, seedOnboardingDone, seedProfile, snapshot } from "./lib.mjs";

export const title = "agent sleep, live on the release build with a Claude Code stand-in (sleeps when unseen, wakes on resume; not when visible, typed in or busy)";

const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const HOLD_MIN = Number(opt("hold", 8));
const LATE_S = Number(opt("late", 75)); // seconds after a restart that A and V finish their turn
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);
const STANDIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "prove", "agent-sleep-standin.cjs");
const PLUS = 'section.pane[data-agent] button.ib[title^="New session"]';
const ASLEEP = '[data-testid="asleep-pane"]';
const ORDER = [
  ["A", "finished"],
  ["D", "finished"],
  ["B", "busy"],
  ["V", "finished"],
];

const standinDir = (app) => join(app.temp, "standin");
export const seed = (app) => {
  const dir = standinDir(app);
  mkdirSync(dir, { recursive: true });
  copyFileSync(STANDIN_SRC, join(dir, "claude.js"));
  const cmd = join(dir, "claude.cmd").replace(/\//g, "\\");
  writeFileSync(cmd, ['@echo off', 'node "%~dp0claude.js" %*', ""].join("\r\n"));
  writeFileSync(join(dir, "modes.txt"), ORDER.map(([, m]) => m).join("\n") + "\n");
  // The app (and the agent search behind the New session menu) finds this claude first on PATH.
  process.env.PATH = `${dir.replace(/\//g, "\\")};${process.env.PATH}`;
  const base = seedProfile(app, { agentSleep: true, agentSleepIdleMinutes: 5, agentStatusHooks: true, agentOptions: { claude: { command: cmd, env: `CLAUDE_CONFIG_DIR=${app.paths.claudeConfig}` } } });
  return () => {
    base();
    seedOnboardingDone(app.paths.profile);
  };
};

const readLog = (app) => {
  const f = join(standinDir(app), "standin.log");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};
const starts = (app) => readLog(app).filter((e) => e.start);

// Every stand-in process (node running this run's claude.js): pid, working set and private bytes in MB.
async function standins(app) {
  const tag = standinDir(app).replace(/\//g, "\\").replace(/'/g, "''");
  const out = await app.ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { [string]$_.CommandLine -like '*${tag}\\claude.js*' } | ForEach-Object { "$($_.ProcessId)|$($_.WorkingSetSize)|$($_.PrivatePageCount)" }`);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [pid, ws, priv] = l.split("|").map(Number);
      return { pid, wsMB: ws / 1048576, privMB: priv / 1048576 };
    });
}
const treeTotals = async (app) => {
  const s = await snapshot(app);
  return { n: s.length, wsMB: s.reduce((a, p) => a + p.ws, 0) / 1048576, privMB: s.reduce((a, p) => a + (p.priv || 0), 0) / 1048576 };
};

const paneKeys = (app) => app.evalJs(`[...document.querySelectorAll('section.pane[data-agent][data-key]')].map((e) => ({ key: Number(e.getAttribute("data-key")), agent: e.getAttribute("data-agent"), shown: e.offsetParent !== null }))`).then(unwrap);
const paneTextByKey = (app, key) => app.evalJs(`(() => { const p = document.querySelector('section.pane[data-key="${key}"]'); return p ? (p.querySelector(".xterm-rows")?.innerText ?? "") : null; })()`).then(unwrap);
const tabLabels = (app) => app.evalJs(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim() + (t.getAttribute("aria-selected") === "true" ? " *" : ""))`).then(unwrap);
// The tab strip of the cell that holds pane `key` (V stays awake all run, so its strip is always found by its section).
const STRIP = (key) => `[...document.querySelectorAll(".tabs")].find((t) => t.parentElement && t.parentElement.querySelector('section.pane[data-key="${key}"]'))`;
const tabsIn = (app, key) => app.evalJs(`(() => { const s = ${STRIP(key)}; return s ? [...s.querySelectorAll(':scope > [role="tab"]')].map((t) => t.textContent.trim() + (t.getAttribute("aria-selected") === "true" ? " *" : "")) : []; })()`).then(unwrap);
// Brings tab n of that strip forward the way a press on it does (Grid.tsx: mousedown on a tab focuses its pane).
const pressTabIn = (app, key, n) => app.evalJs(`(() => { const s = ${STRIP(key)}; const t = s && s.querySelectorAll(':scope > [role="tab"]')[${n}]; if (!t) return "no tab"; t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return "pressed"; })()`).then(unwrap);
// TERM-016 Move to Tab, from the pane menu a right-click on the pane's header opens (TerminalPane.tsx).
const moveToTab = async (app, key) => {
  const r = unwrap(await app.evalJs(`(() => { const h = document.querySelector('section.pane[data-key="${key}"] header.pane-head'); if (!h) return "no header"; const b = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + b.height / 2 })); return "menu"; })()`));
  if (r !== "menu") return r;
  await app.sleep(400);
  return unwrap(await app.evalJs(`(() => { const i = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((e) => /^\\s*Move to Tab/.test(e.textContent)); if (!i) return "no Move to Tab item: " + [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => e.textContent.trim()).join("|"); i.click(); return "moved"; })()`));
};
const asleepState = (app) => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(ASLEEP)})].map((e) => ({ hidden: e.hidden, text: e.innerText.replace(/\\s+/g, " ").trim().slice(0, 120) }))`).then(unwrap);
const docVisible = (app) => app.evalJs(`document.visibilityState`).then(unwrap);
const alivePids = async (app, pids) => {
  const out = await app.ps(`@(${pids.join(",")}) | ForEach-Object { if (Get-Process -Id $_ -ErrorAction SilentlyContinue) { "$_|alive" } else { "$_|gone" } }`);
  return Object.fromEntries(out.split(/\r?\n/).filter(Boolean).map((l) => l.split("|")).map(([p, s]) => [Number(p), s === "alive"]));
};

export async function run(ctx) {
  const { checks } = ctx;
  const lines = [];
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(0)} s`;
  const log = (s) => {
    lines.push(`${at()}  ${s}`);
    console.log(`  ${at()}  ${s}`);
  };
  ctx.report = lines;
  const app = await ctx.launch("agentsleep");
  log(`build: ${ctx.app.buildKind}`);
  log("Claude Code is a STAND-IN (node script holding 600 MB, running Kolux's installed hooks; no network, no account), not Claude Code");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "agentsleep");
  await addProjectAndOpen(app, repo);
  await app.sleep(2000);

  // ---- open the four Claude panes, one at a time, each tied to its stand-in by start order ----
  const P = {};
  for (const [name] of ORDER) {
    const before = (await paneKeys(app)).map((p) => p.key);
    const n0 = starts(app).length;
    const r = unwrap(await app.evalJs(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(PLUS)})].find((e) => e.offsetParent !== null) ?? document.querySelector(${JSON.stringify(PLUS)}); if (!b) return "no plus"; b.click(); return "clicked"; })()`));
    if (r !== "clicked") throw new Error(`pane ${name}: ${r}`);
    await app.waitFor("the New session menu", async () => unwrap(await app.exists('[role=menu][aria-label="New session"] [role=menuitem]')), 8000, 250);
    await app.clickWhere('[role=menu][aria-label="New session"] [role=menuitem]', "/^\\s*Claude Code/");
    const { key } = await app.waitFor(`pane ${name}`, async () => (await paneKeys(app)).find((p) => !before.includes(p.key) && /claude/.test(p.agent ?? "")) ?? null, 30000, 300);
    await app.waitFor(`stand-in ${name} started`, async () => starts(app).length > n0, 30000, 300);
    const s = starts(app)[n0];
    P[name] = { key, pid: s.pid, session: s.session, mode: s.mode, argv: s.argv };
    const text = await app.waitFor(`pane ${name} banner`, async () => {
      const t = await paneTextByKey(app, key);
      return t && t.includes(s.session) ? t : null;
    }, 20000, 400).catch(() => "");
    log(`pane ${name}: key ${key}, stand-in pid ${s.pid}, mode ${s.mode}, session ${s.session}, argv ${JSON.stringify(s.argv)}, banner shown ${!!text}`);
    await app.sleep(3500);
  }

  // ---- one cell, five tabs: each new session opened in a cell of its own, so A, D, B and V are folded, in that order, into the
  // first cell with the pane menu's Move to Tab (TERM-016: "the program keeps running"); V, moved last, is the tab on top.
  // Should a move restart a pane's agent anyway, the restarted stand-in takes the same mode again (modes.txt is written afresh). ----
  // A and V (if restarted) finish their turn 75 s after they start, after every click and focus change below: Kolux counts each
  // write to a pane's terminal as typing, the focus-in/out reports xterm sends when the focus moves included (ConPTY turns focus
  // reporting on at start), so a pane the focus leaves after its turn finished is "typed into" and never sleeps (FINDING, below).
  // A finishing while another tab is in front is the case agent sleep is for.
  writeFileSync(join(standinDir(app), "modes.txt"), ORDER.map(([n, m]) => (n === "A" || n === "V" ? `${m}:${LATE_S}` : m)).join("\n") + "\n");
  const n1 = starts(app).length;
  for (const [n] of ORDER) {
    const r = await moveToTab(app, P[n].key);
    await app.sleep(1500);
    log(`Move to Tab on ${n}: ${r}; stand-in pid ${P[n].pid} alive: ${(await alivePids(app, [P[n].pid]))[P[n].pid]}`);
  }
  await app.sleep(6000);
  const restarted = starts(app).slice(n1);
  if (restarted.length) log(`FINDING: moving the panes restarted ${restarted.length} agent(s) as fresh sessions (no --resume): ${restarted.map((e) => `pid ${e.pid} session ${e.session}`).join("; ")}`);
  checks.add("Move to Tab keeps each agent running (TERM-016)", "0 restarts", `${restarted.length} restart(s)`, restarted.length === 0);
  const tabs = await tabsIn(app, P.V.key);
  const tabOf = {};
  for (let n = 0; n < tabs.length; n++) {
    await pressTabIn(app, P.V.key, n);
    await app.sleep(700);
    const shown = (await paneKeys(app)).filter((p) => p.shown).map((p) => p.key);
    for (const [name] of ORDER) {
      if (!shown.includes(P[name].key) || tabOf[name] !== undefined) continue;
      tabOf[name] = n;
      // The stand-in that runs in the pane now: the last session id on its screen.
      const ids = String((await paneTextByKey(app, P[name].key)) ?? "").match(/session ([0-9a-f-]{36})/g) ?? [];
      const sid = ids.length ? ids[ids.length - 1].slice(8) : null;
      const e = sid && starts(app).filter((x) => x.session === sid).pop();
      if (e && e.pid !== P[name].pid) P[name] = { ...P[name], pid: e.pid, session: e.session, mode: e.mode, rebound: true };
    }
  }
  log(`the one strip: ${JSON.stringify(tabs)}; tab of each pane: ${JSON.stringify(tabOf)}; panes now: ${ORDER.map(([n]) => `${n} key ${P[n].key} pid ${P[n].pid} ${P[n].mode} session ${P[n].session}${P[n].rebound ? " (restarted)" : ""}`).join("; ")}`);
  if (ORDER.some(([n]) => tabOf[n] === undefined)) throw new Error(`a Claude pane has no tab in V's strip: ${JSON.stringify(tabOf)}`);
  checks.add("the four panes under test run the modes asked", "A,D,V finished; B busy", ORDER.map(([n]) => `${n}=${P[n].mode}`).join(" "), ORDER.every(([n, m]) => P[n].mode === m));

  // ---- D: text typed into its terminal after its turn finished, Enter never pressed ----
  await pressTabIn(app, P.V.key, tabOf.D);
  await app.sleep(800);
  const dIndex = unwrap(await app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter((e) => e.offsetParent !== null).findIndex((e) => e.getAttribute("data-key") === "${P.D.key}")`));
  await app.focusPane("section.pane[data-agent]", dIndex, ".xterm-helper-textarea");
  await app.cdp("insert", "a draft I have not sent yet");
  const typedD = Date.now();
  log(`pane D: typed "a draft I have not sent yet" into its terminal, no Enter`);

  // ---- V in front; A, D, B behind ----
  await pressTabIn(app, P.V.key, tabOf.V);
  await app.sleep(1000);
  const layout = await paneKeys(app);
  const shownOf = (n) => layout.find((p) => p.key === P[n].key)?.shown;
  log(`in front: V ${shownOf("V")}; behind: A ${!shownOf("A")}, D ${!shownOf("D")}, B ${!shownOf("B")}; page ${await docVisible(app)}`);
  checks.add("layout: V is the tab in front, A, D and B are tabs behind it", "V shown, A/D/B hidden", JSON.stringify(Object.fromEntries(ORDER.map(([n]) => [n, shownOf(n)]))), shownOf("V") && !shownOf("A") && !shownOf("D") && !shownOf("B"));

  // ---- the stand-ins ran the hooks Kolux installed (the hook script ends "|| exit 0", so exit 0 says it ran, not that Kolux heard it;
  // what Kolux heard shows later: A's sleep needs the session id from SessionStart, and Wake resumes that id). Nothing touches the
  // panes from here on: A and V finish while V's tab is in front. ----
  const live = new Set(ORDER.map(([n]) => P[n].pid));
  await app.waitFor("every stand-in's turn to finish or start its tool", async () => readLog(app).filter((e) => live.has(e.pid) && (e.finished || e.hook === "PreToolUse")).length >= 4, (LATE_S + 60) * 1000, 1000).catch(() => null);
  const hookRuns = readLog(app).filter((e) => e.hook && live.has(e.pid));
  log(`hook runs: ${hookRuns.map((e) => `${e.pid}:${e.hook}=${e.status}`).join(", ")}`);
  const failed = hookRuns.filter((e) => e.status !== 0);
  if (failed.length) log(`hook failures: ${JSON.stringify(failed.slice(0, 3))}`);
  const want = ORDER.length * 2 + 3 + 1; // SessionStart + UserPromptSubmit each, Stop for the three finished, PreToolUse for the busy one
  checks.add("the stand-ins ran Kolux's installed hook script for each event (SessionStart, UserPromptSubmit, then Stop or PreToolUse)", `${want} runs, all exit 0`, `${hookRuns.length - failed.length}/${hookRuns.length} exit 0`, hookRuns.length === want && failed.length === 0);
  const finA = readLog(app).find((e) => e.finished && e.pid === P.A.pid)?.t;
  const finV = readLog(app).find((e) => e.finished && e.pid === P.V.pid)?.t;
  log(`A finished ${finA ? `${fmt((finA - typedD) / 1000, 0)} s after D was typed in (after the last click)` : "never"}; V finished ${finV ? "too" : "never"}`);

  const mem0 = await standins(app);
  const tree0 = await treeTotals(app);
  const memOf = (list, pid) => list.find((m) => m.pid === pid);
  for (const [n] of ORDER) {
    const m = memOf(mem0, P[n].pid);
    log(`stand-in ${n} pid ${P[n].pid}: working set ${fmt(m?.wsMB)} MB, private ${fmt(m?.privMB)} MB`);
  }
  log(`app tree (window, web view, terminal service, consoles, stand-ins): ${tree0.n} processes, working set ${fmt(tree0.wsMB)} MB, private ${fmt(tree0.privMB)} MB`);

  // ---- wait: A must sleep; D, B, V must not ----
  const pids = ORDER.map(([n]) => P[n].pid);
  const deadline = Math.max((finA ?? t0) + (HOLD_MIN + 1) * 60_000, typedD + HOLD_MIN * 60_000);
  let sleptAt = null;
  let tree1 = null;
  let mem1 = null;
  let lastLine = "";
  while (Date.now() < deadline) {
    await app.sleep(15000);
    const alive = await alivePids(app, pids);
    const asleep = await asleepState(app);
    const line = `asleep panes ${asleep.length}${asleep.length ? ` (${asleep.map((a) => a.text).join(" / ")})` : ""}; alive A ${alive[P.A.pid]} D ${alive[P.D.pid]} B ${alive[P.B.pid]} V ${alive[P.V.pid]}; page ${await docVisible(app)}`;
    if (line !== lastLine || Date.now() + 15000 >= deadline) log(line);
    lastLine = line;
    if (sleptAt === null && !alive[P.A.pid]) {
      sleptAt = Date.now();
      await app.sleep(3000);
      tree1 = await treeTotals(app);
      mem1 = await standins(app);
      log(`A slept ${fmt((sleptAt - finA) / 60000, 1)} min after its turn finished (poll granularity 15 s)`);
      log(`app tree after A slept: ${tree1.n} processes, working set ${fmt(tree1.wsMB)} MB, private ${fmt(tree1.privMB)} MB (before ${fmt(tree0.wsMB)} / ${fmt(tree0.privMB)} MB)`);
    }
  }
  // Diagnosis when A stayed awake: ask the Rust side's own check for A (the window asks the same one each tick). A refusal names
  // the Rust rule that held it; an answer means the Rust side agreed and the window's own rules held it (the answer is undone).
  if ((await alivePids(app, [P.A.pid]))[P.A.pid]) {
    const ask = unwrap(await app.evalJs(`(async () => { const inv = window.__TAURI_INTERNALS__?.invoke; if (!inv) return "no invoke";
      try { const r = await inv("agent_pane_sleep", { paneKey: ${P.A.key}, idleMinutes: 5 });
        await inv("agent_pane_unsleep", { paneKey: ${P.A.key}, session: r.session }).catch(() => {});
        return "Rust side agreed (session " + r.session + "); undone"; } catch (e) { return "Rust side refused: " + String(e); } })()`));
    log(`diagnosis, A still awake: ${ask}`);
    checks.note(`diagnosis, A still awake after the hold: ${ask}`);
  }
  const aliveEnd = await alivePids(app, pids);
  const asleepEnd = await asleepState(app);
  const holdNote = `held to ${fmt((Date.now() - (finA ?? t0)) / 60000, 1)} min after A finished, ${fmt((Date.now() - typedD) / 60000, 1)} min after D was typed in; delay 5 min, check every 60 s`;
  checks.add("A (finished, behind a tab, untouched) sleeps: the placeholder shows and its process is gone", "1 asleep placeholder, A's pid gone", `${asleepEnd.length} placeholder(s) [${asleepEnd.map((a) => a.text).join(" / ")}], A pid ${aliveEnd[P.A.pid] ? "alive" : "gone"}`, asleepEnd.length === 1 && !aliveEnd[P.A.pid]);
  const aMem = memOf(mem0, P.A.pid);
  const freed = tree0 && tree1 ? tree0.privMB - tree1.privMB : NaN;
  checks.add("A's memory is freed when it sleeps", `app tree private bytes fall by about A's ${fmt(aMem?.privMB)} MB`, `A held ${fmt(aMem?.wsMB)} MB working set / ${fmt(aMem?.privMB)} MB private; app tree private ${fmt(tree0?.privMB)} -> ${fmt(tree1?.privMB)} MB (-${fmt(freed)} MB), working set ${fmt(tree0?.wsMB)} -> ${fmt(tree1?.wsMB)} MB; A in the stand-in list after: ${!!memOf(mem1 ?? [], P.A.pid)}`, Number.isFinite(freed) && aMem && freed >= aMem.privMB * 0.8);
  checks.add("V (finished, in the tab in front) stays awake", "pid alive", `${aliveEnd[P.V.pid] ? "alive" : "gone"}; ${holdNote}`, aliveEnd[P.V.pid] === true);
  checks.add("D (finished, then typed into without Enter, behind a tab) stays awake", "pid alive", `${aliveEnd[P.D.pid] ? "alive" : "gone"}; ${holdNote}`, aliveEnd[P.D.pid] === true);
  checks.add("B (busy: a tool call still running, behind a tab) stays awake", "pid alive", `${aliveEnd[P.B.pid] ? "alive" : "gone"}; ${holdNote}`, aliveEnd[P.B.pid] === true);

  // ---- Wake: A's tab forward, then its Wake button ----
  const n0 = starts(app).length;
  await pressTabIn(app, P.V.key, tabOf.A);
  await app.sleep(1500);
  const after = await asleepState(app);
  let how = "bringing its tab forward (the placeholder wakes on focus)";
  if (after.some((a) => !a.hidden)) {
    await app.clickWhere(`${ASLEEP} button.btn`, "/./");
    how = "the Wake button";
  }
  await app.waitFor("A's stand-in back", async () => starts(app).length > n0, 30000, 300).catch(() => null);
  const back = starts(app)[n0];
  log(`wake by ${how}: ${back ? `stand-in pid ${back.pid}, argv ${JSON.stringify(back.argv)}, session ${back.session}, resumed ${back.resumed}` : "no new stand-in start"}`);
  const ri = back?.argv?.indexOf("--resume") ?? -1;
  checks.add("Wake starts Claude again with --resume and A's own session id", `--resume ${P.A.session}`, back ? JSON.stringify(back.argv) : "no start", !!back && ri >= 0 && back.argv[ri + 1] === P.A.session);
  await app.sleep(4000);
  const resumeHook = readLog(app).find((e) => e.hook === "SessionStart" && back && e.pid === back.pid);
  const textA = await app.waitFor("A's resumed banner", async () => {
    const keyNow = (await paneKeys(app)).find((p) => p.shown && /claude/.test(p.agent ?? ""));
    const t = keyNow ? await paneTextByKey(app, keyNow.key) : null;
    return t && t.includes("(resumed)") ? t : null;
  }, 20000, 500).catch(() => "");
  const firstRows = (textA || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" | ");
  log(`A after wake: ${firstRows}; SessionStart(resume) hook exit ${resumeHook?.status}; placeholders now ${(await asleepState(app)).length}`);
  checks.add("the woken pane shows the resumed session and Kolux heard it (SessionStart resume hook exit 0)", "banner with (resumed), hook 0", `${firstRows.slice(0, 160)}; hook ${resumeHook?.status}`, !!textA && textA.includes(P.A.session) && resumeHook?.status === 0);
  const mem2 = await standins(app);
  const bm = back ? memOf(mem2, back.pid) : null;
  log(`woken stand-in pid ${back?.pid}: working set ${fmt(bm?.wsMB)} MB, private ${fmt(bm?.privMB)} MB`);
  checks.add("the woken agent is a live process again (holds its memory again)", "alive, about 600 MB", `pid ${back?.pid}: ${fmt(bm?.wsMB)} MB working set`, !!bm && bm.wsMB > 400);

  lines.push("", "stand-in log (scratch folder standin.log, JSON lines):", ...readLog(app).map((e) => `  ${JSON.stringify({ ...e, cwd: undefined })}`));
  checks.note("Claude Code was a stand-in (scripts/prove/agent-sleep-standin.cjs): it proves Kolux's side (hooks heard, rules applied, process ended, memory freed, resume line). It does not prove that real Claude Code reports the same hook events, that `claude --resume <id>` restores a real conversation, or the memory a real session holds.");
}
