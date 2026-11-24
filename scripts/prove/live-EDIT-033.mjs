// retired: the Explorer tree it drove was removed in fccac517, so there are no .ex-row rows or "Hide the explorer" control.
// LIVE proof, EDIT-033 box 1 (spec/12): Mod+Shift+E opens the explorer; Down, Right, Down, Enter opens the first file of the second folder.
import { reporter, startPlain, finish, sleep, checker, editRepo, tabs } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-033", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  const rows = () => app.evalJs(`[...document.querySelectorAll(".ex-row")].map(r=>r.textContent.trim()+(r.ariaSelected==="true"?"*":"")+(r.ariaExpanded==="true"?"+":""))`);
  const open = () => app.evalJs(`!!document.querySelector("aside.explorer:not([hidden])")`);
  log(`start: explorer open ${await open()}; rows ${JSON.stringify(await rows())}`);
  await app.evalJs(`document.querySelector('button[aria-label="Hide the explorer"]').click()`);
  await sleep(600);
  check("setup: the explorer is closed", (await open()) === false, `open=${await open()}`);
  await app.cdp("key", "e", "10"); // Ctrl+Shift+E
  await sleep(800);
  check("Mod+Shift+E opens the explorer with focus in the tree", (await open()) === true && (await app.evalJs(`!!document.activeElement.closest("aside.explorer")`)) === true, `open=${await open()}`);
  const folders = (await rows()).filter((r) => !/\./.test(r));
  log(`rows after open: ${JSON.stringify(await rows())}`);
  const second = folders[1].replace(/[*+]/g, "");
  for (const k of ["ArrowDown", "ArrowRight", "ArrowDown", "Enter"]) {
    await app.cdp("key", k);
    await sleep(700);
    log(`after ${k}: ${JSON.stringify(await rows())}`);
  }
  await sleep(800);
  const t = await tabs(app);
  log(`tabs: ${JSON.stringify(t)}`);
  const selected = t.find((x) => x.endsWith(":true")) ?? "";
  const title = await app.evalJs(`(()=>{const p=[...document.querySelectorAll("section.pane.editor")].find(p=>p.offsetParent!==null); return p?.querySelector(".title")?.textContent ?? null})()`);
  const first = await app.evalJs(`[...document.querySelectorAll(".ex-row")].map(r=>r.textContent.trim())`);
  // beta holds four.txt and three.txt; sorted by name the first is four.txt.
  check(`the second folder is "${second}" and the opened file is its first child (four.txt)`, second === "beta" && /^four\.txt/.test(selected) && /four\.txt/.test(title ?? ""), `second=${second} selectedTab=${selected} title=${title}`);
  check("the explorer lists four.txt directly below beta", first.indexOf("four.txt") === first.indexOf("beta") + 1, JSON.stringify(first.slice(0, 8)));
  log(`screenshot: ${await ctx.shot("EDIT-033-opened")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-033", ev, ok) : 1);
