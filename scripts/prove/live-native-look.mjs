// LIVE check (NATIVE-TERMINAL.md, look): a pane drawn by the Windows Terminal engine in the running app, captured in
// the dark and then the light Kolux look, so the engine is seen taking Kolux's colours and following a switch.
//
//   NATIVE_TERMINAL_DLL=<path to Microsoft.Terminal.Control.dll> node scripts/prove/live-native-look.mjs
//
// The engine comes from the NuGet package CI.Microsoft.Terminal.Wpf (version in NATIVE-TERMINAL.md, MIT); it is never
// committed. live-common clears every KOLUX_ variable before the app starts, so the DLL is named here as
// NATIVE_TERMINAL_DLL and handed to the app as KOLUX_TERMINAL_CONTROL_DLL, the variable native_view.rs reads.
//
// The engine draws in its own child window over the pane, which a CDP page screenshot cannot see; the window is
// captured with scripts/evidence/shot.ps1 (PrintWindow, PW_RENDERFULLCONTENT) and the page screenshot is kept beside
// it, so the two show which part the engine drew. NATIVE_ON_SCREEN=1 (a runner with nobody at the screen) first
// moves the window onto the screen at its size and adds a plain screen capture as a second witness.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ps, run, waitAppWindow, WIN_PS } from "../evidence/app-launch.mjs";
import { reporter, startPlain, finish, sleep, waitFor, LIVE_LOGS, ROOT, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
if (process.env.NATIVE_TERMINAL_DLL) process.env.KOLUX_TERMINAL_CONTROL_DLL = process.env.NATIVE_TERMINAL_DLL;

// The look the pane sends with native_term_attach / native_term_place (nativeView.ts), logged over the IPC guard.
const WATCH = `(() => {
  if (window.__nativeWatch) return "already";
  const prev = window.fetch;
  window.__nativeCalls = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const m = /^(?:https?:\\/\\/ipc\\.localhost|ipc:\\/\\/localhost)\\/([^?#]+)/.exec(url);
    const cmd = m ? decodeURIComponent(m[1]) : "";
    const p = prev(input, init);
    if (cmd === "native_term_attach" || cmd === "native_term_place") {
      const asked = typeof init?.body === "string" ? init.body : "";
      if (/"look":\\{/.test(asked)) p.then((r) => r.clone().text()).then((answer) => window.__nativeCalls.push({ cmd, asked: asked.slice(0, 600), answer: answer.slice(0, 80) }), () => {});
    }
    return p;
  };
  window.__nativeWatch = true;
  return "watching";
})()`;

/** The first shown pane: is its body drawn by the engine (data-native, nativeView.ts) and is xterm's screen out of the page? */
const PANE = `(() => {
  const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find((e) => e.offsetParent !== null);
  if (!p) return null;
  const body = p.querySelector("[data-native]");
  let host = null;
  for (const d of p.querySelectorAll("div")) if (d.__koluxTerm) { host = d; break; }
  const el = host?.__koluxTerm?.element;
  return { native: body?.dataset.native ?? null, xtermHidden: el ? getComputedStyle(el).display === "none" : null, mode: document.documentElement.dataset.mode ?? null };
})()`;

/** Types a line into the first shown pane through xterm's own input path (its screen is out of the page, so it has no focus to type into). */
const typeLine = (line) => `(() => {
  const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find((e) => e.offsetParent !== null);
  for (const d of p?.querySelectorAll("div") ?? []) if (d.__koluxTerm) { d.__koluxTerm.input(${JSON.stringify(`${line}\r`)}, true); return "typed"; }
  return "no xterm";
})()`;

const SHOT = join(ROOT, "scripts", "evidence", "shot.ps1");
async function capture(name, pid) {
  const out = `${LIVE_LOGS}/${name}.png`;
  const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SHOT, "-Out", out, "-ProcessId", String(pid)]).catch((e) => ({ stdout: `shot.ps1 failed: ${e.message}` }));
  log(`${name}: ${r.stdout.trim()}`);
  return out;
}
/** The whole primary screen, when the window is on it (NATIVE_ON_SCREEN=1). */
async function screen(name) {
  const out = `${LIVE_LOGS}/${name}.png`.replace(/'/g, "''");
  const r = await ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $g.Dispose()
    $bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); "saved $($b.Width) x $($b.Height)"`).catch((e) => `screen capture failed: ${e.message}`);
  log(`${name}: ${r}`);
}
/** Puts the window on the primary screen at the screen's size, in front. */
const onScreen = (pid) =>
  ps(`Add-Type -AssemblyName System.Windows.Forms
    Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -Name W -Namespace U
    ${WIN_PS}
    ${waitAppWindow(pid)}
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [U.W]::SetWindowPos($h, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0040) | Out-Null; [U.W]::SetForegroundWindow($h) | Out-Null; "on screen at $($b.Width) x $($b.Height)" }`);

let ctx;
let ok = false;
try {
  ctx = await startPlain("NATIVE", { report: rep, settings: { terminalNative: true, appearanceMode: "dark" } });
  const { app } = ctx;
  mkdirSync(LIVE_LOGS, { recursive: true });
  log(`watch: ${await app.evalJs(WATCH)}`);
  const engine = await app.evalJs(`window.__TAURI_INTERNALS__.invoke("native_term_available").then((p) => "found: " + p, (e) => "missing: " + e)`);
  check("the app finds the Windows Terminal engine", String(engine).startsWith("found"), String(engine));
  if (process.env.NATIVE_ON_SCREEN === "1") log(`window: ${await onScreen(app.pid)}`);

  // The first pane: a new pane reads the setting at mount, so it is drawn by the engine from the start.
  const drawn = await waitFor("the pane drawn by the engine", async () => ((await app.evalJs(PANE))?.native === "on" ? app.evalJs(PANE) : null), 20000).catch(() => null);
  check("the first pane is drawn by the engine, xterm's screen out of the page", drawn?.native === "on" && drawn?.xtermHidden === true, JSON.stringify(drawn ?? (await app.evalJs(PANE))));
  // Something to look at: a listing and the 16 console colours as backgrounds, which the engine draws from Kolux's table.
  log(`typed: ${await app.evalJs(typeLine("Get-ChildItem; 0..15 | ForEach-Object { Write-Host (' {0,2} ' -f $_) -BackgroundColor $_ -NoNewline }; Write-Host ''"))}`);
  await sleep(4000);

  const lookOf = async () => {
    const calls = (await app.evalJs("window.__nativeCalls ?? []")) ?? [];
    const last = calls[calls.length - 1];
    const bg = /"background":(\d+)/.exec(last?.asked ?? "")?.[1];
    return { count: calls.length, cmd: last?.cmd ?? null, background: bg === undefined ? null : `#${Number(bg).toString(16).padStart(6, "0").replace(/(..)(..)(..)/, "$3$2$1")}` };
  };
  const dark = await app.evalJs(PANE);
  const darkLook = await lookOf();
  log(`dark: ${JSON.stringify(dark)}; look sent ${JSON.stringify(darkLook)}`);
  await capture("NATIVE-dark-window", app.pid);
  await ctx.shot("NATIVE-dark-page");
  if (process.env.NATIVE_ON_SCREEN === "1") await screen("NATIVE-dark-screen");

  // The light look, saved the way the Appearance page saves it; every window then reads the settings and repaints.
  await app.evalJs(`window.__TAURI_INTERNALS__.invoke("settings_patch", { set: { appearanceMode: "light" }, remove: [] }).then(() => "saved", (e) => "failed: " + e)`);
  await waitFor("the light look", async () => (await app.evalJs("document.documentElement.dataset.mode")) === "light", 10000).catch(() => null);
  await sleep(3000);
  const light = await app.evalJs(PANE);
  const lightLook = await lookOf();
  log(`light: ${JSON.stringify(light)}; look sent ${JSON.stringify(lightLook)}`);
  check("the window switched to the light look and the pane is still drawn by the engine", light?.mode === "light" && light?.native === "on", JSON.stringify(light));
  check("the switch sent the engine a new look with another background", lightLook.count > darkLook.count && lightLook.background !== null && lightLook.background !== darkLook.background, `dark ${darkLook.background} (${darkLook.cmd}), light ${lightLook.background} (${lightLook.cmd})`);
  await capture("NATIVE-light-window", app.pid);
  await ctx.shot("NATIVE-light-page");
  if (process.env.NATIVE_ON_SCREEN === "1") await screen("NATIVE-light-screen");
  writeFileSync(`${LIVE_LOGS}/NATIVE-looks.json`, `${JSON.stringify(await app.evalJs("window.__nativeCalls ?? []"), null, 2)}\n`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "NATIVE", ev, ok) : 1);
