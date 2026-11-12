// Parallel live-check runner (o2-tests): runs scripts/prove/live-*.mjs across N isolated app slots
// using scripts/evidence/app-launch.mjs and stand-in agents (no AI quota), then writes a markdown + JSON
// summary (pass/fail per check, screenshots, timings) to artifacts/test-runs/<date-time>/summary.md.
//
// Usage:
//   node scripts/stress/run-all.mjs [--instances 4] [--only SESS,TERM] [--timeout 10]
//   node scripts/stress/run-all.mjs --dry-run [--instances 4]
//   Flags:
//     --instances <1..10>       Number of parallel worker slots (default: 4; max 10: Vite 1500-1590, CDP 9350-9359)
//     --only <csv>              Run only live-*.mjs whose name contains any comma-separated token
//     --include-real-claude     Include scripts that invoke real signed-in Claude (off by default: no AI quota)
//     --include-installed       Include scripts targeting %LOCALAPPDATA%\Kolux\kolux.exe (off by default)
//     --timeout <minutes>       Per-script timeout in minutes (default: 10)
//     --temp <dir>              Scratch root (default: G:/Temp/o2-run-all)
//     --out <dir>               Output folder (default: artifacts/test-runs/<YYYY-MM-DD_HH-MM-SS>)
//     --no-warmup               Skip single-slot build warmup before fanning out
//     --dry-run                 Classify scripts, assign slots, and write summary.md without launching apps
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "../evidence/app-launch.mjs";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
export const MAX_INSTANCES = 10;
export const BASE_VITE_PORT = 1500;
export const VITE_PORT_STEP = 10;
export const BASE_CDP_PORT = 9350;

/** Returns the Vite port, CDP port, and bundle identifier reserved for o2-tests slot `i` (0..9). */
export function slotConfig(index, tempRoot = "G:/Temp/o2-run-all") {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INSTANCES) {
    throw new RangeError(`slot index must be 0..${MAX_INSTANCES - 1}, got ${index}`);
  }
  const cleanTemp = tempRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return {
    index,
    port: BASE_VITE_PORT + index * VITE_PORT_STEP,
    cdp: BASE_CDP_PORT + index,
    identifier: `com.txaisxiong.kolux.o2-${index}`,
    temp: `${cleanTemp}/slot-${index}`,
    logsDir: `${cleanTemp}/slot-${index}/logs`,
    baseDir: `${cleanTemp}/slot-${index}/prove`,
    standinDir: `${cleanTemp}/slot-${index}/standin`,
  };
}

export function allocateSlots(instances = 4, tempRoot = "G:/Temp/o2-run-all") {
  const n = Math.floor(Number(instances));
  if (!Number.isFinite(n) || n < 1 || n > MAX_INSTANCES) {
    throw new RangeError(`--instances must be between 1 and ${MAX_INSTANCES}, got ${instances}`);
  }
  return Array.from({ length: n }, (_, i) => slotConfig(i, tempRoot));
}

export function parseArgs(argv) {
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const flag = (name) => argv.includes(`--${name}`);
  const instances = Number(opt("instances", "4"));
  if (!Number.isInteger(instances) || instances < 1 || instances > MAX_INSTANCES) {
    throw new Error(`--instances must be an integer 1..${MAX_INSTANCES} (got ${opt("instances", "4")})`);
  }
  const timeoutMinutes = Number(opt("timeout", "10"));
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error(`--timeout must be positive minutes (got ${opt("timeout", "10")})`);
  }
  const onlyRaw = opt("only", "");
  const only = onlyRaw
    ? onlyRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    instances,
    timeoutMinutes,
    only,
    includeRealClaude: flag("include-real-claude"),
    includeInstalled: flag("include-installed"),
    noWarmup: flag("no-warmup"),
    dryRun: flag("dry-run"),
    temp: (opt("temp", "G:/Temp/o2-run-all") || "G:/Temp/o2-run-all").replace(/\\/g, "/"),
    out: opt("out", null),
  };
}

/**
 * Classifies a scripts/prove/live-*.mjs file into how (and whether) run-all should run it.
 * Categories:
 *   helper         - shared library, not an executable check
 *   attach         - attaches to an already-running installed app (live-installed / live-checks)
 *   installed      - requires pre-installed %LOCALAPPDATA%\Kolux\kolux.exe or --exe arg
 *   real-claude    - requires real signed-in Claude account A (uses AI quota)
 *   retired-browser- tests the embedded browser pane that Goal 0 removed (kept as a guard, never runs)
 *   standin        - self-contained live check runnable with stand-in agents (no AI quota)
 */
