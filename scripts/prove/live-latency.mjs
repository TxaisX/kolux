// LIVE check, Goal 0 item 7 (Txais, 2026-11-12 ~11:20: "reduce the response time to mere milliseconds"):
// the three latency numbers the wave is judged on, measured in the running app.
//
//   keystroke -> character in the terminal    target < 16 ms  (one frame)
//   click -> visible response                 target < 50 ms
//   new session -> ready shell prompt         target < 300 ms
//
// How each one is measured, so the number means something:
//  - Every sample is taken INSIDE the page with performance.now(), from the real DOM event to the thing the user
//    sees. The CDP transport that delivered the key or the click is outside both ends of the window, so the number
//    is Kolux's own path (input -> IPC -> pty -> echo -> xterm write -> render), not the harness's.
//  - "Character on screen" is xterm's onRender after the echo: the frame the character was drawn in. The fallback
//    (onWriteParsed) is the buffer write, which is a little earlier than the draw.
//  - "Visible response" is the first DOM mutation after the press (a menu appearing). MutationObserver callbacks are
//    microtask-timed, so this is an upper bound on the app's own work.
//  - "Ready shell prompt" is the new pane's xterm buffer holding its first non-empty line. The shell is the user's
//    own; a slow profile is the shell's time, not Kolux's, and the run prints which shell it used.
//  - A machine running other lanes is slower than a quiet one: the run prints every sample, the median and the max,
//    and the feature map records the median with the date and the load.
import { reporter, startPlain, finish, sleep, waitFor, targets, PAGE, TERM, TID } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const TARGET = { key: 16, click: 50, session: 300 };
const KEYS = 12;

let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const round = (n) => (n === null || n === undefined ? "n/a" : `${n.toFixed(1)} ms`);

