// T-763 (DT-C199): the IPC guard every prove harness arms. Runs its page script and its probe against a fake page,
// and the verdict that turns a run the guard went blind in into NOT-TESTED. Runs under
// `node --test scripts/evidence/app-launch.test.mjs` and under vitest (vite.config.ts includes scripts/**/*.test.mjs).
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import { createGuardTrack, guardReport, guardRow, IPC_BLOCK, IPC_GUARD_JS, guardProbeJs, rowWord, runWord } from "./app-launch.mjs";

// vitest sets VITEST in the environment; plain node uses its own runner. Assertions are node:assert in both.
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

// A fake page: fetch reaches a fake backend, and invoke sends by window.fetch like Tauri's fetch IPC
// ("postMessage" = the switched-over IPC the wrapper cannot see).
function page({ ipc = "fetch" } = {}) {
  const passed = [];
  const window = { fetch: async (input) => (passed.push(typeof input === "string" ? input : input.url), new Response("real")) };
  window.__TAURI_INTERNALS__ = { invoke: (cmd) => (ipc === "fetch" ? window.fetch(url(cmd)) : Promise.reject(new Error("unknown command"))) };
  const ctx = { window, Response, Promise, decodeURIComponent, String, RegExp, setTimeout };
  const arm = () => runInNewContext(IPC_GUARD_JS, ctx);
  const probe = (name) => runInNewContext(guardProbeJs(name), ctx);
  return { window, passed, armed: arm(), arm, probe };
}
const url = (cmd) => `http://ipc.localhost/${encodeURIComponent(cmd)}`;
const BLOCKED = ["keybindings_write", "keybindings_reload", "keybindings_show", "open_external", "open_install_page", "open_notification_settings", "open_in", "open_path",
  "editor_open", "scm_open_pr", "scm_open_with", "scm_reveal", "skills_reveal", "session_reveal", "browser_download_reveal", "app_restart", "update_restart",
  "update_download", "graphics_restart_safe", "graphics_choose", "cli_register", "cli_unregister", "agents_install", "agents_install_many", "agent_install"];

test("arming returns true and starts an empty call log", () => {
  const p = page();
  assert.equal(p.armed, true);
  assert.deepEqual([...p.window.__v10calls], []);
});

for (const cmd of BLOCKED) {
  test(`${cmd} is answered by the guard and never reaches the backend`, async () => {
    const p = page();
    const res = await p.window.fetch(url(cmd), { body: '{"x":1}' });
    assert.deepEqual(p.passed, []);
    assert.equal(res.headers.get("Tauri-Response"), "ok");
    assert.equal(res.headers.get("Content-Type"), "application/json");
    assert.equal(await res.text(), "null");
    assert.deepEqual([...p.window.__v10calls], [`${cmd} {"x":1} [BLOCKED]`]);
  });
}

test("ordinary commands pass through and are logged; event and log plugins and other hosts are not logged", async () => {
  const p = page();
  for (const cmd of ["settings_read", "plugin:event|listen", "plugin:log|log"]) await p.window.fetch(url(cmd));
  await p.window.fetch("https://example.com/x");
  await p.window.fetch("http://evil-ipc.localhost.example/open_external");
  assert.equal(p.passed.length, 5);
  assert.deepEqual([...p.window.__v10calls], ["settings_read"]);
});

test("the block list does not catch look-alikes", () => {
  for (const cmd of ["keybindings_read", "open_externally_hint", "settings_write", "agent_installs", "agent_install_cancel", "agent_can_install", "scm_open", "session_open"])
    assert.equal(IPC_BLOCK.test(cmd), false);
});

test("the probe passes while calls go through the guard, and takes itself out of the log", async () => {
  const p = page();
  assert.equal(await p.probe("v8_probe_1"), true);
  assert.deepEqual([...p.window.__v10calls], []);
});

test("the probe fails when IPC no longer goes by fetch (Tauri's postMessage switch)", async () => {
  assert.equal(await page({ ipc: "postMessage" }).probe("v8_probe_1"), false);
});

test("a failed backend fetch marks the guard blind", async () => {
  const p = page();
  p.window.__v10orig = async () => {
    throw new TypeError("Failed to fetch");
  };
  p.arm();
  await assert.rejects(p.window.fetch(url("settings_read")), /Failed to fetch/);
  assert.equal(p.window.__v10blind, true);
  assert.equal(await p.probe("v8_probe_2"), false);
});

