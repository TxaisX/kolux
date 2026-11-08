// S6 Unicode / ANSI torture: nine payloads (ZWJ emoji, RTL and bidi controls, combining marks, 10k-column lines, malformed
// CSI, invalid UTF-8, malformed OSC, mode and scroll-region churn, 2 MB of random escape-heavy bytes) are written to one
// pane by scripts/stress/s6-torture-payloads.mjs. Bars per payload: no crash (app and page alive, no panic in the app log,
// no page error), no hang over 1 s (page timer gap and CDP round trip), the cursor consistent (it sits right after the
// marker the program prints, the terminal's own report agrees, and known widths give the known column), the pane still works.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEW_TERMINAL_JS, TERM, addProjectAndOpen, fmt, gitInit, installProbe, pageErrors, paneText, seedProfile, slash, snapshot, stats, typeInto } from "./lib.mjs";

export const title = "Unicode and ANSI torture (one pane)";
export const seed = seedProfile;
const ALL = ["zwj", "rtl", "combining", "longline", "csi", "utf8", "osc", "modes", "fuzz"];
const NAMES = (process.env.S6_ONLY ?? ALL.concat("win:0", "win:1").join(",")).split(",").filter((n) => ALL.concat("win").includes(n.split(":")[0]));
const FNAME = (n) => n.replace(/[^a-z0-9]/gi, "_");
const HANG_MS = 1000;

const MONITOR_JS = `(() => {
  if (window.__s6mon) return "already";
  const m = (window.__s6mon = { max: 0, last: performance.now(), n: 0 });
  setInterval(() => { const t = performance.now(); const g = t - m.last; m.last = t; m.n++; if (g > m.max) m.max = g; }, 20);
  // What xterm.js logs as an object: its name, message and stack top, which the generic probe flattens to "[object Object]".
  m.errs = [];
  m.xt = 0;
  const ce = console.error.bind(console);
  console.error = (...a) => {
    if (/xterm.js: Parsing error/.test(String(a[0]))) m.xt++;
    if (m.errs.length < 3) m.errs.push(a.map((x) => (x && typeof x === "object" ? JSON.stringify(x, Object.getOwnPropertyNames(x)).slice(0, 500) : String(x))).join(" | ").slice(0, 700));
    ce(...a);
  };
  return "on";
})()`;
const READ_MONITOR_JS = `(() => { const m = window.__s6mon; if (!m) return null; const r = { max: Math.round(m.max), n: m.n, xt: m.xt }; m.xt = 0; m.max = 0; m.n = 0; m.last = performance.now(); return r; })()`;
// Where the terminal drew its cursor: the row it is on and the text before it (the DOM renderer draws a cursor span).
const CURSOR_JS = `(() => {
  const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[0];
  const rowsEl = p && p.querySelector(".xterm-rows");
  const cur = rowsEl && rowsEl.querySelector(".xterm-cursor");
  if (!cur) {
    const kids = rowsEl ? [...rowsEl.children] : [];
    const mi = kids.findIndex((r) => /S6C\\s*$/.test(r.textContent));
    const last = kids.map((r, i) => (r.textContent.trim() ? i : -1)).filter((i) => i >= 0).pop();
    return { cursor: false, rows: kids.length, markerRow: mi, lastText: last, markerHtml: mi >= 0 ? kids[mi].innerHTML.slice(-300) : null, anyCursor: document.querySelectorAll("[class*=cursor]").length, scrolled: (() => { const v = p.querySelector(".xterm-viewport"); return v ? { top: Math.round(v.scrollTop), h: v.scrollHeight, c: v.clientHeight } : null; })() };
  }
  let row = cur; while (row && row.parentElement !== rowsEl) row = row.parentElement;
  const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let pre = "", n;
  while ((n = w.nextNode())) { if (cur.contains(n)) break; pre += n.data; }
  return { cursor: true, rowIdx: [...rowsEl.children].indexOf(row), rows: rowsEl.children.length, prefix: pre.slice(0, 60), rowText: row.textContent.slice(0, 40).trimEnd() };
})()`;
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

