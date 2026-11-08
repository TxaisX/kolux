// S7 editor under big inputs: a 30 MB and a 50 MB text file, a binary blob and a fake program, and the diff of a 19k-line
// and a 25k-line rewrite. Bars: no freeze over 2 s (longest page timer gap while the editor works), a refusal that says why
// (50 MB is over the editor's 32 MB bound, binary is refused), a big diff asks before it draws, the app stays up and the
// editor tab closes cleanly afterwards.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TERM, addProjectAndOpen, appMemMB, fmt, gitInit, installProbe, pageErrors, seedProfile, snapshot, stats } from "./lib.mjs";

export const title = "Editor with big files and a big diff";
export const seed = seedProfile;
const FREEZE_MS = 2000;
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

const MONITOR_JS = `(() => {
  if (window.__s7mon) return "already";
  const m = (window.__s7mon = { max: 0, last: performance.now(), n: 0 });
  setInterval(() => { const t = performance.now(); const g = t - m.last; m.last = t; m.n++; if (g > m.max) m.max = g; }, 20);
  return "on";
})()`;
const READ_MONITOR_JS = `(() => { const m = window.__s7mon; if (!m) return null; const r = { max: Math.round(m.max), n: m.n }; m.max = 0; m.n = 0; m.last = performance.now(); return r; })()`;

// A text file of about `mb` megabytes made of numbered lines, written in pieces so memory stays small.
function writeBig(path, mb) {
  return new Promise((resolve, reject) => {
    const s = createWriteStream(path);
    s.on("error", reject);
    s.on("finish", resolve);
    const line = (i) => `line ${i} the quick brown fox jumps over the lazy dog 0123456789 abcdefghijklmnopqrstuvwxyz\n`;
    let i = 0;
    let bytes = 0;
    const target = mb * 1024 * 1024;
    const pump = () => {
      while (bytes < target) {
        let chunk = "";
        for (let k = 0; k < 4000 && bytes + chunk.length < target; k++) chunk += line(i++);
        bytes += chunk.length;
        if (!s.write(chunk)) return void s.once("drain", pump);
      }
      s.end();
    };
    pump();
  });
}

