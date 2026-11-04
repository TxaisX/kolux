// LIVE proof, SET-001 box 3 (spec/17): with Rose chosen, a pop-out window (the Tower's own window) is Rose as well.
// The window is made hidden and off-screen through the same Tauri command the app's "Own window" button uses; both pages' root style is read over CDP.
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT } from "./live-common.mjs";
import { targets, evidence } from "./live-browser-common.mjs";

const READ = `JSON.stringify({ css: document.documentElement.style.cssText, mode: document.documentElement.dataset.mode, surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(), accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), theme: (() => { try { return JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /appearance|look|theme/i.test(k)) ?? "x") ?? "null")?.appearance?.theme ?? null; } catch { return "?"; } })() })`;

async function evalIn(t, expression) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("ws")); });
  const r = await new Promise((ok) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) ok(m); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  ws.close();
  return JSON.parse(r.result?.result?.value ?? "null");
}

export async function run001b3(ctx, { check, log }) {
  const { app } = ctx;
  const mainT = async () => (await targets()).find((t) => t.type === "page" && /localhost:1470|tauri\.localhost/.test(t.url) && !/tower-window/.test(t.url));
  const classic = await evalIn(await mainT(), READ);
  log(`main window before choosing: surface=${classic.surface} accent=${classic.accent} mode=${classic.mode} theme=${classic.theme}`);
  await ctx.rawKey({ key: ",", code: "Comma", vk: 188, mods: 2 });
  await app.waitFor("the Settings page", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  await app.clickWhere(".settings-nav button", "/^\\s*Appearance\\s*$/");
  await app.waitFor("the colour theme swatches", () => app.exists('[role=radiogroup][aria-label="Colour theme"]'), 10000);
  await app.click('[role=radiogroup][aria-label="Colour theme"] button[role=radio][aria-label="Rose"]');
  await sleep(1500);
  const chosen = await app.evalJs(`document.querySelector('[role=radiogroup][aria-label="Colour theme"] button[role=radio][aria-checked=true]')?.getAttribute("aria-label")`);
  const rose = await evalIn(await mainT(), READ);
  log(`Rose chosen: swatch checked=${chosen}; main surface=${rose.surface} accent=${rose.accent} theme=${rose.theme}`);
  check("Rose is the chosen swatch and the main window changed from Classic", chosen === "Rose" && rose.css !== classic.css && rose.theme === "rose", JSON.stringify({ chosen, theme: rose.theme, changed: rose.css !== classic.css }));
  log(`screenshot (main, Rose): ${await ctx.shot("SET-001-main-rose")}`);

  // The pop-out: the app's own Rust command (the one the Own window button ends in), placed off-screen so nothing shows on the desktop.
  const made = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("tower_window_open", { place: { x: -32000, y: -32000, width: 900, height: 600, center: false, maximized: false } }).then(() => "created", (e) => "error: " + String(e))`).catch((e) => `eval error ${e.message}`);
  log(`tower_window_open (off-screen placement): ${JSON.stringify(made)}`);
  const tower = await poll(async () => (await targets()).find((t) => t.type === "page" && /tower-window/.test(t.url)), 30000, 500);
  log(`tower target: ${tower ? tower.url : "none"}`);
  check("the pop-out window opened (a second page target for #tower-window exists)", !!tower, tower?.url ?? String(made));
  if (!tower) return;
  await sleep(3000);
  const pop = await evalIn(tower, READ);
  log(`pop-out: surface=${pop.surface} accent=${pop.accent} mode=${pop.mode} theme=${pop.theme}`);
  check("the pop-out window's root theme variables are exactly the main window's Rose ones", pop.css === rose.css && pop.css !== classic.css, `equal=${pop.css === rose.css} differsFromClassic=${pop.css !== classic.css}`);
  check("and its --surface and --accent are Rose's (not Classic's)", pop.surface === rose.surface && pop.accent === rose.accent && pop.surface !== classic.surface, JSON.stringify({ pop: [pop.surface, pop.accent], classic: [classic.surface, classic.accent] }));
  const shot = await (async () => {
    const ws = new WebSocket(tower.webSocketDebuggerUrl);
    await new Promise((ok) => { ws.onopen = ok; });
    const data = await new Promise((ok) => { ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) ok(m.result?.data ?? null); }; ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } })); });
    ws.close();
    if (!data) return null;
    const f = `${LIVE_LOGS}/SET-001-popout-rose.png`;
    writeFileSync(f, Buffer.from(data, "base64"));
    return f;
  })();
  log(`screenshot (pop-out, Rose): ${shot}`);
  await app.evalJs(`window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "tower" }).then(() => "closed", (e) => "err " + e)`).then((r) => log(`close pop-out: ${r}`)).catch(() => {});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("SET-001", { report: rep });
    await sleep(3000);
    await run001b3(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  if (!ctx) process.exit(1);
  const code = await finish(ctx, "SET-001", ev, ok);
  evidence(ROOT, "SET-001", [...ev, `result: ${ctx.verdict(ok)}`], "live-SET-001.mjs");
  process.exit(code);
}
