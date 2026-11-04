// LIVE proof, SET-004 box 1 (spec/17): save Dark, Cobalt and a non-default app font, restart, record the first frames -> the first frame is dark Cobalt in that font, no light frame.
// The recorder attaches to the browser-level DevTools endpoint the moment it answers during the relaunch, auto-attaches to the new page paused at its start,
// injects a per-animation-frame recorder before any page script and starts a CDP screencast, so frames from before the interface loads are kept.
// The window is created hidden (tauri.conf visible:false) and only shown after the first drawn frames (src/main.tsx), so the page's frames are what a screen recording would show.
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { evidence } from "./live-browser-common.mjs";

const FONT = "Georgia";
const REC = `(() => {
  const rec = (window.__rec = []);
  const tick = (t) => {
    const de = document.documentElement, cs = getComputedStyle(de), b = document.body;
    rec.push({ t: Math.round(t), rs: document.readyState, bg: cs.backgroundColor, appBg: cs.getPropertyValue("--app-bg").trim(), ui: cs.getPropertyValue("--ui-font").trim().slice(0, 40), ff: b ? getComputedStyle(b).fontFamily.slice(0, 60) : null, kids: document.getElementById("root")?.children.length ?? -1 });
    if (rec.length < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** Mean RGB of a PNG (8-bit, RGB or RGBA, not interlaced); null when it is another kind. */
function meanRgb(png) {
  let off = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), kind = png.toString("latin1", off + 4, off + 8), body = png.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; if (body[12] !== 0) return null; }
    if (kind === "IDAT") idat.push(body);
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp || depth !== 8) return null;
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0, v = raw[y * (stride + 1) + 1 + x];
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  let r = 0, g = 0, bl = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) { r += out[i * bpp]; g += out[i * bpp + 1]; bl += out[i * bpp + 2]; }
  return { w, h, rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] };
}
const luma = ([r, g, b]) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

/** Waits for the browser endpoint, then records every new page from its first moment. */
function startRecorder(log) {
  const frames = [];
  const state = { attachedAt: null, pages: [], stop: false, error: null };
  const loop = (async () => {
    let ws = null;
    while (!state.stop && !ws) {
      try {
        const v = await (await fetch("http://127.0.0.1:9290/json/version", { signal: AbortSignal.timeout(400) })).json();
        ws = new WebSocket(v.webSocketDebuggerUrl);
        await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("ws")); });
      } catch { ws = null; await sleep(10); }
    }
    if (!ws) return;
    state.attachedAt = Date.now();
    let n = 0;
    const pending = new Map();
    const send = (method, params = {}, sessionId) => new Promise((ok) => { const id = ++n; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = m.params;
        state.pages.push({ type: targetInfo.type, url: targetInfo.url, at: Date.now() });
        if (targetInfo.type === "page") {
          await send("Page.enable", {}, sessionId);
          await send("Page.addScriptToEvaluateOnNewDocument", { source: REC }, sessionId);
          await send("Page.startScreencast", { format: "png", everyNthFrame: 1 }, sessionId);
        }
        await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
      }
      if (m.method === "Page.screencastFrame") {
        frames.push({ at: Date.now(), ts: m.params.metadata.timestamp ?? null, data: m.params.data, session: m.sessionId });
        send("Page.screencastFrameAck", { sessionId: m.params.sessionId }, m.sessionId);
      }
    };
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    log(`recorder attached to the browser endpoint ${Date.now() - state.t0} ms after the relaunch started`);
    while (!state.stop) await sleep(100);
    try { ws.close(); } catch {}
  })();
  state.t0 = Date.now();
  return { frames, state, stop: async () => { state.stop = true; await loop; } };
}

export async function run004(ctx, { check, log }) {
  const { app } = ctx;
  await sleep(2000);
  await ctx.rawKey({ key: ",", code: "Comma", vk: 188, mods: 2 });
  await app.waitFor("the Settings page", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  await app.clickWhere(".settings-nav button", "/^\\s*Appearance\\s*$/");
  await app.waitFor("the colour theme swatches", () => app.exists('[role=radiogroup][aria-label="Colour theme"]'), 10000);
  await app.clickWhere('[role=radiogroup][aria-label="Mode"] button', "/^\\s*Dark\\s*$/");
  await sleep(800);
  await app.click('[role=radiogroup][aria-label="Colour theme"] button[role=radio][aria-label="Cobalt"]');
  await sleep(800);
  await app.evalJs(`(() => { const l = [...document.querySelectorAll("label.font-field")].find((x) => x.textContent.startsWith("App font")); l.querySelector("input").setAttribute("data-probe", "appfont"); return true; })()`);
  await app.focusField('[data-probe="appfont"]');
  await app.evalJs(`document.querySelector('[data-probe="appfont"]').select()`);
  await app.cdp("insert", FONT, "enter");
  await sleep(1500);
  const saved = JSON.parse(await app.evalJs(`JSON.stringify((() => { const c = JSON.parse(localStorage.getItem("kolux.look") || "null"); const a = c?.appearance ?? {}; return { mode: a.mode, theme: a.theme, appFont: a.appFont, nVars: c ? Object.keys(c.vars ?? {}).length : 0, appBg: getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim(), ui: getComputedStyle(document.documentElement).getPropertyValue("--ui-font").trim().slice(0, 60) }; })())`));
  log(`saved through Settings > Appearance: ${JSON.stringify(saved)}`);
  check("Dark, Cobalt and the app font were saved (cached look and live root agree)", saved.mode === "dark" && saved.theme === "cobalt" && saved.appFont === FONT && saved.nVars > 5 && /georgia/i.test(saved.ui), JSON.stringify(saved));
  log(`screenshot (before the restart): ${await ctx.shot("SET-004-before-restart")}`);
  await ctx.rawKey({ key: "Escape", code: "Escape", vk: 27, mods: 0 }).catch(() => {});
  await sleep(1500);

  const closed = await app.closeAndCount(app.pid);
  log(`quit: ${closed.how}; survivors ${closed.survivors.length}`);
  const rec = startRecorder(log);
  await app.relaunch();
  await sleep(4000);
  await rec.stop();
  await dismissFirstRun(app, log);
  const final = JSON.parse(await app.evalJs(`JSON.stringify({ bg: getComputedStyle(document.documentElement).backgroundColor, appBg: getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim(), ff: getComputedStyle(document.body).fontFamily.slice(0, 60), mode: document.documentElement.dataset.mode ?? null })`));
  const rows = JSON.parse(await app.evalJs(`JSON.stringify(window.__rec ?? null)`));
  log(`recorder: attached=${!!rec.state.attachedAt}; auto-attached targets ${JSON.stringify(rec.state.pages.map((p) => [p.type, p.url.slice(0, 40)]))}; screencast frames ${rec.frames.length}; per-frame rows ${rows ? rows.length : "none (injected script did not run)"}`);
  log(`final state of the loaded app: ${JSON.stringify(final)}`);
  if (rows?.length) {
    const first = rows[0], last = rows[rows.length - 1];
    log(`first row ${JSON.stringify(first)}; last row ${JSON.stringify(last)}`);
    const dt = rows.slice(1).map((r, i) => r.t - rows[i].t).filter((d) => d > 0);
    log(`rows: ${rows.length}; median gap ${dt.sort((a, b) => a - b)[dt.length >> 1] ?? "n/a"} ms (about 16.7 ms = 60 fps); distinct looks: ${JSON.stringify([...new Set(rows.map((r) => `${r.bg} | ${r.appBg} | ${r.ff}`))])}`);
  }
  const mine = rec.frames.filter((f) => f.session === rec.frames[0]?.session);
  const meas = mine.map((f) => ({ ...f, m: meanRgb(Buffer.from(f.data, "base64")) }));
  log(`screencast: ${meas.length} frames; mean RGB and luma of each of the first 12: ${JSON.stringify(meas.slice(0, 12).map((f) => (f.m ? { rgb: f.m.rgb, y: luma(f.m.rgb) } : null)))}`);
  if (meas[0]) writeFileSync(`${LIVE_LOGS}/SET-004-first-frame.png`, Buffer.from(meas[0].data, "base64"));
  if (meas.length) writeFileSync(`${LIVE_LOGS}/SET-004-last-recorded-frame.png`, Buffer.from(meas[meas.length - 1].data, "base64"));
  log(`screenshot (first recorded frame): ${LIVE_LOGS}/SET-004-first-frame.png`);
  log(`screenshot (after relaunch): ${await ctx.shot("SET-004-after-relaunch")}`);

  check("the recorder caught the page before its first script ran (per-frame rows exist)", !!rows && rows.length > 10, String(rows?.length));
  if (rows?.length) {
    const first = rows[0];
    const isDarkBg = (c) => { const m = c.match(/\d+/g)?.map(Number); return !!m && (m.length < 4 || m[3] !== 0) && luma(m) < 90; };
    check("the first recorded frame already has the saved Cobalt background variable (same as the loaded app)", !!first.appBg && first.appBg === final.appBg, `${first.appBg} vs ${final.appBg}`);
    check("the first recorded frame's page background is dark", isDarkBg(first.bg) || (first.appBg && first.bg.includes("0, 0, 0, 0") && luma(first.appBg.match(/[0-9a-f]{2}/gi)?.slice(0, 3).map((h) => parseInt(h, 16)) ?? [255, 255, 255]) < 90), `${first.bg} / ${first.appBg}`);
    const withContent = rows.filter((r) => r.kids > 0);
    log(`rows before any interface content (nothing drawn but the background): ${rows.length - withContent.length}; first row with content: ${JSON.stringify(withContent[0] ?? null)}`);
    check(`from the first frame that draws any content, the app font (${FONT}) is already in force`, withContent.length > 0 && withContent.every((r) => /georgia/i.test(r.ff)), JSON.stringify(withContent.slice(0, 2)));
    check("every recorded frame has the same background and variable (no change once loading finishes)", new Set(rows.map((r) => `${r.appBg}`)).size === 1, JSON.stringify([...new Set(rows.map((r) => r.appBg))]));
  }
  if (meas.length) {
    const ys = meas.map((f) => (f.m ? luma(f.m.rgb) : null)).filter((y) => y !== null);
    const light = ys.filter((y) => y > 128);
    check("no recorded screencast frame is light (mean luma above 128)", ys.length > 0 && light.length === 0, `${ys.length} frames, ${light.length} light, max luma ${Math.max(...ys)}`);
    const a = meas[0].m?.rgb, want = final.appBg.match(/[0-9a-f]{2}/gi).slice(0, 3).map((h) => parseInt(h, 16));
    check("the first screencast frame's mean colour is the Cobalt background (within 12 on each channel)", !!a && a.every((v, i) => Math.abs(v - want[i]) <= 12), `${JSON.stringify(a)} vs ${JSON.stringify(want)}`);
  } else {
    log("no screencast frames arrived (the hidden window painted none the recorder could see)");
    check("the screencast delivered frames", false, "0 frames");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("SET-004", { report: rep });
    await run004(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  if (!ctx) process.exit(1);
  const code = await finish(ctx, "SET-004", ev, ok);
  evidence(ROOT, "SET-004", [...ev, `result: ${ctx.verdict(ok)}`], "live-SET-004.mjs");
  process.exit(code);
}
