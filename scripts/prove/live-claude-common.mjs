// Shared scaffolding for the REAL-Claude live proofs (live-v13, test account A only): one scenario() per script runs a hidden dev app,
// a real signed-in Claude Code pane (startProve in live-common.mjs), the assertions of the script, then writes the evidence section.
// Nothing here opens a credential file; account A is only named as CLAUDE_CONFIG_DIR for the pane's claude.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ACCOUNT_A, CLAUDE, LOGS, NeedsLogin, ROOT, excerpt, reporter, sleep, startProve, waitFor } from "./live-common.mjs";
import { guardReport } from "../evidence/app-launch.mjs";
import { checker, pickScreen } from "./live-views-dom.mjs";

export { CLAUDE, excerpt, sleep, waitFor, git, ACCOUNT_A, BASE } from "./live-common.mjs";
// What the registry PATH resolves (TERM-120, batch 8), derived from this machine's profile so the
// script carries no one's home folder.
export const CLAUDE_EXE = join(process.env.USERPROFILE || homedir(), ".local", "bin", "claude.exe");
export const DATE = "2026-10-28";
const MARK = (id) => `<<live-v13:${id}>>`;
const redact = (s) => String(s).replace(/[\w.+-]+@[\w.-]+\.\w+/g, "<account-a>").replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<home>").replace(/Users[\\/]+[^\\/\s"']+/gi, "<home>");

// Batch 13 counts every claude.exe start, so the version is read from the install folder (the versioned copy with the same size), never by running --version.
export const claudeVersion = () => {
  try {
    const dir = `${CLAUDE_EXE.replace(/\/bin\/claude\.exe$/, "")}/share/claude/versions`;
    const size = statSync(CLAUDE_EXE).size;
    const hit = readdirSync(dir).find((n) => statSync(`${dir}/${n}`).size === size);
    return hit ? `${hit} (matched by file size, not run)` : "unknown (no versioned copy matches)";
  } catch (e) {
    return `unreadable (${String(e.message).slice(0, 60)})`;
  }
};

/** The pane header word of the first shown Claude pane (the .st dot's label, "status: Working"), or null. */
export const paneWord = (app) =>
  app.evalJs(`(() => { for (const s of document.querySelectorAll(${JSON.stringify(CLAUDE)})) { if (s.offsetParent === null) continue; const st = s.querySelector(".pane-head .st"); return st ? (st.getAttribute("aria-label") || "").replace(/^status:\\s*/, "") : null; } return null; })()`);

/** The Board card of the first Claude pane: its chip word, line and action buttons (null when the Board is not showing). */
export const boardChip = (app) =>
  app.evalJs(`(() => { const s = document.querySelector("section.pane.card[data-agent*=\\"claude\\"]") || document.querySelector("section.pane.card"); if (!s) return null; const r = s.querySelector(".chip-row"); if (!r) return { word: null, buttons: [] }; return { word: r.querySelector(".chip-word")?.textContent ?? null, line: r.querySelector(".chip-line")?.textContent ?? null, buttons: [...r.querySelectorAll(".chip-actions button")].map((b) => b.textContent.trim()) }; })()`);
export const clickChipButton = (app, label) =>
  app.evalJs(`(() => { const b = [...document.querySelectorAll("section.pane.card .chip-actions button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
export const goScreen = (app, label) => pickScreen(app, label);

/** Programs of the real agents anywhere under the app now (claude expected; anything else is reported). */
export async function agentExes(app) {
  const tree = await app.treeOf(app.pid);
  return tree.filter((p) => /^(claude|codex|gemini|grok|cursor-agent|agent|copilot|openclaude)(\.exe)?$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`);
}

