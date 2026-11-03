// LIVE proof, T-657 (R07-browser.3, DT-C93): a page opens no tab, popup window or system-browser window on its own. A page
// whose timers keep calling window.open (plain and sized) and keep sending the app's own menu-pick and open-link requests opens
// nothing; a real click still opens one tab. Hidden dev app (off-screen), scratch
// profile, one loopback site that records every request. Clicks are real input (CDP Input events), as the other browser proofs.
// Run: node scripts/prove/live-T-657.mjs
import http from "node:http";
import { writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, checker } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

const ID = "T-657";
const rep = reporter();
const { log } = rep;
const chk = checker(log);
const lines = [];
const note = (s) => { lines.push(s); log(s); };

const hits = [];
const srv = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/favicon.ico") return res.writeHead(404).end();
  hits.push(path);
  if (path !== "/page") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  // Every 1.5 s, with no user behind it: a plain window.open, a sized one (a popup window), a menu pick for "open in Kolux"
  // and one for "open in the default browser", and an open-link request. A button opens one window when clicked.
  res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><meta charset=utf-8><title>timers</title>
  <button id=go style="position:fixed;left:20px;top:20px;width:160px;height:40px">go</button>
  <a id=lnk href="/user-linked" style="position:fixed;left:20px;top:80px;width:160px;height:40px;display:block">link</a>
  <script>
    const B = location.origin, enc = encodeURIComponent;
    let n = 0;
    document.getElementById("go").onclick = () => window.open("/clicked-open", "_blank");
    // The same way the app's own page script sends them.
    const send = (what) => location.assign("kolux-chord:" + what);
    window.T = setInterval(() => {
      const k = n++;
      window.open("/tick-" + k, "_blank");
      window.open("/sized-" + k, "_blank", "width=320,height=320");
      if (k % 2 === 0) send("pick?what=open-kolux&u=" + enc(B + "/picked-kolux-" + k));
      else send("pick?what=open-default&u=" + enc(B + "/picked-default-" + k));
      setTimeout(() => send("open-front?u=" + enc(B + "/linked-" + k)), 700);
    }, 1500);
  </script>`);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const forged = () => hits.filter((p) => /^\/(tick|sized|picked|linked)-/.test(p));

// The page's own DevTools target (exact address: the tabs a failure would open share the prefix).
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
  // Runtime.evaluate runs without a user gesture (it reads the page; it cannot stand in for a click).
  const value = async (expr) => (await call("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value;
  const click = async (x, y, button = "left", modifiers = 0) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x, y, modifiers, button: type === "mouseMoved" ? "none" : button, clickCount: 1 });
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
  // The CLI learns the app's data folder once a browser tab is open (Ctrl+Shift+B), as the other browser proofs do.
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
  await sleep(2500);

  const made = (await cli(`tab create --url ${base}/page`)).json;
  note(`site ${base}; browser tab ${made?.page ?? made?.id ?? "?"} on /page, its timers running from the first load`);
  await sleep(12000);
  const t = await tabCdp(`${base}/page`);
  const fired = await t.value("n");
  note(`after 12 s idle: the page's timer ran ${fired} times (${fired * 5} requests); server saw: ${forged().join(" ") || "none of them"}`);
  chk.check("the page's timers ran (the requests were made)", fired >= 6, `n=${fired}`);
  chk.check("no window, tab or system-browser window opened without the user", forged().length === 0, forged().join(" "));
  const tabsBefore = await app.evalJs(`document.querySelectorAll(${JSON.stringify(TABS)}).length`);

  // Stop the timers (no gesture) so the click below is the only user action in the page.
  await t.value("clearInterval(window.T), 'stopped'");
  await sleep(1600);
  // First a real Ctrl+click on a link (it opens behind, so this page stays on screen for the button below): the app's
  // page script sends the same kind of open-link request the timers forged, so this one opening a tab shows those
  // requests reach the app and the engine's word is what dropped them.
  const lnk = JSON.parse(await t.value(`JSON.stringify(document.getElementById("lnk").getBoundingClientRect())`));
  await t.click(lnk.x + 10, lnk.y + 10, "left", 2);
  await sleep(3000);
  const tabsLinked = await app.evalJs(`document.querySelectorAll(${JSON.stringify(TABS)}).length`);
  const linked = hits.filter((p) => p === "/user-linked").length;
  note(`after a real Ctrl+click on a link: app tabs ${tabsBefore} -> ${tabsLinked}, /user-linked requested ${linked} time(s)`);
  chk.check("a real link click still opens exactly one tab", tabsLinked === tabsBefore + 1 && linked <= 1, `tabs ${tabsBefore} -> ${tabsLinked}`);
  // The new tab may take the screen; a tab that is not on screen opens nothing, so bring the page back first.
  await cli(`tab switch --index ${made?.page ?? made?.id}`);
  await sleep(1000);
  const go = JSON.parse(await t.value(`JSON.stringify(document.getElementById("go").getBoundingClientRect())`));
  await t.click(go.x + 10, go.y + 10);
  await sleep(3000);
  const clicked = hits.filter((p) => p === "/clicked-open").length;
  note(`after a real click on the page's button: /clicked-open requested ${clicked} time(s)`);
  chk.check("a real click still opens exactly one tab", clicked === 1, `count=${clicked}`);

  // Not run here: a real right-click menu pick. The app opens its menu only while its window holds the keyboard at the
  // system level (council FIX-4), which a hidden off-screen window never does; the Rust tests cover a user-started pick.
  note("not proven live: a real right-click menu pick (the menu needs the app window to hold the keyboard; a hidden window cannot)");
  const tabsAfter = await app.evalJs(`document.querySelectorAll(${JSON.stringify(TABS)}).length`);
  note(`app tabs: ${tabsBefore} before the two clicks, ${tabsAfter} after`);
  chk.check("still nothing from the timers", forged().length === 0, forged().join(" "));
  t.close();
  note(`all server requests: ${hits.join(" ")}`);
  note(`screenshot: ${await ctx.shot(`${ID}-end`)}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
writeFileSync(`${ROOT}/evidence/T-657-live.txt`, [...lines, ...rep.lines.filter((l) => /^(PASS|FAIL) /.test(l))].map((l) => l.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>")).join("\n") + "\n");
const code = ctx ? await finish(ctx, ID, rep.lines, ok) : 1;
srv.close();
process.exit(code);
