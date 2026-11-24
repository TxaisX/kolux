// LIVE proof, SAFE-024 box 1 (spec/10), after MERGE 415: six Claude agents (real Claude, test account A) started together from the
// New session page, each in its own new worktree, all begin without a folder-trust menu. The trust question is never answered here.
// Kolux's own side: six fresh worktrees; Claude's side: each pane's screen shows its prompt box, none shows the trust menu.
import { scenario, sleep } from "./live-claude-common.mjs";
import { poll } from "./live-proj-common.mjs";
import { openSheet } from "./live-SESS-018.mjs";
import { watchPanes, trustLogLines, TRUST_RE } from "./live-trust-common.mjs";

const ROOT = ".sheet-wrap";
const R = JSON.stringify(ROOT);

await scenario(
  "SAFE-024",
  {
    cards: ["SAFE-024"],
    noOpen: true,
    claudeArgs: "--permission-mode manual --settings ${SETTINGS}",
    settings: { uiLook: "new" },
  },
  async (ctx, h) => {
    const { app } = ctx;
    h.check("the New session page opens", !!(await openSheet(app)), "");
    await sleep(600);
    await app.clickWhere(`${ROOT} [role=group][aria-label="How many sessions"] button`, "/^\\s*6\\s*$/");
    const six = await poll(async () => ((await app.evalJs(`document.querySelectorAll(${R} + ' [role=radiogroup][aria-label$=": which AI"]').length`)) === 6 ? true : null), 8000, 300);
    h.check("six seats are on the page", !!six, "");
    for (let i = 1; i <= 6; i++) {
      const picked = await app.evalJs(`(() => { const g = document.querySelector(${R} + ' [role=radiogroup][aria-label="Seat ${i}: which AI"]'); const l = [...g.querySelectorAll("label")].find((x) => /^\\s*Claude/.test(x.textContent)); if (!l) return false; l.querySelector("input").click(); return true; })()`);
      if (!picked) throw new Error(`seat ${i}: no Claude choice on the page`);
      await poll(() => app.exists(`${ROOT} [role=radiogroup][aria-label="Seat ${i}: which model"]`), 5000, 200);
      await app.evalJs(`(() => { const g = document.querySelector(${R} + ' [role=radiogroup][aria-label="Seat ${i}: which model"]'); const ls = [...g.querySelectorAll("label")]; const l = ls.find((x) => /haiku/i.test(x.textContent)) ?? ls[0]; l.querySelector("input").click(); return true; })()`);
    }
    // The sheet may open on "Same folder for all" (a saved lineup or the default); pick the separate copies explicitly and log what the radio says.
    const sepPick = await app.evalJs(`(() => { const g = document.querySelector(${R} + ' [role=radiogroup][aria-label="Where the AIs work"]'); const l = g && [...g.querySelectorAll("label")].find((x) => /Separate/i.test(x.textContent)); if (!l) return "no Separate choice"; const i = l.querySelector("input"); const was = i.checked; if (i.disabled) return "Separate is disabled"; i.click(); return was ? "already checked" : "clicked"; })()`);
    h.log(`Separate copy radio: ${sepPick}`);
    await sleep(500);
    await app.focusField(`${ROOT} textarea[aria-label="Task for all of them"]`);
    await app.cdp("insert", "Reply with the single word ok. Do not use any tools.");
    const state = await app.evalJs(`(() => { const sheet = document.querySelector(${R}); const sep = [...sheet.querySelectorAll('[role=radiogroup][aria-label="Where the AIs work"] input')].map((i) => ({ text: i.parentElement.textContent.trim(), checked: i.checked })); const seats = [1,2,3,4,5,6].map((i) => ({ ai: [...sheet.querySelectorAll('[role=radiogroup][aria-label="Seat ' + i + ': which AI"] input')].filter((x) => x.checked).map((x) => x.parentElement.textContent.trim()), model: [...sheet.querySelectorAll('[role=radiogroup][aria-label="Seat ' + i + ': which model"] input')].filter((x) => x.checked).map((x) => x.parentElement.textContent.trim()) })); return { sep, seats }; })()`);
    h.log(`sheet: ${JSON.stringify(state).slice(0, 700)}`);
    h.check("copies are separate (a new worktree for each AI)", state.sep.some((s) => s.checked && /Separate/i.test(s.text)), JSON.stringify(state.sep));
    const start = await poll(async () => await app.evalJs(`(() => { const b = document.querySelector(${R} + " .chooser-foot .btn.primary"); return b && !b.disabled ? b.textContent.trim() : null; })()`), 20000, 400);
    h.log(`start button: ${JSON.stringify(start)}`);
    h.check("Start is enabled", !!start, String(start));
    if (process.env.PROVE_DRY) { h.log("PROVE_DRY: sheet set up, Start not clicked (no session used)"); h.log(`screenshot: ${await h.shot("dry")}`); return; }
    const t0 = Date.now();
    await app.click(`${ROOT} .chooser-foot .btn.primary`);
    const panes = await watchPanes(app, 6, 180000, h.log);
    h.log(`six panes reached the screen readings after ${Date.now() - t0} ms: ${panes.length} Claude panes`);
    for (const [i, p] of panes.entries()) h.log(`pane ${i + 1}: state=${p.state}; screen: ${p.text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).join(" | ").slice(0, 200)}`);
    h.check("there are six Claude panes", panes.length === 6, `panes=${panes.length}`);
    h.check("none of the six shows a folder-trust menu", panes.length === 6 && panes.every((p) => !TRUST_RE.test(p.text) && p.state !== "trust"), panes.map((p) => p.state).join(","));
    h.check("all six reached their prompt box", panes.every((p) => p.state === "prompt"), panes.map((p) => p.state).join(","));
    for (const l of trustLogLines(ctx.TEMP)) h.log(`kolux.log: ${l}`);
    h.log(`screenshot: ${await h.shot("six")}`);
  },
);
