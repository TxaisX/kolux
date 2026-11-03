// LIVE proof, T-661 (DT-C97, audit backlog row 57): a page cannot send the user to the system browser on its own word plus a
// click. A real click (CDP Input event, a user gesture) on a page that has not finished its first load asks for a sized window,
// which goes to the system browser: Kolux now shows its own ask above the page naming the host, nothing is opened, and Cancel
// clears it. Open is never pressed here (it would start the real default browser). Hidden dev app (off-screen), scratch
// profile, one loopback site that records every request and holds one image open so the first load never finishes.
// Run: node scripts/prove/live-T-661.mjs
import http from "node:http";
import { writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, checker } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

const ID = "T-661";
const rep = reporter();
const { log } = rep;
const chk = checker(log);
const lines = [];
const note = (s) => { lines.push(s); log(s); };

const hits = [];
const held = [];
const srv = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/favicon.ico") return res.writeHead(404).end();
  hits.push(path);
  if (path === "/hold.png") return void held.push(res); // answered only at the end, so the page's first load stays open
  if (path !== "/page") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><meta charset=utf-8><title>leave</title>
  <button id=go style="position:fixed;left:20px;top:20px;width:160px;height:40px">go</button>
  <img src="/hold.png" width=1 height=1>
  <script>document.getElementById("go").onclick = () => window.open("/sized-user", "_blank", "width=320,height=320");</script>`);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const host = `127.0.0.1:${srv.address().port}`;

// The page's own DevTools target, as live-T-657 does.
const tabCdp = async (url) => {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.PROVE_CDP || "9290"}/json`)).json();
  const t = targets.find((x) => x.type === "page" && x.url === url);
  if (!t) throw new Error("no tab target: " + targets.map((x) => x.url).join(", "));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => {
    const mine = ++id;
    const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === mine) { ws.removeEventListener("message", on); resolve(m.result ?? m.error); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
  const value = async (expr) => (await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const click = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
  };
  return { value, click, close: () => ws.close() };
};

let ctx;
let ok = false;
try {
  ctx = await startPlain(ID, { report: rep });
  const { app } = ctx;
  await sleep(3000);
  const TABS = "div[role=tablist][aria-label=Tabs] div[role=tab]";
  const toShell = async () => {
    if ((await app.shown('section.pane[data-agent="shell"]')) >= 1) return;
    await app.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(TABS)}); t?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t?.click(); })()`);
    await sleep(500);
  };
  const cli = async (args) => { await toShell(); const r = await runCli(ctx, args, { pane: 0 }); log(`kolux-dev ${args} -> exit ${r.exit} ${r.raw.replace(/\s+/g, " ").slice(0, 220)}`); return r; };
  for (let i = 0; i < 4; i++) { if (!(await app.clickWhere("button", "/^\\s*Not now\\s*$/").catch(() => false))) break; await sleep(500); }
  await dismissFirstRun(app, log);
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
  await sleep(2500);

  const made = (await cli(`tab create --url ${base}/page`)).json;
  note(`site <loopback>; browser tab ${made?.page ?? made?.id ?? "?"} on /page, its image held open so the first load does not finish`);
  await sleep(4000);
  const t = await tabCdp(`${base}/page`);
  const state = await t.value("document.readyState");
  note(`the page's readyState before the click: ${state}`);
  chk.check("the page's first load is still open (the sized window would go to the system browser)", state !== "complete", state);

  const ASK = '[data-leave="system"]';
  chk.check("no ask is showing before the click", !(await app.exists(ASK)), "");
  const go = JSON.parse(await t.value(`JSON.stringify(document.getElementById("go").getBoundingClientRect())`));
  await t.click(go.x + 10, go.y + 10);
  await app.waitFor("Kolux's ask above the page", () => app.exists(ASK), 8000).catch(() => {});
  const shown = await app.evalJs(`(() => { const a = document.querySelector(${JSON.stringify(ASK)}); if (!a) return null; const b = a.querySelector("[data-leave-go]"); return JSON.stringify({ role: a.getAttribute("role"), label: a.getAttribute("aria-label"), text: a.textContent, off: b ? b.disabled : null }); })()`);
  const ask = shown ? JSON.parse(shown) : null;
  note(`after a real click on the page's button: ask ${ask ? `role=${ask.role} "${ask.label}", button off at first: ${ask.off}` : "not shown"}`);
  chk.check("Kolux shows its own ask, naming the page's host", !!ask && ask.role === "alertdialog" && ask.label === `Open ${host} in your default browser?` && ask.text.includes(`${base}/sized-user`), shown ?? "none");
  const goText = await app.evalJs(`document.querySelector(${JSON.stringify(ASK)} + " [data-leave-go]")?.textContent ?? ""`);
  chk.check("its Open button names the host too", goText === `Open ${host}`, goText);
  await sleep(900);
  const armed = await app.evalJs(`document.querySelector(${JSON.stringify(ASK)} + " [data-leave-go]")?.disabled === false`);
  chk.check("its Open button turns on only after a moment", ask?.off === true && armed === true, `off at first ${ask?.off}, on later ${armed}`);
  await sleep(2000);
  const opened = hits.filter((p) => p === "/sized-user").length;
  note(`/sized-user requested ${opened} time(s) while the ask waits (a system browser or a popup window would request it)`);
  chk.check("nothing was opened on the page's word and the click", opened === 0, `count=${opened}`);

  await app.evalJs(`document.querySelector(${JSON.stringify(ASK)} + " [data-leave-cancel]")?.click()`);
  await sleep(800);
  chk.check("Cancel clears the ask", !(await app.exists(ASK)), "");
  await sleep(2000);
  chk.check("still nothing opened after Cancel", hits.filter((p) => p === "/sized-user").length === 0, "");

  // The page itself tries Kolux's certificate command (only "state" and "trust", never anything that opens a
  // program): Tauri must refuse an app command from a remote page, since no capability names one under remote.
  const bridge = await t.value(`(async () => {
    const i = window.__TAURI_INTERNALS__;
    if (!i || typeof i.invoke !== "function") return "no bridge in the page";
    const out = [];
    for (const action of ["state", "trust"]) {
      try { await i.invoke("browser_cert", { id: 0, url: location.href, action }); out.push(action + ": answered"); }
      catch (e) { out.push(action + ": refused (" + String(e?.message ?? e).slice(0, 120) + ")"); }
    }
    return out.join("; ");
  })()`);
  note(`the page calling browser_cert itself: ${bridge}`);
  chk.check("a page cannot reach Kolux's certificate command", typeof bridge === "string" && !bridge.includes("answered"), String(bridge));

  note("not proven live: a right-click menu pick (the menu needs the app window to hold the keyboard; a hidden window cannot); the pane test covers it");
  for (const r of held.splice(0)) r.writeHead(404).end();
  t.close();
  note(`all server requests: ${hits.join(" ")}`);
  note(`screenshot: ${await ctx.shot(`${ID}-end`)}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
for (const r of held.splice(0)) r.writeHead(404).end();
writeFileSync(`${ROOT}/evidence/T-661-live.txt`, [...lines, ...rep.lines.filter((l) => /^(PASS|FAIL) /.test(l))].map((l) => l.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>").replace(/[A-Za-z]:[\\/]+Temp[\\/]+[^\s"']*/gi, "<scratch>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")).join("\n") + "\n");
const code = ctx ? await finish(ctx, ID, rep.lines, ok) : 1;
srv.close();
process.exit(code);
