// retired: the code editor and its Compare view were removed in fccac517, so there is no buffer to compare against the disk.
// LIVE proof, EDIT-003 box 3 (spec/12): with unsaved edits and the file changed on disk, Compare shows the disk copy on the left and the buffer on the right.
import { reporter, startPlain, finish, sleep, poll, checker, editRepo, clickTab, clickRow, tabs, vis, visText, cmOf, typeInTerminal } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-003", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  await clickRow(app, "top.txt");
  await sleep(1200);
  await app.evalJs(`(()=>{const p=${visText}; const v=${cmOf("p")}; v.focus(); v.dispatch({selection:{anchor:v.state.doc.length}}); return true;})()`);
  await app.cdp("insert", "MY-EDIT");
  await sleep(600);
  const mine = await app.evalJs(`${cmOf(visText)}.state.doc.toString()`);
  log(`buffer after typing: ${JSON.stringify(mine)}`);
  check("setup: the buffer holds the unsaved edit", /MY-EDIT/.test(mine), JSON.stringify(mine));
  await clickTab(app, "Terminal");
  await sleep(1000);
  await typeInTerminal(app, "Set-Content top.txt DISK-REWRITE -NoNewline");
  await sleep(2500);
  await clickTab(app, "top.txt");
  const banner = await poll(() => app.evalJs(`(()=>{const b=${vis()}?.querySelector(".disk-changed"); return b?{text:b.textContent, btns:[...b.querySelectorAll("button")].map(x=>x.textContent)}:null;})()`), 15000, 600);
  log(`banner: ${JSON.stringify(banner)}`);
  check("the disk-changed banner offers Reload, Keep my edits and Compare", !!banner && ["Reload", "Keep my edits", "Compare"].every((b) => banner.btns.includes(b)), JSON.stringify(banner));
  await app.evalJs(`[...${vis()}.querySelectorAll(".disk-changed button")].find(b=>b.textContent==="Compare").click()`);
  await sleep(1500);
  const cmp = await app.evalJs(`(()=>{const c=${vis()}.querySelector(".compare-view"); if(!c) return null; const x=e=>e?Math.round(e.getBoundingClientRect().left):null; const heads=[...c.querySelectorAll(".compare-head")].map(h=>({cls:h.className, text:h.textContent.trim(), x:x(h)})); const a=c.querySelector(".cm-merge-a .cm-content"), b=c.querySelector(".cm-merge-b .cm-content"); return {heads, aX:x(a), bX:x(b), aText:a?.cmTile.view.state.doc.toString(), bText:b?.cmTile.view.state.doc.toString()};})()`);
  log(`compare: ${JSON.stringify(cmp)}`);
  const disk = cmp?.heads.find((h) => /disk/.test(h.cls));
  const own = cmp?.heads.find((h) => /mine/.test(h.cls));
  check("Compare: heading Disk copy sits left of Your edits", !!disk && !!own && /Disk copy/.test(disk.text) && /Your edits/.test(own.text) && disk.x < own.x, JSON.stringify(cmp?.heads));
  check("Compare: the left editor holds the disk copy and the right editor holds the buffer", !!cmp && cmp.aText === "DISK-REWRITE" && /MY-EDIT/.test(cmp.bText) && cmp.aX < cmp.bX, JSON.stringify({ aText: cmp?.aText, bText: cmp?.bText, aX: cmp?.aX, bX: cmp?.bX }));
  log(`screenshot: ${await ctx.shot("EDIT-003-compare")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-003", ev, ok) : 1);
