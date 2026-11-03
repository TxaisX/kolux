// LIVE proof, T-656 (R07-browser.6, DT-C92): extra headers and credentials set with `kolux set headers` / `kolux set credentials`
// go only to the site they were set for. Hidden dev app, scratch profile, two loopback sites on different ports (two origins),
// no real agent. Each site records the X-Token and Authorization headers of every request it gets.
// Run: node scripts/prove/live-T-656.mjs
import http from "node:http";
import { writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

const ID = "T-656";
const rep = reporter();
const { log } = rep;
const chk = checker(log);
const lines = [];
const note = (s) => { lines.push(s); log(s); };

const hits = [];
const site = (name, other) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/favicon.ico") return res.writeHead(404).end();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "cache-control": "no-store" };
    hits.push({ site: name, method: req.method, path: u.pathname, k: u.searchParams.get("k"), token: req.headers["x-token"] ?? null, auth: req.headers.authorization ?? null });
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (u.pathname === "/redir") return res.writeHead(302, { ...cors, location: `${other()}/landed?k=${u.searchParams.get("k")}` }).end();
    if (u.pathname !== "/page") return res.writeHead(200, { ...cors, "content-type": "text/plain" }).end("ok");
    // The page's own requests, named so `kolux eval` can start them without quoting: fetch and XHR to its own site, to the
    // other site, and through a same-site redirect to the other site.
    const page = `<!doctype html><meta charset=utf-8><title>site ${name}</title><p>site ${name}</p><script>
      const O = ${JSON.stringify(other())};
      const xhr = (u) => { const x = new XMLHttpRequest(); x.open("GET", u); x.send(); };
      window.both = (tag) => { fetch("/api?k=" + tag + "-fetch-self"); fetch(O + "/api?k=" + tag + "-fetch-other"); xhr("/api?k=" + tag + "-xhr-self"); xhr(O + "/api?k=" + tag + "-xhr-other"); return tag; };
      window.one = (tag) => { fetch("/api?k=" + tag); return tag; };
      window.redir = () => { fetch("/redir?k=redirect"); return "redir"; };
    </script>`;
    res.writeHead(200, { ...cors, "content-type": "text/html" }).end(page);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
};
let aBase = "", bBase = "";
const A = await site("A", () => bBase);
const B = await site("B", () => aBase);
aBase = `http://127.0.0.1:${A.address().port}`;
bBase = `http://127.0.0.1:${B.address().port}`;
const got = (k) => hits.filter((h) => h.k === k && h.method === "GET");
const shown = (k) => got(k).map((h) => `${h.site} token=${h.token ?? "-"} auth=${h.auth ? "Basic …" : "-"}`).join("; ") || "no request";

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

  const made = (await cli(`tab create --url ${aBase}/page`)).json;
  const page = Number(made?.page ?? made?.id ?? made?.tab?.page ?? NaN);
  note(`site A ${aBase}, site B ${bBase}; browser tab ${page} on A`);
  await sleep(3000);
  const hdr = await cli(`set headers --headers '{\\"X-Token\\":\\"t656-secret\\"}' --page ${page}`);
  const cred = await cli(`set credentials --user me --pass t656-pass --page ${page}`);
  note(`set headers: ${hdr.json?.summary ?? hdr.raw.trim()}; set credentials: ${cred.json?.summary ?? cred.raw.trim()}`);
  chk.check("both set commands record site A", hdr.json?.origin === aBase && cred.json?.origin === aBase, `${hdr.json?.origin} / ${cred.json?.origin}`);
  const wait = (keys) => poll(() => keys.every((k) => got(k).length > 0), 8000, 200);

  // 1. On A: fetch and XHR to A carry both; to B carry neither.
  await cli(`eval --expression "both('onA')" --page ${page}`);
  await wait(["onA-fetch-self", "onA-fetch-other", "onA-xhr-self", "onA-xhr-other"]);
  for (const k of ["onA-fetch-self", "onA-xhr-self", "onA-fetch-other", "onA-xhr-other"]) note(`${k}: ${shown(k)}`);
  const self = ["onA-fetch-self", "onA-xhr-self"].every((k) => got(k).length && got(k).every((h) => h.site === "A" && h.token === "t656-secret" && /^Basic /.test(h.auth ?? "")));
  const other = ["onA-fetch-other", "onA-xhr-other"].every((k) => got(k).length && got(k).every((h) => h.site === "B" && !h.token && !h.auth));
  chk.check("a page on A: fetch and XHR to A carry the header and credentials", self, "see lines above");
  chk.check("a page on A: fetch and XHR to B carry neither", other, "see lines above");
  chk.check("no preflight reached B for the header (nothing extra was added)", !hits.some((h) => h.site === "B" && h.method === "OPTIONS"), JSON.stringify(hits.filter((h) => h.method === "OPTIONS")));

  // 2. A same-site request that A redirects to B.
  await cli(`eval --expression "redir()" --page ${page}`);
  await wait(["redirect"]);
  note(`redirect A /redir -> B /landed: ${shown("redirect")}`);
  const landed = got("redirect").find((h) => h.path === "/landed");
  note(`  at B after the redirect: token ${landed?.token ? "sent" : "not sent"}, Authorization ${landed?.auth ? "sent" : "not sent"} (DT-C92: the engine's redirect rule)`);

  // 3. The tab goes to B: nothing is sent from B's page, to B or to A.
  await cli(`goto --url ${bBase}/page --page ${page}`);
  await sleep(3000);
  await cli(`eval --expression "both('onB')" --page ${page}`);
  await wait(["onB-fetch-self", "onB-fetch-other", "onB-xhr-self", "onB-xhr-other"]);
  for (const k of ["onB-fetch-self", "onB-xhr-self", "onB-fetch-other", "onB-xhr-other"]) note(`${k}: ${shown(k)}`);
  chk.check("a page on B sends neither, to B or to A", ["onB-fetch-self", "onB-xhr-self", "onB-fetch-other", "onB-xhr-other"].every((k) => got(k).length && got(k).every((h) => !h.token && !h.auth)), "see lines above");

  // 4. Back on A: still stored, sent again.
  await cli(`goto --url ${aBase}/page --page ${page}`);
  await sleep(3000);
  await cli(`eval --expression "one('back')" --page ${page}`);
  await wait(["back"]);
  note(`back on A: ${shown("back")}`);
  chk.check("back on A the stored header and credentials are sent again", got("back").every((h) => h.token === "t656-secret" && /^Basic /.test(h.auth ?? "")) && got("back").length > 0, shown("back"));

  // 5. Clearing the headers still works.
  await cli(`set headers --headers '{}' --page ${page}`);
  await cli(`eval --expression "one('cleared')" --page ${page}`);
  await wait(["cleared"]);
  note(`after set headers --headers {}: ${shown("cleared")}`);
  chk.check("after clearing, the header is gone (credentials stay)", got("cleared").length > 0 && got("cleared").every((h) => !h.token && /^Basic /.test(h.auth ?? "")), shown("cleared"));
  note(`screenshot: ${await ctx.shot(`${ID}-end`)}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
writeFileSync(`${ROOT}/evidence/T-656-live.txt`, [...lines, ...rep.lines.filter((l) => /^(PASS|FAIL) /.test(l))].map((l) => l.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>")).join("\n") + "\n");
const code = ctx ? await finish(ctx, ID, rep.lines, ok) : 1;
A.close();
B.close();
process.exit(code);
