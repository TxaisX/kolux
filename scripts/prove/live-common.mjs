// Live-proof helpers for the prove lane (2026-10-26): launch the dev app hidden, put a throwaway repo in it as a project,
// open a REAL Claude Code pane signed in with the Txais-approved test account A, and read and drive that pane over CDP.
//
// Safety shape (see evidence/T-025-d.txt for why):
//  - the APP runs with CLAUDE_CONFIG_DIR = a scratch folder (below its TEMP, with the scratch marker): a debug build
//    writes agent hook entries only there. Its hook sync is what installs the entries.
//  - the PANE's claude runs with CLAUDE_CONFIG_DIR = account A (agentOptions.claude.env) so the real sign-in is used, and
//    `--settings <the scratch settings.json>` so Claude loads the entries the app installed.
//  - nothing here reads or writes a credential file; the account folder is only named as a variable value.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, guardReport, runWord, sleep, waitFor } from "../evidence/app-launch.mjs";

export { sleep, waitFor };
export const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
// Ports of the prove app; PROVE_PORT / PROVE_CDP let two sessions run live proofs at once.
const PORT = process.env.PROVE_PORT || "1470";
const CDPP = process.env.PROVE_CDP || "9290";
const PAGE = new RegExp(`localhost:${PORT}|tauri\\.localhost`);
// Test account A lives outside the old-app folders (X-proc.6); set KOLUX_LIVE_ACCOUNT_A to use another folder.
export const ACCOUNT_A = process.env.KOLUX_LIVE_ACCOUNT_A || "G:/Temp/live-signin/account-a";
export const BASE = "G:/Temp/live-v15";
export const LOGS = "G:/Temp/live-v15-logs";
export const CLAUDE = 'section.pane[data-agent*="claude"]';

// Nothing of the old app, no token variable and no API key may reach the app, its panes or Claude.
for (const k of Object.keys(process.env)) {
  if (k.startsWith("KOLUX_") || k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE" || k === "CLAUDE_CONFIG_DIR" || k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") delete process.env[k];
}

export class NeedsLogin extends Error {}

/** Evidence lines: printed and kept for the evidence file. */
export function reporter() {
  mkdirSync(LOGS, { recursive: true });
  const lines = [];
  const log = (...a) => {
    const s = a.join(" ");
    lines.push(s);
    console.log(s);
  };
  return { log, lines };
}

const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_TRACE")) delete e[k];
  return e;
};
export const git = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile("git", ["-c", "user.name=prove", "-c", "user.email=prove@example.invalid", ...args], { cwd, env: cleanEnv(), windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout),
    ),
  );

/**
 * id: task id. opts.report: from reporter(). opts.claudeArgs: arguments of the Claude pane ("${SETTINGS}" becomes the scratch
 * settings.json; a permissions-skipping flag is refused). opts.files: {name: text} committed on main.
 * opts.branch: a branch checked out after the first commit. opts.trace: a folder GIT_TRACE2 points at for the app.
 * opts.dirty: {name: text} written (uncommitted) after the first commit.
 * opts.prepare(repo): more repo setup before the app starts (e.g. a scratch bare remote). opts.allowSkip: true lets claudeArgs skip
 * permission checks, but only when the repo has no remote outside BASE (every remote URL is a scratch bare repo under BASE).
 */
