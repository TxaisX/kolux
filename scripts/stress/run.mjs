// Stress runner: node scripts/stress/run.mjs <S1..S8|S10..S14|all> [--minutes 30 for S8] [--port 1440 --cdp 9260 --temp G:/Temp/stress]
// --release runs the shipped build (pnpm tauri build --no-bundle, built once per run) instead of the debug dev build; --skip-build reuses the release exe already built.
// Each scenario launches the app from this checkout (scripts/evidence/app-launch.mjs: scratch homes, hidden off-screen window,
// own identifier), measures, closes it, clears its scratch folder, prints PASS / FAIL and writes
// evidence/stress-<scenario>-<short sha>.txt with every threshold beside what was measured.
// It measures only; an app fault is recorded, never fixed here. Hold a build slot first (see README.md).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run as sh } from "../evidence/app-launch.mjs";
import { Checks, newApp, removeTemp } from "./lib.mjs";

// The launching shell may be a pane of another Kolux build; none of its KOLUX_* variables may reach the app under test.
const slots = process.env.KOLUX_SLOTS;
for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_")) delete process.env[k];

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const want = (args.find((a) => /^(S(1[0-4]|[1-9])|all)$/i.test(a)) ?? "").toUpperCase();
const opts = { root, port: Number(opt("port", "1440")), cdp: Number(opt("cdp", "9260")), temp: opt("temp", "G:/Temp/stress").replace(/\\/g, "/"), release: args.includes("--release"), skipBuild: args.includes("--skip-build") };

const modules = { S1: "./s1-pane-churn.mjs", S2: "./s2-output-flood.mjs", S3: "./s3-many-projects.mjs", S4: "./s4-corrupt-state.mjs", S5: "./s5-hard-kill.mjs", S6: "./s6-unicode-ansi.mjs", S7: "./s7-editor-big-files.mjs", S8: "./s8-soak.mjs", S10: "./s10-git-load.mjs", S11: "./s11-footprint.mjs", S12: "./s12-everyday.mjs", S13: "./s13-agent-sleep.mjs", S14: "./s14-tab-move.mjs" };
const list = want === "ALL" ? Object.keys(modules) : modules[want] ? [want] : null;
if (!list) {
  console.error("usage: node scripts/stress/run.mjs <S1..S8|S10..S14|all> [--port 1440] [--cdp 9260] [--temp G:/Temp/stress] [--release [--skip-build]]");
  process.exit(2);
}

let sha = "nosha";
try {
  sha = (await sh("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim() || sha;
} catch {
  /* not a git checkout */
}
// A slot held for an hour counts as stale: keep the lane's slot fresh while the long scenarios run.
const slot = slots ? join(slots, "slot.mjs") : join(root, "..", "kolux-rs-slots", "slot.mjs");
const keepSlot = existsSync(slot) ? setInterval(() => sh(process.execPath, [slot, "acquire", "stress"]).catch(() => {}), 10 * 60_000) : null;
keepSlot?.unref();

const summary = [];
for (const id of list) {
  const mod = await import(modules[id]);
  console.log(`\n== ${id} ${mod.title}`);
  const checks = new Checks();
  const ctx = { opts, checks, app: null, sha };
  ctx.launch = async (name, settings) => {
    ctx.app = newApp(opts, name);
    await ctx.app.launch({ prepare: mod.seed?.(ctx.app, settings) ?? undefined });
    return ctx.app;
  };
  const started = Date.now();
  let status = "PASS";
  let blocked = null;
  try {
    await mod.run(ctx);
  } catch (e) {
    blocked = e;
    status = "HARNESS-BLOCKED";
    checks.add("scenario ran to the end", "no exception", e.stack?.split("\n").slice(0, 3).join(" | ") ?? e.message, false);
  }
  try {
    const closed = await ctx.app?.closeApp();
    if (closed) checks.add("app closes by its own path and leaves no process behind", "0 survivors", closed[1], closed[0]);
  } catch (e) {
    checks.note(`close: ${e.message}; the run's own app tree is ended by pid`);
    checks.add("app closes by its own path", "closes", e.message.slice(0, 200), false);
    await ctx.app?.forceStop();
  }
  if (ctx.app) {
    const gone = removeTemp(ctx.app.temp);
    if (gone) checks.note(`scratch folder ${ctx.app.temp} was not removed (${gone}); delete it by hand`);
  }
  if (!blocked) status = checks.ok ? "PASS" : "FAIL";
  const lines = [
    `stress ${id} (${mod.title}) at ${new Date().toISOString()} on ${sha} (${root})`,
    `args: ${args.join(" ")}; ran ${((Date.now() - started) / 1000).toFixed(0)} s`,
    "",
    ...(ctx.report ? [...ctx.report, ""] : []),
    ...checks.list.map((c) => `${c.inconclusive ? "INCONCLUSIVE" : c.pass ? "PASS" : "FAIL"}  ${c.name}\n      bar: ${c.threshold}\n      measured: ${c.measured}`),
    ...(checks.notes.length ? ["", "notes:", ...checks.notes.map((n) => `  - ${n}`)] : []),
    "",
    `${id}: ${status}`,
    "",
  ];
  mkdirSync(join(root, "evidence"), { recursive: true });
  const file = join(root, "evidence", `stress-${id.toLowerCase()}-${sha}${ctx.fileTag ?? ""}.txt`);
  writeFileSync(file, lines.join("\n"));
  console.log(lines.slice(3).join("\n"));
  console.log(`evidence: ${file}`);
  summary.push([id, status]);
}
console.log(`\nstress: ${summary.map(([id, s]) => `${id} ${s}`).join(" · ")}`);
process.exit(summary.every(([, s]) => s === "PASS") ? 0 : 1);
