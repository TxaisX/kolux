// LIVE proof, T-640 (wave UI lane A): every row of the left pane can be removed. Dev app hidden off-screen, scratch profile,
// stand-in claude; a project added by path plus a workspace "B" made from the header. (The before-fix repro is in evidence/T-640.txt.)
// Run: node scripts/prove/live-T-640.mjs [new|classic]
// Right-clicks the project, main checkout and workspace rows (a menu with a remove item, and Escape closes it), checks the hover Xs,
// removes B through its X (row and folder gone), then removes the project through the main row's X (the folder stays on disk).
import { existsSync } from "node:fs";
import { finish, reporter, sleep, startPlain } from "./live-common.mjs";

const look = process.argv[2] === "classic" ? "classic" : "new";
const report = reporter();
const { log, lines } = report;
const results = {};
const check = (name, pass, detail) => {
  results[name] = pass;
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`);
};
let B_DIR = "";
const REPO = (l) => `G:/Temp/live-v15/work/T-640-${l}`;
const norm = (p) => (p ?? "").replace(/\\/g, "/").toLowerCase();

const ROWS = `(() => {
  const list = document.querySelector("aside.sidebar");
  const rows = [...list.querySelectorAll(".proj, .branch, [data-path], .pane-row")].filter((e) => e.getClientRects().length);
  return rows.map((e) => ({ cls: String(e.className), text: (e.querySelector(".name") ?? e).textContent.trim().slice(0, 50), path: e.getAttribute("data-path") }));
})()`;
const MENU = `[...document.querySelectorAll('[role=menu] [role=menuitem]')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())`;
const rightClick = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getClientRects().length)[0]; if (!e) return "missing";
  const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.right - 30, clientY: r.top + r.height / 2, button: 2 })); return "ok"; })()`;

let ctx;
let ok = false;
try {
  log(`T-640 live ${new Date().toISOString()} look=${look}`);
  ctx = await startPlain(`T-640-${look}`, { report, noProject: true, standin: ["echo cwd=%CD%"], settings: { uiLook: look } });
  const { app } = ctx;
  // Added by hand (startPlain on main waits for a shell pane that the seat chooser never opens); wait for the sidebar row.
  await app.click('.sb-foot button[title^="Add a project by path"]');
  await app.waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
  await app.focusField('input[aria-label="project folder"]');
  await app.cdp("insert", REPO(look), "enter");
  await app.waitFor("the project row", () => app.exists("aside.sidebar .proj"), 30000);
  await sleep(4000);
  if ((await app.evalJs(`[...document.querySelectorAll("[role=dialog]")].filter((e) => e.getClientRects().length).length`)) > 0) { await app.cdp("key", "Escape"); await sleep(800); }
  // A second workspace made the way a user makes one: the project header's New workspace button, a name, Create workspace.
  await app.click('aside.sidebar .proj button[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 5000);
  await app.focusField('input[aria-label="workspace name"]');
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", "B");
  await sleep(500);
  await app.clickWhere("aside.sidebar button", "/^Create workspace$/");
  await app.waitFor("the new workspace row", () => app.exists("aside.sidebar [data-path]"), 60000);
  await sleep(3000);
  B_DIR = await app.evalJs(`document.querySelector("aside.sidebar [data-path]").getAttribute("data-path")`);
  log(`workspace B made at ${B_DIR}; rows ${JSON.stringify((await app.evalJs(ROWS)).map((r) => r.text))}`);
  log(`pane: ${await ctx.shot(`T-640-${look}-after-start`)}`);

  // Right-click each kind of row: every one opens a menu with a way out, and Escape closes it.
  const want = { "project header": /^Remove project/, "main checkout row": /^Remove project/, "workspace row (outer wrapper)": /^(Delete|Hide from the sidebar)$/ };
  for (const [label, sel] of [["project header", "aside.sidebar .proj"], ["main checkout row", "aside.sidebar .branch"], ["workspace row (outer wrapper)", "aside.sidebar [data-path]"]]) {
    const r = await app.evalJs(rightClick(sel));
    await sleep(600);
    const items = await app.evalJs(MENU);
    if (label === "project header") log(`menu shot: ${await ctx.shot(`T-640-${look}-after-menu`)}`);
    await app.cdp("key", "Escape");
    await sleep(400);
    const still = await app.evalJs(`!!document.querySelector("[role=menu]")`);
    check(`right-click ${label} opens a menu with a remove item, and Escape closes it`, r === "ok" && items.some((t) => want[label].test(t)) && !still, { items, stillOpenAfterEscape: still });
    if (still) { await app.evalJs(`document.querySelector("[role=menu]").previousElementSibling.click()`); await sleep(400); }
  }
  const hoverX = await app.evalJs(`["data-proj-x"].map((a) => !!document.querySelector("aside.sidebar button[" + a + "]"))`);
  check("the project header has its Remove project button (since T-687 it replaces the main checkout row's X)", hoverX.every(Boolean), hoverX);

  // Remove B through its own row control.
  const bKey = norm(B_DIR);
  const clicked = await app.evalJs(`(() => { const row = [...document.querySelectorAll("aside.sidebar [data-path]")].find((e) => e.getAttribute("data-path").replace(/\\\\/g, "/").toLowerCase() === ${JSON.stringify(bKey)});
    if (!row) return "no B row"; const b = [...row.querySelectorAll("button")].find((x) => /^Delete this workspace/.test(x.title)); if (!b) return "no remove button on B"; b.click(); return "clicked"; })()`);
  await sleep(1500);
  const asked = await app.evalJs(`[...document.querySelectorAll('aside.sidebar [role=alertdialog][aria-label="Delete workspace"]')].filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\\s+/g, " ").slice(0, 200))`);
  log(`remove B: ${clicked}; asked ${JSON.stringify(asked)}; ${await ctx.shot(`T-640-${look}-after-ask`)}`);
  const confirmed = await app.evalJs(`(() => { const d = [...document.querySelectorAll('aside.sidebar [role=alertdialog][aria-label="Delete workspace"]')].find((e) => e.getClientRects().length); const b = d && [...d.querySelectorAll("button")].find((x) => /^Delete/.test(x.textContent.trim())); if (!b) return "no Delete button"; b.click(); return "confirmed"; })()`);
  await sleep(5000);
  let after = await app.evalJs(ROWS);
  check("B removed through its X: the question showed, the row is gone, its folder deleted", asked.length === 1 && confirmed === "confirmed" && !after.some((r) => norm(r.path) === bKey) && !existsSync(B_DIR), { rows: after.map((r) => r.text), folder: existsSync(B_DIR) });

  // Remove the project through the project header's Remove project button (T-687 replaced the main row's X): the question says the folder stays, the project leaves the pane.
  await app.click("aside.sidebar button[data-proj-x]");
  await sleep(1000);
  const q = await app.evalJs(`document.querySelector('aside.sidebar [role=alertdialog][aria-label="Remove project"]')?.innerText.replace(/\\s+/g, " ") ?? "no question"`);
  log(`project question: ${q}; ${await ctx.shot(`T-640-${look}-after-project-ask`)}`);
  await app.evalJs(`[...document.querySelectorAll('aside.sidebar [role=alertdialog][aria-label="Remove project"] button')].find((x) => /^Remove /.test(x.textContent.trim()))?.click()`);
  await sleep(3000);
  after = await app.evalJs(ROWS);
  check("the project removed through its Remove project button: the question says the folder stays, the pane is empty, the folder is still on disk",
    /stay on disk/.test(q) && !after.some((r) => /proj/.test(r.cls)) && existsSync(REPO(look)), { q, rows: after.map((r) => r.text), folder: existsSync(REPO(look)) });
  log(`pane after: ${await ctx.shot(`T-640-${look}-after`)}`);
  ok = Object.keys(results).length === 6 && Object.values(results).every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e.message}`);
}
process.exitCode = ctx ? await finish(ctx, `T-640-${look}`, lines, ok) : 1;