export function classifyProveScript(filename, source) {
  if (
    filename === "live-common.mjs" ||
    filename === "live-views-dom.mjs" ||
    filename.endsWith("-common.mjs")
  ) {
    return { category: "helper", runnableByDefault: false, reason: "shared helper module" };
  }
  if (filename === "live-installed.mjs" || filename === "live-checks.mjs") {
    return { category: "attach", runnableByDefault: false, reason: "subcommand tool for installed build" };
  }
  if (filename === "live-T-544.mjs" || filename === "live-T-816-nowin.mjs") {
    return { category: "installed", runnableByDefault: false, reason: "requires installed or explicit --exe build" };
  }
  if (/from\s+["']\.\/live-claude-common\.mjs["']/.test(source) || /\bstartProve\s*\(/.test(source)) {
    return { category: "real-claude", runnableByDefault: false, reason: "requires real Claude sign-in / AI quota" };
  }
  // Goal 0 removed the embedded browser pane, and its proofs with it. A script that still drives section.pane.browser
  // is not a live check of anything any more: skip it instead of reporting a failure for a feature that is gone.
  if (/section\.pane\.browser|kolux-open-in-browser/.test(source)) {
    return { category: "retired-browser", runnableByDefault: false, reason: "embedded browser pane (removed: Goal 0)" };
  }
  return { category: "standin", runnableByDefault: true, reason: "stand-in / headless live check", warnings: warningsFor(source) };
}

// A file extension is not a class name: `.mjs`, `.json` and `.cmd` appear in every selector-heavy script.
// Names that look like a class in a quoted string but are a property or a word in a message, not a selector.
const NOT_A_CLASS = new Set(["aria", "ppid", "pid", "argv", "eval", "snaps", "survivors", "stdout", "stderr", "cdp", "json", "real"]);
const EXTENSIONS = new Set([
  "mjs", "js", "cjs", "ts", "tsx", "jsx", "json", "txt", "md", "css", "html", "htm", "svg", "png", "jpg", "jpeg", "webp", "ico",
  "exe", "cmd", "bat", "ps1", "sh", "py", "rs", "toml", "yml", "yaml", "lock", "log", "out", "zip", "gz", "dll", "node", "map",
  "com", "org", "io", "ai", "dev", "invalid", "local", "app", "test", "spec",
]);

/**
 * Every class token and data-testid any src/ file mentions: what a live check may legitimately query. Reading src/ once
 * per run beats a hand-kept list of four patterns, which reported "no warnings" for a check whose selector had been
 * dead for three rounds (.pane-row, removed when the sidebar went to .sess rows).
 */
export function srcSelectorTokens(srcDir = join(ROOT, "src")) {
  const tokens = new Set();
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__cards__" ? [] : walk(p);
      return /\.(tsx|ts|css|html)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/className\s*=\s*["']([^"']+)["']/g)) for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
    for (const m of text.matchAll(/className\s*=\s*\{`([^`]*)`\}/g))
      for (const t of m[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (t) tokens.add(t);
    for (const m of text.matchAll(/data-testid\s*=\s*["']([^"']+)["']/g)) tokens.add(m[1]);
    for (const m of text.matchAll(/data-testid=\{`([^`]+)`\}/g)) tokens.add(m[1].replace(/\$\{[^}]*\}/g, "x"));
    // CSS rules and any other .token in the source (a class the app styles or queries): a superset is safe here, because
    // this set only decides what is NOT missing.
    for (const m of text.matchAll(/\.([A-Za-z][\w-]*)/g)) tokens.add(m[1]);
  }
  return tokens;
}

/**
 * Class tokens a live check queries that no src/ file mentions: a selector that can never match, which used to be
 * reported as "no warnings". File extensions and one- and two-letter fragments are left out (they are not classes).
 */
