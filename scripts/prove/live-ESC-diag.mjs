// Diagnostic, no Claude: does a CDP Escape reach a pane's pty? PSReadLine clears the typed line on Esc.
import { scenario, sleep, rawKey } from "./live-claude-common.mjs";
import { allPaneBuffers } from "./live-common.mjs";

await scenario("ESC-DIAG", { cards: [], noOpen: true }, async (ctx, h) => {
  const { app } = ctx;
  const last = async () => {
    const b = (await allPaneBuffers(app, 'section.pane[data-agent="shell"]'))[0];
    return (b?.text ?? "").split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-2).join(" | ");
  };
  const focus = () => app.focusPane('section.pane[data-agent="shell"]', 0, ".xterm-helper-textarea");
  await focus(); await sleep(1500);
  await app.evalJs(`(() => { window.__bytes = []; window.__kd = []; window.addEventListener('keydown', (e) => window.__kd.push(e.key + '/' + e.code + '/' + e.keyCode + ' target=' + (e.target.className||e.target.tagName) + ' prevented=' + e.defaultPrevented), true); document.addEventListener('keydown', (e) => window.__kd.push('bubble prevented=' + e.defaultPrevented), false); const inv = window.__TAURI_INTERNALS__.invoke; window.__TAURI_INTERNALS__.invoke = function (c, a, o) { if (c === 'terminal_write') window.__bytes.push('W:' + JSON.stringify(a.data)); return inv.call(this, c, a, o); }; for (const p of document.querySelectorAll('section.pane[data-agent="shell"]')) for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { t.onData((x) => window.__bytes.push(JSON.stringify(x))); return true; } } return false; })()`);
  for (const how of ["cdp-key", "synthetic"]) {
    await focus();
    await app.cdp("insert", "abcdef");
    await sleep(500);
    h.log(`${how}: before: ${await last()}`);
    if (how === "cdp-key") await app.cdp("key", "Escape");
    else h.log("synthetic returned: " + JSON.stringify(await app.evalJs(`(() => { const ta = document.querySelector('section.pane[data-agent="shell"] .xterm-helper-textarea'); if (!ta) return 'no textarea'; const o = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }; ta.dispatchEvent(new KeyboardEvent("keydown", o)); ta.dispatchEvent(new KeyboardEvent("keyup", o)); return true; })()`)));
    await sleep(800);
    h.log(`${how}: xterm onData so far: ${await app.evalJs("window.__bytes.join(' ')")}`);
    h.log(`${how}: keydown seen: ${await app.evalJs("window.__kd.splice(0).join(' ; ')")}`);
    h.log(`${how}: after: ${await last()}`);
    await app.cdp("key", "Enter"); await sleep(500);
  }
});
