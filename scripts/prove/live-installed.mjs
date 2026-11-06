// Live proofs against the INSTALLED Kolux build (not a dev copy).
//
// The cloud builders could not do the last mile: every remaining P0 card needs a run on a real
// Windows PC. This harness runs the installed exe under a throwaway home (so a "fresh install"
// profile is real without uninstalling anything) and drives its own WebView2 over the debugging
// port. Nothing here goes through the shared keyboard, so it works while another window is in
// front. It never reads a credential file.
//
//   node scripts/prove/live-installed.mjs probe            dump the first screen's structure
//   node scripts/prove/live-installed.mjs <check> [args]   run one named check
//
// PROVE_HOME=keep reuses the same scratch home between runs; default wipes it (a fresh install).
// PROVE_REAL=1 runs the installed app on the real profile instead (asks first if it is running).
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// True when this file is run as a script (`node scripts/prove/live-installed.mjs start`), false when
// a check imports `attach`/`sleep` from it. Without this every command below is skipped on import...
// except that it was never defined, so the whole harness threw ReferenceError before doing anything.
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = Number(process.env.PROVE_CDP || 9333);
const BASE = process.env.PROVE_BASE || 'G:/Temp/live-installed';
const EXE = process.env.PROVE_EXE || join(process.env.LOCALAPPDATA, 'Kolux RS', 'kolux-rs.exe');
const REAL = process.env.PROVE_REAL === '1';
const PIDFILE = join(BASE, 'app.pid');
const CLOSE_REAL = process.env.PROVE_CLOSE_REAL === '1';

export const run = (file, a, opt = {}) =>
  new Promise((resolve, reject) =>
    execFile(file, a, { windowsHide: true, maxBuffer: 1 << 24, ...opt }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }),
    ),
  );

/**
 * True when this process is itself running inside a Kolux terminal.
 *
 * start/stop close every kolux-rs window, so running them from a Kolux terminal kills the app, the
 * terminal service under it, and the proof, taking the caller's own session with it. A proof is
 * started from a plain Windows Terminal or PowerShell window instead, which is why this guard exists
 * rather than a comment.
 *
 * The pane marker is the first and reliable check: every terminal Kolux starts carries KOLUX_APP_DIR
 * in its own environment (terminal.rs, CLI-007), and every child inherits it. That survives the
 * restarts this guard is about, which the parent walk does not: a pane taken back from a previous
 * copy (SESS), or a shell an agent re-parented, has no kolux-rs.exe left in its ancestry. The walk
 * stays as the fallback for an older pane that predates the marker.
 *
 * Only PROVE_REAL=1 needs this guard (see the refusal below): a scratch-home proof runs as a
 * second copy on its own profile and closes nothing of the app that hosts the terminal.
 */
async function insideKoluxTerminal() {
  if (process.platform !== 'win32') return false;
  if (process.env.KOLUX_APP_DIR) return true;
  const ps = [
    `$p = ${process.pid}`,
    `for ($i = 0; $i -lt 12; $i++) {`,
    `  $x = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue`,
    `  if (-not $x) { break }`,
    `  if ($x.Name -match '^kolux-rs\\.exe$') { 'yes'; break }`,
    `  $p = $x.ParentProcessId`,
    `  if (-not $p -or $p -eq 0) { break }`,
    `}`,
  ].join('; ');
  try {
    const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    return r.stdout.trim().endsWith('yes');
  } catch {
    return false; // a check that cannot tell must not block a legitimate run
  }
}

export async function waitFor(what, probe, ms = 20000, every = 250) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await probe();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
    await sleep(every);
  }
}

/** The scratch home shape a fresh Windows user has; the app needs AppData to exist. */
export function prepareHome(fresh = true) {
  const home = join(BASE, 'home');
  if (fresh && !REAL) {
    for (const d of [home, join(home, 'AppData', 'Roaming'), join(home, 'AppData', 'Local')]) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
  }
  const paths = {
    home,
    roaming: join(home, 'AppData', 'Roaming'),
    local: join(home, 'AppData', 'Local'),
    temp: join(BASE, 'tmp'),
    claude: join(BASE, 'tmp', 'claude-config'),
    codex: join(BASE, 'tmp', 'codex-home'),
    profile: join(home, 'AppData', 'Roaming', 'com.txaisxiong.kolux-rs'),
  };
  for (const d of [paths.home, paths.roaming, paths.local, paths.temp, paths.claude, paths.codex]) mkdirSync(d, { recursive: true });
  mkdirSync(join(BASE, 'shots'), { recursive: true });
  return paths;
}

