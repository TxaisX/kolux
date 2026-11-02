// LIVE proof, audit loop item 1 (cycle 5): T-612, T-621 and T-625 on the dev app, hidden off-screen, a fresh scratch
// profile, a stand-in claude (no real agent, no sign-in). Run: node scripts/prove/live-audit-1.mjs
//  T-612  the first-run wizard finishes after Continue on "Your work" (Open a session with no project opens Add Project;
//         the folder added gets the first AI, once), and on later launches the Tip card's Close button and Escape close it.
//  T-621  at 900, 1400 and 1920 px the switcher's four segments sit inside its frame, nothing covers them, and a real
//         mouse click on Tower's centre selects Tower.
//  T-625  the left sidebar at 220 px: the footer fits, and a screenshot of it (evidence/T-625.png).
// The native folder picker is not driven: the folder goes in through the sidebar's by-path field, which reports the add
// through the same onAdded (useWizard projectAdded) as "Open a folder…".
import { copyFileSync } from "node:fs";
import { ROOT, LIVE_LOGS, TERM, finish, reporter, sleep, startPlain } from "./live-common.mjs";
import { ps } from "../evidence/app-launch.mjs";

const report = reporter();
const { log, lines } = report;
const results = {};
const check = (name, ok, detail) => {
  results[name] = ok;
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

/** One CDP call on the page target (the same target live-common's shot() uses). */
async function cdpCall(method, params = {}) {
  const targets = await (await fetch("http://127.0.0.1:9290/json")).json();
  const t = targets.find((x) => x.type === "page" && /localhost:1470|tauri\.localhost/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const res = await new Promise((resolve) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result ?? m.error); };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return res;
}
const mouseClick = async (x, y) => {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdpCall("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
};

let ctx;
let code = 1;
try {
  log(`audit item 1 live proof ${new Date().toISOString()} on ${ROOT}`);
  ctx = await startPlain("audit-1", { report, noProject: true, keepFirstRun: true, standin: ["echo cwd=%CD%"], settings: { leftSidebarWidth: 220 } });
  const { app, repo } = ctx;
  const { evalJs, exists, clickWhere, cdp, waitFor: wf } = app;
  const wizard = '[role="dialog"][aria-label="Get started with Kolux"]';
  const heading = () => evalJs(`document.querySelector(${JSON.stringify(wizard)} + " h1, " + ${JSON.stringify(wizard)} + " h2")?.textContent ?? null`);

  // ---- T-612 A: the wizard ----
  await wf("the first-run wizard", () => exists(wizard), 30000);
  log(`wizard up: ${await heading()}`);
  await clickWhere(`${wizard} button`, "/^\\s*Get started/");
  await sleep(800);
  log(`after Get started: ${await heading()}`);
  await clickWhere(`${wizard} button`, "/do this later/");
  await sleep(800);
  const onWork = await heading();
  log(`after "I'll do this later": ${onWork}`);
  await clickWhere(`${wizard} button.onb-main`, "/^\\s*Continue/");
  await sleep(800);
  const onSession = await heading();
  log(`after Continue on Your work: ${onSession}`);
  await clickWhere(`${wizard} button.onb-main`, "/^\\s*Open a session/");
  await sleep(1500);
  const wizardGone = !(await exists(wizard));
  const addOpen = await exists('[role="dialog"][aria-label="Add project"]');
  check("T-612 wizard reaches Open a session after Continue on Your work", onWork === "Your work" && onSession === "Open a session", { onWork, onSession });
  check("T-612 Open a session with no project closes the wizard and opens Add Project", wizardGone && addOpen, { wizardGone, addOpen });
  await ctx.shot("audit-1-add-project");
  await cdp("key", "Escape");
  await sleep(800);
  await app.click('.sb-foot button[title^="Add a project by path"]');
  await wf("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
  await app.focusField('input[aria-label="project folder"]');
  await cdp("insert", repo, "enter");
  await wf("a pane for the folder", async () => (await app.shown(TERM)) >= 1, 30000);
  await sleep(4000);
  const agents = await evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).map(e => e.getAttribute("data-agent"))`);
  const buf = ((await ctx.lines(0))?.lines ?? []).join("\n");
  const cwdLine = buf.split("\n").find((l) => l.startsWith("cwd=")) ?? "";
  const inFolder = cwdLine.toLowerCase().replace(/\\/g, "/").includes(repo.toLowerCase().replace(/\\/g, "/"));
  check("T-612 the folder added gets the first AI, in that folder, once", agents.length === 1 && /claude/.test(agents[0] ?? "") && inFolder, { agents, cwdLine });
  const onb = await app.invoke("onboarding_get").catch((e) => `error ${e.message}`);
  log(`onboarding record: ${JSON.stringify(onb)}`);

  // ---- T-625: the footer at 220 px (seeded leftSidebarWidth) ----
  const foot = await evalJs(`(() => { const s = document.querySelector("aside.sidebar"), f = document.querySelector(".sb-foot"), u = f?.querySelector("button.upd"), l = u?.querySelector(".label");
    const r = (e) => e ? e.getBoundingClientRect() : null; const fr = r(f), ur = r(u), sr = r(s);
    return { sidebarW: sr && Math.round(sr.width), footLeft: fr && fr.left, footRight: fr && fr.right, footTop: fr && fr.top, footBottom: fr && fr.bottom, updRight: ur && ur.right, updWidth: ur && Math.round(ur.width),
      label: l ? getComputedStyle(l).display : "no label", buttonsInside: [...(f?.querySelectorAll("button") ?? [])].filter(b => b.getClientRects().length).every(b => { const x = b.getBoundingClientRect(); return x.left >= fr.left - 0.5 && x.right <= fr.right + 0.5; }) }; })()`);
  const fitOk = foot.sidebarW !== null && foot.sidebarW <= 222 && foot.buttonsInside && foot.updRight <= foot.footRight + 0.5;
  check("T-625 every footer button fits inside the 220 px sidebar's footer", fitOk, foot);
  if (foot.footTop !== null) {
    const shot = await cdpCall("Page.captureScreenshot", { format: "png", clip: { x: 0, y: Math.max(0, foot.footTop - 120), width: Math.ceil(foot.footRight + 24), height: Math.ceil(foot.footBottom - foot.footTop + 136), scale: 2 } });
    if (shot?.data) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${ROOT}/evidence/T-625.png`, Buffer.from(shot.data, "base64"));
      log(`T-625 footer screenshot: evidence/T-625.png`);
    }
  }
  log(`whole window: ${await ctx.shot("audit-1-sidebar-220")}`);

  // ---- T-621: the switcher at 900, 1400, 1920 ----
  const dpr = await evalJs("devicePixelRatio");
  const resize = async (w) => {
    let cx = Math.round(w * dpr);
    for (let i = 0; i < 4; i++) {
      await ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W2 -Namespace U2
        $h = (Get-Process -Id ${app.pid}).MainWindowHandle; [U2.W2]::SetWindowPos($h,[IntPtr]::Zero,0,0,${cx},${Math.round(860 * dpr)},0x0016) | Out-Null`);
      await sleep(900);
      const got = await evalJs("innerWidth");
      if (got === w) return got;
      cx += Math.round((w - got) * dpr);
    }
    return evalJs("innerWidth");
  };
  for (const width of [900, 1400, 1920]) {
    const got = await resize(width);
    const g = await evalJs(`(() => {
      const R = (s) => document.querySelector(s)?.getBoundingClientRect();
      const nav = R("nav.switcher"), right = R(".topbar-right");
      const segs = [...document.querySelectorAll("nav.switcher button")];
      const rect = (b) => b.getBoundingClientRect();
      const covered = segs.filter((s) => { const r = rect(s); return !s.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)); }).map((s) => s.textContent.trim());
      const outsideFrame = segs.filter((s) => rect(s).left < nav.left - 0.5 || rect(s).right > nav.right + 0.5).map((s) => s.textContent.trim());
      const offWindow = [...document.querySelectorAll("header button")].filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > innerWidth + 0.5).map((n) => n.title || n.getAttribute("aria-label") || n.textContent.trim());
      const tower = segs.find((s) => /Tower/.test(s.textContent)); const tr = tower && rect(tower);
      return { inner: innerWidth, segs: segs.map((s) => s.textContent.trim()), navLeft: Math.round(nav.left), navRight: Math.round(nav.right), rightLeft: right ? Math.round(right.left) : null,
        lastSeg: Math.round(rect(segs[segs.length - 1]).right), covered, outsideFrame, offWindow, tower: tr ? { x: (tr.left + tr.right) / 2, y: (tr.top + tr.bottom) / 2 } : null };
    })()`);
    const fits = got === width && g.segs.length === 4 && g.covered.length === 0 && g.outsideFrame.length === 0 && g.offWindow.length === 0 && (g.rightLeft === null || g.navRight <= g.rightLeft);
    check(`T-621 ${width} px: four segments inside the frame, none covered, right group clear, window controls inside`, fits, { got, ...g });
    let towerOk = false;
    if (g.tower) {
      await clickWhere("nav.switcher button", "/^\\s*Terminals/").catch(() => {});
      await sleep(500);
      await mouseClick(g.tower.x, g.tower.y);
      await sleep(900);
      const pressed = await evalJs(`[...document.querySelectorAll("nav.switcher button")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent.trim())`);
      towerOk = pressed.length === 1 && /Tower/.test(pressed[0]);
      check(`T-621 ${width} px: a real click on Tower's centre selects Tower`, towerOk, { pressed });
    } else check(`T-621 ${width} px: a real click on Tower's centre selects Tower`, false, "no Tower segment");
    log(`window at ${width}: ${await ctx.shot(`audit-1-switcher-${width}`)}`);
    await clickWhere("nav.switcher button", "/^\\s*Terminals/").catch(() => {});
    await sleep(400);
  }

  // ---- T-612 B: the Tip card on later launches ----
  const tipSel = '[role="dialog"][aria-label="Tip"]';
  for (const round of [1, 2]) {
    await app.closeApp();
    await app.relaunch();
    const shown = await wf("a Tip card", () => exists(tipSel), 20000).then(() => true, () => false);
    const text = shown ? await evalJs(`document.querySelector(${JSON.stringify(tipSel)}).innerText.replace(/\\s+/g, " ").slice(0, 160)`) : null;
    log(`relaunch ${round}: Tip shown ${shown}: ${text}`);
    if (!shown) { check(`T-612 relaunch ${round}: a Tip card shows`, false, "none in 20 s"); continue; }
    if (round === 1) {
      const install = await clickWhere(`${tipSel} button`, "/Install CLI/").then(() => true, () => false);
      await sleep(800);
      const hasClose = await evalJs(`[...document.querySelectorAll(${JSON.stringify(tipSel + " button")})].some(b => b.textContent.trim() === "Close")`);
      log(`clicked Install CLI & Skills: ${install}; the card now has a Close button: ${hasClose}`);
      await ctx.shot("audit-1-tip-close");
      await clickWhere(`${tipSel} button`, "/^\\s*Close\\s*$/").catch(() => {});
      await sleep(800);
      check("T-612 the Tip card's Close button closes it", install && hasClose && !(await exists(tipSel)), { install, hasClose, open: await exists(tipSel) });
    } else {
      const panes = await app.shown(TERM);
      if (panes >= 1) await app.focusPane(TERM, 0, ".xterm-helper-textarea").catch((e) => log(`focus pane: ${e.message}`));
      const focused = await evalJs(`document.activeElement?.className ?? null`);
      await cdp("key", "Escape");
      await sleep(800);
      check("T-612 Escape closes the Tip with the keyboard elsewhere (a terminal focused when one is open)", !(await exists(tipSel)), { panes, focused });
    }
  }
  copyFileSync(`${ROOT}/evidence/T-625.png`, `${LIVE_LOGS}/audit-1-T-625.png`);
  code = Object.values(results).every(Boolean) ? 0 : 1;
} catch (e) {
  log(`ERROR ${e.stack ?? e.message}`);
}
log(`results ${JSON.stringify(results)}`);
process.exitCode = ctx ? await finish(ctx, "audit-1", lines, code === 0) : 1;