export function selectorDrift(source, known) {
  const found = new Set();
  // Only quoted strings that read as a selector: brackets, a combinator, or a leading . or #. A bare `.eval` or
  // `.argv` is a property access on an object, not something the DOM is asked for.
  for (const quoted of source.matchAll(/["'`]([^"'`\n]{2,300})["'`]/g)) {
    const text = quoted[1];
    if (!/[\[#>]/.test(text) && !/^\s*[.#]/.test(text)) continue;
    // A quoted JS snippet (an eval body) is not a selector: it has statements, arrows or calls in it.
    if (/=>|;|const |return |querySelector\(/.test(text)) continue;
    for (const m of text.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)) {
      const token = m[1];
      if (token.length < 3 || EXTENSIONS.has(token) || NOT_A_CLASS.has(token)) continue;
      found.add(token);
    }
  }
  return [...found].filter((t) => !known.has(t)).sort();
}

/** The warnings shown beside a check in the summary: port overrides it would collide on, and selectors src/ cannot match. */
export function warningsFor(source, known = null) {
  const warnings = [];
  if (/PROVE_PORT\s*=|PROVE_CDP\s*=/.test(source)) warnings.push("overrides PROVE_PORT/PROVE_CDP");
  // A fallback (`PROVE_CDP || "9290"`) is fine; an unconditional port assignment or a literal URL is what collides.
  if (/PROVE_(?:PORT|CDP)\s*=\s*["'`]|127\.0\.0\.1:9290\/|localhost:1470/.test(source)) warnings.push("hardcodes 9290/1470");
  // The old selectors a comment may still name (this file's own text names them) only count as code when they are quoted.
  if (/["'`]button\.newtab|["'`][^"'`]*Source Control|chooser select["'`]|aria-label="New tab"/.test(source)) warnings.push("uses stale UI selector");
  const drift = known ? selectorDrift(source, known) : [];
  if (drift.length > 0) warnings.push(`selector(s) no src/ file mentions: ${drift.slice(0, 8).join(", ")}${drift.length > 8 ? ` (+${drift.length - 8})` : ""}`);
  return warnings;
}

export function discoverProveScripts(proveDir = join(ROOT, "scripts", "prove")) {
  const files = readdirSync(proveDir)
    .filter((f) => f.startsWith("live-") && f.endsWith(".mjs"))
    .sort();
  // src/ is read once: every check's selectors are compared against the classes and test ids the app really has.
  const known = srcSelectorTokens();
  return files.map((file) => {
    const fullPath = join(proveDir, file);
    const source = readFileSync(fullPath, "utf8");
    const meta = classifyProveScript(file, source);
    if (meta.category === "standin") meta.warnings = warningsFor(source, known);
    return { file, fullPath, ...meta };
  });
}

export function shouldRun(entry, opts) {
  if (opts.only.length > 0 && !opts.only.some((tok) => entry.file.toLowerCase().includes(tok))) {
    return { run: false, skipReason: "filtered out by --only" };
  }
  if (entry.category === "helper" || entry.category === "attach") {
    return { run: false, skipReason: entry.reason };
  }
  if (entry.category === "real-claude" && !opts.includeRealClaude) {
    return { run: false, skipReason: entry.reason };
  }
  if (entry.category === "retired-browser") {
    // The embedded browser pane is gone (Goal 0): a proof for it has nothing left to check and never runs.
    return { run: false, skipReason: entry.reason };
  }
  if (entry.category === "installed" && !opts.includeInstalled) {
    return { run: false, skipReason: entry.reason };
  }
  return { run: true, skipReason: null };
}

/** Parses stdout/stderr from a live-*.mjs script into assertion counts and verdict. */
export function parseProveOutput(stdout, stderr, exitCode, timedOut = false) {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  let passCount = 0;
  let failCount = 0;
  let notTestedCount = 0;
  const failures = [];
  for (const line of lines) {
    if (/^PASS\b/.test(line)) passCount++;
    else if (/^FAIL\b/.test(line)) {
      failCount++;
      failures.push(line);
    } else if (/^NOT-TESTED\b/.test(line)) {
      notTestedCount++;
      failures.push(line);
    } else if (/^ERROR\b/.test(line)) {
      failures.push(line);
    }
  }
  const resultMatch = /^RESULT:\s*(PASS|FAIL|NOT-TESTED)/m.exec(combined);
  let status;
  if (timedOut) status = "TIMEOUT";
  else if (resultMatch) status = resultMatch[1];
  else if (exitCode === 0 && failCount === 0 && notTestedCount === 0) status = "PASS";
  else if (notTestedCount > 0 && failCount === 0) status = "NOT-TESTED";
  else status = "FAIL";
  return { status, passCount, failCount, notTestedCount, failures: failures.slice(0, 10) };
}

/** Writes stand-in agent `.cmd` shims into `standinDir` so no real AI CLI or quota is invoked. */
export function writeStandinAgents(standinDir) {
  mkdirSync(standinDir, { recursive: true });
  const body = (name) =>
    [
      "@echo off",
      `echo Kolux run-all stand-in for ${name}: no AI quota`,
      "echo ARGV: %*",
      "echo CWD: %CD%",
      "ping -n 3600 127.0.0.1 >nul",
      "",
    ].join("\r\n");
  for (const agent of ["claude", "codex", "grok", "opencode"]) {
    writeFileSync(join(standinDir, `${agent}.cmd`), body(agent));
  }
  return standinDir;
}

function cleanSlotEnv(slot, standinDir) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (
      k.startsWith("KOLUX_") ||
      k.startsWith("CLAUDE_CODE_") ||
      k === "CLAUDECODE" ||
      k === "CLAUDE_CONFIG_DIR" ||
      k === "CODEX_HOME" ||
      k === "ANTHROPIC_API_KEY" ||
      k === "ANTHROPIC_AUTH_TOKEN"
    ) {
      delete env[k];
    }
  }
  const pathSep = process.platform === "win32" ? ";" : ":";
  env.PATH = `${standinDir.replace(/\//g, "\\")}${pathSep}${env.PATH ?? ""}`;
  env.PROVE_PORT = String(slot.port);
  env.PROVE_CDP = String(slot.cdp);
  env.PROVE_IDENTIFIER = slot.identifier;
  env.PROVE_BASE = slot.baseDir;
  env.PROVE_LOGS = slot.logsDir;
  // live-common.mjs wipes a profile only when its identifier carries the suffix it was given (app-launch.mjs rule).
  env.PROVE_SUFFIX = `.o2-${slot.index}`;
  return env;
}