export function launch(paths, { keep = false } = {}) {
  if (!existsSync(EXE)) throw new Error(`installed exe not found: ${EXE}`);
  const env = {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    TEMP: paths.temp,
    TMP: paths.temp,
  };
  if (!REAL) Object.assign(env, {
    USERPROFILE: paths.home,
    HOME: paths.home,
    APPDATA: paths.roaming,
    LOCALAPPDATA: paths.local,
    CLAUDE_CONFIG_DIR: paths.claude,
    CODEX_HOME: paths.codex,
  });
  for (const k of ['KOLUX_TERMINAL_SERVICE', 'KOLUX_DEV_REPO_ROOT', 'KOLUX_CLI_COMMAND', 'KOLUX_RELEASE_CHECKOUT', 'KOLUX_APP_DIR', 'KOLUX_USER_DATA_PATH', 'CARGO_TARGET_DIR']) delete env[k];
  const child = spawn(EXE, [], { env, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child.pid;
}

export async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

export async function attach(match = 'Kolux') {
  const ts = await waitFor('the app page over CDP', async () => {
    const list = await targets();
    return list.find((t) => t.type === 'page' && (t.title.includes(match) || t.url.includes('tauri.localhost'))) ?? null;
  }, 60000);
  const ws = new WebSocket(ts.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const page = {
    send,
    close: () => ws.close(),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
      return r.result?.result?.value;
    },
    async text(sel) { return page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e?e.innerText:null})()`); },
    async count(sel) { return page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`); },
    async exists(sel) { return page.eval(`!!document.querySelector(${JSON.stringify(sel)})`); },
    async click(sel) {
      const at = await page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.offsetParent!==null); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];})()`);
      if (!at) throw new Error('click target missing: ' + sel);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 });
      return at;
    },
    async clickText(text, sel = 'button') {
      return page.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.innerText||'').trim()===${JSON.stringify(text)}); if(!b) return 'missing'; b.click(); return 'clicked';})()`);
    },
    async key(name, mods = 0) {
      const KEYS = {
        Enter: { code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
        Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 },
        Tab: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 },
        Backspace: { code: 'Backspace', key: 'Backspace', windowsVirtualKeyCode: 8 },
        ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 },
        ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 },
      };
      const k = KEYS[name] ?? { code: 'Key' + name.toUpperCase(), key: name, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mods, ...k });
    },
    async type(text) {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
        await sleep(15);
      }
    },
    async shot(name) {
      // The window is transparent, so a raw capture double-exposes whatever is behind it; give it an opaque backdrop.
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 18, g: 19, b: 22, a: 255 } }).catch(() => {});
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const p = join(BASE, 'shots', `${name}.png`);
      if (r.result?.data) writeFileSync(p, Buffer.from(r.result.data, 'base64'));
      return p;
    },
    async invoke(cmd, args = {}) {
      return page.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
    },
  };
  return page;
}