test("arming twice wraps the page's own fetch once", async () => {
  const p = page();
  p.arm();
  await p.window.fetch(url("open_external"));
  await p.window.fetch(url("settings_read"));
  assert.deepEqual(p.passed, [url("settings_read")]);
  assert.deepEqual([...p.window.__v10calls], ["open_external  [BLOCKED]", "settings_read"]);
});

// ---- the run verdict: a guard that went blind can never report PASS ----

test("the verdict words: PASS, FAIL, and NOT-TESTED for a row or run the guard went blind on", () => {
  assert.equal(rowWord(true, false), "PASS");
  assert.equal(rowWord(true, true), "NOT-TESTED");
  assert.equal(rowWord(false, true), "FAIL"); // a failure is a failure, blind or not
  assert.equal(runWord(true, false), "PASS");
  assert.equal(runWord(true, true), "NOT-TESTED");
  assert.equal(runWord(false, false), "FAIL");
});

test("a blind run is NOT-TESTED: every PASS row is regraded and the exit code is not 0", () => {
  const guard = createGuardTrack();
  guard.row();
  guard.row();
  guard.noteBlind("the end of the run"); // the check at stop failed
  const rep = guardReport({ lines: ["PASS a: 1", "PASS b: 2", "note: x"], ok: true, guard, close: [true, "closed"] });
  assert.deepEqual(rep.lines, ["NOT-TESTED a: 1", "NOT-TESTED b: 2", "note: x"]);
  assert.equal(rep.verdict, "NOT-TESTED");
  assert.equal(rep.code, 1);
  assert.match(rep.text, /RESULT: NOT-TESTED/);
  assert.match(rep.text, /guard: NOT-TESTED — the IPC guard was blind \(the end of the run\)/);
  assert.match(rep.text, /close: \[true,"closed"\]/);
});

test("rows a guarded check verified stay PASS; only the row the guard went blind on is NOT-TESTED", () => {
  const guard = createGuardTrack();
  guard.row();
  guard.good(); // row 0 ran between two good checks
  guard.row(); // row 1 ran
  guard.noteBlind("during a row", 1); // and the check after it failed
  const rep = guardReport({ lines: ["PASS a", "PASS b"], ok: true, guard });
  assert.deepEqual(rep.lines, ["PASS a", "NOT-TESTED b"]);
  assert.equal(rep.verdict, "NOT-TESTED");
});

test("a guard that went blind before any row and was rearmed leaves the run PASS", () => {
  const guard = createGuardTrack();
  guard.noteBlind("arming the guard"); // the launch check failed, no evidence depended on it
  guard.good(); // and the rearm's check passed
  assert.equal(guard.blind, false);
  const rep = guardReport({ lines: ["PASS a"], ok: true, guard });
  assert.deepEqual(rep.lines, ["PASS a"]);
  assert.equal(rep.verdict, "PASS");
  assert.equal(rep.code, 0);
});

test("a clean run keeps PASS and a failing run keeps FAIL", () => {
  const guard = createGuardTrack();
  guard.row();
  guard.good();
  const pass = guardReport({ lines: ["PASS a"], ok: true, guard });
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.code, 0);
  const fail = guardReport({ lines: ["PASS a", "FAIL b"], ok: false, guard });
  assert.deepEqual(fail.lines, ["PASS a", "FAIL b"]);
  assert.equal(fail.verdict, "FAIL");
  assert.equal(fail.code, 1);
});

test("a FAIL row stays FAIL when the guard went blind, and the run is still NOT-TESTED", () => {
  const guard = createGuardTrack();
  guard.row();
  guard.row();
  guard.noteBlind("the end of the run");
  const rep = guardReport({ lines: ["PASS a", "FAIL b"], ok: false, guard });
  assert.deepEqual(rep.lines, ["NOT-TESTED a", "FAIL b"]);
  assert.equal(rep.verdict, "NOT-TESTED");
  assert.equal(rep.code, 1);
});

test("the shared row check records its row and words a blind one NOT-TESTED", () => {
  const guard = createGuardTrack();
  assert.equal(guardRow(true, guard).word, "PASS");
  assert.equal(guard.rows, 1);
  guard.noteBlind("during a row", 1);
  assert.equal(guardRow(false, guard).word, "FAIL"); // a failing row is still a failure
  assert.equal(guardRow(true, guard).word, "NOT-TESTED"); // row 2, after the guard went blind
});
