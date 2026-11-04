// The one launcher both `pnpm smoke` (scripts/evidence/smoke.mjs) and the stress runner (scripts/stress/run.mjs)
// use: scratch homes, `pnpm tauri dev` with its own identifier, the page over the WebView2 debugging port
// (driven through scripts/evidence/cdp.mjs as a child), the app's process tree, graceful close and relaunch.
// Moved out of smoke.mjs unchanged in behaviour; nothing here knows a smoke flow or a stress scenario.
//
//   const app = createApp({ root, port, cdp, identifier, temp, suffix: ".smoke" });
//   await app.launch({ prepare });   // prepare() wipes and seeds the profile before the app starts
//   app.pid, app.exePath             // set by launch() / relaunch()
//   await app.closeApp()             // graceful close, orphan scan, cleanup; returns [ok, note] or null
import { spawn, execFile } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const run = (file, a, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, a, { windowsHide: true, maxBuffer: 1 << 24, ...options }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
export const ps = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]).then((r) => r.stdout.trim());

export async function waitFor(what, probe, ms = 15000, every = 250) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await probe();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
    await sleep(every);
  }
}

export const byName = (list) => {
  const m = new Map();
  for (const t of list) m.set(t.name, (m.get(t.name) ?? 0) + 1);
  return [...m].map(([n, c]) => `${n} x${c}`).join(", ") || "none";
};
export const killAll = async (list) => {
  for (const t of list) await run("taskkill", ["/PID", String(t.pid), "/F"]).catch(() => {});
};
export const alive = async (pid) => (await ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`)) === "alive";

// Second-screen rule: dev windows go to the screen at X=-1920 when it is there. Council FIX-1 (FIX-SOON 2):
// --offscreen moves the window at run time to -32000,-32000 (0x0015 = keep size, keep z-order, do not
// activate), on any number of screens, so nothing about the window is compiled into the debug exe.
const OFFSCREEN_AT = [-32000, -32000];
export const moveScript = (pid, offscreen) => {
  const [x, y, flags, screens] = offscreen ? [...OFFSCREEN_AT, "0x0015", ""] : [-1920, 0, "0x0005", "if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'one screen'; exit }"];
  return `Add-Type -AssemblyName System.Windows.Forms; ${screens}
     Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U
     $h = [IntPtr]::Zero; for ($i = 0; $i -lt 20 -and $h -eq [IntPtr]::Zero; $i++) { $h = (Get-Process -Id ${pid}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 } }
     if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [U.W]::SetWindowPos($h,[IntPtr]::Zero,${x},${y},0,0,${flags}) | Out-Null; '${offscreen ? "moved off-screen" : "moved"}' }`;
};

/** T-763 (DT-C199): backend commands the IPC guard answers with a stand-in "ok" instead of running. Each one reaches
 *  outside the scratch profile: opens a browser, an editor, a folder or a system page; restarts or updates the
 *  app or switches its graphics; installs CLIs or registers them with the system; or reads or writes the user's
 *  keymap (a dev run reaches the real home, T-761; appEnv also points KOLUX_KEYBINDINGS_HOME at the scratch home).
 *  Exact names only: the app registers no opener, shell or process plugin. */
export const IPC_BLOCK = new RegExp(
  "^(?:" +
    ["open_external", "open_install_page", "open_notification_settings", "open_in", "open_path", "editor_open", "scm_open_pr", "scm_open_with",
     "scm_reveal", "skills_reveal", "session_reveal", "browser_download_reveal", "app_restart", "update_restart", "update_download",
     "graphics_restart_safe", "graphics_choose", "keybindings_(?:show|write|reload)", "cli_(?:un)?register", "agents_install(?:_many)?", "agent_install"].join("|") +
    ")$",
);
/** The guard's page side: wraps window.fetch (once per page; arming again reuses the original), logs backend calls in
 *  window.__v10calls, answers IPC_BLOCK commands with a stand-in "ok", and sets window.__v10blind when a backend
 *  fetch fails (Tauri then switches to postMessage and the wrapper sees nothing). Evaluates to true.
 *  Tested in app-launch.test.mjs. */
export const IPC_GUARD_JS = `(() => {
  window.__v10calls = [];
  window.__v10blind = false;
  const BLOCK = new RegExp(${JSON.stringify(IPC_BLOCK.source)});
  const orig = (window.__v10orig ??= window.fetch.bind(window));
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const m = /^(?:https?:\\/\\/ipc\\.localhost|ipc:\\/\\/localhost)\\/([^?#]+)/.exec(url);
    if (!m) return orig(input, init);
    const cmd = decodeURIComponent(m[1]);
    if (!/^plugin:(event|log)\\|/.test(cmd)) {
      const blocked = BLOCK.test(cmd);
      window.__v10calls.push(cmd + (blocked ? " " + String(init?.body ?? "").slice(0, 120) + " [BLOCKED]" : ""));
      if (window.__v10calls.length > 400) window.__v10calls.shift();
      if (blocked) return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
    }
    return orig(input, init).catch((e) => { window.__v10blind = true; throw e; });
  };
  return true;
})()`;
/** The guard check's page side: sends one call with no command behind it (name) and is true only when the guard
 *  logged it and no backend fetch has failed. Takes the probe back out of the log; gives up after 3 s. */
export const guardProbeJs = (name) => `(async () => {
  const p = Promise.resolve().then(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)})).catch(() => null);
  await Promise.race([p, new Promise((r) => setTimeout(r, 3000))]);
  const l = window.__v10calls, i = l ? l.indexOf(${JSON.stringify(name)}) : -1;
  if (i >= 0) l.splice(i, 1);
  return i >= 0 && window.__v10blind === false;
})()`;

/** T-763 (DT-C199): what a run's IPC guard can vouch for, row by row. Every row check records a row here (see
 *  guardRow); a good check covers every row recorded before it, so a row that a check followed is trusted and a
 *  row recorded before a failed check is NOT-TESTED. `blind` stays set once a failure covers a row, so a run that
 *  lost the guard can never report PASS; a failure that touched no row (a launch-time check a reload put right) is
 *  forgotten, because no evidence depended on it. */
export function createGuardTrack() {
  const t = { blind: false, where: null, rows: 0, verified: 0, blindFrom: Infinity };
  /** A check passed: every row so far is covered, and a failure that touched no row is forgotten. */
  t.good = () => {
    t.verified = t.rows;
    if (t.blind && t.blindFrom >= t.rows) {
      t.blind = false;
      t.where = null;
      t.blindFrom = Infinity;
    }
  };
  /** A check failed: rows from `atRow` on (default: the first row no good check covered) are not trusted. */
  t.noteBlind = (where, atRow = t.verified) => {
    if (t.blind) {
      if (atRow < t.blindFrom) t.blindFrom = atRow;
      return;
    }
    t.blind = true;
    t.where = where ?? "unknown";
    t.blindFrom = atRow;
  };
  t.row = () => t.rows++;
  t.rowBlind = (i) => t.blind && i >= t.blindFrom;
  return t;
}

/** The word a row or a whole run gets: a failing row keeps FAIL, a row the guard may have missed is NOT-TESTED. */
export const rowWord = (ok, blind) => (!ok ? "FAIL" : blind ? "NOT-TESTED" : "PASS");
export const runWord = (ok, blind) => (blind ? "NOT-TESTED" : ok ? "PASS" : "FAIL");

// One live proof drives one app per process, so the shared checker finds its tracker without every script passing it.
let oneGuard = null;
export const currentGuard = () => oneGuard;

/** One row check: records the row with the run's guard, so a row the guard went blind on is never counted as PASS. */
export const guardRow = (pass, guard = oneGuard) => {
  if (!guard) return { word: rowWord(!!pass, false), row: -1 };
  const row = guard.row();
  return { word: rowWord(!!pass, guard.rowBlind(row)), row };
};

/** T-763: the evidence body and the verdict a run ends with. When the guard went blind, PASS rows become NOT-TESTED
 *  (per row when every row was recorded, all PASS rows otherwise, because the switch is not timestamped), FAIL rows
 *  stay FAIL, the reason is named, and the exit code is not 0. */
export function guardReport({ lines, ok, guard, close }) {
  const blind = !!guard?.blind;
  const rowLines = lines.filter((l) => /^(PASS|FAIL|NOT-TESTED) /.test(l)).length;
  const perRow = !!guard && guard.rows === rowLines;
  let i = 0;
  const rows = lines.map((line) => {
    const m = /^(PASS|FAIL|NOT-TESTED) ([\s\S]*)$/.exec(line);
    if (!m) return line;
    const word = m[1];
    const blindHere = word !== "FAIL" && (word === "NOT-TESTED" || (blind && (perRow ? guard.rowBlind(i) : true)));
    i++;
    return `${word === "FAIL" ? "FAIL" : blindHere ? "NOT-TESTED" : "PASS"} ${m[2]}`;
  });
  const verdict = runWord(ok, blind);
  const tail = [
    ...(close === undefined ? [] : [`close: ${JSON.stringify(close)}`]),
    ...(blind ? [`guard: ${verdict} — the IPC guard was blind (${guard.where}); rows that read backend calls are not tested`] : []),
    `RESULT: ${verdict}`,
  ];
  return { lines: rows, verdict, code: verdict === "PASS" ? 0 : 1, text: [...rows, ...tail].join("\n"), tail };
}

/**
 * opts: root (checkout), port (vite), cdp (debugging port), identifier, temp (scratch root), suffix (the identifier must
 * end with it before a launch wipes the profile), offscreen, attach, keep, buildMinutes, log, ipcGuard (arm the IPC
 * guard below after every launch and relaunch, and refuse to go on without it), afterReload (async (app) => …, run
 * after the guard's own page reload, e.g. to close first-run dialogs).
 */
export function createApp(opts) {
  const { root, port: PORT, cdp: CDP, identifier: IDENTIFIER, temp: TEMP, suffix = ".smoke", offscreen: OFFSCREEN = false, attach: ATTACH = false, keep: KEEP = false, buildMinutes = 20, log = console.log, ipcGuard: IPC_GUARD = false, afterReload } = opts;
  const cdpScript = join(root, "scripts", "evidence", "cdp.mjs");
  // T-152-c (5): the app's own temp folder (TEMP/TMP) holds the scratch agent config folders but not
  // the scratch home below: a debug build refuses a temp folder that holds the home as scratch.
  const appTemp = join(TEMP, "tmp");
  const claudeConfig = join(appTemp, "claude-config");
  const codexHome = join(appTemp, "codex-home");
  // T-152-c (2): the app keeps its hook scripts, status line slot and backup record under the user's home
  // (USERPROFILE on Windows, HOME elsewhere), so a run gets a scratch home and never writes the real one.
  const userHome = join(TEMP, "home");
  const realHome = homedir();
  // Windows finds AppData from the home too, and the app will not start when that folder is missing.
  const roaming = join(userHome, "AppData", "Roaming");
  const local = join(userHome, "AppData", "Local");
  const profile = ATTACH ? join(process.env.APPDATA ?? "", IDENTIFIER) : join(roaming, IDENTIFIER);
  const paths = { appTemp, claudeConfig, codexHome, userHome, roaming, local, profile, settings: join(profile, "settings.json") };

  // cdp.mjs as a child: every call is one connection to the page, which keeps this file free of protocol code.
  // app.cdpTimeoutMs (0 = none, smoke's way) ends a cdp.mjs child that never answers, e.g. when the page's main thread is flooded.
  const cdp = async (...a) => (await run(process.execPath, [cdpScript, "main", ...a], { env: { ...process.env, CDP_PORT: String(CDP) }, ...(app.cdpTimeoutMs ? { timeout: app.cdpTimeoutMs } : {}) })).stdout.trim();
  const evalJs = async (expr) => {
    const out = await cdp("eval", expr);
    let v;
    try {
      v = JSON.parse(out);
    } catch {
      throw new Error(`eval gave no JSON: ${out.slice(0, 200)}`);
    }
    if (v && typeof v === "object" && v.exceptionDetails) throw new Error(`page threw: ${v.exceptionDetails.exception?.description ?? v.exceptionDetails.text}`);
    return v;
  };
  const invoke = (cmd, params = {}) => evalJs(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(params)}).then(v => v === undefined ? null : v)`);
  const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const exists = async (sel) => (await count(sel)) > 0;
  // Panes outside the grid (a tab behind another) have no offsetParent; only the ones a user sees count.
  const shown = (sel) => evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null).length`);
  const click = async (sel) => {
    const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.click(); return "clicked"; })()`);
    if (r !== "clicked") throw new Error(`nothing to click at ${sel}`);
  };
  // Matches the element's own text, or its .name child when it has one (menu items also carry a shortcut).
  const clickWhere = async (sel, textRe) => {
    const r = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${textRe}.test((x.querySelector(".name") ?? x).textContent || "")); if (!e) return "missing"; e.click(); return "clicked"; })()`);
    if (r !== "clicked") throw new Error(`no ${sel} whose text matches ${textRe}`);
  };
  const focusField = async (sel) => {
    const r = await cdp("focus", sel);
    if (r !== "focused") throw new Error(`could not focus ${sel}: ${r}`);
  };
  // The n-th shown pane takes the focus the way a click would (App.tsx listens for mousedown), then its text field.
  // T-545: a pane makes its input field in its mount effect, so poll for the field up to 10 s; the pane itself is never waited for.
  const focusPane = async (paneSel, index, fieldSel) => {
    const started = Date.now();
    let r, polls = 0;
    for (;;) {
      r = await evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(paneSel)})].filter(e => e.offsetParent !== null)[${index}]; if (!p) return "missing pane"; p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); const f = p.querySelector(${JSON.stringify(fieldSel)}); if (!f) return "missing field"; f.focus(); return document.activeElement === f ? "focused" : "not-focused"; })()`);
      if (r !== "missing field") break;
      if (Date.now() - started > 10000) throw new Error(`${paneSel} #${index}: missing field after ${Date.now() - started} ms`);
      polls++;
      await sleep(100);
    }
    if (polls > 0) console.log(`focusPane ${paneSel} #${index}: field after ${Date.now() - started} ms`);
    if (r !== "focused") throw new Error(`${paneSel} #${index}: ${r}`);
  };

  // ---------- processes: the app's descendant tree, survivors, graceful close ----------
  // Every process under `pid` by Win32_Process ParentProcessId, with its name, thread count and creation time
  // (a child created before its parent is a reused pid, not a child).
  async function treeOf(pid) {
    const out = await ps(
      `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ThreadCount,CreationDate
       $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
       $want = @([int]${pid}); $i = 0; $out = @()
       while ($i -lt $want.Count) { $p = $want[$i]; $i++; $pc = $byId[$p]
         foreach ($c in $all) { if ($c.ParentProcessId -eq $p -and $want -notcontains [int]$c.ProcessId -and ($null -eq $pc -or $null -eq $pc.CreationDate -or $null -eq $c.CreationDate -or $c.CreationDate -ge $pc.CreationDate)) { $want += [int]$c.ProcessId; $out += $c } } }
       $out | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.ThreadCount)|$($_.CreationDate)" }`,
    );
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [pid, name, ppid, threads, created] = l.split("|");
        return { pid: Number(pid), name, ppid: Number(ppid), threads: Number(threads), created };
      });
  }
  // The entries of `tree` that are still the same processes (pid, name and creation time all match).
  async function survivorsOf(tree) {
    if (tree.length === 0) return [];
    const ids = tree.map((t) => t.pid).join(",");
    const out = await ps(`Get-CimInstance Win32_Process | Where-Object { @(${ids}) -contains [int]$_.ProcessId } | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.CreationDate)" }`);
    const live = new Set(out.split(/\r?\n/).filter(Boolean));
    return tree.filter((t) => live.has(`${t.pid}|${t.name}|${t.created}`));
  }
  // T-552: a relaunch starts only once every process of the old tree has exited.
  const treeGone = (tree) => waitFor("the old process tree to exit", async () => (await survivorsOf(tree)).length === 0, 15000, 250);
  // The app's own quit path: a window close request over CDP (what the X button sends). WM_CLOSE by PostMessage
  // when the page cannot be reached. Never taskkill.
  async function gracefulClose(pid) {
    const t0 = Date.now();
    let how = "window close over CDP";
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      how = "WM_CLOSE by PostMessage (the page did not answer)";
      await ps(
        `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);' -Name M -Namespace U
         [U.M]::PostMessage((Get-Process -Id ${pid}).MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`,
      ).catch(() => {});
    }
    const gone = await waitFor("the app to exit", async () => !(await alive(pid)), 30000, 500).catch(() => false);
    if (!gone) throw new Error(`the app (pid ${pid}) did not exit within 30 s of a ${how}`);
    await sleep(2000); // children that are on their way out get a moment before they count as survivors
    return `${how}, exited in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  }
  // Capture, close, count: what smoke flow 5 and the final close share.
  async function closeAndCount(pid) {
    const tree = await treeOf(pid);
    const how = await gracefulClose(pid);
    const survivors = await survivorsOf(tree);
    return { tree, how, survivors };
  }

  // ---------- the app: launch, relaunch or attach ----------
  const app = {
    cdpTimeoutMs: 0,
    pid: null,
    exePath: null, // the built kolux-rs.exe inside this checkout, learned from the first launch
    dev: null, // the `pnpm tauri dev` child in launch mode
    vite: null, // a vite started here for a relaunch, when tauri dev took its own down
    paths,
    run, ps, sleep, waitFor, cdp, evalJs, invoke, count, exists, shown, click, clickWhere, focusField, focusPane,
    treeOf, survivorsOf, treeGone, gracefulClose, closeAndCount, byName, killAll, alive,
  };

  async function pageUp(ms) {
    await waitFor(
      "the app page over CDP",
      async () => {
        const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
        return targets.some((t) => t.type === "page" && new RegExp(`localhost:${PORT}|tauri\\.localhost`).test(t.url));
      },
      ms,
      2000,
    );
    await waitFor("the sidebar", () => exists("aside.sidebar"), 60000, 1000);
  }
  const moveWindow = (pid) => ps(moveScript(pid, OFFSCREEN));
  const appEnv = () => ({ ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`, CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: userHome, HOME: userHome, KOLUX_KEYBINDINGS_HOME: userHome, APPDATA: roaming, LOCALAPPDATA: local, CARGO_HOME: process.env.CARGO_HOME ?? join(realHome, ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(realHome, ".rustup") });

  // T-560: the config the app is started with. It never carries window entries, because tauri dev compiles this
  // config into the debug exe; --offscreen moves the window at run time.
  app.config = () => ({ identifier: IDENTIFIER, build: { devUrl: `http://localhost:${PORT}`, beforeDevCommand: `pnpm exec vite --port ${PORT} --strictPort` } });
  app.pageUp = pageUp;
  app.moveWindow = moveWindow;

  // ---------- T-763 (DT-C199): the IPC guard ----------
  // A fetch wrapper logs every backend call in window.__v10calls and answers IPC_BLOCK commands itself. Tauri sends
  // calls by fetch to ipc.localhost, but after one failed fetch it switches to postMessage for good, and from then
  // on the wrapper sees nothing: blocked commands run for real and stand-ins see no calls. So the guard is probed
  // with a call that has no command behind it (v8_probe_N): seen in the log and no failed fetch = still armed.
  // A reload puts fetch back. The app's own calls before the first arm (boot) are not guarded: the keymap they
  // could write is the scratch one (KOLUX_KEYBINDINGS_HOME in appEnv).
  let probes = 0;
  app.guard = createGuardTrack();
  oneGuard = app.guard;
  /** A probe only: true while backend calls still pass through the guard. Its callers record the result in app.guard. */
  app.guardOk = async () => (await evalJs(guardProbeJs(`v8_probe_${++probes}`)).catch(() => false)) === true;
  const wrap = async () => (await evalJs(IPC_GUARD_JS).catch(() => false)) === true;
  /** Arms the page and records the result with the run's guard track. */
  app.armGuard = async () => {
    if ((await wrap()) && (await app.guardOk())) {
      app.guard.good();
      return true;
    }
    app.guard.noteBlind("arming the guard");
    return false;
  };
  /** Reload the page so Tauri's IPC goes back to fetch, arm again before anything else, then run opts.afterReload
   *  (e.g. close first-run dialogs) under the guard. A reload drops page-side state (startProve's
   *  window.__proveEvents listener included): a harness that rearms mid-run sets it up again. */
  app.rearm = async () => {
    await evalJs(`setTimeout(() => location.reload(), 0), null`).catch(() => {});
    await sleep(1500);
    await pageUp(90_000);
    if (!(await wrap())) {
      app.guard.noteBlind("rearming the guard");
      return false;
    }
    await afterReload?.(app);
    if (!(await app.guardOk())) {
      app.guard.noteBlind("rearming the guard");
      return false;
    }
    app.guard.good();
    return true;
  };
  /** Runs fn(), one row of a harness, between two guard checks. blind "before": the guard was lost and a rearm
   *  failed, so fn did not run; blind "after": the guard went blind during fn, so what fn saw of the backend can't
   *  be trusted. Either way the row is recorded with app.guard, which the report counts as NOT-TESTED. */
  app.guarded = async (fn) => {
    const row = app.guard.row();
    if (!(await app.guardOk()) && !(await app.rearm())) return { blind: "before", row };
    const value = await fn();
    if (await app.guardOk()) {
      app.guard.good();
      return { value, blind: null, row };
    }
    app.guard.noteBlind("during a row", row);
    return { value, blind: "after", row };
  };
  const armOrThrow = async () => {
    if (!IPC_GUARD) return;
    let armed = false;
    try {
      armed = (await app.armGuard()) || (await app.rearm());
    } catch {
      armed = false; // a rearm that threw is a run without a guard, not a run to leave an app behind for
    }
    if (!armed) {
      // The caller has no app handle yet when this throws (startProve's catch only stops a ctx), so close it here.
      await app.closeApp().catch(() => {});
      throw new Error("the IPC guard is not effective; refusing to drive an app that could open a browser, an editor, restart, or write the real keymap");
    }
    log(`ipc guard armed (blocks ${IPC_BLOCK.source})`);
  };

  // prepare() runs first (wipe and seed the profile); the scratch config folders are made after it.
  app.launch = async ({ prepare } = {}) => {
    if (!IDENTIFIER.endsWith(suffix)) throw new Error(`refusing to wipe the profile of ${IDENTIFIER}: use an identifier ending in "${suffix}" or --attach`);
    await prepare?.();
    mkdirSync(claudeConfig, { recursive: true });
    // T-152-b (2): a dev run writes a Claude settings file only below this scratch marker.
    writeFileSync(join(claudeConfig, ".kolux-rs-scratch"), "");
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(local, { recursive: true });
    const cfg = join(TEMP, "tauri.dev.json");
    writeFileSync(cfg, JSON.stringify(app.config()));
    const logFile = join(TEMP, "tauri-dev.log");
    const out = openSync(logFile, "w");
    // One command string through the shell: pnpm is a .cmd on Windows, which Node will not spawn directly.
    app.dev = spawn(`pnpm tauri dev --config "${cfg}"`, {
      cwd: root,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", out, out],
      env: { ...appEnv(), CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" },
    });
    log(`launching: pnpm tauri dev (identifier ${IDENTIFIER}, vite ${PORT}, CDP ${CDP}; log ${logFile})`);
    await pageUp(buildMinutes * 60_000);
    // The app's pid comes from its executable path inside this checkout, never from a window title.
    const exe = (process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, "src-tauri", "target")).replace(/'/g, "''");
    const found = await waitFor(
      "the app process",
      async () => {
        const line = await ps(`$p = Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${exe}*' } | Select-Object -First 1; if ($p) { "$($p.ProcessId)|$($p.ExecutablePath)" }`);
        return line.includes("|") ? line : null;
      },
      30000,
      1000,
    );
    app.pid = Number(found.split("|")[0]);
    app.exePath = found.split("|")[1];
    log(`app pid ${app.pid} (${app.exePath}); window: ${await moveWindow(app.pid)}`);
    await armOrThrow();
  };

  const viteServing = async () => {
    try {
      return (await fetch(`http://localhost:${PORT}/`)).ok;
    } catch {
      return false;
    }
  };
  // The same profile again: the exe tauri dev built (its devUrl and identifier were compiled in from the
  // --config above), started straight from here so its pid is known at once.
  app.relaunch = async () => {
    if (!app.exePath) throw new Error("no exe path from a first launch: a relaunch needs launch mode");
    if (!(await viteServing())) {
      if (app.vite?.pid) await run("taskkill", ["/PID", String(app.vite.pid), "/T", "/F"]).catch(() => {});
      const out = openSync(join(TEMP, "vite.log"), "a");
      app.vite = spawn(`pnpm exec vite --port ${PORT} --strictPort`, { cwd: root, shell: true, windowsHide: true, stdio: ["ignore", out, out], env: process.env });
      await waitFor(`vite on ${PORT}`, viteServing, 60000, 1000);
    }
    const out = openSync(join(TEMP, "app.log"), "a");
    const child = spawn(app.exePath, [], { cwd: join(root, "src-tauri"), windowsHide: true, stdio: ["ignore", out, out], env: appEnv() });
    child.on("error", (e) => log(`WARN relaunch: ${e.message}`));
    if (!child.pid) throw new Error("the relaunched app has no pid");
    app.pid = child.pid;
    await pageUp(90_000);
    await moveWindow(app.pid);
    await armOrThrow();
  };

  // The orphan scan: survivors of the tree captured before the close, never a taskkill first. The dev tree,
  // a vite started here and the survivors are ended afterwards as cleanup, not as the check.
  // For a run that cannot close the app by its own path (a frozen page): end this run's own app tree, the dev tree and vite.
  app.forceStop = async () => {
    for (const pid of [app.pid, app.dev?.pid, app.vite?.pid]) if (pid) await run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
    app.pid = null;
  };
  app.closeApp = async () => {
    if (ATTACH || KEEP) return null;
    let closeReport = null;
    if (app.pid && (await alive(app.pid))) {
      const { tree, how, survivors } = await closeAndCount(app.pid);
      const ok = survivors.length === 0;
      closeReport = [ok, `${how}; pre-close tree ${tree.length} (${byName(tree)}); survivors ${survivors.length} (${byName(survivors)})`];
      await killAll(survivors);
    }
    app.pid = null;
    if (app.dev?.pid) await run("taskkill", ["/PID", String(app.dev.pid), "/T", "/F"]).catch(() => {});
    if (app.vite?.pid) await run("taskkill", ["/PID", String(app.vite.pid), "/T", "/F"]).catch(() => {});
    // Cleanup only: a shell or stand-in still running from the temp folder that no tree covered. Its names are
    // fixed and this script's own ancestors (the cmd and pnpm chain that ran it carries --temp too) are skipped.
    const left = await ps(
      `$names = @('kolux-rs.exe','powershell.exe','pwsh.exe','cmd.exe','conhost.exe','OpenConsole.exe','ping.exe','curl.exe')
       $all = Get-CimInstance Win32_Process; $mine = @(); $p = $PID; while ($p -and $mine -notcontains $p) { $mine += $p; $p = ($all | Where-Object ProcessId -eq $p).ParentProcessId }
       $all | Where-Object { $names -contains $_.Name -and $_.CommandLine -like '*${TEMP.replace(/'/g, "''")}*' -and $mine -notcontains $_.ProcessId } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
    ).catch(() => "");
    if (left) {
      log(`cleanup: processes still running from the temp folder, ended now:\n${left}`);
      for (const line of left.split(/\r?\n/)) await run("taskkill", ["/PID", line.split(" ")[0], "/F"]).catch(() => {});
    }
    return closeReport;
  };
  return app;
}