export async function startProve(id, opts) {
  const { log } = opts.report;
  const skipping = /dangerously|bypassPermissions|yolo/i.test(opts.claudeArgs);
  if (skipping && !opts.allowSkip) throw new Error("refused: a permissions-skipping flag is not allowed in this lane");
  const TEMP = `${BASE}/run-${id}`;
  const repo = `${BASE}/work/${id}`;
  const settingsFile = `${TEMP}/tmp/claude-config/settings.json`;
  const app = createApp({ root: ROOT, port: PORT, cdp: CDPP, identifier: "com.txaisxiong.kolux-rs.prove", temp: TEMP, suffix: ".prove", offscreen: true, buildMinutes: 30, log, ipcGuard: true, afterReload: (a) => (opts.keepFirstRun ? null : dismissFirstRun(a, log)) });
  const { profile } = app.paths;
  // A fresh run folder: only a folder this lane made (it carries the marker) is wiped.
  if (existsSync(TEMP)) {
    if (!existsSync(join(TEMP, ".prove-run"))) throw new Error(`${TEMP} exists without the prove marker`);
    rmSync(TEMP, { recursive: true, force: true });
  }
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(join(TEMP, ".prove-run"), "made by scripts/prove/live-common.mjs\n");
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(repo, name), text);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-q", "-m", "start"]);
  if (opts.branch) {
    await git(repo, ["checkout", "-q", "-b", opts.branch]);
    writeFileSync(join(repo, "branch.txt"), "one commit over main\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-q", "-m", "branch work"]);
  }
  for (const [name, text] of Object.entries(opts.dirty ?? {})) writeFileSync(join(repo, name), text);
  if (opts.prepare) await opts.prepare(repo);
  if (skipping) {
    const urls = (await git(repo, ["remote", "-v"])).split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[1]);
    log(`git remote -v in ${repo}: ${urls.join(", ") || "(no remote)"}`);
    if (urls.length === 0 || urls.some((u) => !u.replace(/\\/g, "/").startsWith(`${BASE}/`))) throw new Error(`refused: skipping permission checks needs every remote to be a scratch bare repo under ${BASE}`);
  }
  if (opts.trace) {
    rmSync(opts.trace, { recursive: true, force: true });
    mkdirSync(opts.trace, { recursive: true });
    process.env.GIT_TRACE2 = opts.trace;
  }
  const seeded = {
    confirmCloseRunning: false,
    agentStatusHooks: true,
    agentOptions: { claude: { env: `CLAUDE_CONFIG_DIR=${ACCOUNT_A}`, args: opts.claudeArgs.replaceAll("${SETTINGS}", settingsFile) } },
    ...(opts.settings ?? {}), // e.g. uiLook: "new" for the screen switcher
  };
  await app.launch({
    prepare: () => {
      rmSync(profile, { recursive: true, force: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, "settings.json"), JSON.stringify(seeded, null, 2));
    },
  });
  delete process.env.GIT_TRACE2;
  const { evalJs, cdp, click, clickWhere, exists, shown, focusPane, focusField } = app;
  // The app's hook sync wrote its entries into the scratch settings.json (the file --settings points at).
  await waitFor("the hook entries in the scratch settings.json", () => existsSync(settingsFile) && /agent-hooks/.test(readFileSync(settingsFile, "utf8")), 30000, 500);
  // Hook events as the window hears them.
  await evalJs(`(async () => { window.__proveEvents = []; const cb = window.__TAURI_INTERNALS__.transformCallback((e) => window.__proveEvents.push({ t: Date.now(), ...e.payload })); await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "agent-status", target: { kind: "Any" }, handler: cb }); return true; })()`);
  // The repo as a project: its first shell opens.
  await waitFor("the sidebar add button", () => exists('aside.sidebar button[aria-label="Add project"]'), 30000);
  await click('aside.sidebar button[aria-label="Add project"]');
  await waitFor("the add-by-path item", () => exists('button[data-add-by-path]'), 5000);
  await click('button[data-add-by-path]');
  await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
  await focusField('input[aria-label="project folder"]');
  await cdp("insert", repo, "enter");
  await waitFor("the first shell pane", async () => (await shown("section.pane[data-agent]")) >= 1, 30000);

  const ctx = {
    app, TEMP, repo, settingsFile, log,
    events: () => evalJs("window.__proveEvents"),
    screen: () =>
      evalJs(`(() => { for (const sec of document.querySelectorAll(${JSON.stringify(CLAUDE)})) { if (sec.offsetParent === null) continue; for (const d of sec.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const rows = []; for (let y = 0; y < t.rows; y++) rows.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? ""); return rows; } } } return null; })()`),
    async screenText() {
      return ((await ctx.screen()) ?? []).join("\n");
    },
    async openClaude() {
      await click("button.newtab");
      await waitFor("the New tab menu", () => exists('[role="menu"][aria-label="New tab"]'), 5000);
      await clickWhere('[role="menu"][aria-label="New tab"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
      await waitFor("a Claude pane", () => shown(CLAUDE), 20000);
      await waitFor("its input field", () => exists(`${CLAUDE} .xterm-helper-textarea`), 20000);
    },
    /** Waits for the Claude prompt box, answering only the folder-trust question; a login screen means NEEDS LOGIN. */
    async ready(ms = 120000) {
      const end = Date.now() + ms;
      let last = 0;
      for (;;) {
        const t = await ctx.screenText();
        if (/login method|please run \/login|not logged in|log in to claude|Paste code here|Invalid API key|Anthropic Console|Sign in/i.test(t)) throw new NeedsLogin(`claude asks for a login: ${t.split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 200)}`);
        // Only with opts.allowSkip (a scratch repo + scratch bare remote): Claude's own "Bypass Permissions mode" warning; the pre-selected answer is "No, exit".
        if (/Bypass Permissions mode/i.test(t) && /Yes, I accept/i.test(t)) {
          if (Date.now() - last > 4000) {
            last = Date.now();
            log('  (bypass-permissions warning: chose "Yes, I accept" for the scratch repo)');
            await ctx.focus();
            await cdp("key", "ArrowDown");
            await sleep(300);
            await ctx.enter();
          }
          await sleep(1000);
          continue;
        }
        // First-run questions of the test account (the sign-in is already there): accept the pre-selected answer, one Enter each.
        const first = /Choose the text style|Press Enter to continue|trust this folder|Do you trust|Yes, I trust|Use recommended settings/i.exec(t);
        if (first) {
          if (Date.now() - last > 4000) {
            last = Date.now();
            // The trust question starts on "No, exit": move to "Yes, I trust this folder" (a scratch repo made by this script).
            const trust = /trust this folder|Do you trust|Yes, I trust/i.test(t);
            log(`  (first-run screen "${first[0]}": ${trust ? "chose Yes, I trust this folder for the scratch repo" : "accepted the pre-selected answer"})`);
            if (trust && /❯\s*No, exit/.test(t)) {
              await ctx.focus();
              await cdp("key", "ArrowDown");
              await sleep(300);
            }
            await ctx.enter();
          }
        } else if (/Try the new fullscreen renderer/i.test(t)) {
          if (Date.now() - last > 4000) {
            last = Date.now();
            log('  (first-run notice "Try the new fullscreen renderer?": answered 2, Not now)');
            await ctx.press("2");
          }
        } else if (/\? for shortcuts|shift\+tab to cycle|(plan|auto|manual|default) mode on|accept edits on|esc to interrupt/i.test(t)) return t;
        if (Date.now() > end) throw new Error(`claude was not ready after ${ms} ms; screen: ${t.split("\n").filter(Boolean).slice(-8).join(" | ").slice(0, 400)}`);
        await sleep(1000);
      }
    },
    focus: () => focusPane(CLAUDE, 0, ".xterm-helper-textarea"),
    async press(text) {
      await ctx.focus();
      await cdp("insert", text);
    },
    async enter() {
      await ctx.focus();
      await cdp("key", "Enter");
    },
    async say(text) {
      await ctx.press(text);
      await sleep(500);
      await ctx.enter();
    },
    waitScreen: (re, ms = 120000, what = String(re)) =>
      waitFor(`the screen to show ${what}`, async () => {
        const t = await ctx.screenText();
        return re.test(t) ? t : null;
      }, ms, 1000),
    waitEvent: (pred, ms = 120000, what = "an event") => waitFor(what, async () => (await ctx.events()).find(pred) ?? null, ms, 500),
    async paneKey() {
      return (await ctx.events())[0]?.paneKey ?? null;
    },
    history: (paneKey) => app.invoke("agent_history", { paneKey }),
    /** Types a line into the n-th shown pane matching sel (default: a shell pane) through the input pipeline, then Enter. */
    async typeInto(index, line, sel = 'section.pane[data-agent="shell"]') {
      await focusPane(sel, index, ".xterm-helper-textarea");
      await cdp("insert", line, "enter");
    },
    /** A CDP page screenshot (PNG) written to LOGS/<name>.png. */
    shot: async (name) => (await import("./live-claude-common.mjs")).shot(name),
    /** The word a run's own evidence line gets: NOT-TESTED when the IPC guard went blind during it. */
    verdict: (ok) => runWord(ok, app.guard.blind),
    stop: () => guardedStop(app, log),
  };
  return ctx;
}

