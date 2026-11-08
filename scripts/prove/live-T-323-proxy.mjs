// LIVE proof, T-323-c/d/e (after.md rows 905, 908): with a proxy in effect Kolux makes no direct request of its own for page icons, download sizes or the failed-load diagnosis.
// node live-T-323-proxy.mjs saved | control | env
//   saved   a proxy is saved (Settings > General > Network proxy) pointing at a scratch stub proxy that logs every request; the page is http://10.254.254.254:8080/ (a private,
//           unused address: it exists only inside the stub). Checks the stub log (no request in Kolux's own HTTP client style) and a per-process TCP sample of the app and its
//           WebView2 children (no connection to anything but this machine).
//   control no proxy, a page on a loopback server: Kolux's own icon request does reach it (so the observer would see one).
//   env     no saved proxy but HTTP_PROXY/HTTPS_PROXY in the app's environment (the "system proxy" case, OD-18): the same loopback page gets no icon request from Kolux.
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker } from "./live-proj-common.mjs";

const run = promisify(execFile);
export const HOST = "10.254.254.254:8080";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PAGE = '<!doctype html><title>Proxy proof page</title><link rel="icon" href="/favicon.ico"><p>proxy-proof-body</p><a href="/download.bin">download</a>';
const browserUa = (ua) => /Mozilla\//.test(ua);

function site(log, label) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
    log(`${label} ${req.method} ${req.url} UA=${(req.headers["user-agent"] ?? "").slice(0, 48)}`);
    entries.push({ label, method: req.method, url: req.url, ua: req.headers["user-agent"] ?? "" });
    if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    if (url.pathname === "/favicon.ico") return res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length }).end(PNG);
    if (url.pathname === "/download.bin") return res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=proof.bin", "content-length": 4096 }).end(req.method === "HEAD" ? undefined : Buffer.alloc(4096));
    if (url.pathname === "/fail") return req.socket.destroy();
    res.writeHead(404).end("no");
  });
  return server;
}
const entries = [];

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server.address().port;
}

