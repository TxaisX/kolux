// LIVE proof, ORCH-016 boxes 1 and 3 (spec/08): `worker-start --spec "add a test" --agent claude` exits 0 with a ready receipt, a new worktree and a
// background worker tab; leaving the workspace and coming back still shows exactly one worker tab. The caller is a shell pane of the hidden app
// (the spec's "coordinator" is the calling terminal); the agent is the stand-in claude.cmd.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, norm } from "./live-proj-common.mjs";
import { runCli, allPaneBuffers, rowsOf, selectRow } from "./live-cli-common.mjs";

const cwdOf = (b) => b.text?.split("\n").find((l) => l.startsWith("CWD:"))?.slice(4).trim() ?? null;
const workersIn = async (app, folder) => (await allPaneBuffers(app, 'section.pane[data-agent*="claude"]')).filter((b) => cwdOf(b) && norm(cwdOf(b)) === norm(folder));
/** Workspace rows in the sidebar: a workspace shows one folder row, not one row per pane (the pane-row class is gone). */
const sidebarRows = (app) => app.evalJs(`document.querySelectorAll("aside.sidebar .sess[role=button]").length`);
/** The project's main-checkout row (not a nestable worktree row). */
const clickMain = (app) =>
  app.evalJs(`(() => { const e = document.querySelector("button.branch"); if (!e) return false; e.click(); return true; })()`);

export async function run016(ctx, { check, log }) {
  const { app } = ctx;
  const sel0 = (await rowsOf(app)).find((r) => r.sel);
  const rows0 = await rowsOf(app);
  log(`before: worktree rows=${rows0.length}, selected row=${sel0?.label ?? "(the main checkout)"}; shown panes=${(await app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter(e => e.offsetParent !== null).length`))}`);

  // ---- box 1 ----
  const r = await runCli(ctx, `orchestration worker-start --spec "add a test" --agent claude --timeout-ms 90000`, { timeout: 150000 });
  const j = r.json;
  log(`worker-start exit=${r.exit}; receipt keys=${Object.keys(j ?? {}).join(",")}; status=${j?.status}; worktree.created=${j?.worktree?.created}; terminals=${JSON.stringify((j?.terminals ?? []).map((t) => t.role))}`);
  check("b1: exit 0 and a ready status in the JSON", r.exit === 0 && j?.status === "ready", `exit=${r.exit} status=${j?.status}`);
  const wpath = j?.worktree?.path ?? j?.path ?? null;
  check("b1: the receipt names a freshly made worktree and a worker terminal", !!j?.worktree?.created && !!wpath && (j?.terminals ?? []).some((t) => t.role === "worker"), `created=${j?.worktree?.created} roles=${JSON.stringify((j?.terminals ?? []).map((t) => t.role))}`);
  await poll(async () => (await rowsOf(app)).some((x) => norm(x.path) === norm(wpath)), 15000, 400);
  const rows1 = await rowsOf(app);
  log(`worktree rows after: ${JSON.stringify(rows1.map((x) => ({ label: x.label, sel: x.sel, depth: x.depth })))}`);
  check("b1: a new worktree is in the sidebar", rows1.length === rows0.length + 1 && rows1.some((x) => norm(x.path) === norm(wpath)), `rows ${rows0.length} -> ${rows1.length}`);
  // The worker's first prompt renames its branch, which raises a "Rename the folder too?" question that would cover the page: keep the folder.
  const kept = await poll(() => app.evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Keep the folder"); if (!b) return false; b.click(); return true; })()`), 20000, 500);
  log(`rename-folder question: ${kept ? "appeared, answered Keep the folder" : "did not appear"}`);
  await sleep(1500);
  const dump = await app.evalJs(`[...document.querySelectorAll("section.pane")].map(p => ({ agent: p.getAttribute("data-agent"), label: p.getAttribute("aria-label"), shown: p.offsetParent !== null }))`);
  log(`all panes: ${JSON.stringify(dump)}`);
  const w1 = await poll(async () => { const w = await workersIn(app, wpath); return w.length ? w : null; }, 30000, 600);
  log(`worker panes in the new worktree: ${w1?.length ?? 0}; shown=${JSON.stringify(w1?.map((x) => x.shown))}; ARGV=${w1?.[0]?.text?.split("\n").find((l) => l.startsWith("ARGV:"))?.slice(0, 160)}`);
  check("b1: a Claude worker tab exists in it, in the background (not shown)", w1?.length === 1 && w1[0].shown === false, `count=${w1?.length} shown=${w1?.[0]?.shown}`);
  const selNow = (await rowsOf(app)).find((x) => x.sel);
  check("b1: the caller's worktree is still the selected one", (selNow?.path ?? null) === (sel0?.path ?? null), `before=${sel0?.label ?? "main"} after=${selNow?.label ?? "main"}`);
  log(`screenshot b1: ${await ctx.shot("ORCH-016-b1")}`);

  // ---- box 3: leave the workspace and come back ----
  const labelNow = async () => (await rowsOf(app)).find((x) => norm(x.path) === norm(wpath))?.label;
  log(`worker's row label now: ${await labelNow()}; rows=${JSON.stringify((await rowsOf(app)).map((x) => x.label))}`);
  const counts = [];
  for (let cycle = 1; cycle <= 2; cycle++) {
    check(`b3 cycle ${cycle}: open the worker's workspace`, await selectRow(app, await labelNow()), `row ${await labelNow()}`);
    await sleep(2500);
    const inside = { panes: (await workersIn(app, wpath)).length, shown: (await workersIn(app, wpath)).filter((x) => x.shown).length, sidebar: await sidebarRows(app) };
    const left = await clickMain(app);
    await sleep(2500);
    const away = { panes: (await workersIn(app, wpath)).length, shown: (await workersIn(app, wpath)).filter((x) => x.shown).length };
    check(`b3 cycle ${cycle}: left to the main workspace`, left && (await app.evalJs(`document.querySelector("button.branch")?.classList.contains("sel")`)) && away.shown === 0, `clicked=${left} workerShown=${away.shown}`);
    await selectRow(app, await labelNow());
    await sleep(2500);
    const back = { panes: (await workersIn(app, wpath)).length, shown: (await workersIn(app, wpath)).filter((x) => x.shown).length, sidebar: await sidebarRows(app) };
    counts.push({ inside, away, back });
    log(`cycle ${cycle}: inside=${JSON.stringify(inside)} away=${JSON.stringify(away)} back=${JSON.stringify(back)}`);
    check(`b3 cycle ${cycle}: back in the workspace there is exactly one worker tab and the sidebar shows one folder row`, back.panes === 1 && back.shown === 1 && back.sidebar === 1, JSON.stringify(back));
  }
  log(`screenshot b3: ${await ctx.shot("ORCH-016-b3")}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("ORCH-016", { report: rep, standin: STANDIN_BODY });
    log(`real agent programs at start: ${JSON.stringify(await ctx.realAgents())}`);
    await sleep(3000);
    await run016(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "ORCH-016", ev, ok) : 1);
}
