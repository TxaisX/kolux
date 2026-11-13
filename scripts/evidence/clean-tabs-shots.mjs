// PR #255 (one session per cell, folders-only sidebar): screenshots of the window drawn in a browser, not the app
// window. Vite serves a worktree's front end and Playwright's Chromium loads it at device scale 2, with the Tauri IPC
// answered by a stand-in (below): the settings hold a saved layout, the projects are three made-up folders, and every
// terminal command answers like a terminal that printed nothing yet. No Rust side runs, so the terminals stay empty and
// no agent runs; what the shots show is the grid, the pane headers and the sidebar as the React code draws them.
//   node scripts/evidence/clean-tabs-shots.mjs                  this worktree -> evidence/clean-tabs-*.png
//   node scripts/evidence/clean-tabs-shots.mjs --before <dir>   a checkout of the base branch, read only (Vite's cache
//                                                               goes to a scratch folder) -> evidence/clean-tabs-before-*.png
// Each run also writes evidence/clean-tabs-shots[-before].txt: what each scene drew (cells, tab strips, header text,
// sidebar rows) and which IPC calls it answered.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Playwright is not a dependency of the app: it is the one installed on the machine (found through NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");

const HERE = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const at = process.argv.indexOf("--before");
const BEFORE = at > 0 ? resolve(process.argv[at + 1]) : null;
const ROOT = BEFORE ?? HERE;
const OUT = join(HERE, "evidence");
const TAG = BEFORE ? "clean-tabs-before" : "clean-tabs";
mkdirSync(OUT, { recursive: true });

const W = "C:\\w";
const KOLUX = `${W}\\kolux`;
const DOCS = `${W}\\docs-site`;
const API = `${W}\\api-server`;
const shell = (key, cwd, extra = {}) => ({ key, cwd, branch: "main", agent: "shell", program: null, args: [], ...extra });

/** A layout as Kolux wrote it before this change: four cells, two of them with several tabs (`group`, `activeTab`).
 *  The first cell holds a pinned blue "dev server", a "claude" shell and README.md (README in front); the last holds
 *  "logs" and "server". The base branch draws it as four cells with two tab strips; this PR as seven cells. */
const OLD = {
  panes: [
    shell(1, KOLUX, { title: "dev server", pinned: true, color: "blue" }),
    shell(5, KOLUX, { title: "claude", group: 1 }),
    shell(3, KOLUX, { group: 1, kind: "editor", path: `${KOLUX}\\README.md`, title: "README.md" }),
    shell(2, KOLUX, { title: "tests", color: "green" }),
    shell(4, KOLUX, { title: "build" }),
    shell(6, KOLUX, { title: "logs" }),
    shell(7, KOLUX, { title: "server", group: 6, color: "purple" }),
    shell(8, DOCS, { title: "preview" }),
  ],
  activeTab: { 1: 3, 6: 7 },
  focused: 3,
  activeDir: KOLUX,
  stacked: {},
};

/** The scenes: the saved layout each one starts from, and what to shoot. */
const SCENES = [
  // One cell: a workspace with a single terminal.
  { name: "1-cell", layout: { panes: [shell(1, KOLUX, { title: "dev server" }), shell(8, DOCS, { title: "preview" })], focused: 1, activeDir: KOLUX, stacked: {} }, shots: [["1-cell", "window"]] },
  // Four cells, one session each: a pinned blue terminal, a green one, a file and a plain terminal.
  {
    name: "4-cell",
    layout: {
      panes: [shell(1, KOLUX, { title: "dev server", pinned: true, color: "blue" }), shell(2, KOLUX, { title: "tests", color: "green" }), shell(3, KOLUX, { kind: "editor", path: `${KOLUX}\\README.md`, title: "README.md" }), shell(4, KOLUX, { title: "build" }), shell(8, DOCS, { title: "preview" })],
      focused: 1,
      activeDir: KOLUX,
      stacked: {},
    },
    shots: BEFORE ? [] : [["4-cell", "window"]],
    drive: !BEFORE,
  },
  // The layout saved in the old form, and the sidebar beside it.
  { name: "old-layout", layout: OLD, shots: BEFORE ? [["4-cell", "window"], ["sidebar", "aside.sidebar"]] : [["old-layout", "window"], ["sidebar", "aside.sidebar"]] },
];