/** One raw key press over CDP (rawKeyDown/keyUp with a virtual-key code); startProve's ctx has no rawKey. mods: Alt 1, Ctrl 2, Shift 8. */
export async function rawKey({ key, code, vk, mods = 0, text }) {
  const targets = await (await fetch("http://127.0.0.1:9290/json")).json();
  const t = targets.find((x) => x.type === "page" && /localhost:1470|tauri\.localhost/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params) =>
    new Promise((resolve) => {
      const mine = ++id;
      const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === mine) { ws.removeEventListener("message", on); resolve(m); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  const k = { key, code, windowsVirtualKeyCode: vk, modifiers: mods };
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, ...(text ? { text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
  ws.close();
}

export async function shot(name) {
  const targets = await (await fetch("http://127.0.0.1:9290/json")).json();
  const t = targets.find((x) => x.type === "page" && /localhost:1470|tauri\.localhost/.test(x.url));
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const data = await new Promise((resolve) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result?.data ?? null); };
    ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
  });
  ws.close();
  mkdirSync(LOGS, { recursive: true });
  const file = `${LOGS}/${name}.png`;
  if (data) writeFileSync(file, Buffer.from(data, "base64"));
  return data ? file : null;
}

/** Appends (replacing an earlier run's) LIVE section to evidence/cards-<card>.txt, redacted. */
export function writeEvidence(card, id, lines, result) {
  const file = `${ROOT}/evidence/cards-${card}.txt`;
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const m = MARK(id);
  const i = text.indexOf(m);
  if (i >= 0) text = text.slice(0, i).replace(/\s+$/, "\n");
  const body = [`${m}`, `LIVE ${DATE} (real Claude, test account) ${id}: ${result}`, ...lines.map((l) => `  ${redact(l)}`)].join("\n");
  writeFileSync(file, `${text.replace(/\s*$/, "\n")}\n${body}\n`);
}

/**
 * id: script id. opts: {cards: [card ids whose evidence file gets the section], claudeArgs, files, branch, dirty, ready: false to skip waiting for the prompt box}.
 * body(ctx, h): h = {log, check, shot, word}. Exit code 0 only when every check held.
 */
export async function scenario(id, opts, body) {
  const rep = reporter();
  const { log, lines } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  let closed = null;
  log(`LIVE ${DATE} ${id}: claude.exe ${CLAUDE_EXE}, version ${claudeVersion()}; account <account-a>; scratch repo under ${LOGS.replace("-logs", "")}/work`);
  try {
    // opts.noSettingsFlag: the pane gets NO `--settings <scratch>` override, so Claude reads only its account's own settings.json.
    const defaultArgs = `--model haiku --permission-mode manual${opts.noSettingsFlag ? "" : " --settings ${SETTINGS}"}`;
    ctx = await startProve(id, { report: rep, files: { "README.md": "scratch repo for a live proof\n" }, claudeArgs: defaultArgs, ...opts });
    if (!opts.noOpen) {
      await ctx.openClaude();
      if (opts.ready !== false) log(`claude ready: ${excerpt(await ctx.ready(), 3)}`);
    }
    await body(ctx, { log, check: chk.check, shot: (n) => shot(`${id}${n ? `-${n}` : ""}`), word: () => paneWord(ctx.app) });
    const exes = await agentExes(ctx.app);
    log(`agent programs under the app: ${exes.join(", ") || "none"}; non-claude agent exe: ${exes.filter((e) => !/^claude/i.test(e)).join(", ") || "none"}`);
    ok = chk.allPassed();
  } catch (e) {
    log(e instanceof NeedsLogin ? `NEEDS LOGIN ${e.message}` : `ERROR ${e.stack ?? e}`);
  }
  if (ctx) closed = await ctx.stop().catch((e) => [false, String(e.message)]);
  const report = guardReport({ lines, ok, guard: ctx?.app?.guard, close: closed });
  for (const line of report.tail) console.log(line);
  writeFileSync(`${LOGS}/${id}.out.txt`, `${report.text}\n`);
  for (const c of opts.cards ?? []) writeEvidence(c, id, report.lines, report.verdict);
  process.exit(report.code);
}

/** Types a fixed prompt as the user would (text then Enter) and returns the time of the Enter. */
export async function send(ctx, text) {
  await ctx.press(text);
  await sleep(400);
  const t = Date.now();
  await ctx.enter();
  return t;
}