function listPngs(dir) {
  if (!existsSync(dir)) return new Map();
  const out = new Map();
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const full = join(dir, name);
    try {
      out.set(name, statSync(full).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function collectNewScreenshots(beforeMap, logsDir, outShotsDir, checkName) {
  if (!existsSync(logsDir)) return [];
  mkdirSync(outShotsDir, { recursive: true });
  const collected = [];
  for (const name of readdirSync(logsDir)) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const full = join(logsDir, name);
    const mtime = statSync(full).mtimeMs;
    if (!beforeMap.has(name) || mtime > beforeMap.get(name)) {
      const destName = `${checkName.replace(/\.mjs$/, "")}__${name}`;
      const dest = join(outShotsDir, destName);
      copyFileSync(full, dest);
      collected.push(`screenshots/${destName}`);
    }
  }
  return collected;
}

async function runSingleCheck(entry, slot, opts, outDir) {
  const startMs = Date.now();
  const logsDir = slot.logsDir;
  const checkLogsOut = join(outDir, "logs");
  const outShotsDir = join(outDir, "screenshots");
  mkdirSync(slot.temp, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(checkLogsOut, { recursive: true });

  const standinDir = writeStandinAgents(slot.standinDir);
  const env = cleanSlotEnv(slot, standinDir);
  const beforePngs = listPngs(logsDir);

  // Create an app-launch handle for slot cleanup guarantees (orphans / timeout teardown).
  const app = createApp({
    root: ROOT,
    port: slot.port,
    cdp: slot.cdp,
    identifier: `${slot.identifier}.smoke`,
    temp: slot.temp,
    suffix: ".smoke",
    offscreen: true,
    log: () => {},
  });

  const timeoutMs = opts.timeoutMinutes * 60_000;
  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let timedOut = false;

  await new Promise((resolveDone) => {
    const child = spawn(process.execPath, [entry.fullPath], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    const timer = setTimeout(async () => {
      timedOut = true;
      await app.forceStop().catch(() => {});
      try {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        /* best effort */
      }
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      exitCode = code ?? -1;
      resolveDone();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += `\nspawn error: ${err.message}`;
      resolveDone();
    });
  });

  // Defensive slot port cleanup if the check crashed before closing its own dev/app processes.
  await app.forceStop().catch(() => {});

  const durationMs = Date.now() - startMs;
  const parsed = parseProveOutput(stdout, stderr, exitCode, timedOut);
  const logFile = `logs/${entry.file.replace(/\.mjs$/, ".log")}`;
  writeFileSync(join(outDir, logFile), `${stdout}\n${stderr ? `\n--- STDERR ---\n${stderr}` : ""}`);
  const screenshots = collectNewScreenshots(beforePngs, logsDir, outShotsDir, entry.file);

  return {
    file: entry.file,
    category: entry.category,
    warnings: entry.warnings ?? [],
    slot: slot.index,
    port: slot.port,
    cdp: slot.cdp,
    identifier: slot.identifier,
    exitCode,
    durationMs,
    ...parsed,
    screenshots,
    logFile,
  };
}

export function formatSummaryMarkdown({ runAt, sha, opts, slots, results, skipped, totalMs }) {
  const counts = {
    total: results.length + skipped.length,
    executed: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
    notTested: results.filter((r) => r.status === "NOT-TESTED").length,
    timedOut: results.filter((r) => r.status === "TIMEOUT").length,
    skipped: skipped.length,
  };

  const lines = [
    `# Kolux live test run summary`,
    ``,
    `- **Date**: ${runAt}`,
    `- **Commit**: \`${sha}\``,
    `- **Mode**: ${opts.dryRun ? "dry-run (no apps launched)" : "live (stand-in agents, no AI quota)"}`,
    `- **Instances**: ${opts.instances} (Vite ${slots[0].port}-${slots[slots.length - 1].port}, CDP ${slots[0].cdp}-${slots[slots.length - 1].cdp})`,
    `- **Total duration**: ${(totalMs / 1000).toFixed(1)} s`,
    `- **Counts**: ${counts.passed} PASS, ${counts.failed} FAIL, ${counts.notTested} NOT-TESTED, ${counts.timedOut} TIMEOUT, ${counts.skipped} SKIPPED (total ${counts.total})`,
    ``,
    `## Slots`,
    ``,
    `| Slot | Vite | CDP | Identifier | Scratch root |`,
    `|---:|---:|---:|---|---|`,
    ...slots.map((s) => `| ${s.index} | ${s.port} | ${s.cdp} | \`${s.identifier}\` | \`${s.temp}\` |`),
    ``,
    `## Executed checks (${results.length})`,
    ``,
  ];

  if (results.length === 0) {
    lines.push(`_No checks executed._`, ``);
  } else {
    lines.push(`| Check | Slot | Status | Assertions (P/F/NT) | Duration | Warnings | Screenshots | Log |`);
    lines.push(`|---|---:|---|---|---:|---|---|---|`);
    for (const r of results) {
      const shots = r.screenshots.length > 0 ? r.screenshots.map((s) => `\`${s}\``).join(", ") : "-";
      const warns = r.warnings.length > 0 ? r.warnings.join("; ") : "-";
      lines.push(
        `| \`${r.file}\` | ${r.slot} | **${r.status}** | ${r.passCount}/${r.failCount}/${r.notTestedCount} | ${(r.durationMs / 1000).toFixed(1)} s | ${warns} | ${shots} | ${r.logFile ? `\`${r.logFile}\`` : "-"} |`,
      );
    }
    lines.push(``);
  }

  const failing = results.filter((r) => r.status !== "PASS" && r.status !== "PLANNED");
  if (failing.length > 0) {
    lines.push(`## Failures and incomplete checks (${failing.length})`, ``);
    for (const r of failing) {
      lines.push(`### \`${r.file}\` (${r.status}, slot ${r.slot}, exit ${r.exitCode})`);
      if (r.failures.length > 0) {
        lines.push("```");
        lines.push(...r.failures);
        lines.push("```");
      } else {
        lines.push(`See \`${r.logFile}\`.`);
      }
      lines.push(``);
    }
  }

  lines.push(`## Skipped checks (${skipped.length})`, ``);
  if (skipped.length === 0) {
    lines.push(`_None._`, ``);
  } else {
    lines.push(`| Check | Category | Reason |`);
    lines.push(`|---|---|---|`);
    for (const s of skipped) {
      lines.push(`| \`${s.file}\` | ${s.category} | ${s.skipReason} |`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function timestampSlug(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function gitSha() {
  return new Promise((res) => {
    const c = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    c.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    c.on("exit", () => res(out.trim() || "nosha"));
    c.on("error", () => res("nosha"));
  });
}

async function warmupSlotZero(slot) {
  const targetExe = join(ROOT, "src-tauri", "target", "debug", "kolux.exe");
  if (existsSync(targetExe)) {
    console.log(`[warmup] reusing existing debug binary at ${targetExe}`);
    return;
  }
  console.log(`[warmup] building debug binary once via app-launch on slot 0 (vite ${slot.port}, CDP ${slot.cdp})...`);
  const warmupTemp = `${slot.temp}-warmup`;
  rmSync(warmupTemp, { recursive: true, force: true });
  mkdirSync(warmupTemp, { recursive: true });
  const app = createApp({
    root: ROOT,
    port: slot.port,
    cdp: slot.cdp,
    identifier: `${slot.identifier}.smoke`,
    temp: warmupTemp,
    suffix: ".smoke",
    offscreen: true,
    buildMinutes: 25,
    log: (m) => console.log(`[warmup] ${m}`),
  });
  try {
    await app.launch({
      prepare: () => {
        mkdirSync(app.paths.profile, { recursive: true });
        writeFileSync(app.paths.settings, JSON.stringify({ confirmCloseRunning: false, uiLook: "new" }, null, 2));
      },
    });
  } finally {
    await app.closeApp().catch(() => {});
    rmSync(warmupTemp, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const opts = parseArgs(argv);
  const slots = allocateSlots(opts.instances, opts.temp);
  const all = discoverProveScripts();

  const queue = [];
  const skipped = [];
  for (const entry of all) {
    const dec = shouldRun(entry, opts);
    if (dec.run) queue.push(entry);
    else skipped.push({ ...entry, skipReason: dec.skipReason });
  }

  const outDir = resolve(ROOT, opts.out ?? join("artifacts", "test-runs", timestampSlug()));
  mkdirSync(outDir, { recursive: true });
  const sha = await gitSha();

  console.log(`run-all: ${queue.length} queued, ${skipped.length} skipped across ${slots.length} instance slot(s) (${opts.dryRun ? "dry-run" : "live"})`);

  let results = [];
  if (opts.dryRun) {
    results = queue.map((entry, idx) => {
      const slot = slots[idx % slots.length];
      return {
        file: entry.file,
        category: entry.category,
        warnings: entry.warnings ?? [],
        slot: slot.index,
        port: slot.port,
        cdp: slot.cdp,
        identifier: slot.identifier,
        exitCode: 0,
        durationMs: 0,
        status: "PLANNED",
        passCount: 0,
        failCount: 0,
        notTestedCount: 0,
        failures: [],
        screenshots: [],
        logFile: null,
      };
    });
  } else {
    if (!opts.noWarmup && queue.length > 0) {
      await warmupSlotZero(slots[0]);
    }
    let nextIdx = 0;
    const worker = async (slot) => {
      const slotResults = [];
      while (nextIdx < queue.length) {
        const entry = queue[nextIdx++];
        console.log(`[slot ${slot.index} | :${slot.port}/:${slot.cdp}] start ${entry.file}`);
        const r = await runSingleCheck(entry, slot, opts, outDir);
        console.log(`[slot ${slot.index}] ${r.status} ${entry.file} (${(r.durationMs / 1000).toFixed(1)} s)`);
        slotResults.push(r);
      }
      return slotResults;
    };
    const perSlot = await Promise.all(slots.map((s) => worker(s)));
    results = perSlot.flat().sort((a, b) => a.file.localeCompare(b.file));
  }

  const totalMs = Date.now() - startedAt;
  const summaryMd = formatSummaryMarkdown({ runAt, sha, opts, slots, results, skipped, totalMs });
  writeFileSync(join(outDir, "summary.md"), summaryMd);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ runAt, sha, opts, slots, results, skipped, totalMs }, null, 2));
  console.log(`summary: ${join(outDir, "summary.md")}`);

  if (opts.dryRun) return 0;
  const allGood = results.every((r) => r.status === "PASS");
  return allGood ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.stack ?? err.message);
      process.exit(1);
    },
  );
}
