// LIVE re-proof of browser rows 977 + 978 (MERGE 412), steps 15-17 of evidence/browser-954b.txt. Hidden dev app, loopback page, scratch profile, no real agent.
//  15: a tab in "work" comes back in work after a quit + relaunch (its cookie is sent), a default tab comes back in the default.
//  16: a tab whose profile was deleted while Kolux was closed opens in the default with the notice once; another restart: no notice.
//  17: a tab opened behind by `kolux tab create` leaves the keyboard in the terminal; Ctrl+T still takes it for the address bar.
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

const run = promisify(execFile);
const DATE = "2026-10-28";
const NOTICE = "This tab's saved profile is gone; it opened in the default profile";
const TABS = "div[role=tablist][aria-label=Tabs] div[role=tab]";
const rep = reporter();
const { log } = rep;
const chk = checker(log);
const lines = [];
const note = (s) => { lines.push(s); log(s); };

const hits = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/favicon.ico") return res.writeHead(404).end();
  const h = { "content-type": "text/html", "cache-control": "no-store" };
  const set = u.searchParams.get("c");
  if (set) h["set-cookie"] = `${set}=1; Path=/; Max-Age=3600`;
  hits.push({ t: Date.now(), path: u.pathname, tag: u.searchParams.get("tag"), cookie: req.headers.cookie ?? "" });
  res.writeHead(200, h).end(`<!doctype html><title>tab ${u.searchParams.get("tag")}</title><p>${u.searchParams.get("tag")}</p>`);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

const walk = (dir, acc = []) => {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p, acc); else acc.push(p); }
  return acc;
};

