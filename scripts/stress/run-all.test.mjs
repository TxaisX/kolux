// Unit tests for scripts/stress/run-all.mjs: slot allocation, script classification,
// stand-in filtering, output parsing, and summary generation. Runs under vitest and node --test.
import assert from "node:assert/strict";
import {
  allocateSlots,
  classifyProveScript,
  discoverProveScripts,
  formatSummaryMarkdown,
  parseArgs,
  parseProveOutput,
  selectorDrift,
  shouldRun,
  slotConfig,
  warningsFor,
} from "./run-all.mjs";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

test("slotConfig allocates o2-tests ports 1500-1590 (step 10), CDP 9350-9359, identifier o2-<n>", () => {
  const s0 = slotConfig(0, "G:/Temp/test");
  assert.equal(s0.port, 1500);
  assert.equal(s0.cdp, 9350);
  assert.equal(s0.identifier, "com.txaisxiong.kolux.o2-0");

  const s3 = slotConfig(3, "G:/Temp/test");
  assert.equal(s3.port, 1530);
  assert.equal(s3.cdp, 9353);
  assert.equal(s3.identifier, "com.txaisxiong.kolux.o2-3");

  const s9 = slotConfig(9, "G:/Temp/test");
  assert.equal(s9.port, 1590);
  assert.equal(s9.cdp, 9359);
  assert.equal(s9.identifier, "com.txaisxiong.kolux.o2-9");

  assert.throws(() => slotConfig(10), RangeError);
  assert.throws(() => allocateSlots(11), RangeError);
});

test("parseArgs validates --instances, --timeout, --only, and boolean flags", () => {
  const def = parseArgs([]);
  assert.equal(def.instances, 4);
  assert.equal(def.dryRun, false);
  assert.equal(def.includeRealClaude, false);

  const custom = parseArgs(["--instances", "6", "--only", "SESS,TERM", "--dry-run", "--timeout", "15"]);
  assert.equal(custom.instances, 6);
  assert.deepEqual(custom.only, ["sess", "term"]);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.timeoutMinutes, 15);

  assert.throws(() => parseArgs(["--instances", "12"]), /1\.\.10/);
  assert.throws(() => parseArgs(["--instances", "0"]), /1\.\.10/);
});

test("classifyProveScript separates helpers, real-Claude, retired-browser, installed, and stand-in scripts", () => {
  assert.equal(classifyProveScript("live-common.mjs", "").category, "helper");
  assert.equal(classifyProveScript("live-views-dom.mjs", "").category, "helper");
  assert.equal(classifyProveScript("live-installed.mjs", "").category, "attach");
  assert.equal(classifyProveScript("live-T-544.mjs", "").category, "installed");
  assert.equal(
    classifyProveScript("live-SAFE-003.mjs", 'import { scenario } from "./live-claude-common.mjs";').category,
    "real-claude",
  );
  assert.equal(classifyProveScript("live-BROW.mjs", 'document.querySelector("section.pane.browser")').category, "retired-browser");
  const s = classifyProveScript("live-SESS-004.mjs", 'import { startPlain } from "./live-proj-common.mjs";');
  assert.equal(s.category, "standin");
  assert.equal(s.runnableByDefault, true);
});

test("a script that still drives the removed embedded browser pane never runs", () => {
  const entry = classifyProveScript("live-BROW.mjs", 'document.querySelector("section.pane.browser")');
  assert.equal(entry.runnableByDefault, false);
  assert.match(entry.reason, /removed/);
  assert.equal(shouldRun(entry, parseArgs([])).run, false);
});

test("selectorDrift flags a class no src/ file mentions and leaves the real ones alone", () => {
  const known = new Set(["sess", "pane", "terminal-pane", "pane-new-session"]);
  const source = [
    'const row = ".sess.pane-row[data-pane]";',
    'await click("[data-testid=\"pane-new-session\"]");',
    'const t = await app.evalJs("document.querySelector(\".terminal-pane\").clientWidth");',
  ].join("\n");
  const drift = selectorDrift(source, known);
  assert.deepEqual(drift, ["pane-row"]);
});

test("warningsFor reports a dead selector beside the check, not only the four hand-kept patterns", () => {
  const warnings = warningsFor('const row = ".sess.pane-row[data-pane]";', new Set(["sess"]));
  assert.ok(warnings.some((w) => /pane-row/.test(w)), warnings.join("; "));
});

test("every stand-in check's selectors are compared against src/ at discovery time", () => {
  const all = discoverProveScripts();
  assert.ok(all.every((e) => e.category !== "browser"), "no script is classified as a live browser check any more");
  assert.ok(
    all.some((e) => (e.warnings ?? []).some((w) => /no src\/ file mentions/.test(w))),
    "selector drift is reported against src/, not against a hand-kept pattern list",
  );
});

test("discoverProveScripts finds scripts in scripts/prove and excludes real-Claude by default", () => {
  const all = discoverProveScripts();
  assert.ok(all.length > 80);
  const opts = parseArgs([]);
  const runnable = all.filter((e) => shouldRun(e, opts).run);
  const realClaude = all.filter((e) => e.category === "real-claude");
  assert.ok(realClaude.length >= 10);
  assert.ok(runnable.every((e) => e.category === "standin"));
});

test("parseProveOutput counts PASS/FAIL/NOT-TESTED lines and reads RESULT line", () => {
  const ok = parseProveOutput("PASS one: ok\nPASS two: ok\nRESULT: PASS\n", "", 0, false);
  assert.equal(ok.status, "PASS");
  assert.equal(ok.passCount, 2);
  assert.equal(ok.failCount, 0);

  const blind = parseProveOutput("NOT-TESTED one: guard blind\nRESULT: NOT-TESTED\n", "", 1, false);
  assert.equal(blind.status, "NOT-TESTED");
  assert.equal(blind.notTestedCount, 1);

  const timedOut = parseProveOutput("PASS partial: ok\n", "", -1, true);
  assert.equal(timedOut.status, "TIMEOUT");
});

test("formatSummaryMarkdown includes counts, slots, table, and skipped entries", () => {
  const slots = allocateSlots(2, "G:/Temp/o2-run-all");
  const opts = parseArgs(["--instances", "2"]);
  const md = formatSummaryMarkdown({
    runAt: "2026-11-12T12:00:00.000Z",
    sha: "abc1234",
    opts,
    slots,
    results: [
      {
        file: "live-SESS-004.mjs",
        slot: 0,
        status: "PASS",
        passCount: 3,
        failCount: 0,
        notTestedCount: 0,
        durationMs: 12300,
        warnings: [],
        screenshots: ["screenshots/live-SESS-004__SESS-004.png"],
        logFile: "logs/live-SESS-004.log",
        failures: [],
      },
    ],
    skipped: [{ file: "live-SAFE-003.mjs", category: "real-claude", skipReason: "requires real Claude sign-in / AI quota" }],
    totalMs: 12500,
  });
  assert.match(md, /1 PASS, 0 FAIL, 0 NOT-TESTED, 0 TIMEOUT, 1 SKIPPED/);
  assert.match(md, /com\.txaisxiong\.kolux\.o2-0/);
  assert.match(md, /live-SESS-004\.mjs/);
  assert.match(md, /live-SAFE-003\.mjs/);
});