export async function quit(pid) {
  await run('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => {});
  await sleep(1200);
}

/** The page is up when a screen root exists (first-run wizard or the app shell). */
export async function ready(page) {
  return waitFor('the first frame', async () =>
    page.eval(`!!document.querySelector('.topbar, .switcher, .wizard, .onboard, .first-run, main')`), 60000);
}

/** The profile folder this harness runs its copy on: the scratch home, or the real one with PROVE_REAL=1. */
export function profileDir() {
  return REAL
    ? join(process.env.APPDATA ?? '', 'com.txaisxiong.kolux-rs')
    : join(BASE, 'home', 'AppData', 'Roaming', 'com.txaisxiong.kolux-rs');
}

/** The pid of the copy running on this profile, from its own startup file; 0 when none is running. */
function runningPid() {
  try {
    const j = JSON.parse(readFileSync(join(profileDir(), 'cli.json'), 'utf8'));
    return Number(j.pid) || 0;
  } catch {
    return 0;
  }
}

/**
 * The app allows one copy PER PROFILE, so a proof on a scratch home runs beside the real app and
 * only the copy on this profile has to go. That copy is found by the startup file in its own folder
 * (`cli.json`, which carries its pid), with the terminal service's command line as the fallback for
 * a copy whose file is gone. Nothing else on the machine is touched.
 */
export async function closeRunning() {
  const pid = runningPid();
  const dir = profileDir().replace(/'/g, "''");
  const n = await run('powershell', ['-NoProfile', '-Command', `
    $mine = '${dir}'
    $targets = @()${pid ? ` + ${pid}` : ''}
    $svc = @(Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '--terminal-service' -and $_.CommandLine -like "*$mine*" })
    $targets += @($svc | ForEach-Object { $_.ParentProcessId })
    $alive = @($targets | Sort-Object -Unique | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_.ProcessName -eq 'kolux-rs' -and $_.MainWindowHandle -ne 0 })
    foreach ($p in $alive) { $p.CloseMainWindow() | Out-Null }
    $end = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $end -and @($alive | Where-Object { -not $_.HasExited }).Count -gt 0) { Start-Sleep -Milliseconds 300 }
    @($alive | Where-Object { -not $_.HasExited }).Count
  `]).then((r) => Number(r.stdout.trim())).catch(() => -1);
  if (n > 0) throw new Error(`${n} kolux-rs window process(es) still run after a graceful close; use PROVE_KILL=1 to force`);
  if (n === 0) await sleep(1500);
  return n;
}

const cmd = process.argv[2];

// A proof on the real profile (PROVE_REAL=1) cannot run from a terminal the app is hosting: it
// would close the app, its terminal service, the proof and the caller's own session. Say so instead
// of doing it. A scratch-home proof is a second copy on its own profile and is safe from inside.
if (isMain && (cmd === 'start' || cmd === 'stop') && REAL && (await insideKoluxTerminal())) {
  console.error(
    'refusing: PROVE_REAL=1 closes the app on your real profile, and this process is running\n' +
      'inside a Kolux terminal, so it would end the session running the proof. Run it from a plain\n' +
      'Windows Terminal or PowerShell window instead, or drop PROVE_REAL=1 to use a scratch profile.',
  );
  process.exit(2);
}
if (isMain && cmd === 'start') {
  const fresh = process.env.PROVE_HOME !== 'keep';
  const paths = prepareHome(fresh);
  if (process.env.PROVE_KILL === '1') await run('taskkill', ['/IM', 'kolux-rs.exe', '/T', '/F']).catch(() => {});
  await closeRunning();
  const pid = launch(paths);
  writeFileSync(PIDFILE, String(pid));
  console.log(`launched ${EXE} pid ${pid} (home ${REAL ? 'real profile' : paths.home})`);
  const page = await attach();
  await ready(page);
  await sleep(1200);
  console.log('ready');
  page.close();
  process.exit(0);
}
if (isMain && cmd === 'stop') {
  await closeRunning();
  console.log('closed');
  process.exit(0);
}
if (isMain && cmd === 'probe') {
  const pid = Number(readFileSync(PIDFILE, 'utf8'));
  const page = await attach();
  await sleep(800);
  const dump = await page.eval(`(()=>{
    const cls = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
    const rootKids = [...document.body.children].map(e => e.tagName.toLowerCase() + cls(e)).slice(0, 20);
    const buttons = [...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,40);
    const inputs = [...document.querySelectorAll('input,textarea')].filter(i=>i.offsetParent!==null).map(i=>i.placeholder||i.getAttribute('aria-label')||i.type).slice(0,20);
    return { title: document.title, url: location.href, rootKids, buttons, inputs, bodyLen: document.body.innerHTML.length };
  })()`);
  console.log(JSON.stringify(dump, null, 2));
  console.log('shot', await page.shot('probe-' + Date.now()));
  page.close();
  process.exit(0);
}
if (isMain && cmd === 'js') {
  const page = await attach();
  const out = await page.eval(process.argv[3]);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  page.close();
  process.exit(0);
}
if (isMain && cmd === 'do') {
  // A short scripted action against the running instance: key/click/type/text/shot/wait.
  const page = await attach();
  const action = process.argv[3];
  const arg = process.argv[4];
  if (action === 'key') await page.key(arg, Number(process.argv[5] ?? 0));
  else if (action === 'click') await page.click(arg);
  else if (action === 'clickText') await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()===${JSON.stringify(arg)}); if(b) b.click(); return !!b})()`);
  else if (action === 'text') console.log(await page.text(arg));
  else if (action === 'shot') console.log(await page.shot(arg || 'do-' + Date.now()));
  else if (action === 'wait') await sleep(Number(arg || 1000));
  else throw new Error('unknown do action ' + action);
  await sleep(350);
  console.log('ok', action, arg ?? '');
  page.close();
  process.exit(0);
}
if (isMain && cmd) {
  console.log('commands: start | stop | probe | js "<expr>" | do key|click|text|shot|wait <arg>');
  process.exit(2);
}
