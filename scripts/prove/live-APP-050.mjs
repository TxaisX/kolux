// LIVE proof, APP-050 box 2 (spec/19): a stalled profile drive -> the app still exits within the quit deadline.
// The stall is a REAL blocked write: scripts/prove/oplock-hold holds a batch oplock on <profile>/logs/kolux.log and never
// acknowledges the break, so the app's next open of that file (diag::write, which the quit path calls) blocks.
// The app is asked to quit with the window close (what the X button sends); its pid is timed until it is gone.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, reporter, startPlain, finish, sleep, LIVE_LOGS } from "./live-common.mjs";
import { checker } from "./live-views-dom.mjs";

// --control: no holder (baseline quit time). --probe: also open kolux.log from a second process first (this itself triggers the oplock break).
const CONTROL = process.argv.includes("--control");
const PROBE = process.argv.includes("--probe");
// The holder's source is in this repo; build it once instead of pointing at a prebuilt binary outside the repo.
const HOLDER = join(ROOT, "scripts", "prove", "oplock-hold", "target", "release", "oplock-hold.exe");
if (!CONTROL && !existsSync(HOLDER)) {
  execFileSync("cargo", ["build", "--release", "--manifest-path", join(ROOT, "scripts", "prove", "oplock-hold", "Cargo.toml")], { stdio: "inherit", windowsHide: true });
}
const QUIT_DEADLINE_S = 15; // lifecycle::quit_deadline(): max(15 s, 5 s final save + 3 s webview wait + 2 s)
const FINAL_SAVE_S = 5; // final_save::QUIT_DEADLINE
const WATCH_S = CONTROL ? 30 : 75; // how long the exit is waited for before the holder is released

const rep = reporter();
const { log, lines: ev } = rep;
const chk = checker(log);
const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};

let ctx;
let holder;
let ok = false;
try {
  ctx = await startPlain("APP-050", { report: rep, noProject: true });
  const { app } = ctx;
  await sleep(3000);
  const logFile = `${app.paths.profile}/logs/kolux.log`;
  log(`profile logs/kolux.log exists: ${existsSync(logFile)}`);
  const pid = app.pid;
  const tree = await app.treeOf(pid);
  log(`app pid ${pid}; tree before quit: ${app.byName(tree)}`);
  const hout = [];
  if (!CONTROL) {
    // The holder takes the oplock while no app handle is open on the file (diag::write opens, appends and closes).
    holder = spawn(HOLDER, [logFile, "300"], { windowsHide: true });
    holder.stdout.on("data", (d) => hout.push(`${Date.now()} ${String(d).trim()}`));
    const granted = await app.waitFor("the oplock to be granted", () => hout.some((l) => /GRANTED/.test(l)), 10000, 100);
    chk.check("the holder has the oplock on kolux.log", !!granted, hout.join(" / "));
  }
  if (PROBE) {
    // A second open from this script blocks while the oplock stands: proves the stall is real (not fail-fast). It is abandoned at once.
    const probeStart = Date.now();
    const probe = spawn(process.execPath, ["-e", `require("fs").appendFileSync(${JSON.stringify(logFile)}, "")`], { windowsHide: true });
    let probed = false;
    probe.on("exit", () => (probed = true));
    await sleep(2500);
    chk.check("another open of kolux.log blocks (real stall, no error)", !probed, `probe still waiting after ${Date.now() - probeStart} ms`);
    probe.kill();
  }

  const t0 = Date.now();
  let how = "window close over CDP";
  try {
    await Promise.race([app.invoke("plugin:window|close", { label: "main" }), sleep(5000)]);
  } catch (e) {
    how = `window close over CDP (call ended: ${String(e.message).slice(0, 80)})`;
  }
  const end = t0 + WATCH_S * 1000;
  while (!gone(pid) && Date.now() < end) await sleep(250);
  const exitedMs = gone(pid) ? Date.now() - t0 : null;
  log(`${how}; app pid ${pid} ${exitedMs === null ? `STILL RUNNING after ${WATCH_S} s` : `gone after ${(exitedMs / 1000).toFixed(1)} s`}`);
  log(`holder output: ${hout.map((l) => l.replace(/^\d+ /, (m) => `+${((Number(m) - t0) / 1000).toFixed(1)}s `)).join(" / ")}`);
  // Strict reading of the box: gone by the hard deadline itself. The watchdog then waits up to 0.5 s for its log write (lifecycle::WATCHDOG_LOG_WAIT).
  chk.check("the quit is bounded: the app exits within the deadline plus the watchdog's 0.5 s log wait and 1 s of teardown", exitedMs !== null && exitedMs <= (QUIT_DEADLINE_S + 1.5) * 1000, exitedMs === null ? `no exit in ${WATCH_S} s` : `${(exitedMs / 1000).toFixed(1)} s`);
  chk.check(`the app exits within the quit deadline itself (${QUIT_DEADLINE_S} s; final save ${FINAL_SAVE_S} s)`, exitedMs !== null && exitedMs <= QUIT_DEADLINE_S * 1000, exitedMs === null ? `no exit in ${WATCH_S} s` : `${(exitedMs / 1000).toFixed(1)} s`);
  // Release the stall (this script's own holder), let a hung app finish, then read what the log recorded.
  holder?.kill();
  await sleep(1500);
  const releasedAt = Date.now();
  if (exitedMs === null) await app.waitFor("the app to exit once the stall ended", () => gone(pid), 60000, 500).catch(() => {});
  log(`after release: app gone ${gone(pid)}${exitedMs === null ? ` (${((Date.now() - releasedAt) / 1000).toFixed(1)} s after the holder ended)` : ""}`);
  if (existsSync(logFile)) {
    const tail = readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-8).map((l) => l.slice(0, 160));
    log(`kolux.log tail: ${JSON.stringify(tail)}`);
  }
  ok = chk.allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
} finally {
  holder?.kill();
}
writeFileSync(`${LIVE_LOGS}/APP-050${CONTROL ? "-control" : ""}-lines.txt`, ev.join("\n"));
process.exit(ctx ? await finish(ctx, CONTROL ? "APP-050-control" : "APP-050", ev, ok) : 1);
