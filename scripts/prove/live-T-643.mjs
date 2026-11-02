// LIVE proof, T-643 + T-641 + the footer part of T-642 (wave UI lane A): the left pane is clean at window widths 900, 1400
// and 1920 and at the sidebar's 220 and 480 px drag limits. Dev app hidden off-screen, scratch profile, stand-in claude.
// Run: node scripts/prove/live-T-643.mjs <220|480> [new|classic]
// Per window width it checks: nothing in the pane sticks out past its right edge, the list never scrolls sideways, every
// name cut short by an ellipsis carries a tooltip, no terminal rows, no "Check for updates" button; and takes a screenshot.
import { copyFileSync } from "node:fs";
import { ROOT, LIVE_LOGS, finish, reporter, sleep, startPlain } from "./live-common.mjs";
import { ps } from "../evidence/app-launch.mjs";

const side = process.argv[2] === "480" ? 480 : 220;
const look = process.argv[3] === "classic" ? "classic" : "new";
const id = `T-643-${side}-${look}`;
const report = reporter();
const { log, lines } = report;
const results = {};
const check = (name, ok, detail) => {
  results[name] = ok;
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
const LONG = "a-really-long-workspace-name-that-never-fits-in-the-sidebar";

const PANE = `(() => {
  const s = document.querySelector("aside.sidebar"); const sr = s.getBoundingClientRect();
  const vis = [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
  const out = vis.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > sr.right + 0.5 && !e.closest("[role=menu]"); })
    .map((e) => (e.className || e.tagName) + ":" + (e.title || e.textContent.trim().slice(0, 30)) + "@" + Math.round(e.getBoundingClientRect().right));
  const scrollers = vis.filter((e) => e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX)).map((e) => e.className);
  const cut = vis.filter((e) => e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis");
  const untipped = cut.filter((e) => !e.closest("[title]") && !e.closest("[aria-label]")).map((e) => e.textContent.trim().slice(0, 40));
  return { inner: innerWidth, sidebarW: Math.round(sr.width), out: out.slice(0, 8), scrollers, cut: cut.length, untipped,
    paneRows: s.querySelectorAll(".pane-row").length, updButton: [...s.querySelectorAll("button")].filter((b) => /check for updates/i.test(b.getAttribute("aria-label") + " " + b.textContent)).length };
})()`;

let ctx;
let ok = false;
try {
  log(`${id} live ${new Date().toISOString()}`);
  ctx = await startPlain(id, { report, noProject: true, standin: ["echo cwd=%CD%"], settings: { uiLook: look, leftSidebarWidth: side } });
  const { app } = ctx;
  await app.click('.sb-foot button[title^="Add a project by path"]');
  await app.waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
  await app.focusField('input[aria-label="project folder"]');
  await app.cdp("insert", `G:/Temp/live-v15/work/${id}`, "enter");
  await app.waitFor("the project row", () => app.exists("aside.sidebar .proj"), 30000);
  await sleep(3000);
  await app.click('aside.sidebar .proj button[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 5000);
  await app.focusField('input[aria-label="workspace name"]');
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", LONG);
  await sleep(500);
  await app.clickWhere("aside.sidebar button", "/^Create workspace$/");
  await app.waitFor("the new workspace row", () => app.exists("aside.sidebar [data-path]"), 60000);
  await sleep(3000);

  const dpr = await app.evalJs("devicePixelRatio");
  log(`devicePixelRatio ${dpr} (window widths below are CSS px, which is what 125%/150% scaling changes)`);
  const resize = async (w) => {
    let cx = Math.round(w * dpr);
    for (let i = 0; i < 4; i++) {
      await ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W2 -Namespace U2
        $h = (Get-Process -Id ${app.pid}).MainWindowHandle; [U2.W2]::SetWindowPos($h,[IntPtr]::Zero,0,0,${cx},${Math.round(860 * dpr)},0x0016) | Out-Null`);
      await sleep(900);
      const got = await app.evalJs("innerWidth");
      if (got === w) return got;
      cx += Math.round((w - got) * dpr);
    }
    return app.evalJs("innerWidth");
  };
  for (const width of [900, 1400, 1920]) {
    const got = await resize(width);
    // Hover the long workspace row so its hover buttons are drawn too.
    await app.evalJs(`document.querySelector("aside.sidebar [data-path] .sess")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`);
    await sleep(400);
    const p = await app.evalJs(PANE);
    check(`${width} px (got ${got}): sidebar ${side} px, nothing past its edge, no sideways scroll, every cut name has a tooltip, no terminal rows, no update button`,
      Math.abs(p.sidebarW - side) <= 2 && p.out.length === 0 && p.scrollers.length === 0 && p.untipped.length === 0 && p.paneRows === 0 && p.updButton === 0, p);
    // The update notice: a found update cannot be faked in a dev run, so a copy of UpdateCenterView's notice markup goes on
    // the page (the real update.css is already loaded with that lazy chunk) and is measured against the window.
    const n = await app.evalJs(`(() => {
      document.querySelector("#t643-notice")?.remove();
      const d = document.createElement("div"); d.id = "t643-notice"; d.className = "upd-pop upd-fixed"; d.setAttribute("role", "status");
      d.innerHTML = '<span class="upd-pop-text">A new Kolux RS version is out on GitHub. <span class="upd-pop-ver">Version 0.1.6.</span></span><span class="upd-pop-actions"><button type="button" class="btn">Later</button><button type="button" class="btn primary">Update now</button></span>';
      document.body.appendChild(d);
      const r = d.getBoundingClientRect(); const kids = [...d.querySelectorAll("*")].map((e) => e.getBoundingClientRect());
      return { position: getComputedStyle(d).position, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), inner: innerWidth, innerH: innerHeight,
        inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && kids.every((k) => k.right <= r.right + 0.5 && k.left >= r.left - 0.5),
        sideScroll: document.documentElement.scrollWidth > innerWidth };
    })()`);
    // After its 160 ms fade-in the notice is solid: an opaque background, so the sidebar never shows through it.
    await sleep(600);
    const look2 = await app.evalJs(`(() => { const c = getComputedStyle(document.querySelector("#t643-notice")); return { bg: c.backgroundColor, opacity: c.opacity }; })()`);
    Object.assign(n, look2);
    const solid = !/rgba\(.*,\s*0\)|transparent/.test(look2.bg) && Number(look2.opacity) === 1;
    check(`${width} px: the update notice sits fully inside the window, is solid, nothing in it sticks out, no sideways scroll`, n.position === "fixed" && n.inside && !n.sideScroll && solid, n);
    const shot = await ctx.shot(`${id}-${width}`);
    copyFileSync(shot,`${ROOT}/evidence/${id}-${width}.png`);
    await app.evalJs(`document.querySelector("#t643-notice")?.remove()`);
  }
  ok = Object.values(results).every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e.message}`);
}
log(`logs in ${LIVE_LOGS}`);
process.exitCode = ctx ? await finish(ctx, id, lines, ok) : 1;
