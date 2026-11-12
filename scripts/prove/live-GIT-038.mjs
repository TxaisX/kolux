// LIVE proof, GIT-038 boxes 1+2 (spec/11): 10 changed files -> All Changes has 10 sections, the scroll position at the seventh survives
// a tab switch; Side by side and Whitespace change the layout and the change markers at once.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, reviewRepo, clickTab, openAllChanges, acCount, vis } from "./live-git-common.mjs";

const AC = vis(".all-changes");
const names = (app) => app.evalJs(`[...${AC}.querySelectorAll(".ac-section")].map(s=>s.querySelector(".ac-name").textContent)`);
const view = (app) => app.evalJs(`(()=>{const p=${AC}; const l=p.querySelector(".ac-list"); const lr=l.getBoundingClientRect(); const secs=[...p.querySelectorAll(".ac-section")]; const first=secs.find(s=>s.getBoundingClientRect().bottom>lr.top+4); return {tag:p.querySelector(".preview-tag")?.textContent??null, st:l.scrollTop, max:l.scrollHeight-l.clientHeight, first:first?first.querySelector(".ac-name").textContent:null, firstTop:first?Math.round(first.getBoundingClientRect().top-lr.top):null, mounted:secs.length};})()`);
const section = (name) => `(()=>{const p=${AC}; return [...p.querySelectorAll(".ac-section")].find(s=>s.querySelector(".ac-name").textContent===${JSON.stringify(name)});})()`;
const layoutOf = (app, name) => app.evalJs(`(()=>{const s=${section(name)}; if(!s) return null; return {editors:s.querySelectorAll(".cm-editor").length, merge:s.querySelectorAll(".cm-mergeView").length, changedLines:s.querySelectorAll(".cm-changedLine").length, other:s.querySelectorAll(".cm-changedText, .cm-deletedChunk, .cm-insertedLine, .cm-deletedLine").length};})()`);
/** Scrolls the list so the named section sits at its top (the list is windowed, so the offset is re-read until it settles). */
async function bringToTop(app, name) {
  for (let i = 0; i < 8; i++) {
    const r = await app.evalJs(`(()=>{const p=${AC}; const l=p.querySelector(".ac-list"); const s=${section(name)}; if(!s) return {found:false}; const d=s.getBoundingClientRect().top-l.getBoundingClientRect().top; l.scrollTop+=d; return {found:true,d};})()`);
    await sleep(700);
    if (r.found && Math.abs(r.d) < 3) return true;
    if (!r.found) await app.evalJs(`${AC}.querySelector(".ac-list").scrollTop+=400`);
  }
  return false;
}

export async function run038(ctx, { check, log }) {
  const { app } = ctx;
  await openAllChanges(app);
  await sleep(2500);
  const v0 = await view(app);
  const counted = await acCount(app);
  // Collect every section name by walking down the windowed list.
  const seen = new Set(await names(app));
  for (let i = 0; i < 40; i++) {
    await app.evalJs(`${AC}.querySelector(".ac-list").scrollTop+=350`);
    await sleep(500);
    for (const n of await names(app)) seen.add(n);
  }
  await app.evalJs(`${AC}.querySelector(".ac-list").scrollTop=0`);
  await sleep(800);
  const order = [...seen];
  log(`All Changes: ${JSON.stringify(v0)}; sections seen while scrolling (${order.length}): ${JSON.stringify(order)}`);
  check("box 1: 10 files changed and All Changes holds 10 sections (tag and the section names)", counted.count === 10 && /^10 files/.test(v0?.tag ?? "") && order.length === 10, JSON.stringify({ ...counted, n: order.length }));
  const seventh = order[6];
  const placed = await bringToTop(app, seventh);
  const v1 = await view(app);
  log(`seventh section is ${seventh}; scrolled so it is first: placed=${placed}; ${JSON.stringify(v1)}`);
  check("setup: scrolled so the seventh section is the first one in view", placed && v1.first === seventh && v1.st > 500, JSON.stringify({ seventh, v1 }));
  await clickTab(app, "Terminal");
  await sleep(1500);
  const away = await app.evalJs(`!${AC} || ${AC}.offsetParent===null`);
  await clickTab(app, "All Changes");
  await sleep(1800);
  const v2 = await view(app);
  log(`switched to Terminal (All Changes hidden=${away}) and back: ${JSON.stringify(v2)}`);
  check("box 1: after switching tabs and back the list is still at the seventh section (same scroll position)", away && Math.abs(v2.st - v1.st) <= 2 && v2.first === seventh, JSON.stringify({ v1, v2 }));
  log(`screenshot: ${await ctx.shot("GIT-038-seventh")}`);

  // Box 2: layout and whitespace markers, on ws.txt (its only change moves whitespace).
  await bringToTop(app, "ws.txt");
  const ws0 = await layoutOf(app, "ws.txt");
  const opts0 = await app.evalJs(`({split:${AC}.querySelector('input[aria-label="Side by side"]').checked, spaces:${AC}.querySelector('input[aria-label="Show whitespace changes"]').checked})`);
  log(`defaults: ${JSON.stringify(opts0)}; ws.txt: ${JSON.stringify(ws0)}`);
  check("setup: defaults are inline with whitespace hidden, and ws.txt (whitespace-only change) shows no change marker", !opts0.split && !opts0.spaces && ws0 && ws0.merge === 0 && ws0.changedLines === 0, JSON.stringify({ opts0, ws0 }));
  await app.evalJs(`${AC}.querySelector('input[aria-label="Side by side"]').click()`);
  await sleep(1500);
  await bringToTop(app, "ws.txt");
  const ws1 = await layoutOf(app, "ws.txt");
  const opts1 = await app.evalJs(`({split:${AC}.querySelector('input[aria-label="Side by side"]').checked})`);
  log(`after Side by side: ${JSON.stringify(opts1)}; ws.txt: ${JSON.stringify(ws1)}`);
  check("box 2: Side by side turns the section into two editors at once", opts1.split && ws1 && ws1.merge === 1 && ws1.editors === 2, JSON.stringify({ opts1, ws1 }));
  log(`screenshot: ${await ctx.shot("GIT-038-side-by-side")}`);
  await app.evalJs(`${AC}.querySelector('input[aria-label="Show whitespace changes"]').click()`);
  await sleep(1500);
  await bringToTop(app, "ws.txt");
  const ws2 = await layoutOf(app, "ws.txt");
  const opts2 = await app.evalJs(`({split:${AC}.querySelector('input[aria-label="Side by side"]').checked, spaces:${AC}.querySelector('input[aria-label="Show whitespace changes"]').checked})`);
  log(`after Whitespace: ${JSON.stringify(opts2)}; ws.txt: ${JSON.stringify(ws2)}`);
  check("box 2: Whitespace makes the whitespace-only change show its markers at once (changed lines appear in ws.txt)", opts2.spaces && ws2 && ws2.changedLines > ws1.changedLines && ws2.changedLines > 0, JSON.stringify({ ws1, ws2 }));
  log(`screenshot: ${await ctx.shot("GIT-038-whitespace")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-038", { report: rep, ...reviewRepo() });
    await sleep(3000);
    await run038(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-038", ev, ok) : 1);
}
