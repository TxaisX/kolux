// retired: the right-sidebar Source Control panel it drives was removed by T-644; the changed-file list and commit box now live in All Changes (covered by live-GIT-038)
// LIVE proof, GIT-001 boxes 2+3 (spec/11): the tree view survives closing and reopening the panel; a commit typed in a terminal
// clears the panel with no manual refresh. Also run inside live-GIT-007.mjs (same fixture, one launch).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, addUnpublishedBranch, ensurePanel, panelVisible, RIGHT_TOGGLE, scmReading, typeInTerminal, git, LIVE_BASE } from "./live-git-common.mjs";

export const git001Fixture = () => ({
  files: { "README.md": "# fixture\n", "src/app.js": "app\n", "src/lib/util.js": "util\n", "docs/guide.md": "guide\n", "top.txt": "top\n" },
  dirty: { "src/app.js": "app changed\n", "docs/guide.md": "guide changed\n", "src/lib/extra.js": "brand new file\n" },
});

export async function run001(ctx, { check, log }) {
  const { app, repo } = ctx;
  // Box 2: tree view, close the panel, reopen it.
  check("setup: Source Control is open", await ensurePanel(app), "panel visible");
  const rowsOk = await poll(async () => (await scmReading(app))?.files >= 3, 20000, 700);
  const flat = await scmReading(app);
  log(`flat list: ${JSON.stringify(flat)}`);
  check("setup: the panel starts as the flat list (default) with the changed files", !!rowsOk && flat.dirs === 0 && flat.view === "View as tree" && flat.pressed === "false", JSON.stringify(flat));
  await app.evalJs(`document.querySelector('.sidebar.scm .scm-head button[aria-label="View as tree"]').click()`);
  await sleep(1200);
  const tree = await scmReading(app);
  log(`after choosing tree: ${JSON.stringify(tree)}`);
  check("the header menu switches to the folder tree (folder rows appear)", tree.dirs >= 2 && tree.view === "View as list" && tree.pressed === "true", JSON.stringify(tree));
  await app.evalJs(`${RIGHT_TOGGLE}.click()`);
  await sleep(1500);
  const closed = !(await panelVisible(app));
  log(`panel closed: ${closed}`);
  check("setup: the panel is closed", closed, `panelVisible=${!closed}`);
  await app.evalJs(`${RIGHT_TOGGLE}.click()`);
  await sleep(1500);
  const reopened = await ensurePanel(app);
  await sleep(1000);
  const again = await scmReading(app);
  log(`reopened: ${JSON.stringify(again)}`);
  check("the reopened panel is still a tree (folder rows, button offers the list)", reopened && again.dirs >= 2 && again.view === "View as list" && again.pressed === "true", JSON.stringify(again));
  try {
    const s = JSON.parse(readFileSync(app.paths.settings, "utf8"));
    log(`saved settings keys about the panel: ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => /scm|view/i.test(k))))}`);
  } catch (e) {
    log(`(settings file not read: ${e.message})`);
  }
  log(`screenshot: ${await ctx.shot("GIT-001-tree-reopened")}`);

  // Box 3: switch back to the list so the sections are easy to count, then commit from the terminal.
  await app.evalJs(`document.querySelector('.sidebar.scm .scm-head button[aria-label="View as list"]').click()`);
  await sleep(1000);
  const before = await scmReading(app);
  log(`before the terminal commit: ${JSON.stringify(before)}`);
  check("setup: the panel lists changes before the commit", before.files >= 3 && Object.values(before.secs).some((n) => n > 0), JSON.stringify(before));
  const logBefore = (await git(repo, ["log", "--oneline"])).trim().split("\n").length;
  const t0 = Date.now();
  await typeInTerminal(app, 'git add -A; git commit -q -m "from the terminal"');
  const cleared = await poll(async () => {
    const r = await scmReading(app);
    return r && r.files === 0 && Object.values(r.secs).every((n) => n === 0) ? r : null;
  }, 20000, 400);
  const ms = Date.now() - t0;
  const dump = await app.evalJs(`[...document.querySelectorAll(".sidebar.scm .scm-row")].map(r=>({title:r.title, cls:r.className, within:r.closest("[data-section]")?.dataset.section ?? r.parentElement?.className ?? null, text:r.textContent.trim().slice(0,60)}))`);
  log(`rows still in the panel: ${JSON.stringify(dump)}`);
  const logAfter = (await git(repo, ["log", "--oneline"])).trim().split("\n").length;
  log(`panel after the commit (no click): ${JSON.stringify(cleared ?? (await scmReading(app)))}; ${ms} ms after typing; commits ${logBefore} -> ${logAfter}`);
  check("the terminal commit was made", logAfter === logBefore + 1, `commits ${logBefore} -> ${logAfter}`);
  check("the panel cleared by itself (no Refresh click): no changed-file rows left", !!cleared, JSON.stringify(cleared));
  log(`screenshot: ${await ctx.shot("GIT-001-cleared")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-001", { report: rep, ...git001Fixture(), prepare: (repo) => addUnpublishedBranch(repo, `${LIVE_BASE}/work/GIT-001-origin.git`) });
    await sleep(3000);
    await run001(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-001", ev, ok) : 1);
}