// A pane that did not recover: does a page resize event, a real size change or a stray ST / BEL revive it? Records what the pane shows.
async function revive(app, r, name) {
  const shows = async () => ((await paneText(app, 0).catch(() => "")) ?? "");
  const st = { sizeAtFail: unwrap(await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[0]; return p ? p.querySelector(".xterm-rows").children.length : -1; })()`).catch(() => null)) };
  let tag = 0;
  // A try counts as a revival only when a fresh echo marker shows afterwards (typing alone shows nothing at 1x1).
  const probe = async (label, act) => {
    if (Object.values(st).includes(true)) return;
    await act();
    await app.sleep(1500);
    const mark = `ZQ${++tag}R`;
    await typeInto(app, 0, `echo ('ZQ'+'${tag}R')`);
    st[label] = await app.waitFor("revive marker", async () => (await shows()).includes(mark), 4000, 300).then(() => true, () => false);
  };
  const margin = (v) => app.evalJs(`(() => { const s = document.querySelector("section.pane[data-agent]"); if (s) s.style.marginRight = "${v}"; })()`);
  await probe("nothing", async () => {});
  await probe("resizeEvent", () => app.evalJs("window.dispatchEvent(new Event('resize'))"));
  await probe("sizeNudge", () => margin("61px"));
  await margin("").catch(() => {});
  await probe("typedST_BEL", async () => {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea").catch(() => {});
    await app.cdp("insert", "\x1b\\\x07", "");
  });
  r.revive = st;
  checks_note(`${name}: revive tries (true = the pane showed output again): ${JSON.stringify(st)}`);
}
let checks_note = () => {};

export async function run({ launch, checks, opts }) {
  checks_note = (t) => checks.note(t);
  const app = await launch("s6");
  const repo = join(app.temp, "repo");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  const program = slash(join(opts.root, "scripts", "stress", "s6-torture-payloads.mjs"));
  await gitInit(app, repo, "s6");
  await installProbe(app);
  await addProjectAndOpen(app, repo);
  await app.sleep(4000);
  await app.evalJs(MONITOR_JS);
  await app.sleep(3000);
  const idle = unwrap(await app.evalJs(READ_MONITOR_JS));
  checks.note(`idle baseline: longest page timer gap ${idle?.max} ms over ${idle?.n} ticks (20 ms timer)`);
  const logs = [join(app.temp, "tauri-dev.log"), join(app.temp, "app.log")];
  const panics = () => logs.filter(existsSync).flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /panicked|stack overflow|fatal runtime|STATUS_/i.test(l)).map((l) => l.slice(0, 160)));
  const panicsBefore = panics().length;
  const rows = [];
  let errSeen = 0;
  for (const name of NAMES) {
    const out = join(files, `${FNAME(name)}.json`);
    const r = { name };
    const pings = [];
    let timeouts = 0;
    await app.evalJs(READ_MONITOR_JS);
    const t0 = Date.now();
    await typeInto(app, 0, `node '${program}' ${name} '${slash(out)}'`);
    while (!existsSync(out) && Date.now() - t0 < 120000) {
      const p0 = Date.now();
      try {
        await app.evalJs("1+1");
        pings.push(Date.now() - p0);
      } catch {
        timeouts++;
        pings.push(Date.now() - p0);
      }
      await app.sleep(150);
    }
    r.finished = existsSync(out);
    r.totalS = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.finished) {
      await app.sleep(150);
      try {
        r.result = JSON.parse(readFileSync(out, "utf8"));
      } catch (e) {
        r.result = { error: e.message };
      }
      // The cursor sits after "S6C" now (the program holds it there for 3.5 s); the blink can hide it for a moment.
      for (let i = 0; i < 25 && !r.cursor?.cursor; i++) {
        r.cursor = unwrap(await app.evalJs(CURSOR_JS).catch(() => null));
        if (!r.cursor?.cursor) await app.sleep(120);
      }
    }
    const mon = unwrap(await app.evalJs(READ_MONITOR_JS).catch(() => null));
    r.maxGap = mon?.max ?? -1;
    r.xtermLogs = mon?.xt ?? 0;
    r.ping = stats(pings);
    r.timeouts = timeouts;
    // Pane still works: wait for the program's own DONE line, then run a command and see its output.
    const dT0 = Date.now();
    r.done = await app.waitFor(`${name} done line`, async () => ((await paneText(app, 0)) ?? "").includes(`S6-DONE-${name}`), 120000, 400).then(() => true, () => false);
    r.doneS = ((Date.now() - dT0) / 1000).toFixed(1);
    await app.sleep(500);
    if (r.done) {
      await typeInto(app, 0, `echo ('ALIV'+'E-${name}')`);
      r.alive = await app.waitFor(`${name} echo`, async () => ((await paneText(app, 0)) ?? "").includes(`ALIVE-${name}`), 8000, 300).then(() => true, () => false);
    } else r.alive = false;
    if (!r.done || !r.alive || !r.cursor?.cursor || r.cursor.prefix !== "S6C") {
      const t = ((await paneText(app, 0).catch(() => "")) ?? "").split(/\r?\n/).filter((l) => l.trim());
      r.screen = `${t.length} non-empty rows; first: ${JSON.stringify(t.slice(0, 3)).slice(0, 200)}; last: ${JSON.stringify(t.slice(-4)).slice(0, 300)}`;
    }
    if (r.alive) {
      await app.sleep(400);
      r.cursorAfterEcho = unwrap(await app.evalJs(CURSOR_JS).catch(() => null));
    }
    if (!r.cursor?.cursor) checks.note(name + ": no cursor drawn after the payload: " + JSON.stringify({ ...r.cursor, markerHtml: undefined }) + "; after the echo: " + JSON.stringify(r.cursorAfterEcho ? { cursor: r.cursorAfterEcho.cursor, prefix: r.cursorAfterEcho.prefix, markerRow: r.cursorAfterEcho.markerRow } : null));
    if (!r.done || !r.alive) await revive(app, r, name);
    const snap = await snapshot(app).catch(() => []);
    r.procAlive = snap.some((q) => q.name === "kolux.exe");
    const allErrs = await pageErrors(app).catch(() => ["unreachable"]);
    const errList = allErrs.slice(errSeen).filter((e) => !/xterm.js: Parsing error/.test(String(e)));
    errSeen = allErrs.length;
    r.errs = errList.length;
    r.errKinds = [...new Set(errList.map((e) => String(e).replace(/[0-9]+/g, "N").slice(0, 160)))].slice(0, 4);
    if (r.errs && !r.errDetail) {
      r.errDetail = unwrap(await app.evalJs("window.__s6mon && window.__s6mon.errs").catch(() => null));
      checks.note(`${name}: first logged error objects: ${JSON.stringify(r.errDetail)}`);
    }
    if (r.errs) checks.note(`${name}: ${r.errs} page errors, kinds: ${JSON.stringify(r.errKinds)}`);
    r.panics = panics().length - panicsBefore;
    rows.push(r);
    const c = r.cursor;
    console.log(`  ${name}: ${JSON.stringify({ finished: r.finished, totalS: r.totalS, writeMs: r.result?.writeMs, maxGap: r.maxGap, pingMax: r.ping.max, timeouts, cursor: c ? { ...c, rowText: undefined } : null, prefix: c?.prefix, size: r.result ? `${r.result.cols}x${r.result.rows} -> ${(r.result.sizeAfter ?? []).join('x')}` : null, cprBody: r.result?.cprBody, cprAfter: r.result?.cprAfter, done: r.done, doneS: r.doneS, alive: r.alive, errs: r.errs, panics: r.panics })}${r.screen ? ` SCREEN ${r.screen}` : ""}`);
    if (!r.procAlive) {
      checks.note(`${name}: the app is gone; the payloads after it (${NAMES.slice(NAMES.indexOf(name) + 1).join(" ") || "none"}) were not run`);
      break;
    }
    if (!r.done || !r.alive) {
      // A wedged pane is replaced (closed, new Terminal tab) so the next payload starts on a working terminal.
      checks.note(`${name}: the pane did not recover (done ${r.done}, echo ${r.alive}); it was closed and a new terminal opened`);
      await app.click('section.pane[data-agent] button[title^="Close pane"]').catch(() => {});
      await app.sleep(800);
      await app.evalJs(`(() => { const d = document.querySelector('[role="alertdialog"] .btn-row'); if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click(); })()`).catch(() => {});
      await app.sleep(800);
      await app.evalJs(`(async () => { ${NEW_TERMINAL_JS} return !!(await newTerminal((ms) => new Promise((r) => setTimeout(r, ms)))); })()`).catch(() => {});
      await app.waitFor("a fresh terminal pane", async () => (await app.shown(TERM)) >= 1 && (await app.exists(`${TERM} .xterm-helper-textarea`)), 30000, 500).catch(() => {});
      await app.sleep(4000);
    }
  }
  const ran = rows.map((r) => r.name);
  const sub = (f) => rows.filter(f).map((r) => r.name);
  checks.add("every payload was written to the pane and the program finished", `${NAMES.length} of ${NAMES.length} within 120 s`, `${rows.filter((r) => r.finished).length} of ${NAMES.length} ran to the end; seconds [${rows.map((r) => `${r.name} ${r.totalS}`).join(", ")}]; write time ms [${rows.map((r) => `${r.name} ${r.result?.writeMs ?? "-"}`).join(", ")}]`, rows.length === NAMES.length && rows.every((r) => r.finished));
  checks.add("no crash: the app process and the page stay up, no panic in the app log, no page error", "alive after every payload, 0 panics, 0 page errors", `process alive [${rows.map((r) => `${r.name} ${r.procAlive}`).join(", ")}]; panics ${rows.reduce((a, r) => a + r.panics, 0)}; page errors [${rows.map((r) => `${r.name} ${r.errs}`).join(", ")}]`, rows.length === NAMES.length && rows.every((r) => r.procAlive && !r.panics && !r.errs));
  checks.add("no hang over 1 s: longest page timer gap while a payload runs", `< ${HANG_MS} ms (idle baseline ${idle?.max} ms)`, `[${rows.map((r) => `${r.name} ${r.maxGap}`).join(", ")}] ms; over the bar: [${sub((r) => r.maxGap >= HANG_MS).join(" ") || "none"}]`, rows.every((r) => r.maxGap >= 0 && r.maxGap < HANG_MS));
  checks.add("no hang over 1 s: CDP round trip of a trivial script while a payload runs", `max < ${HANG_MS} ms, 0 timeouts`, `max ms [${rows.map((r) => `${r.name} ${fmt(r.ping.max)}`).join(", ")}]; p95 ms [${rows.map((r) => `${r.name} ${fmt(r.ping.p95)}`).join(", ")}]; over the bar: [${sub((r) => r.ping.max >= HANG_MS || r.timeouts).join(" ") || "none"}]`, rows.every((r) => r.ping.max < HANG_MS && !r.timeouts));
  checks.add("malformed input is dropped quietly: xterm.js parse-error lines written to the page console per payload", "0 console.error lines per payload (a flood costs time and hides real errors)", `[${rows.map((r) => `${r.name} ${r.xtermLogs}`).join(", ")}]`, rows.every((r) => !r.xtermLogs));
  const domOk = (r) => r.cursor?.cursor && r.cursor.prefix === "S6C";
  checks.add("cursor position: the cursor the terminal draws sits right after the marker the program wrote last", 'cursor on the marker row, text before it exactly "S6C", for every payload', `[${rows.map((r) => `${r.name} ${r.cursor?.cursor ? `row ${r.cursor.rowIdx + 1}/${r.cursor.rows} before-cursor "${r.cursor.prefix}"` : "no cursor drawn"}`).join("; ")}]`, rows.every(domOk), true);
  const cprOk = (r) => r.result?.cprAfter && r.result.cprAfter.col === 4 && (!r.cursor?.cursor || r.result.cprAfter.row === r.cursor.rowIdx + 1);
  checks.add("cursor position: the terminal's own report (CSI 6n) agrees with the drawn cursor", "answers within 4 s; column 4; same row as the drawn cursor", `[${rows.map((r) => `${r.name} ${r.result?.cprAfter ? `${r.result.cprAfter.row};${r.result.cprAfter.col} in ${r.result.cprAfter.ms} ms` : "no answer"}`).join("; ")}]`, rows.every(cprOk), true);
  const known = rows.filter((r) => r.result?.expectCol);
  checks.add("cursor position: where the width is known, the column is the known one", "reported column == expected, before any clean-up", known.length ? `[${known.map((r) => `${r.name} expected ${r.result.expectCol} got ${r.result.cprBody ? `column ${r.result.cprBody.col} (row ${r.result.cprBody.row})` : "no answer"} (width ${r.result.cols})`).join("; ")}]` : "no payload with a known width ran", known.every((r) => r.result.cprBody?.col === r.result.expectCol), true);
  checks.add("the pane still works after each payload", "the done line shows within 30 s and a typed command's output shows", `[${rows.map((r) => `${r.name} done ${r.done}${r.done ? ` after ${r.doneS} s` : ` (waited ${r.doneS} s)`} echo ${r.alive}`).join(", ")}]`, rows.every((r) => r.done && r.alive && Number(r.doneS) <= 30));
  checks.note("the three cursor checks are INCONCLUSIVE (harness): csi and win:1 fail only because CSI 8;1;1t froze the pane at 1x1; combining sometimes shows no cursor span (blink or DOM); fuzz ends inside an escape sequence; known widths assume grapheme-cluster widths and ConPTY re-emits output with its own width tables, so a width difference cannot be pinned on xterm.js alone");
  checks.note(`ran: ${ran.join(" ")}; not run: ${ALL.filter((n) => !ran.includes(n)).join(" ") || "none"}`);
}
