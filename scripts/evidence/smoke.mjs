// Smoke run (T-542, T-542-b): five end-to-end flows through the dev app's own WebView2 debugging port, built
// on scripts/evidence/cdp.mjs (run as a child process: it is a command-line tool, not a library). Prints one
// PASS or FAIL line per flow, writes evidence/smoke-<short sha>.txt, and exits 1 when a required flow failed,
// so a merge or a structural move of App.tsx and lib.rs is checked by behaviour, not by screenshots.
//
//   pnpm smoke                       launch the app from this checkout with its own profile, run, close, clean up
//   pnpm smoke -- --attach           drive an app that is already running with --remote-debugging-port=<cdp>
//   options: --port 1431 (vite) · --cdp 9240 · --identifier com.txaisxiong.kolux-rs.smoke · --temp <folder>
//            --only 1,3 · --keep (leave the app and the temp folder for a look) · --timeout <minutes for the first build>
//            --offscreen (T-560: the app's window is moved far off-screen once it shows; CDP works as usual;
//                         not with --keep)
//            --self-test (T-560: check the temp-folder cleanup and the off-screen move, launching nothing)
//            --require-quit (count flow 5 in the exit code before T-184 is ticked)
//
// Flow 1  a grid grows from 4 to 6 panes and the PTYs already running keep running: each shell gets a marker
//         in an environment variable before the change and writes that variable to a file after it (only the
//         same process can know it).
// Flow 2  Mod+S in an editor tab writes the file: the bytes on disk carry what was typed.
// Flow 3  Discard in Source Control asks first, and Cancel loses nothing: the file and git status are unchanged.
// Flow 4  a Claude pane's status dot turns Working: agentOptions.claude.command points at a stand-in program
//         that posts the same hook events Kolux's installed hook posts (SessionStart, UserPromptSubmit) from the
//         pane's own hook variables. CLAUDE_CONFIG_DIR, CODEX_HOME, USERPROFILE and HOME (with APPDATA and
//         LOCALAPPDATA below it) point at scratch folders under --temp for the launched app, so the user's real
//         Claude and Codex configuration and Kolux's real hook folder are never touched. FAILs when the app did
//         not install its hook into the scratch Claude settings.json, or the hook script that entry names is
//         missing on disk or not under the scratch home.
// Flow 5  quit and come back (council C2, T-542-b): with two or more shells, the Claude stand-in and one
//         non-default setting live, the app pid's descendant tree is captured (Win32_Process ParentProcessId
//         walk), the window is closed through the app's own path (window close over CDP, the same as the X
//         button; never taskkill) and every process from that tree still alive afterwards is a survivor: FAIL
//         on any. The same profile is relaunched (the built kolux-rs.exe from this checkout, vite restarted by
//         this script when tauri dev took it down): Kolux's settings.json must be byte-identical to its
//         pre-quit bytes before anything is touched, the setting must hold, and every restored shell must echo
//         a marker. Then a saved layout of 12 shell panes is written and the app is relaunched 10 times; 15 s
//         after each launch the descendant shells with ThreadCount <= 1 are counted as stalled: FAIL above 0.
//         Report-only until T-184 (Job Object kill-on-close) is on the checkout this runs from, detected by
//         the line `- [x] T-184 ` in its PLAN.md: the result is printed and written to evidence but does not
//         change the exit code. Once T-184 is ticked, flow 5 is required like the others. The final close of
//         the app is checked the same way (pre-close tree, survivors), and reported on the "close" line.
//         T-552: every relaunch waits until the old tree has exited (survivors are killed first and counted).
//         Then one stress relaunch starts the moment the app process is gone, while its WebView2 processes
//         may still hold the profile folder: the page must come up, and the app's output after that point
//         must not mention a webview failure, a panic or "still closing": FAIL otherwise.
//
// Launch mode wipes and reuses the profile of --identifier (refused unless it ends in ".smoke"), seeds
// confirmCloseRunning=false so the close at the end is silent and agentStatusHooks=true so the hook install
// of flow 4 is on whether or not the switch exists yet (T-152-gate), and moves the window to the second screen
// when there is one. Attach mode changes the running app's settings for flow 4 and puts them back afterwards;
// it cannot run flow 5 (it has no exe path to relaunch).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, moveScript } from "./app-launch.mjs";
// The launching shell may be a pane of another Kolux build (the old app sets KOLUX_USER_DATA_PATH, hook port/token and pane ids);
// none of it may reach the app under test, its panes or the CLI it runs.
for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_")) delete process.env[k];

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
const cdpScript = join(root, "scripts", "evidence", "cdp.mjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const PORT = opt("port", "1431");
const CDP = opt("cdp", "9240");
const IDENTIFIER = opt("identifier", "com.txaisxiong.kolux-rs.smoke");
const TEMP = opt("temp", "G:\\Temp\\kolux-rs-smoke");
const ATTACH = flag("attach");
const KEEP = flag("keep");
const OFFSCREEN = flag("offscreen");
// Council FIX-1 (AFTER 3): a kept app moved off-screen could not be reached again, so the two never go together.
if (OFFSCREEN && KEEP) {
  console.error("smoke: --offscreen and --keep cannot be used together (the kept app would be unreachable off-screen)");
  process.exit(2);
}
// Council FIX-1 (FIX-SOON 3): the temp folder is removed only when it carries this file, which setup()
// writes, so a mistyped --temp never deletes a folder this script did not make.
const TEMP_MARKER = ".kolux-rs-smoke-temp";
// FIX-2 (council re-review AFTER 2): the marker names the smoke run that made the folder, so a second run
// never deletes a folder a live run is using.
const markerText = (pid) => `made by scripts/evidence/smoke.mjs setup(); pid ${pid}; removed with this folder\n`;
const ONLY = opt("only", ATTACH ? "1,2,3,4" : "1,2,3,4,5")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n >= 1 && n <= 5);
const BUILD_MINUTES = Number(opt("timeout", "20"));
// T-184 detection: the task line ticked in this checkout's PLAN.md (the merge gate runs smoke on the checkout
// that carries the merge, so "on main" and "ticked here" are the same thing there).
const T184_ON = /^- \[x\] T-184 /m.test(existsSync(join(root, "PLAN.md")) ? readFileSync(join(root, "PLAN.md"), "utf8") : "");
const QUIT_REQUIRED = T184_ON || flag("require-quit");
const required = (n) => n !== 5 || QUIT_REQUIRED;

