// LIVE proof, SET-027 boxes 1 and 2 (spec/17): the default agent, switching it off, and a saved default that no search finds.
// Every agent's start command is overridden to a stand-in script (agentOptions.<id>.command), so no real agent ever starts.
// node live-SET-027.mjs   -> G:/Temp/live-v8-logs/SET-027.out.txt, evidence/cards-SET-027.txt
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT, LIVE_BASE, writeStandinClaude } from "./live-common.mjs";
import { TODAY } from "./live-browser-common.mjs";

const CHORD = { key: "F8", code: "F8", vk: 119, mods: 2 | 8 }; // Ctrl+Shift+F8 (Ctrl+Alt+letter hits the AltGr guard), bound to tab.newAgent through the scratch keybindings.json
const ID = "SET-027";
const NL = "\n";
const STUB ="@echo off\r\necho stand-in\r\n";
const TEMP = `${LIVE_BASE}/run-${ID}`;
const ABSENT_CANDIDATES = ["codebuff", "kiro", "rovo", "mistral-vibe", "command-code", "autohand", "ante"];

const catalogueIds = () => [...readFileSync(`${ROOT}/src-tauri/src/agents.rs`, "utf8").split("pub const CATALOGUE")[1].split("];")[0].matchAll(/^\s*\("([a-z0-9-]+)",/gm)].map((m) => m[1]);
const SELECT = 'select[aria-label="default agent"]';
const settingsNow = (app) => app.evalJs(`window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => JSON.stringify({ defaultAgent: s.defaultAgent ?? null, disabledAgents: s.disabledAgents ?? [] }))`).then(JSON.parse);
const agentList = (app) => app.evalJs(`window.__TAURI_INTERNALS__.invoke("agent_list").then((l) => JSON.stringify(l.map((a) => ({ id: a.id, program: a.program, installed: a.installed }))))`).then(JSON.parse);
const page = (app) => app.evalJs(`(() => { const s = document.querySelector(${JSON.stringify(SELECT)}); if (!s) return null; return { value: s.value, selected: s.selectedOptions[0]?.textContent.trim(), options: [...s.options].map((o) => o.textContent.trim()), chips: [...document.querySelectorAll(".conn-chip")].filter((c) => /^default$/i.test(c.textContent.trim())).map((c) => c.closest("[data-agent]")?.dataset.agent ?? "?"), refresh: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Refresh"), note: document.body.innerText.includes("No agent CLI was found") }; })()`);
const sessions = (app) => app.evalJs(`[...document.querySelectorAll(".pane-row[data-agent]")].map((r) => r.dataset.agent + ":" + r.dataset.pane)`);
const openSettingsAgents = async (app, ctx) => {
  if (!(await app.exists('.settings[role=dialog][aria-label="Settings"]'))) await ctx.rawKey({ key: ",", code: "Comma", vk: 188, mods: 2 });
  await app.waitFor("Settings", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  await app.clickWhere(".settings-nav button", "/^\\s*Agents\\s*$/");
  await app.waitFor("the default agent select", () => app.exists(SELECT), 10000);
};

export async function run027(ctx, { check, log }, ev) {
  const { app } = ctx;
  const note = (t) => { log(t); ev.push(t); };
  const sub = (name, pass, detail) => { check(name, pass, detail); ev.push(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`); };
  const list0 = await agentList(app);
  const installed = list0.filter((a) => a.installed).map((a) => a.id);
  note(`agent_list: ${list0.length} catalogue agents, installed here: ${JSON.stringify(installed)}`);
  await openSettingsAgents(app, ctx);

  // ---- box 1: switch off the default agent
  const A = installed.includes("claude") ? "claude" : installed[0];
  const B = installed.find((id) => id !== A);
  if (!A || !B) { sub("at least two agents are installed (one to be the default, one to take over)", false, JSON.stringify(installed)); return; }
  await sleep(2500);
  for (let i = 0; i < 3 && (await settingsNow(app)).defaultAgent !== A; i++) {
    await app.evalJs(`(() => { const s = document.querySelector(${JSON.stringify(SELECT)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, ${JSON.stringify(A)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(1500);
  }
  const withDefault = await page(app);
  const savedA = await settingsNow(app);
  note(`default set to ${A}: page ${JSON.stringify(withDefault)}; saved ${JSON.stringify(savedA)}`);
  sub(`the page shows ${A} as the default (select value, Default chip, saved setting)`, withDefault.value === A && savedA.defaultAgent === A, JSON.stringify({ value: withDefault.value, chips: withDefault.chips, saved: savedA.defaultAgent }));
  note(`screenshot (default ${A}): ${await ctx.shot("SET-027-default-set")}`);

  await app.click(`.agent-row[data-agent="${A}"] input[type=checkbox][role=switch]`);
  await sleep(1500);
  const off = await page(app);
  const savedOff = await settingsNow(app);
  const swState = await app.evalJs(`document.querySelector('.agent-row[data-agent="${A}"] input[role=switch]')?.checked`);
  note(`${A} switched off: switch checked=${swState}; page ${JSON.stringify(off)}; saved ${JSON.stringify(savedOff)}`);
  sub(`after switching ${A} off the page shows no default (Auto selected, no Default chip, saved default cleared)`, swState === false && off.value === "" && /^Auto/.test(off.selected ?? "") && off.chips.length === 0 && (savedOff.defaultAgent ?? "") === "" && savedOff.disabledAgents.includes(A), JSON.stringify({ swState, value: off.value, selected: off.selected, chips: off.chips, saved: savedOff }));
  sub(`and ${A} (${withDefault.selected}) is no longer a choice in the default list`, off.options.length >= 1 && !off.options.includes(withDefault.selected), JSON.stringify(off.options));
  note(`screenshot (${A} off): ${await ctx.shot("SET-027-default-off")}`);

  // a new session: the New agent chord (tab.newAgent, bound only in this scratch profile) and the New session menu
  await ctx.rawKey({ key: "Escape", code: "Escape", vk: 27, mods: 0 });
  await sleep(500);
  if (await app.exists('.settings[role=dialog][aria-label="Settings"]')) await app.clickWhere("button", "/Close/");
  await sleep(800);
  const before = await sessions(app);
  await ctx.rawKey(CHORD);
  const grew = await poll(async () => (await sessions(app)).length > before.length, 20000, 300);
  await sleep(2500);
  const after = await sessions(app);
  const fresh = after.filter((s) => !before.includes(s));
  note(`New agent chord with ${A} off and no default: sessions before ${JSON.stringify(before)} after ${JSON.stringify(after)}; new ${JSON.stringify(fresh)}`);
  const freshAgent = fresh[0]?.split(":")[0];
  sub(`a new session takes the first agent available (${B}), not the switched-off ${A}`, !!grew && fresh.length === 1 && freshAgent === B, JSON.stringify({ grew: !!grew, fresh, expect: B }));
  note(`screenshot (new session): ${await ctx.shot("SET-027-new-session")}`);
  note(`real agent processes under the app now: ${JSON.stringify(await ctx.realAgents())}`);

  // ---- box 2: a saved default that no search finds
  const absent = ABSENT_CANDIDATES.find((id) => list0.find((a) => a.id === id && !a.installed));
  note(`box 2: "remove every agent CLI" cannot be done in the hidden app: the search path is rebuilt from the real machine and user Path in the registry (installed here: ${JSON.stringify(installed)}), which this lane never changes. Supplementary probe with the one absent agent ${absent}.`);
  if (!absent) return;
  await probeSaved(ctx, { check, log }, ev, absent, list0.find((a) => a.id === absent).program, `${LIVE_BASE}/pathdir-${ID}`);
}

// Supplementary probe for box 2, all through the page: an absent agent is installed (a stand-in program in a PATH folder), made the default, uninstalled, Refreshed, installed again.
async function probeSaved(ctx, { check, log }, ev, absent, program, dir) {
  const { app } = ctx;
  const note = (t) => { log(t); ev.push(t); };
  const sub = (name, pass, detail) => { check(name, pass, detail); ev.push(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`); };
  const file = join(dir, `${program}.cmd`);
  const refreshUntil = async (want) => {
    await openSettingsAgents(app, ctx);
    await app.clickWhere("button", "/^\\s*Refresh\\s*$/");
    await poll(async () => (await agentList(app)).find((a) => a.id === absent)?.installed === want, 15000, 400);
    await sleep(1200);
  };
  writeFileSync(file, STUB);
  await refreshUntil(true);
  await app.evalJs(`(() => { const s = document.querySelector(${JSON.stringify(SELECT)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, ${JSON.stringify(absent)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(1200);
  const live = await page(app);
  note(`probe: ${program}.cmd installed, ${absent} picked as the default: ${JSON.stringify(live)}`);
  sub(`${absent} is the live default while its program is on the PATH`, live.value === absent && live.chips.includes(absent), JSON.stringify({ value: live.value, chips: live.chips }));
  rmSync(file);
  await refreshUntil(false);
  const gone = await page(app);
  const sGone = await settingsNow(app);
  note(`probe: program removed and Refresh pressed: page ${JSON.stringify(gone)}; saved ${JSON.stringify(sGone)}`);
  sub(`the search finds nothing for ${absent}: the saved default is still recorded and listed as saved, not found right now; Auto is not selected; Refresh stays`, sGone.defaultAgent === absent && gone.value === `saved:${absent}` && /saved, not found right now/.test(gone.selected ?? "") && gone.refresh, JSON.stringify({ saved: sGone.defaultAgent, value: gone.value, selected: gone.selected, refresh: gone.refresh }));
  note(`screenshot (saved, not found): ${await ctx.shot("SET-027-saved-not-found")}`);
  writeFileSync(file, STUB);
  await refreshUntil(true);
  const back = await page(app);
  note(`probe: program back and Refresh pressed: ${JSON.stringify(back)}`);
  sub(`once the program is back the saved default is the live default again (${absent} selected, Default chip)`, back.value === absent && back.chips.includes(absent), JSON.stringify({ value: back.value, chips: back.chips }));
  note(`screenshot (installed again): ${await ctx.shot("SET-027-reinstalled")}`);
  rmSync(file);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    const standin = writeStandinClaude(`${LIVE_BASE}/standin-${ID}`, []);
    const agentOptions = Object.fromEntries(catalogueIds().map((id) => [id, { command: standin }]));
    log(`stand-in ${standin} set as the start command of ${Object.keys(agentOptions).length} agents`);
    const pathDir = `${LIVE_BASE}/pathdir-${ID}`;
    rmSync(pathDir, { recursive: true, force: true });
    mkdirSync(pathDir, { recursive: true });
    process.env.KOLUX_KEYBINDINGS_HOME = join(TEMP, "home"); // the scratch home; since T-761 the app follows USERPROFILE too, this keeps it explicit
    ctx = await startPlain(ID, {
      report: rep,
      settings: { agentOptions },
      pathDirs: [pathDir],
      prepare: async () => {
        mkdirSync(join(TEMP, "home", ".kolux"), { recursive: true });
        writeFileSync(join(TEMP, "home", ".kolux", "keybindings.json"), JSON.stringify({ version: 1, keybindings: { "tab.newAgent": "Mod+Shift+F8" } }));
      },
    });
    await sleep(3000);
    await run027(ctx, { check: chk.check, log }, ev);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  appendFileSync(`${ROOT}/evidence/cards-SET-027.txt`, `

LIVE ${TODAY} (scripts/prove/live-SET-027.mjs, hidden dev app, every agent command overridden to a stand-in)
${ev.join(NL)}
`);
  process.exit(ctx ? await finish(ctx, ID, ev, ok) : 1);
}