const PROJECTS = [
  { id: "p1", name: "kolux", path: KOLUX },
  { id: "p2", name: "docs-site", path: DOCS },
  { id: "p3", name: "api-server", path: API },
];

/** The stand-in for window.__TAURI_INTERNALS__, run in the page before its own scripts. */
function stub({ settings, projects }) {
  const calls = {};
  window.__ipcCalls = calls;
  const cbs = new Map();
  let next = 1;
  let term = 100;
  const tree = (p) => [{ path: p, branch: "main", head: "a1b2c3d", isMain: true, hidden: false, number: null, comment: "" }];
  const answers = {
    get_settings: () => settings,
    save_settings: () => null,
    path_kind: () => "dir",
    project_list: () => projects,
    workspace_scan: (a) => ({ list: tree(projects.find((p) => p.id === a.projectId)?.path ?? ""), unseen: [] }),
    workspace_list: (a) => tree(projects.find((p) => p.id === a.projectId)?.path ?? ""),
    workspaces_place_get: () => ({ dir: "", flat: false, used: [], fromEnv: false }),
    scm_pushed: (a) => (a.paths ?? []).map((path) => ({ path, state: "synced", count: 0 })),
    setup_suggestion: () => ({ kind: "none" }),
    groups_get: () => ({ groups: [], members: {} }),
    activity_get: () => ({}),
    project_icons_list: () => ({}),
    skills_scan: () => ({ skills: [] }),
    terminal_service_info: () => ({ protocol: 99, generation: 1 }),
    terminal_attach: () => ({ state: "fresh", id: null }),
    terminal_spawn: () => ({ id: ++term, program: null, account: null }),
    terminal_history: () => "",
    terminal_busy: (a) => (a.ids ?? []).map(() => false),
    file_read: () => "# kolux\n\nA Windows-first desktop app for running many AI coding agents side by side.\n",
    file_stamps: (a) => (a.paths ?? []).map(() => 1),
    // Empty answers in each command's own shape, so the window shows no error banner that has nothing to do with the shots.
    keybindings_read: () => ({ path: "C:\\Users\\me\\keybindings.json", value: {}, created: false, error: null }),
    agent_list: () => [
      { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\Users\\me\\bin\\claude.exe" },
      { id: "codex", name: "Codex", program: "codex", args: [], installed: true, path: "C:\\Users\\me\\bin\\codex.exe" },
    ],
    git_version: () => "git version 2.47.0.windows.1",
    dir_list: () => [],
    tools_check: () => ({ git: "ok", gh: "ok", ghSignedIn: "ok", glab: "missing", githubProjects: [], gitlabProjects: [], dismissed: {} }),
    claude_accounts: () => ({ accounts: [], active: null, signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude: false }),
    codex_accounts: () => ({ accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null }),
    claude_usage: () => [],
    "plugin:event|listen": () => next++,
    "plugin:event|unlisten": () => null,
    "plugin:event|emit": () => null,
  };
  const QUIET = /^(window_background|keybindings_write|terminal_(forget_history|prune_history|layout|output_subscribe|resize|write|kill|reap)|badge_set|menu_sync|edit_menu_ready|startup_report|settings_patch|save_settings|keep_awake_set)$/;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: {},
    transformCallback: (cb) => {
      const id = next++;
      cbs.set(id, cb);
      return id;
    },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      calls[cmd] = (calls[cmd] ?? 0) + 1;
      const f = answers[cmd];
      if (f) return f(args);
      // A command that only does something (a write, a report, a window call) answers nothing; any other command
      // fails the way a missing back end would, so the caller takes its own fallback instead of a made-up answer.
      if (cmd.startsWith("plugin:") || QUIET.test(cmd)) return null;
      throw new Error(`${cmd}: not answered by the harness`);
    },
  };
}

