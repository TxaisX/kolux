// LIVE proof, VIEW-017 box 1 (spec/05): kill the agent's process without a done signal -> the label leaves "working" within
// the staleness window. A stand-in claude.cmd (banner, then waits) is the agent: no hook ever signals done. Hidden app.
import { execFile } from "node:child_process";
import { reporter, startPlain, finish, sleep, waitFor, snap, pickScreen, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
const CL = 'section.pane[data-agent*="claude"]';
const kill = (pid) => new Promise((r) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (e, o) => r(`${pid}: ${e ? "failed " + e.message.slice(0, 80) : "killed"}`)));
try {
  ctx = await startPlain("VIEW-017", { report: rep, standin: [] });
  const { app } = ctx;
  await sleep(3000);
  // The pane header's plus opens the New session menu (button.newtab went with the old tab strip).
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea");
  await app.click('[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]');
  await waitFor("the New tab menu", () => app.exists('[data-testid="new-session-menu"]'), 5000);
  await app.clickWhere('[data-testid="new-session-menu"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
  await waitFor("a Claude stand-in pane", () => app.shown(CL), 20000);
  await waitFor("the banner", async () => ((await ctx.text(0, CL)) ?? "").includes("stand-in for Claude Code"), 30000, 500);
  await pickScreen(app, "Agents");
  await sleep(1500);
  const word = () => app.evalJs(`(() => { const rows = [...document.querySelectorAll(".rail .sess[data-session]")].map((r) => ({ key: r.getAttribute("data-session"), group: r.closest(".rail-group")?.getAttribute("data-agent"), name: r.querySelector(".name")?.textContent.trim(), status: r.querySelector(".status")?.textContent.trim() ?? null, tone: r.querySelector(".status")?.className ?? "", line: r.querySelector(".sess-line")?.textContent.trim() ?? null })); return rows; })()`);
  const rows0 = await word();
  log(`rail rows before the kill: ${JSON.stringify(rows0)}`);
  const row0 = rows0.find((r) => /claude/i.test(r.group ?? ""));
  check("setup: the stand-in agent has a rail row reading Working", !!row0 && /^Working$/i.test(row0.status ?? ""), JSON.stringify(row0));
  log(`screenshot: ${await ctx.shot("VIEW-017-before-kill")}`);

  // Kill the stand-in's process tree (cmd.exe and its ping) -- the pane's own shell wrapper stays; no done signal is sent.
  const tree = await app.treeOf(app.pid);
  const standins = tree.filter((p) => /^(ping)\.exe$/i.test(p.name));
  log(`processes under the app: ${tree.map((p) => `${p.name}:${p.pid}`).join(" ")}`);
  check("setup: found the stand-in's ping process to kill", standins.length >= 1, JSON.stringify(standins.map((p) => p.pid)));
  const parents = tree.filter((p) => standins.some((s) => s.ppid === p.pid)).map((p) => p.pid);
  const t0 = Date.now();
  const kills = [];
  for (const pid of parents.length ? parents : standins.map((p) => p.pid)) kills.push(await kill(pid));
  log(`kill (the process the pane runs for the agent): ${kills.join("; ")}`);
  let left = null;
  const seen = [];
  while (Date.now() - t0 < 45000) {
    const r = (await word()).find((x) => /claude/i.test(x.group ?? ""));
    const w = r?.status ?? null;
    if (seen[seen.length - 1] !== w) seen.push(w);
    if (w && !/^Working$/i.test(w)) {
      left = Date.now() - t0;
      break;
    }
    await sleep(500);
  }
  log(`status words seen after the kill: ${JSON.stringify(seen)}; left Working after ${left} ms`);
  const finalRow = (await word()).find((x) => /claude/i.test(x.group ?? ""));
  log(`final row: ${JSON.stringify(finalRow)}`);
  check("the label leaves Working within the staleness window (30 s)", left !== null && left <= 30000, `${left} ms; words ${JSON.stringify(seen)}`);
  log(`screenshot: ${await ctx.shot("VIEW-017-after-kill")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-017", ev, ok) : 1);
