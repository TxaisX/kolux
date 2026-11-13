// LIVE proof, EDIT-029 boxes 1+2 (spec/12): 30 changed files -> All Changes draws sections while scrolling, the tree filters and jumps;
// a viewed mark and the scroll position survive a tab switch.
import { reporter, startPlain, finish, sleep, poll, checker, editRepo, clickTab, openAllChanges, acCount, tabs, vis } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-029", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  const opened = await openAllChanges(app);
  await sleep(2500);
  const AC = vis(".all-changes");
  const state = () => app.evalJs(`(()=>{const p=${AC}; if(!p) return null; const l=p.querySelector(".ac-list"); const secs=[...p.querySelectorAll(".ac-section")]; return {tag:p.querySelector(".preview-tag")?.textContent ?? null, st:l.scrollTop, mounted:secs.length, names:secs.map(s=>s.querySelector(".ac-name").textContent), drawn:secs.filter(s=>s.querySelector(".cm-editor")).length};})()`);
  const s0 = await state();
  const counted = await acCount(app);
  log(`All Changes opened (${opened}): ${JSON.stringify(s0)}`);
  check("setup: 30 files changed and the tag says so", counted.count === 30 && /^30 files/.test(s0?.tag ?? ""), JSON.stringify(counted));
  check("sections are windowed: fewer than 30 mounted at the top", s0 && s0.mounted > 0 && s0.mounted < 30, `mounted=${s0?.mounted}`);
  await app.evalJs(`${AC}.querySelector(".ac-list").scrollTop=3000`);
  await sleep(1500);
  const s1 = await state();
  log(`scrolled to 3000: ${JSON.stringify(s1)}`);
  check("scrolling mounts other sections (the set of names changes)", s1 && s1.names.join() !== s0.names.join() && s1.drawn > 0, JSON.stringify({ first: s0.names.slice(0, 3), now: s1.names.slice(0, 3) }));
  await app.evalJs(`${AC}.querySelector('button[aria-label="File tree"]').click()`);
  await sleep(1000);
  const treeRows = () => app.evalJs(`[...${AC}.querySelectorAll(".ac-row")].map(r=>r.textContent.trim())`);
  const all = await treeRows();
  log(`tree rows before filter: ${all.length}`);
  await app.evalJs(`${AC}.querySelector('input[aria-label="Filter changed files"]').focus()`);
  await app.cdp("insert", "file15");
  await sleep(1000);
  const filtered = await treeRows();
  log(`tree rows after filtering "file15": ${JSON.stringify(filtered)}`);
  check("the tree lists every changed file, and filtering by name leaves only many/file15.txt", all.length >= 30 && filtered.length === 1 && /file15.txt/.test(filtered[0]), JSON.stringify({ all: all.length, filtered }));
  await app.evalJs(`(()=>{const p=${AC}; p.querySelector(".ac-list").scrollTop=0; return true;})()`);
  await sleep(800);
  await app.evalJs(`${AC}.querySelector(".ac-jump").click()`);
  await sleep(1500);
  const jump = await app.evalJs(`(()=>{const p=${AC}; const l=p.querySelector(".ac-list"); const lr=l.getBoundingClientRect(); const s=[...p.querySelectorAll(".ac-section")].find(s=>s.querySelector(".ac-name").textContent==="many/file15.txt"); return {st:l.scrollTop, found:!!s, top:s?Math.round(s.getBoundingClientRect().top-lr.top):null};})()`);
  log(`after Jump: ${JSON.stringify(jump)}`);
  check("jumping to file15.txt (a section in the middle of the list) scrolls it to the top of the list", jump.found && Math.abs(jump.top) <= 24 && jump.st > 1000, JSON.stringify(jump));
  log(`screenshot: ${await ctx.shot("EDIT-029-jump")}`);

  // Box 2: viewed mark and scroll position across a tab switch.
  await app.evalJs(`[...${AC}.querySelectorAll('.ac-section input[type=checkbox]')].find(c=>/^Viewed .*file15.txt$/.test(c.getAttribute("aria-label"))).click()`);
  await sleep(1000);
  const view = () => app.evalJs(`(()=>{const p=${AC}; const l=p.querySelector(".ac-list"); return {tag:p.querySelector(".preview-tag")?.textContent, st:l.scrollTop, section:[...p.querySelectorAll('.ac-section input[type=checkbox]')].filter(c=>/^Viewed .*file15.txt$/.test(c.getAttribute("aria-label"))).map(c=>c.checked), tree:[...p.querySelectorAll('.ac-row input')].map(c=>c.getAttribute('aria-label')+'='+c.checked)};})()`);
  const v0 = await view();
  log(`marked: ${JSON.stringify(v0)}`);
  check("setup: file15.txt marked viewed and the tag counts it", /1 viewed/.test(v0.tag) && v0.section[0] === true, JSON.stringify(v0));
  await clickTab(app, "Terminal");
  await sleep(1500);
  const away = await tabs(app);
  await clickTab(app, "All Changes");
  await sleep(1500);
  const v1 = await view();
  log(`away ${JSON.stringify(away)}; back: ${JSON.stringify(v1)}`);
  check("after a tab switch the mark and the scroll position are kept", /1 viewed/.test(v1.tag) && v1.section[0] === true && v1.st === v0.st && v1.st > 1000, JSON.stringify({ v0, v1 }));
  log(`screenshot: ${await ctx.shot("EDIT-029-back")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-029", ev, ok) : 1);