/** The scratch hook entries as Claude would load them: the event names whose entries name Kolux's hook script. */
export function hookEventsInstalled(settingsFile) {
  const j = JSON.parse(readFileSync(settingsFile, "utf8"));
  return Object.entries(j.hooks ?? {})
    .filter(([, groups]) => JSON.stringify(groups).includes("agent-hooks"))
    .map(([name]) => name);
}

/** Rows of the screen with the blank ones dropped, trimmed for the evidence file (a short excerpt only). */
export const excerpt = (text, n = 6) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-n).join(" | ").slice(0, 400);

// ---------- live-v1 (2026-10-26): terminal/pane boxes with plain shells and a stand-in agent, no sign-in ----------
export const LIVE_BASE = "G:/Temp/live-v15";
export const LIVE_LOGS = "G:/Temp/live-v15-logs";
export const TERM = "section.pane[data-agent]";
export const SHELL = 'section.pane[data-agent="shell"]';

/** A stand-in claude.cmd: prints a banner and stays up (no network, no sign-in). body = extra batch lines run after the banner. */
export function writeStandinClaude(dir, body = []) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "claude.cmd");
  writeFileSync(file, ["@echo off", "echo Kolux stand-in for Claude Code (live-v1): banner only", ...body, "ping -n 3600 127.0.0.1 >nul", ""].join("\r\n"));
  return file;
}