/** One CDP websocket for this script: mouse presses at a point, which `element.click()` cannot imitate. */
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
  ctx = await startPlain("LAT", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");

  // ---- 1. keystroke -> character ------------------------------------------------------------------------------
  // Stamp the keydown the browser delivers, then the first xterm render after it.
  const armed = await app.evalJs(`(() => {
    const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null)[0];
    if (!p) return "no pane";
    let host = null; for (const d of p.querySelectorAll("div")) if (d.__koluxTerm) { host = d; break; }
    if (!host) return "no xterm";
    const term = host.__koluxTerm;
    window.__lat = { start: 0, samples: [], pending: false };
    addEventListener("keydown", () => { window.__lat.start = performance.now(); window.__lat.pending = true; }, true);
    const done = () => { if (!window.__lat.pending) return; window.__lat.pending = false; window.__lat.samples.push(performance.now() - window.__lat.start); };
    if (term.onRender) term.onRender(done); else term.onWriteParsed(done);
    return "armed";
  })()`);
  check("the terminal exposes its xterm instance and a render hook", armed === "armed", String(armed));
  for (let i = 0; i < KEYS; i++) {
    await ctx.rawKey({ key: "a", code: "KeyA", vk: 65, text: "a" });
    await sleep(220);
  }
  const keySamples = (await app.evalJs("window.__lat ? window.__lat.samples : []")) ?? [];
  const keyMed = median(keySamples);
  log(`keystroke samples (ms): ${keySamples.map((n) => n.toFixed(1)).join(", ") || "none"}`);
  check(`keystroke -> character under ${TARGET.key} ms (median of ${keySamples.length})`, keyMed !== null && keyMed < TARGET.key, `median ${round(keyMed)}, max ${round(keySamples.length ? Math.max(...keySamples) : null)}`);
  // The typed characters are in the buffer: proof the samples above are echoes, not an empty render.
  const typed = (await ctx.text(0)) ?? "";
  check("the typed characters reached the shell", /a{6,}/.test(typed), JSON.stringify(typed.trim().split("\n").pop() ?? "").slice(0, 80));

  // ---- 2. click -> visible response ---------------------------------------------------------------------------
  let clickMed = null;
  const paneMenu = `${TERM}.focused button[title="Pane menu"], ${TERM}.focused [data-testid="pane-menu"]`;
  const hasMenu = await app.exists(paneMenu);
  if (hasMenu) {
    const box = await app.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(paneMenu)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    await app.evalJs(`(() => {
      window.__clat = { start: 0, ms: null };
      addEventListener("mousedown", () => { window.__clat.start = performance.now(); window.__clat.ms = null; }, true);
      window.__cobs = new MutationObserver(() => { if (window.__clat.start && window.__clat.ms === null) window.__clat.ms = performance.now() - window.__clat.start; });
      window.__cobs.observe(document.body, { subtree: true, childList: true, attributes: true });
      return true;
    })()`);
    const clicks = [];
    let menuOpened = false;
    const ws = await pageSend();
    try {
      for (let i = 0; i < 3; i++) {
        await ws.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
        await ws.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
        await sleep(500);
        const ms = await app.evalJs("window.__clat.ms");
        if (typeof ms === "number") clicks.push(ms);
        if (await app.exists('[role="menu"]')) menuOpened = true;
        await ctx.rawKey({ key: "Escape", code: "Escape", vk: 27 });
        await sleep(400);
      }
    } finally {
      ws.close();
    }
    clickMed = median(clicks);
    log(`click samples (ms): ${clicks.map((n) => n.toFixed(1)).join(", ") || "none"}`);
    check("the Pane menu really opened from the click", menuOpened, menuOpened ? "a [role=menu] appeared" : "no menu after three clicks");
    check(`click -> visible response under ${TARGET.click} ms (median of ${clicks.length})`, clickMed !== null && clickMed < TARGET.click, `median ${round(clickMed)}, max ${round(clicks.length ? Math.max(...clicks) : null)}`);
  } else {
    check("the pane header has a Pane menu to click", false, "no Pane menu button in the focused pane header");
  }

  // ---- 3. new session -> ready shell prompt --------------------------------------------------------------------
  await app.evalJs(`(() => {
    const before = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).length;
    window.__newLat = { start: 0, ms: null, before };
    addEventListener("mousedown", (e) => { if (e.target.closest?.('[role="menuitem"]')) window.__newLat.start = performance.now(); }, true);
    const tick = () => {
      const panes = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null);
      if (panes.length > window.__newLat.before) {
        if (!window.__newLat.paneAt) window.__newLat.paneAt = performance.now(); // Kolux drew the pane: its own work ends here
        const last = panes[panes.length - 1];
        let host = null; for (const d of last.querySelectorAll("div")) if (d.__koluxTerm) { host = d; break; }
        if (host) {
          const b = host.__koluxTerm.buffer.active;
          let text = ""; for (let y = 0; y < b.length; y++) text += b.getLine(y)?.translateToString(true) ?? "";
          if (text.trim() && window.__newLat.start && window.__newLat.ms === null) {
            window.__newLat.ms = performance.now() - window.__newLat.start;
            return;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  const panesBefore = await app.shown(TERM);
  await app.click(`${TERM}.focused ${TID.paneNewSession}`);
  await waitFor("the New session menu", () => app.exists(TID.newSessionMenu), 5000);
  // The press and its timestamp in one page call: `element.click()` fires no mousedown, so the clock starts here, a
  // few tenths of a millisecond before the click handler runs — nothing like the 300 ms being measured.
  const pressed = await app.evalJs(`(() => {
    const item = [...document.querySelectorAll(${JSON.stringify(TID.newSessionMenu)} + ' [role="menuitem"]')]
      .find(x => /^\\s*Blank terminal\\s*$/.test((x.querySelector(".name") ?? x).textContent || ""));
    if (!item) return "no Blank terminal item";
    window.__newLat.start = performance.now();
    item.click();
    return "pressed";
  })()`);
  if (pressed !== "pressed") throw new Error(`new session: ${pressed}`);
  await waitFor("a new pane", async () => (await app.shown(TERM)) > panesBefore, 30000);
  await sleep(2500);
  const newMs = await app.evalJs("window.__newLat ? window.__newLat.ms : null");
  const paneMs = await app.evalJs("window.__newLat && window.__newLat.paneAt && window.__newLat.start ? window.__newLat.paneAt - window.__newLat.start : null");
  const shell = (await ctx.lines(panesBefore))?.lines?.filter(Boolean).slice(-1)[0] ?? "";
  log(`new-session sample: ${round(typeof newMs === "number" ? newMs : null)}; Kolux's own part (pane drawn): ${round(typeof paneMs === "number" ? paneMs : null)}; shell's part: ${round(typeof newMs === "number" && typeof paneMs === "number" ? newMs - paneMs : null)}`);
  log(`new-session shell prompt line: ${JSON.stringify(shell.slice(0, 80))}`);
  check(`new session -> ready prompt under ${TARGET.session} ms`, typeof newMs === "number" && newMs < TARGET.session, `${round(typeof newMs === "number" ? newMs : null)} (Kolux's part ${round(typeof paneMs === "number" ? paneMs : null)}, the shell's own start the rest; prompt: ${JSON.stringify(shell.slice(0, 40))})`);

  const shotFile = await ctx.shot("LAT-latency");
  log(`screenshot: ${shotFile}`);
  log(`SUMMARY keystroke ${round(keyMed)} (target ${TARGET.key}) | click ${round(clickMed)} (target ${TARGET.click}) | new session ${round(typeof newMs === "number" ? newMs : null)} (target ${TARGET.session})`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "LAT", ev, ok) : 1);
