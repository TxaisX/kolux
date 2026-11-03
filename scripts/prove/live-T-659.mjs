// LIVE proof, T-659 (X-sec.3, R07-browser.4, DT-C94): the built-in preview server shows only documents from a folder
// open in Kolux, its addresses carry a random token, and it answers only its own loopback name. Hidden dev app
// (off-screen), scratch profile; the opened project is the scratch repo, and one folder outside it sits under
// G:/Temp/live-90. Requests to the server are plain HTTP from this script, with the Host line it chooses.
// Run: node scripts/prove/live-T-659.mjs
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { reporter, startPlain, finish, sleep, checker } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

const ID = "T-659";
const rep = reporter();
const { log } = rep;
const chk = checker(log);
const lines = [];
const note = (s) => { lines.push(s); log(s); };

const OUT = "G:/Temp/live-90/outside";
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, "<!doctype html><title>outside</title><p>outside every open folder</p>\n");
const PAGE = "<!doctype html><meta charset=utf-8><title>inside</title><p>inside the open project</p>\n";

// One request to the preview server, with the Host line given (or none).
const ask = (port, path, host) => new Promise((resolve) => {
  const headers = host === undefined ? {} : { Host: host };
  const req = http.request({ host: "127.0.0.1", port, path, headers, setHost: false }, (res) => {
    let body = "";
    res.on("data", (d) => (body += d));
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", (e) => resolve({ status: 0, body: String(e) }));
  req.end();
});

let ctx;
let ok = false;
try {
  ctx = await startPlain(ID, { report: rep, files: { "notes.txt": "live\n", "site/index.html": PAGE } });
  const { app } = ctx;
  await sleep(3000);
  const TABS = "div[role=tablist][aria-label=Tabs] div[role=tab]";
  const toShell = async () => {
    if ((await app.shown('section.pane[data-agent="shell"]')) >= 1) return;
    await app.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(TABS)}); t?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t?.click(); })()`);
    await sleep(500);
  };
  const cli = async (args) => { await toShell(); const r = await runCli(ctx, args, { pane: 0 }); log(`kolux-dev ${args} -> exit ${r.exit} ${r.raw.replace(/\s+/g, " ").slice(0, 260)}`); return r; };
  for (let i = 0; i < 4; i++) { if (!(await app.clickWhere("button", "/^\\s*Not now\\s*$/").catch(() => false))) break; await sleep(500); }
  await dismissFirstRun(app, log);
  // The CLI learns the app's data folder once a browser tab is open (Ctrl+Shift+B), as the other browser proofs do.
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
  await sleep(2500);

  // 1. Outside every open folder: refused, through the CLI and through the app's own command.
  const outside = await cli(`tab create --url ${OUT}/index.html`);
  const outsideText = outside.raw.replace(/\s+/g, " ");
  note(`a document outside every open folder, by the CLI: exit ${outside.exit}`);
  chk.check("a document outside every open folder is not previewed (CLI)", outside.exit !== 0 && /not inside a project or workspace open in Kolux/.test(outsideText), outsideText.slice(0, 200));
  const viaApp = await app.evalJs(`(async () => { const inv = window.__TAURI_INTERNALS__?.invoke; if (!inv) return "no invoke"; try { return JSON.stringify(await inv("browser_preview", { path: ${JSON.stringify(`${OUT}/index.html`)} })); } catch (e) { return "refused: " + e; } })()`);
  note(`the same document through the app's own preview command: ${String(viaApp).replace(/[A-Za-z]:[\\/]+[^ ]*live-90/gi, "<scratch>").slice(0, 200)}`);
  chk.check("a document outside every open folder is not previewed (app command)", /^refused: .*not inside a project or workspace open in Kolux/.test(String(viaApp)), String(viaApp).slice(0, 200));

  // 2. Inside the opened project: previewed, with a 128-bit random token.
  const inside = await cli(`tab create --url ${ctx.repo}/site/index.html`);
  const url = inside.json?.url ?? "";
  const m = /^http:\/\/127\.0\.0\.1:(\d+)\/([0-9a-f]+)\/index\.html$/.exec(url);
  note(`a document inside the opened project: exit ${inside.exit}, address http://127.0.0.1:<port>/<${m?.[2]?.length ?? 0} hex>/index.html`);
  chk.check("a document inside the opened project is previewed", inside.exit === 0 && !!m, url);
  const port = Number(m?.[1]);
  const token = m?.[2] ?? "";
  chk.check("its token is 32 hex characters (128 bits)", token.length === 32, `length ${token.length}`);
  const again = await app.evalJs(`(async () => JSON.stringify(await window.__TAURI_INTERNALS__.invoke("browser_preview", { path: ${JSON.stringify(`${ctx.repo}/site/index.html`)} })))()`);
  chk.check("the same folder keeps its address for the run", JSON.parse(again).url === url, String(again).slice(0, 120));

  // 3. Who the server answers.
  const path = `/${token}/index.html`;
  const good = await ask(port, path, `127.0.0.1:${port}`);
  const local = await ask(port, path, `localhost:${port}`);
  const rebound = await ask(port, path, `rebound.example:${port}`);
  const wrongPort = await ask(port, path, `127.0.0.1:${port + 1}`);
  note(`Host 127.0.0.1:<port> -> ${good.status}; localhost:<port> -> ${local.status}; rebound.example:<port> -> ${rebound.status} "${rebound.body}"; 127.0.0.1:<other port> -> ${wrongPort.status}`);
  chk.check("its own loopback address gets the document", good.status === 200 && /inside the open project/.test(good.body), `${good.status}`);
  chk.check("localhost with its port gets the document", local.status === 200, `${local.status}`);
  chk.check("another host name gets 403 and no document", rebound.status === 403 && !/inside the open project/.test(rebound.body), `${rebound.status}`);
  chk.check("another port in the Host line gets 403", wrongPort.status === 403, `${wrongPort.status}`);
  const guess = await ask(port, `/${"0".repeat(16)}/index.html`, `127.0.0.1:${port}`);
  const flipped = await ask(port, `/${token.slice(0, 31)}${token[31] === "0" ? "1" : "0"}/index.html`, `127.0.0.1:${port}`);
  note(`a 16-hex token of the old shape -> ${guess.status}; the real token with its last character changed -> ${flipped.status}`);
  chk.check("a token the server did not issue reaches nothing", guess.status === 404 && flipped.status === 404, `${guess.status} ${flipped.status}`);

  // 4. The folder of the outside document can never be allowed: it has no preview to allow. The opened one can.
  const granted = await app.evalJs(`(async () => { try { await window.__TAURI_INTERNALS__.invoke("browser_preview_grant", { url: ${JSON.stringify(url)} }); return "allowed"; } catch (e) { return "refused: " + e; } })()`);
  note(`allowing the opened project's folder for its preview: ${granted}`);
  chk.check("the opened project's folder can still be allowed", granted === "allowed", String(granted));
  note(`screenshot: ${await ctx.shot(`${ID}-end`)}`);
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
writeFileSync(`${ROOT}/evidence/T-659-live.txt`, [...lines, ...rep.lines.filter((l) => /^(PASS|FAIL) /.test(l))].map((l) => l.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>").replace(/[A-Za-z]:[\\/]+Temp[\\/]+[^\s"']*/gi, "<scratch>")).join("\n") + "\n");
const code = ctx ? await finish(ctx, ID, rep.lines, ok) : 1;
process.exit(code);