/** Settings a person who has used Kolux for a while would have, on the New look in dark (scripts/evidence/README.md). */
const settingsFor = (layout) => ({
  savedLayout: layout,
  uiLook: "new",
  appearanceMode: "dark",
  onboardingDone: true,
  wizardDone: true,
  firstRunDone: true,
  toursSeen: true,
  lastScreen: "terminals",
});

/** Vite on `root`, its dependency cache in a scratch folder so a base checkout is only read. */
async function startVite(root) {
  const cacheDir = mkdtempSync(join(tmpdir(), "kolux-shots-vite-"));
  const server = await createServer({ root, cacheDir, configLoader: "runner", logLevel: "warn", server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("vite gave no local address");
  return { url, close: async () => (await server.close(), rmSync(cacheDir, { recursive: true, force: true })) };
}

/** Uses what the tab strip did, now in the pane headers, the way a person would (mouse and keyboard), and reports what
 *  the page did. */
async function driveHeaders(page) {
  const out = {};
  const head = (title) => page.locator(".grid > .cell:not([hidden]) section.pane:not([hidden]) .pane-head").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
  const titles = () => page.$$eval(".grid > .cell:not([hidden]) section.pane:not([hidden]) .pane-head .title", (els) => els.map((e) => e.textContent.trim()));
  const menuRows = () => page.$$eval('[role="menu"] [role^="menuitem"]', (els) => els.map((e) => [e.textContent.replace(/\s+/g, " ").trim(), e.getAttribute("role"), e.getAttribute("aria-checked")]));
  const menuName = () => page.$eval('[role="menu"]', (m) => m.getAttribute("aria-label")).catch(() => null);
  const marks = (title) => head(title).locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter((l) => /^Tab Color|^Pinned|^unread/.test(l)));
  // A terminal's header: right-click opens its Pane menu, which carries the tab's items now.
  await head("dev server").locator(".title").click({ button: "right" });
  await page.waitForSelector('[role="menu"]');
  out.terminalMenu = { name: await menuName(), rows: (await menuRows()).map((r) => r[0]) };
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="menu"]', { state: "detached" });
  // A file's header has no Pane menu: Shift+F10 on a button in it opens the tab menu there, from the keyboard alone.
  await head("README.md").getByRole("button", { name: "Copy the full path" }).focus();
  await page.keyboard.press("Shift+F10");
  await page.waitForSelector('[role="menu"]', { timeout: 10_000 });
  out.fileMenuFromKeyboard = { name: await menuName(), rows: await menuRows() };
  // Arrow down to "Pin tab" and press Enter: the pin shows in that header.
  await page.keyboard.press("ArrowDown");
  out.focusedRow = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
  await page.getByRole("menuitem", { name: /^Pin tab/ }).click();
  out.readmeMarksAfterPin = await marks("README.md");
  // Tab Color from the same menu by the mouse: the dot shows, and the menu says which colour is ticked next time.
  await head("README.md").locator(".title").click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Orange" }).click();
  out.readmeMarksAfterColor = await marks("README.md");
  await head("README.md").locator(".title").click({ button: "right" });
  out.tickedColor = (await menuRows()).filter((r) => r[2] === "true").map((r) => r[0]);
  await page.keyboard.press("Escape");
  // Double-click a terminal's title: its name field opens in the header.
  await head("build").locator(".title").dblclick();
  out.renameField = await page.evaluate(() => {
    const f = document.activeElement;
    return f && f.tagName === "INPUT" ? { label: f.getAttribute("aria-label"), value: f.value } : null;
  });
  if (out.renameField) {
    await page.keyboard.press("Control+A");
    await page.keyboard.type("build watch");
    await page.keyboard.press("Enter");
  }
  out.afterRename = await titles();
  // Drag by the header grip onto the centre of another cell: the two swap.
  const before = await titles();
  const target = page.locator(".grid > .cell:not([hidden])").nth(0);
  await head("tests").locator(".pane-grip").dragTo(target, { targetPosition: { x: 200, y: 200 } });
  await page.waitForTimeout(300);
  out.drag = { before, after: await titles() };
  // Middle-click a header: an unpinned pane closes, a pinned one stays.
  await head("dev server").locator(".title").click({ button: "middle" });
  await page.waitForTimeout(300);
  out.afterMiddleOnPinned = await titles();
  await head("tests").locator(".title").click({ button: "middle" });
  await page.waitForTimeout(500);
  out.afterMiddleOnUnpinned = await titles();
  return out;
}