/** T-763: ends a run, first checking the guard while the app is still up. A guard that went blind is recorded in
 *  app.guard, so the report (finish) ends NOT-TESTED instead of PASS. An app this run already closed by its own path
 *  is not probed: the page is gone, not the guard. */
async function guardedStop(app, log) {
  if (app.pid && (await app.alive(app.pid)) && !(await app.guardOk())) {
    app.guard.noteBlind("the end of the run");
    log("the IPC guard was blind at the end of this run");
  }
  return app.closeApp();
}

/** Closes the first-run guide (Close, then Skip in its "Skip setup?" question) and any other modal, so clicks and chords reach the grid. */
export async function dismissFirstRun(app, log) {
  const any = '[role="dialog"], [role="alertdialog"]';
  for (let t = 0; t < 10; t++) {
    if (!(await app.exists(any))) return true;
    const label = await app.evalJs(`document.querySelector('[role="dialog"], [role="alertdialog"]')?.getAttribute("aria-label") ?? "(no label)"`);
    const asked = await app.evalJs(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Skip") && /Skip setup\\?/.test(document.body.innerText)`);
    if (asked) await app.clickWhere("button", "/^\\s*Skip\\s*$/");
    else if (await app.exists('[role="dialog"] button[aria-label="Close setup"]')) await app.click('[role="dialog"] button[aria-label="Close setup"]');
    else await app.cdp("key", "Escape");
    await sleep(800);
    log(`closed a first-run dialog: ${label} (${asked ? "Skip" : "Close"}); still open: ${await app.exists(any)}`);
  }
  return !(await app.exists(any));
}

/**
 * id: card id. opts.report: from reporter(). opts.settings: extra settings seeded before launch. opts.standin: lines for a
 * stand-in claude.cmd that agentOptions.claude.command points at. Scratch root G:/Temp/live-v1/run-<id>; the repo is a
 * throwaway git repo added as a project (first shell opens). Returns helpers over CDP.
 */
export async function startPlain(id, opts) {
  const { log } = opts.report;
  const TEMP = `${LIVE_BASE}/run-${id}`;
  const repo = `${LIVE_BASE}/work/${id}`;
  const app = createApp({ root: ROOT, port: PORT, cdp: CDPP, identifier: "com.txaisxiong.kolux-rs.prove", temp: TEMP, suffix: ".prove", offscreen: true, buildMinutes: 30, log, ipcGuard: true, afterReload: (a) => (opts.keepFirstRun ? null : dismissFirstRun(a, log)) });
  const { profile } = app.paths;
  if (existsSync(TEMP)) {
    if (!existsSync(join(TEMP, ".prove-run"))) throw new Error(`${TEMP} exists without the prove marker`);
    rmSync(TEMP, { recursive: true, force: true });
  }
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(join(TEMP, ".prove-run"), "made by scripts/prove/live-common.mjs startPlain\n");
  writeFileSync(join(TEMP, ".kolux-rs-scratch"), "");
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  const put = (name, text) => {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), text);
  };
  for (const [name, text] of Object.entries(opts.files ?? { "notes.txt": "live-v1\n" })) put(name, text);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-q", "-m", "start"]);
  // opts.dirty: {name: text} written after the first commit, so the repo starts with uncommitted changes.
  for (const [name, text] of Object.entries(opts.dirty ?? {})) put(name, text);
  // opts.prepare(repo): more repo setup before the app starts, e.g. a second git worktree the app lists when the project is added.
  if (opts.prepare) await opts.prepare(repo);
  // uiLook is written down: a profile with any setting reads as Classic, and the clean (New) look is what a new install shows.
  const seeded = { confirmCloseRunning: false, agentStatusHooks: true, uiLook: "new", ...(opts.settings ?? {}) };
  if (opts.standin) {
    seeded.agentOptions = { claude: { command: writeStandinClaude(join(TEMP, "standin"), opts.standin) } };
    // The stand-in is on the app's PATH before it starts, so the catalogue never finds (or starts) a real claude.
    process.env.PATH = `${join(TEMP, "standin").replace(/\//g, "\\")};${process.env.PATH}`;
  }
  // opts.pathDirs: folders put at the front of the app process's own PATH (a scratch one; the real system and user PATH are never touched).
  for (const d of opts.pathDirs ?? []) process.env.PATH = `${d.replace(/\//g, "\\")};${process.env.PATH}`;
  // opts.trace: a folder GIT_TRACE2 points at for the app, so each git process the app starts leaves one trace file there.
  if (opts.trace) {
    rmSync(opts.trace, { recursive: true, force: true });
    mkdirSync(opts.trace, { recursive: true });
    process.env.GIT_TRACE2 = opts.trace;
  }
  const { evalJs, cdp, click, clickWhere, exists, shown, focusPane, focusField, waitFor: wf } = app;
  // Any failure from here on closes the app this run started, so it never keeps holding the CDP port for the next run.
  try {
    await app.launch({
      prepare: () => {
        rmSync(profile, { recursive: true, force: true });
        mkdirSync(profile, { recursive: true });
        writeFileSync(join(profile, "settings.json"), JSON.stringify(seeded, null, 2));
      },
    });
    delete process.env.GIT_TRACE2;
    await wf("the sidebar add button", () => exists('aside.sidebar button[aria-label="Add project"]'), 60000);
    if (!opts.noProject) {
      await click('aside.sidebar button[aria-label="Add project"]');
      await wf("the add-by-path item", () => exists('button[data-add-by-path]'), 5000);
      await click('button[data-add-by-path]');
      await wf("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
      await focusField('input[aria-label="project folder"]');
      await cdp("insert", repo, "enter");
      await wf("the first pane (shell or session chooser)", async () => (await shown(TERM)) >= 1 || (await exists("section.pane.chooser .chooser-foot")), 30000);
      // A new project opens the session chooser: pick Terminal for every seat and start it.
      if (!(await shown(TERM))) {
        const picked = await evalJs(`(() => {
          let n = 0;
          for (const sel of document.querySelectorAll("section.pane.chooser select")) {
            const opt = [...sel.options].find((o) => o.text.trim() === "Terminal");
            if (!opt) continue;
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            n++;
          }
          return n;
        })()`);
        log(`session chooser: Terminal picked for ${picked} seat(s)`);
        await wf("the chooser's Start button", () => exists("section.pane.chooser .chooser-foot button.btn.primary:not(:disabled)"), 30000);
        await click("section.pane.chooser .chooser-foot button.btn.primary");
      }
      await wf("the first shell pane", async () => (await shown(TERM)) >= 1, 30000);
      await wf("its input field", () => exists(`${TERM} .xterm-helper-textarea`), 30000);
    }
    // The first-run guide is a modal dialog; close it so key chords reach the grid (opts.keepFirstRun: a proof that drives it).
    if (!opts.keepFirstRun) await dismissFirstRun(app, log);
  } catch (e) {
    const closed = await app.closeApp().catch((err) => [false, String(err?.message ?? err)]);
    log(`startPlain failed; closed the app it started: ${JSON.stringify(closed)}`);
    throw e;
  }
  const shotDir = LIVE_LOGS;
  mkdirSync(shotDir, { recursive: true });
  const ctx = {
    app, TEMP, repo, log,
    /** Lines of the n-th shown terminal pane's whole buffer (scrollback included), from its xterm instance. */
    lines: (index = 0, sel = TERM) =>
      evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null)[${index}]; if (!p) return null; for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const out = []; for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? ""); return { lines: out, baseY: b.baseY, viewportY: b.viewportY, rows: t.rows, cols: t.cols }; } } return null; })()`),
    async text(index = 0, sel = TERM) {
      const r = await ctx.lines(index, sel);
      return r ? r.lines.join("\n") : null;
    },
    /** Types a line into the n-th shown pane through the input pipeline (real key events), then Enter. */
    async typeInto(index, line, sel = TERM) {
      await focusPane(sel, index, ".xterm-helper-textarea");
      await cdp("insert", line, "enter");
    },
    /** Rects of every shown pane section, in DOM order. */
    rects: (sel = TERM) =>
      evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null).map(e => { const b = e.getBoundingClientRect(); return { key: e.getAttribute("aria-label"), x: b.x, y: b.y, w: b.width, h: b.height }; })`),
    /** A CDP page screenshot (PNG) written to LIVE_LOGS/<name>.png. */
    async shot(name) {
      const targets = await (await fetch(`http://127.0.0.1:${CDPP}/json`)).json();
      const t = targets.find((x) => x.type === "page" && PAGE.test(x.url));
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      const data = await new Promise((resolve) => {
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result?.data ?? null); };
        ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
      });
      ws.close();
      const file = `${shotDir}/${name}.png`;
      if (data) writeFileSync(file, Buffer.from(data, "base64"));
      return data ? file : null;
    },
    /** One key press with an explicit key, code and virtual-key code (cdp.mjs knows only a few names, e.g. not F7). mods: Alt 1, Ctrl 2, Shift 8. */
    async rawKey({ key, code, vk, mods = 0, text }) {
      const targets = await (await fetch(`http://127.0.0.1:${CDPP}/json`)).json();
      const t = targets.find((x) => x.type === "page" && PAGE.test(x.url));
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
      // text makes it a character key press (Space, Enter on a button), not a bare raw key.
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, ...(text ? { text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      ws.close();
    },
    /** Real agent programs (claude/codex/grok) anywhere under the app now; a stand-in runs as cmd.exe, never these. */
    realAgents: async () => (await app.treeOf(app.pid)).filter((p) => /^(claude|codex|grok)(\.exe)?$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`),
    /** Pids of the shells (powershell/pwsh) under the app: a session restarted or started shows as a changed pid set. */
    shellPids: async () => (await app.treeOf(app.pid)).filter((p) => /^(powershell|pwsh).exe$/i.test(p.name)).map((p) => p.pid).sort((x, y) => x - y),
    /** The word a run's own evidence line gets: NOT-TESTED when the IPC guard went blind during it. */
    verdict: (ok) => runWord(ok, app.guard.blind),
    stop: () => guardedStop(app, log),
  };
  return ctx;
}

/** Runs body(ctx); always stops the app; prints and returns the exit code (0 = every assertion held and the guard
 *  never blind). A run whose IPC guard went blind writes NOT-TESTED, not PASS. */
export async function finish(ctx, name, lines, ok) {
  const closed = await ctx.stop().catch((e) => [false, String(e.message)]);
  const rep = guardReport({ lines, ok, guard: ctx.app?.guard, close: closed });
  lines.splice(0, lines.length, ...rep.lines); // callers that write their own evidence after this get the regraded rows
  writeFileSync(`${LIVE_LOGS}/${name}.out.txt`, `${rep.text}\n`);
  console.log(rep.text);
  return rep.code;
}
