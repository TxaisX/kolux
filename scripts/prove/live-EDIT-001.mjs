// retired: the code editor tab it drove was removed in fccac517, so its caret and scroll can no longer be read back.
// LIVE proof, EDIT-001 box 2 (spec/12): go to the terminal view and come back -> same tab in front, caret and scroll where they were.
// "Terminal view" is read both ways: the terminal tab beside the editor tab, and the Agents screen then Terminals again.
import { reporter, startPlain, finish, sleep, checker, editRepo, clickTab, clickRow, pickScreen2, tabs, visText, cmOf } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-001", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  await clickRow(app, "long.txt");
  await sleep(1200);
  const reading = () => app.evalJs(`(()=>{const p=${visText}; if(!p) return null; const v=${cmOf("p")}; return {title:p.querySelector(".title").textContent, head:v.state.selection.main.head, top:v.scrollDOM.scrollTop, lines:v.state.doc.lines, selTab:[...document.querySelectorAll("div[role=tab]")].filter(t=>t.ariaSelected==="true").map(t=>t.textContent.trim())};})()`);
  await app.evalJs(`(()=>{const p=${visText}; const v=${cmOf("p")}; v.focus(); v.dispatch({selection:{anchor:v.state.doc.line(150).from+4}}); v.scrollDOM.scrollTop=1234; return true;})()`);
  await sleep(600);
  const before = await reading();
  log(`before: ${JSON.stringify(before)}`);
  check("setup: caret is inside the file and the editor is scrolled", before && before.head > 100 && before.top > 500, JSON.stringify(before));

  // Reading 1: the terminal tab next to the editor tab.
  await clickTab(app, "Terminal");
  await sleep(1200);
  const away1 = await app.evalJs(`({editorVisible: !!${visText}, tabs:[...document.querySelectorAll("div[role=tab]")].filter(t=>t.ariaSelected==="true").map(t=>t.textContent.trim())})`);
  log(`on the terminal tab: ${JSON.stringify(away1)}`);
  check("the terminal tab is in front while away", !away1.editorVisible && /^Terminal/.test(away1.tabs[0]), JSON.stringify(away1));
  await clickTab(app, "long.txt");
  await sleep(1200);
  const back1 = await reading();
  log(`back (terminal tab): ${JSON.stringify(back1)}`);
  check("terminal tab and back: same tab in front, same caret, same scroll", back1 && back1.title === before.title && back1.head === before.head && back1.top === before.top && /^long\.txt/.test(back1.selTab[0]), JSON.stringify(back1));

  // Reading 2: leave the Code screen for Agents and return to Terminals.
  await pickScreen2(app, "Agents");
  await sleep(1500);
  const away2 = await app.evalJs(`({pressed:[...document.querySelectorAll(".switcher button[aria-pressed=true]")].map(b=>b.textContent.trim()), visiblePanes:[...document.querySelectorAll("section.pane")].filter(p=>p.offsetParent!==null).length})`);
  log(`on Agents: ${JSON.stringify(away2)}`);
  await pickScreen2(app, "Terminals");
  await sleep(1500);
  const back2 = await reading();
  log(`back (Terminals screen): ${JSON.stringify(back2)} tabs ${JSON.stringify(await tabs(app))}`);
  check("Agents screen and back: same tab in front, same caret, same scroll", away2.pressed[0] === "Agents" && back2 && back2.title === before.title && back2.head === before.head && back2.top === before.top && /^long\.txt/.test(back2.selTab[0]), JSON.stringify(back2));
  log(`screenshot: ${await ctx.shot("EDIT-001-back")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-001", ev, ok) : 1);
