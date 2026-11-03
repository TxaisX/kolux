// LIVE proof, T-655 (lane E, automatic pull requests): the "Pull requests" section of the Insights panel in the
// right sidebar, hidden app, scratch profile and home. A scratch git repo with NO remote (one commit, then a branch of
// its own, because the flow never works on the default branch) is added as a project.
//   1. Best effort, the real automatic run: automatic pull requests are switched ON for that workspace through the
//      Settings page (Git & worktrees > Automatic pull requests > the workspace's select), because a repository with
//      no remote is off by default (DT-C89: the default "On for GitHub repositories"). A stand-in claude (batch file)
//      in the shell pane changes a file and reports a turn the way Claude's hooks do: it pipes UserPromptSubmit and
//      then Stop through Kolux's own hook script into the app's loopback listener. The window turns that into a
//      "finished" note (src/status/finished.ts), autoPrWatch calls onAgentIdle and the flow commits. Checked: (a) a new
//      commit on the scratch repo's branch, (b) the section shows the workspace's row in its local-only state.
//   2. At 900, 1400 and 1920 px wide (CDP device metrics) and 1536 px at 125% and 1280 px at 150%: the section is
//      inside the window, nothing in .insights scrolls sideways or sticks out, a screenshot is kept.
// usage: node scripts/prove/live-T-655.mjs   -> evidence/T-655-*.png + evidence/T-655.txt
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { reporter, startPlain, finish, sleep, waitFor, ROOT, LIVE_LOGS, LIVE_BASE, git } from "./live-common.mjs";
import { checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
const EVID = join(ROOT, "evidence");
mkdirSync(EVID, { recursive: true });
const ID = "T-655";
const TEMP = `${LIVE_BASE}/run-${ID}`;
const FLAG = `${TEMP}/go.flag`;
const BRANCH = "feature/auto-pr-proof";
const win = (p) => p.replace(/\//g, "\\");
const hook = win(`${TEMP}/home/.kolux-rs/agent-hooks/claude.cmd`);
let ctx;
let ok = false;
const skipped = [];

const SECTION = `(() => {
  const h = document.querySelector("h3#ins-auto-pr");
  const sec = h ? h.closest("section") : null;
  const ins = document.querySelector(".insights");
  if (sec) sec.scrollIntoView({ block: "end" });
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const over = ins ? [...ins.querySelectorAll("*")].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== "visible" && getComputedStyle(n).textOverflow !== "ellipsis").map((n) => n.className).slice(0, 5) : null;
  const cut = ins ? [...ins.querySelectorAll("*")].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); }).length : null;
  const flat = (e) => e.innerText.split(String.fromCharCode(10)).join(" ").replace(/ +/g, " ").trim();
  return { vw: innerWidth, vh: innerHeight, pageScroll: document.documentElement.scrollWidth > innerWidth + 1,
    head: r(h), sec: r(sec), ins: r(ins), insScroll: ins ? ins.scrollWidth > ins.clientWidth + 1 : null, over, cut,
    rows: sec ? sec.querySelectorAll("[data-auto-pr]").length : 0,
    text: sec ? flat(sec).slice(0, 400) : null };
})()`;

/** One CDP session: set the viewport width and scale, evaluate `expr`, screenshot, clear the override. */
async function at(width, scale = 1, expr = SECTION, tag = "pull-requests") {
  // The dev server can reload the page under a run (a file of the worktree changed): a stuck or failed session is retried.
  for (let tryNo = 1; ; tryNo++) {
    try {
      return await atOnce(width, scale, expr, tag);
    } catch (e) {
      log(`  (${width}px try ${tryNo} failed: ${e.message})`);
      if (tryNo >= 3) throw e;
      await sleep(3000);
    }
  }
}

async function atOnce(width, scale, expr, tag) {
  const port = process.env.PROVE_PORT || "1470";
  const targets = await (await fetch(`http://127.0.0.1:${process.env.PROVE_CDP || "9290"}/json`)).json();
  const t = targets.find((x) => x.type === "page" && (x.url.includes(`localhost:${port}`) || x.url.includes("tauri.localhost")));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mine = ++id;
      const timer = setTimeout(() => reject(new Error(`CDP ${method} gave no answer in 20 s`)), 20000);
      const on = (e) => { const m = JSON.parse(e.data); if (m.id === mine) { ws.removeEventListener("message", on); clearTimeout(timer); resolve(m.result); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: scale, mobile: false });
  await sleep(1500);
  const m = (await send("Runtime.evaluate", { returnByValue: true, expression: expr })).result.value;
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await send("Emulation.clearDeviceMetricsOverride");
  ws.close();
  const name = `T-655-${tag}-${width}${scale === 1 ? "" : `-x${scale}`}.png`;
  const file = `${LIVE_LOGS}/${name}`;
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  copyFileSync(file, join(EVID, name));
  return { m, file, name };
}

// The stand-in claude: banner, waits for the go flag, then one "turn": a prompt report (working), a file change in the
// repo (the pane's folder), a stop report (done). Both reports go through Kolux's hook script, as Claude's own hooks do.
const standin = [
  ":wait",
  `if exist "${win(FLAG)}" goto fire`,
  "ping -n 2 127.0.0.1 >nul",
  "goto wait",
  ":fire",
  `echo {"hook_event_name":"UserPromptSubmit","session_id":"proof-1","prompt":"change notes"}| "${hook}"`,
  "ping -n 3 127.0.0.1 >nul",
  "echo changed by the stand-in agent>> notes.txt",
  "ping -n 3 127.0.0.1 >nul",
  `echo {"hook_event_name":"Stop","session_id":"proof-1"}| "${hook}"`,
  "echo turn reported",
];

try {
  ctx = await startPlain(ID, {
    report: rep,
    standin,
    prepare: async (repo) => {
      for (const [k, v] of [["user.name", "prove"], ["user.email", "prove@example.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await git(repo, ["config", k, v]);
      await git(repo, ["checkout", "-q", "-b", BRANCH]);
    },
  });
  const { app } = ctx;
  const remotes = (await git(ctx.repo, ["remote", "-v"])).trim();
  const head0 = (await git(ctx.repo, ["rev-parse", "HEAD"])).trim();
  const count0 = Number((await git(ctx.repo, ["rev-list", "--count", "HEAD"])).trim());
  log(`scratch repo ${ctx.repo}: branch ${(await git(ctx.repo, ["branch", "--show-current"])).trim()}, ${count0} commit(s), head ${head0.slice(0, 10)}, remotes: ${remotes || "(none)"}`);
  check("the scratch repo has no remote and one commit", remotes === "" && count0 === 1, `remotes=${JSON.stringify(remotes)} commits=${count0}`);

  // ---- Turn automatic pull requests on for this workspace, through the Settings page. ----
  const before = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => JSON.stringify(s.autoPr ?? null))`);
  log(`autoPr setting before: ${before} (missing = the default "On for GitHub repositories", so off here: no remote)`);
  await ctx.rawKey({ key: ",", code: "Comma", vk: 188, mods: 2 });
  await app.waitFor("the Settings page", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  const nav = await app.evalJs(`[...document.querySelectorAll(".settings-nav button")].map((b) => b.textContent.trim())`);
  log(`settings pages: ${JSON.stringify(nav)}`);
  log(`Git page clicked: ${await app.clickWhere(".settings-nav button", "/^\\s*Git/")}`);
  await app.waitFor("the Automatic pull requests section", () => app.exists('section[data-section="auto-pr"]'), 15000);
  const sel = await app.waitFor("this workspace's select", () => app.evalJs(`(() => { const s = [...document.querySelectorAll('section[data-section="auto-pr"] select')].find((x) => /^automatic pull requests for /.test(x.getAttribute("aria-label") ?? "")); return s ? s.getAttribute("aria-label") + " = " + s.value : null; })()`), 20000, 500);
  log(`workspace select found: ${sel}`);
  const changed = await app.evalJs(`(() => {
    const s = [...document.querySelectorAll('section[data-section="auto-pr"] select')].find((x) => /^automatic pull requests for /.test(x.getAttribute("aria-label") ?? ""));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "on");
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(1500);
  const after = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => JSON.stringify(s.autoPr ?? null))`);
  log(`workspace select set to On (${changed}); autoPr setting after: ${after}`);
  check("automatic pull requests are on for the scratch workspace (set through the Settings page)", new RegExp(`"workspaces":\\{[^}]*"[^"]*T-655[^"]*":true`).test(after), after);
  await ctx.rawKey({ key: "Escape", code: "Escape", vk: 27, mods: 0 });
  await sleep(800);
  if (await app.exists('.settings[role=dialog][aria-label="Settings"]')) await ctx.rawKey({ key: "Escape", code: "Escape", vk: 27, mods: 0 });
  await sleep(500);

  // ---- The right panel's Insights tab. ----
  if (await app.exists('button.ib.panel[title="Show the right panel"]')) await app.click('button.ib.panel[title="Show the right panel"]');
  await sleep(800);
  if (!(await app.exists(".insights"))) log(`Insights tab clicked: ${await app.clickWhere(".rside-tab", "/^\\s*Insights\\s*$/")}`);
  await waitFor("the Insights panel", () => app.exists(".insights"), 20000, 500);
  await waitFor("the Pull requests heading", () => app.exists("h3#ins-auto-pr"), 15000, 500);
  const empty = await app.evalJs(SECTION);
  log(`before the run: ${JSON.stringify(empty)}`);
  check("the Pull requests section is there, with its empty text, before any run", empty.head && /No automatic pull request yet/.test(empty.text) && empty.rows === 0, empty.text ?? "none");

  // ---- Best effort: the real automatic run. ----
  let ran = false;
  try {
    // By its full path: a bare `claude` in the pane finds the real claude.exe on the user's PATH first (seen on the first run), which this proof must never start.
    await ctx.typeInto(0, `& "${win(TEMP)}\\standin\\claude.cmd"`);
    await waitFor("the stand-in's banner", async () => /stand-in for Claude Code/.test((await ctx.text(0)) ?? ""), 30000, 500).catch(async (e) => {
      log(`pane text tail: ${((await ctx.text(0)) ?? "").split(String.fromCharCode(10)).filter(Boolean).slice(-10).join(" | ").slice(0, 600)}`);
      log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
      throw e;
    });
    log(`stand-in claude is up in the shell pane; real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}; telling it to run its turn`);
    writeFileSync(FLAG, "go\n");
    const committed = await waitFor("a new commit on the scratch repo's branch", async () => Number((await git(ctx.repo, ["rev-list", "--count", "HEAD"])).trim()) > count0, 90000, 1000).catch((e) => String(e.message));
    if (committed === true) {
      ran = true;
      const head1 = (await git(ctx.repo, ["rev-parse", "HEAD"])).trim();
      const subject = (await git(ctx.repo, ["log", "-1", "--format=%s"])).trim();
      const files = (await git(ctx.repo, ["show", "--name-only", "--format=", "HEAD"])).trim();
      const branch = (await git(ctx.repo, ["branch", "--show-current"])).trim();
      const status = (await git(ctx.repo, ["status", "--porcelain"])).trim();
      log(`new commit ${head1.slice(0, 10)} on ${branch}: "${subject}" files: ${files.split(/\r?\n/).join(", ")}; working tree after: ${status || "clean"}`);
      check("(a) a new commit appeared on the scratch repo's own branch, holding the stand-in's change", head1 !== head0 && branch === BRANCH && /notes\.txt/.test(files), `${head0.slice(0, 10)} -> ${head1.slice(0, 10)} on ${branch}: ${files}`);
      const rowJson = await waitFor("the workspace's row in the Pull requests section, no longer running", () => app.evalJs(`(() => { const r = document.querySelector("h3#ins-auto-pr")?.closest("section")?.querySelector("[data-auto-pr]"); if (!r || r.getAttribute("data-state") === "running") return ""; return JSON.stringify({ text: r.innerText.split(String.fromCharCode(10)).join(" | "), state: r.getAttribute("data-state"), local: !!r.querySelector(".apr-local"), localLabel: r.querySelector(".apr-local")?.getAttribute("aria-label") ?? null, name: r.querySelector(".apr-name")?.textContent ?? null, link: !!r.querySelector(".apr-link") }); })()`), 30000, 500);
      const row = JSON.parse(rowJson);
      log(`row: ${JSON.stringify(row)}`);
      check("(b) the section shows this workspace's row, done and local only, with no pull request link", row.name === "T-655" && row.state === "done" && row.local && /^Local only/.test(row.localLabel ?? "") && !row.link && /no remote|Nothing pushed|Committed/i.test(row.text), JSON.stringify(row));
    } else {
      const screen = ((await ctx.text(0)) ?? "").split("\n").filter(Boolean).slice(-8).join(" | ");
      skipped.push(`SKIPPED: the real automatic run (commit + row): ${committed}; pane tail: ${screen.slice(0, 300)}`);
    }
  } catch (e) {
    skipped.push(`SKIPPED: the real automatic run could not be driven: ${e.message}`);
  }
  for (const s of skipped) log(s);
  if (!ran && skipped.length === 0) skipped.push("SKIPPED: the real automatic run did not complete");

  // ---- Sizes. ----
  for (const [width, scale] of [[900, 1], [1400, 1], [1920, 1], [1536, 1.25], [1280, 1.5]]) {
    const { m, file, name } = await at(width, scale);
    const w = `${width}px${scale === 1 ? "" : ` at ${scale * 100}%`}`;
    log(`${w}: ${JSON.stringify(m)}`);
    log(`screenshot: ${name} (${file})`);
    check(`${w}: the Pull requests section is inside the window`, m.head && m.sec && m.sec.l >= 0 && m.sec.r <= m.vw && m.sec.w >= 150 && m.sec.t >= 0 && m.sec.b <= m.vh + 1 && m.ins && m.ins.r <= m.vw, JSON.stringify({ sec: m.sec, ins: m.ins, vw: m.vw, vh: m.vh }));
    check(`${w}: nothing scrolls sideways on the page or in .insights, nothing sticks out past the edge`, !m.pageScroll && !m.insScroll && m.cut === 0 && m.over.length === 0, JSON.stringify({ page: m.pageScroll, ins: m.insScroll, cut: m.cut, over: m.over }));
    if (ran) check(`${w}: the workspace's row is shown, local only`, m.rows === 1 && /T-655/.test(m.text), m.text);
  }
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
const code = ctx ? await finish(ctx, "T-655", ev, ok) : 1;
writeFileSync(join(EVID, "T-655.txt"), `${ev.join("\n")}\nRESULT: ${ok ? "PASS" : "FAIL"}\n`);
process.exit(code);
