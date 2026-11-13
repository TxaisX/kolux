// retired: it opens a diff by clicking a file in the Source Control panel (removed by T-644); the F7 hunk flow needs rewriting onto the All Changes file rows
// LIVE proof, GIT-037 boxes 1+2 (spec/11): clicking an unstaged file opens its diff and F7 / Shift+F7 move the caret between hunks;
// a single click opens a preview tab that the next click on another file reuses (same tab, new file).
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, reviewRepo, clickScm, openScm, tabs, vis, cmOf } from "./live-git-common.mjs";

const diffInfo = (app) => app.evalJs(`(()=>{const p=${vis(".diff")}; if(!p) return null; const ed=p.querySelectorAll(".cm-editor"); return {title:p.querySelector(".title")?.textContent??null, editors:ed.length, cls:p.className, tag:p.querySelector(".preview-tag")?.textContent??null};})()`);

export async function run037(ctx, { check, log }) {
  const { app } = ctx;
  await openScm(app);
  await sleep(1500);
  const rowOk = await poll(() => clickScm(app, "multi.txt"), 20000, 700);
  check("setup: Source Control lists multi.txt and a single click on its row is accepted", !!rowOk, `clicked=${!!rowOk}`);
  await sleep(2000);
  const d = await poll(() => diffInfo(app), 10000, 500);
  log(`diff tab after one click: ${JSON.stringify(d)}; tabs ${JSON.stringify(await tabs(app))}`);
  check("box 1: the diff tab opens (inline, one editor) for the unstaged file", !!d && /multi\.txt/.test(d.title ?? "") && d.editors === 1, JSON.stringify(d));
  const caret = () => app.evalJs(`(()=>{const v=${cmOf(vis(".diff"))}; const l=v.state.doc.lineAt(v.state.selection.main.head); return {line:l.number,text:l.text};})()`);
  await app.evalJs(`(()=>{const v=${cmOf(vis(".diff"))}; v.focus(); v.dispatch({selection:{anchor:0}}); return true;})()`);
  const c0 = await caret();
  await ctx.rawKey({ key: "F7", code: "F7", vk: 118 });
  await sleep(700);
  const c1 = await caret();
  await ctx.rawKey({ key: "F7", code: "F7", vk: 118 });
  await sleep(700);
  const c2 = await caret();
  await ctx.rawKey({ key: "F7", code: "F7", vk: 118, mods: 8 });
  await sleep(700);
  const c3 = await caret();
  log(`caret: start ${JSON.stringify(c0)}; F7 -> ${JSON.stringify(c1)}; F7 -> ${JSON.stringify(c2)}; Shift+F7 -> ${JSON.stringify(c3)}`);
  check("box 1: F7 moves the caret to the next hunk (row 20, then row 45) and Shift+F7 goes back", c0.line === 1 && c1.line === 20 && /row 20 CHANGED/.test(c1.text) && c2.line === 45 && /row 45 CHANGED/.test(c2.text) && c3.line === 20, JSON.stringify({ c0, c1, c2, c3 }));
  log(`screenshot: ${await ctx.shot("GIT-037-f7")}`);

  // Box 2: tag the open diff tab's element, then single-click another file.
  const mark = `m${Date.now()}`;
  await app.evalJs(`(()=>{const t=[...document.querySelectorAll("div[role=tab]")].find(t=>t.textContent.includes("multi.txt")); t.dataset.proveMark=${JSON.stringify(mark)}; return !!t;})()`);
  const before = await tabs(app);
  const clicked = await poll(() => clickScm(app, "g01.txt"), 10000, 500);
  await sleep(2000);
  const after = await tabs(app);
  const info = await app.evalJs(`(()=>{const t=[...document.querySelectorAll("div[role=tab]")].filter(t=>t.dataset.proveMark===${JSON.stringify(mark)}); return {sameElement:t.length, text:t[0]?.textContent.trim()??null, selected:t[0]?.ariaSelected??null, diffTabs:[...document.querySelectorAll("div[role=tab]")].filter(t=>/\.txt/.test(t.textContent)).map(t=>t.textContent.trim())};})()`);
  const d2 = await diffInfo(app);
  log(`clicked g01=${!!clicked}; tabs before ${JSON.stringify(before)}; after ${JSON.stringify(after)}; tagged tab now ${JSON.stringify(info)}; diff pane ${JSON.stringify(d2)}`);
  check("box 2: the second click replaced the first in the same tab (same tab element now titled g01.txt, no multi.txt tab, one file tab)", info.sameElement === 1 && /g01\.txt/.test(info.text ?? "") && info.selected === "true" && info.diffTabs.length === 1 && !info.diffTabs.some((t) => /multi\.txt/.test(t)) && /g01\.txt/.test(d2?.title ?? ""), JSON.stringify({ info, d2 }));
  log(`screenshot: ${await ctx.shot("GIT-037-replaced")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-037", { report: rep, ...reviewRepo() });
    await sleep(3000);
    await run037(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-037", ev, ok) : 1);
}
