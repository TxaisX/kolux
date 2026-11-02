// LIVE proof, T-647 (wave UI lane C): the Insights panel in the right sidebar, hidden app, scratch CLAUDE_CONFIG_DIR.
// Two fake Claude sessions (today, two folders) are written into the scratch config, tracking is switched on and
// scanned, the panel is opened, then at 900, 1400 and 1920 px wide (CDP device metrics) it is measured and shot:
// panel inside the window, no horizontal scroll anywhere in it, three usage tiles priced "est.", both sessions listed.
// Scaling: 1536 px at 125% and 1280 px at 150% (a 1920 px screen at those settings) and 900 px at 150%.
// Also: the Explorer header buttons stay inside the window at all three widths, and the Tower list has no
// horizontal scroll at 900 px.
// usage: node scripts/prove/live-T-647.mjs   -> evidence/T-647-*.png + evidence/T-647-insights.txt
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { reporter, startPlain, finish, sleep, waitFor, ROOT, LIVE_LOGS } from "./live-common.mjs";
import { checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
const EVID = join(ROOT, "evidence");
let ctx;
let ok = false;

const reply = (id, session, cwd, at, usage) =>
  JSON.stringify({ type: "assistant", timestamp: at, sessionId: session, cwd, uuid: `u-${id}`, message: { id, model: "claude-opus-5-5", role: "assistant", usage } });

const PANEL = `(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
  const side = document.querySelector(".rside");
  const ins = document.querySelector(".insights");
  const over = ins ? [...ins.querySelectorAll("*")].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== "visible" && getComputedStyle(n).textOverflow !== "ellipsis").map((n) => n.className).slice(0, 5) : null;
  const cut = ins ? [...ins.querySelectorAll("*")].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); }).length : null;
  const flat = (e) => e.innerText.split(String.fromCharCode(10)).join(" ").replace(/ +/g, " ").trim();
  return { vw: innerWidth, pageScroll: document.documentElement.scrollWidth > innerWidth + 1, side: r(side), ins: r(ins), now: r(document.querySelector(".insights button.ins-row")), insScroll: ins ? ins.scrollWidth > ins.clientWidth + 1 : null, over, cut,
    tiles: [...document.querySelectorAll(".insights .ins-tile")].map(flat),
    text: ins ? flat(ins).slice(0, 600) : null };
})()`;

const EXPLORER = `(() => {
  const box = document.querySelector(".explorer:not([hidden])");
  const hb = box ? box.getBoundingClientRect() : null;
  const bs = box ? [...box.querySelectorAll(".explorer-head .ib")] : [];
  const out = bs.filter((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.right > hb.right + 1 || r.bottom > hb.bottom; }).map((b) => b.getAttribute("aria-label"));
  return { vw: innerWidth, n: bs.length, out };
})()`;

const TOWER = `(() => {
  const l = document.querySelector(".tower .list");
  if (!l) return { vw: innerWidth, list: false };
  // A probe row with all seven columns, so the grid's minimum widths are measured even with no agent open.
  const probe = document.createElement("div");
  probe.className = "row";
  for (let i = 0; i < 7; i++) probe.appendChild(document.createElement("span")).textContent = "x";
  l.appendChild(probe);
  const res = { vw: innerWidth, list: true, rows: l.querySelectorAll(".row").length, scroll: l.scrollWidth > l.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth + 1 };
  probe.remove();
  return res;
})()`;

/** One CDP session: set the viewport width and scale, evaluate `expr`, screenshot, clear the override. */
async function at(width, scale = 1, expr = PANEL, tag = "insights") {
  const port = process.env.PROVE_PORT || "1470";
  const targets = await (await fetch(`http://127.0.0.1:${process.env.PROVE_CDP || "9290"}/json`)).json();
  const t = targets.find((x) => x.type === "page" && (x.url.includes(`localhost:${port}`) || x.url.includes("tauri.localhost")));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mine = ++id;
      const on = (e) => { const m = JSON.parse(e.data); if (m.id === mine) { ws.removeEventListener("message", on); resolve(m.result); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: scale, mobile: false });
  await sleep(1500);
  const m = (await send("Runtime.evaluate", { returnByValue: true, expression: expr })).result.value;
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await send("Emulation.clearDeviceMetricsOverride");
  ws.close();
  const name = `T-647-${tag}-${width}${scale === 1 ? "" : `-x${scale}`}.png`;
  const file = `${LIVE_LOGS}/${name}`;
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  copyFileSync(file, join(EVID, name));
  return { m, file };
}

try {
  // startPlain adds the project and starts a Terminal from the session chooser it opens.
  ctx = await startPlain("T-647", { report: rep, standin: [] });
  const { app } = ctx;
  log(`project added and a shell started: ${ctx.repo}`);
  const projects = join(app.paths.claudeConfig, "projects");
  const now = Date.now();
  const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const put = (folder, session, cwd, rows) => {
    mkdirSync(join(projects, folder), { recursive: true });
    writeFileSync(join(projects, folder, `${session}.jsonl`), rows.join("\n") + "\n");
  };
  put("C--work-alpha", "s-alpha", "C:/work/alpha", [
    reply("a1", "s-alpha", "C:/work/alpha", iso(30), { input_tokens: 120000, output_tokens: 8000 }),
    reply("a2", "s-alpha", "C:/work/alpha", iso(20), { input_tokens: 40000, output_tokens: 4000, cache_read_input_tokens: 200000 }),
  ]);
  put("C--work-beta", "s-beta", "C:/work/beta", [reply("b1", "s-beta", "C:/work/beta", iso(10), { input_tokens: 60000, output_tokens: 12000 })]);
  log(`seeded two sessions in the scratch config ${projects}`);
  await app.invoke("token_tracking_set", { provider: "claude", on: true });
  const saved = await app.invoke("token_usage_scan", { provider: "claude" });
  log(`scan: ${JSON.stringify(saved).slice(0, 200)}`);

  // The right panel may already be open (on another tab): open it only when its button offers to.
  if (await app.exists('button.ib.panel[title="Show the right panel"]')) await app.click('button.ib.panel[title="Show the right panel"]');
  await sleep(800);
  if (!(await app.exists(".insights"))) {
    const picked = await app.clickWhere(".rside-tab", "/^\\s*Insights\\s*$/");
    log(`Insights tab clicked: ${picked}`);
  }
  await waitFor("the Insights panel with its tiles", () => app.exists(".insights .ins-tile"), 20000, 500);
  // A stand-in claude (banner, then waits) in the shell, so the Now list has a row to measure and click.
  await ctx.typeInto(0, "claude");
  await waitFor("a Now row for the stand-in agent", () => app.exists(".insights button.ins-row"), 30000, 500);
  log(`Now row: ${await app.evalJs(`document.querySelector(".insights button.ins-row").innerText.split(String.fromCharCode(10)).join(" | ")`)}`);
  await sleep(1500);

  for (const [width, scale] of [[900, 1], [1400, 1], [1920, 1], [1536, 1.25], [1280, 1.5], [900, 1.5]]) {
    const { m, file } = await at(width, scale);
    const w = `${width}px${scale === 1 ? "" : ` at ${scale * 100}%`}`;
    log(`${w}: ${JSON.stringify(m)}`);
    log(`screenshot: ${file}`);
    check(`${w}: the panel is inside the window`, m.side && m.side.l >= 0 && m.side.r <= m.vw && m.ins && m.ins.w >= 200, JSON.stringify({ side: m.side, ins: m.ins, vw: m.vw }));
    check(`${w}: no horizontal scroll on the page or in the panel, nothing past the edge`, !m.pageScroll && !m.insScroll && m.cut === 0 && m.over.length === 0, JSON.stringify({ page: m.pageScroll, ins: m.insScroll, cut: m.cut, over: m.over }));
    check(`${w}: Today, 7 days and All time tiles, each priced as an estimate`, m.tiles.length === 3 && m.tiles.every((x) => /est\./.test(x)), JSON.stringify(m.tiles));
    check(`${w}: both fake sessions are listed`, /alpha/.test(m.text) && /beta/.test(m.text), m.text);
    check(`${w}: the Now row is inside the panel`, m.now && m.now.l >= m.ins.l && m.now.r <= m.ins.r, JSON.stringify({ now: m.now, ins: m.ins }));
  }

  // Clicking the Now row brings its pane forward with the keyboard focus in it.
  const where = `(() => { const p = document.activeElement && document.activeElement.closest("section.pane"); return p ? "pane: " + (p.getAttribute("aria-label") || p.className) : "outside a pane: " + (document.activeElement ? document.activeElement.tagName : "none"); })()`;
  await app.evalJs(`(() => { if (document.activeElement) document.activeElement.blur(); return "blurred"; })()`);
  log(`focus before the click: ${await app.evalJs(where)}`);
  await app.click(".insights button.ins-row");
  await sleep(800);
  const focused = await app.evalJs(where);
  check("clicking the Now row focuses its pane", typeof focused === "string" && focused.startsWith("pane: "), JSON.stringify(focused));

  // The Explorer tab of the same sidebar: every header button inside the window and the panel.
  log(`Explorer tab clicked: ${await app.clickWhere(".rside-tab", "/^\\s*Explorer\\s*$/")}`);
  await sleep(1200);
  for (const width of [900, 1400, 1920]) {
    const { m, file } = await at(width, 1, EXPLORER, "explorer");
    log(`explorer ${width}px: ${JSON.stringify(m)} (${file})`);
    check(`explorer ${width}px: all header buttons are inside the window`, m.n >= 8 && m.out.length === 0, JSON.stringify(m));
  }

  // The Tower at 900 px: no horizontal scroll bar under its list.
  log(`Tower clicked: ${await app.clickWhere("button", "/^\\s*Tower\\s*$/")}`);
  await waitFor("the Tower list", () => app.exists(".tower .list"), 15000, 500);
  const tw = await at(900, 1, TOWER, "tower");
  log(`tower 900px: ${JSON.stringify(tw.m)} (${tw.file})`);
  check("tower 900px: no horizontal scroll", tw.m.list && !tw.m.scroll && !tw.m.page, JSON.stringify(tw.m));
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
const code = ctx ? await finish(ctx, "T-647-insights", ev, ok) : 1;
writeFileSync(join(EVID, "T-647-insights.txt"), `${ev.join("\n")}\nRESULT: ${ok ? "PASS" : "FAIL"}\n`);
process.exit(code);
