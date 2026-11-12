// retired: the Untracked section it discards from was removed with the Source Control panel (T-644); discarding now sits on each All Changes file row (ac-discard-file)
// LIVE proof, GIT-003 box 2 (spec/11): discarding the Untracked section while it holds 40 files -> the dialog names the number 40 and its
// buttons are inside the window and clickable without resizing it. Cancelling keeps every file; the confirm then removes all 40.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, reviewRepo, ensurePanel } from "./live-git-common.mjs";

const dialog = (app) =>
  app.evalJs(`(()=>{const d=document.querySelector('[role=alertdialog]'); if(!d) return null; const vw=innerWidth, vh=innerHeight;
    const btns=[...d.querySelectorAll("button")].map(b=>{const r=b.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; const hit=document.elementFromPoint(cx,cy); return {text:b.textContent.trim(), inside:r.left>=0&&r.top>=0&&r.right<=vw&&r.bottom<=vh&&r.width>0&&r.height>0, reachable:!!hit&&(hit===b||b.contains(hit)), rect:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]};});
    const dr=d.getBoundingClientRect();
    return {title:d.querySelector(".ask-title")?.textContent??null, body:d.querySelector(".ask-body")?.textContent??null, label:d.getAttribute("aria-label"), win:[vw,vh], dlg:[Math.round(dr.left),Math.round(dr.top),Math.round(dr.right),Math.round(dr.bottom)], btns, scrolls:d.scrollHeight>d.clientHeight};})()`);

export async function run003(ctx, { check, log }) {
  const { app, repo } = ctx;
  check("setup: Source Control is open", await ensurePanel(app), "panel visible");
  const dir = join(repo, "fresh");
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 40; i++) writeFileSync(join(dir, `new-file-${String(i).padStart(2, "0")}.txt`), `untracked ${i}\n`);
  const sec = () => app.evalJs(`(()=>{const s=document.querySelector('.sidebar.scm .scm-sec-wrap[data-section="Untracked"]'); return s?Number(s.querySelector(".scm-sec .count").textContent):null;})()`);
  const n = await poll(async () => ((await sec()) === 40 ? 40 : null), 25000, 600);
  log(`Untracked section count: ${n ?? (await sec())}`);
  check("setup: the Untracked section lists 40 files", n === 40, `count=${n ?? (await sec())}`);
  const clicked = await app.evalJs(`(()=>{const b=document.querySelector('.sidebar.scm button[aria-label="Discard all in Untracked"]'); if(!b||b.disabled) return false; b.click(); return true;})()`);
  await sleep(1200);
  const d = await poll(() => dialog(app), 6000, 300);
  log(`section discard clicked=${clicked}; dialog: ${JSON.stringify(d)}`);
  check("the dialog gives the number 40 (title and body)", clicked && !!d && /\b40\b/.test(d.title ?? "") && /Untracked/.test(d.title ?? ""), JSON.stringify({ title: d?.title, body: d?.body }));
  check("its buttons are inside the window and reachable at the current size (no resizing)", !!d && d.btns.length >= 2 && d.btns.every((b) => b.inside && b.reachable), JSON.stringify(d?.btns));
  log(`screenshot: ${await ctx.shot("GIT-003-dialog")}`);
  // Cancel keeps everything; the confirm then removes all 40 (scratch repo).
  await app.cdp("key", "Escape");
  await sleep(1000);
  const kept = readdirSync(dir).length;
  const closed = await app.evalJs(`!document.querySelector('[role=alertdialog]')`);
  log(`after Escape: dialog closed=${closed}; files on disk ${kept}`);
  check("Cancel (Escape) closes the dialog and keeps all 40 files", closed && kept === 40, JSON.stringify({ closed, kept }));
  await app.evalJs(`document.querySelector('.sidebar.scm button[aria-label="Discard all in Untracked"]').click()`);
  await sleep(1000);
  const confirmed = await app.evalJs(`(()=>{const b=[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==="Discard all"); if(!b) return false; b.click(); return true;})()`);
  await sleep(2500);
  const left = (() => { try { return readdirSync(dir).length; } catch { return 0; } })();
  log(`confirm clicked=${confirmed}; files left in fresh/: ${left}`);
  check("the dialog's confirm button works at that size: all 40 files are gone", confirmed && left === 0, JSON.stringify({ confirmed, left }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-003", { report: rep, ...reviewRepo() });
    await sleep(3000);
    await run003(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-003", ev, ok) : 1);
}