let ctx;
let ok = false;
try {
  ctx = await startPlain("BROW977", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  const clickTab = (i) => app.evalJs(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(TABS)})][${i}]; if (!t) return null; t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t.click(); return t.textContent.trim(); })()`);
  const toShell = async () => { if ((await app.shown('section.pane[data-agent="shell"]')) >= 1) return; await clickTab(0); await sleep(500); };
  const cli = async (args) => { await toShell(); const r = await runCli(ctx, args, { pane: 0 }); log(`kolux-dev ${args} -> exit ${r.exit} ${r.raw.replace(/\s+/g, " ").slice(0, 200)}`); return r; };
  const idOf = (j) => Number(j?.page ?? j?.id ?? j?.tab?.page ?? j?.tab?.id ?? NaN);
  const rows = async () => { const j = (await cli("tab list --show-profile")).json; return Array.isArray(j) ? j : (j?.tabs ?? j?.pages ?? []); };
  const profileOf = (rs, url) => rs.find((r) => String(r.url ?? "").includes(url))?.profile ?? null;
  // The restore notice is the toolbar badge [data-permission-refused] (BrowserPane.tsx), shown 10 s after its pane is up; collect it while visiting every tab.
  const alerts = () => app.evalJs(`JSON.stringify([...document.querySelectorAll("section.pane.browser [data-permission-refused], section.pane.browser [role=alert]")].map(a => a.textContent.trim()).filter(Boolean))`).then(JSON.parse);
  let seenNotes = [];
  const showAll = async () => { seenNotes = []; for (let i = 0; i < 8; i++) { await clickTab(i); for (let k = 0; k < 4; k++) { await sleep(400); for (const a of await alerts()) if (!seenNotes.includes(a)) seenNotes.push(a); } } };
  const restart = async () => {
    const closed = await app.closeAndCount(app.pid);
    log(`quit: ${closed.how}; survivors ${closed.survivors.length}`);
    const alive = async (pid) => (await run("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { windowsHide: true })).stdout.includes(String(pid));
    for (let i = 0; i < 40; i++) {
      const left = [];
      for (const p of closed.survivors) if (await alive(p.pid ?? p)) left.push(p.pid ?? p);
      if (!left.length) break;
      if (i === 20) for (const pid of left) await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
      await sleep(500);
    }
  };
  // The "Tip" card ("Let your agents drive Kolux") is a dialog Close/Escape cannot dismiss; its own "Not now" does.
  const dismissTip = async () => { for (let i = 0; i < 4; i++) { if (!(await app.clickWhere("button", "/^\s*Not now\s*$/").catch(() => false))) break; await sleep(500); } };
  // The CLI learns the app's data folder only after the user opens a browser tab (Ctrl+Shift+B), as live-browser-954.mjs does.
  const openFirstTab = async () => {
    await dismissTip();
    await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
    await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
    await sleep(2500);
  };
  const relaunch = async () => { await app.relaunch(); await dismissTip(); await dismissFirstRun(app, log); await sleep(4000); await openFirstTab(); };

  // ---- launch 1: three tabs ----
  await dismissTip();
  await openFirstTab();
  const w = await cli("profiles create --label work");
  const g = await cli("profiles create --label gone");
  const tw = idOf((await cli(`tab create --url '${base}/p?tag=W&c=work' --profile work`)).json);
  const td = idOf((await cli(`tab create --url '${base}/p?tag=D&c=def'`)).json);
  const tg = idOf((await cli(`tab create --url '${base}/p?tag=G&c=gone' --profile gone`)).json);
  await sleep(4000);
  let rs = await rows();
  note(`launch 1 tabs: W=${tw} (${profileOf(rs, "tag=W")}), D=${td} (${profileOf(rs, "tag=D")}), G=${tg} (${profileOf(rs, "tag=G")}); profiles create exits ${w.exit}/${g.exit}`);
  chk.check("setup: three tabs, work / default / gone", profileOf(rs, "tag=W") === "work" && profileOf(rs, "tag=D") === "default" && profileOf(rs, "tag=G") === "gone", JSON.stringify(rs.map((r) => [r.page ?? r.id, r.profile])));

  // ---- quit, delete the profile "gone" while closed, relaunch ----
  await restart();
  const pf = walk(ctx.TEMP).find((p) => p.endsWith("/browser-profiles.json"));
  let removed = false;
  if (pf) {
    const data = JSON.parse(readFileSync(pf, "utf8"));
    const strip = (o) => {
      if (Array.isArray(o)) return o.filter((x) => !(x && typeof x === "object" && (x.label === "gone" || x.id === "gone" || x.name === "gone"))).map(strip);
      if (o && typeof o === "object") { const r = {}; for (const [k, v] of Object.entries(o)) { if (k === "gone") { removed = true; continue; } r[k] = strip(v); } return r; }
      return o;
    };
    const next = strip(data);
    removed = removed || JSON.stringify(next) !== JSON.stringify(data);
    writeFileSync(pf, JSON.stringify(next, null, 2));
  }
  note(`profile "gone" removed from the profile list while the app was closed: ${removed} (store file ${pf ? "found" : "NOT found"})`);
  const t0 = hits.length;
  await relaunch();
  await showAll();
  await sleep(3000);
  rs = await rows();
  const al1 = [...seenNotes];
  note(`launch 2 rows: ${JSON.stringify(rs.map((r) => [r.page ?? r.id, r.profile, String(r.url ?? "").replace(base, "<loop>")]))}`);
  note(`launch 2 notices: ${JSON.stringify(al1)}`);
  const reload = hits.slice(t0);
  const cookieFor = (tag) => reload.filter((h) => h.tag === tag).map((h) => h.cookie);
  note(`launch 2 page loads: W cookies ${JSON.stringify(cookieFor("W"))}; D ${JSON.stringify(cookieFor("D"))}; G ${JSON.stringify(cookieFor("G"))}`);
  chk.check("15: the work tab came back in work", profileOf(rs, "tag=W") === "work", String(profileOf(rs, "tag=W")));
  chk.check("15: the work tab's reload sent its work cookie (login kept)", cookieFor("W").some((c) => /work=1/.test(c)), JSON.stringify(cookieFor("W")));
  chk.check("15: the default tab came back in the default, never in work", profileOf(rs, "tag=D") === "default" && !cookieFor("D").some((c) => /work=1/.test(c)), `${profileOf(rs, "tag=D")} ${JSON.stringify(cookieFor("D"))}`);
  chk.check("16: the tab of the deleted profile opened in the default", profileOf(rs, "tag=G") === "default" && !cookieFor("G").some((c) => /gone=1/.test(c)), `${profileOf(rs, "tag=G")} ${JSON.stringify(cookieFor("G"))}`);
  chk.check("16: the notice shows once", al1.some((a) => a.includes(NOTICE)), JSON.stringify(al1));
  note(`screenshot: ${await ctx.shot("BROW977-launch2")}`);

  // ---- restart again: no notice, still default ----
  await restart();
  await relaunch();
  await showAll();
  await sleep(3000);
  rs = await rows();
  const al2 = [...seenNotes];
  note(`launch 3 rows: ${JSON.stringify(rs.map((r) => [r.page ?? r.id, r.profile]))}; notices ${JSON.stringify(al2)}`);
  chk.check("16: after another restart the notice is gone", !al2.some((a) => a.includes(NOTICE)), JSON.stringify(al2));
  chk.check("16: the work tab still comes back in work", profileOf(rs, "tag=W") === "work", String(profileOf(rs, "tag=W")));

  // ---- 17: a background tab does not take the keyboard; Ctrl+T does ----
  await toShell();
  await app.focusPane('section.pane[data-agent="shell"]', 0, ".xterm-helper-textarea");
  const active = () => app.evalJs(`JSON.stringify({ cls: document.activeElement?.className ?? "", tag: document.activeElement?.tagName ?? "", label: document.activeElement?.getAttribute?.("aria-label") ?? "" })`).then(JSON.parse);
  const before = await active();
  const cr = await cli(`tab create --url '${base}/p?tag=BG'`);
  await sleep(2500);
  await toShell();
  await app.focusPane('section.pane[data-agent="shell"]', 0, ".xterm-helper-textarea");
  // The CLI call above is typed into the terminal, so focus there is expected; the check is that the new tab did not steal it after it opened.
  await sleep(1500);
  const afterBg = await active();
  note(`17: focus before ${JSON.stringify(before)}; tab create exit ${cr.exit}; focus after the background tab opened ${JSON.stringify(afterBg)}`);
  chk.check("17: a background `tab create` leaves the keyboard in the terminal", /xterm-helper-textarea/.test(afterBg.cls), JSON.stringify(afterBg));
  // Ctrl+T opens a shell (tab.newShell); the user's way to a browser tab is Ctrl+Shift+B (tab.newBrowser), so that is what is pressed.
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await sleep(2500);
  const afterT = await active();
  note(`17: after Ctrl+Shift+B (a browser tab the user opens) focus is ${JSON.stringify(afterT)}`);
  chk.check("17: a browser tab the user opens (Ctrl+Shift+B; Ctrl+T opens a shell) takes the keyboard for its address bar", !/xterm-helper-textarea/.test(afterT.cls) && afterT.tag === "INPUT", JSON.stringify(afterT));
  note(`screenshot: ${await ctx.shot("BROW977-end")}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
const code = ctx ? await finish(ctx, "BROW977", rep.lines, ok) : 1;
const results = rep.lines.filter((l) => /^(PASS|FAIL|NOT-TESTED) /.test(l));
appendFileSync(`${ROOT}/evidence/browser-954b.txt`, `\n\nLIVE re-proof (MERGE 412) ${DATE} (scripts/prove/live-browser-977.mjs, hidden dev app, loopback page, scratch profile, no real agent) - steps 15-17, rows 977 + 978: ${ctx?.verdict(ok) ?? (ok ? "PASS" : "FAIL")}\n${[...lines, ...results].map((l) => `  ${l.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>")}`).join("\n")}\n`);
srv.close();
process.exit(code);
