// LIVE proof, T-544 (PLAN.md) items 2-5 plus APP-052 b1/b2 (spec/19) against the INSTALLED build, never tauri dev.
// The app is started through WMI (Win32_Process.Create), so it is a child of WmiPrvSE and outside the job object that
// holds this script (an agent harness's job ends the terminal service on quit, which voids APP-052 when spawned plainly).
// Its environment is rebuilt the way Explorer would give it (registry Machine + User Environment, expanded, plus the
// per-user folders), with every KOLUX_*, CODEX_HOME, CLAUDE_CONFIG_DIR, CLAUDECODE* / CLAUDE_CODE_* and API key removed.
// The app always puts itself in its own job (procs.rs app_job_start, APP-053), so its own IsProcessInJob reads True by
// design; the run is void when a probe started the same way, or the terminal service, reads True.
// PROVE_DRY=1: only the guards, the environment and the shortcut lookup; nothing is started.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../evidence/app-launch.mjs";
import { reporter, dismissFirstRun, sleep, waitFor, TERM, ROOT, LIVE_BASE, LIVE_LOGS } from "./live-common.mjs";
import { paneStates as readPaneStates } from "./pane-states.mjs";

const DRY = process.env.PROVE_DRY === "1";
const ID = "com.txaisxiong.kolux-rs";
const CDP = 9291;
const LA = process.env.LOCALAPPDATA;
const AD = process.env.APPDATA;
const INSTALL = join(LA, "Kolux RS");
const EXE = join(INSTALL, "kolux-rs.exe");
const CLI = join(INSTALL, "bin", "kolux.exe");
const DATA = [join(AD, ID), join(LA, ID)];
const RUN = `${LIVE_BASE}/run-T-544`;
const REPO = `${LIVE_BASE}/work/T-544`;
const d = new Date();
const STAMP = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
const tag = Date.now().toString(36).slice(-4);
const M1 = `APP052-A${tag}-END`;
const M2 = `APP052-B${tag}-END`;

// The home folder is written as %USERPROFILE% in every log and evidence line.
// (Taken from LOCALAPPDATA: USERPROFILE points at a scratch home while this script runs.)
const HOME = (LA ?? "").replace(/[\\/]AppData[\\/]Local$/i, "");
const homeRe = HOME ? new RegExp(HOME.split(/[\\/]/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]+"), "gi") : null;
const mask = (s) => (homeRe ? s.replace(homeRe, "%USERPROFILE%") : s);
const rep = reporter();
const ev = rep.lines;
const log = (...a) => rep.log(mask(a.join(" ")));
const results = {};
let voided = null;
const check = (item, name, pass, detail) => {
  (results[item] ??= []).push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${item}: ${name}: ${detail}`);
};

const ps = (cmd, input) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", ...(input === undefined ? {} : { input }) }).trim();
const q = (s) => s.replace(/'/g, "''");
const norm = (s) => s.replaceAll("\\", "/").toLowerCase();
// A path inside a command line, with a boundary after it: the data folder must not match com.txaisxiong.kolux-rs.prove.
const names = (cmd, path) => new RegExp(norm(path).replace(/[.*+?^${}()|[\]]/g, "\\$&") + "(?![\\w.-])").test(norm(cmd));
const ours = (cmd) => [INSTALL, ...DATA].some((p) => names(cmd, p));

const inJob = (pid) => {
  try {
    return ps(`Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);' -Name J -Namespace K; $r=$false; [void][K.J]::IsProcessInJob((Get-Process -Id ${pid}).Handle, [IntPtr]::Zero, [ref]$r); $r`);
  } catch (e) {
    return `unknown (${e.message.split("\n")[0]})`;
  }
};
const appsRunning = () =>
  ps(`Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${q(INSTALL)}\\*' -and $_.CommandLine -notlike '*--terminal-service*' } | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" }`)
    .split(/\r?\n/).filter(Boolean).map((l) => ({ pid: Number(l.split("|")[0]), ppid: Number(l.split("|")[1]) }));
const services = () =>
  ps(`Get-CimInstance Win32_Process -Filter "CommandLine like '%--terminal-service%'" | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }`)
    .split(/\r?\n/).filter(Boolean).map((l) => {
      const [pid, ppid, ...rest] = l.split("|");
      return { pid: Number(pid), ppid: Number(ppid), cmd: rest.join("|") };
    });
const mine = () => services().filter((s) => ours(s.cmd));
const procName = (pid) => {
  try {
    return ps(`(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`);
  } catch {
    return "gone";
  }
};