const repo = join(TEMP, "repo");
const marks = join(TEMP, "marks");
const standin = join(TEMP, "standin");
const log = (...x) => console.log(...x);
// Row 855: whole-machine CPU busy % between two os.cpus() snapshots (mean over the window); spawns nothing.
const cpuSnap = () => cpus().map((c) => c.times);
const cpuBusyPct = (a, b) => {
  let total = 0;
  let idle = 0;
  a.forEach((t0, i) => {
    const t1 = b[i];
    for (const k of Object.keys(t1)) total += t1[k] - t0[k];
    idle += t1.idle - t0.idle;
  });
  return total > 0 ? Math.round((100 * (total - idle)) / total) : 0;
};
// The launcher, scratch homes and process helpers are shared with scripts/stress (app-launch.mjs).
const app = createApp({ root, port: PORT, cdp: CDP, identifier: IDENTIFIER, temp: TEMP, suffix: ".smoke", offscreen: OFFSCREEN, attach: ATTACH, keep: KEEP, buildMinutes: BUILD_MINUTES, log });
const { run, ps, sleep, waitFor, cdp, evalJs, invoke, count, exists, shown, click, clickWhere, focusField, focusPane, treeOf, closeAndCount, byName, killAll, treeGone, alive } = app;
const { profile, claudeConfig, userHome } = app.paths;
const koluxSettings = join(profile, "settings.json");
// A plain text file: the Explorer opens it in the CodeMirror editor, whose save writes the text as typed.
const smokeFile = join(repo, "notes.txt");
const ORIGINAL = "original line\n";
// Flow 5's non-default setting: the needs strip is on by default (settings/general.ts stripOn).
const SETTING = "needsStrip";
const SHELL_NAMES = new Set(["powershell.exe", "pwsh.exe", "cmd.exe"]);

const git = (a) => run("git", a, { cwd: repo });

const TERM = "section.pane[data-agent]";
// Shell panes only: data-agent is the agent name, so a Claude pane matches TERM but not SHELL.
const SHELL = 'section.pane[data-agent="shell"]';
const CHOOSER = "section.pane.chooser";
const CLAUDE = 'section.pane[data-agent*="claude"]';
// The right sidebar's tab by name; the panel button opens the sidebar when it is closed.
const rightTab = async (name) => {
  if (!(await exists('aside.rside [role="tab"]'))) await click("button.ib.panel");
  await waitFor("the right sidebar", () => exists('aside.rside [role="tab"]'), 5000);
  await clickWhere('aside.rside [role="tab"]', `/^\\s*${name}\\s*$/`);
};
const LAYOUT_ON = '.layouts button[aria-pressed="true"]';
const layoutCount = () => evalJs(`document.querySelector(${JSON.stringify(LAYOUT_ON)})?.textContent.trim() ?? null`);
const pickLayout = (n) => clickWhere(".layouts button", `/^\\s*${n}\\s*$/`);
const newTab = async (label) => {
  await click("button.newtab");
  await waitFor("the New tab menu", () => exists('[role="menu"][aria-label="New tab"]'), 5000);
  await clickWhere('[role="menu"][aria-label="New tab"] [role="menuitem"]', label);
};
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);
const bytes = (file) => (existsSync(file) ? readFileSync(file) : null);
const slash = (p) => p.replace(/\\/g, "/");
// A file that nothing has written to for two seconds (the layout save follows every pane change).
async function settled(file, quiet = 2000, ms = 20000) {
  let last = bytes(file);
  let since = Date.now();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(250);
    const now = bytes(file);
    if (now === null ? last !== null : last === null || Buffer.compare(now, last) !== 0) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quiet) break;
  }
  return last;
}

