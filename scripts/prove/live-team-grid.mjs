// LIVE proof, DT-C274 (own-folder team = one grid): a New session launch of 4 AI seats with "Own folder for each agent" on makes 4 git
// worktrees, all 4 panes show in ONE grid (view = the chooser's folder, cwd = each worktree), the sidebar lists no row for those worktrees
// (they sit in setting teamWorktrees as {path, view}), sidebar rows show no running-count badge and no "N agent ·", and the same grid
// comes back after a restart of the app with the same profile.
// The AI is a stand-in claude.cmd (STANDIN_BODY echoes its argv and folder), put on PATH and named by agentOptions.claude.command, so the launch
// path is the real startSeats and no real agent or quota is used.
// Run: node scripts/prove/live-team-grid.mjs   (PROVE_PORT / PROVE_CDP move the ports; evidence in G:/Temp/live-v15-logs)
import { pathToFileURL } from "node:url";
import { writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, git, LIVE_LOGS, norm } from "./live-proj-common.mjs";
import { dismissFirstRun } from "./live-common.mjs";
import { WIN_PS, waitAppWindow } from "../evidence/app-launch.mjs";
import { PLUS } from "./live-SESS-004.mjs";
import { openSheet } from "./live-SESS-018.mjs";

const ID = "team-grid";
const CLAUDE_PANE = 'section.pane[data-agent*="claude"]';
const SHEET = ".sheet-wrap";
const base = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();

// A screenshot that never answers (a hidden page) must not hang the run.
const safeShot = (ctx, name) => Promise.race([ctx.shot(name), new Promise((r) => setTimeout(() => r("(screenshot timed out)"), 20000))]).catch((e) => `(screenshot failed: ${e.message})`);
// A relaunched window comes back tiny (the saved off-screen state): restore it and give it a real size, still off-screen.
const resizeWindow = (app) =>
  app.ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W2 -Namespace U2
     ${WIN_PS}
     ${waitAppWindow(app.pid)}
     if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [V11]::ShowWindow($h, 9) | Out-Null; [U2.W2]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 1500, 950, 0x0014) | Out-Null; 'resized' }`);

/** Shown panes: agent, label, key. */
const shownPanes = (app) =>
  app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter(e => e.offsetParent !== null).map(e => ({ agent: e.getAttribute("data-agent"), label: e.getAttribute("aria-label"), key: e.getAttribute("data-key"), rect: (r => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])(e.getBoundingClientRect()) }))`);

/** The cwd each shown claude pane reports (the stand-in echoes "CWD: <folder>"; a narrow pane wraps it, so the lines up to the next empty one are joined). */
async function claudeCwds(ctx) {
  const n = await ctx.app.shown(CLAUDE_PANE);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (await ctx.text(i, CLAUDE_PANE)) ?? "";
    const at = t.indexOf("CWD:");
    out.push(at < 0 ? null : t.slice(at + 4).split(/\r?\n\s*\r?\n/)[0].replace(/\r?\n/g, "").trim());
  }
  return out;
}
const overlap = (a, b) => a.rect[0] < b.rect[0] + b.rect[2] - 2 && b.rect[0] < a.rect[0] + a.rect[2] - 2 && a.rect[1] < b.rect[1] + b.rect[3] - 2 && b.rect[1] < a.rect[1] + a.rect[3] - 2;
const noOverlap = (ps) => ps.every((a, i) => ps.every((b, j) => j <= i || !overlap(a, b)));
const layoutOf = (profileSettings) => {
  try {
    return JSON.parse(readFileSync(profileSettings, "utf8")).savedLayout ?? null;
  } catch (e) {
    return { error: e.message };
  }
};

/** What the sidebar shows: text, the rows with data-worktree, the project blocks, count badges inside rows. */
const sidebar = (app) =>
  app.evalJs(`(() => {
    const sb = document.querySelector("aside.sidebar");
    const rows = [...sb.querySelectorAll("[data-worktree]")].map(e => ({ label: e.dataset.worktree, path: e.dataset.path, text: e.innerText.replace(/\\s+/g, " ").trim(), title: e.querySelector(".sess")?.getAttribute("title") ?? "" }));
    const projs = [...sb.querySelectorAll(".proj")].map(e => ({ cls: e.className, text: e.innerText.replace(/\\s+/g, " ").trim(), title: e.getAttribute("title") ?? "" }));
    const counts = [...sb.querySelectorAll(".count")].filter(e => !e.closest(".sb-group, .sb-group-row")).map(e => ({ text: e.textContent.trim(), cls: e.className, in: (e.closest("[data-worktree]")?.dataset.worktree) ?? (e.closest(".proj") ? "project block" : "other") }));
    return { text: sb.innerText.replace(/\\s+/g, " ").trim(), rows, projs, counts };
  })()`);