// ---------- the environment Explorer would give ----------
const PER_USER = ["SystemRoot", "SystemDrive", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "USERDOMAIN_ROAMINGPROFILE", "LOGONSERVER", "ALLUSERSPROFILE", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "PUBLIC", "SESSIONNAME"];
const STRIP = (k) => /^KOLUX_/i.test(k) || /^CLAUDECODE/i.test(k) || /^CLAUDE_CODE_/i.test(k) || /^(CODEX_HOME|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)$/i.test(k);
function explorerEnv(extra) {
  const raw = JSON.parse(
    ps(`$m = Get-Item 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'; $u = Get-Item 'HKCU:\\Environment'
      $o = @{ machine = @{}; user = @{}; folders = @{ USERPROFILE = [Environment]::GetFolderPath('UserProfile'); APPDATA = [Environment]::GetFolderPath('ApplicationData'); LOCALAPPDATA = [Environment]::GetFolderPath('LocalApplicationData') } }
      foreach ($n in $m.GetValueNames()) { $o.machine[$n] = [string]$m.GetValue($n, $null, 'DoNotExpandEnvironmentNames') }
      foreach ($n in $u.GetValueNames()) { $o.user[$n] = [string]$u.GetValue($n, $null, 'DoNotExpandEnvironmentNames') }
      $o | ConvertTo-Json -Depth 3 -Compress`),
  );
  const env = new Map(); // lower-case key -> [key, value]
  const set = (k, v) => env.set(k.toLowerCase(), [k, v]);
  const expand = (v) => String(v).replace(/%([^%]+)%/g, (all, n) => env.get(n.toLowerCase())?.[1] ?? all);
  for (const k of PER_USER) if (process.env[k] !== undefined) set(k, process.env[k]);
  for (const [k, v] of Object.entries(raw.folders)) set(k, v);
  const prof = raw.folders.USERPROFILE;
  set("HOMEDRIVE", prof.slice(0, 2));
  set("HOMEPATH", prof.slice(2));
  for (const [k, v] of Object.entries(raw.machine)) set(k, expand(v));
  const machinePath = env.get("path")?.[1] ?? "";
  for (const [k, v] of Object.entries(raw.user)) set(k, k.toLowerCase() === "path" ? `${machinePath};${expand(v)}` : expand(v));
  const stripped = [...env.values()].map(([k]) => k).filter(STRIP);
  for (const k of stripped) env.delete(k.toLowerCase());
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return { vars: [...env.values()].map(([k, v]) => `${k}=${v}`), stripped, count: env.size };
}

// Win32_Process.Create through WMI: the new process is WmiPrvSE's child, so it is not in this script's job.
// ShowWindow 4 = SW_SHOWNOACTIVATE (never takes the focus); the window is moved off-screen right after.
function wmiStart(commandLine, cwd, vars, show = 4) {
  const out = ps(
    `$vars = [string[]]([Console]::In.ReadToEnd() | ConvertFrom-Json)
     $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ EnvironmentVariables = $vars; ShowWindow = [uint16]${show} }
     $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q(commandLine)}'; CurrentDirectory = '${q(cwd)}'; ProcessStartupInformation = $si }
     "$($r.ReturnValue)|$($r.ProcessId)"`,
    JSON.stringify(vars),
  );
  const [rv, pid] = out.split("|").map(Number);
  if (rv !== 0 || !pid) throw new Error(`Win32_Process.Create returned ${rv} for ${commandLine}`);
  return pid;
}

function startMenuLink() {
  const pd = process.env.ProgramData ?? "C:\\ProgramData";
  const tries = [join(AD, "Microsoft\\Windows\\Start Menu\\Programs\\Kolux RS.lnk"), join(AD, "Microsoft\\Windows\\Start Menu\\Programs\\Kolux RS\\Kolux RS.lnk"), join(pd, "Microsoft\\Windows\\Start Menu\\Programs\\Kolux RS.lnk"), join(pd, "Microsoft\\Windows\\Start Menu\\Programs\\Kolux RS\\Kolux RS.lnk")];
  return tries.find((p) => existsSync(p)) ?? null;
}
const configLine = () => {
  try {
    return readFileSync(join(DATA[0], "logs", "kolux.log"), "utf8").split(/\r?\n/).filter((l) => /kolux-rs: config: /.test(l)).pop() ?? "(no config line yet)";
  } catch {
    return "(no kolux.log)";
  }
};
// The newest reattach line: "0 taken back" = not reattached; "N taken back" with blank panes = reattached blank.
const takenBackLine = () => {
  try {
    return readFileSync(join(DATA[0], "logs", "kolux.log"), "utf8").split(/\r?\n/).filter((l) => /terminals taken back/.test(l)).pop() ?? "(no 'terminals taken back' line)";
  } catch {
    return "(no kolux.log)";
  }
};
const jobLine = () => {
  try {
    return /could not be put in its own job object/.test(readFileSync(join(DATA[0], "logs", "kolux.log"), "utf8")) ? "the app reported it could NOT join its own job (APP-053)" : "no APP-053 job failure in kolux.log";
  } catch {
    return "(no kolux.log)";
  }
};