/** netstat samples of every process in the app's tree; keeps each distinct (process, remote, state). */
export function sampler(app, log) {
  const seen = new Map();
  let stop = false;
  let names = new Map();
  const refresh = async () => {
    try {
      names = new Map((await app.treeOf(app.pid)).map((p) => [p.pid, p.name]));
      names.set(app.pid, "kolux.exe");
    } catch {}
  };
  const loop = (async () => {
    let n = 0;
    while (!stop) {
      if (n++ % 8 === 0) await refresh();
      try {
        const { stdout } = await run("netstat", ["-ano", "-p", "tcp"], { windowsHide: true });
        for (const l of stdout.split(/\r?\n/)) {
          const m = l.trim().match(/^TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/);
          if (!m || !names.has(Number(m[4]))) continue;
          const key = `${names.get(Number(m[4]))} pid ${m[4]} -> ${m[2]} ${m[3]}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      } catch {}
      await sleep(350);
    }
  })();
  return { stop: async () => ((stop = true), await loop, seen) };
}
export const local = (remote) => /^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):/.test(remote);

export async function openBrowserAt(app, url) {
  if (!(await app.exists("section.pane.browser"))) {
    await app.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
    await app.waitFor("a browser pane", () => app.exists("section.pane.browser"), 20000);
    await sleep(2500);
  }
  await go(app, url);
}
export async function go(app, url) {
  await app.focusField('section.pane.browser input[aria-label="Address"]');
  await sleep(300);
  await app.evalJs(`document.querySelector('section.pane.browser input[aria-label="Address"]').select()`);
  await app.cdp("insert", url, "enter");
}
export const pageTarget = async (needle) => {
  const ts = await (await fetch("http://127.0.0.1:9290/json")).json();
  return ts.find((t) => t.type === "page" && t.url.includes(needle)) ?? null;
};

export async function savedProxy(app, address, log) {
  await app.rawKey({ key: ",", code: "Comma", vk: 188, mods: 2 });
  const ui = await poll(async () => ((await app.exists('input[aria-label="Proxy address"]')) ? true : null), 10000, 400);
  if (ui) {
    await app.evalJs(`(() => { const d = document.querySelector('section[data-section="proxy"] details'); d.open = true; d.scrollIntoView(); return true; })()`);
    await sleep(500);
    await app.focusField('input[aria-label="Proxy address"]');
    await app.cdp("insert", address);
    await app.clickWhere('section[data-section="proxy"] button', "/^\\s*Apply\\s*$/");
    await sleep(1500);
    log(`proxy saved through Settings > General > Network proxy (UI)`);
  } else {
    await app.invoke("secret_set", { key: "httpProxy", value: address });
    log(`Settings page proxy field not reachable; saved through the same secret_set call the Apply button makes`);
  }
  const set = await app.invoke("secret_status", { key: "httpProxy" });
  await app.rawKey({ key: "Escape", code: "Escape", vk: 27, mods: 0 }).catch(() => {});
  return set;
}

export async function runProxy(mode, ctx, { check, log }, ports) {
  const { app } = ctx;
  app.rawKey = ctx.rawKey;
  const s = sampler(app, log);
  const mark = entries.length;
  const sinceMark = () => entries.slice(mark);
  if (mode === "saved") {
    const set = await savedProxy(app, `http://127.0.0.1:${ports.proxy}`, log);
    check("a proxy is saved (secret_status true) and points at the stub", set === true, String(set));
    await openBrowserAt(app, `http://${HOST}/`);
    const t = await poll(() => pageTarget(HOST), 40000, 500);
    log(`page target: ${t ? JSON.stringify({ url: t.url, title: t.title }) : null}`);
    check("the page at the non-loopback address opened in the in-app browser (through the stub)", !!t && /Proxy proof/.test(t.title), t?.title ?? "none");
    await sleep(8000);
    const tree = [app.pid, ...(await app.treeOf(app.pid)).map((p) => p.pid)];
    const { stdout: cl } = await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { @(${tree.join(",")}) -contains $_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' } | ForEach-Object { "$($_.ProcessId) " + $_.CommandLine }`], { windowsHide: true });
    for (const l of cl.split(/\r?\n/).filter(Boolean)) log(`webview process ${l.split(" ")[0]}: proxy-server args ${JSON.stringify(l.match(/--proxy-server=\S+/g) ?? [])}; type ${(l.match(/--type=\S+/) ?? ["browser"])[0]}`);
    await go(app, `http://${HOST}/download.bin`);
    await sleep(10000);
    const dl = await app.evalJs(`document.querySelector("section.pane.browser ul.downloads")?.innerText ?? ""`);
    log(`downloads list: ${JSON.stringify(dl.slice(0, 160))}`);
    await go(app, `http://${HOST}/fail`);
    const overlay = await poll(async () => {
      const t = await app.evalJs(`document.querySelector("section.pane.browser")?.innerText ?? ""`);
      return /did not give Kolux a page|could not load/i.test(t) ? t : null;
    }, 40000, 500);
    log(`failed-load overlay: ${JSON.stringify((overlay ?? "").replace(/\s+/g, " ").slice(0, 300))}`);
    await sleep(3000);
    const seen = await s.stop();
    const mine = sinceMark();
    log(`stub proxy saw ${mine.length} requests: ${JSON.stringify(mine.map((e) => `${e.method} ${e.url}`))}`);
    log(`user agents at the stub: ${JSON.stringify([...new Set(mine.map((e) => e.ua.slice(0, 40)))])}`);
    log("(engine) the stub saw the page: " + mine.some((e) => e.method === "GET" && e.url.endsWith(`${HOST}/`)));
    check("no request the stub saw came from Kolux's own HTTP client (every one has a browser user agent)", mine.every((e) => browserUa(e.ua)), "");
    check("no HEAD request was made for the download-size probe (it is skipped under a proxy)", !mine.some((e) => e.method === "HEAD"), "");
    check("the failed-load overlay says Kolux did not look into why because a proxy is saved (no direct diagnosis)", !!overlay && /because a proxy is saved/.test(overlay), (overlay ?? "").replace(/\s+/g, " ").slice(0, 160));
    const rows = [...seen.keys()];
    log(`TCP sample (${[...seen.values()].reduce((a, b) => a + b, 0)} sightings, distinct): ${JSON.stringify(rows)}`);
    const outside = rows.filter((r) => !local(r.split(" -> ")[1]));
    const own = rows.filter((r) => r.startsWith("kolux.exe")), ownOut = outside.filter((r) => r.startsWith("kolux.exe"));
    const engOut = outside.filter((r) => r.startsWith("msedgewebview2.exe"));
    check("Kolux's own process (kolux.exe, where the size probe, icon fetch and diagnosis run) made no connection to anything but this machine", own.length > 0 && ownOut.length === 0, JSON.stringify(ownOut));
    log(`ENGINE FINDING (not a Kolux-client claim): WebView2 direct non-loopback sockets = ${JSON.stringify(engOut)}; stub saw the page = ${mine.some((e) => e.method === "GET" && e.url.endsWith(`${HOST}/`))}`);
  } else {
    const url = `http://127.0.0.1:${ports.web}/`;
    await openBrowserAt(app, url);
    await poll(() => pageTarget(`127.0.0.1:${ports.web}`), 40000, 500);
    await sleep(10000); const t = await pageTarget(`127.0.0.1:${ports.web}`);
    check("the loopback page opened in the in-app browser", !!t && /Proxy proof/.test(t.title), t?.title ?? "none");
    await s.stop();
    const mine = sinceMark().filter((e) => e.label === "web");
    log(`loopback server saw: ${JSON.stringify(mine.map((e) => `${e.method} ${e.url} UA=${e.ua.slice(0, 30)}`))}`);
    const kolux = mine.filter((e) => !browserUa(e.ua));
    if (mode === "control") check("control (no proxy): Kolux's own client asks for the page icon itself (a non-browser user agent reaches the server)", kolux.length > 0, JSON.stringify(kolux));
    else check("system proxy (HTTP_PROXY/HTTPS_PROXY set, setting empty): Kolux's own client made no request of its own", kolux.length === 0 && mine.length > 0, JSON.stringify(kolux));
  }
  log(`screenshot: ${await ctx.shot(`T-323-${mode}`)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? "saved";
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  const proxy = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    log(`proxy ${req.method} ${req.url} UA=${(req.headers["user-agent"] ?? "").slice(0, 48)}`);
    entries.push({ label: "proxy", method: req.method, url: req.url, ua: req.headers["user-agent"] ?? "" });
    if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    if (url.pathname === "/favicon.ico") return res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length }).end(PNG);
    if (url.pathname === "/download.bin") return res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=proof.bin", "content-length": 4096 }).end(req.method === "HEAD" ? undefined : Buffer.alloc(4096));
    if (url.pathname === "/fail") return req.socket.destroy();
    res.writeHead(404).end("no");
  });
  proxy.on("connect", (req, sock) => {
    log(`proxy CONNECT ${req.url}`);
    entries.push({ label: "proxy", method: "CONNECT", url: req.url, ua: "" });
    sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  const web = site(log, "web");
  const ports = { proxy: await listen(proxy), web: await listen(web) };
  log(`stub proxy on 127.0.0.1:${ports.proxy}; loopback site on 127.0.0.1:${ports.web}; mode ${mode}`);
  if (mode === "env") {
    for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) process.env[k] = `http://127.0.0.1:${ports.proxy}`;
    process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost,registry.npmjs.org,.npmjs.org";
  }
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain(`T-323-${mode}`, { report: rep });
    await sleep(3000);
    await runProxy(mode, ctx, { check: chk.check, log }, ports);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  const code = ctx ? await finish(ctx, `T-323-${mode}`, ev, ok) : 1;
  proxy.close();
  web.close();
  process.exit(code);
}
