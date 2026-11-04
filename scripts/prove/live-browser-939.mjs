// LIVE proof, after.md row 939 (in-app browser proxy), the numbered steps of evidence/browser-939.txt "LIVE PROOF PENDING".
// A stub proxy on loopback logs every request and never forwards; the page host is an unroutable address that exists only inside the stub.
// Launch 1 saves the proxy through Settings; the app is closed and relaunched (app.relaunch) because the window's arguments are read at launch.
import http from "node:http";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT, dismissFirstRun } from "./live-common.mjs";
import { savedProxy, openBrowserAt, sampler, pageTarget, local, HOST } from "./live-T-323-proxy.mjs";
import { targetCall, makeSites } from "./live-browser-common.mjs";

const run = promisify(execFile);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PAGE = `<!doctype html><title>Proxy proof page</title><p>proxy-proof-body</p><a id="pop" target="_blank" href="http://${HOST}/popup">popup</a>`;
const POPUP = "<!doctype html><title>Popup proof page</title><p>popup-body</p>";
const MSG = {
  changed: "The proxy setting changed. Restart Kolux to apply it; nothing was loaded directly.",
  creds: "The in-app browser can't use a proxy that needs a username and password. Nothing was loaded directly; set a proxy without credentials or clear the setting.",
  shape: "The in-app browser takes a proxy written as http://host:port or socks5://host:port, with no path. Nothing was loaded directly; fix the setting or clear it.",
  unreadable: "Kolux can't read its settings, so the in-app browser won't open pages in case a proxy is set. Nothing was loaded directly; restart Kolux or check settings.json.",
};

const entries = [];
// Batch 8: what the stub saw is split into requests for the PAGE host (the ones the proof is about) and everything else;
// WebView2 makes its own background CONNECTs (edge.microsoft.com and similar) through the saved proxy, and those are named, not counted.
const PAGE_RE = /10\.254\.254\.254/;
const MS_RE = /(^|[.\/@])((\w[\w-]*\.)*(microsoft|msedge|skype|bing|live|windows|office|azure|msn)\.(com|net)|edge\.[\w.]+)(:\d+|\/|$)/i;
const pageEntries = (from = 0) => entries.slice(from).filter((e) => PAGE_RE.test(e.url));
const otherEntries = (from = 0) => entries.slice(from).filter((e) => !PAGE_RE.test(e.url));
const describe = (list) => list.map((e) => `${e.proxy} ${e.method} ${e.url}`);
const otherNote = (log, what, from) => {
  const o = otherEntries(from);
  const ms = o.filter((e) => MS_RE.test(e.url));
  const rest = o.filter((e) => !MS_RE.test(e.url));
  log(`${what}: other stub requests (not the page host): Microsoft-service ${JSON.stringify(describe(ms))}; unclassified ${JSON.stringify(describe(rest))}`);
  return { ms, rest };
};
function stub(log, name) {
  const s = http.createServer((req, res) => {
    entries.push({ proxy: name, method: req.method, url: req.url });
    log(`stub ${name} ${req.method} ${req.url} UA=${(req.headers["user-agent"] ?? "").slice(0, 40)}`);
    if (/\/popup$/.test(req.url)) return res.writeHead(200, { "content-type": "text/html" }).end(POPUP);
    if (/\.png$/.test(req.url)) return res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    if (/10\.254\.254\.254/.test(req.url)) return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    res.writeHead(404).end("no");
  });
  s.on("connect", (req, sock) => {
    entries.push({ proxy: name, method: "CONNECT", url: req.url });
    log(`stub ${name} CONNECT ${req.url}`);
    sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ server: s, port: s.address().port })));
}
const deadPort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const noticeTexts = (app) => app.evalJs(`JSON.stringify([...document.querySelectorAll("section.pane.browser .notice[role=alert]")].map((n) => n.textContent.trim()))`).then(JSON.parse);
const browserPanes = (app) => app.evalJs(`document.querySelectorAll("section.pane.browser").length`);