// ---------- CDP on 9291 (live-common's shot/rawKey are fixed to 9290) ----------
async function cdpSend(method, params) {
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const t = targets.find((x) => x.type === "page" && /tauri\.localhost/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const m = await new Promise((resolve) => {
    ws.onmessage = (e) => { const x = JSON.parse(e.data); if (x.id === 1) resolve(x); };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return m.result;
}
const shot = async (name) => {
  const r = await cdpSend("Page.captureScreenshot", { format: "png" });
  if (!r?.data) return null;
  const file = `${LIVE_LOGS}/${name}.png`;
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
};
const key = async (k) => {
  await cdpSend("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdpSend("Input.dispatchKeyEvent", { type: "keyUp", ...k });
};

const app = createApp({ root: ROOT, port: "1", cdp: String(CDP), identifier: ID, temp: RUN, offscreen: true, attach: true, log });
// A release build has no __koluxTerm (dev only), so this reads the DOM renderer's visible rows: terminalGpu must be off
// (item 4 runs first). i = -1: every visible pane. Rows come back as [text, full]; full = the text reaches the right edge
// with no trailing space, i.e. the line wraps into the next row. scan: also step the viewport through the scrollback.
async function domRows(sel, i, scan) {
  const read = (p) => {
    const sw = p.querySelector(".xterm-screen")?.getBoundingClientRect().width ?? 0;
    return [...p.querySelectorAll(".xterm-rows > div")].map((r) => {
      const t = r.textContent.replace(/ /g, " ");
      const rg = document.createRange();
      rg.selectNodeContents(r);
      const w = rg.getBoundingClientRect().width;
      return [t, t.length > 0 && !/\s$/.test(t) && sw - w < (w / t.length) * 1.5];
    });
  };
  const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const ps = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
  const out = [];
  for (const p of i < 0 ? ps : ps.slice(i, i + 1)) {
    const v = p.querySelector(".xterm-viewport");
    if (scan && v && v.scrollHeight > v.clientHeight) {
      const end = v.scrollTop;
      for (let y = 0; ; y += v.clientHeight) {
        v.scrollTop = Math.min(y, v.scrollHeight);
        v.dispatchEvent(new Event("scroll"));
        await frame();
        out.push(...read(p));
        if (v.scrollTop + v.clientHeight >= v.scrollHeight - 1) break;
      }
      v.scrollTop = end;
      v.dispatchEvent(new Event("scroll"));
      await frame();
    } else out.push(...read(p));
    out.push(["", false]); // a pane boundary never joins
  }
  return out;
}
// Wrapped rows are joined back into one line.
const joinRows = (rows) => {
  const out = [];
  let wrap = false;
  for (const [t, full] of rows) {
    if (wrap && t.trim()) out[out.length - 1] += t;
    else out.push(t);
    wrap = full;
  }
  return out.map((l) => l.trim());
};
const paneLines = async (i, scan = false) => {
  const r = await app.evalJs(`(${domRows.toString()})(${JSON.stringify(TERM)}, ${i}, ${scan})`);
  return joinRows(Array.isArray(r) ? r : []);
};
const typeInto = async (i, line) => {
  await app.focusPane(TERM, i, ".xterm-helper-textarea");
  await app.cdp("insert", line, "enter");
};
// Output lines between two echoed markers (an echoed command line carries the prompt, so only output equals a marker).
const between = (l, a, b) => {
  const i = l.lastIndexOf(a);
  const j = l.indexOf(b, i + 1);
  return i >= 0 && j > i ? l.slice(i + 1, j).filter(Boolean) : null;
};
const run = async (i, cmd, name) => {
  const [a, b] = [`T544-${name}-B${tag}`, `T544-${name}-E${tag}`];
  for (const c of [`echo ${a}`, cmd, `echo ${b}`]) {
    await typeInto(i, c);
    await sleep(700);
  }
  return waitFor(`output of ${cmd}`, async () => between(await paneLines(i), a, b), 30000, 500);
};

let envVars = null;
async function launch(label) {
  const pid = wmiStart(`"${EXE}"`, INSTALL, envVars);
  app.pid = pid;
  app.exePath = EXE;
  log(`${label}: started through WMI Win32_Process.Create, pid ${pid}, parent ${procName(appsRunning().find((p) => p.pid === pid)?.ppid ?? 0)}; window: ${await app.moveWindow(pid)}`);
  await app.pageUp(120000);
  log(`${label}: window after the page: ${await app.moveWindow(pid)}`);
}
// The job reading of the app and of every terminal service tied to this install (taken once panes are up).
function jobs(label) {
  log(`IsProcessInJob ${label}: app pid ${app.pid} ${inJob(app.pid)} (its own APP-053 job by design; ${jobLine()})`);
  const svc = mine();
  if (svc.length === 0) log(`IsProcessInJob ${label}: no terminal service tied to the install yet`);
  for (const s of svc) {
    const j = inJob(s.pid);
    log(`IsProcessInJob ${label}: terminal service pid ${s.pid} (parent ${s.ppid}) ${j}`);
    if (j !== "False") voided ??= `terminal service pid ${s.pid} reads IsProcessInJob ${j} at ${label}`;
  }
}
// Kills what a quit left of the app's tree, except terminal services and everything under them (their conhost/shell
// pairs are the live terminals APP-052 keeps; the tree walk puts a reused service inside the launching app's tree).
async function killStrays(survivors, label) {
  const keep = new Set(services().map((s) => s.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of survivors) if (!keep.has(s.pid) && keep.has(s.ppid)) (keep.add(s.pid), (grew = true));
  }
  const kept = survivors.filter((s) => keep.has(s.pid));
  const kill = survivors.filter((s) => !keep.has(s.pid));
  log(`${label}: kept ${kept.length} service/service terminal processes (${app.byName(kept)}); killing ${kill.length} (${app.byName(kill)})`);
  await app.killAll(kill);
}
// What each shown terminal pane says after a relaunch (pane-states.mjs, sent to the page as text like domRows): its
// key from the pane's own data-key (T-566; the sidebar row is the fallback) and its restored chip, or null.
const paneStates = () => app.evalJs(`(${readPaneStates.toString()})(document, ${JSON.stringify(TERM)})`);
// The Tip card ignores Escape; its own button is "Not now".
async function dismissTip() {
  if (await app.clickWhere('[role="dialog"] button', "/^\\s*Not now\\s*$/").then(() => true, () => false)) {
    await sleep(800);
    log(`closed the Tip card (Not now); a dialog still open: ${await app.exists('[role="dialog"], [role="alertdialog"]')}`);
  }
}
// The panes are read ONCE before any dialog is closed: dismissFirstRun presses Escape when a dialog has no "Close setup"
// button, the Tip card is non-modal, so that Escape reaches the focused pane and clears its restored chip (T-544 run 4,
// relaunch 2, pane 1; evidence/T-566.txt). The second read, after the dialogs, shows what those keys did.
async function back(label) {
  await waitFor("a terminal pane back", async () => (await app.shown(TERM)) >= 1, 60000, 500);
  await waitFor("its input field", async () => (await app.count(`${TERM} .xterm-helper-textarea`)) >= 1, 30000);
  await sleep(4000);
  const panes = await paneStates();
  await dismissTip();
  await dismissFirstRun(app, log);
  await dismissTip(); // it can open after the panes
  jobs(label);
  log(`reattach ${label}: ${takenBackLine()}; panes ${JSON.stringify(panes)}`);
  log(`reattach ${label}: panes after dialogs ${JSON.stringify(await paneStates())}`);
}
async function closeNoCdp(pid) {
  const r = ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow() } else { 'gone' }`);
  const gone = await waitFor("the app to exit", async () => !appsRunning().some((p) => p.pid === pid), 30000, 500).then(() => true, () => false);
  return `CloseMainWindow (WM_CLOSE) returned ${r}; exited ${gone}`;
}

let code = 1;
try {
  log(`T-544 live proof ${new Date().toISOString()}${DRY ? " (DRY: nothing is started)" : ""}; install ${INSTALL}; CDP ${CDP}`);
  // Guards: Txais may be using the installed app; never launch over it.
  const running = appsRunning();
  const runningSvc = mine();
  if (running.length || runningSvc.length) {
    log(`QUESTION: the installed app is already running (kolux-rs.exe pids ${JSON.stringify(running.map((p) => p.pid))}, terminal services ${JSON.stringify(runningSvc.map((s) => s.pid))}); not launching`);
    process.exit(3);
  }
  if (!existsSync(EXE) || !existsSync(CLI)) {
    log(`STUCK: the install is incomplete: ${EXE} ${existsSync(EXE)}, ${CLI} ${existsSync(CLI)}`);
    process.exit(4);
  }
  const absent = DATA.map((p) => [p, existsSync(p)]);
  check("item3", "both data folders are absent before the first launch", absent.every(([, e]) => !e), absent.map(([p, e]) => `${p} ${e ? "PRESENT" : "absent"}`).join("; "));
  if (absent.some(([, e]) => e)) throw new Error("a data folder already exists: not launching on an existing profile");
  const built = explorerEnv({ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}` });
  envVars = built.vars;
  log(`environment: ${built.count} variables from the registry and the user's folders; removed: ${built.stripped.length ? built.stripped.join(", ") : "none"}; added WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`);
  const lnk = startMenuLink();
  log(`Start menu shortcut: ${lnk ?? "NOT FOUND"}`);
  if (DRY) {
    code = 0;
    throw null;
  }

  // The WMI start itself: a probe started the same way must not be in any job.
  const probe = wmiStart(`"${join(process.env.SystemRoot, "System32", "PING.EXE")}" -n 30 127.0.0.1`, INSTALL, envVars, 0);
  await sleep(500);
  const pj = inJob(probe);
  log(`IsProcessInJob probe: PING.EXE pid ${probe} started through WMI ${pj}; this script (pid ${process.pid}) ${inJob(process.pid)}`);
  ps(`Stop-Process -Id ${probe} -Force -ErrorAction SilentlyContinue`);
  if (pj !== "False") voided ??= `a WMI-started probe reads IsProcessInJob ${pj}`;

  // First launch: a fresh profile.
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  writeFileSync(join(REPO, "notes.txt"), "t-544\n");
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=prove", "-c", "user.email=prove@localhost", "commit", "-q", "-m", "start"]]) execFileSync("git", a, { cwd: REPO });
  mkdirSync(RUN, { recursive: true });
  await launch("launch 1");
  log(`item 3: after the first launch: ${DATA.map((p) => `${p} ${existsSync(p) ? "created" : "absent"}`).join("; ")}`);
  log(`launch 1 ${mask(configLine())}`);
  const settingsFile = join(DATA[0], "settings.json");
  const readSettings = () => { try { return JSON.parse(readFileSync(settingsFile, "utf8")); } catch { return {}; } };
  if (readSettings().agentStatusHooks === true) throw new Error("agent status hooks are on in the fresh profile: stopping before anything could write a real settings file");
  log(`agent status hooks: ${readSettings().agentStatusHooks === true ? "on" : "off"} (nothing is installed in the real Claude or Codex settings)`);
  await dismissFirstRun(app, log);
  await waitFor("the sidebar add button", () => app.exists('.sb-foot button[title^="Add a project by path"]'), 30000);
  await app.click('.sb-foot button[title^="Add a project by path"]');
  await waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
  await app.focusField('input[aria-label="project folder"]');
  await app.cdp("insert", REPO, "enter");
  await back("launch 1");


  // Item 4: terminalGpu off through Settings > Appearance, a new shell pane, `dir`.
  await key({ key: ",", code: "Comma", windowsVirtualKeyCode: 188, modifiers: 2 });
  await waitFor("the Settings page", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  await app.clickWhere(".settings-nav button", "/^\\s*Appearance\\s*$/");
  const sw = 'section[data-section="terminal-drawing"] input[role="switch"]';
  await waitFor("the GPU switch", () => app.exists(sw), 5000);
  const wasOn = await app.evalJs(`document.querySelector(${JSON.stringify(sw)}).checked`);
  if (wasOn) await app.click(sw);
  await waitFor("terminalGpu false in settings.json", async () => readSettings().terminalGpu === false || (!wasOn && readSettings().terminalGpu !== true), 10000, 500);
  log(`item 4: terminalGpu set through the Settings UI (Appearance > Terminal drawing; it was ${wasOn ? "on" : "already off"}); settings.json terminalGpu ${JSON.stringify(readSettings().terminalGpu)}`);
  // The page's own Close button (run 2: a CDP Escape after the switch click left Settings open).
  await app.click('.settings button[aria-label="Close Settings"]');
  await waitFor("Settings closed", async () => !(await app.exists('.settings[role=dialog][aria-label="Settings"]')), 5000);
  // Log only (kolux-12): does the same CDP Escape close a freshly opened Settings?
  try {
    await key({ key: ",", code: "Comma", windowsVirtualKeyCode: 188, modifiers: 2 });
    await waitFor("the Settings page again", () => app.exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
    await sleep(500);
    await key({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    const closes = await waitFor("Settings closed by Escape", async () => !(await app.exists('.settings[role=dialog][aria-label="Settings"]')), 3000).then(() => true, () => false);
    log(`Escape closes Settings: ${closes ? "yes" : "no"} (opened fresh with Ctrl+, then a CDP rawKeyDown/keyUp Escape)`);
    if (!closes) await app.click('.settings button[aria-label="Close Settings"]');
  } catch (e) {
    log(`Escape closes Settings: not measured (${e.message})`);
  }
  if (await app.exists('.settings[role=dialog][aria-label="Settings"]')) await app.click('.settings button[aria-label="Close Settings"]');
  await waitFor("Settings closed", async () => !(await app.exists('.settings[role=dialog][aria-label="Settings"]')), 5000);
  await app.evalJs(`(() => { window.__t544csp = []; document.addEventListener("securitypolicyviolation", e => window.__t544csp.push(e.violatedDirective + " " + e.blockedURI)); return 1; })()`);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await waitFor("a second shell pane", async () => (await app.shown(TERM)) === 2, 30000);
  await waitFor("its input field", async () => (await app.count(`${TERM} .xterm-helper-textarea`)) >= 2, 30000);
  await sleep(3000);
  await typeInto(1, "dir");
  await sleep(3000);
  const look = await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null)[1]; let t = null; for (const d of p.querySelectorAll("div")) if (d.__koluxTerm) { t = d.__koluxTerm; break; }
    const rows = [...p.querySelectorAll(".xterm-rows > div")]; const box = p.querySelector(".xterm-rows");
    const tops = rows.map(r => r.getBoundingClientRect().top);
    return { renderer: p.querySelectorAll(".xterm-screen canvas").length ? "canvas (" + p.querySelectorAll(".xterm-screen canvas").length + ")" : rows.length ? "dom" : "none",
      rows: rows.length, heights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height * 100) / 100))], ascending: tops.every((v, i) => i === 0 || v > tops[i - 1]),
      font: box ? getComputedStyle(box).fontFamily : null, wantFont: t?.options?.fontFamily ?? null, color: box ? getComputedStyle(box).color : null, themeFg: t?.options?.theme?.foreground ?? null,
      dirHeader: /Mode\\s+LastWriteTime|Directory of|<DIR>/.test(rows.map(r => r.textContent).join("\\n")), csp: window.__t544csp }; })()`);
  log(`item 4: xterm renderer ${look.renderer}; ${JSON.stringify(look)}`);
  const rgb = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h ?? ""); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h; };
  const firstFont = (look.wantFont ?? "").split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  check("item4", "the DOM renderer draws aligned monospace rows in the theme colours with no CSP violation",
    look.renderer === "dom" && look.rows > 0 && look.heights.length === 1 && look.heights[0] > 0 && look.ascending && look.dirHeader && (!look.themeFg || look.color === rgb(look.themeFg)) && (!firstFont || (look.font ?? "").toLowerCase().includes(firstFont)) && look.csp.length === 0,
    `renderer ${look.renderer}, ${look.rows} rows, heights ${JSON.stringify(look.heights)}, ascending ${look.ascending}, dir output ${look.dirHeader}, colour ${look.color} vs theme ${rgb(look.themeFg)}, font ${look.font}, CSP violations ${look.csp.length}`);
  log(`screenshot: ${await shot("T-544-item4-dom-dir")}`);

  // Item 2: the RS command line comes first in a pane of the installed app (pane 1: DOM rows, cleared so all fits on screen).
  await typeInto(1, "cls");
  await sleep(1500);
  const w = await run(1, "where.exe kolux", "W");
  const first = w.find((l) => /^[a-z]:\\[^>]*\\kolux\.(exe|cmd|bat|ps1)$/i.test(l)) ?? ""; // a path line, not the echoed prompt
  // kolux-12's ruling: .cmd before .exe in where.exe is fine (PATHEXT resolves the .exe); the first entry's folder counts.
  check("item2", "where.exe kolux lists an entry in the install's bin folder first", norm(first).startsWith(norm(join(INSTALL, "bin")) + "/"), mask(JSON.stringify(w)));
  const src = await run(1, "(Get-Command kolux).Source", "S");
  check("item2", "(Get-Command kolux).Source is the install's bin\\kolux.exe", src.some((l) => norm(l) === norm(CLI)), mask(JSON.stringify(src)));
  const v = await run(1, "kolux --version", "V");
  check("item2", "kolux --version prints 0.1.0", v.some((l) => /\b0\.1\.0\b/.test(l)), mask(JSON.stringify(v)));

  // APP-052 b1: a marker survives three quit + relaunch rounds.
  await typeInto(1, `echo ${M1}`);
  await waitFor("marker 1", async () => (await paneLines(1)).includes(M1), 30000, 500);
  for (let round = 1; round <= 3; round++) {
    const closed = await app.closeAndCount(app.pid);
    const left = mine();
    log(`round ${round} quit: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)}); services still running after the quit: ${JSON.stringify(left.map((s) => s.pid))}`);
    await killStrays(closed.survivors, `round ${round} quit`);
    await launch(`relaunch ${round}`);
    await back(`relaunch ${round}`);
    const l = await paneLines(-1);
    const all = await paneLines(-1, true);
    check("b1", `round ${round}: the marker is back after the relaunch (screen or scrollback)`, all.includes(M1), `on screen ${l.includes(M1)} (${l.length} rows), in scrollback ${all.includes(M1)} (${all.length} rows), panes shown ${await app.shown(TERM)}; ${takenBackLine()}`);
    log(`screenshot: ${await shot(`T-544-APP052-round${round}`)}`);
  }

  // APP-052 b2: kill only the installed build's terminal service, relaunch, the terminal is back from saved history.
  const svc = mine();
  check("b2", "exactly one terminal service is tied to the install (its command line names the install or its data folder)", svc.length === 1, `${svc.length}: ${JSON.stringify(svc.map((s) => mask(s.cmd).slice(0, 240)))}`);
  if (svc.length === 1) {
    await typeInto(1, `echo ${M2}`);
    await waitFor("marker 2", async () => (await paneLines(1)).includes(M2), 30000, 500);
    await sleep(2500);
    // Other lanes' services come and go on their own; only the install's count (kolux-12's ruling).
    const exeOf = (s) => mask(/^"([^"]+)"|^(\S+)/.exec(s.cmd)?.slice(1).find(Boolean) ?? "?");
    const otherSvc = (list) => list.filter((s) => s.pid !== svc[0].pid);
    log(`b2: other terminal services before the kill: ${JSON.stringify(otherSvc(services()).map((s) => [s.pid, exeOf(s)]))}`);
    const oursBefore = otherSvc(mine()).map((s) => s.pid).sort();
    ps(`Stop-Process -Id ${svc[0].pid} -Force`);
    const gone = await waitFor("the service to be gone", async () => !services().some((s) => s.pid === svc[0].pid), 15000, 300).then(() => true, () => false);
    const oursAfter = otherSvc(mine()).map((s) => s.pid).sort();
    log(`b2: other terminal services after the kill: ${JSON.stringify(otherSvc(services()).map((s) => [s.pid, exeOf(s)]))}`);
    check("b2", "only that service was killed", gone && JSON.stringify(oursAfter) === JSON.stringify(oursBefore), `pid ${svc[0].pid} gone ${gone}; the install's other services ${JSON.stringify(oursBefore)} before, ${JSON.stringify(oursAfter)} after`);
    await sleep(2000);
    const closed = await app.closeAndCount(app.pid);
    log(`b2 quit: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)})`);
    await killStrays(closed.survivors, "b2 quit");
    await launch("relaunch after the kill");
    await back("relaunch after the kill");
    const l = await paneLines(-1);
    check("b2", "after the kill and a relaunch the terminal is back with its earlier output (marker 2)", l.includes(M2), `${l.length} buffer rows; marker 1 kept ${l.includes(M1)}; tail ${JSON.stringify(l.filter(Boolean).slice(-4))}`);
    log(`screenshot: ${await shot("T-544-APP052-after-kill")}`);
  }
  const closed = await app.closeAndCount(app.pid);
  log(`quit before the Start menu launch: ${closed.how}; survivors ${closed.survivors.length} (${app.byName(closed.survivors)})`);
  await killStrays(closed.survivors, "quit before the Start menu launch");
  app.pid = null;

  // Item 5: the Start menu shortcut through Explorer, no CDP.
  if (!lnk) check("item5", "the Start menu shortcut starts the app outside any job", false, "no Kolux RS.lnk in the user or common Start menu");
  else {
    const ex = spawn("explorer.exe", [lnk], { detached: true, stdio: "ignore", windowsHide: true });
    ex.unref();
    const found = await waitFor("kolux-rs.exe from the shortcut", async () => appsRunning()[0] ?? null, 30000, 500).catch(() => null);
    if (!found) check("item5", "the Start menu shortcut starts the app outside any job", false, "no kolux-rs.exe from the install within 30 s");
    else {
      log(`item 5: window: ${await app.moveWindow(found.pid)}`);
      const parent = procName(found.ppid);
      const parentJob = parent === "gone" ? "n/a" : inJob(found.ppid);
      await sleep(8000);
      log(`IsProcessInJob item 5: app pid ${found.pid} ${inJob(found.pid)} (its own APP-053 job; ${jobLine()}); parent ${parent} pid ${found.ppid} ${parentJob}; the explorer.exe this script ran was pid ${ex.pid}`);
      const svcs = mine();
      const svcJobs = svcs.map((s) => [s.pid, inJob(s.pid)]);
      for (const [pid, j] of svcJobs) log(`IsProcessInJob item 5: terminal service pid ${pid} ${j}`);
      log(`item 5 ${mask(configLine())}`);
      check("item5", "the shortcut started kolux-rs.exe under the desktop's Explorer, outside this script's job", parent.toLowerCase() === "explorer" && found.ppid !== ex.pid && parentJob === "False" && svcJobs.length >= 1 && svcJobs.every(([, j]) => j === "False"), `parent ${parent} ${found.ppid} in a job ${parentJob}; services ${JSON.stringify(svcJobs)}`);
      log(`item 5 close: ${await closeNoCdp(found.pid)}`);
    }
  }
  const all = Object.values(results).flat();
  code = !voided && all.length && all.every(Boolean) ? 0 : 1;
} catch (e) {
  if (e !== null) log(`ERROR ${mask(e.stack ?? String(e))}`);
}

