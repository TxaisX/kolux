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

/**
 * opts: root (checkout), port (vite), cdp (debugging port), identifier, temp (scratch root), suffix (the identifier must
 * end with it before a launch wipes the profile), offscreen, attach, keep, buildMinutes, log.
 */
export function createApp(opts) {
  const { root, port: PORT, cdp: CDP, identifier: IDENTIFIER, temp: TEMP, suffix = ".smoke", offscreen: OFFSCREEN = false, attach: ATTACH = false, keep: KEEP = false, buildMinutes = 20, log = console.log } = opts;
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
  const appEnv = () => ({ ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`, CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: userHome, HOME: userHome, APPDATA: roaming, LOCALAPPDATA: local, CARGO_HOME: process.env.CARGO_HOME ?? join(realHome, ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(realHome, ".rustup") });

  // T-560: the config the app is started with. It never carries window entries, because tauri dev compiles this
  // config into the debug exe; --offscreen moves the window at run time.
  app.config = () => ({ identifier: IDENTIFIER, build: { devUrl: `http://localhost:${PORT}`, beforeDevCommand: `pnpm exec vite --port ${PORT} --strictPort` } });
  app.pageUp = pageUp;
  app.moveWindow = moveWindow;

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