const worktreesOf = async (repo) => {
  const out = await git(repo, ["worktree", "list", "--porcelain"]);
  const text = typeof out === "string" ? out : out?.stdout ?? String(out);
  const items = [];
  let cur = null;
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith("worktree ")) items.push((cur = { path: l.slice(9).trim(), branch: null }));
    else if (l.startsWith("branch ") && cur) cur.branch = l.slice(7).trim().replace(/^refs\/heads\//, "");
  }
  return items;
};

async function launchTeam(ctx, { log, check, result }) {
  const { app } = ctx;
  check("the New session page opens (plus menu > Open a pane that asks)", !!(await openSheet(app)), "");
  await sleep(800);
  await app.clickWhere(`${SHEET} [role=group][aria-label="How many sessions"] button`, "/^\\s*4\\s*$/");
  const seatsUp = await poll(async () => ((await app.evalJs(`document.querySelectorAll(${JSON.stringify(SHEET)} + ' [role=group][aria-label$=": which AI"]').length`)) === 4 ? true : null), 8000, 300);
  check("the count is 4: four seats are on the page", !!seatsUp, "");
  await poll(() => app.exists(`${SHEET} [data-testid="seat-agent-claude"]`), 30000, 500);
  for (let i = 1; i <= 4; i++) {
    const r = await app.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(SHEET)} + ' [data-testid="seat-${i}-agents"] [data-testid="seat-agent-claude"]'); if (!b) return "missing"; b.click(); return "clicked"; })()`);
    if (r !== "clicked") throw new Error(`seat ${i}: no Claude tile (${r})`);
  }
  await sleep(500);
  const seatState = await app.evalJs(`[1,2,3,4].map(i => document.querySelector(${JSON.stringify(SHEET)} + ' [data-testid="seat-' + i + '-agents"] [data-testid="seat-agent-claude"]')?.getAttribute("aria-pressed"))`);
  check("all four seats are Claude (stand-in)", seatState.every((s) => s === "true"), JSON.stringify(seatState));
  const copiesBefore = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(SHEET)} + ' input[type=radio][name^="copies-"]')].map(r => ({ label: r.parentElement.textContent.trim(), checked: r.checked }))`);
  log(`folders choice as the page opens at 4 seats: ${JSON.stringify(copiesBefore)}`);
  result.copiesDefaultAt4 = copiesBefore;
  if (!copiesBefore.find((r) => /Own folder/.test(r.label))?.checked) {
    // The chooser's folder choice was fixed when it opened with 1 seat (shared); a person picks "Own folder for each AI" here.
    await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(SHEET)} + ' input[type=radio][name^="copies-"]')].find(r => /Own folder/.test(r.parentElement.textContent)).click()`);
    await sleep(400);
  }
  const copiesAfter = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(SHEET)} + ' input[type=radio][name^="copies-"]')].map(r => ({ label: r.parentElement.textContent.trim(), checked: r.checked }))`);
  check("Folders is set to 'Own folder for each AI'", !!copiesAfter.find((r) => /Own folder/.test(r.label))?.checked, JSON.stringify(copiesAfter));
  const foldersText = await app.evalJs(`document.querySelector(${JSON.stringify(SHEET)}).innerText.replace(/\\s+/g, " ").slice(0, 1500)`);
  log(`sheet text: ${foldersText}`);
  const start = await poll(async () => await app.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(SHEET)} + ' [data-testid="chooser-start"]'); return b && !b.disabled ? b.textContent.trim() : null; })()`), 30000, 400);
  log(`start button: ${JSON.stringify(start)}`);
  check("Start is enabled", !!start, String(start));
  log(`screenshot before start: ${await safeShot(ctx, `${ID}-0-sheet`)}`);
  await app.click(`${SHEET} [data-testid="chooser-start"]`);
  await poll(async () => ((await app.exists(`${SHEET} [data-testid="chooser-start"]`)) ? null : true), 30000, 400);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  const { check } = chk;
  let ctx;
  let ok = false;
  const result = { id: ID, checks: {} };
  let repo = null;
  let made = [];
  try {
    ctx = await startPlain(ID, { report: rep, standin: STANDIN_BODY, noProject: true });
    const { app } = ctx;
    repo = ctx.repo;
    // Register the project the way startPlain does, then open its first shell through the (tile) chooser, since startPlain's own
    // chooser step still reads the old <select> seats.
    await app.click('aside.sidebar button[aria-label="Add project"]');
    await app.waitFor("the add-by-path item", () => app.exists("button[data-add-by-path]"), 5000);
    await app.click("button[data-add-by-path]");
    await app.waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
    await app.focusField('input[aria-label="project folder"]');
    await app.cdp("insert", repo, "enter");
    await app.waitFor("the first pane (shell or session chooser)", async () => (await app.shown("section.pane[data-agent]")) >= 1 || (await app.exists("section.pane.chooser .chooser-foot")), 30000);
    if (!(await app.shown("section.pane[data-agent]"))) {
      await app.waitFor("the Terminal tile", () => app.exists('section.pane.chooser [data-testid="seat-agent-terminal"]'), 30000);
      await app.click('section.pane.chooser [data-testid="seat-agent-terminal"]');
      await app.waitFor("the chooser's Start", () => app.exists('section.pane.chooser [data-testid="chooser-start"]:not(:disabled)'), 30000);
      await app.click('section.pane.chooser [data-testid="chooser-start"]');
    }
    await app.waitFor("the first shell pane", async () => (await app.shown("section.pane[data-agent]")) >= 1, 30000);
    await app.waitFor("its input field", () => app.exists("section.pane[data-agent] .xterm-helper-textarea"), 30000);
    await dismissFirstRun(app, log);
    await sleep(1500);

    const settings0 = await app.invoke("get_settings");
    log(`settings before launch: agentOwnFolders=${JSON.stringify(settings0?.agentOwnFolders)} teamWorktrees=${JSON.stringify(settings0?.teamWorktrees)}`);
    check("own folders is on (agentOwnFolders not false)", settings0?.agentOwnFolders !== false, `agentOwnFolders=${JSON.stringify(settings0?.agentOwnFolders)}`);
    const wt0 = await worktreesOf(repo);
    const pre = await shownPanes(app);
    log(`before launch: panes ${JSON.stringify(pre)}; worktrees ${wt0.length}`);
    log(`screenshot before: ${await safeShot(ctx, `${ID}-1-before`)}`);

    await launchTeam(ctx, { log, check, result });
    await poll(async () => ((await app.shown(CLAUDE_PANE)) >= 4 ? true : null), 90000, 500);
    await sleep(6000);

    // ---- A ----
    const wt1 = await worktreesOf(repo);
    made = wt1.filter((w) => !wt0.some((o) => norm(o.path) === norm(w.path)) );
    log(`worktrees after: ${JSON.stringify(wt1)}`);
    const panesA = await shownPanes(app);
    const claudePanes = panesA.filter((p) => /claude/.test(p.agent));
    const cwds = await claudeCwds(ctx);
    const settingsA = await app.invoke("get_settings");
    const team = settingsA?.teamWorktrees ?? [];
    const gridCount = await app.evalJs(`document.querySelectorAll(".content section.pane[data-agent]").length`);
    const tabsA = await app.evalJs(`[...document.querySelectorAll("div[role=tab]")].map(t => t.textContent.trim())`);
    const activeA = await app.evalJs(`document.querySelector("aside.sidebar .sess.sel, aside.sidebar .proj.sel")?.innerText.replace(/\\s+/g, " ").trim() ?? null`);
    log(`A: shown panes ${JSON.stringify(panesA)}; pane cwds ${JSON.stringify(cwds)}; tabs ${JSON.stringify(tabsA)}; selected sidebar item ${JSON.stringify(activeA)}`);
    log(`A: settings.teamWorktrees ${JSON.stringify(team)}`);
    log(`screenshot after launch: ${await safeShot(ctx, `${ID}-2-after-launch`)}`);
    const distinctCwd = new Set(cwds.filter(Boolean).map(norm));
    const madeSet = new Set(made.map((w) => norm(w.path)));
    const rootNorm = norm(repo);
    const rA = {
      worktreesMade: made.length,
      claudePanesShown: claudePanes.length,
      allShownPanes: panesA.length,
      distinctCwds: distinctCwd.size,
      cwdsAreTheWorktrees: [...distinctCwd].every((c) => madeSet.has(c)),
      teamRecords: team.length,
      teamViewsAllRepo: team.length > 0 && team.every((t) => typeof t === "object" && norm(t.view) === rootNorm),
      teamPathsAreTheWorktrees: team.length === made.length && team.every((t) => madeSet.has(norm(typeof t === "string" ? t : t.path))),
    };
    result.A = rA;
    check("A1: 4 git worktrees were made", made.length === 4, `made ${made.length}: ${made.map((w) => w.path).join(" | ")}`);
    check("A2: 4 claude panes show at once in the one grid", claudePanes.length === 4, `shown claude panes ${claudePanes.length}, all shown panes ${panesA.length}`);
    check("A2b: the 5 shown panes tile one grid (no overlaps, each at least 150 px wide)", noOverlap(panesA) && panesA.every((p) => p.rect[2] >= 150 && p.rect[3] >= 150), JSON.stringify(panesA.map((p) => p.rect)));
    check("A3: the panes' cwds are 4 distinct worktrees", rA.distinctCwds === 4 && rA.cwdsAreTheWorktrees, `cwds ${JSON.stringify(cwds)}`);
    check("A4: teamWorktrees records the 4 as {path, view} with view = the project folder (the pane view)", rA.teamPathsAreTheWorktrees && rA.teamViewsAllRepo, JSON.stringify(team));
    // ---- B ----
    const sbB = await sidebar(app);
    log(`B: sidebar ${JSON.stringify(sbB)}`);
    const names = made.flatMap((w) => [base(w.path), w.branch ? w.branch : null, w.branch ? base(w.branch) : null]).filter(Boolean);
    const leaked = [...new Set(names)].filter((n) => sbB.text.includes(n) || sbB.rows.some((r) => norm(r.path ?? "") === norm(made.find((w) => base(w.path) === n)?.path ?? "\u0000")));
    const rowPathsMade = sbB.rows.filter((r) => madeSet.has(norm(r.path ?? "")));
    const mainRow = sbB.rows.find((r) => norm(r.path ?? "") === rootNorm) ?? sbB.projs.find((p) => p.text.includes(base(repo)));
    result.B = { rows: sbB.rows.map((r) => r.label), rowPathsMade: rowPathsMade.length, leaked, mainRow: mainRow?.text ?? null };
    check("B1: no sidebar row for any of the 4 worktrees", rowPathsMade.length === 0 && leaked.length === 0, `worktree names/branches ${JSON.stringify([...new Set(names)])}; rows ${JSON.stringify(sbB.rows.map((r) => `${r.label} @ ${r.path}`))}; leaked ${JSON.stringify(leaked)}`);
    check("B2: the project's main row is still there", !!mainRow && sbB.text.includes(base(repo)), `main row ${JSON.stringify(mainRow?.text ?? null)}`);
    // ---- C ----
    const bad = sbB.counts.filter((c) => c.in !== "other");
    const agentsDot = /\d+\s+agents?\s*·/i.test(sbB.text) || sbB.rows.some((r) => /\d+\s+agents?\b/i.test(r.title)) || sbB.projs.some((p) => /\d+\s+agents?\b/i.test(p.title));
    result.C = { rowCountBadges: bad, allCounts: sbB.counts, agentsDot };
    check("C1: no .count badge inside a sidebar workspace/project row", bad.length === 0, `counts ${JSON.stringify(sbB.counts)}`);
    check("C2: no 'N agent ·' on a row's second line (text or hover title)", !agentsDot, `sidebar text: ${sbB.text.slice(0, 400)}`);
    log(`screenshot sidebar: ${await safeShot(ctx, `${ID}-3-sidebar`)}`);

    // ---- D: restart with the same profile ----
    const closed = await app.closeAndCount(app.pid);
    log(`quit: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)})`);
    await app.killAll(closed.survivors);
    const saved = layoutOf(app.paths.settings);
    const savedPanes = saved?.panes ?? [];
    log(`D: savedLayout on disk after quit: ${JSON.stringify(savedPanes.map((p) => ({ agent: p.agent, cwd: p.cwd, view: p.view ?? null })))}`);
    result.D0 = savedPanes.map((p) => ({ agent: p.agent, cwd: p.cwd, view: p.view ?? null }));
    const teamPanes = savedPanes.filter((p) => madeSet.has(norm(p.cwd ?? "")));
    check("D0: the saved layout holds 4 panes with cwd = a worktree and view = the project folder", teamPanes.length === 4 && teamPanes.every((p) => norm(p.view ?? "") === rootNorm), JSON.stringify(result.D0));
    await app.relaunch();
    log(`window after relaunch: ${await resizeWindow(app)}; ${JSON.stringify(await app.evalJs("({ w: innerWidth, h: innerHeight, vis: document.visibilityState })"))}`);
    log(`first-run guide on the relaunched profile: ${(await dismissFirstRun(app, log)) ? "closed" : "still open"}`);
    await poll(async () => ((await app.shown("section.pane[data-agent]")) >= 5 ? true : null), 120000, 1000);
    await sleep(8000);
    const panesD = await shownPanes(app);
    const claudeD = panesD.filter((p) => /claude/.test(p.agent));
    const cwdsD = await claudeCwds(ctx);
    const settingsD = await app.invoke("get_settings");
    const sbD = await sidebar(app);
    const distinctD = new Set(cwdsD.filter(Boolean).map(norm));
    log(`D: shown panes ${JSON.stringify(panesD)}; claude cwds ${JSON.stringify(cwdsD)}; teamWorktrees ${JSON.stringify(settingsD?.teamWorktrees)}`);
    log(`D: sidebar rows ${JSON.stringify(sbD.rows.map((r) => `${r.label} @ ${r.path}`))}; counts ${JSON.stringify(sbD.counts)}`);
    log(`screenshot after restart: ${await safeShot(ctx, `${ID}-4-after-restart`)}`);
    const rowsMadeD = sbD.rows.filter((r) => madeSet.has(norm(r.path ?? "")));
    result.D = { claudePanesShown: claudeD.length, allShownPanes: panesD.length, distinctCwds: distinctD.size, teamRecords: (settingsD?.teamWorktrees ?? []).length, sidebarRowsForWorktrees: rowsMadeD.length };
    const savedD = layoutOf(app.paths.settings)?.panes ?? [];
    const joined = [];
    for (let i = 0; i < panesD.length; i++) joined.push(((await ctx.text(i, "section.pane[data-agent]")) ?? "").replace(/[\r\n]+/g, ""));
    log(`D: pane labels ${JSON.stringify(panesD.map((p) => p.label))}; pane text tail ${JSON.stringify(joined.map((t) => t.slice(-160)))}`);
    log(`D: savedLayout after the restart: ${JSON.stringify(savedD.map((p) => ({ agent: p.agent, cwd: p.cwd, view: p.view ?? null })))}`);
    const wtNames = made.map((w) => base(w.path));
    result.D.paneLabels = panesD.map((p) => p.label);
    check("D1: after the restart the 5 panes (4 team + the first terminal) show at once in one grid", panesD.length === 5 && noOverlap(panesD) && panesD.every((p) => p.rect[2] >= 150 && p.rect[3] >= 150), `shown ${panesD.length}; rects ${JSON.stringify(panesD.map((p) => p.rect))}`);
    check("D2: the 4 team panes are back, titled after their worktrees", wtNames.every((n) => panesD.some((p) => p.label === `${n} pane`)), JSON.stringify(panesD.map((p) => p.label)));
    check("D3: each team pane runs in its worktree (shell prompt shows the worktree name) and still has view = the project folder", wtNames.every((n) => joined.some((t) => t.includes(n))) && savedD.filter((p) => madeSet.has(norm(p.cwd ?? "")) && norm(p.view ?? "") === rootNorm).length === 4, `prompts ${JSON.stringify(joined.map((t) => t.slice(-120)))}`);
    check("D4: still no sidebar row for the worktrees", rowsMadeD.length === 0, `rows ${JSON.stringify(sbD.rows.map((r) => r.label))}`);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
    try {
      if (ctx) log(`screenshot at error: ${await safeShot(ctx, `${ID}-error`)}`);
    } catch {}
  }
  result.ok = ok;
  try {
    writeFileSync(`${LIVE_LOGS}/${ID}.RESULT.json`, JSON.stringify(result, null, 2));
  } catch {}
  const code = ctx ? await finish(ctx, ID, ev, ok) : 1;
  // Cleanup: the throwaway repo's team worktrees, then the repo itself (scratch folders below G:/Temp/live-v15 only).
  try {
    if (repo && existsSync(repo)) {
      for (const w of made) {
        await git(repo, ["worktree", "remove", "--force", w.path]).catch(() => {});
        if (w.path.includes("live-v15") || w.path.includes(base(repo))) rmSync(w.path, { recursive: true, force: true });
      }
      rmSync(repo, { recursive: true, force: true });
    }
  } catch (e) {
    console.log(`cleanup note: ${e.message}`);
  }
  process.exit(code);
}