// Cleanup: this run's app, the installed build's terminal services, and both data folders renamed away.
if (!DRY) {
  try {
    for (const p of appsRunning()) log(`cleanup: app pid ${p.pid}: ${await closeNoCdp(p.pid)}`);
    const left = mine();
    for (const s of left) ps(`Stop-Process -Id ${s.pid} -Force -ErrorAction SilentlyContinue`);
    log(`cleanup: ended ${left.length} terminal service(s) tied to the install: ${JSON.stringify(left.map((s) => s.pid))}; still running: ${mine().length}`);
    await sleep(3000);
    for (const p of DATA) {
      if (!existsSync(p)) continue;
      const to = `${p}.t544-prove-${STAMP}`;
      let done = false;
      for (let i = 0; i < 15 && !done; i++) {
        try {
          renameSync(p, to);
          done = true;
        } catch (e) {
          if (i === 14) log(`cleanup: could not rename ${p}: ${e.message}`);
          else await sleep(1000);
        }
      }
      if (done) log(`cleanup: renamed ${p} -> ${to}`);
    }
  } catch (e) {
    log(`cleanup error ${mask(e.message)}`);
  }
}
if (voided) log(`VOID: ${voided}`);
for (const [item, r] of Object.entries(results)) log(`ITEM-RESULT ${item} ${r.every(Boolean) ? "PASS" : "FAIL"}`);
log(`RESULT: ${DRY ? "DRY" : voided ? "VOID" : code === 0 ? "PASS" : "FAIL"}`);
const head = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "?"; } })();
const text = ev.join("\n");
writeFileSync(`${LIVE_LOGS}/T-544${DRY ? "-dry" : ""}.out.txt`, `${text}\n`);
if (!DRY) {
  mkdirSync(join(ROOT, "evidence"), { recursive: true });
  writeFileSync(join(ROOT, "evidence", "T-544.txt"), `T-544 live proof of the installed build (items 2-5, APP-052 b1/b2)\ninstalled build: ${process.env.T544_INSTALLER_SHA ?? "(installer sha not given)"} (per-user NSIS install at %LOCALAPPDATA%\\Kolux RS)\nprover: node scripts/prove/live-T-544.mjs (lane head ${head}), slot t544 held; app started through WMI Win32_Process.Create with the Explorer environment; CDP ${CDP}\nscreenshots: ${LIVE_LOGS}\n\n${text}\n`);
}
process.exit(code);