const numbered = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i} some content that is long enough to be a real source line, with a few words in it`).join("\n") + "\n";

export async function run({ launch, checks, opts }) {
  const app = await launch("s7");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s7");
  const g = (a) => app.run("git", ["-c", "user.name=stress", "-c", "user.email=stress@example.invalid", ...a], { cwd: repo });
  // Two tracked files, rewritten after the commit so each has a whole-file diff.
  writeFileSync(join(repo, "rewrite25k.txt"), numbered(25000, "old"));
  writeFileSync(join(repo, "rewrite19k.txt"), numbered(19000, "old"));
  await g(["add", "."]);
  await g(["commit", "-q", "-m", "tracked files"]);
  writeFileSync(join(repo, "rewrite25k.txt"), numbered(25000, "new"));
  writeFileSync(join(repo, "rewrite19k.txt"), numbered(19000, "new"));
  const tBuild = Date.now();
  await writeBig(join(repo, "big30.txt"), 30);
  await writeBig(join(repo, "big50.txt"), 50);
  writeFileSync(join(repo, "blob.dat"), Buffer.concat([randomBytes(3 * 1024 * 1024), Buffer.alloc(4096, 0)]));
  writeFileSync(join(repo, "prog.exe"), Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(56, 0), randomBytes(1024 * 1024)]));
  checks.note(`fixtures built in ${((Date.now() - tBuild) / 1000).toFixed(1)} s: big30.txt ${fmt(readFileSync(join(repo, "big30.txt")).length / 1048576, 1)} MB, big50.txt, blob.dat 3 MB, prog.exe 1 MB, two rewritten tracked files`);

  await installProbe(app);
  await addProjectAndOpen(app, repo);
  await app.sleep(5000);
  await app.evalJs(MONITOR_JS);
  await app.sleep(2500);
  const idle = unwrap(await app.evalJs(READ_MONITOR_JS));
  checks.note(`idle baseline: longest page timer gap ${idle?.max} ms over ${idle?.n} ticks (20 ms timer)`);
  const memStart = appMemMB(await snapshot(app));
  const rows = [];

  // Runs `act` and watches the page: longest timer gap and slowest CDP round trip while `until` is not yet true.
  async function watch(label, act, until, limitMs = 90000) {
    const r = { label };
    await app.evalJs(READ_MONITOR_JS);
    const pings = [];
    let timeouts = 0;
    const t0 = Date.now();
    await act();
    r.actMs = Date.now() - t0;
    for (;;) {
      const p0 = Date.now();
      let hit = null;
      try {
        hit = unwrap(await app.evalJs(until));
        pings.push(Date.now() - p0);
      } catch {
        timeouts++;
        pings.push(Date.now() - p0);
      }
      if (hit) {
        r.hit = hit;
        break;
      }
      if (Date.now() - t0 > limitMs) break;
      await app.sleep(120);
    }
    r.ms = Date.now() - t0;
    const mon = unwrap(await app.evalJs(READ_MONITOR_JS).catch(() => null));
    r.maxGap = mon?.max ?? -1;
    r.ping = stats(pings);
    r.timeouts = timeouts;
    return r;
  }

  const EDITOR_STATE = `(() => {
    const f = document.querySelector(".notice.load-failed"); if (f) return { kind: "refused", text: f.textContent.slice(0, 220) };
    const c = document.querySelector(".cm-editor .cm-content"); if (c && c.querySelector(".cm-line")) return { kind: "opened", lines: document.querySelectorAll(".cm-line").length };
    return null;
  })()`;
  async function openByPicker(name) {
    // Go to File is held by a focused terminal, so the keystroke goes to the page body.
    await app.evalJs(`(() => { if (document.activeElement) document.activeElement.blur(); document.body.focus(); })()`);
    await app.cdp("key", "p", "2");
    await app.waitFor("the Go to File picker", () => app.exists('[role="dialog"][aria-label="Open a file"] .picker-input'), 8000, 150);
    await app.focusField('[role="dialog"][aria-label="Open a file"] .picker-input');
    await app.cdp("insert", name, "");
    await app.waitFor(`the picker lists ${name}`, async () => unwrap(await app.evalJs(`[...document.querySelectorAll('[role="dialog"][aria-label="Open a file"] [role="option"], [role="dialog"][aria-label="Open a file"] .picker-list > *')].some(e => e.textContent.includes(${JSON.stringify(name)}))`)), 15000, 200);
    await app.cdp("key", "Enter", "0");
  }
  async function closeEditor() {
    await app.click('button[title^="Close tab"]').catch(() => {});
    await app.sleep(600);
    await app.evalJs(`(() => { const d = document.querySelector('[role="alertdialog"] .btn-row'); if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click(); return "x"; })()`).catch(() => {});
    await app.sleep(800);
  }

  // Text and binary files through Go to File.
  for (const [name, expect] of [["big30.txt", "opened"], ["big50.txt", "refused"], ["blob.dat", "refused"], ["prog.exe", "refused"]]) {
    const before = appMemMB(await snapshot(app));
    const r = await watch(name, () => openByPicker(name), EDITOR_STATE);
    r.expect = expect;
    r.kind = r.hit?.kind ?? "nothing within 90 s";
    r.text = r.hit?.text ?? "";
    r.memDelta = appMemMB(await snapshot(app)) - before;
    rows.push(r);
    console.log(`  ${name}: ${JSON.stringify({ kind: r.kind, ms: r.ms, actMs: r.actMs, maxGap: r.maxGap, pingMax: r.ping.max, timeouts: r.timeouts, memDeltaMB: Math.round(r.memDelta), text: r.text })}`);
    await closeEditor();
    // Let a freed buffer settle, then record what stays behind.
    await app.sleep(1500);
    r.memAfter = appMemMB(await snapshot(app)) - before;
  }

  // Diffs through the "Changed file diff" menu entry.
  const DIFF_STATE = `(() => {
    const ask = [...document.querySelectorAll(".notice.md-banner")].find((e) => /large/i.test(e.textContent)); if (ask) return { kind: "asked", text: ask.textContent.slice(0, 160) };
    const d = document.querySelector(".diff-body .cm-editor .cm-line, .diff-body .cm-mergeView .cm-line, .diff-body .cm-line"); if (d) return { kind: "drawn", lines: document.querySelectorAll(".diff-body .cm-line").length };
    return null;
  })()`;
  async function openDiffByMenu(name) {
    await app.click("button.newtab");
    await app.sleep(500);
    await app.evalJs(`(() => { const it = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => /Changed file diff/.test(x.textContent)); if (it) it.click(); return it ? "ok" : null; })()`);
    await app.waitFor("the changed file picker", () => app.exists('[role="dialog"][aria-label="Open a changed file"] .picker-input'), 15000, 200);
    await app.focusField('[role="dialog"][aria-label="Open a changed file"] .picker-input');
    await app.cdp("insert", name, "");
    await app.waitFor(`the picker lists ${name}`, async () => unwrap(await app.evalJs(`[...document.querySelectorAll('[role="dialog"][aria-label="Open a changed file"] *')].some(e => e.children.length === 0 && e.textContent.includes(${JSON.stringify(name)}))`)), 30000, 200);
    await app.cdp("key", "Enter", "0");
  }
  for (const [name, expect] of [["rewrite19k.txt", "asked"], ["rewrite25k.txt", "asked"]]) {
    const r = await watch(name, () => openDiffByMenu(name), DIFF_STATE);
    r.expect = expect;
    r.kind = r.hit?.kind ?? "nothing within 90 s";
    r.text = r.hit?.text ?? "";
    rows.push(r);
    console.log(`  ${name}: ${JSON.stringify({ kind: r.kind, ms: r.ms, actMs: r.actMs, maxGap: r.maxGap, pingMax: r.ping.max, timeouts: r.timeouts, lines: r.hit?.lines, text: r.text })}`);
    if (r.kind === "asked") {
      const full = await watch(`${name} (load the full diff)`, () => app.evalJs(`(() => { const b = [...document.querySelectorAll(".notice.md-banner .btn")].find((x) => /Load the full diff/.test(x.textContent)); if (b) setTimeout(() => b.click(), 50); return b ? "scheduled" : null; })()`), `(() => { const d = document.querySelector(".diff-body .cm-line"); return d ? { kind: "drawn", lines: document.querySelectorAll(".diff-body .cm-line").length } : null; })()`, 120000);
      full.expect = "drawn";
      full.kind = full.hit?.kind ?? "nothing within 120 s";
      rows.push(full);
      console.log(`  ${full.label}: ${JSON.stringify({ kind: full.kind, ms: full.ms, maxGap: full.maxGap, pingMax: full.ping.max, timeouts: full.timeouts, lines: full.hit?.lines })}`);
    }
    await closeEditor();
  }

  const snap = await snapshot(app).catch(() => []);
  const alive = snap.some((q) => q.name === "kolux.exe");
  const errs = await pageErrors(app).catch(() => ["unreachable"]);
  const memEnd = appMemMB(snap);
  const stillOpen = unwrap(await app.evalJs(`document.querySelectorAll(".cm-editor").length`).catch(() => -1));
  const names = rows.map((r) => r.label);

  checks.add("no freeze over 2 s: longest page timer gap while each file or diff opens", `< ${FREEZE_MS} ms (idle baseline ${idle?.max} ms)`, `[${rows.map((r) => `${r.label} ${r.maxGap}`).join("; ")}] ms; over the bar: [${rows.filter((r) => r.maxGap >= FREEZE_MS).map((r) => r.label).join("; ") || "none"}]`, rows.every((r) => r.maxGap >= 0 && r.maxGap < FREEZE_MS && r.timeouts === 0));
  checks.add("no freeze over 2 s: CDP round trip of a trivial script while each file or diff opens", `max < ${FREEZE_MS} ms, 0 timeouts`, `max ms [${rows.map((r) => `${r.label} ${fmt(r.ping.max)}`).join("; ")}]; timeouts ${rows.reduce((a, r) => a + r.timeouts, 0)}`, rows.every((r) => r.ping.max < FREEZE_MS && r.timeouts === 0));
  checks.add("each input ends the way it should", "30 MB text opens; 50 MB, binary and program files are refused with a message; both big diffs ask first, then draw after Load the full diff", `[${rows.map((r) => `${r.label} -> ${r.kind} in ${(r.ms / 1000).toFixed(1)} s (want ${r.expect})`).join("; ")}]`, rows.every((r) => r.kind === r.expect));
  const refused = rows.filter((r) => r.expect === "refused");
  checks.add("refusals say why", "the message names the size bound or says binary / not UTF-8", `[${refused.map((r) => `${r.label}: ${JSON.stringify(r.text.slice(0, 110))}`).join("; ")}]`, refused.length > 0 && refused.every((r) => /binary|too large|not UTF-8/i.test(r.text)));
  checks.add("memory: opening the 30 MB file does not leave the app bigger than 1 GB over its start", "< 1024 MB over the start", `start ${fmt(memStart)} MB; ${rows.filter((r) => r.memDelta !== undefined).map((r) => `${r.label} +${fmt(r.memDelta)} MB while open, ${fmt(r.memAfter)} MB after close`).join("; ")}; end ${fmt(memEnd)} MB`, memEnd - memStart < 1024);
  checks.add("the app stays up and the editor tabs close", "app alive, 0 page errors, 0 editors left open", `alive ${alive}; page errors ${errs.length}${errs.length ? ` (${JSON.stringify(String(errs[0]).slice(0, 160))})` : ""}; editors still open ${stillOpen}`, alive && errs.length === 0 && stillOpen === 0);
  checks.note(`ran: ${names.join("; ")}`);
}
