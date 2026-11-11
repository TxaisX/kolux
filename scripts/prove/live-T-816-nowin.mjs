// T-816 proof: does any child of the Kolux app open a console window? Starts a built debug exe the way the
// release app runs (no console of its own) on a private desktop nobody sees (nowin-probe.ps1), drives the page over
// the WebView2 debugging port (startup, add a project, start a plain terminal, start an agent seat, read the
// font list and the resource sample), and prints the probe's count of visible console windows.
//
//   node scripts/prove/live-T-816-nowin.mjs --exe <kolux.exe> --label before|after [--port 1447] [--cdp 9287]
//
// The exe must be a debug build made with TAURI_CONFIG={"identifier":"com.txaisxiong.kolux.ready-nowin",
// "build":{"devUrl":"http://localhost:<port>"}} so it loads this script's vite and its own profile folder.
// Scratch folders (agent config, home, profile, throwaway repo) are all under G:\Temp\ready-nowin-T-816\<label>.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, run, sleep, waitFor } from "../evidence/app-launch.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE = opt("exe");
const LABEL = opt("label", "run");
const PORT = Number(opt("port", "1447"));
const CDP = Number(opt("cdp", "9287"));
const IDENTIFIER = opt("identifier", "com.txaisxiong.kolux.ready-nowin");
const TEMP = resolve(opt("temp", `G:\\Temp\\ready-nowin-T-816\\${LABEL}`));
if (!EXE || !existsSync(EXE)) throw new Error(`--exe must be a built kolux.exe (got ${EXE})`);
if (!TEMP.toLowerCase().includes("ready-nowin-t-816")) throw new Error("the scratch folder must be under ready-nowin-T-816");
const log = (...x) => console.log(...x);

rmSync(TEMP, { recursive: true, force: true });
const repo = join(TEMP, "repo");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "notes.txt"), "hello\n");
const g = (a) => run("git", a, { cwd: repo });
await g(["init", "-q", "-b", "main"]);
await g(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "."]);
await g(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "t"]);

const app = createApp({ root, port: PORT, cdp: CDP, identifier: IDENTIFIER, temp: TEMP, suffix: ".ready-nowin", log });
const { paths, evalJs, invoke, exists, shown, click, clickWhere, focusField, cdp } = app;
for (const d of [paths.claudeConfig, paths.codexHome, paths.local, paths.roaming]) mkdirSync(d, { recursive: true });
writeFileSync(join(paths.claudeConfig, ".kolux-scratch"), "");
const appDir = join(TEMP, "appdir");
mkdirSync(appDir, { recursive: true });

// vite on this lane's port: node itself, never through a .cmd shim.
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"], { cwd: root, windowsHide: true, stdio: "ignore" });
await waitFor("vite", async () => (await fetch(`http://localhost:${PORT}/`).catch(() => null))?.ok, 60000, 500);