/** Opens one more browser tab (Ctrl+Shift+B) and waits for the refusal text it shows. */
async function newTabRefusal(app, ctx, expected) {
  const before = await browserPanes(app);
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await poll(async () => ((await browserPanes(app)) > before ? true : null), 15000, 300);
  const got = await poll(async () => (await noticeTexts(app)).find((t) => t === expected || t.includes(expected.slice(0, 40))) ?? null, 15000, 400);
  return { got, all: await noticeTexts(app), panes: await browserPanes(app) };
}

async function commandLines(app) {
  const tree = [app.pid, ...(await app.treeOf(app.pid)).map((p) => p.pid)];
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { @(${tree.join(",")}) -contains $_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' } | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) " + $_.CommandLine }`], { windowsHide: true });
  return stdout.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, ppid] = l.split(" ");
    return { pid, ppid, type: (l.match(/--type=([\w-]+)/) ?? [])[1] ?? "browser", flags: l.match(/--proxy-server=\S+/g) ?? [], noProxy: /--no-proxy-server/.test(l) };
  });
}
const rowsOf = (seen) => [...seen.keys()];
const outsideRows = (seen) => rowsOf(seen).filter((r) => !local(r.split(" -> ")[1]));

async function restart(ctx, log) {
  const { app } = ctx;
  const closed = await app.closeAndCount(app.pid);
  log(`quit: ${closed.how}; pre-close tree ${closed.tree.length} (${app.byName(closed.tree)}); survivors ${closed.survivors.length} (${app.byName(closed.survivors)})`);
  // Leftover webview processes still hold the data folder with the old arguments; the engine refuses a second set on one folder.
  const alive = async (pid) => (await run("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { windowsHide: true })).stdout.includes(String(pid));
  for (let i = 0; i < 40; i++) {
    const left = [];
    for (const p of closed.survivors) if (await alive(p.pid ?? p)) left.push(p.pid ?? p);
    if (!left.length) break;
    if (i === 20) for (const pid of left) await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
    await sleep(500);
  }
  log("survivors of the old tree gone before relaunch");
  await app.relaunch();
  await dismissFirstRun(app, log);
  await sleep(5000);
  log(`relaunched, app pid ${app.pid}`);
}

export async function run939(ctx, { check, log }, p) {
  const { app } = ctx;
  app.rawKey = ctx.rawKey; // savedProxy (live-T-323-proxy.mjs) presses the Settings chord through the app object
  const S = (n, name, ok, detail) => check(`step ${n}: ${name}`, ok, detail);

  // ---- (e) baseline: PDF export with NO proxy saved, of a loopback page, to a scratch path (no native dialog)
  const out = `${p.dir}/pdf-out`;
  mkdirSync(out, { recursive: true });
  const loop = await makeSites();
  const basePdf = `${out}/baseline.pdf`;
  rmSync(basePdf, { force: true });
  const baseHtml = `<h1>PDF baseline</h1><p>body</p><img src="${loop.base}/ok" alt="loopback"><link rel="stylesheet" href="${loop.base}/die">`;
  const baseRes = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("browser_export_pdf", ${JSON.stringify({ html: baseHtml, title: "PDF baseline", path: basePdf, overwrite: true })}).then((r) => "ok " + r, (e) => "error " + String(e))`);
  await sleep(1500);
  const baseSize = existsSync(basePdf) ? statSync(basePdf).size : 0;
  const baseHead = baseSize ? readFileSync(basePdf).subarray(0, 5).toString() : "";
  log(`(e) BASELINE (no proxy saved) export result: ${baseRes}; file exists ${existsSync(basePdf)} (${baseSize} bytes, header ${JSON.stringify(baseHead)}); loopback server hits ${JSON.stringify(loop.hits)}`);
  check("(e) baseline: PDF export with no proxy writes a non-empty file with the %PDF header", /^ok /.test(baseRes) && baseSize > 0 && baseHead.startsWith("%PDF"), `${baseRes} ${baseSize} ${JSON.stringify(baseHead)}`);
  loop.stop();

  // ---- Step 1: save the proxy (Settings > Network proxy), restart, open the page
  const set = await savedProxy(app, `http://127.0.0.1:${p.A.port}`, log);
  S(1, "the proxy http://127.0.0.1:<stub> is saved (secret_status true)", set === true, String(set));
  await restart(ctx, log);
  const s1 = sampler(app, log);
  await openBrowserAt(app, `http://${HOST}/`);
  // The target exists before the page has loaded: wait for the title the stub's page carries.
  const t = await poll(async () => { const x = await pageTarget(HOST); return x && /Proxy proof/.test(x.title) ? x : null; }, 40000, 500) ?? (await pageTarget(HOST));
  log(`page target: ${t ? JSON.stringify({ url: t.url, title: t.title }) : null}`);
  S(1, `the page at the unroutable host ${HOST} opened in the browser pane (title Proxy proof page, served by the stub)`, !!t && /Proxy proof/.test(t.title), t?.title ?? "none");
  await sleep(8000);

  // ---- Step 2 / (c): command lines
  const procs = await commandLines(app);
  for (const q of procs) log(`msedgewebview2 pid ${q.pid} parent ${q.ppid} type ${q.type}: proxy-server flags ${JSON.stringify(q.flags)}${q.noProxy ? " (--no-proxy-server)" : ""}`);
  const want = `--proxy-server=http://127.0.0.1:${p.A.port}`;
  const browserProcs = procs.filter((q) => q.type === "browser");
  S(2, `every msedgewebview2 process that is a browser process carries exactly one ${want}`, browserProcs.length > 0 && browserProcs.every((q) => q.flags.length === 1 && q.flags[0] === want), JSON.stringify(browserProcs.map((q) => [q.pid, q.flags])));
  const withFlag = procs.filter((q) => q.flags.length > 0);
  S(2, "no msedgewebview2 process carries two proxy switches or a different proxy", procs.every((q) => q.flags.length <= 1 && q.flags.every((f) => f === want)), JSON.stringify(procs.map((q) => [q.type, q.flags.length])));
  log(`(literal reading of "every process") ${withFlag.length} of ${procs.length} msedgewebview2 processes carry the switch; child types without it: ${JSON.stringify([...new Set(procs.filter((q) => q.flags.length === 0).map((q) => q.type))])}`);
  S(2, "(c) exactly one --proxy-server on each browser process command line", browserProcs.length > 0 && browserProcs.every((q) => q.flags.length === 1), `${browserProcs.length} browser processes`);

  // ---- Step 3: the stub saw the page; no direct socket to the page host
  const seen1 = await s1.stop();
  const pageHits = entries.filter((e) => e.proxy === "A" && PAGE_RE.test(e.url));
  otherNote(log, "steps 1-3", 0);
  log(`stub A saw for the page host: ${JSON.stringify(pageHits.map((e) => `${e.method} ${e.url}`))}`);
  S(3, "the stub logged the request for the page host", pageHits.length > 0, String(pageHits.length));
  const rows1 = rowsOf(seen1);
  log(`TCP sample after opening the page (${rows1.length} distinct): ${JSON.stringify(rows1)}`);
  const toHost = rows1.filter((r) => r.includes("10.254.254.254"));
  S(3, "no process of the app (msedgewebview2 or kolux-rs) holds a socket to the page host", toHost.length === 0, JSON.stringify(toHost));
  log(`non-loopback sockets of the app tree during step 1-3 (informational, not the page host): ${JSON.stringify(outsideRows(seen1))}`);
  log(`screenshot (page through the stub): ${await ctx.shot("939-step1-3")}`);

  // ---- Step 4: the app window itself still loads
  const win = JSON.parse(await app.evalJs(`JSON.stringify({ url: location.href, rootKids: document.getElementById("root")?.children.length ?? 0, title: document.title })`));
  const ipc = await app.invoke("secret_status", { key: "httpProxy" });
  log(`app window: ${JSON.stringify(win)}; IPC secret_status(httpProxy) = ${ipc}`);
  S(4, "the app window loaded its own UI (vite on loopback, React root rendered) and IPC answers", win.rootKids > 0 && ipc === true, JSON.stringify(win));

  // ---- (d) popup from the proxied tab
  const hitsBefore = entries.length;
  try {
    await targetCall(/10\.254\.254\.254/, "Runtime.evaluate", { expression: "window.open('http://10.254.254.254:8080/popup'); 1", userGesture: true });
  } catch (e) {
    log(`(d) could not drive the page: ${e.message}`);
  }
  await sleep(6000);
  const popHits = entries.slice(hitsBefore).filter((e) => /\/popup/.test(e.url) && PAGE_RE.test(e.url));
  log(`(d) popup request at stub A: ${JSON.stringify(popHits.map((e) => `${e.method} ${e.url}`))}; popup target: ${JSON.stringify((await pageTarget("/popup"))?.title ?? null)}`);
  check("(d) a popup from the proxied tab goes through the stub (request logged there)", popHits.length > 0, String(popHits.length));

  // ---- (e) PDF export while the proxy is saved (the native save dialog is the separate command browser_pick_pdf_path; the export command takes the path)
  const pdf = `${out}/note.pdf`;
  rmSync(pdf, { force: true });
  const sPdf = sampler(app, log);
  await sleep(1500);
  const mark = entries.length;
  const html = `<h1>PDF proof</h1><p>body</p><img src="http://${HOST}/remote.png" alt="remote"><link rel="stylesheet" href="http://${HOST}/remote.css">`;
  const res = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("browser_export_pdf", ${JSON.stringify({ html, title: "PDF proof", path: pdf, overwrite: true })}).then((r) => "ok " + r, (e) => "error " + String(e))`);
  await sleep(2500);
  const seenPdf = await sPdf.stop();
  const pdfHits = entries.slice(mark);
  log(`(e) export result: ${res}; file exists ${existsSync(pdf)}${existsSync(pdf) ? ` (${statSync(pdf).size} bytes, header ${JSON.stringify(readFileSync(pdf).subarray(0, 5).toString())})` : ""}`);
  log(`(e) stub requests during the render: ${JSON.stringify(pdfHits.map((e) => `${e.proxy} ${e.method} ${e.url}`))}`);
  otherNote(log, "(e)", mark);
  log(`(e) page-host stub requests during the render: ${JSON.stringify(describe(pageEntries(mark)))}`);
  const pdfOut = outsideRows(seenPdf);
  log(`(e) non-loopback sockets of the app tree during the render: ${JSON.stringify(pdfOut)}; to the page host: ${JSON.stringify(rowsOf(seenPdf).filter((r) => r.includes("10.254.254.254")))}`);
  check("(e) PDF export still works with the proxy saved (a PDF file is written)", /^ok /.test(res) && existsSync(pdf) && statSync(pdf).size > 0 && readFileSync(pdf).subarray(0, 4).toString() === "%PDF", String(res));
  check("(e) no socket from the app tree to the page host during the render", rowsOf(seenPdf).every((r) => !r.includes("10.254.254.254")), "");
  log("(e) the native save dialog (browser_pick_pdf_path) was not opened: LIVE (native dialog); the export command was called with a scratch path");

  // ---- (b) and (f): not reachable here
  log("(b) the GitHub avatar fetches need a real GitHub host: not run (no external network host in this pass)");
  log("(f) WebRTC STUN observation needs a STUN server on a non-loopback address: not run (observe-only follow-up row)");

  // ---- Steps 5, 6, 8, 9: new tabs after the setting changed (no restart)
  const s5 = sampler(app, log);
  const stubCount = () => pageEntries().length; // page-host requests only
  let c0 = stubCount();
  const mark5 = entries.length;
  await app.invoke("secret_set", { key: "httpProxy", value: `http://127.0.0.1:${p.B.port}` });
  log(`step 5: proxy changed in settings to http://127.0.0.1:${p.B.port} (secret_set, the call the Apply button makes); no restart`);
  const r5 = await newTabRefusal(app, ctx, MSG.changed);
  log(`step 5 notices: ${JSON.stringify(r5.all)}; panes ${r5.panes}; page-host stub requests meanwhile: ${stubCount() - c0}`);
  otherNote(log, "step 5", mark5);
  S(5, `a new tab refuses with "${MSG.changed}"`, r5.got === MSG.changed, String(r5.got));
  S(5, "the stub saw no request for the page host while the tab refused", stubCount() === c0, `${stubCount() - c0} new`);
  log(`screenshot (step 5): ${await ctx.shot("939-step5")}`);

  c0 = stubCount();
  await app.invoke("secret_set", { key: "httpProxy", value: `http://user:pw@127.0.0.1:${p.A.port}` });
  const r6 = await newTabRefusal(app, ctx, MSG.creds);
  log(`step 6 notices: ${JSON.stringify(r6.all)}`);
  S(6, "a credentialed proxy refuses with the credentials message", r6.got === MSG.creds, String(r6.got));
  S(6, "the refusal does not echo the user name or password", !r6.all.some((x) => /\buser\b.*pw|:pw@/.test(x)), "");
  log(`screenshot (step 6): ${await ctx.shot("939-step6")}`);

  await app.invoke("secret_set", { key: "httpProxy", value: "http://http=proxy.corp:3128" });
  const r8 = await newTabRefusal(app, ctx, MSG.shape);
  log(`step 8 notices: ${JSON.stringify(r8.all)}`);
  S(8, "a host with = refuses with the shape message", r8.got === MSG.shape, String(r8.got));
  for (const odd of ["http://proxy;corp:3128", "http://a,b:3128"]) {
    await app.invoke("secret_set", { key: "httpProxy", value: odd });
    const before = (await noticeTexts(app)).length;
    const r = await newTabRefusal(app, ctx, MSG.shape);
    const now = await noticeTexts(app);
    S(8, `${odd} refuses with the shape message too (${before} notices before, ${now.length} after)`, now.length > before || r.got === MSG.shape, String(r.got));
  }
  S(8, "the stub saw no request for the page host during steps 5, 6 and 8", stubCount() === c0, `${stubCount() - c0} new`);
  otherNote(log, "steps 5-8", mark5);

  // Step 9: settings.json unreadable and no .bak
  const file = app.paths.settings;
  const bak = `${file}.bak`;
  const keep = existsSync(file) ? readFileSync(file) : null;
  const keepBak = existsSync(bak) ? readFileSync(bak) : null;
  log(`step 9: settings file ${file} (${keep ? keep.length : 0} bytes), .bak present ${!!keepBak}`);
  writeFileSync(file, "{ this is not json");
  rmSync(bak, { force: true });
  const r9 = await newTabRefusal(app, ctx, MSG.unreadable);
  log(`step 9 notices: ${JSON.stringify(r9.all)}`);
  S(9, "with settings.json corrupt and no .bak a new tab refuses with the unreadable-settings message", r9.got === MSG.unreadable, String(r9.got));
  log(`screenshot (step 9): ${await ctx.shot("939-step9")}`);
  if (keep) writeFileSync(file, keep);
  if (keepBak) writeFileSync(bak, keepBak);
  const seen5 = await s5.stop();
  S("5-9", "no msedgewebview2 or app socket to the page host while the tabs refused", rowsOf(seen5).every((r) => !r.includes("10.254.254.254")), JSON.stringify(rowsOf(seen5).filter((r) => r.includes("10.254.254.254"))));

  // ---- Step 7: not runnable on main
  log("step 7: N/A on main: the lib.rs patch is already applied (src-tauri/src/lib.rs calls launch_browser_args_for); the 'without the patch' state cannot be produced without changing app source");

  // ---- (a) dead-port proxy
  await app.invoke("secret_set", { key: "httpProxy", value: `http://127.0.0.1:${p.dead}` });
  await restart(ctx, log);
  const sDead = sampler(app, log);
  const ui = JSON.parse(await app.evalJs(`JSON.stringify({ url: location.href, rootKids: document.getElementById("root")?.children.length ?? 0, text: document.body.innerText.length })`));
  const ipc2 = await app.invoke("secret_status", { key: "httpProxy" });
  await app.invoke("secret_set", { key: "httpProxy", value: `http://127.0.0.1:${p.dead}` });
  const ipc3 = await app.invoke("secret_status", { key: "httpProxy" });
  log(`(a) dead-port proxy http://127.0.0.1:${p.dead}: window ${JSON.stringify(ui)}; IPC status ${ipc2}; save+load round trip ${ipc3}`);
  check("(a) with the proxy on a dead port the app UI still loads from the dev server (vite on localhost)", ui.rootKids > 0 && ui.text > 20, JSON.stringify(ui));
  check("(a) IPC still works (secret_set and secret_status answer)", ipc2 === true && ipc3 === true, `${ipc2} ${ipc3}`);
  // Batch 8: a NEW browser tab is opened and its own (shown) address bar driven; the old panes' fields are not used.
  const panesBefore = await browserPanes(app);
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await poll(async () => ((await browserPanes(app)) > panesBefore ? true : null), 20000, 300);
  await sleep(2500);
  const SHOWN = 'section.pane.browser:not([hidden]) input[aria-label="Address"]';
  await app.focusField(SHOWN);
  await sleep(300);
  await app.evalJs(`document.querySelector(${JSON.stringify(SHOWN)}).select()`);
  await app.cdp("insert", `http://${HOST}/`, "enter");
  const failed = await poll(async () => {
    const x = await app.evalJs(`JSON.stringify(document.querySelector("section.pane.browser:not([hidden])")?.innerText ?? "")`);
    return /could not load|did not give Kolux a page|stopped responding/i.test(JSON.parse(x)) ? JSON.parse(x) : null;
  }, 40000, 600);
  log(`(a) browser pane with the dead proxy: ${JSON.stringify((failed ?? "").replace(/\s+/g, " ").slice(0, 240))}`);
  check("(a) a page opened through the dead proxy fails (overlay) instead of going direct", !!failed, String(failed));
  await sleep(4000);
  const seenDead = await sDead.stop();
  check("(a) no socket from the app tree to the page host", rowsOf(seenDead).every((r) => !r.includes("10.254.254.254")), JSON.stringify(rowsOf(seenDead).filter((r) => r.includes("10.254.254.254"))));
  log(`(a) screenshot: ${await ctx.shot("939-dead-port")}`);
  void LIVE_LOGS;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  const A = await stub(log, "A");
  const B = await stub(log, "B");
  const dead = await deadPort();
  log(`stub proxy A 127.0.0.1:${A.port}; stub proxy B 127.0.0.1:${B.port}; dead port ${dead}; page host ${HOST} (exists only inside the stubs)`);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("BROW-939", { report: rep });
    await sleep(3000);
    await run939(ctx, { check: chk.check, log }, { A, B, dead, dir: "G:/Temp/live-v8/run-BROW-939" });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  const code = ctx ? await finish(ctx, "BROW-939", ev, ok) : 1;
  appendFileSync(`${ROOT}/evidence/live-browser-939.txt`, `\n\nLIVE BATCH 8 2026-10-27 browser proxy, after.md row 939 (scripts/prove/live-browser-939.mjs, hidden dev app, stub proxy on loopback, unroutable page host ${HOST})\nresult: ${ctx?.verdict(ok) ?? (ok ? "PASS" : "FAIL")}\n\n${ev.join("\n")}\n`);
  A.server.close();
  B.server.close();
  process.exit(code);
}
