// LIVE check, feature-map round 5: the four controls a person reaches for most on the two screens that matter
// (the sidebar's folder row and the pane header). Each one is a real mouse press through CDP — `element.click()`
// skips the pointer path the app listens on (mousedown focuses the pane) — and each is judged by what the person
// sees changing, not by the handler existing:
//
//   sidebar folder row    click -> the row is the selected one and the workspace's grid is on screen
//   pane header Expand    click -> the other panes leave the grid (one pane fills it) and the button says Restore
//   pane header Restore   click -> every pane comes back, the same count as before
//   pane header Split right click -> one more shell pane, with a prompt in it
//
// Run through the runner: node scripts/stress/run-all.mjs --instances 1 --only controls
import { reporter, startPlain, finish, sleep, waitFor, targets, PAGE, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;

// src/projects/ProjectsPanel.tsx:2315-2323 — the folder row is `.sb-main`, its click target `button.branch`, and
// the row you picked carries `sel`.
const FOLDER_ROW = ".sb-main button.branch";
const FOLDER_ROW_SEL = ".sb-main button.branch.sel";
// src/terminal/TerminalPane.tsx:1870-1879 — one button, titled "Expand: …" or "Restore: …" depending on state.
const EXPAND_BTN = 'button[title^="Expand:"]';
const RESTORE_BTN = 'button[title^="Restore:"]';
// src/terminal/TerminalPane.tsx:1881 — the split button carries a test id.
const SPLIT_RIGHT = '[data-testid="pane-split-right"]';

let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

/** One CDP websocket for this script: mouse presses at a point. */
async function pageSend() {
  const list = await targets();
  const t = list.find((x) => x.type === "page" && PAGE.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params) =>
    new Promise((resolve) => {
      const mine = ++id;
      const on = (e) => { const m = JSON.parse(e.data); if (m.id === mine) { ws.removeEventListener("message", on); resolve(m.result); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  return { send, close: () => ws.close() };
}

try {
  ctx = await startPlain("CTRL", { report: rep });
  const { app } = ctx;
  const ws = await pageSend();
  await sleep(2500);
  const panes = () => app.shown(TERM);

  /** Real mouse press at the first on-screen match of `sel`; returns where it pressed, or null. */
  const press = async (sel, button = "left") => {
    const at = await app.evalJs(
      `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.offsetParent !== null); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; })()`,
    );
    if (!at) return null;
    await ws.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button, clickCount: 1 });
    await ws.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button, clickCount: 1 });
    return at;
  };

  // ---- 1. the sidebar folder row ---------------------------------------------------------------------------------
  const row = await app.evalJs(
    `(() => { const b = document.querySelector(${JSON.stringify(FOLDER_ROW)}); if (!b) return null; return { title: b.getAttribute("title"), selected: b.classList.contains("sel") }; })()`,
  );
  check("the sidebar has one folder row for the workspace", !!row, row ? `title "${row.title}", selected ${row.selected}` : "no .sb-main button.branch");
  const gridBefore = await panes();
  const pressedRow = await press(FOLDER_ROW);
  await sleep(1500);
  const afterRow = await app.evalJs(`(() => document.querySelector(${JSON.stringify(FOLDER_ROW_SEL)})?.getAttribute("title") ?? null)()`);
  const gridAfter = await panes();
  check(
    "clicking the folder row selects it and shows its grid",
    !!pressedRow && !!afterRow && gridAfter >= gridBefore && gridAfter >= 1,
    `pressed at ${JSON.stringify(pressedRow)}; selected row "${afterRow}"; ${gridBefore} -> ${gridAfter} pane(s) on screen`,
  );

  // ---- 2. Split right (the grid needs two panes before Expand means anything) -------------------------------------
  const beforeSplit = await panes();
  const splitAt = await press(SPLIT_RIGHT);
  await waitFor("a new pane beside this one", async () => (await panes()) > beforeSplit, 30000).catch(() => {});
  await sleep(3000); // let the new shell print its prompt: a pane that appeared is not the same as a shell that runs
  const afterSplit = await panes();
  const prompt = (await ctx.lines(afterSplit - 1))?.lines?.filter(Boolean).slice(-1)[0] ?? "";
  check(
    "Split right opens one more shell pane with a prompt in it",
    !!splitAt && afterSplit === beforeSplit + 1 && !!prompt.trim(),
    `pressed at ${JSON.stringify(splitAt)}; ${beforeSplit} -> ${afterSplit} pane(s); last pane's line ${JSON.stringify(prompt.slice(0, 60))}`,
  );

  // ---- 3. Expand, then Restore -----------------------------------------------------------------------------------
  // With one pane in the grid Expand is a no-op by design ("the only pane already fills the grid"), so this comes
  // after the split: two panes on screen, one of them expands to fill the grid, then both come back.
  const before = await panes();
  const expandAt = await press(EXPAND_BTN);
  await waitFor("the grid to show one pane", async () => (await panes()) === 1, 15000).catch(() => {});
  await sleep(500);
  const expanded = await panes();
  const says = await app.evalJs(`(() => document.querySelector(${JSON.stringify(RESTORE_BTN)})?.getAttribute("title") ?? null)()`);
  check(
    "Expand fills the grid with this pane and the button becomes Restore",
    !!expandAt && before > 1 && expanded === 1 && !!says,
    `pressed at ${JSON.stringify(expandAt)}; ${before} pane(s) -> ${expanded}; button "${says}"`,
  );
  const restoreAt = await press(RESTORE_BTN);
  await waitFor("every pane to come back", async () => (await panes()) === before, 15000).catch(() => {});
  await sleep(500);
  const restored = await panes();
  check(
    "Restore brings the other panes back, the same count as before",
    !!restoreAt && restored === before,
    `pressed at ${JSON.stringify(restoreAt)}; ${expanded} pane(s) -> ${restored} (before Expand: ${before})`,
  );

  ws.close();
  const shotFile = await ctx.shot("CTRL-controls");
  log(`screenshot: ${shotFile}`);
  log(`SUMMARY ${asserts.filter(Boolean).length}/${asserts.length} controls passed`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "CTRL", ev, ok) : 1);