const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`,
  CLAUDE_CONFIG_DIR: paths.claudeConfig,
  CODEX_HOME: paths.codexHome,
  KOLUX_APP_DIR: appDir,
  TEMP: paths.appTemp,
  TMP: paths.appTemp,
  USERPROFILE: paths.userHome,
  HOME: paths.userHome,
  KOLUX_KEYBINDINGS_HOME: paths.userHome,
  APPDATA: paths.roaming,
  LOCALAPPDATA: paths.local,
  CARGO_HOME: process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? "", ".cargo"),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(process.env.USERPROFILE ?? "", ".rustup"),
};
mkdirSync(paths.appTemp, { recursive: true });
const stopFile = join(TEMP, "stop");
const report = join(TEMP, "probe.json");
const probe = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "prove", "nowin-probe.ps1"), "-Exe", EXE, "-StopFile", stopFile, "-Report", report, "-MaxSeconds", "420"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let probeOut = "";
probe.stdout.on("data", (d) => (probeOut += d));
probe.stderr.on("data", (d) => (probeOut += d));
const probeDone = new Promise((r) => probe.on("exit", r));

const steps = [];
const step = async (name, fn) => {
  try {
    const v = await fn();
    steps.push(`ok   ${name}${v ? `: ${v}` : ""}`);
  } catch (e) {
    steps.push(`FAIL ${name}: ${String(e.message ?? e).slice(0, 200)}`);
  }
};

try {
  await step("page up", async () => {
    await waitFor("the app page", async () => (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).some((t) => t.type === "page" && /localhost:\d+|tauri\.localhost/.test(t.url)), 180000, 2000);
    await waitFor("the sidebar", () => exists("aside.sidebar"), 90000, 1000);
  });
  await sleep(4000); // startup work (login environment, agent search, fonts, resource sampler) runs after the page is up
  await step("add project by path", async () => {
    await click('aside.sidebar button[aria-label="Add project"]');
    await waitFor("the add-by-path link", () => exists("button[data-add-by-path]"), 8000);
    await click("button[data-add-by-path]");
    await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 8000);
    await focusField('input[aria-label="project folder"]');
    await cdp("insert", repo, "enter");
    await waitFor("the launch chooser", async () => (await shown("section.pane.chooser")) >= 1, 40000);
  });
  const seat = 'section.pane.chooser [role="group"][aria-label="Seat 1: which AI"] button';
  await step("start a plain terminal", async () => {
    await waitFor("the Terminal choice", () => evalJs(`[...document.querySelectorAll(${JSON.stringify(seat)})].some(b => /^\\s*Terminal\\s*$/.test(b.textContent))`), 40000);
    const labels = await evalJs(`[...document.querySelectorAll(${JSON.stringify(seat)})].map(b => b.textContent.trim())`);
    await clickWhere(seat, "/^\\s*Terminal\\s*$/");
    const start = "section.pane.chooser button.btn.primary";
    await waitFor("Start", () => evalJs(`[...document.querySelectorAll(${JSON.stringify(start)})].some(b => !b.disabled && /^\\s*Start\\s*$/.test(b.textContent))`), 60000);
    await clickWhere(start, "/^\\s*Start\\s*$/");
    await waitFor("a shell pane", async () => (await shown("section.pane[data-agent]")) >= 1, 40000);
    return `seat buttons: ${labels.join(", ")}`;
  });
  await sleep(2500);
  await step("type a command in the terminal", async () => {
    await cdp("focus", 'section.pane[data-agent="shell"] .xterm-helper-textarea');
    await cdp("insert", "git status", "enter");
    await sleep(1500);
  });
  await step("start an agent seat", async () => {
    // The old New tab button is gone: a pane's header has a "New session" plus that opens the agent menu,
    // and the new session joins that pane's cell (same path as smoke.mjs newTab).
    const term = '[data-testid="terminal-pane"]';
    // Agent rows carry data-testid="new-session-item-<agent id>"; their text also holds the exe and a shortcut,
    // so they are picked by test id, never by label.
    const agentRow = '[data-testid="new-session-menu"] [data-testid^="new-session-item-"]:not([disabled])';
    const before = await shown(term);
    await app.focusPane(term, 0, ".xterm-helper-textarea");
    await click(`${term}.focused [data-testid="pane-new-session"]`);
    await waitFor("the New session menu", () => exists('[data-testid="new-session-menu"]'), 6000);
    const ids = await evalJs(`[...document.querySelectorAll(${JSON.stringify(agentRow)})].map(b => b.dataset.testid)`);
    if (!ids.length) throw new Error("the New session menu offers no agent");
    await click(`[data-testid="${ids[0]}"]`);
    await waitFor("the new session's pane", async () => (await shown(term)) > before, 15000);
    await sleep(6000);
    return `agents offered: ${ids.map((i) => i.replace("new-session-item-", "")).join(", ")}; started: ${ids[0].replace("new-session-item-", "")}`;
  });
  await step("font list", async () => `${(await invoke("list_fonts")).length} families`);
  await step("resource sample", async () => {
    await invoke("resources");
    await sleep(2500);
    await invoke("resources");
  });
  await sleep(5000);
} finally {
  writeFileSync(stopFile, "stop");
  await Promise.race([probeDone, sleep(60000)]);
  vite.kill();
}

const rep = existsSync(report) ? JSON.parse(readFileSync(report, "utf8").replace(/^\uFEFF/, "")) : null;
log(`\n=== T-816 window probe (${LABEL}) ===`);
log(`exe: ${EXE}`);
for (const s of steps) log(s);
log(probeOut.trim());
if (rep) {
  const vis = (rep.windows ?? []).filter((w) => w.visible);
  log(`samples: ${rep.samples} over ${rep.seconds} s (every 20 ms); child processes seen: ${rep.processes?.length ?? 0}; windows seen: ${rep.windows?.length ?? 0}`);
  log(`VISIBLE CONSOLE WINDOWS FROM KOLUX CHILDREN: ${rep.visibleConsoleWindows}`);
  for (const w of vis.filter((w) => /Console|CASCADIA/i.test(w.class))) log(`  console window at +${w.t} ms: class ${w.class} pid ${w.pid} (${w.exe}) "${w.title}"`);
  const byExe = {};
  for (const p of rep.processes ?? []) byExe[`${p.exe} (from ${p.parent})`] = (byExe[`${p.exe} (from ${p.parent})`] ?? 0) + 1;
  log("child processes by program:");
  for (const [k, n] of Object.entries(byExe).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(3)} x ${k}`);
  const classes = {};
  for (const w of rep.windows ?? []) classes[`${w.class}${w.visible ? " (visible)" : ""}`] = (classes[`${w.class}${w.visible ? " (visible)" : ""}`] ?? 0) + 1;
  log("window classes seen:");
  for (const [k, n] of Object.entries(classes).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(3)} x ${k}`);
} else log("no probe report was written");