// launch/relaunch/close, the process tree and the orphan scan live in app-launch.mjs (shared with scripts/stress).
const launch = () =>
  app.launch({
    prepare: () => {
      rmSync(profile, { recursive: true, force: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(koluxSettings, JSON.stringify({ confirmCloseRunning: false, agentStatusHooks: true }, null, 2));
    },
  });
const relaunch = () => app.relaunch();
async function closeApp() {
  closeReport = await app.closeApp();
}
let closeReport = null; // the final close's line

// ---------- setup: a throwaway repo as a project, its main checkout open with one shell ----------
async function setup() {
  const held = await removeTemp(TEMP, null);
  const why = { NOMARKER: ": it holds files but no marker from a smoke setup; pick another --temp or delete it by hand", INUSE: ": another smoke run that is still running made it; pass another --temp" };
  if (held) throw new Error(`the temp folder ${TEMP} could not be cleared (${held}${why[held] ?? ""})`);
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(join(TEMP, TEMP_MARKER), markerText(process.pid));
  mkdirSync(repo, { recursive: true });
  mkdirSync(marks, { recursive: true });
  writeFileSync(smokeFile, ORIGINAL);
  await git(["init", "-q", "-b", "main"]);
  await git(["-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "add", "."]);
  await git(["-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "commit", "-q", "-m", "smoke"]);
  if (!ATTACH) await launch();
  else await pageUp(30000);
  // T-543-b: with no layout saved the window opens with no pane until a workspace is opened.
  await waitFor("the sidebar", () => exists('.sb-foot button[title^="Add a project by path"]'), 30000);
  const before = await count(TERM);
  log(`zero panes after launch: ${before === 0 ? "PASS" : "FAIL"} (${before} ${TERM})`);
  if (!ATTACH && before !== 0) throw new Error(`a fresh profile opened with ${before} pane(s); T-543-b wants none until a workspace is opened`);
  if (await exists('.onboarding, [aria-label="Welcome"]')) log("WARN a first-run dialog is open; the flows may not reach the grid");
  await click('.sb-foot button[title^="Add a project by path"]');
  await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
  await focusField('input[aria-label="project folder"]');
  await cdp("insert", repo, "enter");
  // T-569/T-577: a new workspace opens the launch chooser, not a shell; pick Terminal and Start, the way a user would.
  await waitFor("the launch chooser", async () => (await shown(CHOOSER)) >= 1, 30000);
  await startTerminalFromChooser();
  await waitFor("the first shell pane", async () => (await shown(TERM)) >= 1, 30000);
  await waitFor("the first shell pane's input field", () => exists(`${TERM} .xterm-helper-textarea`), 30000);
  log(`setup: ${repo} added as a project; ${await shown(TERM)} shell pane shown`);
}

// The first chooser's seat 1 gets "Terminal" (React's select listens for change, so the value goes through
// the native setter), then its Start button, once the agent search has finished and enabled it.
async function startTerminalFromChooser() {
  const seat = `${CHOOSER} select[aria-label="Seat 1: which AI"]`;
  await waitFor("the chooser's Terminal choice", () => exists(`${seat} option[value="terminal"]`), 30000);
  const r = await evalJs(`(() => { const s = document.querySelector(${JSON.stringify(seat)}); if (!s) return "missing"; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "terminal"); s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
  if (r !== "terminal") throw new Error(`could not pick Terminal in the chooser: ${r}`);
  const start = `${CHOOSER} button.btn.primary`;
  await waitFor("the chooser's Start button", () => evalJs(`[...document.querySelectorAll(${JSON.stringify(start)})].some(b => !b.disabled && /^\\s*Start\\s*$/.test(b.textContent))`), 60000);
  await clickWhere(start, "/^\\s*Start\\s*$/");
}

// Types a line into the n-th shown shell and waits for the file it writes; a shell still starting up may
// swallow the first keystrokes, so the line is sent again until the file is there.
async function shellWrites(index, line, file, what, tries = 3) {
  for (let t = 1; ; t++) {
    await focusPane(SHELL, index, ".xterm-helper-textarea");
    await cdp("insert", line, "enter");
    try {
      return await waitFor(what, () => read(file), 15000, 500);
    } catch (e) {
      if (t >= tries) throw e;
    }
  }
}

// ---------- flow 1 ----------
async function flow1() {
  const start = await shown(TERM);
  for (const want of [start + 1, start + 2]) {
    // A shown pane takes the focus first, so the split goes to a pane a user sees.
    await focusPane(TERM, 0, ".xterm-helper-textarea");
    await click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} shell panes`, async () => (await shown(TERM)) === want, 30000);
  }
  await pickLayout(4);
  await waitFor("Layout 4", async () => (await layoutCount()) === "4", 5000);
  const grid = async () => ({ cells: Number(await layoutCount()), shells: await shown(TERM), choosers: await shown(CHOOSER) });
  const before = await grid();
  if (before.shells !== start + 2 || before.choosers !== 4 - before.shells) throw new Error(`expected ${start + 2} shells and ${4 - start - 2} empty pane(s) at Layout 4, got ${JSON.stringify(before)}`);
  const stamp = Date.now().toString(36);
  const markOf = (i) => `smoke-${stamp}-${i}`;
  for (let i = 0; i < before.shells; i++) {
    await focusPane(TERM, i, ".xterm-helper-textarea");
    await cdp("insert", `$env:SMOKE_MARK = '${markOf(i)}'; 'ready' | Set-Content '${slash(join(marks, `ready-${i}.txt`))}'`, "enter");
    await waitFor(`shell ${i + 1} to answer`, () => read(join(marks, `ready-${i}.txt`))?.includes("ready"), 45000, 500);
  }
  await pickLayout(6);
  await waitFor("Layout 6", async () => (await layoutCount()) === "6", 5000);
  const after = await grid();
  if (after.shells !== before.shells || after.choosers !== 6 - after.shells) throw new Error(`after Layout 6 expected the ${before.shells} shells plus ${6 - before.shells} empty panes, got ${JSON.stringify(after)}`);
  for (let i = 0; i < after.shells; i++) {
    await focusPane(TERM, i, ".xterm-helper-textarea");
    await cdp("insert", `$env:SMOKE_MARK | Set-Content '${slash(join(marks, `after-${i}.txt`))}'`, "enter");
  }
  const wanted = new Set(Array.from({ length: before.shells }, (_, i) => markOf(i)));
  await waitFor(
    "every shell to echo its marker",
    () => {
      const got = Array.from({ length: after.shells }, (_, i) => read(join(marks, `after-${i}.txt`))?.trim()).filter(Boolean);
      return got.length === wanted.size && got.every((m) => wanted.has(m)) && new Set(got).size === wanted.size;
    },
    45000,
    500,
  );
  return `grid 4 -> 6 (${before.shells} shells + ${before.choosers} empty -> ${after.shells} shells + ${after.choosers} empty); all ${after.shells} shells echoed the marker set before the change (same PTY processes)`;
}

// ---------- flow 2 ----------
const TYPED = "typed by smoke ";
async function flow2() {
  // The file was committed before the project was added, so the Explorer lists it (the tree is read once per open).
  await rightTab("Explorer");
  await waitFor("notes.txt in the Explorer", () => exists('[role="tree"] .ex-row[role="treeitem"]'), 10000);
  await clickWhere('[role="tree"] .ex-row[role="treeitem"]', "/^\\s*notes\\.txt\\s*$/");
  const editor = 'section.pane.editor[aria-label="notes.txt pane"]';
  await waitFor("the editor tab", () => shown(`${editor} .cm-content`), 10000);
  await focusPane(editor, 0, ".cm-content");
  const text = `${TYPED}${Date.now()}`;
  await cdp("insert", text);
  await waitFor("the editor to hold the text", () => evalJs(`[...document.querySelectorAll(${JSON.stringify(editor + " .cm-content")})].some(e => e.textContent.includes(${JSON.stringify(text)}))`), 5000);
  const before = read(smokeFile);
  if (before !== ORIGINAL) throw new Error("notes.txt changed on disk before Mod+S");
  await cdp("key", "s", "2"); // Ctrl+S (Mod+S on Windows)
  await waitFor("the bytes on disk", () => (read(smokeFile) ?? "").includes(text), 10000, 200);
  const now = read(smokeFile);
  if (!now.includes("original line")) throw new Error("the save lost the original line");
  return `Mod+S wrote notes.txt: disk now holds "${text}" plus the original line (${Buffer.byteLength(now)} bytes)`;
}

// ---------- flow 3 ----------
async function flow3() {
  const before = read(smokeFile);
  if (before === ORIGINAL) {
    // Flow 2 did not run or did not change the file: make a change by hand so Discard has something to ask about.
    writeFileSync(smokeFile, ORIGINAL + "changed by smoke\n");
  }
  const changed = read(smokeFile);
  const status = (await git(["status", "--porcelain"])).stdout.trim();
  if (!status.includes("notes.txt")) throw new Error(`git does not see notes.txt as changed: "${status}"`);
  await rightTab("Source Control");
  // The panel re-reads git status every 4 s.
  await waitFor("the Discard button for notes.txt", () => exists('button[aria-label="Discard notes.txt"]'), 15000, 500);
  await click('button[aria-label="Discard notes.txt"]');
  const ask = await waitFor("the discard prompt", () => evalJs(`(() => { const d = document.querySelector('[role="alertdialog"]'); if (!d) return null; return { title: d.getAttribute("aria-label"), body: d.querySelector(".ask-body")?.textContent ?? "", buttons: [...d.querySelectorAll(".btn-row button")].map(b => ({ text: b.textContent.trim(), cls: b.className })) }; })()`), 5000);
  if (ask.buttons.length < 2) throw new Error(`the prompt has no choice to cancel: ${JSON.stringify(ask)}`);
  if (read(smokeFile) !== changed) throw new Error("the file changed while the prompt was open");
  const cancel = ask.buttons.findIndex((b) => !/danger|primary/.test(b.cls));
  if (cancel < 0) throw new Error(`no cancel button in ${JSON.stringify(ask.buttons)}`);
  await evalJs(`document.querySelectorAll('[role="alertdialog"] .btn-row button')[${cancel}].click()`);
  await waitFor("the prompt to close", async () => !(await exists('[role="alertdialog"]')), 5000);
  await sleep(1000);
  if (read(smokeFile) !== changed) throw new Error("Cancel lost the change on disk");
  const statusAfter = (await git(["status", "--porcelain"])).stdout.trim();
  if (!statusAfter.includes("notes.txt")) throw new Error(`git no longer sees the change after Cancel: "${statusAfter}"`);
  return `Discard asked first ("${ask.title}", buttons ${ask.buttons.map((b) => b.text).join(" / ")}); after "${ask.buttons[cancel].text}" notes.txt and git status are unchanged`;
}

// ---------- flow 4 ----------
// The stand-in for Claude Code: the same guards, endpoint file read and curl post as Kolux's installed hook
// script (hooks.rs), fed the JSON Claude Code would pipe in; then it stays up like a session would.
function writeStandin() {
  mkdirSync(standin, { recursive: true });
  const event = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "smoke-standin", cwd: repo, ...extra });
  writeFileSync(join(standin, "session-start.json"), event("SessionStart", { source: "startup" }));
  writeFileSync(join(standin, "prompt.json"), event("UserPromptSubmit", { prompt: "smoke: turn the dot to Working" }));
  const post = (file) =>
    `type "%~dp0${file}" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;
  writeFileSync(
    join(standin, "claude.cmd"),
    [
      "@echo off",
      "echo Kolux smoke stand-in for Claude Code (T-542): posts the hook events a session would.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      post("session-start.json"),
      post("prompt.json"),
      "echo hook events posted; staying up",
      "ping -n 3600 127.0.0.1 >nul",
      "",
    ].join("\r\n"),
  );
  return join(standin, "claude.cmd");
}
// Points agentOptions.claude.command at the stand-in; the returned function puts the old value back.
async function standinOn() {
  const command = writeStandin();
  const old = await invoke("get_settings");
  const had = old && typeof old === "object" && "agentOptions" in old;
  const agentOptions = { ...(had ? old.agentOptions : {}), claude: { ...(had ? old.agentOptions?.claude ?? {} : {}), command } };
  await invoke("settings_patch", { set: { agentOptions }, remove: [] });
  return async () => {
    if (had) await invoke("settings_patch", { set: { agentOptions: old.agentOptions }, remove: [] }).catch(() => {});
    else await invoke("settings_patch", { set: {}, remove: ["agentOptions"] }).catch(() => {});
  };
}
const dotWorking = () =>
  waitFor(
    "the status dot to turn Working",
    async () => {
      const w = await evalJs(`[...document.querySelectorAll(${JSON.stringify(CLAUDE + " .st")})].map(e => e.getAttribute("aria-label"))`);
      return w.find((x) => x === "status: Working") ?? null;
    },
    30000,
    500,
  );
// The hook the app installed for the launched app's Claude: the scratch settings.json must name the hook
// script, and that script must be on disk. Attach mode has no scratch folder to look in.
function installedHook() {
  if (ATTACH) return "attach mode: the running app's own config folder, not checked";
  const settingsFile = join(claudeConfig, "settings.json");
  const text = read(settingsFile);
  if (text === null) throw new Error(`the installed hook file is missing: no ${settingsFile} (the app did not install its Claude hooks into the scratch config folder)`);
  const m = text.match(/([A-Za-z]:\/[^"\\]*agent-hooks\/claude\.cmd)/);
  if (!m) throw new Error(`the installed hook file ${settingsFile} names no agent-hooks/claude.cmd script`);
  if (!existsSync(m[1])) throw new Error(`the installed hook script ${m[1]} named by ${settingsFile} is missing on disk`);
  const norm = (s) => s.replace(/\\/g, "/").toLowerCase();
  if (!norm(m[1]).startsWith(norm(userHome) + "/")) throw new Error(`the installed hook script ${m[1]} is not under the scratch home ${userHome}`);
  return `hook installed into the scratch ${settingsFile}, script ${m[1]} on disk`;
}
async function flow4() {
  const restore = await standinOn();
  try {
    await newTab("/^\\s*Claude Code\\s*$/");
    await waitFor("a Claude pane", () => shown(CLAUDE), 15000);
    const word = await dotWorking();
    return `Claude pane's dot reads "${word}" after the stand-in posted SessionStart + UserPromptSubmit; ${installedHook()}`;
  } finally {
    await restore();
  }
}

// ---------- flow 5 ----------
async function flow5() {
  if (ATTACH) throw new Error("flow 5 needs launch mode (it quits and relaunches the app from its exe)");
  const parts = [];
  const fails = [];
  // Live state: two or more shells, the Claude stand-in (its command stays set so the relaunch starts the
  // stand-in, never the real claude), one non-default setting.
  // Split right makes a shell in a new cell from any terminal pane, even when a Claude tab hides the shell under it.
  while ((await shown(SHELL)) < 2) {
    const want = (await shown(SHELL)) + 1;
    await focusPane(TERM, 0, ".xterm-helper-textarea");
    await click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} shell panes`, async () => (await shown(SHELL)) >= want, 30000);
  }
  await standinOn();
  if (!(await shown(CLAUDE))) {
    await newTab("/^\\s*Claude Code\\s*$/");
    await waitFor("a Claude pane", () => shown(CLAUDE), 15000);
  }
  await dotWorking();
  await invoke("settings_patch", { set: { [SETTING]: false }, remove: [] });
  const shells = await shown(SHELL);
  const claudePanes = await count(CLAUDE);
  const before = await settled(koluxSettings);
  if (!before) throw new Error(`no ${koluxSettings} before the quit`);
  parts.push(`live: ${shells} shells, ${claudePanes} Claude stand-in pane, ${SETTING}=false; settings.json ${before.length} bytes`);
  // Quit: the tree first, then the app's own close, then the survivors.
  const first = await closeAndCount(app.pid);
  parts.push(`quit: ${first.how}; pre-close tree ${first.tree.length} (${byName(first.tree)}); survivors ${first.survivors.length} (${byName(first.survivors)})`);
  if (first.survivors.length > 0) fails.push(`${first.survivors.length} process(es) from the pre-close tree survived the quit: ${byName(first.survivors)}`);
  await killAll(first.survivors);
  await treeGone(first.tree);
  // Come back: bytes before anything is touched, the setting, the shells.
  await relaunch();
  const after = await settled(koluxSettings);
  const identical = after !== null && Buffer.compare(before, after) === 0;
  if (!identical) {
    let note = after === null ? "the file is gone" : `${before.length} -> ${after.length} bytes`;
    try {
      const a = JSON.parse(before.toString("utf8"));
      const b = JSON.parse(after.toString("utf8"));
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      note += `; keys that differ: ${keys.join(", ") || "none (whitespace or key order)"}`;
    } catch {
      /* not JSON on one side; the byte note stands */
    }
    fails.push(`settings.json is not byte-identical after the relaunch (${note})`);
  }
  const settings = await invoke("get_settings");
  const holds = settings && settings[SETTING] === false;
  if (!holds) fails.push(`${SETTING}=false did not hold across the relaunch (now ${JSON.stringify(settings?.[SETTING])})`);
  let restored = 0;
  try {
    restored = await waitFor(`${shells} restored shells`, async () => ((await shown(SHELL)) >= shells ? shown(SHELL) : null), 30000, 500);
  } catch {
    restored = await shown(SHELL);
  }
  const echoed = [];
  for (let i = 0; i < restored; i++) {
    const file = join(marks, `back-${i}.txt`);
    try {
      await shellWrites(i, `'back-${i}' | Set-Content '${slash(file)}'`, file, `restored shell ${i + 1} to echo`);
      if (read(file)?.includes(`back-${i}`)) echoed.push(i);
    } catch {
      /* counted below */
    }
  }
  if (restored !== shells || echoed.length !== shells) fails.push(`restore: ${restored} of ${shells} shells came back, ${echoed.length} echoed the marker`);
  const claudeBack = await count(CLAUDE);
  parts.push(`come back: settings.json ${identical ? "byte-identical" : "CHANGED"}; ${SETTING}=false ${holds ? "holds" : "LOST"}; ${restored}/${shells} shells restored, ${echoed.length} echoed a marker; ${claudeBack} Claude pane back`);
  // The storm: 12 saved shell panes, 10 relaunches, stalled shells (ThreadCount <= 1) 15 s after each launch.
  const second = await closeAndCount(app.pid);
  await killAll(second.survivors);
  await treeGone(second.tree);
  const cfg = JSON.parse(read(koluxSettings));
  const template = (cfg.savedLayout?.panes ?? []).find((p) => p.agent === "shell");
  if (!template) throw new Error(`the saved layout has no shell pane to copy: ${JSON.stringify(cfg.savedLayout).slice(0, 300)}`);
  cfg.savedLayout = { panes: Array.from({ length: 12 }, (_, i) => ({ ...template, key: i + 1, cwd: repo })), activeTab: {}, focused: 1, activeDir: repo, stacked: {} };
  writeFileSync(koluxSettings, JSON.stringify(cfg, null, 2));
  const seen = [];
  const stalled = [];
  const left = [second.survivors.length];
  for (let r = 1; r <= 10; r++) {
    const t0 = Date.now();
    await relaunch();
    await sleep(Math.max(0, 15000 - (Date.now() - t0)));
    const tree = await treeOf(app.pid);
    const sh = tree.filter((t) => SHELL_NAMES.has(t.name));
    seen.push(sh.length);
    stalled.push(sh.filter((t) => t.threads <= 1).length);
    const c = await closeAndCount(app.pid);
    left.push(c.survivors.length);
    await killAll(c.survivors);
    await treeGone(c.tree);
  }
  // T-552 stress: relaunch the moment the app process is gone (no settle, no survivor kill), while its
  // WebView2 tree may still hold the profile folder. The new app has to wait that out and come up.
  await relaunch();
  const appLog = join(TEMP, "app.log");
  const logAt = read(appLog)?.length ?? 0;
  const tq = Date.now();
  await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  await waitFor("the app to exit", async () => !(await alive(app.pid)), 30000, 100);
  const quitS = ((Date.now() - tq) / 1000).toFixed(1);
  const tr = Date.now();
  let upS = null;
  try {
    await relaunch();
    upS = ((Date.now() - tr) / 1000).toFixed(1);
  } catch (e) {
    fails.push(`stress: the immediate relaunch did not come up (${e.message})`);
  }
  const said = (read(appLog) ?? "").slice(logAt).match(/failed to create webview|panicked|still closing/i);
  if (said) fails.push(`stress: the immediate relaunch logged "${said[0]}"`);
  parts.push(`stress: relaunched at once after a quit (exited in ${quitS} s); page ${upS === null ? "NOT up" : `up in ${upS} s`}; ${said ? `log says "${said[0]}"` : "no webview failure in the log"}`);
  if (app.pid && (await alive(app.pid))) {
    const last = await closeAndCount(app.pid);
    await killAll(last.survivors);
    await treeGone(last.tree);
  }
  app.pid = null;
  const stalledTotal = stalled.reduce((a, b) => a + b, 0);
  parts.push(`storm: 10 relaunches with 12 saved shell panes; shells seen [${seen.join(" ")}]; stalled (ThreadCount <= 1 at 15 s) [${stalled.join(" ")}] = ${stalledTotal}; survivors per close [${left.join(" ")}]`);
  if (stalledTotal > 0) fails.push(`${stalledTotal} stalled shell(s) across the 10 relaunches`);
  const text = parts.join(" · ");
  if (fails.length > 0) throw new Error(`${fails.join("; ")} · ${text}`);
  return text;
}

// T-560: removes the temp folder once the app (pid) has exited, waiting up to 10 s, then retries a folder
// still held (EPERM / EBUSY / ENOTEMPTY) with a growing wait: 0.5 s, 1 s ... 2.5 s. fs's own maxRetries
// does not retry EPERM on a held folder (Node 24 fails at once), so the loop is here. Returns null when
// gone, else the error code: a held folder never throws. Council FIX-1: a folder that holds files but no
// marker from setup() is never removed ("NOMARKER"); a missing or empty one is fine. FIX-2: a folder
// whose marker names another smoke run that is still alive is never removed ("INUSE"); when the delete
// stops part way (a file the app still holds), the marker is written again, so the next run can clear it.
async function removeTemp(dir, pid, retries = 5) {
  if (existsSync(dir) && !existsSync(join(dir, TEMP_MARKER)) && readdirSync(dir).length > 0) return "NOMARKER";
  const mark = existsSync(join(dir, TEMP_MARKER)) ? readFileSync(join(dir, TEMP_MARKER), "utf8") : null;
  const owner = Number(/pid (\d+)/.exec(mark ?? "")?.[1] ?? 0);
  if (owner && owner !== process.pid && (await alive(owner).catch(() => true))) return "INUSE";
  for (let i = 0; i < 20 && pid && (await alive(pid).catch(() => false)); i++) await sleep(500);
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return null;
    } catch (e) {
      if (i >= retries || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(e.code)) {
        if (existsSync(dir) && !existsSync(join(dir, TEMP_MARKER))) {
          try {
            writeFileSync(join(dir, TEMP_MARKER), mark ?? markerText(process.pid));
          } catch {
            // the folder is going or locked; the next run reports NOMARKER and says to delete it by hand
          }
        }
        return e.code ?? e.message;
      }
      await sleep(500 * (i + 1));
    }
  }
}

// T-560: `--self-test` checks the cleanup against a folder another process holds open (its working
// folder), and the off-screen config, without launching the app.
if (flag("self-test")) {
  const checks = [];
  // Council FIX-1: everything here lives in TEMP/held (marked like setup() marks TEMP); TEMP itself and
  // anything else in it are never removed, so a kept --keep folder survives a self-test.
  const d = join(TEMP, "held");
  // FIX-2 (council re-review AFTER 1): the self-test removes TEMP/held, so one it did not make is refused.
  if (existsSync(d)) {
    console.error(`smoke: ${d} already exists and the self-test would remove it; pick another --temp or delete it by hand`);
    process.exit(2);
  }
  const held = (ms) => {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, TEMP_MARKER), "");
    writeFileSync(join(d, "f.txt"), "x");
    spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { cwd: d, stdio: "ignore", windowsHide: true });
  };
  const sibling = join(TEMP, "self-test-sibling.txt");
  const hadSibling = existsSync(sibling);
  mkdirSync(TEMP, { recursive: true });
  if (!hadSibling) writeFileSync(sibling, "kept by the self-test\n");
  held(4000);
  await sleep(300);
  const code = await removeTemp(d, null, 0);
  checks.push([code !== null && existsSync(d), `a held folder with no retries is reported, not thrown: ${code}`]);
  await removeTemp(d, null, 8);
  held(1500);
  await sleep(300);
  const late = await removeTemp(d, null);
  checks.push([late === null && !existsSync(d), `a folder held for 1.5 s is removed by the retries: ${late ?? "gone"}`]);
  const unmarked = join(d, "unmarked");
  mkdirSync(unmarked, { recursive: true });
  writeFileSync(join(d, TEMP_MARKER), "");
  writeFileSync(join(unmarked, "precious.txt"), "x");
  const refused = await removeTemp(unmarked, null, 0);
  checks.push([refused === "NOMARKER" && existsSync(join(unmarked, "precious.txt")), `a folder with files but no setup() marker is refused and kept: ${refused}`]);
  const empty = join(d, "empty");
  mkdirSync(empty, { recursive: true });
  const emptyGone = await removeTemp(empty, null, 0);
  checks.push([emptyGone === null && !existsSync(empty), `an empty unmarked folder may go: ${emptyGone ?? "gone"}`]);
  // FIX-2 (FIX-SOON 3): a file held with no sharing (as the app holds its log) stops the delete after the marker
  // is gone; the marker is written again, so the next run is not refused with NOMARKER.
  const partial = join(d, "partial");
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, TEMP_MARKER), "");
  const heldLog = join(partial, "z-app.log");
  writeFileSync(heldLog, "x");
  spawn("powershell", ["-NoProfile", "-Command", `$f=[IO.File]::Open('${heldLog}','Open','ReadWrite','None'); Start-Sleep -Milliseconds 5000; $f.Close()`], { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 40; i++) {
    try {
      writeFileSync(heldLog, "x");
      await sleep(250);
    } catch {
      break;
    }
  }
  const part = await removeTemp(partial, null, 0);
  const back = existsSync(join(partial, TEMP_MARKER));
  checks.push([part !== null && back, `a delete stopped by a held file writes the marker again: ${part ?? "REMOVED"}, marker ${back ? "back" : "MISSING (the next run would get NOMARKER)"}`]);
  const after = await removeTemp(partial, null, 8);
  checks.push([after === null && !existsSync(partial), `once the file is let go the folder goes: ${after ?? "gone"}`]);
  // FIX-2 (AFTER 2): a marker names the smoke run that made it; another run's folder is refused while that run lives.
  const owned = join(d, "owned");
  mkdirSync(owned, { recursive: true });
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { stdio: "ignore", windowsHide: true });
  writeFileSync(join(owned, TEMP_MARKER), markerText(other.pid));
  writeFileSync(join(owned, "f.txt"), "x");
  const inUse = await removeTemp(owned, null, 0);
  checks.push([inUse === "INUSE" && existsSync(join(owned, "f.txt")), `a folder whose marker names another live smoke run is refused and kept: ${inUse ?? "REMOVED"}`]);
  other.kill();
  await sleep(500);
  const freed = await removeTemp(owned, null, 4);
  checks.push([freed === null && !existsSync(owned), `once that run has ended its folder may go: ${freed ?? "gone"}`]);
  const cleaned = await removeTemp(d, null, 8);
  checks.push([cleaned === null && !existsSync(d) && existsSync(TEMP) && existsSync(sibling), `only TEMP/held was removed; TEMP and its other files stay: ${cleaned ?? "held gone"}, TEMP ${existsSync(TEMP) ? "kept" : "GONE"}, sibling ${existsSync(sibling) ? "kept" : "GONE"}`]);
  if (!hadSibling) rmSync(sibling, { force: true });
  const cfg = app.config();
  const off = moveScript(4242, true);
  const on = moveScript(4242, false);
  checks.push([
    cfg.app === undefined && off.includes("SetWindowPos($h,[IntPtr]::Zero,-32000,-32000,0,0,0x0015)") && !off.includes("AllScreens") && on.includes("-1920,0,0,0,0x0005") && on.includes("AllScreens"),
    `the start config carries no window entries (${JSON.stringify(Object.keys(cfg))}); --offscreen moves the window at run time to -32000,-32000 on any screen count`,
  ]);
  const both = await run(process.execPath, [fileURLToPath(import.meta.url), "--offscreen", "--keep", "--self-test", "--temp", join(TEMP, "never-made")]).then(
    () => 0,
    (e) => e.code,
  );
  checks.push([both === 2 && !existsSync(join(TEMP, "never-made")), `--offscreen with --keep is refused before anything runs: exit ${both}`]);
  const pre = join(TEMP, "pre-held");
  mkdirSync(join(pre, "held"), { recursive: true });
  writeFileSync(join(pre, "held", "precious.txt"), "x");
  const again = await run(process.execPath, [fileURLToPath(import.meta.url), "--self-test", "--temp", pre]).then(
    () => 0,
    (e) => e.code,
  );
  checks.push([again === 2 && existsSync(join(pre, "held", "precious.txt")), `a self-test whose TEMP/held already exists is refused and the folder kept: exit ${again}`]);
  rmSync(pre, { recursive: true, force: true });
  const fake = (idle, busy) => [{ user: busy, nice: 0, sys: 0, idle, irq: 0 }, { user: busy, nice: 0, sys: 0, idle, irq: 0 }];
  const pct = cpuBusyPct(fake(0, 0), fake(5, 95));
  checks.push([pct === 95 && cpuBusyPct(fake(0, 0), fake(100, 0)) === 0 && cpuBusyPct(fake(7, 7), fake(7, 7)) === 0, `cpuBusyPct: 5 idle + 95 busy ticks reads ${pct}%, all idle 0%, no ticks 0%`]);
  for (const [ok, note] of checks) log(`${ok ? "PASS" : "FAIL"} self-test: ${note}`);
  const bad = checks.filter((c) => !c[0]).length;
  log(`smoke self-test: ${checks.length - bad}/${checks.length} passed`);
  process.exit(bad ? 1 : 0);
}

// ---------- run ----------
const flows = { 1: flow1, 2: flow2, 3: flow3, 4: flow4, 5: flow5 };
const results = [];
let setupError = null;
try {
  await setup();
} catch (e) {
  setupError = e;
}
for (const n of ONLY) {
  if (setupError) {
    results.push([n, false, `setup failed: ${setupError.message}`]);
    continue;
  }
  const cpu0 = cpuSnap();
  try {
    results.push([n, true, await flows[n]()]);
  } catch (e) {
    results.push([n, false, e.message]);
  }
  const [, ok, note] = results[results.length - 1];
  log(`flow ${n}: ${ok ? "PASS" : "FAIL"}: ${note}`);
  const busy = cpuBusyPct(cpu0, cpuSnap());
  if (!ok && busy > 90) log(`note: CPU ${busy}% during flow ${n}: likely load flake (after.md 855); rerun with --only ${n} on a quiet machine`);
}
const lastPid = app.pid;
try {
  await closeApp();
} catch (e) {
  log(`WARN close: ${e.message}`);
}
if (KEEP) log(`kept ${TEMP}${ATTACH ? "" : ` and the app (pid ${app.pid})`}`);
log("");
const lines = [];
const tag = (n) => (required(n) ? "" : " [report-only]");
for (const [n, ok, note] of results) lines.push(`${ok ? "PASS" : "FAIL"} ${n}${tag(n)}: ${note}`);
if (closeReport) lines.push(`${closeReport[0] ? "PASS" : "FAIL"} close${tag(5)}: ${closeReport[1]}`);
const counted = results.filter(([n]) => required(n));
const failed = counted.filter((r) => !r[1]).length + (closeReport && required(5) && !closeReport[0] ? 1 : 0);
const reportOnly = results.filter(([n]) => !required(n));
let summary = `smoke: ${counted.length - failed}/${counted.length} flows passed`;
if (reportOnly.length > 0) summary += ` (flow 5 report-only until T-184 is ticked in PLAN.md: ${reportOnly.every((r) => r[1]) && (!closeReport || closeReport[0]) ? "PASS" : "FAIL"})`;
lines.push(summary);
for (const l of lines) log(l);
let sha = "nosha";
try {
  sha = (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim() || sha;
} catch {
  /* not a git checkout */
}
const evidence = join(root, "evidence", `smoke-${sha}.txt`);
mkdirSync(join(root, "evidence"), { recursive: true });
writeFileSync(
  evidence,
  [`pnpm smoke at ${new Date().toISOString()} on ${sha} (${root})`, `args: ${args.join(" ") || "(none)"}; T-184 ticked: ${T184_ON}; flow 5 ${QUIT_REQUIRED ? "required" : "report-only"}`, ...lines, ""].join("\n"),
);
log(`evidence: ${evidence}`);
// T-560: the temp folder goes last, after every flow, summary and evidence line is out, so a cleanup
// failure can never swallow them. The app is waited for (up to 10 s), then fs retries EPERM/EBUSY with a
// growing delay (0.5 s, 1 s, ... 2.5 s); a folder still held is a warning, not a failed smoke.
if (!KEEP) {
  const code = await removeTemp(TEMP, lastPid);
  if (code) log(`WARN cleanup: ${TEMP} was not removed (${code}); delete it by hand`);
}
process.exit(failed ? 1 : 0);
