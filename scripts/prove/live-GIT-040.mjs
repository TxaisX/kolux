// retired: it opens a diff by clicking a file in the Source Control panel (removed by T-644); the line-note flow needs rewriting onto the All Changes file rows
// LIVE proof, GIT-040 box 2 (spec/11): a review note added with the gutter plus, then edited through its Edit button (the open card
// updates), then removed with the trash button (the card is gone). The note is added the way a person adds one; box 1's placement is already ticked.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, reviewRepo, clickScm, openScm, vis, cmOf } from "./live-git-common.mjs";

const cards = (app) => app.evalJs(`(()=>{const p=${vis(".diff")}; if(!p) return null; return [...p.querySelectorAll("[data-note]")].map(c=>({id:c.dataset.note, text:c.querySelector(".diff-note-text")?.textContent??null, head:c.querySelector(".what")?.textContent??null}));})()`);
const pop = (app) => app.evalJs(`(()=>{const d=document.querySelector(".diff-note-pop"); return d?{label:d.getAttribute("aria-label"), value:d.querySelector("textarea")?.value??null}:null;})()`);
const clickPopButton = (app, label) => app.evalJs(`(()=>{const b=[...document.querySelectorAll(".diff-note-pop button")].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b||b.disabled) return false; b.click(); return true;})()`);
const gutterAt = `(()=>{const p=${vis(".diff")}; const v=${cmOf(vis(".diff"))}; const c=v.coordsAtPos(v.state.doc.line(20).from); const els=[...p.querySelectorAll(".cm-note-gutter .cm-gutterElement")]; const el=els.find(e=>{const r=e.getBoundingClientRect(); return r.height>0 && Math.abs(r.top-c.top)<4;}); return {el, n:els.length};})()`;

export async function run040(ctx, { check, log }) {
  const { app } = ctx;
  await openScm(app);
  await sleep(1500);
  await poll(() => clickScm(app, "multi.txt"), 20000, 700);
  await sleep(2500);
  check("setup: the diff of multi.txt is open", !!(await poll(() => app.evalJs(`!!${vis(".diff")}`), 8000, 400)), "diff pane visible");
  // The gutter element beside line 20 (the first changed line), found by that line's vertical position.
  const gut = await app.evalJs(`(()=>{const g=${gutterAt}; return {found:!!g.el, gutters:g.n};})()`);
  log(`gutter for line 20: ${JSON.stringify(gut)}`);
  check("setup: the note gutter has an element beside line 20", gut.found, JSON.stringify(gut));
  await app.evalJs(`(()=>{const g=${gutterAt}; const r=g.el.getBoundingClientRect(); g.el.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:r.left+7,clientY:r.top+5})); return true;})()`);
  await sleep(800);
  const p0 = await poll(() => pop(app), 6000, 300);
  log(`popover after the plus: ${JSON.stringify(p0)}`);
  check("setup: the plus opens the Add review note popover", p0?.label === "Add review note", JSON.stringify(p0));
  await app.evalJs(`document.querySelector(".diff-note-pop textarea").focus()`);
  await app.cdp("insert", "first draft of the note");
  await sleep(500);
  const added = await clickPopButton(app, "Add note");
  await sleep(1500);
  const c1 = await cards(app);
  log(`add clicked=${added}; cards: ${JSON.stringify(c1)}`);
  check("setup: the note card shows in the diff with the typed text", added && c1.length === 1 && c1[0].text === "first draft of the note", JSON.stringify(c1));
  log(`screenshot: ${await ctx.shot("GIT-040-added")}`);

  // Edit.
  await app.evalJs(`${vis(".diff")}.querySelector(".diff-note-edit").click()`);
  await sleep(800);
  const p1 = await poll(() => pop(app), 6000, 300);
  log(`edit popover: ${JSON.stringify(p1)}`);
  check("the Edit button opens the Edit review note popover with the current text", p1?.label === "Edit review note" && p1.value === "first draft of the note", JSON.stringify(p1));
  await app.evalJs(`(()=>{const t=document.querySelector(".diff-note-pop textarea"); t.focus(); t.select(); return true;})()`);
  await app.cdp("insert", "second version after editing");
  await sleep(500);
  const saved = await clickPopButton(app, "Save");
  await sleep(1500);
  const c2 = await cards(app);
  const gone = await app.evalJs(`!document.querySelector(".diff-note-pop")`);
  log(`save clicked=${saved}; popover closed=${gone}; cards: ${JSON.stringify(c2)}`);
  check("after saving, the open card shows the new text (same note, no reopening)", saved && gone && c2.length === 1 && c2[0].text === "second version after editing" && c2[0].id === c1[0].id, JSON.stringify({ c1, c2 }));
  log(`screenshot: ${await ctx.shot("GIT-040-edited")}`);

  // Trash.
  await app.evalJs(`${vis(".diff")}.querySelector(".diff-note-del").click()`);
  await sleep(1500);
  const c3 = await cards(app);
  log(`cards after trash: ${JSON.stringify(c3)}`);
  check("clicking the trash button removes the card", Array.isArray(c3) && c3.length === 0, JSON.stringify(c3));
  log(`screenshot: ${await ctx.shot("GIT-040-deleted")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-040", { report: rep, ...reviewRepo() });
    await sleep(3000);
    await run040(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-040", ev, ok) : 1);
}
