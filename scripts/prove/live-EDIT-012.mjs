// retired: the rich/source editor and its preview tab were removed in fccac517, so no file opens in that editor view.
// LIVE proof, EDIT-012 boxes 1+2 (spec/12): README opens rich, Source shows plain markdown, Mod+Shift+V opens a preview tab;
// a ~1 MB markdown file opens in source view with a banner, and Open anyway switches to the rich view.
import { reporter, startPlain, finish, sleep, checker, editRepo, clickRow, tabs, vis, bigMd } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-012", { report: rep, ...editRepo() });
  const { app } = ctx;
  await sleep(3000);
  const md = () => app.evalJs(`(()=>{const p=${vis()}; if(!p) return null; const vv=e=>!!e&&e.offsetParent!==null&&e.getBoundingClientRect().height>0; const rich=p.querySelector(".md-rich"); const src=p.querySelector(".pane-body:not(.md-rich) .cm-content"); return {title:p.querySelector(".title").textContent, cls:p.className, views:[...p.querySelectorAll(".view-switch button")].map(b=>b.textContent+":"+b.ariaPressed), richVisible:vv(rich), richText:rich?rich.textContent.slice(0,40):null, richParas:rich?rich.querySelectorAll("p").length:0, srcVisible:vv(src), srcText:src&&vv(src)?src.textContent.slice(0,60):null, banner:p.querySelector(".md-banner")?.textContent ?? null};})()`);

  // Box 1: the repository's readme.
  await clickRow(app, "README.md");
  await sleep(1500);
  const rich = await md();
  log(`README opened: ${JSON.stringify(rich)}`);
  check("README opens in the rich view", rich.richVisible && !rich.srcVisible && /Hello world/.test(rich.richText ?? ""), JSON.stringify(rich));
  await app.evalJs(`[...${vis()}.querySelectorAll(".view-switch button")].find(b=>b.textContent==="Source").click()`);
  await sleep(1000);
  const src = await md();
  log(`Source view: ${JSON.stringify(src)}`);
  check("Source shows the plain markdown (hash and asterisks)", src.srcVisible && !src.richVisible && /# Readme/.test(src.srcText ?? "") && /\*\*world\*\*/.test(src.srcText ?? ""), JSON.stringify(src));
  const before = await tabs(app);
  await app.cdp("key", "v", "10"); // Ctrl+Shift+V
  await sleep(1500);
  const after = await tabs(app);
  const prev = await app.evalJs(`(()=>{const p=${vis(".preview")}; return p?{title:p.querySelector(".title").textContent, cls:p.className}:null;})()`);
  log(`tabs before ${JSON.stringify(before)} after ${JSON.stringify(after)}; preview pane ${JSON.stringify(prev)}`);
  check("Mod+Shift+V opens a separate Preview tab", after.length === before.length + 1 && after.some((t) => /^Preview README\.md/.test(t) && t.endsWith(":true")) && prev && /preview/.test(prev.cls), JSON.stringify({ after, prev }));
  log(`screenshot: ${await ctx.shot("EDIT-012-preview")}`);

  // Box 2: a ~1 MB markdown file.
  log(`big.md is ${Buffer.byteLength(bigMd)} bytes`);
  await clickRow(app, "big.md");
  await sleep(2500);
  const big = await md();
  log(`big.md opened: ${JSON.stringify(big)}`);
  check("1 MB markdown opens in the source view with a banner and an Open anyway button", big.srcVisible && !big.richVisible && /opened in source view/.test(big.banner ?? "") && (await app.evalJs(`[...${vis()}.querySelectorAll(".md-banner button")].some(b=>b.textContent==="Open anyway")`)), JSON.stringify(big));
  log(`screenshot: ${await ctx.shot("EDIT-012-banner")}`);
  await app.evalJs(`[...${vis()}.querySelectorAll(".md-banner button")].find(b=>b.textContent==="Open anyway").click()`);
  await sleep(4000);
  const opened = await md();
  log(`after Open anyway: ${JSON.stringify(opened)}`);
  check("Open anyway switches to the rich view", opened.richVisible && opened.richParas > 1000 && !opened.banner, JSON.stringify(opened));
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-012", ev, ok) : 1);
