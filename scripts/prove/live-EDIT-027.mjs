// retired: it opens an inline diff by clicking a file in the Source Control panel (removed by T-644); the same diff is reachable from the All Changes file rows and needs rewriting there
// LIVE proof, EDIT-027 boxes 1+2 (spec/12): a diff opens inline; two columns -> side by side; F7 lands the caret on the next change;
// a change made in a terminal shows up in the open diff without reopening it.
import { reporter, startPlain, finish, sleep, poll, checker, editRepo, clickTab, clickScm, openScm, tabs, vis, cmOf, typeInTerminal } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-027", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  await openScm(app);
  await sleep(1500);
  const rowOk = await poll(() => clickScm(app, "multi.txt"), 15000, 700);
  check("setup: Source Control lists multi.txt and its row opens a diff", !!rowOk, `row clicked=${!!rowOk}`);
  await sleep(2000);
  const diff = () => app.evalJs(`(()=>{const p=${vis(".diff")}; if(!p) return null; const lay=[...p.querySelectorAll('.view-switch[aria-label=Layout] button')].map(b=>b.textContent+":"+b.ariaPressed); return {title:p.querySelector(".title").textContent, layout:lay, editors:p.querySelectorAll(".cm-editor").length, a:p.querySelectorAll(".cm-merge-a").length, b:p.querySelectorAll(".cm-merge-b").length};})()`);
  const inline = await diff();
  log(`diff opened: ${JSON.stringify(inline)}`);
  check("a diff opens inline (one editor, Inline pressed)", inline && inline.editors === 1 && inline.layout.includes("Inline:true"), JSON.stringify(inline));
  await app.evalJs(`[...${vis(".diff")}.querySelectorAll('.view-switch[aria-label=Layout] button')].find(b=>b.textContent==="Side by side").click()`);
  await sleep(1500);
  const sbs = await diff();
  log(`after Side by side: ${JSON.stringify(sbs)}`);
  check("two columns: side by side (two editors, old on the left and new on the right)", sbs && sbs.editors === 2 && sbs.a === 1 && sbs.b === 1 && sbs.layout.includes("Side by side:true"), JSON.stringify(sbs));
  const caret = () => app.evalJs(`(()=>{const v=${cmOf(vis(".diff"), ".cm-merge-b .cm-content")}; const l=v.state.doc.lineAt(v.state.selection.main.head); return {line:l.number,text:l.text};})()`);
  await app.evalJs(`(()=>{const v=${cmOf(vis(".diff"), ".cm-merge-b .cm-content")}; v.focus(); v.dispatch({selection:{anchor:0}}); return true;})()`);
  const c0 = await caret();
  await ctx.rawKey({ key: "F7", code: "F7", vk: 118 });
  await sleep(700);
  const c1 = await caret();
  await ctx.rawKey({ key: "F7", code: "F7", vk: 118 });
  await sleep(700);
  const c2 = await caret();
  log(`caret: start ${JSON.stringify(c0)}, F7 -> ${JSON.stringify(c1)}, F7 -> ${JSON.stringify(c2)}`);
  check("F7 moves the caret to the next change (row 20, then row 45)", c0.line === 1 && c1.line === 20 && /row 20 CHANGED/.test(c1.text) && c2.line === 45 && /row 45 CHANGED/.test(c2.text), JSON.stringify({ c0, c1, c2 }));
  log(`screenshot: ${await ctx.shot("EDIT-027-sidebyside")}`);

  // Box 2: change the file from the terminal while the diff tab is open.
  const lines = () => app.evalJs(`(()=>{const p=${vis(".diff")}; if(!p) return null; const d=p.querySelector(".cm-merge-b .cm-content").cmTile.view.state.doc; return {lines:d.lines, last:d.line(d.lines).text, prev:d.line(d.lines-1).text};})()`);
  const l0 = await lines();
  const tabs0 = await tabs(app);
  await clickTab(app, "Terminal");
  await sleep(1000);
  await typeInTerminal(app, "Add-Content multi.txt APPENDED-LINE");
  await sleep(1500);
  await clickTab(app, "multi.txt");
  const l1 = await poll(async () => { const l = await lines(); return l && l.lines > l0.lines ? l : null; }, 20000, 800);
  const tabs1 = await tabs(app);
  log(`diff lines before ${JSON.stringify(l0)}; after ${JSON.stringify(l1 || await lines())}; tabs before ${JSON.stringify(tabs0)} after ${JSON.stringify(tabs1)}`);
  check("the open diff shows the appended line without reopening (same tabs, one more row)", !!l1 && l1.lines === l0.lines + 1 && /APPENDED-LINE/.test(`${l1.last}|${l1.prev}`) && tabs1.length === tabs0.length, JSON.stringify({ l0, l1, tabs0, tabs1 }));
  log(`screenshot: ${await ctx.shot("EDIT-027-updated")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-027", ev, ok) : 1);