async function scene(browser, url, { name, layout, shots, drive }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env.SHOTS_DEBUG) page.on("pageerror", (e) => console.error(e.stack));
  await page.addInitScript(stub, { settings: settingsFor(layout), projects: PROJECTS });
  await page.goto(url);
  await page.waitForSelector(".grid > .cell:not([hidden]) section.pane:not([hidden]) .pane-head", { timeout: 90_000 }).catch(async (e) => {
    const path = join(tmpdir(), `${TAG}-${name}-failed.png`);
    await page.screenshot({ path }).catch(() => {});
    console.error(JSON.stringify(await page.evaluate(() => window.__ipcCalls).catch(() => null)));
    throw new Error(`${name}: no pane header drawn (${errors.join(" | ") || "no page error"}); the page is in ${path}`, { cause: e });
  });
  await page.waitForTimeout(3000); // the sidebar's scans and the panes' first draw settle
  await page.mouse.move(1, 1); // no hover on a header
  const facts = await page.evaluate(() => ({
    cells: document.querySelectorAll(".grid > .cell:not([hidden])").length,
    strips: [...document.querySelectorAll('.grid > .cell:not([hidden]) [role="tablist"]')].map((t) => t.textContent.replace(/\s+/g, " ").trim()),
    heads: [...document.querySelectorAll(".grid > .cell:not([hidden]) .pane-head")].filter((h) => h.offsetParent).map((h) => ({
      text: h.querySelector(".title")?.textContent?.trim() ?? "",
      marks: [...h.querySelectorAll("[aria-label]")].map((m) => m.getAttribute("aria-label")).filter((l) => /^Tab Color|^Pinned|^Drag/.test(l)),
    })),
    folderRows: document.querySelectorAll('[data-testid="sidebar-folder"]').length,
    sessionRows: [...document.querySelectorAll('[data-testid="sidebar-session"], aside.sidebar [data-session]')].map((r) => r.textContent.trim()),
    calls: Object.keys(window.__ipcCalls ?? {}).sort(),
  }));
  for (const [file, how] of shots) {
    const path = join(OUT, `${TAG}-${file}.png`);
    if (how === "window") await page.screenshot({ path });
    else await page.locator(how).first().screenshot({ path });
    console.log(`wrote ${path}`);
  }
  // The interactions run on a fresh page of their own, so the shot above shows the scene as it opened.
  let drove;
  if (drive) {
    const p2 = await ctx.newPage();
    p2.on("pageerror", (e) => errors.push(String(e)));
    await p2.addInitScript(stub, { settings: settingsFor(layout), projects: PROJECTS });
    await p2.goto(url);
    await p2.waitForSelector(".grid > .cell:not([hidden]) section.pane:not([hidden]) .pane-head", { timeout: 90_000 });
    await p2.waitForTimeout(3000);
    drove = await driveHeaders(p2).catch((e) => ({ failed: String(e).split("\n")[0] }));
  }
  await ctx.close();
  return { scene: name, ...facts, drove, errors };
}

const vite = await startVite(ROOT);
const browser = await chromium.launch();
const report = [];
try {
  for (const s of SCENES) report.push(await scene(browser, vite.url, s));
} finally {
  await browser.close();
  await vite.close();
}
const lines = report.map((r) => JSON.stringify(r));
lines.forEach((l) => console.log(l));
writeFileSync(join(OUT, `${TAG}-shots.txt`), `# ${TAG}: browser harness (scripts/evidence/clean-tabs-shots.mjs), Vite + Playwright Chromium, IPC stubbed; not the app window\n${lines.join("\n")}\n`);
